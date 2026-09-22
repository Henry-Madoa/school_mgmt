/*
 * Petty Cash, Imprest Request and Imprest Surrender — AL Tab52203444/445 "Petty Cash
 * Header/Details", Tab52203447/449 "Request Header/Lines" with Request Type Imprest → Surrender,
 * Tab52203660 "Imprest Purpose", Cod52203432 "Imprest Management" (PostImprestRequest,
 * PostImprestSurrender, TransferUnsurrenderedImprestToPayroll) and Cod52203434.PostPettyCash.
 *
 * The employee is a subledger, as in BC: every issue, surrender, refund, claim and payroll
 * recovery is an employee_ledger_entry against one control G/L (General Ledger Setup → imprest
 * control account, 1215), and the control account mirrors the ledger line for line. Positive
 * means the employee owes the school.
 *
 * Imprest, with R = requested, A = actually spent:
 *   Issue        Dr Control R           Cr paying bank R          ledger +R           [Issued]
 *   Surrender    Dr expense lines A     Cr Control A              ledger −A
 *     A < R  refund of R−A:  Receive Now      Dr receiving bank   Cr Control   ledger −(R−A)
 *                            Deduct from Payroll  a payroll deduction on the control account;
 *                                                 the ledger clears when that payroll posts
 *     A > R  claim of A−R:   Pay Now          Dr Control          Cr claim bank  ledger +(A−R)
 *                            Pay from Payroll     a payroll allowance on the control account
 *                                                                                    [Closed]
 *   Unsurrendered past its due date: HR sends the whole R to payroll as a deduction; the
 *   imprest closes when the recovery has posted (Cod52203432.TransferUnsurrenderedImprestToPayroll).
 *
 * Petty cash (under the General Ledger Setup limit; above it, raise an imprest):
 *   Post         Dr expense lines        Cr petty cash float
 *
 * An imprest may also be paid out by a Payment Voucher of type Employee Payment applied to the
 * request — lib/paymentVouchers.ts calls markImprestIssuedByVoucher() on posting.
 */
import { one, all, run, tx, nextSequence, audit, hasAnyRow } from './db.ts';
import { stampEmployeeDimensions } from './selfService.ts';
import { AppError } from './errors.ts';
import { postJournal } from './accounting.ts';
import { getOrg } from './org.ts';
import { resolvePostingDate } from './postingDates.ts';
import { applyDateFormula, daysBetween } from './dateFormula.ts';
import { findMatchingWorkflow, findPendingRoutedTask, pickConditionFields, startWorkflow } from './workflow.ts';
import { buildFilterClause, type FilterCondition, type FilterFieldDef } from './listFilters.ts';
import { buildOrderClause, type SortState } from './listSort.ts';
import { formatMoney, today } from './format.ts';
import type {
  Actor, Cents, DocumentStatus, EmployeeLedgerEntryType, EmployeeLedgerEntryView, ImprestPurpose,
  ImprestRequest, ImprestRequestDetail, ImprestRequestFor, ImprestRequestLineView, ImprestRequestView,
  ImprestSettlement, ImprestStage, IsoDate, JournalLineInput, PettyCash, PettyCashDetail, PettyCashLineView,
  PettyCashView,
} from './types.ts';

export const IMPREST_SETTLEMENTS: ImprestSettlement[] = ['Receive Now', 'Deduct from Payroll', 'Pay Now', 'Pay from Payroll'];

/* --------------------------------------------------------- employee ledger */

/** The control G/L every employee entry posts through — General Ledger Setup. */
export async function imprestControlAccountId(): Promise<number> {
  const org = await getOrg();
  if (!org?.imprest_control_account_id) {
    throw new AppError('Set the Imprest Control Account on General Ledger Setup first', 'VALIDATION');
  }
  return org.imprest_control_account_id;
}

export const employeeBalance = async (employeeId: number): Promise<Cents> =>
  Number((await one<{ b: number }>('SELECT COALESCE(SUM(amount), 0)::bigint AS b FROM employee_ledger_entry WHERE employee_id = ?', employeeId))?.b ?? 0);

/** What the employee still owes (or is owed) on one document. */
export const documentBalance = async (employeeId: number, documentNo: string): Promise<Cents> =>
  Number((await one<{ b: number }>(
    'SELECT COALESCE(SUM(amount), 0)::bigint AS b FROM employee_ledger_entry WHERE employee_id = ? AND document_no = ?', employeeId, documentNo))?.b ?? 0);

export const listEmployeeLedger = (employeeId?: number, limit = 500): Promise<EmployeeLedgerEntryView[]> =>
  all<EmployeeLedgerEntryView>(
    `SELECT le.*, e.employee_no, e.first_name, e.last_name, j.journal_no,
            SUM(le.amount) OVER (PARTITION BY le.employee_id ORDER BY le.posting_date, le.id)::bigint AS running_balance
     FROM employee_ledger_entry le JOIN employee e ON e.id = le.employee_id LEFT JOIN journal j ON j.id = le.journal_id
     ${employeeId ? 'WHERE le.employee_id = ?' : ''}
     ORDER BY le.posting_date DESC, le.id DESC LIMIT ${limit}`,
    ...(employeeId ? [employeeId] : []),
  );

export interface EmployeeBalanceRow { employee_id: number; employee_no: string; first_name: string; last_name: string; balance: Cents; open_imprests: number }

export const listEmployeeBalances = (): Promise<EmployeeBalanceRow[]> =>
  all<EmployeeBalanceRow>(
    `SELECT e.id AS employee_id, e.employee_no, e.first_name, e.last_name,
            COALESCE(SUM(le.amount), 0)::bigint AS balance,
            (SELECT COUNT(*) FROM imprest_request r WHERE r.employee_id = e.id AND r.posted AND NOT r.surrendered)::int AS open_imprests
     FROM employee e LEFT JOIN employee_ledger_entry le ON le.employee_id = e.id
     GROUP BY e.id HAVING COALESCE(SUM(le.amount), 0) <> 0 OR COUNT(le.id) > 0
     ORDER BY balance DESC, e.employee_no`,
  );

