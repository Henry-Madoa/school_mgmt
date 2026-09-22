/*
 * Fee invoicing — a Fee Invoice Run raises one Sales Invoice per active student enrolled in the
 * grades that have a fee structure for the term, each line billing a fee item to its income
 * account, and posts them through Receivables (lib/salesDocuments.ts). The result is an ordinary
 * posted sales invoice and customer ledger entry per student: aged balances, statements,
 * reminders and receipts all work on it unchanged.
 *
 * Lifecycle: Open (preview — who would be billed, for how much) → Posted. Posting is idempotent
 * per student and term: a student already invoiced for the term is skipped, so a second run for
 * late admissions bills only them.
 */
import { one, all, run, tx, audit, nextSequence, hasAnyRow } from '../db.ts';
import { AppError } from '../errors.ts';
import { createSalesDocument, setSalesLines, postSalesDocument } from '../salesDocuments.ts';
import { gradeFeeLines } from './setup.ts';
import type { Actor, Cents, FeeInvoiceRun, FeeInvoiceRunView, FeeInvoiceView, IsoDate } from '../types.ts';

const now = (): string => new Date().toISOString();

const RUN_SELECT = `
  SELECT r.*, t.name AS term_name, y.name AS year_name, g.name AS grade_level_name
  FROM fee_invoice_run r
  JOIN academic_term t ON t.id = r.term_id
  JOIN academic_year y ON y.id = r.academic_year_id
  LEFT JOIN grade_level g ON g.id = r.grade_level_id`;

export const listFeeInvoiceRuns = (): Promise<FeeInvoiceRunView[]> => all<FeeInvoiceRunView>(`${RUN_SELECT} ORDER BY r.id DESC LIMIT 200`);
export const getFeeInvoiceRun = (no: string): Promise<FeeInvoiceRunView | undefined> => one<FeeInvoiceRunView>(`${RUN_SELECT} WHERE r.no = ?`, no);
export const hasAnyFeeInvoiceRuns = (): Promise<boolean> => hasAnyRow('fee_invoice_run');

const INVOICE_SELECT = `
  SELECT fi.*, s.admission_no, s.first_name || ' ' || s.last_name AS student_name, g.name AS grade_level_name, st.name AS stream_name,
         COALESCE(cle.remaining_amount, 0) AS remaining_amount, cle.due_date, cle.posting_date,
         r.no AS run_no, t.name AS term_name, y.name AS year_name
  FROM fee_invoice fi
  JOIN student s ON s.id = fi.student_id
  JOIN fee_invoice_run r ON r.id = fi.run_id
  JOIN academic_term t ON t.id = fi.term_id
  JOIN academic_year y ON y.id = t.academic_year_id
  LEFT JOIN grade_level g ON g.id = s.current_grade_level_id
  LEFT JOIN stream st ON st.id = s.current_stream_id
  LEFT JOIN posted_sales_document psd ON psd.no = fi.posted_invoice_no
  LEFT JOIN cust_ledger_entry cle ON cle.id = psd.cust_ledger_entry_id`;

export const listRunInvoices = (runId: number): Promise<FeeInvoiceView[]> =>
  all<FeeInvoiceView>(`${INVOICE_SELECT} WHERE fi.run_id = ? ORDER BY s.admission_no`, runId);

export const listStudentFeeInvoices = (studentId: number): Promise<FeeInvoiceView[]> =>
  all<FeeInvoiceView>(`${INVOICE_SELECT} WHERE fi.student_id = ? ORDER BY fi.id DESC`, studentId);

export const listTermInvoices = (termId: number): Promise<FeeInvoiceView[]> =>
  all<FeeInvoiceView>(`${INVOICE_SELECT} WHERE fi.term_id = ? ORDER BY g.sort, st.name, s.admission_no`, termId);

export interface RunInput { termId: number; gradeLevelId?: number | null; postingDate: IsoDate; dueDate: IsoDate }

