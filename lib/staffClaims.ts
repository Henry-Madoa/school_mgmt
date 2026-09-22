/*
 * Staff Claims — AL (Sacco ERP) Tab52203447 "Request Header" with Request Type "Staff Claim",
 * Pag52203468 "Staff Claim", Pag52203471 "Staff Claims", Cod52203432.PostStaffClaim.
 *
 * An employee spent their own money on the SACCO's business and claims it back. The claim is
 * lines of what was spent; once approved it is paid from a bank account, or through payroll,
 * and posts through the same employee subledger as imprests (lib/imprest.ts).
 *
 *   Pay Now           Dr expense lines A   Cr Control A   (ledger −A: the SACCO owes)
 *                     Dr Control A         Cr bank A      (ledger +A: paid)   — one journal,
 *                     as Cod52203432 posts both employee legs so the claim shows on the ledger
 *   Pay from Payroll  Dr expense lines A   Cr Control A   (ledger −A), and an IMPCLAIM allowance
 *                     on the open payroll; lib/imprest.ts settles the ledger when it posts
 *   Stop Payment      an approved claim held back from posting (AL "Payment Stopped")
 */
import { one, all, run, tx, nextSequence, audit, hasAnyRow } from './db.ts';
import { stampEmployeeDimensions } from './selfService.ts';
import { AppError } from './errors.ts';
import { postJournal } from './accounting.ts';
import { resolvePostingDate } from './postingDates.ts';
import { findMatchingWorkflow, findPendingRoutedTask, pickConditionFields, startWorkflow } from './workflow.ts';
import { formatMoney } from './format.ts';
import { imprestControlAccountId, writeEmployeeLedgerEntry, ensureImprestPayrollCodes } from './imprest.ts';
import type {
  Actor, Cents, IsoDate, JournalLineInput, StaffClaim, StaffClaimDetail, StaffClaimLineView, StaffClaimSettlement, StaffClaimView,
} from './types.ts';

export const STAFF_CLAIM_SETTLEMENTS: StaffClaimSettlement[] = ['Pay Now', 'Pay from Payroll'];

export type StaffClaimListView = 'open' | 'pending' | 'approved' | 'stopped' | 'posted' | 'all';

const VIEW_CLAUSE: Record<StaffClaimListView, string> = {
  open: "c.status = 'Open'",
  pending: "c.status = 'Pending Approval'",
  approved: "c.status = 'Approved' AND NOT c.posted AND NOT c.payment_stopped",
  stopped: 'c.payment_stopped AND NOT c.posted',
  posted: 'c.posted',
  all: 'TRUE',
};

const SELECT_CLAIM = `
  SELECT c.*, e.employee_no, e.first_name, e.last_name, e.job_title, b.code AS paying_bank_code, b.name AS paying_bank_name,
         COALESCE((SELECT SUM(l.amount) FROM staff_claim_line l WHERE l.claim_no = c.no), 0)::bigint AS total_amount,
         j.journal_no, (SELECT COUNT(*) FROM staff_claim_line l WHERE l.claim_no = c.no)::int AS lines
  FROM staff_claim c JOIN employee e ON e.id = c.employee_id
  LEFT JOIN bank_account b ON b.id = c.paying_bank_account_id
  LEFT JOIN journal j ON j.id = c.journal_id`;

export const listStaffClaims = (view: StaffClaimListView = 'all', search = ''): Promise<StaffClaimView[]> =>
  all<StaffClaimView>(
    `${SELECT_CLAIM} WHERE ${VIEW_CLAUSE[view]}
       AND (c.no ILIKE @like OR e.employee_no ILIKE @like OR e.first_name ILIKE @like OR e.last_name ILIKE @like OR c.description ILIKE @like)
     ORDER BY c.no DESC LIMIT 500`,
    { like: `%${String(search).trim()}%` },
  );

export const hasAnyStaffClaims = (view: StaffClaimListView = 'all'): Promise<boolean> => hasAnyRow('staff_claim c', VIEW_CLAUSE[view]);
export const getStaffClaim = (no: string): Promise<StaffClaimView | undefined> => one<StaffClaimView>(`${SELECT_CLAIM} WHERE c.no = ?`, no);

