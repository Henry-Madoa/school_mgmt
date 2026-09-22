/*
 * M-Pesa — how money arriving through Safaricom reaches a student's fee account.
 *
 * Two ways in:
 *   STK push   the school office (or the Parent portal) asks a handset to pay a known amount for
 *              a known student; the row starts PENDING with the CheckoutRequestID and the
 *              callback (app/api/mpesa/stk) — or the MPESA_STK_QUERY job, if the callback never
 *              comes — settles it.
 *   C2B        a parent pays the paybill from their phone typing the admission number as the
 *              account; Safaricom confirms to app/api/mpesa/c2b/confirmation and the row is
 *              RECEIVED, matched by what they typed (admission no → fee account no → the
 *              guardian's phone) and, when the match is unambiguous, POSTED at once.
 *
 * Posting is the ordinary engine: a Receipt of type Customer against the student's fee account,
 * banked to the paybill bank account (School Setup), created and posted through lib/receipts.ts —
 * so the customer ledger, the bank ledger (for reconciliation against the paybill statement) and
 * the G/L all follow, and the guardian is told exactly as for a counter receipt. Anything that
 * cannot be matched, or whose posting is refused, stays RECEIVED on the M-Pesa screen with the
 * reason, for a person to allocate.
 *
 * A receipt number is Safaricom's own idempotency key (unique index): a replayed confirmation
 * is acknowledged and ignored.
 */
import { one, all, run, audit } from '../db.ts';
import { AppError } from '../errors.ts';
import { getOrg } from '../org.ts';
import { createReceipt, postReceipt } from '../receipts.ts';
import { today } from '../format.ts';
import { normalisePhone } from '../sms.ts';
import { mpesaConfig, stkPush, stkQuery, stkMetadata, type C2bPayload, type StkCallbackPayload } from './daraja.ts';
import type { Actor, Cents, MpesaStatus, MpesaTransaction, MpesaTransactionView } from '../types.ts';

export { mpesaConfigured, mpesaConfig, registerC2bUrls, callbackUrl } from './daraja.ts';

const SYSTEM: Actor = { id: 1, username: 'system' };
const nowIso = () => new Date().toISOString();

/* ------------------------------------------------------------------ reads */

export type MpesaView = 'unmatched' | 'pending' | 'posted' | 'failed' | 'all';
const VIEW_CLAUSE: Record<MpesaView, string> = {
  unmatched: "t.status = 'RECEIVED'", pending: "t.status = 'PENDING'", posted: "t.status = 'POSTED'", failed: "t.status IN ('FAILED', 'CANCELLED')", all: '1 = 1',
};

const SELECT_ROW = `
  SELECT t.*, s.admission_no, CASE WHEN s.id IS NULL THEN NULL ELSE s.first_name || ' ' || s.last_name END AS student_name,
         g.name AS grade_level_name, c.no AS customer_no, j.journal_no
  FROM mpesa_transaction t
  LEFT JOIN student s ON s.id = t.student_id
  LEFT JOIN grade_level g ON g.id = s.current_grade_level_id
  LEFT JOIN customer c ON c.id = t.customer_id
  LEFT JOIN journal j ON j.id = t.journal_id`;

export const listMpesaTransactions = (view: MpesaView = 'unmatched', search = '', limit = 300): Promise<MpesaTransactionView[]> =>
  all<MpesaTransactionView>(
    `${SELECT_ROW}
     WHERE ${VIEW_CLAUSE[view]}
       AND (COALESCE(t.mpesa_receipt, '') ILIKE @like OR COALESCE(t.phone, '') ILIKE @like OR COALESCE(t.account_reference, '') ILIKE @like
            OR COALESCE(t.payer_name, '') ILIKE @like OR COALESCE(s.admission_no, '') ILIKE @like OR COALESCE(s.first_name, '') ILIKE @like OR COALESCE(s.last_name, '') ILIKE @like)
     ORDER BY t.id DESC LIMIT @limit`,
    { like: `%${search.trim()}%`, limit },
  );