/** Who a run would bill and for how much — the preview an Open run shows before it posts. */
export interface RunPreviewLine { student_id: number; admission_no: string; student_name: string; grade_level_name: string; amount: Cents; already_invoiced: boolean }

export async function previewRun(termId: number, gradeLevelId: number | null): Promise<{ lines: RunPreviewLine[]; total: Cents; toBill: number }> {
  const students = await all<{ id: number; admission_no: string; student_name: string; grade_level_id: number; grade_level_name: string; customer_id: number | null }>(
    `SELECT s.id, s.admission_no, s.first_name || ' ' || s.last_name AS student_name, s.current_grade_level_id AS grade_level_id, g.name AS grade_level_name, s.customer_id
     FROM student s JOIN grade_level g ON g.id = s.current_grade_level_id
     WHERE s.status = 'ACTIVE' ${gradeLevelId ? 'AND s.current_grade_level_id = ?' : ''}
     ORDER BY g.sort, s.admission_no`, ...(gradeLevelId ? [gradeLevelId] : []),
  );
  const invoiced = new Set((await all<{ student_id: number }>('SELECT student_id FROM fee_invoice WHERE term_id = ?', termId)).map((r) => r.student_id));
  const feeByGrade = new Map<number, Cents>();
  const lines: RunPreviewLine[] = [];
  for (const s of students) {
    if (!feeByGrade.has(s.grade_level_id)) {
      const items = await gradeFeeLines(s.grade_level_id, termId);
      feeByGrade.set(s.grade_level_id, items.reduce((a, i) => a + Number(i.amount), 0));
    }
    const amount = feeByGrade.get(s.grade_level_id) ?? 0;
    if (!amount) continue;
    lines.push({ student_id: s.id, admission_no: s.admission_no, student_name: s.student_name, grade_level_name: s.grade_level_name, amount, already_invoiced: invoiced.has(s.id) });
  }
  const toBill = lines.filter((l) => !l.already_invoiced);
  return { lines, total: toBill.reduce((a, l) => a + l.amount, 0), toBill: toBill.length };
}

