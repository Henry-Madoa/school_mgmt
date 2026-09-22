/*
 * Customer subledger primitives — Business Central Table 21 (Cust. Ledger Entry) + Table 379
 * (Detailed Cust. Ledg. Entry) and the payment-application engine every Receivables document
 * relies on.
 *
 *  - createCustLedgerEntry()   inserts a Cust. Ledger Entry + its "Initial Entry" detailed row.
 *                              Called by sales posting (Invoice / Credit Memo), cash receipts
 *                              (Payment) and reminder issuing (Reminder / Finance Charge Memo).
 *  - applyCustomerEntries()    applies a Payment / Credit Memo against open Invoice(s) (or an
 *                              Invoice against a Credit Memo): two "Application" detailed rows
 *                              per match, both remaining_amounts drawn toward zero, an entry
 *                              closed (open = 0) once it reaches zero. 'auto' = oldest-open-first.
 *                              Honours the payment discount when the payment is within its date.
 *  - unapplyCustomerEntry()    reverses an application (BC "Unapply Customer Entries").
 *  - recomputeCustomerBalance() SUM(open remaining_amount) -> customer.balance.
 *
 * Sign convention (BC): a Cust. Ledger Entry `amount` is Dr-customer-positive — an Invoice /
 * Reminder / Finance Charge is positive, a Payment / Credit Memo negative. `remaining_amount`
 * carries the same sign and trends toward zero as the entry is applied.
 */
import { one, all, run, audit } from './db.ts';
import { AppError } from './errors.ts';
import { postJournal } from './accounting.ts';
import { today } from './format.ts';
import type { Actor, Cents, CustLedgerDocumentType, IsoDate } from './types.ts';

export interface CreateCustLedgerEntryInput {
  customerId: number;
  postingDate: IsoDate;
  documentType: CustLedgerDocumentType;
  documentNo: string;
  description?: string | null;
  /** Dr-customer-positive: an Invoice is +, a Payment is −. In `currencyCode`. */
  amount: Cents;
  /** Transaction currency; omitted → LCY (KES). */
  currencyCode?: string | null;
  /** LCY per 1 unit of `currencyCode`; omitted → 1 (or the same as the document's journal). */
  currencyFactor?: number | null;
  dueDate?: IsoDate | null;
  pmtDiscountDate?: IsoDate | null;
  pmtDiscountPossible?: Cents;
  calculateInterest?: boolean;
  sourceType?: string | null;
  sourceId?: number | null;
  journalId?: number | null;
}