export const getMpesaTransaction = (id: number): Promise<MpesaTransactionView | undefined> => one<MpesaTransactionView>(`${SELECT_ROW} WHERE t.id = ?`, id);
export const hasAnyMpesaTransactions = async (view: MpesaView): Promise<boolean> =>
  !!(await one<{ x: number }>(`SELECT 1 AS x FROM mpesa_transaction t WHERE ${VIEW_CLAUSE[view]} LIMIT 1`));

export interface MpesaStats { unmatched: number; unmatched_amount: Cents; pending: number; posted_today: number; posted_today_amount: Cents }
export const mpesaStats = async (): Promise<MpesaStats> => {
  const r = await one<MpesaStats>(
    `SELECT COUNT(*) FILTER (WHERE status = 'RECEIVED') AS unmatched,
            COALESCE(SUM(amount) FILTER (WHERE status = 'RECEIVED'), 0) AS unmatched_amount,
            COUNT(*) FILTER (WHERE status = 'PENDING') AS pending,
            COUNT(*) FILTER (WHERE status = 'POSTED' AND posted_at >= ?) AS posted_today,
            COALESCE(SUM(amount) FILTER (WHERE status = 'POSTED' AND posted_at >= ?), 0) AS posted_today_amount
     FROM mpesa_transaction`, `${today()}T00:00:00.000Z`, `${today()}T00:00:00.000Z`,
  );
  return { unmatched: Number(r?.unmatched ?? 0), unmatched_amount: Number(r?.unmatched_amount ?? 0), pending: Number(r?.pending ?? 0), posted_today: Number(r?.posted_today ?? 0), posted_today_amount: Number(r?.posted_today_amount ?? 0) };
};

/** A student's M-Pesa history — for the Student 360 and the Parent portal. */
export const listStudentMpesa = (studentId: number, limit = 20): Promise<MpesaTransactionView[]> =>
  all<MpesaTransactionView>(`${SELECT_ROW} WHERE t.student_id = ? ORDER BY t.id DESC LIMIT ?`, studentId, limit);

/* ------------------------------------------------------------------ matching */

export interface MatchResult { studentId: number | null; customerId: number | null; note: string }

/**
 * What the payer typed, read the way a parent would write it: the admission number, or the fee
 * account (customer) number; failing those, the phone the money came from, if it belongs to a
 * guardian with exactly one child on the roll.
 */
export async function matchReference(reference: string | null, phone: string | null): Promise<MatchResult> {
  const ref = (reference ?? '').trim();
  if (ref) {
    const byAdmission = await one<{ id: number; customer_id: number | null }>('SELECT id, customer_id FROM student WHERE admission_no ILIKE ?', ref);
    if (byAdmission?.customer_id) return { studentId: byAdmission.id, customerId: byAdmission.customer_id, note: `Admission No. ${ref}` };
    const byCustomer = await one<{ id: number; customer_id: number }>('SELECT s.id, s.customer_id FROM student s JOIN customer c ON c.id = s.customer_id WHERE c.no ILIKE ?', ref);
    if (byCustomer) return { studentId: byCustomer.id, customerId: byCustomer.customer_id, note: `Fee account ${ref}` };
  }
  const number = phone ? normalisePhone(phone) : null;
  if (number) {
    const kids = await all<{ id: number; customer_id: number | null }>(
      `SELECT s.id, s.customer_id FROM guardian g JOIN student_guardian sg ON sg.guardian_id = g.id JOIN student s ON s.id = sg.student_id
       WHERE regexp_replace(COALESCE(g.phone, ''), '[^0-9]', '', 'g') LIKE '%' || ? AND s.status = 'ACTIVE' ORDER BY s.id`, number.replace(/\D/g, '').slice(-9),
    );
    if (kids.length === 1 && kids[0].customer_id) return { studentId: kids[0].id, customerId: kids[0].customer_id, note: `Guardian's phone ${number}${ref ? ` (reference "${ref}" not recognised)` : ''}` };
    if (kids.length > 1) return { studentId: null, customerId: null, note: `Phone ${number} has ${kids.length} students — pick which one${ref ? ` (reference "${ref}" not recognised)` : ''}` };
  }
  return { studentId: null, customerId: null, note: ref ? `Reference "${ref}" not recognised` : 'No reference given' };
}