export const listStaffClaimLines = (no: string): Promise<StaffClaimLineView[]> =>
  all<StaffClaimLineView>(
    'SELECT l.*, a.code AS gl_account_code, a.name AS gl_account_name FROM staff_claim_line l JOIN gl_account a ON a.id = l.gl_account_id WHERE l.claim_no = ? ORDER BY l.line_no', no);

export async function getStaffClaimDetail(no: string): Promise<StaffClaimDetail | undefined> {
  const head = await getStaffClaim(no);
  if (!head) return undefined;
  return { ...head, line_items: await listStaffClaimLines(no) };
}

/* ------------------------------------------------------------- create / edit */

export interface StaffClaimLineInput { glAccountId: number; narration?: string | null; expenseDate?: IsoDate | null; receiptRef?: string | null; quantity?: number; unitCost?: Cents; amount: Cents }
export interface StaffClaimInput {
  employeeId: number;
  claimDate: IsoDate;
  description: string;
  justification?: string | null;
  settlement?: StaffClaimSettlement;
  payingBankAccountId?: number | null;
  payModeCode?: string | null;
  paymentTxNo?: string | null;
  lines: StaffClaimLineInput[];
}

async function assertInput(input: StaffClaimInput): Promise<void> {
  const e = await one<{ employee_no: string; status: string }>('SELECT employee_no, status FROM employee WHERE id = ?', input.employeeId);
  if (!e) throw new AppError('Employee not found', 'NOT_FOUND');
  if (!['ACTIVE', 'ON_LEAVE'].includes(e.status)) throw new AppError(`${e.employee_no} is not an active employee`, 'VALIDATION');
  if (!input.claimDate) throw new AppError('A claim date is required', 'VALIDATION');
  if (!input.description?.trim()) throw new AppError('Describe what is being claimed', 'VALIDATION');
  if (input.settlement && !STAFF_CLAIM_SETTLEMENTS.includes(input.settlement)) throw new AppError('Choose Pay Now or Pay from Payroll', 'VALIDATION');
  if (!input.lines?.length) throw new AppError('Add at least one line — what was spent', 'VALIDATION');
  for (const l of input.lines) {
    if (!(l.amount > 0)) throw new AppError('Every line needs an amount greater than zero', 'VALIDATION');
    const a = await one<{ is_postable: number; status: string; no_direct_posting: number; code: string }>('SELECT is_postable, status, no_direct_posting, code FROM gl_account WHERE id = ?', l.glAccountId);
    if (!a || !a.is_postable || a.status !== 'ACTIVE') throw new AppError('Every line needs an active posting G/L account', 'VALIDATION');
    if (a.no_direct_posting) throw new AppError(`G/L account ${a.code} is a subledger control account`, 'VALIDATION');
  }
  if (input.payingBankAccountId) {
    const b = await one<{ status: string; blocked: number }>('SELECT status, blocked FROM bank_account WHERE id = ?', input.payingBankAccountId);
    if (!b || b.status !== 'ACTIVE' || b.blocked) throw new AppError('Pick an active paying bank account', 'VALIDATION');
  }
}

async function replaceLines(no: string, lines: StaffClaimLineInput[]): Promise<void> {
  await run('DELETE FROM staff_claim_line WHERE claim_no = ?', no);
  let lineNo = 10000;
  for (const l of lines) {
    await run(
      'INSERT INTO staff_claim_line (claim_no, line_no, gl_account_id, narration, expense_date, receipt_ref, quantity, unit_cost, amount) VALUES (?,?,?,?,?,?,?,?,?)',
      no, lineNo, l.glAccountId, l.narration?.trim() || null, l.expenseDate || null, l.receiptRef?.trim() || null,
      Math.max(1, Math.round(l.quantity ?? 1)), Math.round(l.unitCost ?? 0), Math.round(l.amount),
    );
    lineNo += 10000;
  }
}

