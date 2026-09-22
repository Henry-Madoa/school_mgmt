/*
 * Reminders and Finance Charge Memos — Business Central Reports 188 "Create Reminders" / 190
 * "Create Finance Charge Memos" plus the "Issue" action (BC Tables 295/296 and 302/303,
 * consolidated onto reminder_header / reminder_line with a status that flips Open -> Issued).
 *
 *  - createReminders()          drafts a Reminder for every customer with an open, overdue
 *                               Cust. Ledger Entry past its due date + the level's grace period.
 *                               Lines: one Reminder Line per overdue entry, an interest line
 *                               (when the level's Calculate Interest is set) and an
 *                               additional-fee line.
 *  - createFinanceChargeMemos() same idea, interest always calculated from the Finance Charge
 *                               Terms, no reminder levels.
 *  - issueReminder()            posts the interest + fee (Dr Receivables, Cr Service Charge /
 *                               Additional Fee accounts), writes a Cust. Ledger Entry, stamps
 *                               reminder_level on the reminded entries and flips status Issued.
 */
import { one, all, run, tx, nextSequence, audit, hasAnyRow } from './db.ts';
import { AppError } from './errors.ts';
import { postJournal } from './accounting.ts';
import { today } from './format.ts';
import { applyDateFormula, daysBetween } from './dateFormula.ts';
import { reminderLevelFor } from './receivablesSetup.ts';
import { createCustLedgerEntry, recomputeCustomerBalance } from './custLedger.ts';
import type {
  Actor, Cents, IsoDate, ReminderDetail, ReminderDocumentType, ReminderHeader, ReminderHeaderView, ReminderLine,
} from './types.ts';

export type ReminderView = 'open' | 'issued';

const SELECT_ROW = `
  SELECT rh.*, c.no AS customer_no, c.name AS customer_name
  FROM reminder_header rh JOIN customer c ON c.id = rh.customer_id`;

export const listReminders = (
  { documentType, view, search = '' }: { documentType: ReminderDocumentType; view?: ReminderView; search?: string },
): Promise<ReminderHeaderView[]> => all<ReminderHeaderView>(
  `${SELECT_ROW}
   WHERE rh.document_type = @docType
     AND (rh.no ILIKE @like OR c.no ILIKE @like OR c.name ILIKE @like)
     ${view === 'open' ? "AND rh.status = 'Open'" : view === 'issued' ? "AND rh.status = 'Issued'" : ''}
   ORDER BY rh.no DESC`,
  { docType: documentType, like: `%${String(search).trim()}%` },
);

export async function getReminder(no: string): Promise<ReminderDetail | undefined> {
  const header = await one<ReminderHeaderView>(`${SELECT_ROW} WHERE rh.no = ?`, no);
  if (!header) return undefined;
  const lines = await all<ReminderLine>('SELECT * FROM reminder_line WHERE reminder_header_id = ? ORDER BY line_no', header.id);
  return { ...header, lines };
}

export const hasAnyReminders = (documentType?: ReminderDocumentType): Promise<boolean> =>
  hasAnyRow('reminder_header rh', documentType ? `rh.document_type = '${documentType}'` : undefined);

/* --------------------------------------------------------------- create batch */

interface OverdueEntry {
  id: number; document_type: string; document_no: string; posting_date: IsoDate; due_date: IsoDate;
  remaining_amount: Cents; original_amount: Cents; reminder_level: number; calculate_interest: number;
}

async function overdueEntriesFor(customerId: number, asOf: IsoDate): Promise<OverdueEntry[]> {
  return all<OverdueEntry>(
    `SELECT id, document_type, document_no, posting_date, due_date, remaining_amount, original_amount,
            reminder_level, calculate_interest
     FROM cust_ledger_entry
     WHERE customer_id = ? AND open = 1 AND positive = 1 AND remaining_amount > 0
       AND due_date IS NOT NULL AND due_date < ?
     ORDER BY due_date, id`,
    customerId, asOf,
  );
}

export interface CreateRemindersInput {
  customerId?: number | null;
  documentDate?: IsoDate;
}