/* ------------------------------------------------------------------ posting */

async function paybillBank(): Promise<{ id: number; gl_account_id: number; code: string }> {
  const org = await getOrg();
  if (!org?.mpesa_bank_account_id) throw new AppError('No M-Pesa paybill bank account is set up (Admin Centre → Setup Pool → School Setup)', 'VALIDATION');
  const bank = await one<{ id: number; gl_account_id: number; code: string }>("SELECT id, gl_account_id, code FROM bank_account WHERE id = ? AND status = 'ACTIVE'", org.mpesa_bank_account_id);
  if (!bank) throw new AppError('The M-Pesa bank account is missing or inactive', 'VALIDATION');
  return bank;
}

/** The Payment Method code the receipt is stamped with, if the setup has an M-Pesa one. */
async function mpesaPayMode(): Promise<string | null> {
  const m = await one<{ code: string }>("SELECT code FROM payment_method WHERE status = 'ACTIVE' AND (code ILIKE 'MPESA' OR code ILIKE 'M-PESA' OR description ILIKE '%pesa%') ORDER BY code LIMIT 1");
  return m?.code ?? null;
}

/** Post a RECEIVED transaction as a receipt on its matched fee account. Refusals are recorded, not thrown. */
export async function postMpesaTransaction(id: number, user: Actor = SYSTEM): Promise<{ ok: boolean; error?: string }> {
  const t = await one<MpesaTransaction>('SELECT * FROM mpesa_transaction WHERE id = ?', id);
  if (!t) throw new AppError('M-Pesa transaction not found', 'NOT_FOUND');
  if (t.status === 'POSTED') return { ok: true };
  if (t.status !== 'RECEIVED') throw new AppError(`Only a received payment can be posted (this one is ${t.status.toLowerCase()})`, 'VALIDATION');
  if (!t.customer_id) return { ok: false, error: t.match_note ?? 'Not matched to a student' };
  const amount = Number(t.amount);
  const label = `M-Pesa ${t.mpesa_receipt ?? `request ${t.checkout_request_id ?? t.id}`}${t.phone ? ` from ${t.phone}` : ''}${t.payer_name ? ` (${t.payer_name})` : ''}`;
  try {
    const bank = await paybillBank();
    const customer = await one<{ no: string; name: string }>('SELECT no, name FROM customer WHERE id = ?', t.customer_id);
    if (!customer) throw new AppError('The fee account no longer exists', 'NOT_FOUND');
    const { no } = await createReceipt({
      receiptType: 'Customer', bankAccountId: bank.id, postingDate: (t.transaction_time ?? nowIso()).slice(0, 10),
      payModeCode: await mpesaPayMode(), externalDocumentNo: t.mpesa_receipt ?? t.checkout_request_id ?? null,
      description: `${label} — fees for ${customer.name}`.slice(0, 250), receivedAmount: amount,
      lines: [{ accountNo: customer.no, description: 'School fees — M-Pesa', amount }],
    }, user);
    const posted = await postReceipt(no, user);
    const journalId = posted.journalNo ? (await one<{ id: number }>('SELECT id FROM journal WHERE journal_no = ?', posted.journalNo))?.id ?? null : null;
    await run("UPDATE mpesa_transaction SET status = 'POSTED', journal_id = ?, receipt_no = ?, posted_at = ?, posted_by = ?, match_note = NULL WHERE id = ?", journalId, no, nowIso(), user.username, id);
    await audit(user, 'MPESA_POST', 'mpesa_transaction', id, { amount, studentId: t.student_id, receiptNo: no, journalId });
    return { ok: true };
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 400);
    await run('UPDATE mpesa_transaction SET match_note = ? WHERE id = ?', `Posting refused: ${error}`, id);
    return { ok: false, error };
  }
}

