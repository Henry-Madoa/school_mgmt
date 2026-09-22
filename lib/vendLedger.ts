/*
 * Vendor subledger primitives — Business Central Table 25 (Vendor Ledger Entry) + Table 380
 * (Detailed Vendor Ledg. Entry) and the payment-application engine every Payables document
 * relies on. The mirror of lib/custLedger.ts.
 *
 *  - createVendorLedgerEntry()   inserts a Vendor Ledger Entry + its "Initial Entry" detailed row.
 *                                Called by purchase posting (Invoice / Credit Memo) and the
 *                                Payment Journal (Payment).
 *  - applyVendorEntries()        applies a Payment / Credit Memo against open Invoice(s): two
 *                                "Application" detailed rows per match, both remaining_amounts
 *                                drawn toward zero, an entry closed (open = 0) at zero.
 *                                'auto' = oldest-open-first. Honours the payment discount when the
 *                                payment is within its date.
 *  - unapplyVendorEntry()        reverses an application (BC "Unapply Vendor Entries").
 *  - recomputeVendorBalance()    SUM(open remaining_amount) -> vendor.balance.
 *
 * Sign convention (BC, same as Receivables): a Vendor Ledger Entry `amount` is Cr-vendor-positive
 * — an Invoice / Finance Charge is positive (the payable owed), a Payment / Credit Memo negative.
 * `remaining_amount` carries the same sign and trends toward zero as the entry is applied.
 */
import { one, all, run, audit } from './db.ts';
import { AppError } from './errors.ts';
import type { OpenLedgerEntryOption } from './custLedger.ts';
import { postJournal } from './accounting.ts';
import { today } from './format.ts';
import type { Actor, Cents, IsoDate, VendorLedgerDocumentType } from './types.ts';

export interface CreateVendorLedgerEntryInput {
  vendorId: number;
  postingDate: IsoDate;
  documentType: VendorLedgerDocumentType;
  documentNo: string;
  vendorInvoiceNo?: string | null;
  description?: string | null;
  /** Cr-vendor-positive: an Invoice is +, a Payment is −. In `currencyCode`. */
  amount: Cents;
  currencyCode?: string | null;
  currencyFactor?: number | null;
  dueDate?: IsoDate | null;
  pmtDiscountDate?: IsoDate | null;
  pmtDiscountPossible?: Cents;
  onHold?: string | null;
  sourceType?: string | null;
  sourceId?: number | null;
  journalId?: number | null;
}