/** One subledger line, inside the caller's transaction. Exported for receipts and vouchers. */
export async function writeEmployeeLedgerEntry(opts: {
  employeeId: number; entryType: EmployeeLedgerEntryType; documentNo: string; postingDate: IsoDate;
  amount: Cents; description?: string | null; journalId?: number | null; user: Actor;
}): Promise<void> {
  await run(
    `INSERT INTO employee_ledger_entry (employee_id, entry_type, document_no, posting_date, amount, description, journal_id, created_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    opts.employeeId, opts.entryType, opts.documentNo, opts.postingDate, Math.round(opts.amount), opts.description ?? null,
    opts.journalId ?? null, new Date().toISOString(), opts.user.username,
  );
}

/* ---------------------------------------------------------------- purposes */

export const listImprestPurposes = (): Promise<ImprestPurpose[]> => all('SELECT * FROM imprest_purpose ORDER BY code');
export const listActiveImprestPurposes = (): Promise<ImprestPurpose[]> => all("SELECT * FROM imprest_purpose WHERE status = 'ACTIVE' ORDER BY code");

export async function saveImprestPurpose(input: { code: string; description: string; status?: 'ACTIVE' | 'INACTIVE' }, user: Actor, isNew: boolean): Promise<void> {
  const code = input.code.trim().toUpperCase();
  if (!code) throw new AppError('A code is required', 'VALIDATION');
  if (!input.description?.trim()) throw new AppError('A description is required', 'VALIDATION');
  if (isNew) {
    if (await hasAnyRow('imprest_purpose', 'code = ?', code)) throw new AppError(`Purpose ${code} already exists`, 'VALIDATION');
    await run('INSERT INTO imprest_purpose (code, description, status) VALUES (?,?,?)', code, input.description.trim(), input.status ?? 'ACTIVE');
  } else {
    await run('UPDATE imprest_purpose SET description = ?, status = ? WHERE code = ?', input.description.trim(), input.status ?? 'ACTIVE', code);
  }
  await audit(user, isNew ? 'IMPREST_PURPOSE_CREATE' : 'IMPREST_PURPOSE_UPDATE', 'imprest_purpose', code, {});
}

export async function deleteImprestPurpose(code: string, user: Actor): Promise<void> {
  if (await hasAnyRow('imprest_request', 'purpose_code = ?', code)) throw new AppError('This purpose is in use on imprest requests — mark it inactive instead', 'VALIDATION');
  await run('DELETE FROM imprest_purpose WHERE code = ?', code);
  await audit(user, 'IMPREST_PURPOSE_DELETE', 'imprest_purpose', code, {});
}

/* ---------------------------------------------------------- imprest: read */

export type ImprestListView = 'open' | 'pending' | 'approved' | 'issued' | 'overdue' | 'surrender-pending' | 'surrender-approved' | 'closed' | 'all';

const VIEW_CLAUSE: Record<ImprestListView, string> = {
  open: "r.status = 'Open' AND NOT r.posted",
  pending: "r.status = 'Pending Approval'",
  approved: "r.status = 'Approved' AND NOT r.posted",
  issued: "r.posted AND NOT r.surrendered AND r.surrender_status = 'Open'",
  overdue: "r.posted AND NOT r.surrendered AND r.due_date IS NOT NULL AND r.due_date < CURRENT_DATE::text",
  'surrender-pending': "r.posted AND NOT r.surrendered AND r.surrender_status = 'Pending Approval'",
  'surrender-approved': "r.posted AND NOT r.surrendered AND r.surrender_status = 'Approved'",
  closed: 'r.surrendered',
  all: 'TRUE',
};

const STAGE_EXPR = `CASE
  WHEN r.surrendered THEN 'Closed'
  WHEN r.posted AND r.surrender_status <> 'Open' THEN 'Surrender'
  WHEN r.posted THEN 'Issued'
  ELSE 'Request' END`;

const SELECT_IMPREST = `
  SELECT r.*, e.employee_no, e.first_name, e.last_name, e.phone AS employee_phone, e.email AS employee_email, e.job_title,
         ip.description AS purpose_description,
         pb.code AS paying_bank_code, pb.name AS paying_bank_name, rb.code AS receiving_bank_code, cb.code AS claim_bank_code,
         ${STAGE_EXPR} AS stage,
         COALESCE((SELECT SUM(l.request_amount) FROM imprest_request_line l WHERE l.request_no = r.no), 0)::bigint AS request_amount,
         COALESCE((SELECT SUM(l.actual_spent) FROM imprest_request_line l WHERE l.request_no = r.no), 0)::bigint AS surrender_amount,
         (COALESCE((SELECT SUM(l.request_amount) FROM imprest_request_line l WHERE l.request_no = r.no), 0)
          - COALESCE((SELECT SUM(l.actual_spent) FROM imprest_request_line l WHERE l.request_no = r.no), 0))::bigint AS net_refund,
         COALESCE((SELECT SUM(le.amount) FROM employee_ledger_entry le WHERE le.employee_id = r.employee_id), 0)::bigint AS employee_balance,
         CASE WHEN r.posted AND NOT r.surrendered AND r.due_date IS NOT NULL AND r.due_date < CURRENT_DATE::text
              THEN (CURRENT_DATE - r.due_date::date) ELSE 0 END::int AS overdue_days,
         pj.journal_no AS posted_journal_no, sj.journal_no AS surrender_journal_no,
         (SELECT COUNT(*) FROM imprest_request_line l WHERE l.request_no = r.no)::int AS lines
  FROM imprest_request r
  JOIN employee e ON e.id = r.employee_id
  LEFT JOIN imprest_purpose ip ON ip.code = r.purpose_code
  LEFT JOIN bank_account pb ON pb.id = r.paying_bank_account_id
  LEFT JOIN bank_account rb ON rb.id = r.receiving_bank_account_id
  LEFT JOIN bank_account cb ON cb.id = r.claim_paying_bank_account_id
  LEFT JOIN journal pj ON pj.id = r.posted_journal_id
  LEFT JOIN journal sj ON sj.id = r.surrender_journal_id`;

export const IMPREST_FILTER_FIELDS: FilterFieldDef[] = [
  { key: 'employee_id', label: 'Employee', type: 'select', column: 'r.employee_id' },
  { key: 'purpose_code', label: 'Purpose', type: 'select', column: 'r.purpose_code' },
  { key: 'request_date', label: 'Request date', type: 'date', column: 'r.request_date' },
  { key: 'due_date', label: 'Due date', type: 'date', column: 'r.due_date' },
  { key: 'created_by', label: 'Created by', type: 'text', column: 'r.created_by' },
];

const IMPREST_SORT: Record<string, string> = {
  no: 'r.no', employee: 'e.first_name, e.last_name', request_date: 'r.request_date', due_date: 'r.due_date', status: 'r.status',
};

export interface ListImprestOptions {
  view?: ImprestListView; search?: string; filters?: FilterCondition[]; sort?: SortState | null;
  /** Employee Self Service: only this employee's requests. */
  employeeId?: number | null;
}

export const listImprestRequests = ({ view = 'all', search = '', filters = [], sort = null, employeeId = null }: ListImprestOptions = {}): Promise<ImprestRequestView[]> => {
  const { clause, params } = buildFilterClause(IMPREST_FILTER_FIELDS, filters);
  const orderBy = buildOrderClause(IMPREST_SORT, sort, 'r.no DESC');
  return all<ImprestRequestView>(
    `${SELECT_IMPREST}
     WHERE ${VIEW_CLAUSE[view]}
       AND (r.no ILIKE @like OR e.employee_no ILIKE @like OR e.first_name ILIKE @like OR e.last_name ILIKE @like OR r.purpose ILIKE @like)
       ${employeeId ? 'AND r.employee_id = @employeeId' : ''}
       ${clause}
     ${orderBy} LIMIT 500`,
    { like: `%${String(search).trim()}%`, ...(employeeId ? { employeeId } : {}), ...params },
  );
};

export const hasAnyImprestRequests = (view: ImprestListView = 'all'): Promise<boolean> => hasAnyRow('imprest_request r', VIEW_CLAUSE[view]);
export const getImprestRequest = (no: string): Promise<ImprestRequestView | undefined> => one<ImprestRequestView>(`${SELECT_IMPREST} WHERE r.no = ?`, no);

export const listImprestLines = (no: string): Promise<ImprestRequestLineView[]> =>
  all<ImprestRequestLineView>(
    `SELECT l.*, a.code AS gl_account_code, a.name AS gl_account_name, (l.actual_spent - l.request_amount)::bigint AS difference
     FROM imprest_request_line l JOIN gl_account a ON a.id = l.gl_account_id WHERE l.request_no = ? ORDER BY l.line_no`, no);

export async function getImprestRequestDetail(no: string): Promise<ImprestRequestDetail | undefined> {
  const head = await getImprestRequest(no);
  if (!head) return undefined;
  return { ...head, line_items: await listImprestLines(no) };
}

export async function getAdjacentImprestNos(no: string, view?: ImprestListView): Promise<{ prevNo: string | null; nextNo: string | null }> {
  const clause = VIEW_CLAUSE[view ?? 'all'];
  const [prev, next] = await Promise.all([
    one<{ no: string }>(`SELECT r.no FROM imprest_request r WHERE ${clause} AND r.no > ? ORDER BY r.no ASC LIMIT 1`, no),
    one<{ no: string }>(`SELECT r.no FROM imprest_request r WHERE ${clause} AND r.no < ? ORDER BY r.no DESC LIMIT 1`, no),
  ]);
  return { prevNo: prev?.no ?? null, nextNo: next?.no ?? null };
}

/** Approved, not yet issued — what an Employee Payment voucher may be applied to. */
export const listImprestsAwaitingIssue = (employeeId: number): Promise<{ no: string; purpose: string; request_amount: Cents }[]> =>
  all(
    `SELECT r.no, r.purpose, COALESCE((SELECT SUM(l.request_amount) FROM imprest_request_line l WHERE l.request_no = r.no), 0)::bigint AS request_amount
     FROM imprest_request r WHERE r.employee_id = ? AND r.status = 'Approved' AND NOT r.posted ORDER BY r.no`, employeeId);

/* --------------------------------------------------------- imprest: write */

export interface ImprestLineInput { glAccountId: number; narration?: string | null; quantity?: number; unitCost?: Cents; requestAmount: Cents }

export interface ImprestInput {
  employeeId: number;
  requestDate: IsoDate;
  purposeCode?: string | null;
  purpose: string;
  description?: string | null;
  requestFor?: ImprestRequestFor;
  departureLocation?: string | null;
  departureDate?: IsoDate | null;
  returnDate?: IsoDate | null;
  justification?: string | null;
  phoneNo?: string | null;
  payingBankAccountId?: number | null;
  payModeCode?: string | null;
  paymentTxNo?: string | null;
  chequeDate?: IsoDate | null;
  lines: ImprestLineInput[];
}

async function assertEmployee(employeeId: number): Promise<{ id: number; employee_no: string; status: string; phone: string | null }> {
  const e = await one<{ id: number; employee_no: string; status: string; phone: string | null }>('SELECT id, employee_no, status, phone FROM employee WHERE id = ?', employeeId);
  if (!e) throw new AppError('Employee not found', 'NOT_FOUND');
  if (!['ACTIVE', 'ON_LEAVE'].includes(e.status)) throw new AppError(`${e.employee_no} is not an active employee`, 'VALIDATION');
  return e;
}

async function assertExpenseAccount(id: number): Promise<void> {
  const a = await one<{ is_postable: number; status: string; no_direct_posting: number; code: string }>('SELECT is_postable, status, no_direct_posting, code FROM gl_account WHERE id = ?', id);
  if (!a || !a.is_postable || a.status !== 'ACTIVE') throw new AppError('Every line needs an active posting G/L account', 'VALIDATION');
  if (a.no_direct_posting) throw new AppError(`G/L account ${a.code} is a subledger control account`, 'VALIDATION');
}

async function assertImprestInput(input: ImprestInput): Promise<{ total: Cents; totalDays: number }> {
  await assertEmployee(input.employeeId);
  if (!input.requestDate) throw new AppError('A request date is required', 'VALIDATION');
  if (!input.purpose?.trim()) throw new AppError('State the purpose of the imprest', 'VALIDATION');
  if (input.purposeCode && !(await hasAnyRow('imprest_purpose', "code = ? AND status = 'ACTIVE'", input.purposeCode))) throw new AppError('Purpose code not found', 'NOT_FOUND');
  if (input.departureDate && input.returnDate && input.returnDate < input.departureDate) throw new AppError('The return date cannot be before the departure date', 'VALIDATION');
  if (!input.lines?.length) throw new AppError('Add at least one line — what the money is for', 'VALIDATION');
  let total = 0;
  for (const l of input.lines) {
    if (!(l.requestAmount > 0)) throw new AppError('Every line needs an amount greater than zero', 'VALIDATION');
    await assertExpenseAccount(l.glAccountId);
    total += Math.round(l.requestAmount);
  }
  if (input.payingBankAccountId) {
    const b = await one<{ status: string; blocked: number }>('SELECT status, blocked FROM bank_account WHERE id = ?', input.payingBankAccountId);
    if (!b || b.status !== 'ACTIVE' || b.blocked) throw new AppError('Pick an active paying bank account', 'VALIDATION');
  }
  const totalDays = input.departureDate && input.returnDate ? daysBetween(input.departureDate, input.returnDate) + 1 : 0;
  return { total, totalDays };
}

/** AL Tab52203447 OnInsert: "You have %1 unsurrendered imprest" against Max No Outstanding Imprests. */
async function assertOutstandingImprests(employeeId: number, exceptNo?: string): Promise<void> {
  const org = await getOrg();
  const max = Number(org?.max_outstanding_imprests ?? 1);
  if (max <= 0) return;
  const n = Number((await one<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM imprest_request WHERE employee_id = ? AND posted AND NOT surrendered ${exceptNo ? 'AND no <> ?' : ''}`,
    ...(exceptNo ? [employeeId, exceptNo] : [employeeId])))?.n ?? 0);
  if (n >= max) throw new AppError(`This employee has ${n} unsurrendered imprest${n === 1 ? '' : 's'} — the limit is ${max}`, 'VALIDATION');
}