/** A person points a RECEIVED payment at the right student, and it posts. */
export async function allocateMpesaTransaction(id: number, target: { studentId: number }, user: Actor): Promise<{ ok: boolean; error?: string }> {
  const t = await one<MpesaTransaction>('SELECT * FROM mpesa_transaction WHERE id = ?', id);
  if (!t) throw new AppError('M-Pesa transaction not found', 'NOT_FOUND');
  if (t.status !== 'RECEIVED') throw new AppError('Only a received, unposted payment can be allocated', 'VALIDATION');
  const s = await one<{ id: number; customer_id: number | null; admission_no: string }>('SELECT id, customer_id, admission_no FROM student WHERE id = ?', target.studentId);
  if (!s) throw new AppError('Student not found', 'NOT_FOUND');
  if (!s.customer_id) throw new AppError(`${s.admission_no} has no fee account yet — open the student's record to create it`, 'VALIDATION');
  await run('UPDATE mpesa_transaction SET student_id = ?, customer_id = ?, match_note = ? WHERE id = ?', s.id, s.customer_id, `Allocated by ${user.username}`, id);
  await audit(user, 'MPESA_ALLOCATE', 'mpesa_transaction', id, target);
  return postMpesaTransaction(id, user);
}

export async function cancelMpesaTransaction(id: number, reason: string, user: Actor): Promise<void> {
  if (!reason?.trim()) throw new AppError('A reason is required', 'VALIDATION');
  const t = await one<MpesaTransaction>('SELECT status FROM mpesa_transaction WHERE id = ?', id);
  if (!t) throw new AppError('M-Pesa transaction not found', 'NOT_FOUND');
  if (t.status === 'POSTED') throw new AppError('A posted payment cannot be cancelled here — reverse its journal instead', 'VALIDATION');
  await run("UPDATE mpesa_transaction SET status = 'CANCELLED', match_note = ? WHERE id = ?", `Cancelled by ${user.username}: ${reason.trim()}`, id);
  await audit(user, 'MPESA_CANCEL', 'mpesa_transaction', id, { reason });
}

/* ------------------------------------------------------------------ C2B (paybill) */