export async function createCustLedgerEntry(i: CreateCustLedgerEntryInput): Promise<number> {
  const amount = Math.round(i.amount);
  const currencyCode = i.currencyCode || 'KES';
  const factor = currencyCode === 'KES' ? 1 : (i.currencyFactor && i.currencyFactor > 0 ? i.currencyFactor : 1);
  const amountLcy = Math.round(amount * factor);
  const info = await run(
    `INSERT INTO cust_ledger_entry
       (customer_id, posting_date, document_type, document_no, description, amount, remaining_amount, original_amount,
        amount_lcy, remaining_amount_lcy, original_amount_lcy, currency_code, currency_factor,
        due_date, pmt_discount_date, original_pmt_disc_possible, open, positive, calculate_interest,
        source_type, source_id, journal_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    i.customerId, i.postingDate, i.documentType, i.documentNo, i.description ?? null,
    amount, amount, amount, amountLcy, amountLcy, amountLcy, currencyCode, factor,
    i.dueDate ?? null, i.pmtDiscountDate ?? null, Math.round(i.pmtDiscountPossible ?? 0),
    1, amount >= 0 ? 1 : 0, i.calculateInterest ? 1 : 0,
    i.sourceType ?? null, i.sourceId ?? null, i.journalId ?? null, new Date().toISOString(),
  );
  const entryId = Number(info.lastInsertRowid);
  await run(
    `INSERT INTO detailed_cust_ledger_entry
       (cust_ledger_entry_id, entry_type, posting_date, document_type, document_no, amount, amount_lcy, journal_id, created_at)
     VALUES (?, 'Initial Entry', ?,?,?,?,?,?,?)`,
    entryId, i.postingDate, i.documentType, i.documentNo, amount, amountLcy, i.journalId ?? null, new Date().toISOString(),
  );
  return entryId;
}

/* ---------------------------------------------------------------------- application */

interface LedgerRow {
  id: number; customer_id: number; posting_date: IsoDate; document_no: string;
  amount: Cents; remaining_amount: Cents; original_amount: Cents; remaining_amount_lcy: Cents;
  currency_code: string; currency_factor: number;
  pmt_discount_date: IsoDate | null; original_pmt_disc_possible: Cents;
  positive: 0 | 1; open: 0 | 1; customer_posting_group_code: string | null;
}

const LEDGER_COLS = `e.id, e.customer_id, e.posting_date, e.document_no, e.amount, e.remaining_amount, e.original_amount,
  e.remaining_amount_lcy, e.currency_code, e.currency_factor,
  e.pmt_discount_date, e.original_pmt_disc_possible, e.positive, e.open, c.customer_posting_group_code`;

async function loadLedger(entryId: number): Promise<LedgerRow> {
  const row = await one<LedgerRow>(
    `SELECT ${LEDGER_COLS} FROM cust_ledger_entry e JOIN customer c ON c.id = e.customer_id WHERE e.id = ?`,
    entryId,
  );
  if (!row) throw new AppError(`Cust. ledger entry ${entryId} not found`, 'NOT_FOUND');
  return row;
}

/** Currency realized gain/loss accounts for `code` (null for the base currency / no accounts set). */
async function realizedFxAccounts(code: string): Promise<{ gain: number; loss: number } | null> {
  const c = await one<{ realized_gains_account_id: number | null; realized_losses_account_id: number | null }>(
    'SELECT realized_gains_account_id, realized_losses_account_id FROM currency WHERE code = ?', code,
  );
  if (!c?.realized_gains_account_id || !c?.realized_losses_account_id) return null;
  return { gain: c.realized_gains_account_id, loss: c.realized_losses_account_id };
}

export interface ApplyCustomerEntriesInput {
  applyingEntryId: number;
  /** Specific target entries, or 'auto' for oldest-open-first up to the applying entry's remaining. */
  appliedTo: number[] | 'auto';
  postingDate: IsoDate;
}

/**
 * Applies `applyingEntryId` (a Payment or Credit Memo) against one or more opposite-sign open
 * entries. Returns the entries that were fully closed.
 */
export async function applyCustomerEntries(
  input: ApplyCustomerEntriesInput, user: Actor,
): Promise<{ closedEntryNos: string[]; discountTaken: Cents }> {
  const applying = await loadLedger(input.applyingEntryId);
  if (!applying.open) throw new AppError('That entry is already closed', 'VALIDATION');
  if (applying.remaining_amount === 0) throw new AppError('That entry has nothing left to apply', 'VALIDATION');

  let targets: LedgerRow[];
  if (input.appliedTo === 'auto') {
    targets = await all<LedgerRow>(
      `SELECT ${LEDGER_COLS}
       FROM cust_ledger_entry e JOIN customer c ON c.id = e.customer_id
       WHERE e.customer_id = ? AND e.open = 1 AND e.positive <> ? AND e.id <> ?
       ORDER BY e.due_date NULLS LAST, e.posting_date, e.id`,
      applying.customer_id, applying.positive, applying.id,
    );
  } else {
    targets = [];
    for (const id of input.appliedTo) targets.push(await loadLedger(id));
  }

  let remaining = applying.remaining_amount; // signed; opposite sign to targets
  let discountTaken = 0;
  const closed: string[] = [];
  const now = new Date().toISOString();

  for (const t of targets) {
    if (remaining === 0) break;
    if (!t.open) continue;
    if (t.customer_id !== applying.customer_id) throw new AppError('Entries must belong to the same customer to be applied', 'VALIDATION');
    if (t.positive === applying.positive) throw new AppError('Can only apply entries of opposite sign (a payment against an invoice)', 'VALIDATION');

    // Payment discount: if the applying entry is a payment dated on/before this invoice's
    // pmt_discount_date, and the payment covers (remaining − discount), take the discount.
    let discount = 0;
    if (applying.positive === 0 && t.positive === 1 && t.pmt_discount_date && applying.posting_date <= t.pmt_discount_date
      && t.original_pmt_disc_possible > 0 && Math.abs(t.remaining_amount) === t.original_amount) {
      discount = Math.min(t.original_pmt_disc_possible, Math.abs(t.remaining_amount));
    }

    const targetOwed = Math.abs(t.remaining_amount) - discount; // what the payment must cover to clear it
    const paymentAvailable = Math.abs(remaining);
    const applied = Math.min(targetOwed, paymentAvailable);

    // signed amounts for the detailed rows
    const applyingSign = applying.positive === 1 ? 1 : -1;
    const targetSign = t.positive === 1 ? 1 : -1;

    await run(
      `INSERT INTO detailed_cust_ledger_entry
         (cust_ledger_entry_id, entry_type, posting_date, document_type, document_no, amount, applied_cust_ledger_entry_id, created_at)
       VALUES (?, 'Application', ?, NULL, ?, ?, ?, ?)`,
      applying.id, input.postingDate, applying.document_no, -applyingSign * applied, t.id, now,
    );
    await run(
      `INSERT INTO detailed_cust_ledger_entry
         (cust_ledger_entry_id, entry_type, posting_date, document_type, document_no, amount, applied_cust_ledger_entry_id, created_at)
       VALUES (?, 'Application', ?, NULL, ?, ?, ?, ?)`,
      t.id, input.postingDate, t.document_no, -targetSign * (applied + discount), applying.id, now,
    );

    const newTargetRemaining = t.remaining_amount - targetSign * (applied + discount);
    const targetClosed = Math.abs(newTargetRemaining) < 1;

    // Multi-currency: track remaining_amount_lcy and realize exchange gain/loss on the settled
    // portion when the applying entry's rate differs from the entry it settles. Same-currency /
    // same-rate (every all-KES application) leaves this a no-op.
    const settledFcy = applied + discount;
    const newTargetRemainingLcy = targetClosed
      ? 0
      : t.remaining_amount_lcy - targetSign * Math.round(settledFcy * t.currency_factor);
    await run(
      `UPDATE cust_ledger_entry SET remaining_amount = ?, remaining_amount_lcy = ?, open = ?, closed_by_entry_no = ?, closed_at_date = ?
       WHERE id = ?`,
      targetClosed ? 0 : newTargetRemaining, newTargetRemainingLcy, targetClosed ? 0 : 1,
      targetClosed ? applying.id : null, targetClosed ? input.postingDate : null, t.id,
    );
    if (targetClosed) closed.push(t.document_no);

    if (applying.currency_factor !== t.currency_factor && applied > 0 && t.customer_posting_group_code) {
      const fx = Math.round(applied * applying.currency_factor) - Math.round(applied * t.currency_factor);
      const accts = await realizedFxAccounts(t.currency_code);
      const pg = await one<{ receivables_account_id: number }>(
        'SELECT receivables_account_id FROM customer_posting_group WHERE code = ?', t.customer_posting_group_code,
      );
      if (fx !== 0 && accts && pg) {
        const amt = Math.abs(fx);
        await postJournal({
          valueDate: input.postingDate, module: 'RECEIVABLES', eventType: 'REALIZED_FX',
          description: `Realized exchange ${fx > 0 ? 'gain' : 'loss'} ${t.document_no}`, reference: t.document_no, user,
          lines: fx > 0
            ? [{ account: pg.receivables_account_id, debit: amt, credit: 0, narration: `Realized FX ${t.document_no}` },
               { account: accts.gain, debit: 0, credit: amt, narration: `Realized FX ${t.document_no}` }]
            : [{ account: accts.loss, debit: amt, credit: 0, narration: `Realized FX ${t.document_no}` },
               { account: pg.receivables_account_id, debit: 0, credit: amt, narration: `Realized FX ${t.document_no}` }],
        });
        await run(
          `INSERT INTO detailed_cust_ledger_entry (cust_ledger_entry_id, entry_type, posting_date, document_no, amount, amount_lcy, applied_cust_ledger_entry_id, created_at)
           VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
          t.id, fx > 0 ? 'Realized Gain' : 'Realized Loss', input.postingDate, t.document_no, fx, applying.id, now,
        );
      }
    }

    // Reduce the applying entry's own LCY remainder by the LCY it settled (at its own rate).
    await run(
      'UPDATE cust_ledger_entry SET remaining_amount_lcy = remaining_amount_lcy - ? WHERE id = ?',
      applyingSign * Math.round(applied * applying.currency_factor), applying.id,
    );

    remaining -= applyingSign * applied;
    discountTaken += discount;

    // Post the payment discount to the posting group's discount accounts.
    if (discount > 0 && t.customer_posting_group_code) {
      const pg = await one<{ payment_disc_debit_account_id: number; receivables_account_id: number }>(
        'SELECT payment_disc_debit_account_id, receivables_account_id FROM customer_posting_group WHERE code = ?',
        t.customer_posting_group_code,
      );
      if (pg) {
        await postJournal({
          valueDate: input.postingDate, module: 'RECEIVABLES', eventType: 'PMT_DISCOUNT',
          description: `Payment discount ${t.document_no}`, reference: t.document_no, user,
          lines: [
            { account: pg.payment_disc_debit_account_id, debit: discount, credit: 0, narration: `Payment discount ${t.document_no}` },
            { account: pg.receivables_account_id, debit: 0, credit: discount, narration: `Payment discount ${t.document_no}` },
          ],
        });
      }
    }
    if (discount > 0) {
      await run(
        `INSERT INTO detailed_cust_ledger_entry (cust_ledger_entry_id, entry_type, posting_date, document_no, amount, applied_cust_ledger_entry_id, created_at)
         VALUES (?, 'Payment Discount', ?, ?, ?, ?, ?)`,
        t.id, input.postingDate, t.document_no, -targetSign * discount, applying.id, now,
      );
    }
  }

  const applyingClosed = Math.abs(remaining) < 1;
  await run(
    `UPDATE cust_ledger_entry SET remaining_amount = ?, remaining_amount_lcy = CASE WHEN ? THEN 0 ELSE remaining_amount_lcy END,
       open = ?, closed_by_entry_no = ?, closed_at_date = ? WHERE id = ?`,
    applyingClosed ? 0 : remaining, applyingClosed, applyingClosed ? 0 : 1,
    applyingClosed && closed.length ? applying.id : null, applyingClosed ? input.postingDate : null, applying.id,
  );

  await recomputeCustomerBalance(applying.customer_id);
  await audit(user, 'CUST_ENTRIES_APPLIED', 'cust_ledger_entry', applying.document_no, { closed, discountTaken });
  return { closedEntryNos: closed, discountTaken };
}