async function customersToProcess(customerId: number | null | undefined): Promise<{ id: number; no: string; reminder_terms_code: string | null; fin_charge_terms_code: string | null; customer_posting_group_code: string | null; blocked: string }[]> {
  if (customerId) {
    const c = await one<{ id: number; no: string; reminder_terms_code: string | null; fin_charge_terms_code: string | null; customer_posting_group_code: string | null; blocked: string }>(
      'SELECT id, no, reminder_terms_code, fin_charge_terms_code, customer_posting_group_code, blocked FROM customer WHERE id = ?', customerId,
    );
    return c ? [c] : [];
  }
  return all('SELECT id, no, reminder_terms_code, fin_charge_terms_code, customer_posting_group_code, blocked FROM customer ORDER BY no');
}

function interestOn(remaining: Cents, ratePctPerAnnum: number, days: number, periodDays: number): Cents {
  if (ratePctPerAnnum <= 0 || days <= 0) return 0;
  return Math.round(remaining * (ratePctPerAnnum / 100) * (days / periodDays));
}

export async function createReminders(input: CreateRemindersInput, user: Actor): Promise<{ created: number; skipped: number }> {
  const docDate = input.documentDate || today();
  const customers = await customersToProcess(input.customerId);
  let created = 0;
  let skipped = 0;

  for (const c of customers) {
    if (!c.reminder_terms_code) { skipped += 1; continue; }
    const terms = await one<{ code: string; max_no_of_reminders: number; min_amount: Cents }>(
      'SELECT code, max_no_of_reminders, min_amount FROM reminder_terms WHERE code = ?', c.reminder_terms_code,
    );
    if (!terms) { skipped += 1; continue; }
    const overdue = await overdueEntriesFor(c.id, docDate);
    if (!overdue.length) { skipped += 1; continue; }

    // Level = one past the highest reminder level already on those entries, capped.
    const priorLevel = Math.max(0, ...overdue.map((e) => e.reminder_level));
    const level = await reminderLevelFor(terms.code, priorLevel);
    if (!level) { skipped += 1; continue; }
    if (priorLevel >= terms.max_no_of_reminders) { skipped += 1; continue; }

    // Grace period: only entries whose due date + grace has passed.
    const eligible = overdue.filter((e) => applyDateFormula(e.due_date, level.grace_period) < docDate);
    if (!eligible.length) { skipped += 1; continue; }
    const remainingTotal = eligible.reduce((s, e) => s + e.remaining_amount, 0);
    if (remainingTotal < terms.min_amount) { skipped += 1; continue; }

    const fcTerms = c.fin_charge_terms_code
      ? await one<{ interest_rate: number; interest_period_days: number }>(
        'SELECT interest_rate, interest_period_days FROM finance_charge_terms WHERE code = ?', c.fin_charge_terms_code)
      : null;

    let interest = 0;
    if (level.calculate_interest && fcTerms) {
      for (const e of eligible) {
        interest += interestOn(e.remaining_amount, fcTerms.interest_rate, daysBetween(e.due_date, docDate), fcTerms.interest_period_days);
      }
    }
    const fee = Number(level.additional_fee) + Number(level.add_fee_per_line) * eligible.length;

    const no = await nextSequence('REMINDER');
    const dueDate = applyDateFormula(docDate, level.due_date_calculation);
    const header = await run(
      `INSERT INTO reminder_header
         (document_type, no, customer_id, posting_date, document_date, due_date, reminder_terms_code, reminder_level,
          customer_posting_group_code, remaining_amount, interest_amount, additional_fee, total_amount, created_at, created_by)
       VALUES ('Reminder', ?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      no, c.id, docDate, docDate, dueDate, terms.code, level.level_no, c.customer_posting_group_code,
      remainingTotal, interest, fee, remainingTotal + interest + fee, new Date().toISOString(), user.username,
    );
    await writeReminderLines(Number(header.lastInsertRowid), eligible, interest, fee, level.calculate_interest === 1);
    created += 1;
  }
  await audit(user, 'REMINDERS_CREATE', 'reminder_header', input.customerId ?? 'ALL', { created, skipped, docDate });
  return { created, skipped };
}

export async function createFinanceChargeMemos(input: CreateRemindersInput, user: Actor): Promise<{ created: number; skipped: number }> {
  const docDate = input.documentDate || today();
  const customers = await customersToProcess(input.customerId);
  let created = 0;
  let skipped = 0;

  for (const c of customers) {
    if (!c.fin_charge_terms_code) { skipped += 1; continue; }
    const fc = await one<{ code: string; interest_rate: number; interest_period_days: number; min_amount: Cents; additional_fee: Cents; grace_period: string; due_date_calculation: string; line_description: string }>(
      'SELECT code, interest_rate, interest_period_days, min_amount, additional_fee, grace_period, due_date_calculation, line_description FROM finance_charge_terms WHERE code = ?', c.fin_charge_terms_code,
    );
    if (!fc) { skipped += 1; continue; }
    const overdue = await overdueEntriesFor(c.id, docDate);
    const eligible = overdue.filter((e) => applyDateFormula(e.due_date, fc.grace_period) < docDate);
    if (!eligible.length) { skipped += 1; continue; }

    let interest = 0;
    for (const e of eligible) {
      interest += interestOn(e.remaining_amount, fc.interest_rate, daysBetween(e.due_date, docDate), fc.interest_period_days);
    }
    if (interest < fc.min_amount) { skipped += 1; continue; }
    const fee = Number(fc.additional_fee);
    const remainingTotal = eligible.reduce((s, e) => s + e.remaining_amount, 0);

    const no = await nextSequence('FIN_CHARGE_MEMO');
    const dueDate = applyDateFormula(docDate, fc.due_date_calculation);
    const header = await run(
      `INSERT INTO reminder_header
         (document_type, no, customer_id, posting_date, document_date, due_date, fin_charge_terms_code, reminder_level,
          customer_posting_group_code, remaining_amount, interest_amount, additional_fee, total_amount, created_at, created_by)
       VALUES ('Finance Charge Memo', ?,?,?,?,?,?,0,?,?,?,?,?,?,?)`,
      no, c.id, docDate, docDate, dueDate, fc.code, c.customer_posting_group_code,
      remainingTotal, interest, fee, interest + fee, new Date().toISOString(), user.username,
    );
    await writeReminderLines(Number(header.lastInsertRowid), eligible, interest, fee, true);
    created += 1;
  }
  await audit(user, 'FINANCE_CHARGE_MEMOS_CREATE', 'reminder_header', input.customerId ?? 'ALL', { created, skipped, docDate });
  return { created, skipped };
}

async function writeReminderLines(
  headerId: number, entries: OverdueEntry[], interest: Cents, fee: Cents, includeInterestLine: boolean,
): Promise<void> {
  let lineNo = 10000;
  for (const e of entries) {
    await run(
      `INSERT INTO reminder_line
         (reminder_header_id, line_no, type, cust_ledger_entry_id, entry_document_type, entry_document_no, due_date,
          original_amount, remaining_amount, description)
       VALUES (?,?, 'Reminder Line', ?,?,?,?,?,?,?)`,
      headerId, lineNo, e.id, e.document_type, e.document_no, e.due_date, e.original_amount, e.remaining_amount,
      `${e.document_type} ${e.document_no}`,
    );
    lineNo += 10000;
  }
  if (includeInterestLine && interest > 0) {
    await run(
      `INSERT INTO reminder_line (reminder_header_id, line_no, type, amount, description)
       VALUES (?,?, 'Line Fee', ?, 'Interest on overdue balance')`,
      headerId, lineNo, interest,
    );
    lineNo += 10000;
  }
  if (fee > 0) {
    await run(
      `INSERT INTO reminder_line (reminder_header_id, line_no, type, amount, description)
       VALUES (?,?, 'Line Fee', ?, 'Additional fee')`,
      headerId, lineNo, fee,
    );
  }
}

export async function deleteReminder(no: string, user: Actor): Promise<void> {
  const before = await one<Pick<ReminderHeader, 'status'>>('SELECT status FROM reminder_header WHERE no = ?', no);
  if (!before) throw new AppError('Reminder not found', 'NOT_FOUND');
  if (before.status !== 'Open') throw new AppError('Only an open reminder can be deleted', 'VALIDATION');
  await run('DELETE FROM reminder_header WHERE no = ?', no);
  await audit(user, 'REMINDER_DELETE', 'reminder_header', no, {});
}

/* ------------------------------------------------------------------- issue */

export async function issueReminder(no: string, user: Actor): Promise<{ journalNo: string | null; custLedgerEntryId: number | null }> {
  return tx(async () => {
    const header = await one<ReminderHeader>('SELECT * FROM reminder_header WHERE no = ?', no);
    if (!header) throw new AppError('Reminder not found', 'NOT_FOUND');
    if (header.status !== 'Open') throw new AppError('This reminder has already been issued', 'VALIDATION');

    const isFinCharge = header.document_type === 'Finance Charge Memo';
    const termsCode = isFinCharge ? header.fin_charge_terms_code : header.reminder_terms_code;
    const post = isFinCharge
      ? await one<{ post_interest: number; post_additional_fee: number }>(
        'SELECT post_interest, post_additional_fee FROM finance_charge_terms WHERE code = ?', termsCode)
      : await one<{ post_interest: number; post_additional_fee: number }>(
        'SELECT post_interest, post_additional_fee FROM reminder_terms WHERE code = ?', termsCode);

    const postInterest = (post?.post_interest ?? 0) === 1 && header.interest_amount > 0;
    const postFee = (post?.post_additional_fee ?? 0) === 1 && header.additional_fee > 0;
    const chargeTotal = (postInterest ? Number(header.interest_amount) : 0) + (postFee ? Number(header.additional_fee) : 0);

    let journalNo: string | null = null;
    let journalId: number | null = null;
    let custLedgerEntryId: number | null = null;

    if (chargeTotal > 0 && header.customer_posting_group_code) {
      const pg = await one<{ receivables_account_id: number; service_charge_account_id: number; additional_fee_account_id: number }>(
        'SELECT receivables_account_id, service_charge_account_id, additional_fee_account_id FROM customer_posting_group WHERE code = ?',
        header.customer_posting_group_code,
      );
      if (!pg) throw new AppError('Customer Posting Group setup is missing', 'VALIDATION');
      const lines = [
        { account: pg.receivables_account_id, debit: chargeTotal, credit: 0, narration: `${header.document_type} ${no}` },
      ];
      if (postInterest) lines.push({ account: pg.service_charge_account_id, debit: 0, credit: Number(header.interest_amount), narration: `${header.document_type} ${no} — interest` });
      if (postFee) lines.push({ account: pg.additional_fee_account_id, debit: 0, credit: Number(header.additional_fee), narration: `${header.document_type} ${no} — fee` });

      const j = await postJournal({
        valueDate: header.posting_date, module: 'RECEIVABLES',
        eventType: isFinCharge ? 'FINANCE_CHARGE_MEMO' : 'REMINDER',
        description: `${header.document_type} ${no}`, reference: no, user, idempotencyKey: `REMINDER-${no}`,
        lines,
      });
      journalNo = j.journal_no;
      journalId = j.id;

      custLedgerEntryId = await createCustLedgerEntry({
        customerId: header.customer_id, postingDate: header.posting_date,
        documentType: isFinCharge ? 'Finance Charge Memo' : 'Reminder',
        documentNo: no, description: `${header.document_type} ${no}`,
        amount: chargeTotal, dueDate: header.due_date,
        sourceType: isFinCharge ? 'Finance Charge' : 'Reminder', sourceId: header.id, journalId,
      });
      await recomputeCustomerBalance(header.customer_id);
    }

    // Stamp the reminded entries with this reminder's level.
    const remindedIds = await all<{ cust_ledger_entry_id: number }>(
      "SELECT cust_ledger_entry_id FROM reminder_line WHERE reminder_header_id = ? AND cust_ledger_entry_id IS NOT NULL", header.id,
    );
    for (const r of remindedIds) {
      await run(
        'UPDATE cust_ledger_entry SET reminder_level = GREATEST(reminder_level, ?), calculate_interest = 1 WHERE id = ?',
        header.reminder_level, r.cust_ledger_entry_id,
      );
    }

    await run(
      `UPDATE reminder_header SET status = 'Issued', journal_id = ?, cust_ledger_entry_id = ?, issued_at = ?, issued_by = ? WHERE no = ?`,
      journalId, custLedgerEntryId, new Date().toISOString(), user.username, no,
    );
    await audit(user, 'REMINDER_ISSUE', 'reminder_header', no, { journalNo, chargeTotal });
    return { journalNo, custLedgerEntryId };
  });
}