export async function createVendorLedgerEntry(i: CreateVendorLedgerEntryInput): Promise<number> {
  const amount = Math.round(i.amount);
  const currencyCode = i.currencyCode || 'KES';
  const factor = currencyCode === 'KES' ? 1 : (i.currencyFactor && i.currencyFactor > 0 ? i.currencyFactor : 1);
  const amountLcy = Math.round(amount * factor);
  const info = await run(
    `INSERT INTO vendor_ledger_entry
       (vendor_id, posting_date, document_type, document_no, vendor_invoice_no, description, amount, remaining_amount,
        original_amount, amount_lcy, remaining_amount_lcy, original_amount_lcy, currency_code, currency_factor,
        due_date, pmt_discount_date, original_pmt_disc_possible, open, positive, on_hold,
        source_type, source_id, journal_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    i.vendorId, i.postingDate, i.documentType, i.documentNo, i.vendorInvoiceNo ?? null, i.description ?? null,
    amount, amount, amount, amountLcy, amountLcy, amountLcy, currencyCode, factor,
    i.dueDate ?? null, i.pmtDiscountDate ?? null, Math.round(i.pmtDiscountPossible ?? 0),
    1, amount >= 0 ? 1 : 0, i.onHold ?? null,
    i.sourceType ?? null, i.sourceId ?? null, i.journalId ?? null, new Date().toISOString(),
  );
  const entryId = Number(info.lastInsertRowid);
  await run(
    `INSERT INTO detailed_vendor_ledger_entry
       (vendor_ledger_entry_id, entry_type, posting_date, document_type, document_no, amount, amount_lcy, journal_id, created_at)
     VALUES (?, 'Initial Entry', ?,?,?,?,?,?,?)`,
    entryId, i.postingDate, i.documentType, i.documentNo, amount, amountLcy, i.journalId ?? null, new Date().toISOString(),
  );
  return entryId;
}

/* ---------------------------------------------------------------------- application */

interface LedgerRow {
  id: number; vendor_id: number; posting_date: IsoDate; document_no: string;
  amount: Cents; remaining_amount: Cents; original_amount: Cents; remaining_amount_lcy: Cents;
  currency_code: string; currency_factor: number;
  pmt_discount_date: IsoDate | null; original_pmt_disc_possible: Cents;
  positive: 0 | 1; open: 0 | 1; vendor_posting_group_code: string | null;
}

const LEDGER_COLS = `e.id, e.vendor_id, e.posting_date, e.document_no, e.amount, e.remaining_amount, e.original_amount,
  e.remaining_amount_lcy, e.currency_code, e.currency_factor,
  e.pmt_discount_date, e.original_pmt_disc_possible, e.positive, e.open, v.vendor_posting_group_code`;

async function loadLedger(entryId: number): Promise<LedgerRow> {
  const row = await one<LedgerRow>(
    `SELECT ${LEDGER_COLS} FROM vendor_ledger_entry e JOIN vendor v ON v.id = e.vendor_id WHERE e.id = ?`,
    entryId,
  );
  if (!row) throw new AppError(`Vendor ledger entry ${entryId} not found`, 'NOT_FOUND');
  return row;
}

async function realizedFxAccounts(code: string): Promise<{ gain: number; loss: number } | null> {
  const c = await one<{ realized_gains_account_id: number | null; realized_losses_account_id: number | null }>(
    'SELECT realized_gains_account_id, realized_losses_account_id FROM currency WHERE code = ?', code,
  );
  if (!c?.realized_gains_account_id || !c?.realized_losses_account_id) return null;
  return { gain: c.realized_gains_account_id, loss: c.realized_losses_account_id };
}

export interface ApplyVendorEntriesInput {
  applyingEntryId: number;
  /** Specific target entries, or 'auto' for oldest-open-first up to the applying entry's remaining. */
  appliedTo: number[] | 'auto';
  postingDate: IsoDate;
}

/**
 * Applies `applyingEntryId` (a Payment or Credit Memo) against one or more opposite-sign open
 * entries. Returns the entries that were fully closed.
 */
export async function applyVendorEntries(
  input: ApplyVendorEntriesInput, user: Actor,
): Promise<{ closedEntryNos: string[]; discountTaken: Cents }> {
  const applying = await loadLedger(input.applyingEntryId);
  if (!applying.open) throw new AppError('That entry is already closed', 'VALIDATION');
  if (applying.remaining_amount === 0) throw new AppError('That entry has nothing left to apply', 'VALIDATION');

  let targets: LedgerRow[];
  if (input.appliedTo === 'auto') {
    targets = await all<LedgerRow>(
      `SELECT ${LEDGER_COLS}
       FROM vendor_ledger_entry e JOIN vendor v ON v.id = e.vendor_id
       WHERE e.vendor_id = ? AND e.open = 1 AND e.positive <> ? AND e.id <> ?
       ORDER BY e.due_date NULLS LAST, e.posting_date, e.id`,
      applying.vendor_id, applying.positive, applying.id,
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
    if (t.vendor_id !== applying.vendor_id) throw new AppError('Entries must belong to the same vendor to be applied', 'VALIDATION');
    if (t.positive === applying.positive) throw new AppError('Can only apply entries of opposite sign (a payment against an invoice)', 'VALIDATION');

    // Payment discount: if the applying entry is a payment dated on/before this invoice's
    // pmt_discount_date, and it still has its full balance, take the discount.
    let discount = 0;
    if (applying.positive === 0 && t.positive === 1 && t.pmt_discount_date && applying.posting_date <= t.pmt_discount_date
      && t.original_pmt_disc_possible > 0 && Math.abs(t.remaining_amount) === t.original_amount) {
      discount = Math.min(t.original_pmt_disc_possible, Math.abs(t.remaining_amount));
    }

    const targetOwed = Math.abs(t.remaining_amount) - discount;
    const paymentAvailable = Math.abs(remaining);
    const applied = Math.min(targetOwed, paymentAvailable);

    const applyingSign = applying.positive === 1 ? 1 : -1;
    const targetSign = t.positive === 1 ? 1 : -1;

    await run(
      `INSERT INTO detailed_vendor_ledger_entry
         (vendor_ledger_entry_id, entry_type, posting_date, document_type, document_no, amount, applied_vendor_ledger_entry_id, created_at)
       VALUES (?, 'Application', ?, NULL, ?, ?, ?, ?)`,
      applying.id, input.postingDate, applying.document_no, -applyingSign * applied, t.id, now,
    );
    await run(
      `INSERT INTO detailed_vendor_ledger_entry
         (vendor_ledger_entry_id, entry_type, posting_date, document_type, document_no, amount, applied_vendor_ledger_entry_id, created_at)
       VALUES (?, 'Application', ?, NULL, ?, ?, ?, ?)`,
      t.id, input.postingDate, t.document_no, -targetSign * (applied + discount), applying.id, now,
    );

    const newTargetRemaining = t.remaining_amount - targetSign * (applied + discount);
    const targetClosed = Math.abs(newTargetRemaining) < 1;
    const settledFcy = applied + discount;
    const newTargetRemainingLcy = targetClosed
      ? 0
      : t.remaining_amount_lcy - targetSign * Math.round(settledFcy * t.currency_factor);
    await run(
      `UPDATE vendor_ledger_entry SET remaining_amount = ?, remaining_amount_lcy = ?, open = ?, closed_by_entry_no = ?, closed_at_date = ?
       WHERE id = ?`,
      targetClosed ? 0 : newTargetRemaining, newTargetRemainingLcy,
      targetClosed ? 0 : 1, targetClosed ? applying.id : null, targetClosed ? input.postingDate : null, t.id,
    );
    if (targetClosed) closed.push(t.document_no);

    if (applying.currency_factor !== t.currency_factor && applied > 0 && t.vendor_posting_group_code) {
      const fx = Math.round(applied * applying.currency_factor) - Math.round(applied * t.currency_factor);
      const accts = await realizedFxAccounts(t.currency_code);
      const pg = await one<{ payables_account_id: number }>(
        'SELECT payables_account_id FROM vendor_posting_group WHERE code = ?', t.vendor_posting_group_code,
      );
      if (fx !== 0 && accts && pg) {
        const amt = Math.abs(fx);
        // A payable settled at a lower LCY than booked is a gain (Dr payables / Cr gain).
        await postJournal({
          valueDate: input.postingDate, module: 'PAYABLES', eventType: 'REALIZED_FX',
          description: `Realized exchange ${fx < 0 ? 'gain' : 'loss'} ${t.document_no}`, reference: t.document_no, user,
          lines: fx < 0
            ? [{ account: pg.payables_account_id, debit: amt, credit: 0, narration: `Realized FX ${t.document_no}` },
               { account: accts.gain, debit: 0, credit: amt, narration: `Realized FX ${t.document_no}` }]
            : [{ account: accts.loss, debit: amt, credit: 0, narration: `Realized FX ${t.document_no}` },
               { account: pg.payables_account_id, debit: 0, credit: amt, narration: `Realized FX ${t.document_no}` }],
        });
        await run(
          `INSERT INTO detailed_vendor_ledger_entry (vendor_ledger_entry_id, entry_type, posting_date, document_no, amount, amount_lcy, applied_vendor_ledger_entry_id, created_at)
           VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
          t.id, fx < 0 ? 'Realized Gain' : 'Realized Loss', input.postingDate, t.document_no, fx, applying.id, now,
        );
      }
    }
    await run(
      'UPDATE vendor_ledger_entry SET remaining_amount_lcy = remaining_amount_lcy - ? WHERE id = ?',
      applyingSign * Math.round(applied * applying.currency_factor), applying.id,
    );

    remaining -= applyingSign * applied;
    discountTaken += discount;

    // Post the payment discount received: Dr Payables (clears the full liability), Cr the
    // discount-received income account on the posting group.
    if (discount > 0 && t.vendor_posting_group_code) {
      const pg = await one<{ payment_disc_credit_account_id: number; payables_account_id: number }>(
        'SELECT payment_disc_credit_account_id, payables_account_id FROM vendor_posting_group WHERE code = ?',
        t.vendor_posting_group_code,
      );
      if (pg) {
        await postJournal({
          valueDate: input.postingDate, module: 'PAYABLES', eventType: 'PMT_DISCOUNT',
          description: `Payment discount ${t.document_no}`, reference: t.document_no, user,
          lines: [
            { account: pg.payables_account_id, debit: discount, credit: 0, narration: `Payment discount ${t.document_no}` },
            { account: pg.payment_disc_credit_account_id, debit: 0, credit: discount, narration: `Payment discount ${t.document_no}` },
          ],
        });
      }
    }
    if (discount > 0) {
      await run(
        `INSERT INTO detailed_vendor_ledger_entry (vendor_ledger_entry_id, entry_type, posting_date, document_no, amount, applied_vendor_ledger_entry_id, created_at)
         VALUES (?, 'Payment Discount', ?, ?, ?, ?, ?)`,
        t.id, input.postingDate, t.document_no, -targetSign * discount, applying.id, now,
      );
    }
  }

  const applyingClosed = Math.abs(remaining) < 1;
  await run(
    `UPDATE vendor_ledger_entry SET remaining_amount = ?, remaining_amount_lcy = CASE WHEN ? THEN 0 ELSE remaining_amount_lcy END,
       open = ?, closed_by_entry_no = ?, closed_at_date = ? WHERE id = ?`,
    applyingClosed ? 0 : remaining, applyingClosed, applyingClosed ? 0 : 1,
    applyingClosed && closed.length ? applying.id : null, applyingClosed ? input.postingDate : null, applying.id,
  );

  await recomputeVendorBalance(applying.vendor_id);
  await audit(user, 'VENDOR_ENTRIES_APPLIED', 'vendor_ledger_entry', applying.document_no, { closed, discountTaken });
  return { closedEntryNos: closed, discountTaken };
}