/** BC "Unapply Customer Entries" — reverses every Application detailed row that closed `entryId`
 *  (or was written by it), reopening the affected entries. Lightweight: no G/L reversal of the
 *  payment-discount posting (rare; documented). */
export async function unapplyCustomerEntry(entryId: number, user: Actor): Promise<void> {
  const entry = await loadLedger(entryId);
  const applications = await all<{ id: number; cust_ledger_entry_id: number; applied_cust_ledger_entry_id: number; amount: Cents }>(
    `SELECT id, cust_ledger_entry_id, applied_cust_ledger_entry_id, amount
     FROM detailed_cust_ledger_entry
     WHERE entry_type = 'Application' AND unapplied = 0
       AND (cust_ledger_entry_id = ? OR applied_cust_ledger_entry_id = ?)`,
    entryId, entryId,
  );
  if (!applications.length) throw new AppError('This entry has no applications to unapply', 'VALIDATION');

  const touched = new Set<number>();
  const now = new Date().toISOString();
  for (const a of applications) {
    await run('UPDATE detailed_cust_ledger_entry SET unapplied = 1 WHERE id = ?', a.id);
    // Reversing detailed row.
    await run(
      `INSERT INTO detailed_cust_ledger_entry (cust_ledger_entry_id, entry_type, posting_date, amount, applied_cust_ledger_entry_id, unapplied_by_entry_id, created_at)
       VALUES (?, 'Unapplied', ?, ?, ?, ?, ?)`,
      a.cust_ledger_entry_id, today(), -a.amount, a.applied_cust_ledger_entry_id, entryId, now,
    );
    touched.add(a.cust_ledger_entry_id);
  }

  for (const id of touched) {
    const sum = await one<{ initial: Cents; net: Cents }>(
      `SELECT
         COALESCE(SUM(CASE WHEN entry_type = 'Initial Entry' THEN amount ELSE 0 END), 0) AS initial,
         COALESCE(SUM(CASE WHEN unapplied = 0 THEN amount ELSE 0 END), 0) AS net
       FROM detailed_cust_ledger_entry WHERE cust_ledger_entry_id = ?`,
      id,
    );
    const remaining = sum?.net ?? 0;
    await run(
      `UPDATE cust_ledger_entry SET remaining_amount = ?, open = ?, closed_by_entry_no = NULL, closed_at_date = NULL WHERE id = ?`,
      Math.abs(remaining) < 1 ? 0 : remaining, Math.abs(remaining) < 1 ? 0 : 1, id,
    );
  }
  await recomputeCustomerBalance(entry.customer_id);
  await audit(user, 'CUST_ENTRY_UNAPPLIED', 'cust_ledger_entry', entry.document_no, { touched: [...touched] });
}

