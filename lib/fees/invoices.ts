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
import { studentBill, type StructureCache } from './billing.ts';
import type { Actor, Cents, FeeInstalment, FeeInvoiceRun, FeeInvoiceRunView, FeeInvoiceView, IsoDate } from '../types.ts';

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

export interface RunInput { termId: number; gradeLevelId?: number | null; postingDate: IsoDate; dueDate: IsoDate; instalments?: FeeInstalment[] | null }

/** Checks and normalises an instalment schedule: whole percentages summing to 100, dates in order from the posting date. */
export function normaliseInstalments(rows: FeeInstalment[] | null | undefined, postingDate: IsoDate): FeeInstalment[] | null {
  const kept = (rows ?? []).filter((r) => Number(r.pct) > 0 || r.due_date);
  if (kept.length < 2) return null;
  let sum = 0; let last = postingDate;
  for (const r of kept) {
    const pct = Number(r.pct);
    if (!(pct > 0 && pct <= 100)) throw new AppError('Each instalment is a percentage between 1 and 100', 'VALIDATION');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.due_date)) throw new AppError('Each instalment needs a due date', 'VALIDATION');
    if (r.due_date < last) throw new AppError('Instalment due dates must run in order, from the posting date', 'VALIDATION');
    last = r.due_date; sum += pct;
  }
  if (Math.round(sum * 100) !== 10_000) throw new AppError(`Instalments must add up to 100% (they add up to ${sum}%)`, 'VALIDATION');
  return kept.map((r) => ({ pct: Number(r.pct), due_date: r.due_date }));
}

/** Splits a cents amount across instalments by percentage; rounding lands on the last one so the parts add up exactly. */
export function splitByInstalments(amount: Cents, instalments: FeeInstalment[]): Cents[] {
  const parts = instalments.map((i) => Math.round(amount * i.pct / 100));
  const drift = amount - parts.reduce((a, b) => a + b, 0);
  parts[parts.length - 1] += drift;
  return parts;
}

/** Who a run would bill and for how much — the preview an Open run shows before it posts. */
export interface RunPreviewLine {
  student_id: number; admission_no: string; student_name: string; grade_level_name: string; boarding_status: string;
  /** Before discounts. */
  gross: Cents;
  /** Bursaries, scholarships and discounts taken off. */
  discount: Cents;
  /** What the invoice is raised for. */
  amount: Cents;
  already_invoiced: boolean;
}

/** Every Active student in scope with what a run would bill each — the preview an Open run shows before it posts. */
export async function previewRun(termId: number, gradeLevelId: number | null): Promise<{ lines: RunPreviewLine[]; total: Cents; discounts: Cents; toBill: number }> {
  const students = await all<{ id: number; admission_no: string; student_name: string; grade_level_id: number; grade_level_name: string; boarding_status: string; customer_id: number | null }>(
    `SELECT s.id, s.admission_no, s.first_name || ' ' || s.last_name AS student_name, s.current_grade_level_id AS grade_level_id, g.name AS grade_level_name, s.boarding_status, s.customer_id
     FROM student s JOIN grade_level g ON g.id = s.current_grade_level_id
     WHERE s.status = 'ACTIVE' ${gradeLevelId ? 'AND s.current_grade_level_id = ?' : ''}
     ORDER BY g.sort, s.admission_no`, ...(gradeLevelId ? [gradeLevelId] : []),
  );
  const invoiced = new Set((await all<{ student_id: number }>('SELECT student_id FROM fee_invoice WHERE term_id = ?', termId)).map((r) => r.student_id));
  const lines: RunPreviewLine[] = [];
  const cache: StructureCache = new Map();
  for (const s of students) {
    const bill = await studentBill(s, termId, cache);
    if (!bill.gross) continue;
    lines.push({
      student_id: s.id, admission_no: s.admission_no, student_name: s.student_name, grade_level_name: s.grade_level_name, boarding_status: s.boarding_status,
      gross: bill.gross, discount: bill.discount, amount: bill.net, already_invoiced: invoiced.has(s.id),
    });
  }
  const toBill = lines.filter((l) => !l.already_invoiced);
  return { lines, total: toBill.reduce((a, l) => a + l.amount, 0), discounts: toBill.reduce((a, l) => a + l.discount, 0), toBill: toBill.length };
}