/** Daraja's TransTime "20260920141530" → ISO. */
const transTimeToIso = (s: string | null | undefined): string | null => {
  const m = String(s ?? '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+03:00` : null;
};

/** A paybill confirmation: record it (once), match it, and post what matches. */
export async function recordC2bPayment(p: C2bPayload): Promise<{ id: number; duplicate: boolean; posted: boolean; error?: string }> {
  const receipt = String(p.TransID ?? '').trim();
  if (!receipt) throw new AppError('Confirmation without a TransID', 'VALIDATION');
  const existing = await one<{ id: number; status: MpesaStatus }>('SELECT id, status FROM mpesa_transaction WHERE mpesa_receipt = ?', receipt);
  if (existing) return { id: existing.id, duplicate: true, posted: existing.status === 'POSTED' };
  const amount = Math.round(Number(p.TransAmount) * 100);
  const phone = normalisePhone(String(p.MSISDN ?? '')) ?? String(p.MSISDN ?? '');
  const name = [p.FirstName, p.MiddleName, p.LastName].filter(Boolean).join(' ') || null;
  const match = await matchReference(p.BillRefNumber ?? null, phone);
  const ins = await run(
    `INSERT INTO mpesa_transaction (kind, status, phone, payer_name, amount, account_reference, description, mpesa_receipt, transaction_time, raw_payload,
       student_id, customer_id, match_note, created_at, created_by)
     VALUES ('C2B', 'RECEIVED', ?,?,?,?,?,?,?,?,?,?,?,?, 'system')`,
    phone, name, amount, p.BillRefNumber ?? null, p.TransactionType ?? 'Pay Bill', receipt, transTimeToIso(p.TransTime), JSON.stringify(p).slice(0, 8000),
    match.studentId, match.customerId, match.note, nowIso(),
  );
  const id = Number(ins.lastInsertRowid);
  await audit(SYSTEM, 'MPESA_C2B_RECEIVED', 'mpesa_transaction', id, { receipt, amount, reference: p.BillRefNumber ?? null, match: match.note });
  const r = await postMpesaTransaction(id, SYSTEM);
  return { id, duplicate: false, posted: r.ok, error: r.error };
}

/* ------------------------------------------------------------------ STK push */

export interface StkRequestInput { phone: string; amount: Cents; studentId: number; description?: string | null }

/** Ask a handset to pay: the row is PENDING until the callback or the query job settles it. */
export async function requestStkPayment(input: StkRequestInput, user: Actor): Promise<{ id: number; customerMessage: string }> {
  const c = mpesaConfig();
  if (!c) throw new AppError('M-Pesa is not configured on this server (MPESA_CONSUMER_KEY / SECRET / SHORTCODE)', 'VALIDATION');
  const amount = Math.round(Number(input.amount));
  if (!(amount >= 100)) throw new AppError('The amount must be at least one shilling', 'VALIDATION');
  if (amount % 100) throw new AppError('M-Pesa takes whole shillings', 'VALIDATION');
  const phone = normalisePhone(input.phone);
  if (!phone) throw new AppError('A valid phone number is required', 'VALIDATION');
  const s = await one<{ id: number; customer_id: number | null; admission_no: string; status: string }>('SELECT id, customer_id, admission_no, status FROM student WHERE id = ?', input.studentId);
  if (!s) throw new AppError('Student not found', 'NOT_FOUND');
  if (!s.customer_id) throw new AppError(`${s.admission_no} has no fee account yet`, 'VALIDATION');
  const description = (input.description?.trim() || 'School fees').slice(0, 13);
  const res = await stkPush(c, { phone, amountShillings: amount / 100, accountReference: s.admission_no, description });
  const ins = await run(
    `INSERT INTO mpesa_transaction (kind, status, phone, amount, account_reference, description, merchant_request_id, checkout_request_id, result_desc,
       student_id, customer_id, match_note, created_at, created_by)
     VALUES ('STK', 'PENDING', ?,?,?,?,?,?,?,?,?,?,?,?)`,
    phone, amount, s.admission_no, description, res.MerchantRequestID, res.CheckoutRequestID, res.CustomerMessage ?? res.ResponseDescription,
    s.id, s.customer_id, `Requested by ${user.username}`, nowIso(), user.username,
  );
  const id = Number(ins.lastInsertRowid);
  await audit(user, 'MPESA_STK_REQUEST', 'mpesa_transaction', id, { phone, amount, student: s.admission_no });
  return { id, customerMessage: res.CustomerMessage ?? 'Payment request sent to the handset' };
}

/** The STK callback: success → RECEIVED (+ receipt, amount as paid) and post; anything else → FAILED. */
export async function handleStkCallback(p: StkCallbackPayload): Promise<{ id: number | null; posted: boolean }> {
  const cb = p.Body?.stkCallback;
  if (!cb?.CheckoutRequestID) throw new AppError('Malformed STK callback', 'VALIDATION');
  const t = await one<MpesaTransaction>('SELECT * FROM mpesa_transaction WHERE checkout_request_id = ?', cb.CheckoutRequestID);
  if (!t) return { id: null, posted: false };
  if (t.status !== 'PENDING') return { id: t.id, posted: t.status === 'POSTED' };
  if (Number(cb.ResultCode) === 0) {
    const md = stkMetadata(p);
    await run(
      `UPDATE mpesa_transaction SET status = 'RECEIVED', mpesa_receipt = ?, amount = COALESCE(?, amount), phone = COALESCE(?, phone), transaction_time = ?,
         result_code = ?, result_desc = ?, raw_payload = ? WHERE id = ?`,
      md.receipt, md.amount == null ? null : Math.round(md.amount * 100), md.phone ? normalisePhone(md.phone) : null, transTimeToIso(md.transactionDate),
      String(cb.ResultCode), cb.ResultDesc, JSON.stringify(p).slice(0, 8000), t.id,
    );
    const r = await postMpesaTransaction(t.id, SYSTEM);
    return { id: t.id, posted: r.ok };
  }
  await run("UPDATE mpesa_transaction SET status = 'FAILED', result_code = ?, result_desc = ?, raw_payload = ? WHERE id = ?", String(cb.ResultCode), cb.ResultDesc, JSON.stringify(p).slice(0, 8000), t.id);
  await audit(SYSTEM, 'MPESA_STK_FAILED', 'mpesa_transaction', t.id, { code: cb.ResultCode, desc: cb.ResultDesc });
  return { id: t.id, posted: false };
}

/** Ask Safaricom about one pending push (the screen's "Check status", and the job). */
export async function queryStkStatus(id: number): Promise<{ status: MpesaStatus; desc: string }> {
  const c = mpesaConfig();
  if (!c) throw new AppError('M-Pesa is not configured on this server', 'VALIDATION');
  const t = await one<MpesaTransaction>('SELECT * FROM mpesa_transaction WHERE id = ?', id);
  if (!t) throw new AppError('M-Pesa transaction not found', 'NOT_FOUND');
  if (t.status !== 'PENDING' || !t.checkout_request_id) return { status: t.status, desc: t.result_desc ?? '' };
  let q;
  try {
    q = await stkQuery(c, t.checkout_request_id);
  } catch (e) {
    // "The transaction is being processed" comes back as an error body — still pending.
    const msg = e instanceof Error ? e.message : String(e);
    if (/processed|processing/i.test(msg)) return { status: 'PENDING', desc: 'Still being processed' };
    throw e;
  }
  const code = String(q.ResultCode);
  if (code === '0') {
    // The query confirms payment but carries no receipt; the callback fills that in if it ever lands.
    await run("UPDATE mpesa_transaction SET status = 'RECEIVED', result_code = ?, result_desc = ?, match_note = COALESCE(match_note, '') || ' · confirmed by status query' WHERE id = ? AND status = 'PENDING'", code, q.ResultDesc, id);
    await postMpesaTransaction(id, SYSTEM);
    const after = await one<{ status: MpesaStatus }>('SELECT status FROM mpesa_transaction WHERE id = ?', id);
    return { status: after?.status ?? 'RECEIVED', desc: q.ResultDesc };
  }
  await run("UPDATE mpesa_transaction SET status = 'FAILED', result_code = ?, result_desc = ? WHERE id = ? AND status = 'PENDING'", code, q.ResultDesc, id);
  return { status: 'FAILED', desc: q.ResultDesc };
}

/** The job: pushes older than two minutes with no callback, up to a day old. */
export async function chasePendingStk(): Promise<{ checked: number; settled: number }> {
  if (!mpesaConfig()) return { checked: 0, settled: 0 };
  const rows = await all<{ id: number }>(
    "SELECT id FROM mpesa_transaction WHERE status = 'PENDING' AND kind = 'STK' AND created_at < ? AND created_at > ? ORDER BY id LIMIT 50",
    new Date(Date.now() - 2 * 60_000).toISOString(), new Date(Date.now() - 24 * 3_600_000).toISOString(),
  );
  let settled = 0;
  for (const { id } of rows) {
    try { if ((await queryStkStatus(id)).status !== 'PENDING') settled++; } catch (e) { console.warn('[mpesa] status query failed', id, e); }
  }
  // Anything older than a day with no answer is dead.
  await run("UPDATE mpesa_transaction SET status = 'FAILED', result_desc = 'No response from M-Pesa within 24 hours' WHERE status = 'PENDING' AND kind = 'STK' AND created_at < ?", new Date(Date.now() - 24 * 3_600_000).toISOString());
  return { checked: rows.length, settled };
}