async function replaceImprestLines(no: string, lines: ImprestLineInput[]): Promise<void> {
  await run('DELETE FROM imprest_request_line WHERE request_no = ?', no);
  let lineNo = 10000;
  for (const l of lines) {
    await run(
      'INSERT INTO imprest_request_line (request_no, line_no, gl_account_id, narration, quantity, unit_cost, request_amount) VALUES (?,?,?,?,?,?,?)',
      no, lineNo, l.glAccountId, l.narration?.trim() || null, Math.max(1, Math.round(l.quantity ?? 1)), Math.round(l.unitCost ?? 0), Math.round(l.requestAmount),
    );
    lineNo += 10000;
  }
}

export async function createImprestRequest(input: ImprestInput, user: Actor): Promise<{ no: string }> {
  const { totalDays } = await assertImprestInput(input);
  await assertOutstandingImprests(input.employeeId);
  const no = await nextSequence('IMPREST_REQUEST');
  await tx(async () => {
    await run(
      `INSERT INTO imprest_request
         (no, employee_id, request_date, purpose_code, purpose, description, request_for, departure_location, departure_date,
          return_date, total_days, justification, phone_no, paying_bank_account_id, pay_mode_code, payment_tx_no, cheque_date,
          created_at, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      no, input.employeeId, input.requestDate, input.purposeCode || null, input.purpose.trim(), input.description?.trim() || null,
      input.requestFor === 'Other' ? 'Other' : 'Self', input.departureLocation?.trim() || null, input.departureDate || null,
      input.returnDate || null, totalDays, input.justification?.trim() || null, input.phoneNo?.trim() || null,
      input.payingBankAccountId ?? null, input.payModeCode?.trim() || null, input.paymentTxNo?.trim() || null, input.chequeDate || null,
      new Date().toISOString(), user.username,
    );
    await stampEmployeeDimensions('imprest_request', no);
    await replaceImprestLines(no, input.lines);
  });
  await audit(user, 'IMPREST_CREATE', 'imprest_request', no, {});
  return { no };
}

async function editableImprest(no: string, user: Actor): Promise<ImprestRequest> {
  const r = await one<ImprestRequest>('SELECT * FROM imprest_request WHERE no = ?', no);
  if (!r) throw new AppError('Imprest request not found', 'NOT_FOUND');
  if (r.status !== 'Open' || r.posted) throw new AppError('Only an open, unissued imprest request can be changed', 'VALIDATION');
  if (r.created_by !== user.username) throw new AppError('Only the person who raised this request can change it', 'NOT_CREATOR');
  return r;
}

export async function updateImprestRequest(no: string, input: ImprestInput, user: Actor): Promise<void> {
  await editableImprest(no, user);
  const { totalDays } = await assertImprestInput(input);
  await tx(async () => {
    await run(
      `UPDATE imprest_request SET employee_id = ?, request_date = ?, purpose_code = ?, purpose = ?, description = ?, request_for = ?,
         departure_location = ?, departure_date = ?, return_date = ?, total_days = ?, justification = ?, phone_no = ?,
         paying_bank_account_id = ?, pay_mode_code = ?, payment_tx_no = ?, cheque_date = ? WHERE no = ?`,
      input.employeeId, input.requestDate, input.purposeCode || null, input.purpose.trim(), input.description?.trim() || null,
      input.requestFor === 'Other' ? 'Other' : 'Self', input.departureLocation?.trim() || null, input.departureDate || null,
      input.returnDate || null, totalDays, input.justification?.trim() || null, input.phoneNo?.trim() || null,
      input.payingBankAccountId ?? null, input.payModeCode?.trim() || null, input.paymentTxNo?.trim() || null, input.chequeDate || null, no,
    );
    await stampEmployeeDimensions('imprest_request', no);
    await replaceImprestLines(no, input.lines);
  });
  await audit(user, 'IMPREST_UPDATE', 'imprest_request', no, {});
}

export async function deleteImprestRequest(no: string, user: Actor): Promise<void> {
  await editableImprest(no, user);
  await run('DELETE FROM imprest_request WHERE no = ?', no);
  await audit(user, 'IMPREST_DELETE', 'imprest_request', no, {});
}

/* --------------------------------------------------- imprest: maker-checker */

export async function submitImprestRequest(no: string, user: Actor): Promise<{ autoApproved: boolean }> {
  const r = await getImprestRequest(no);
  if (!r) throw new AppError('Imprest request not found', 'NOT_FOUND');
  if (r.status !== 'Open' || r.posted) throw new AppError('Only an open request can be sent for approval', 'VALIDATION');
  if (!(r.request_amount > 0)) throw new AppError('The request has no amount', 'VALIDATION');
  await assertOutstandingImprests(r.employee_id);
  const matched = await findMatchingWorkflow('IMPREST_REQUEST', await pickConditionFields('IMPREST_REQUEST', { ...r, amount: r.request_amount }));
  if (!matched) throw new AppError('There is no enabled workflow for this document', 'NO_WORKFLOW');
  await tx(async () => {
    await run("UPDATE imprest_request SET status = 'Pending Approval' WHERE no = ?", no);
    await startWorkflow(matched.workflow, matched.steps, { documentType: 'IMPREST_REQUEST', entityId: no, requestedBy: user.username, amount: Number(r.request_amount) });
  });
  const after = await one<{ status: string }>('SELECT status FROM imprest_request WHERE no = ?', no);
  return { autoApproved: after?.status === 'Approved' };
}

export async function cancelImprestApproval(no: string, user: Actor): Promise<void> {
  const r = await one<Pick<ImprestRequest, 'status' | 'created_by'>>('SELECT status, created_by FROM imprest_request WHERE no = ?', no);
  if (!r) throw new AppError('Imprest request not found', 'NOT_FOUND');
  if (r.status !== 'Pending Approval') throw new AppError('Only a request pending approval can be recalled', 'VALIDATION');
  const routed = await findPendingRoutedTask('IMPREST_REQUEST', no);
  if ((routed?.requested_by ?? r.created_by) !== user.username) throw new AppError('Only the person who submitted this request can recall it', 'NOT_REQUESTER');
  await run("UPDATE imprest_request SET status = 'Open' WHERE no = ?", no);
  await audit(user, 'IMPREST_CANCEL_APPROVAL', 'imprest_request', no, {});
}

export async function approveImprestRequest(no: string, user: Actor): Promise<void> {
  const r = await one<ImprestRequest>('SELECT * FROM imprest_request WHERE no = ?', no);
  if (!r) throw new AppError('Imprest request not found', 'NOT_FOUND');
  if (r.status !== 'Pending Approval') throw new AppError('Only a request pending approval can be approved', 'VALIDATION');
  await run("UPDATE imprest_request SET status = 'Approved', decision_reason = NULL WHERE no = ?", no);
  await audit(user, 'IMPREST_APPROVE', 'imprest_request', no, {});
}

export async function rejectImprestRequest(no: string, reason: string | null, user: Actor): Promise<void> {
  if (!reason?.trim()) throw new AppError('A reason is required to reject a request', 'VALIDATION');
  const r = await one<ImprestRequest>('SELECT * FROM imprest_request WHERE no = ?', no);
  if (!r) throw new AppError('Imprest request not found', 'NOT_FOUND');
  if (r.status !== 'Pending Approval') throw new AppError('Only a request pending approval can be rejected', 'VALIDATION');
  await run("UPDATE imprest_request SET status = 'Open', decision_reason = ? WHERE no = ?", reason, no);
  await audit(user, 'IMPREST_REJECT', 'imprest_request', no, { reason });
}

export async function reopenImprestRequest(no: string, user: Actor): Promise<void> {
  const r = await one<ImprestRequest>('SELECT * FROM imprest_request WHERE no = ?', no);
  if (!r) throw new AppError('Imprest request not found', 'NOT_FOUND');
  if (r.status !== 'Approved' || r.posted) throw new AppError('Only an approved request that has not been issued can be reopened', 'VALIDATION');
  await run("UPDATE imprest_request SET status = 'Open' WHERE no = ?", no);
  await audit(user, 'IMPREST_REOPEN', 'imprest_request', no, {});
}

/* --------------------------------------------------------- imprest: issue */

/** Cod52203432.CheckForCashAvailability: the float keeps its minimum balance. */
async function assertCashAvailable(bankAccountId: number, amount: Cents): Promise<{ gl_account_id: number; code: string }> {
  const b = await one<{ gl_account_id: number; code: string; balance: Cents; min_balance: Cents; status: string; blocked: number }>(
    'SELECT gl_account_id, code, balance, min_balance, status, blocked FROM bank_account WHERE id = ?', bankAccountId);
  if (!b || b.status !== 'ACTIVE' || b.blocked) throw new AppError('Pick an active bank account', 'VALIDATION');
  const available = Number(b.balance) - Number(b.min_balance);
  if (amount > available) {
    throw new AppError(`There is not enough cash on ${b.code} for ${formatMoney(amount)} — only ${formatMoney(Math.max(available, 0))} is available above its minimum float`, 'VALIDATION');
  }
  return { gl_account_id: b.gl_account_id, code: b.code };
}

/** Cod52203432.PostImprestRequest — pay the money out; the request becomes a surrender to come. */
export async function issueImprest(no: string, user: Actor): Promise<{ journalNo: string; dueDate: IsoDate }> {
  return tx(async () => {
    const r = await getImprestRequest(no);
    if (!r) throw new AppError('Imprest request not found', 'NOT_FOUND');
    if (r.posted) throw new AppError(`Imprest ${no} has already been issued`, 'VALIDATION');
    if (r.status !== 'Approved') throw new AppError('Only an approved request can be issued', 'VALIDATION');
    if (!r.pay_mode_code) throw new AppError('Set the pay mode before issuing', 'VALIDATION');
    if (!r.paying_bank_account_id) throw new AppError('Set the paying bank account before issuing', 'VALIDATION');
    if (!(r.request_amount > 0)) throw new AppError('The request has no amount', 'VALIDATION');
    await assertOutstandingImprests(r.employee_id);
    const bank = await assertCashAvailable(r.paying_bank_account_id, r.request_amount);
    const control = await imprestControlAccountId();
    const org = await getOrg();

    const vd = await resolvePostingDate(user);
    const narration = `Imprest ${no} issued to ${r.employee_no} — ${r.purpose}`;
    const j = await postJournal({
      valueDate: vd, module: 'IMPREST', eventType: 'IMPREST_ISSUE', description: narration, reference: no, user,
      globalDimension1Id: r.global_dimension_1_id, globalDimension2Id: r.global_dimension_2_id,
      idempotencyKey: `IMPREST-ISSUE-${no}`,
      lines: [
        { account: control, debit: r.request_amount, credit: 0, narration },
        { account: bank.gl_account_id, debit: 0, credit: r.request_amount, narration, bankDocumentType: 'Payment', bankDocumentNo: no },
      ],
    });
    await writeEmployeeLedgerEntry({ employeeId: r.employee_id, entryType: 'IMPREST_ISSUE', documentNo: no, postingDate: vd, amount: r.request_amount, description: narration, journalId: j.id, user });
    const dueDate = applyDateFormula(vd, org?.imprest_surrender_period || '14D');
    await run(
      'UPDATE imprest_request SET posted = true, posted_at = ?, posted_by = ?, posted_journal_id = ?, due_date = COALESCE(due_date, ?) WHERE no = ?',
      new Date().toISOString(), user.username, j.id, dueDate, no,
    );
    await audit(user, 'IMPREST_ISSUE', 'imprest_request', no, { journalNo: j.journal_no, amount: r.request_amount });
    return { journalNo: j.journal_no, dueDate };
  });
}

/** An Employee Payment voucher applied to the request paid it out — lib/paymentVouchers.ts. */
export async function markImprestIssuedByVoucher(no: string, employeeId: number, amount: Cents, pvNo: string, journalId: number, vd: IsoDate, user: Actor): Promise<void> {
  const r = await getImprestRequest(no);
  if (!r) throw new AppError(`Imprest ${no} not found`, 'NOT_FOUND');
  if (r.employee_id !== employeeId) throw new AppError(`Imprest ${no} belongs to ${r.employee_no}, not the voucher's employee`, 'VALIDATION');
  if (r.posted) throw new AppError(`Imprest ${no} has already been issued`, 'VALIDATION');
  if (r.status !== 'Approved') throw new AppError(`Imprest ${no} is not approved`, 'VALIDATION');
  if (Math.round(amount) !== Number(r.request_amount)) throw new AppError(`Imprest ${no} is for ${formatMoney(r.request_amount)}; the voucher line is ${formatMoney(amount)}`, 'VALIDATION');
  await assertOutstandingImprests(r.employee_id);
  const org = await getOrg();
  await run(
    'UPDATE imprest_request SET posted = true, posted_at = ?, posted_by = ?, posted_journal_id = ?, pv_no = ?, due_date = COALESCE(due_date, ?) WHERE no = ?',
    new Date().toISOString(), user.username, journalId, pvNo, applyDateFormula(vd, org?.imprest_surrender_period || '14D'), no,
  );
  await audit(user, 'IMPREST_ISSUE_BY_PV', 'imprest_request', no, { pvNo });
}

/* ------------------------------------------------------- imprest: surrender */

export interface SurrenderLineInput { id: number; actualSpent: Cents; surrenderNote?: string | null }
export interface SurrenderInput {
  surrenderDate: IsoDate;
  lines: SurrenderLineInput[];
  settlement?: ImprestSettlement | null;
  receivingBankAccountId?: number | null;
  receiptModeCode?: string | null;
  receiptTxNo?: string | null;
  claimPayingBankAccountId?: number | null;
  claimPayModeCode?: string | null;
  claimPaymentTxNo?: string | null;
}

async function surrenderable(no: string): Promise<ImprestRequestView> {
  const r = await getImprestRequest(no);
  if (!r) throw new AppError('Imprest request not found', 'NOT_FOUND');
  if (!r.posted) throw new AppError('This imprest has not been issued yet', 'VALIDATION');
  if (r.surrendered) throw new AppError('This imprest has already been surrendered', 'VALIDATION');
  if (r.transferred_to_payroll) throw new AppError('This imprest is being recovered through payroll', 'VALIDATION');
  return r;
}

/** Pag52203487 "Imprest Surrender": what was actually spent, line by line. */
export async function saveImprestSurrender(no: string, input: SurrenderInput, user: Actor): Promise<void> {
  const r = await surrenderable(no);
  if (r.surrender_status !== 'Open') throw new AppError('The surrender can only be changed while it is open', 'VALIDATION');
  if (!input.surrenderDate) throw new AppError('A surrender date is required', 'VALIDATION');
  const lines = await listImprestLines(no);
  await tx(async () => {
    for (const l of lines) {
      const s = input.lines.find((x) => x.id === l.id);
      const actual = Math.round(s?.actualSpent ?? 0);
      if (actual < 0) throw new AppError('Actual spent cannot be negative', 'VALIDATION');
      await run('UPDATE imprest_request_line SET actual_spent = ?, surrender_note = ? WHERE id = ?', actual, s?.surrenderNote?.trim() || null, l.id);
    }
    await run(
      `UPDATE imprest_request SET surrender_date = ?, settlement = ?, receiving_bank_account_id = ?, receipt_mode_code = ?, receipt_tx_no = ?,
         claim_paying_bank_account_id = ?, claim_pay_mode_code = ?, claim_payment_tx_no = ? WHERE no = ?`,
      input.surrenderDate, input.settlement && IMPREST_SETTLEMENTS.includes(input.settlement) ? input.settlement : null,
      input.receivingBankAccountId ?? null, input.receiptModeCode?.trim() || null, input.receiptTxNo?.trim() || null,
      input.claimPayingBankAccountId ?? null, input.claimPayModeCode?.trim() || null, input.claimPaymentTxNo?.trim() || null, no,
    );
  });
  await audit(user, 'IMPREST_SURRENDER_SAVE', 'imprest_request', no, {});
}

/** Cod52203432.SubmitCashSurrender — through a workflow when one is defined for IMPREST_SURRENDER;
 *  the AL approves a surrender outright, so with no workflow it goes straight to Approved. */
export async function submitImprestSurrender(no: string, user: Actor): Promise<{ autoApproved: boolean }> {
  const r = await surrenderable(no);
  if (r.surrender_status !== 'Open') throw new AppError('The surrender has already been submitted', 'VALIDATION');
  if (!r.surrender_date) throw new AppError('Save the surrender with its date first', 'VALIDATION');
  if (!(r.surrender_amount > 0)) throw new AppError('The surrender amount cannot be zero — enter what was spent', 'VALIDATION');
  const net = Number(r.net_refund);
  if (net > 0 && !r.settlement?.startsWith('Receive') && r.settlement !== 'Deduct from Payroll') {
    throw new AppError(`${formatMoney(net)} is due back — choose Receive Now or Deduct from Payroll`, 'VALIDATION');
  }
  if (net < 0 && r.settlement !== 'Pay Now' && r.settlement !== 'Pay from Payroll') {
    throw new AppError(`${formatMoney(-net)} is claimed over the imprest — choose Pay Now or Pay from Payroll`, 'VALIDATION');
  }
  const matched = await findMatchingWorkflow('IMPREST_SURRENDER', await pickConditionFields('IMPREST_SURRENDER', { ...r, amount: r.surrender_amount }));
  if (!matched) {
    await run("UPDATE imprest_request SET surrender_status = 'Approved' WHERE no = ?", no);
    await audit(user, 'IMPREST_SURRENDER_SUBMIT', 'imprest_request', no, { approved: 'no workflow' });
    return { autoApproved: true };
  }
  await tx(async () => {
    await run("UPDATE imprest_request SET surrender_status = 'Pending Approval' WHERE no = ?", no);
    await startWorkflow(matched.workflow, matched.steps, { documentType: 'IMPREST_SURRENDER', entityId: no, requestedBy: user.username, amount: Number(r.surrender_amount) });
  });
  const after = await one<{ surrender_status: string }>('SELECT surrender_status FROM imprest_request WHERE no = ?', no);
  return { autoApproved: after?.surrender_status === 'Approved' };
}

export async function cancelImprestSurrenderApproval(no: string, user: Actor): Promise<void> {
  const r = await surrenderable(no);
  if (r.surrender_status !== 'Pending Approval') throw new AppError('Only a surrender pending approval can be recalled', 'VALIDATION');
  const routed = await findPendingRoutedTask('IMPREST_SURRENDER', no);
  if ((routed?.requested_by ?? r.created_by) !== user.username) throw new AppError('Only the person who submitted this surrender can recall it', 'NOT_REQUESTER');
  await run("UPDATE imprest_request SET surrender_status = 'Open' WHERE no = ?", no);
  await audit(user, 'IMPREST_SURRENDER_CANCEL_APPROVAL', 'imprest_request', no, {});
}

export async function approveImprestSurrender(no: string, user: Actor): Promise<void> {
  const r = await surrenderable(no);
  if (r.surrender_status !== 'Pending Approval') throw new AppError('Only a surrender pending approval can be approved', 'VALIDATION');
  await run("UPDATE imprest_request SET surrender_status = 'Approved', surrender_decision_reason = NULL WHERE no = ?", no);
  await audit(user, 'IMPREST_SURRENDER_APPROVE', 'imprest_request', no, {});
}

/** Cod52203432.RejectCashSurrender. */
export async function rejectImprestSurrender(no: string, reason: string | null, user: Actor): Promise<void> {
  if (!reason?.trim()) throw new AppError('A reason is required to reject a surrender', 'VALIDATION');
  const r = await surrenderable(no);
  if (r.surrender_status !== 'Pending Approval') throw new AppError('Only a surrender pending approval can be rejected', 'VALIDATION');
  await run("UPDATE imprest_request SET surrender_status = 'Open', surrender_decision_reason = ? WHERE no = ?", reason, no);
  await audit(user, 'IMPREST_SURRENDER_REJECT', 'imprest_request', no, { reason });
}

export async function reopenImprestSurrender(no: string, user: Actor): Promise<void> {
  const r = await surrenderable(no);
  if (r.surrender_status !== 'Approved') throw new AppError('Only an approved, unposted surrender can be reopened', 'VALIDATION');
  await run("UPDATE imprest_request SET surrender_status = 'Open' WHERE no = ?", no);
  await audit(user, 'IMPREST_SURRENDER_REOPEN', 'imprest_request', no, {});
}

/** Cod52203432.PostImprestSurrender — the expenses go to the G/L, the difference is settled. */
export async function postImprestSurrender(no: string, user: Actor): Promise<{ journalNo: string; refund: Cents; claim: Cents; toPayroll: boolean }> {
  const result = await tx(async () => {
    const r = await surrenderable(no);
    if (r.surrender_status !== 'Approved') throw new AppError('The surrender must be approved before it is posted', 'VALIDATION');
    const lines = await listImprestLines(no);
    const A = Number(r.surrender_amount);
    const R = Number(r.request_amount);
    if (!(A > 0)) throw new AppError('The surrender amount cannot be zero', 'VALIDATION');
    const control = await imprestControlAccountId();
    const vd = await resolvePostingDate(user);
    const net = R - A;
    const refund = net > 0 ? net : 0;
    const claim = net < 0 ? -net : 0;

    const jl: JournalLineInput[] = [];
    for (const l of lines) {
      if (Number(l.actual_spent) > 0) jl.push({ account: l.gl_account_id, debit: Number(l.actual_spent), credit: 0, narration: l.narration || `Imprest ${no} — ${l.gl_account_name}` });
    }
    jl.push({ account: control, debit: 0, credit: A, narration: `Imprest surrender ${no} — ${r.employee_no}` });

    let toPayroll = false;
    if (refund > 0) {
      if (r.settlement === 'Receive Now') {
        if (!r.receiving_bank_account_id) throw new AppError('Set the receiving bank account for the refund', 'VALIDATION');
        const bank = await one<{ gl_account_id: number }>('SELECT gl_account_id FROM bank_account WHERE id = ?', r.receiving_bank_account_id);
        if (!bank) throw new AppError('Receiving bank account not found', 'NOT_FOUND');
        jl.push({ account: bank.gl_account_id, debit: refund, credit: 0, narration: `Imprest refund ${no} from ${r.employee_no}`, bankDocumentType: 'Refund', bankDocumentNo: no });
        jl.push({ account: control, debit: 0, credit: refund, narration: `Imprest refund ${no} from ${r.employee_no}` });
      } else if (r.settlement === 'Deduct from Payroll') {
        toPayroll = true;
      } else throw new AppError('Choose how the refund is settled — Receive Now or Deduct from Payroll', 'VALIDATION');
    }
    if (claim > 0) {
      if (r.settlement === 'Pay Now') {
        if (!r.claim_paying_bank_account_id) throw new AppError('Set the bank account the claim is paid from', 'VALIDATION');
        const bank = await assertCashAvailable(r.claim_paying_bank_account_id, claim);
        jl.push({ account: control, debit: claim, credit: 0, narration: `Staff claim from imprest ${no}` });
        jl.push({ account: bank.gl_account_id, debit: 0, credit: claim, narration: `Staff claim from imprest ${no}`, bankDocumentType: 'Payment', bankDocumentNo: no });
      } else if (r.settlement === 'Pay from Payroll') {
        toPayroll = true;
      } else throw new AppError('Choose how the claim is settled — Pay Now or Pay from Payroll', 'VALIDATION');
    }

    const j = await postJournal({
      valueDate: vd, module: 'IMPREST', eventType: 'IMPREST_SURRENDER', description: `Imprest surrender ${no} — ${r.employee_no}: ${r.purpose}`,
      reference: no, user, idempotencyKey: `IMPREST-SURRENDER-${no}`, lines: jl,
      globalDimension1Id: r.global_dimension_1_id, globalDimension2Id: r.global_dimension_2_id,
    });
    await writeEmployeeLedgerEntry({ employeeId: r.employee_id, entryType: 'IMPREST_SURRENDER', documentNo: no, postingDate: vd, amount: -A, description: `Surrender of imprest ${no}`, journalId: j.id, user });
    if (refund > 0 && r.settlement === 'Receive Now') {
      await writeEmployeeLedgerEntry({ employeeId: r.employee_id, entryType: 'IMPREST_REFUND', documentNo: no, postingDate: vd, amount: -refund, description: `Refund received on imprest ${no}`, journalId: j.id, user });
    }
    if (claim > 0 && r.settlement === 'Pay Now') {
      await writeEmployeeLedgerEntry({ employeeId: r.employee_id, entryType: 'CLAIM_PAID', documentNo: no, postingDate: vd, amount: claim, description: `Claim paid on imprest ${no}`, journalId: j.id, user });
    }

    let payrollTransactionId: number | null = null;
    if (toPayroll) {
      payrollTransactionId = await sendImprestBalanceToPayroll(r, refund > 0 ? refund : -claim, user);
    }
    await run(
      `UPDATE imprest_request SET surrendered = true, surrender_status = 'Closed', surrender_posted_at = ?, surrender_posted_by = ?,
         surrender_journal_id = ?, transfer_to_payroll = ?, transferred_to_payroll = ?, payroll_transaction_id = COALESCE(?, payroll_transaction_id),
         payroll_transferred_at = CASE WHEN ? THEN ? ELSE payroll_transferred_at END,
         payroll_transferred_by = CASE WHEN ? THEN ? ELSE payroll_transferred_by END
       WHERE no = ?`,
      new Date().toISOString(), user.username, j.id, toPayroll, toPayroll, payrollTransactionId,
      toPayroll, new Date().toISOString(), toPayroll, user.username, no,
    );
    await audit(user, 'IMPREST_SURRENDER_POST', 'imprest_request', no, { journalNo: j.journal_no, refund, claim, toPayroll });
    return { journalNo: j.journal_no, refund, claim, toPayroll };
  });
  return result;
}

/* ----------------------------------------------------------------- payroll */

/**
 * The payroll side — system transaction codes on the control account so the payroll journal
 * settles the employee ledger: IMPRECOV deducts what the employee owes; IMPCLAIM pays what
 * they are owed. lib/payroll.ts writes the matching ledger entries when the period closes.
 */
export async function ensureImprestPayrollCodes(): Promise<{ recovery: number; claim: number }> {
  const control = await imprestControlAccountId();
  const ensure = async (code: string, name: string, type: 'DEDUCTION' | 'INCOME'): Promise<number> => {
    const row = await one<{ id: number; gl_account_id: number | null }>('SELECT id, gl_account_id FROM payroll_transaction_code WHERE code = ?', code);
    if (row) {
      if (!row.gl_account_id) await run('UPDATE payroll_transaction_code SET gl_account_id = ? WHERE id = ?', control, row.id);
      return row.id;
    }
    const info = await run(
      `INSERT INTO payroll_transaction_code (code, name, type, taxable, balance_type, special_type, gl_account_id, created_at, created_by)
       VALUES (?,?,?,false,'NONE','NONE',?,?, 'SYSTEM')`,
      code, name, type, control, new Date().toISOString(),
    );
    return Number(info.lastInsertRowid);
  };
  return { recovery: await ensure('IMPRECOV', 'Imprest Recovery', 'DEDUCTION'), claim: await ensure('IMPCLAIM', 'Imprest Claim Reimbursement', 'INCOME') };
}

/** A deduction (amount > 0) or an allowance (amount < 0) on the open payroll period. */
async function sendImprestBalanceToPayroll(r: ImprestRequestView, amount: Cents, user: Actor): Promise<number> {
  const period = await one<{ id: number; period_name: string }>("SELECT id, period_name FROM payroll_period WHERE status = 'OPEN' ORDER BY start_date DESC LIMIT 1");
  if (!period) throw new AppError('There is no open payroll period to send this to', 'VALIDATION');
  const codes = await ensureImprestPayrollCodes();
  const info = await run(
    `INSERT INTO employee_payroll_transaction
       (employee_id, transaction_code_id, payroll_period_id, amount_cents, original_amount_cents, balance_cents, no_of_periods, temporary, notes, created_at, created_by)
     VALUES (?,?,?,?,?,?,?,true,?,?,?)`,
    r.employee_id, amount > 0 ? codes.recovery : codes.claim, period.id, Math.abs(Math.round(amount)), null, null, null,
    `Imprest ${r.no}`, new Date().toISOString(), user.username,
  );
  return Number(info.lastInsertRowid);
}

/** Cod52203432.TransferUnsurrenderedImprestToPayroll — HR recovers an unsurrendered imprest. */
export async function transferImprestToPayroll(no: string, user: Actor): Promise<{ amount: Cents; periodName: string }> {
  const r = await getImprestRequest(no);
  if (!r) throw new AppError('Imprest request not found', 'NOT_FOUND');
  if (!r.posted) throw new AppError('This imprest has not been issued', 'VALIDATION');
  if (r.surrendered) throw new AppError('This imprest has been surrendered', 'VALIDATION');
  if (r.transferred_to_payroll) throw new AppError('This imprest is already being recovered through payroll', 'VALIDATION');
  if (r.surrender_status !== 'Open') throw new AppError('A surrender is in progress on this imprest', 'VALIDATION');
  const outstanding = await documentBalance(r.employee_id, no);
  if (!(outstanding > 0)) throw new AppError('Nothing is outstanding on this imprest', 'VALIDATION');
  const period = await one<{ id: number; period_name: string }>("SELECT id, period_name FROM payroll_period WHERE status = 'OPEN' ORDER BY start_date DESC LIMIT 1");
  if (!period) throw new AppError('There is no open payroll period to send this to', 'VALIDATION');
  const id = await sendImprestBalanceToPayroll(r, outstanding, user);
  await run(
    `UPDATE imprest_request SET transfer_to_payroll = true, transferred_to_payroll = true, payroll_transaction_id = ?,
       payroll_transferred_at = ?, payroll_transferred_by = ?, settlement = 'Deduct from Payroll' WHERE no = ?`,
    id, new Date().toISOString(), user.username, no,
  );
  await audit(user, 'IMPREST_TRANSFER_TO_PAYROLL', 'imprest_request', no, { amount: outstanding, periodId: period.id });
  return { amount: outstanding, periodName: period.period_name };
}

/**
 * Called by lib/payroll.ts when a period's journal posts: every IMPRECOV / IMPCLAIM line becomes
 * an employee ledger entry, and an imprest recovered in full closes.
 */
export async function settleImprestsFromPayroll(periodId: number, postingDate: IsoDate, journalId: number, user: Actor): Promise<number> {
  const rows = await all<{ employee_id: number; code: string; amount_cents: number; notes: string | null; tx_id: number }>(
    `SELECT t.employee_id, c.code, l.amount_cents, t.notes, t.id AS tx_id
     FROM payroll_period_transaction l
     JOIN payroll_transaction_code c ON c.id = l.transaction_code_id
     JOIN employee_payroll_transaction t ON t.employee_id = l.employee_id AND t.transaction_code_id = l.transaction_code_id AND t.payroll_period_id = l.payroll_period_id
     WHERE l.payroll_period_id = ? AND c.code IN ('IMPRECOV', 'IMPCLAIM') AND l.amount_cents > 0`, periodId);
  let n = 0;
  for (const row of rows) {
    const docNo = row.notes?.match(/(?:Imprest|Staff Claim) (\S+)/)?.[1] ?? `PAYROLL-${periodId}`;
    const recovery = row.code === 'IMPRECOV';
    await writeEmployeeLedgerEntry({
      employeeId: row.employee_id, entryType: recovery ? 'PAYROLL_RECOVERY' : 'PAYROLL_CLAIM', documentNo: docNo, postingDate,
      amount: recovery ? -Number(row.amount_cents) : Number(row.amount_cents),
      description: recovery ? `Imprest recovered through payroll — ${docNo}` : `Imprest claim paid through payroll — ${docNo}`, journalId, user,
    });
    n += 1;
    // An unsurrendered imprest recovered in full is closed.
    if (recovery && docNo.startsWith('IMP')) {
      const left = await documentBalance(row.employee_id, docNo);
      if (left <= 0) {
        await run(
          `UPDATE imprest_request SET surrendered = true, surrender_status = 'Closed', surrender_posted_at = COALESCE(surrender_posted_at, ?),
             surrender_posted_by = COALESCE(surrender_posted_by, ?) WHERE no = ? AND NOT surrendered`,
          new Date().toISOString(), user.username, docNo,
        );
      }
    }
  }
  return n;
}

/* ------------------------------------------------------------- petty cash */

export type PettyCashListView = 'open' | 'pending' | 'approved' | 'posted' | 'paid' | 'all';

const PC_VIEW: Record<PettyCashListView, string> = {
  open: "p.status = 'Open'",
  pending: "p.status = 'Pending Approval'",
  approved: "p.status = 'Approved' AND NOT p.posted",
  posted: 'p.posted AND NOT p.paid',
  paid: 'p.paid',
  all: 'TRUE',
};

const SELECT_PC = `
  SELECT p.*, e.employee_no, e.first_name, e.last_name, e.job_title, b.code AS paying_bank_code, b.name AS paying_bank_name,
         COALESCE((SELECT SUM(l.amount) FROM petty_cash_line l WHERE l.petty_cash_no = p.no), 0)::bigint AS total_amount,
         j.journal_no, (SELECT COUNT(*) FROM petty_cash_line l WHERE l.petty_cash_no = p.no)::int AS lines
  FROM petty_cash p JOIN employee e ON e.id = p.employee_id
  LEFT JOIN bank_account b ON b.id = p.paying_bank_account_id
  LEFT JOIN journal j ON j.id = p.journal_id`;

export const listPettyCash = (view: PettyCashListView = 'all', search = '', employeeId: number | null = null): Promise<PettyCashView[]> =>
  all<PettyCashView>(
    `${SELECT_PC} WHERE ${PC_VIEW[view]}
       AND (p.no ILIKE @like OR e.employee_no ILIKE @like OR e.first_name ILIKE @like OR e.last_name ILIKE @like OR p.payment_narration ILIKE @like OR COALESCE(p.payment_to, '') ILIKE @like)
       ${employeeId ? 'AND p.employee_id = @employeeId' : ''}
     ORDER BY p.no DESC LIMIT 500`,
    { like: `%${String(search).trim()}%`, ...(employeeId ? { employeeId } : {}) },
  );

export const hasAnyPettyCash = (view: PettyCashListView = 'all'): Promise<boolean> => hasAnyRow('petty_cash p', PC_VIEW[view]);
export const getPettyCash = (no: string): Promise<PettyCashView | undefined> => one<PettyCashView>(`${SELECT_PC} WHERE p.no = ?`, no);

export const listPettyCashLines = (no: string): Promise<PettyCashLineView[]> =>
  all<PettyCashLineView>(
    'SELECT l.*, a.code AS gl_account_code, a.name AS gl_account_name FROM petty_cash_line l JOIN gl_account a ON a.id = l.gl_account_id WHERE l.petty_cash_no = ? ORDER BY l.line_no', no);

export async function getPettyCashDetail(no: string): Promise<PettyCashDetail | undefined> {
  const head = await getPettyCash(no);
  if (!head) return undefined;
  return { ...head, line_items: await listPettyCashLines(no) };
}

/** Petty cash floats — bank accounts kept for it; the cash office till does as well. */
export const listPettyCashFloats = (): Promise<{ id: number; code: string; name: string; balance: Cents; min_balance: Cents; account_type: string }[]> =>
  all("SELECT id, code, name, balance, min_balance, account_type FROM bank_account WHERE status = 'ACTIVE' AND blocked = 0 AND account_type IN ('PETTY_CASH', 'TILL') ORDER BY account_type, code");

export interface PettyCashLineInput { glAccountId: number; description?: string | null; amount: Cents }
export interface PettyCashInput {
  employeeId: number;
  requestDate: IsoDate;
  postingDate?: IsoDate | null;
  payingBankAccountId?: number | null;
  paymentTo?: string | null;
  onBehalfOf?: string | null;
  paymentNarration: string;
  payModeCode?: string | null;
  paymentTxNo?: string | null;
  chequeDate?: IsoDate | null;
  lines: PettyCashLineInput[];
}

/** Tab52203445 Amount.OnValidate: the petty cash limit — "create an Imprest Request" above it. */
async function assertPettyCashInput(input: PettyCashInput): Promise<Cents> {
  await assertEmployee(input.employeeId);
  if (!input.requestDate) throw new AppError('A date is required', 'VALIDATION');
  if (!input.paymentNarration?.trim()) throw new AppError('A payment narration is required', 'VALIDATION');
  if (!input.lines?.length) throw new AppError('Add at least one expense line', 'VALIDATION');
  let total = 0;
  for (const l of input.lines) {
    if (!(l.amount > 0)) throw new AppError('Every line needs an amount greater than zero', 'VALIDATION');
    await assertExpenseAccount(l.glAccountId);
    total += Math.round(l.amount);
  }
  const org = await getOrg();
  const limit = Number(org?.petty_cash_limit ?? 0);
  if (limit > 0 && total > limit) {
    throw new AppError(`For an expense claim above ${formatMoney(limit)}, raise an imprest request instead`, 'VALIDATION');
  }
  if (input.payingBankAccountId) {
    const ok = (await listPettyCashFloats()).some((b) => b.id === input.payingBankAccountId);
    if (!ok) throw new AppError('The paying account must be a petty cash float or the cash office till', 'VALIDATION');
  }
  return total;
}

async function replacePettyCashLines(no: string, lines: PettyCashLineInput[]): Promise<void> {
  await run('DELETE FROM petty_cash_line WHERE petty_cash_no = ?', no);
  let lineNo = 10000;
  for (const l of lines) {
    await run('INSERT INTO petty_cash_line (petty_cash_no, line_no, gl_account_id, description, amount) VALUES (?,?,?,?,?)',
      no, lineNo, l.glAccountId, l.description?.trim() || null, Math.round(l.amount));
    lineNo += 10000;
  }
}

export async function createPettyCash(input: PettyCashInput, user: Actor): Promise<{ no: string }> {
  await assertPettyCashInput(input);
  const no = await nextSequence('PETTY_CASH');
  await tx(async () => {
    await run(
      `INSERT INTO petty_cash (no, employee_id, request_date, posting_date, paying_bank_account_id, payment_to, on_behalf_of, payment_narration,
         pay_mode_code, payment_tx_no, cheque_date, created_at, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      no, input.employeeId, input.requestDate, input.postingDate || null, input.payingBankAccountId ?? null, input.paymentTo?.trim() || null,
      input.onBehalfOf?.trim() || null, input.paymentNarration.trim(), input.payModeCode?.trim() || null, input.paymentTxNo?.trim() || null,
      input.chequeDate || null, new Date().toISOString(), user.username,
    );
    await stampEmployeeDimensions('petty_cash', no);
    await replacePettyCashLines(no, input.lines);
  });
  await audit(user, 'PETTY_CASH_CREATE', 'petty_cash', no, {});
  return { no };
}

async function editablePettyCash(no: string, user: Actor): Promise<PettyCash> {
  const p = await one<PettyCash>('SELECT * FROM petty_cash WHERE no = ?', no);
  if (!p) throw new AppError('Petty cash not found', 'NOT_FOUND');
  if (p.status !== 'Open' || p.posted) throw new AppError('Only an open petty cash can be changed', 'VALIDATION');
  if (p.created_by !== user.username) throw new AppError('Only the person who raised this petty cash can change it', 'NOT_CREATOR');
  return p;
}

export async function updatePettyCash(no: string, input: PettyCashInput, user: Actor): Promise<void> {
  await editablePettyCash(no, user);
  await assertPettyCashInput(input);
  await tx(async () => {
    await run(
      `UPDATE petty_cash SET employee_id = ?, request_date = ?, posting_date = ?, paying_bank_account_id = ?, payment_to = ?, on_behalf_of = ?,
         payment_narration = ?, pay_mode_code = ?, payment_tx_no = ?, cheque_date = ? WHERE no = ?`,
      input.employeeId, input.requestDate, input.postingDate || null, input.payingBankAccountId ?? null, input.paymentTo?.trim() || null,
      input.onBehalfOf?.trim() || null, input.paymentNarration.trim(), input.payModeCode?.trim() || null, input.paymentTxNo?.trim() || null,
      input.chequeDate || null, no,
    );
    await stampEmployeeDimensions('petty_cash', no);
    await replacePettyCashLines(no, input.lines);
  });
  await audit(user, 'PETTY_CASH_UPDATE', 'petty_cash', no, {});
}

export async function deletePettyCash(no: string, user: Actor): Promise<void> {
  await editablePettyCash(no, user);
  await run('DELETE FROM petty_cash WHERE no = ?', no);
  await audit(user, 'PETTY_CASH_DELETE', 'petty_cash', no, {});
}

export async function submitPettyCash(no: string, user: Actor): Promise<{ autoApproved: boolean }> {
  const p = await getPettyCash(no);
  if (!p) throw new AppError('Petty cash not found', 'NOT_FOUND');
  if (p.status !== 'Open') throw new AppError('Only an open petty cash can be sent for approval', 'VALIDATION');
  if (!(p.total_amount > 0)) throw new AppError('The petty cash has no amount', 'VALIDATION');
  const matched = await findMatchingWorkflow('PETTY_CASH', await pickConditionFields('PETTY_CASH', { ...p, amount: p.total_amount }));
  if (!matched) throw new AppError('There is no enabled workflow for this document', 'NO_WORKFLOW');
  await tx(async () => {
    await run("UPDATE petty_cash SET status = 'Pending Approval' WHERE no = ?", no);
    await startWorkflow(matched.workflow, matched.steps, { documentType: 'PETTY_CASH', entityId: no, requestedBy: user.username, amount: Number(p.total_amount) });
  });
  const after = await one<{ status: string }>('SELECT status FROM petty_cash WHERE no = ?', no);
  return { autoApproved: after?.status === 'Approved' };
}

export async function cancelPettyCashApproval(no: string, user: Actor): Promise<void> {
  const p = await one<Pick<PettyCash, 'status' | 'created_by'>>('SELECT status, created_by FROM petty_cash WHERE no = ?', no);
  if (!p) throw new AppError('Petty cash not found', 'NOT_FOUND');
  if (p.status !== 'Pending Approval') throw new AppError('Only a petty cash pending approval can be recalled', 'VALIDATION');
  const routed = await findPendingRoutedTask('PETTY_CASH', no);
  if ((routed?.requested_by ?? p.created_by) !== user.username) throw new AppError('Only the person who submitted this petty cash can recall it', 'NOT_REQUESTER');
  await run("UPDATE petty_cash SET status = 'Open' WHERE no = ?", no);
  await audit(user, 'PETTY_CASH_CANCEL_APPROVAL', 'petty_cash', no, {});
}

export async function approvePettyCash(no: string, user: Actor): Promise<void> {
  const p = await one<PettyCash>('SELECT * FROM petty_cash WHERE no = ?', no);
  if (!p) throw new AppError('Petty cash not found', 'NOT_FOUND');
  if (p.status !== 'Pending Approval') throw new AppError('Only a petty cash pending approval can be approved', 'VALIDATION');
  await run("UPDATE petty_cash SET status = 'Approved', decision_reason = NULL WHERE no = ?", no);
  await audit(user, 'PETTY_CASH_APPROVE', 'petty_cash', no, {});
}

export async function rejectPettyCash(no: string, reason: string | null, user: Actor): Promise<void> {
  if (!reason?.trim()) throw new AppError('A reason is required to reject a petty cash', 'VALIDATION');
  const p = await one<PettyCash>('SELECT * FROM petty_cash WHERE no = ?', no);
  if (!p) throw new AppError('Petty cash not found', 'NOT_FOUND');
  if (p.status !== 'Pending Approval') throw new AppError('Only a petty cash pending approval can be rejected', 'VALIDATION');
  await run("UPDATE petty_cash SET status = 'Open', decision_reason = ? WHERE no = ?", reason, no);
  await audit(user, 'PETTY_CASH_REJECT', 'petty_cash', no, { reason });
}

export async function reopenPettyCash(no: string, user: Actor): Promise<void> {
  const p = await one<PettyCash>('SELECT * FROM petty_cash WHERE no = ?', no);
  if (!p) throw new AppError('Petty cash not found', 'NOT_FOUND');
  if (p.status !== 'Approved' || p.posted) throw new AppError('Only an approved, unposted petty cash can be reopened', 'VALIDATION');
  await run("UPDATE petty_cash SET status = 'Open' WHERE no = ?", no);
  await audit(user, 'PETTY_CASH_REOPEN', 'petty_cash', no, {});
}

/** Cod52203434.PostPettyCash — expenses to the G/L, cash out of the float. */
export async function postPettyCash(no: string, user: Actor): Promise<{ journalNo: string }> {
  return tx(async () => {
    const p = await getPettyCash(no);
    if (!p) throw new AppError('Petty cash not found', 'NOT_FOUND');
    if (p.posted) throw new AppError(`Petty cash ${no} has already been posted`, 'VALIDATION');
    if (p.status !== 'Approved') throw new AppError('Only an approved petty cash can be posted', 'VALIDATION');
    if (!p.paying_bank_account_id) throw new AppError('Set the paying petty cash float before posting', 'VALIDATION');
    if (!p.pay_mode_code) throw new AppError('Set the pay mode before posting', 'VALIDATION');
    if (!(p.total_amount > 0)) throw new AppError('The petty cash has no amount', 'VALIDATION');
    const bank = await assertCashAvailable(p.paying_bank_account_id, p.total_amount);
    const lines = await listPettyCashLines(no);
    const vd = p.posting_date || (await resolvePostingDate(user));
    const jl: JournalLineInput[] = [
      ...lines.map((l) => ({ account: l.gl_account_id, debit: Number(l.amount), credit: 0, narration: l.description || p.payment_narration })),
      { account: bank.gl_account_id, debit: 0, credit: Number(p.total_amount), narration: p.payment_narration, bankDocumentType: 'Payment', bankDocumentNo: no },
    ];
    const j = await postJournal({
      valueDate: vd, module: 'PETTY_CASH', eventType: 'PETTY_CASH_POST', description: `Petty cash ${no} — ${p.payment_narration}`,
      reference: no, user, idempotencyKey: `PETTY-CASH-${no}`, lines: jl,
      globalDimension1Id: p.global_dimension_1_id, globalDimension2Id: p.global_dimension_2_id,
    });
    await run('UPDATE petty_cash SET posted = true, posted_at = ?, posted_by = ?, journal_id = ?, posting_date = ? WHERE no = ?',
      new Date().toISOString(), user.username, j.id, vd, no);
    await audit(user, 'PETTY_CASH_POST', 'petty_cash', no, { journalNo: j.journal_no, amount: p.total_amount });
    return { journalNo: j.journal_no };
  });
}

/** Pag52203462 "Paid": the cashier has handed the cash over. */
export async function markPettyCashPaid(no: string, user: Actor): Promise<void> {
  const p = await one<PettyCash>('SELECT * FROM petty_cash WHERE no = ?', no);
  if (!p) throw new AppError('Petty cash not found', 'NOT_FOUND');
  if (!p.posted) throw new AppError('You can only pay a posted petty cash', 'VALIDATION');
  if (p.paid) throw new AppError('Already marked as paid', 'VALIDATION');
  await run('UPDATE petty_cash SET paid = true, paid_at = ?, paid_by = ? WHERE no = ?', new Date().toISOString(), user.username, no);
  await audit(user, 'PETTY_CASH_PAID', 'petty_cash', no, {});
}

export const listImprestJournals = (no: string): Promise<{ journal_no: string; value_date: IsoDate; description: string | null; amount: Cents }[]> =>
  all('SELECT journal_no, value_date, description, amount FROM journal WHERE reference = ? ORDER BY value_date, id', no);

export const imprestStageOf = (r: Pick<ImprestRequest, 'posted' | 'surrendered' | 'surrender_status'>): ImprestStage =>
  (r.surrendered ? 'Closed' : r.posted && r.surrender_status !== 'Open' ? 'Surrender' : r.posted ? 'Issued' : 'Request');

export type { DocumentStatus };