export async function createStaffClaim(input: StaffClaimInput, user: Actor): Promise<{ no: string }> {
  await assertInput(input);
  const no = await nextSequence('STAFF_CLAIM');
  await tx(async () => {
    await run(
      `INSERT INTO staff_claim (no, employee_id, claim_date, description, justification, settlement, paying_bank_account_id, pay_mode_code, payment_tx_no, created_at, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      no, input.employeeId, input.claimDate, input.description.trim(), input.justification?.trim() || null, input.settlement ?? 'Pay Now',
      input.payingBankAccountId ?? null, input.payModeCode?.trim() || null, input.paymentTxNo?.trim() || null, new Date().toISOString(), user.username,
    );
    await stampEmployeeDimensions('staff_claim', no);
    await replaceLines(no, input.lines);
  });
  await audit(user, 'STAFF_CLAIM_CREATE', 'staff_claim', no, {});
  return { no };
}

async function editable(no: string, user: Actor): Promise<StaffClaim> {
  const c = await one<StaffClaim>('SELECT * FROM staff_claim WHERE no = ?', no);
  if (!c) throw new AppError('Staff claim not found', 'NOT_FOUND');
  if (c.status !== 'Open' || c.posted) throw new AppError('Only an open claim can be changed', 'VALIDATION');
  if (c.created_by !== user.username) throw new AppError('Only the person who raised this claim can change it', 'NOT_CREATOR');
  return c;
}

export async function updateStaffClaim(no: string, input: StaffClaimInput, user: Actor): Promise<void> {
  await editable(no, user);
  await assertInput(input);
  await tx(async () => {
    await run(
      `UPDATE staff_claim SET employee_id = ?, claim_date = ?, description = ?, justification = ?, settlement = ?, paying_bank_account_id = ?, pay_mode_code = ?, payment_tx_no = ? WHERE no = ?`,
      input.employeeId, input.claimDate, input.description.trim(), input.justification?.trim() || null, input.settlement ?? 'Pay Now',
      input.payingBankAccountId ?? null, input.payModeCode?.trim() || null, input.paymentTxNo?.trim() || null, no,
    );
    await stampEmployeeDimensions('staff_claim', no);
    await replaceLines(no, input.lines);
  });
  await audit(user, 'STAFF_CLAIM_UPDATE', 'staff_claim', no, {});
}

export async function deleteStaffClaim(no: string, user: Actor): Promise<void> {
  await editable(no, user);
  await run('DELETE FROM staff_claim WHERE no = ?', no);
  await audit(user, 'STAFF_CLAIM_DELETE', 'staff_claim', no, {});
}

/** Pag52203468 "Payment details" — settable on an approved claim before it is posted. */
export async function setStaffClaimPayment(no: string, input: Pick<StaffClaimInput, 'settlement' | 'payingBankAccountId' | 'payModeCode' | 'paymentTxNo'>, user: Actor): Promise<void> {
  const c = await one<StaffClaim>('SELECT * FROM staff_claim WHERE no = ?', no);
  if (!c) throw new AppError('Staff claim not found', 'NOT_FOUND');
  if (c.posted) throw new AppError('This claim has been posted', 'VALIDATION');
  if (input.settlement && !STAFF_CLAIM_SETTLEMENTS.includes(input.settlement)) throw new AppError('Choose Pay Now or Pay from Payroll', 'VALIDATION');
  await run('UPDATE staff_claim SET settlement = ?, paying_bank_account_id = ?, pay_mode_code = ?, payment_tx_no = ? WHERE no = ?',
    input.settlement ?? c.settlement, input.payingBankAccountId ?? null, input.payModeCode?.trim() || null, input.paymentTxNo?.trim() || null, no);
  await audit(user, 'STAFF_CLAIM_PAYMENT_SET', 'staff_claim', no, {});
}

/* -------------------------------------------------------------- maker-checker */

export async function submitStaffClaim(no: string, user: Actor): Promise<{ autoApproved: boolean }> {
  const c = await getStaffClaim(no);
  if (!c) throw new AppError('Staff claim not found', 'NOT_FOUND');
  if (c.status !== 'Open') throw new AppError('Only an open claim can be sent for approval', 'VALIDATION');
  if (!(c.total_amount > 0)) throw new AppError('The claim has no amount', 'VALIDATION');
  const matched = await findMatchingWorkflow('STAFF_CLAIM', await pickConditionFields('STAFF_CLAIM', { ...c, amount: c.total_amount }));
  if (!matched) throw new AppError('There is no enabled workflow for this document', 'NO_WORKFLOW');
  await tx(async () => {
    await run("UPDATE staff_claim SET status = 'Pending Approval' WHERE no = ?", no);
    await startWorkflow(matched.workflow, matched.steps, { documentType: 'STAFF_CLAIM', entityId: no, requestedBy: user.username, amount: Number(c.total_amount) });
  });
  const after = await one<{ status: string }>('SELECT status FROM staff_claim WHERE no = ?', no);
  return { autoApproved: after?.status === 'Approved' };
}

export async function cancelStaffClaimApproval(no: string, user: Actor): Promise<void> {
  const c = await one<Pick<StaffClaim, 'status' | 'created_by'>>('SELECT status, created_by FROM staff_claim WHERE no = ?', no);
  if (!c) throw new AppError('Staff claim not found', 'NOT_FOUND');
  if (c.status !== 'Pending Approval') throw new AppError('Only a claim pending approval can be recalled', 'VALIDATION');
  const routed = await findPendingRoutedTask('STAFF_CLAIM', no);
  if ((routed?.requested_by ?? c.created_by) !== user.username) throw new AppError('Only the person who submitted this claim can recall it', 'NOT_REQUESTER');
  await run("UPDATE staff_claim SET status = 'Open' WHERE no = ?", no);
  await audit(user, 'STAFF_CLAIM_CANCEL_APPROVAL', 'staff_claim', no, {});
}

export async function approveStaffClaim(no: string, user: Actor): Promise<void> {
  const c = await one<StaffClaim>('SELECT * FROM staff_claim WHERE no = ?', no);
  if (!c) throw new AppError('Staff claim not found', 'NOT_FOUND');
  if (c.status !== 'Pending Approval') throw new AppError('Only a claim pending approval can be approved', 'VALIDATION');
  await run("UPDATE staff_claim SET status = 'Approved', decision_reason = NULL WHERE no = ?", no);
  await audit(user, 'STAFF_CLAIM_APPROVE', 'staff_claim', no, {});
}

export async function rejectStaffClaim(no: string, reason: string | null, user: Actor): Promise<void> {
  if (!reason?.trim()) throw new AppError('A reason is required to reject a claim', 'VALIDATION');
  const c = await one<StaffClaim>('SELECT * FROM staff_claim WHERE no = ?', no);
  if (!c) throw new AppError('Staff claim not found', 'NOT_FOUND');
  if (c.status !== 'Pending Approval') throw new AppError('Only a claim pending approval can be rejected', 'VALIDATION');
  await run("UPDATE staff_claim SET status = 'Open', decision_reason = ? WHERE no = ?", reason, no);
  await audit(user, 'STAFF_CLAIM_REJECT', 'staff_claim', no, { reason });
}

export async function reopenStaffClaim(no: string, user: Actor): Promise<void> {
  const c = await one<StaffClaim>('SELECT * FROM staff_claim WHERE no = ?', no);
  if (!c) throw new AppError('Staff claim not found', 'NOT_FOUND');
  if (c.status !== 'Approved' || c.posted) throw new AppError('Only an approved, unposted claim can be reopened', 'VALIDATION');
  await run("UPDATE staff_claim SET status = 'Open', payment_stopped = false WHERE no = ?", no);
  await audit(user, 'STAFF_CLAIM_REOPEN', 'staff_claim', no, {});
}

/** Pag52203471 "Stop Payment" / its reversal. */
export async function stopStaffClaimPayment(no: string, stop: boolean, reason: string | null, user: Actor): Promise<void> {
  const c = await one<StaffClaim>('SELECT * FROM staff_claim WHERE no = ?', no);
  if (!c) throw new AppError('Staff claim not found', 'NOT_FOUND');
  if (c.posted) throw new AppError('This claim has been posted', 'VALIDATION');
  if (stop && !reason?.trim()) throw new AppError('Give the reason the payment is stopped', 'VALIDATION');
  await run('UPDATE staff_claim SET payment_stopped = ?, stopped_at = ?, stopped_by = ?, stop_reason = ? WHERE no = ?',
    stop, stop ? new Date().toISOString() : null, stop ? user.username : null, stop ? reason : null, no);
  await audit(user, stop ? 'STAFF_CLAIM_STOP' : 'STAFF_CLAIM_RELEASE', 'staff_claim', no, { reason });
}

/* ---------------------------------------------------------------------- post */

/** Cod52203432.PostStaffClaim. */
export async function postStaffClaim(no: string, user: Actor): Promise<{ journalNo: string; toPayroll: boolean }> {
  return tx(async () => {
    const c = await getStaffClaim(no);
    if (!c) throw new AppError('Staff claim not found', 'NOT_FOUND');
    if (c.posted) throw new AppError(`Staff claim ${no} has already been posted`, 'VALIDATION');
    if (c.status !== 'Approved') throw new AppError('Only an approved claim can be posted', 'VALIDATION');
    if (c.payment_stopped) throw new AppError(`Payment of this claim is stopped${c.stop_reason ? ` — ${c.stop_reason}` : ''}`, 'VALIDATION');
    const A = Number(c.total_amount);
    if (!(A > 0)) throw new AppError('The claim has no amount', 'VALIDATION');
    const lines = await listStaffClaimLines(no);
    const control = await imprestControlAccountId();
    const vd = await resolvePostingDate(user);
    const toPayroll = c.settlement === 'Pay from Payroll';

    const jl: JournalLineInput[] = [
      ...lines.map((l) => ({ account: l.gl_account_id, debit: Number(l.amount), credit: 0, narration: l.narration || c.description })),
      { account: control, debit: 0, credit: A, narration: `Staff claim ${no} — ${c.employee_no}` },
    ];
    if (!toPayroll) {
      if (!c.pay_mode_code) throw new AppError('Set the pay mode before posting', 'VALIDATION');
      if (!c.paying_bank_account_id) throw new AppError('Set the bank account the claim is paid from', 'VALIDATION');
      const b = await one<{ gl_account_id: number; code: string; balance: Cents; min_balance: Cents; status: string; blocked: number }>(
        'SELECT gl_account_id, code, balance, min_balance, status, blocked FROM bank_account WHERE id = ?', c.paying_bank_account_id);
      if (!b || b.status !== 'ACTIVE' || b.blocked) throw new AppError('Pick an active paying bank account', 'VALIDATION');
      if (A > Number(b.balance) - Number(b.min_balance)) throw new AppError(`There is not enough cash on ${b.code} for ${formatMoney(A)}`, 'VALIDATION');
      jl.push({ account: control, debit: A, credit: 0, narration: `Staff claim ${no} paid — ${c.employee_no}` });
      jl.push({ account: b.gl_account_id, debit: 0, credit: A, narration: `Staff claim ${no} paid — ${c.employee_no}`, bankDocumentType: 'Payment', bankDocumentNo: no });
    }
    const j = await postJournal({
      valueDate: vd, module: 'IMPREST', eventType: 'STAFF_CLAIM_POST', description: `Staff claim ${no} — ${c.description}`, reference: no,
      user, idempotencyKey: `STAFF-CLAIM-${no}`, lines: jl,
      globalDimension1Id: c.global_dimension_1_id, globalDimension2Id: c.global_dimension_2_id,
    });
    await writeEmployeeLedgerEntry({ employeeId: c.employee_id, entryType: 'STAFF_CLAIM', documentNo: no, postingDate: vd, amount: -A, description: `Staff claim ${no} — ${c.description}`, journalId: j.id, user });
    let payrollTransactionId: number | null = null;
    if (toPayroll) {
      const period = await one<{ id: number }>("SELECT id FROM payroll_period WHERE status = 'OPEN' ORDER BY start_date DESC LIMIT 1");
      if (!period) throw new AppError('There is no open payroll period to pay this claim through', 'VALIDATION');
      const codes = await ensureImprestPayrollCodes();
      const info = await run(
        `INSERT INTO employee_payroll_transaction (employee_id, transaction_code_id, payroll_period_id, amount_cents, temporary, notes, created_at, created_by)
         VALUES (?,?,?,?,true,?,?,?)`,
        c.employee_id, codes.claim, period.id, A, `Staff Claim ${no}`, new Date().toISOString(), user.username,
      );
      payrollTransactionId = Number(info.lastInsertRowid);
    } else {
      await writeEmployeeLedgerEntry({ employeeId: c.employee_id, entryType: 'CLAIM_PAID', documentNo: no, postingDate: vd, amount: A, description: `Staff claim ${no} paid`, journalId: j.id, user });
    }
    await run('UPDATE staff_claim SET posted = true, posted_at = ?, posted_by = ?, journal_id = ?, transferred_to_payroll = ?, payroll_transaction_id = ? WHERE no = ?',
      new Date().toISOString(), user.username, j.id, toPayroll, payrollTransactionId, no);
    await audit(user, 'STAFF_CLAIM_POST', 'staff_claim', no, { journalNo: j.journal_no, amount: A, toPayroll });
    return { journalNo: j.journal_no, toPayroll };
  });
}