/** BC "Unapply Vendor Entries" — reverses every Application detailed row that closed `entryId`
 *  (or was written by it), reopening the affected entries. */
export async function unapplyVendorEntry(entryId: number, user: Actor): Promise<void> {
  const entry = await loadLedger(entryId);
  const applications = await all<{ id: number; vendor_ledger_entry_id: number; applied_vendor_ledger_entry_id: number; amount: Cents }>(
    `SELECT id, vendor_ledger_entry_id, applied_vendor_ledger_entry_id, amount
     FROM detailed_vendor_ledger_entry
     WHERE entry_type = 'Application' AND unapplied = 0
       AND (vendor_ledger_entry_id = ? OR applied_vendor_ledger_entry_id = ?)`,
    entryId, entryId,
  );
  if (!applications.length) throw new AppError('This entry has no applications to unapply', 'VALIDATION');

  const touched = new Set<number>();
  const now = new Date().toISOString();
  for (const a of applications) {
    await run('UPDATE detailed_vendor_ledger_entry SET unapplied = 1 WHERE id = ?', a.id);
    await run(
      `INSERT INTO detailed_vendor_ledger_entry (vendor_ledger_entry_id, entry_type, posting_date, amount, applied_vendor_ledger_entry_id, unapplied_by_entry_id, created_at)
       VALUES (?, 'Unapplied', ?, ?, ?, ?, ?)`,
      a.vendor_ledger_entry_id, today(), -a.amount, a.applied_vendor_ledger_entry_id, entryId, now,
    );
    touched.add(a.vendor_ledger_entry_id);
  }

  for (const id of touched) {
    const sum = await one<{ net: Cents }>(
      `SELECT COALESCE(SUM(CASE WHEN unapplied = 0 THEN amount ELSE 0 END), 0) AS net
       FROM detailed_vendor_ledger_entry WHERE vendor_ledger_entry_id = ?`,
      id,
    );
    const remaining = sum?.net ?? 0;
    await run(
      `UPDATE vendor_ledger_entry SET remaining_amount = ?, open = ?, closed_by_entry_no = NULL, closed_at_date = NULL WHERE id = ?`,
      Math.abs(remaining) < 1 ? 0 : remaining, Math.abs(remaining) < 1 ? 0 : 1, id,
    );
  }
  await recomputeVendorBalance(entry.vendor_id);
  await audit(user, 'VENDOR_ENTRY_UNAPPLIED', 'vendor_ledger_entry', entry.document_no, { touched: [...touched] });
}