export async function createFeeInvoiceRun(input: RunInput, user: Actor): Promise<{ no: string }> {
  const term = await one<{ academic_year_id: number }>('SELECT academic_year_id FROM academic_term WHERE id = ?', input.termId);
  if (!term) throw new AppError('Term not found', 'NOT_FOUND');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.postingDate) || !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) throw new AppError('Dates must be YYYY-MM-DD', 'VALIDATION');
  if (input.dueDate < input.postingDate) throw new AppError('The due date cannot be before the posting date', 'VALIDATION');
  if (!(await hasAnyRow('fee_structure', `term_id = ? ${input.gradeLevelId ? 'AND grade_level_id = ?' : ''}`, ...(input.gradeLevelId ? [input.termId, input.gradeLevelId] : [input.termId])))) {
    throw new AppError('There is no fee structure for that term — set one under Fees → Fee Structure first', 'VALIDATION');
  }
  const instalments = normaliseInstalments(input.instalments, input.postingDate);
  const preview = await previewRun(input.termId, input.gradeLevelId ?? null);
  const no = await nextSequence('FEE_INVOICE_RUN');
  await run(
    `INSERT INTO fee_invoice_run (no, term_id, academic_year_id, grade_level_id, posting_date, due_date, instalments, status, students_billed, total_amount, created_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    no, input.termId, term.academic_year_id, input.gradeLevelId || null, input.postingDate, instalments ? instalments[0].due_date : input.dueDate, instalments ? JSON.stringify(instalments) : null,
    'Open', preview.toBill, preview.total, now(), user.username,
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
  const org = await one<{ fee_discount_account_id: number | null }>('SELECT fee_discount_account_id FROM organisation WHERE id = 1');
  const discountAccount = org?.fee_discount_account_id ? await one<{ code: string }>('SELECT code FROM gl_account WHERE id = ?', org.fee_discount_account_id) : null;
  const preview = await previewRun(r.term_id, r.grade_level_id);
  // One invoice per instalment when the run is split, each with its own due date; otherwise one invoice due on the run's date.
  const schedule: FeeInstalment[] = r.instalments ? (JSON.parse(r.instalments) as FeeInstalment[]) : [{ pct: 100, due_date: r.due_date }];
  const failures: { admission_no: string; error: string }[] = [];
  let posted = 0; let skipped = 0; let total = 0;

  for (const line of preview.lines) {
    if (line.already_invoiced) { skipped += 1; continue; }
    try {
      await tx(async () => {
        const s = await one<{ id: number; customer_id: number | null; current_grade_level_id: number; boarding_status: string }>('SELECT id, customer_id, current_grade_level_id, boarding_status FROM student WHERE id = ?', line.student_id);
        if (!s?.customer_id) throw new AppError('The student has no fee account (customer) — open their record to create it', 'VALIDATION');
        // The same bill the preview showed: the items that apply to this student, less their discounts.
        const bill = await studentBill({ id: s.id, grade_level_id: s.current_grade_level_id, boarding_status: s.boarding_status }, r.term_id);
        if (bill.discounts.length && !discountAccount) throw new AppError('Set the bursaries / discounts account under Admin Centre → School Setup before invoicing a discounted student', 'VALIDATION');
        const label = `${termName?.name ?? ''} ${termName?.year ?? ''}`.trim();
        const customer = await one<{ name: string; address: string | null; city: string | null; contact: string | null }>('SELECT name, address, city, contact FROM customer WHERE id = ?', s.customer_id);
        // Each line (and each discount) is split across the instalments; rounding lands on the last.
        const lineParts = bill.lines.map((i) => splitByInstalments(i.amount, schedule));
        const discountParts = bill.discounts.map((d) => splitByInstalments(d.amount, schedule));
        for (const [k, inst] of schedule.entries()) {
          const suffix = schedule.length > 1 ? ` (instalment ${k + 1} of ${schedule.length})` : '';
          const { no: docNo } = await createSalesDocument({
            documentType: 'Invoice', customerId: s.customer_id, postingDate: r.posting_date, documentDate: r.posting_date,
            yourReference: `Fees ${label}${suffix}`,
          }, user);
          await setSalesLines(docNo, [
            ...bill.lines.map((i, idx) => ({
              type: 'G/L Account' as const, no: i.gl_account_code,
              description: `${i.fee_item_name} — ${label}${suffix}`, quantity: 1, unitPrice: lineParts[idx][k],
            })).filter((l) => l.unitPrice !== 0),
            // A discount is its own negative line to the contra-income account, so the gross fee and
            // what was waived both show — on the invoice and in the ledger.
            ...bill.discounts.map((d, idx) => ({
              type: 'G/L Account' as const, no: discountAccount!.code,
              description: `Less: ${d.description}${suffix}`, quantity: 1, unitPrice: -discountParts[idx][k],
            })).filter((l) => l.unitPrice !== 0),
          ], user);
          // Released straight away with the instalment's own due date: the run is the approved document,
          // and a payment-terms due date would silently override the one the school announced.
          await run(
            `UPDATE sales_header SET status = 'Released', payment_terms_code = NULL, due_date = ?, sell_to_name = ?, sell_to_address = ?, sell_to_city = ?, sell_to_contact = ? WHERE no = ?`,
            inst.due_date, customer?.name ?? null, customer?.address ?? null, customer?.city ?? null, customer?.contact ?? null, docNo,
          );
          const result = await postSalesDocument(docNo, {}, user);
          if (!result.invoiceNo) throw new AppError('The invoice did not post', 'VALIDATION');
          const instAmount = lineParts.reduce((a, p) => a + p[k], 0) - discountParts.reduce((a, p) => a + p[k], 0);
          await run(
            'INSERT INTO fee_invoice (run_id, student_id, customer_id, term_id, posted_invoice_no, amount, instalment_no, created_at) VALUES (?,?,?,?,?,?,?,?)',
            r.id, s.id, s.customer_id, r.term_id, result.invoiceNo, instAmount, k + 1, now(),
          );
        }
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