export async function recomputeCustomerBalance(customerId: number): Promise<Cents> {
  // customer.balance is the LCY roll-up — it must tie to the receivables control account (also
  // LCY). For an all-KES customer remaining_amount_lcy == remaining_amount, so this is unchanged.
  const row = await one<{ total: Cents }>(
    'SELECT COALESCE(SUM(remaining_amount_lcy), 0) AS total FROM cust_ledger_entry WHERE customer_id = ? AND open = 1',
    customerId,
  );
  const total = row?.total ?? 0;
  await run('UPDATE customer SET balance = ? WHERE id = ?', total, customerId);
  return total;
}

/** One open entry a receipt or payment line can be applied to. */
export interface OpenLedgerEntryOption {
  document_no: string;
  document_type: string;
  posting_date: IsoDate;
  due_date: IsoDate | null;
  remaining_amount: Cents;
}

/**
 * The customer's still-open invoices / charges, newest first — what the Applies-to picker on a
 * Cash Management Receipt line offers, and where its Remaining Amount comes from.
 *
 * Only `positive` entries qualify: an open credit memo or an unapplied payment is money owed the
 * OTHER way, and applying a receipt to one would be nonsense.
 */
export const listOpenCustomerEntries = (customerNo: string): Promise<OpenLedgerEntryOption[]> =>
  all<OpenLedgerEntryOption>(
    `SELECT e.document_no, e.document_type, e.posting_date, e.due_date, e.remaining_amount
     FROM cust_ledger_entry e JOIN customer c ON c.id = e.customer_id
     WHERE c.no = ? AND e.open = 1 AND e.positive = 1 AND e.remaining_amount <> 0
     ORDER BY e.due_date, e.id`,
    customerNo,
  );