export async function recomputeVendorBalance(vendorId: number): Promise<Cents> {
  // vendor.balance is the LCY roll-up (ties to the payables control account, also LCY). For an
  // all-KES vendor remaining_amount_lcy == remaining_amount, so this is unchanged.
  const row = await one<{ total: Cents }>(
    'SELECT COALESCE(SUM(remaining_amount_lcy), 0) AS total FROM vendor_ledger_entry WHERE vendor_id = ? AND open = 1',
    vendorId,
  );
  const total = row?.total ?? 0;
  await run('UPDATE vendor SET balance = ? WHERE id = ?', total, vendorId);
  return total;
}

/**
 * The vendor's still-open invoices, oldest due first — what the Applies-to picker on a Payment
 * Voucher line offers, and where its Remaining Amount comes from. Mirrors
 * lib/custLedger.ts's listOpenCustomerEntries().
 */
export const listOpenVendorEntries = (vendorNo: string): Promise<OpenLedgerEntryOption[]> =>
  all<OpenLedgerEntryOption>(
    `SELECT e.document_no, e.document_type, e.posting_date, e.due_date, e.remaining_amount
     FROM vendor_ledger_entry e JOIN vendor v ON v.id = e.vendor_id
     WHERE v.no = ? AND e.open = 1 AND e.positive = 1 AND e.remaining_amount <> 0
     ORDER BY e.due_date, e.id`,
    vendorNo,
  );