export async function createFeeInvoiceRun(input: RunInput, user: Actor): Promise<{ no: string }> {
  const term = await one<{ academic_year_id: number }>('SELECT academic_year_id FROM academic_term WHERE id = ?', input.termId);
  if (!term) throw new AppError('Term not found', 'NOT_FOUND');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.postingDate) || !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) throw new AppError('Dates must be YYYY-MM-DD', 'VALIDATION');
  if (input.dueDate < input.postingDate) throw new AppError('The due date cannot be before the posting date', 'VALIDATION');
  if (!(await hasAnyRow('fee_structure', `term_id = ? ${input.gradeLevelId ? 'AND grade_level_id = ?' : ''}`, ...(input.gradeLevelId ? [input.termId, input.gradeLevelId] : [input.termId])))) {
    throw new AppError('There is no fee structure for that term — set one under Fees → Fee Structure first', 'VALIDATION');
  }
  const preview = await previewRun(input.termId, input.gradeLevelId ?? null);
  const no = await nextSequence('FEE_INVOICE_RUN');
  await run(
    `INSERT INTO fee_invoice_run (no, term_id, academic_year_id, grade_level_id, posting_date, due_date, status, students_billed, total_amount, created_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    no, input.termId, term.academic_year_id, input.gradeLevelId || null, input.postingDate, input.dueDate, 'Open', preview.toBill, preview.total, now(), user.username,
  );
  await audit(user, 'FEE_INVOICE_RUN_CREATE', 'fee_invoice_run', no, { termId: input.termId, students: preview.toBill });
  return { no };
}

export async function deleteFeeInvoiceRun(no: string, user: Actor): Promise<void> {
  const r = await one<FeeInvoiceRun>('SELECT * FROM fee_invoice_run WHERE no = ?', no);
  if (!r) throw new AppError('Run not found', 'NOT_FOUND');
  if (r.status !== 'Open') throw new AppError('A posted run cannot be deleted', 'VALIDATION');
  await run('DELETE FROM fee_invoice_run WHERE id = ?', r.id);
  await audit(user, 'FEE_INVOICE_RUN_DELETE', 'fee_invoice_run', no, {});
}

/**
 * Posts the run: for every student still unbilled for the term, a Sales Invoice is created,
 * released with the run's due date and posted. Each student is its own transaction so one bad
 * fee account (a blocked customer, a missing posting group) stops that student, not the run —
 * the failure is reported per student and the run can be posted again for them once fixed.
 */
export async function postFeeInvoiceRun(no: string, user: Actor): Promise<{ posted: number; skipped: number; failures: { admission_no: string; error: string }[]; total: Cents }> {
  const r = await one<FeeInvoiceRun>('SELECT * FROM fee_invoice_run WHERE no = ?', no);
  if (!r) throw new AppError('Run not found', 'NOT_FOUND');
  if (r.status !== 'Open') throw new AppError('This run has already been posted', 'VALIDATION');
  const termName = await one<{ name: string; year: string }>('SELECT t.name, y.name AS year FROM academic_term t JOIN academic_year y ON y.id = t.academic_year_id WHERE t.id = ?', r.term_id);
  const preview = await previewRun(r.term_id, r.grade_level_id);
  const failures: { admission_no: string; error: string }[] = [];
  let posted = 0; let skipped = 0; let total = 0;

  for (const line of preview.lines) {
    if (line.already_invoiced) { skipped += 1; continue; }
    try {
      await tx(async () => {
        const s = await one<{ id: number; customer_id: number | null; current_grade_level_id: number }>('SELECT id, customer_id, current_grade_level_id FROM student WHERE id = ?', line.student_id);
        if (!s?.customer_id) throw new AppError('The student has no fee account (customer) — open their record to create it', 'VALIDATION');
        const items = await gradeFeeLines(s.current_grade_level_id, r.term_id);
        // Each line bills the fee item's income account — the G/L code the sales line names.
        const accounts = new Map((await all<{ id: number; code: string }>(
          'SELECT fi.id, g.code FROM fee_item fi JOIN gl_account g ON g.id = fi.gl_account_id WHERE fi.id = ANY(@ids)', { ids: items.map((i) => i.fee_item_id) },
        )).map((x) => [x.id, x.code]));
        const label = `${termName?.name ?? ''} ${termName?.year ?? ''}`.trim();
        const { no: docNo } = await createSalesDocument({
          documentType: 'Invoice', customerId: s.customer_id, postingDate: r.posting_date, documentDate: r.posting_date,
          yourReference: `Fees ${label}`,
        }, user);
        await setSalesLines(docNo, items.map((i) => ({
          type: 'G/L Account' as const, no: accounts.get(i.fee_item_id) ?? null,
          description: `${i.fee_item_name} — ${label}`, quantity: 1, unitPrice: Number(i.amount),
        })), user);
        // Released straight away with the run's own due date: the run is the approved document,
        // and a payment-terms due date would silently override the one the school announced.
        const customer = await one<{ name: string; address: string | null; city: string | null; contact: string | null }>('SELECT name, address, city, contact FROM customer WHERE id = ?', s.customer_id);
        await run(
          `UPDATE sales_header SET status = 'Released', payment_terms_code = NULL, due_date = ?, sell_to_name = ?, sell_to_address = ?, sell_to_city = ?, sell_to_contact = ? WHERE no = ?`,
          r.due_date, customer?.name ?? null, customer?.address ?? null, customer?.city ?? null, customer?.contact ?? null, docNo,
        );
        const result = await postSalesDocument(docNo, {}, user);
        if (!result.invoiceNo) throw new AppError('The invoice did not post', 'VALIDATION');
        await run(
          'INSERT INTO fee_invoice (run_id, student_id, customer_id, term_id, posted_invoice_no, amount, created_at) VALUES (?,?,?,?,?,?,?)',
          r.id, s.id, s.customer_id, r.term_id, result.invoiceNo, line.amount, now(),
        );
      });
      posted += 1; total += line.amount;
    } catch (err) {
      failures.push({ admission_no: line.admission_no, error: err instanceof Error ? err.message : String(err) });
    }
  }
  const remaining = preview.lines.filter((l) => !l.already_invoiced).length - posted;
  await run(
    `UPDATE fee_invoice_run SET status = ?, students_billed = ?, total_amount = ?, posted_at = ?, posted_by = ? WHERE id = ?`,
    remaining ? 'Open' : 'Posted', posted, total, remaining ? null : now(), remaining ? null : user.username, r.id,
  );
  await audit(user, 'FEE_INVOICE_RUN_POST', 'fee_invoice_run', no, { posted, skipped, failures: failures.length, total });
  return { posted, skipped, failures, total };
}

/* ------------------------------------------------------------------ balances */

export interface FeeBalanceRow {
  student_id: number; admission_no: string; student_name: string; grade_level_name: string | null; stream_name: string | null;
  customer_no: string; guardian_name: string | null; guardian_phone: string | null;
  balance: Cents; overdue: Cents; oldest_due_date: IsoDate | null; last_payment_date: IsoDate | null;
}

/** Every student with money owing (or in credit), with how much of it is past due. */
export const listFeeBalances = (opts: { streamId?: number | null; gradeLevelId?: number | null; onlyOverdue?: boolean; asOf?: IsoDate } = {}): Promise<FeeBalanceRow[]> =>
  all<FeeBalanceRow>(
    `SELECT s.id AS student_id, s.admission_no, s.first_name || ' ' || s.last_name AS student_name, g.name AS grade_level_name, st.name AS stream_name,
            c.no AS customer_no, pg.full_name AS guardian_name, pg.phone AS guardian_phone,
            COALESCE(c.balance, 0) AS balance,
            COALESCE((SELECT SUM(cle.remaining_amount_lcy) FROM cust_ledger_entry cle WHERE cle.customer_id = c.id AND cle.open = 1 AND cle.positive = 1 AND cle.due_date < @asOf), 0) AS overdue,
            (SELECT MIN(cle.due_date) FROM cust_ledger_entry cle WHERE cle.customer_id = c.id AND cle.open = 1 AND cle.positive = 1) AS oldest_due_date,
            (SELECT MAX(cle.posting_date) FROM cust_ledger_entry cle WHERE cle.customer_id = c.id AND cle.document_type = 'Payment') AS last_payment_date
     FROM student s
     JOIN customer c ON c.id = s.customer_id
     LEFT JOIN grade_level g ON g.id = s.current_grade_level_id
     LEFT JOIN stream st ON st.id = s.current_stream_id
     LEFT JOIN LATERAL (SELECT gu.full_name, gu.phone FROM student_guardian sg JOIN guardian gu ON gu.id = sg.guardian_id WHERE sg.student_id = s.id ORDER BY sg.is_primary DESC, sg.id LIMIT 1) pg ON true
     WHERE COALESCE(c.balance, 0) <> 0
       ${opts.streamId ? 'AND s.current_stream_id = @streamId' : ''} ${opts.gradeLevelId ? 'AND s.current_grade_level_id = @gradeLevelId' : ''}
     ${opts.onlyOverdue ? 'AND EXISTS (SELECT 1 FROM cust_ledger_entry x WHERE x.customer_id = c.id AND x.open = 1 AND x.positive = 1 AND x.due_date < @asOf)' : ''}
     ORDER BY overdue DESC, balance DESC, s.admission_no`,
    { asOf: opts.asOf ?? new Date().toISOString().slice(0, 10), streamId: opts.streamId ?? null, gradeLevelId: opts.gradeLevelId ?? null },
  );
