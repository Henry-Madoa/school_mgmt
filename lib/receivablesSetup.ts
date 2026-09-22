/*
 * Receivables setup masters — Business Central Tables 92 (Customer Posting Group), 3 (Payment
 * Terms), 289 (Payment Method), 293/294 (Reminder Terms / Level), 5 (Finance Charge Terms) and
 * 311 (Sales & Receivables Setup). Structured like lib/fixedAssetsSetup.ts: `assertX`
 * validators, duplicate-code guards, `audit()`, INACTIVE instead of a hard delete.
 */
import { one, all, run, audit, hasAnyRow } from './db.ts';
import { AppError } from './errors.ts';
import { isValidDateFormula } from './dateFormula.ts';
import type {
  Actor, CustomerPostingGroup, CustomerPostingGroupView, FinanceChargeTerms, PaymentMethod,
  PaymentTerms, ReminderLevel, ReminderTerms, SalesReceivablesSetup,
} from './types.ts';

const norm = (v: unknown): string => String(v ?? '').trim();
const now = (): string => new Date().toISOString();

/* --------------------------------------------------------- Customer Posting Group */

const CPG_SELECT = `
  SELECT g.*,
         recv.code AS receivables_account_code, sc.code AS service_charge_account_code,
         af.code AS additional_fee_account_code, pdd.code AS payment_disc_debit_account_code,
         pdc.code AS payment_disc_credit_account_code, ir.code AS invoice_rounding_account_code,
         (SELECT COUNT(*) FROM customer c WHERE c.customer_posting_group_code = g.code) AS customers_using
  FROM customer_posting_group g
  JOIN gl_account recv ON recv.id = g.receivables_account_id
  JOIN gl_account sc   ON sc.id   = g.service_charge_account_id
  JOIN gl_account af   ON af.id   = g.additional_fee_account_id
  JOIN gl_account pdd  ON pdd.id  = g.payment_disc_debit_account_id
  JOIN gl_account pdc  ON pdc.id  = g.payment_disc_credit_account_id
  JOIN gl_account ir   ON ir.id   = g.invoice_rounding_account_id`;

export const listCustomerPostingGroups = (): Promise<CustomerPostingGroupView[]> =>
  all<CustomerPostingGroupView>(`${CPG_SELECT} ORDER BY g.code`);

export const getCustomerPostingGroup = (code: string): Promise<CustomerPostingGroup | undefined> =>
  one<CustomerPostingGroup>('SELECT * FROM customer_posting_group WHERE code = ?', code);

export const getCustomerPostingGroupById = (id: number): Promise<CustomerPostingGroup | undefined> =>
  one<CustomerPostingGroup>('SELECT * FROM customer_posting_group WHERE id = ?', id);

export interface CustomerPostingGroupInput {
  code: string;
  description: string;
  receivablesAccountId: number;
  serviceChargeAccountId: number;
  additionalFeeAccountId: number;
  paymentDiscDebitAccountId: number;
  paymentDiscCreditAccountId: number;
  invoiceRoundingAccountId: number;
}

const CPG_COLS = `code, description, receivables_account_id, service_charge_account_id, additional_fee_account_id,
  payment_disc_debit_account_id, payment_disc_credit_account_id, invoice_rounding_account_id`;

const cpgValues = (i: CustomerPostingGroupInput): unknown[] => [
  norm(i.code).toUpperCase(), norm(i.description), i.receivablesAccountId, i.serviceChargeAccountId,
  i.additionalFeeAccountId, i.paymentDiscDebitAccountId, i.paymentDiscCreditAccountId, i.invoiceRoundingAccountId,
];

function assertCpg(i: CustomerPostingGroupInput): void {
  if (!norm(i.code)) throw new AppError('A code is required', 'VALIDATION');
  if (!norm(i.description)) throw new AppError('A description is required', 'VALIDATION');
  for (const [label, id] of [
    ['Receivables Account', i.receivablesAccountId], ['Service Charge Account', i.serviceChargeAccountId],
    ['Additional Fee Account', i.additionalFeeAccountId], ['Payment Disc. Debit Account', i.paymentDiscDebitAccountId],
    ['Payment Disc. Credit Account', i.paymentDiscCreditAccountId], ['Invoice Rounding Account', i.invoiceRoundingAccountId],
  ] as const) {
    if (!id) throw new AppError(`A ${label} is required`, 'VALIDATION');
  }
}

export async function createCustomerPostingGroup(i: CustomerPostingGroupInput, user: Actor): Promise<{ id: number }> {
  assertCpg(i);
  if (await hasAnyRow('customer_posting_group', 'code = ?', norm(i.code))) throw new AppError('A customer posting group with this code already exists', 'DUPLICATE');
  const info = await run(
    `INSERT INTO customer_posting_group (${CPG_COLS}, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ...cpgValues(i), now(), user.username,
  );
  await audit(user, 'CUSTOMER_POSTING_GROUP_CREATE', 'customer_posting_group', info.lastInsertRowid, { code: i.code });
  return { id: Number(info.lastInsertRowid) };
}

export async function updateCustomerPostingGroup(id: number, i: CustomerPostingGroupInput, user: Actor): Promise<void> {
  assertCpg(i);
  const before = await getCustomerPostingGroupById(id);
  if (!before) throw new AppError('Customer posting group not found', 'NOT_FOUND');
  if (norm(i.code).toUpperCase() !== before.code) throw new AppError('The code of an existing customer posting group cannot be changed', 'VALIDATION');
  await run(
    `UPDATE customer_posting_group SET description = ?, receivables_account_id = ?, service_charge_account_id = ?,
       additional_fee_account_id = ?, payment_disc_debit_account_id = ?, payment_disc_credit_account_id = ?,
       invoice_rounding_account_id = ? WHERE id = ?`,
    norm(i.description), i.receivablesAccountId, i.serviceChargeAccountId, i.additionalFeeAccountId,
    i.paymentDiscDebitAccountId, i.paymentDiscCreditAccountId, i.invoiceRoundingAccountId, id,
  );
  await audit(user, 'CUSTOMER_POSTING_GROUP_UPDATE', 'customer_posting_group', id, {});
}

/* ------------------------------------------------------------------- Payment Terms */

export const listPaymentTerms = (): Promise<PaymentTerms[]> =>
  all<PaymentTerms>('SELECT * FROM payment_terms ORDER BY code');
export const listActivePaymentTerms = (): Promise<PaymentTerms[]> =>
  all<PaymentTerms>("SELECT * FROM payment_terms WHERE status = 'ACTIVE' ORDER BY code");
export const getPaymentTerms = (code: string): Promise<PaymentTerms | undefined> =>
  one<PaymentTerms>('SELECT * FROM payment_terms WHERE code = ?', code);
export const getPaymentTermsById = (id: number): Promise<PaymentTerms | undefined> =>
  one<PaymentTerms>('SELECT * FROM payment_terms WHERE id = ?', id);

export interface PaymentTermsInput {
  code: string; description: string; dueDateCalculation: string; discountDateCalculation: string;
  discountPct: number; calcPmtDiscOnCreditMemos: boolean; status: 'ACTIVE' | 'INACTIVE';
}

function assertPaymentTerms(i: PaymentTermsInput): void {
  if (!norm(i.code)) throw new AppError('A code is required', 'VALIDATION');
  if (!norm(i.description)) throw new AppError('A description is required', 'VALIDATION');
  if (!isValidDateFormula(i.dueDateCalculation)) throw new AppError('The Due Date Calculation is not a valid date formula (e.g. 30D, CM, CM+10D)', 'VALIDATION');
  if (!isValidDateFormula(i.discountDateCalculation)) throw new AppError('The Discount Date Calculation is not a valid date formula', 'VALIDATION');
  if (i.discountPct < 0 || i.discountPct > 100) throw new AppError('Discount % must be between 0 and 100', 'VALIDATION');
}

export async function createPaymentTerms(i: PaymentTermsInput, user: Actor): Promise<{ id: number }> {
  assertPaymentTerms(i);
  if (await hasAnyRow('payment_terms', 'code = ?', norm(i.code))) throw new AppError('Payment terms with this code already exist', 'DUPLICATE');
  const info = await run(
    `INSERT INTO payment_terms (code, description, due_date_calculation, discount_date_calculation, discount_pct, calc_pmt_disc_on_credit_memos, status, created_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    norm(i.code).toUpperCase(), norm(i.description), norm(i.dueDateCalculation).toUpperCase(),
    norm(i.discountDateCalculation).toUpperCase(), i.discountPct, i.calcPmtDiscOnCreditMemos ? 1 : 0, i.status, now(), user.username,
  );
  await audit(user, 'PAYMENT_TERMS_CREATE', 'payment_terms', info.lastInsertRowid, { code: i.code });
  return { id: Number(info.lastInsertRowid) };
}

export async function updatePaymentTerms(id: number, i: PaymentTermsInput, user: Actor): Promise<void> {
  assertPaymentTerms(i);
  const before = await getPaymentTermsById(id);
  if (!before) throw new AppError('Payment terms not found', 'NOT_FOUND');
  await run(
    `UPDATE payment_terms SET code = ?, description = ?, due_date_calculation = ?, discount_date_calculation = ?,
       discount_pct = ?, calc_pmt_disc_on_credit_memos = ?, status = ? WHERE id = ?`,
    norm(i.code).toUpperCase(), norm(i.description), norm(i.dueDateCalculation).toUpperCase(),
    norm(i.discountDateCalculation).toUpperCase(), i.discountPct, i.calcPmtDiscOnCreditMemos ? 1 : 0, i.status, id,
  );
  await audit(user, 'PAYMENT_TERMS_UPDATE', 'payment_terms', id, {});
}

/**
 * Setup master data is the Admin's to add, change and remove — but only while nothing points at
 * it. Deleting a posting group a customer still names, or terms an open invoice was raised on,
 * would leave those documents unable to say what account they post to or when they fall due, so
 * each delete counts its dependants first and names what is in the way.
 */
export async function deleteCustomerPostingGroup(id: number, user: Actor): Promise<void> {
  const before = await getCustomerPostingGroupById(id);
  if (!before) throw new AppError('Customer posting group not found', 'NOT_FOUND');
  const used = await one<{ n: number }>(
    'SELECT COUNT(*) AS n FROM customer WHERE customer_posting_group_code = ?', before.code,
  );
  const n = Number(used?.n ?? 0);
  if (n) {
    throw new AppError(
      `${before.code} is still on ${n} customer${n === 1 ? '' : 's'} — move them to another group first`,
      'IN_USE',
    );
  }
  await run('DELETE FROM customer_posting_group WHERE id = ?', id);
  await audit(user, 'CUSTOMER_POSTING_GROUP_DELETE', 'customer_posting_group', id, { code: before.code });
}

export async function deletePaymentTerms(id: number, user: Actor): Promise<void> {
  const before = await getPaymentTermsById(id);
  if (!before) throw new AppError('Payment terms not found', 'NOT_FOUND');
  const used = await one<{ n: number }>(
    `SELECT (SELECT COUNT(*) FROM customer        WHERE payment_terms_code = @code)
          + (SELECT COUNT(*) FROM vendor          WHERE payment_terms_code = @code)
          + (SELECT COUNT(*) FROM sales_header    WHERE payment_terms_code = @code)
          + (SELECT COUNT(*) FROM purchase_header WHERE payment_terms_code = @code) AS n`,
    { code: before.code },
  );
  const n = Number(used?.n ?? 0);
  if (n) {
    throw new AppError(
      `${before.code} is still used by ${n} customer, vendor or document — set it Inactive instead`,
      'IN_USE',
    );
  }
  await run('DELETE FROM payment_terms WHERE id = ?', id);
  await audit(user, 'PAYMENT_TERMS_DELETE', 'payment_terms', id, { code: before.code });
}

/* ----------------------------------------------------------------- Payment Method */

export const listPaymentMethods = (): Promise<PaymentMethod[]> =>
  all<PaymentMethod>('SELECT * FROM payment_method ORDER BY code');
export const listActivePaymentMethods = (): Promise<PaymentMethod[]> =>
  all<PaymentMethod>("SELECT * FROM payment_method WHERE status = 'ACTIVE' ORDER BY code");
export const getPaymentMethodById = (id: number): Promise<PaymentMethod | undefined> =>
  one<PaymentMethod>('SELECT * FROM payment_method WHERE id = ?', id);

export interface PaymentMethodInput {
  code: string; description: string; balAccountType: 'None' | 'G/L Account' | 'Bank Account';
  balAccountNo: string | null; status: 'ACTIVE' | 'INACTIVE';
}

export async function createPaymentMethod(i: PaymentMethodInput, user: Actor): Promise<{ id: number }> {
  if (!norm(i.code)) throw new AppError('A code is required', 'VALIDATION');
  if (!norm(i.description)) throw new AppError('A description is required', 'VALIDATION');
  if (await hasAnyRow('payment_method', 'code = ?', norm(i.code))) throw new AppError('A payment method with this code already exists', 'DUPLICATE');
  const info = await run(
    'INSERT INTO payment_method (code, description, bal_account_type, bal_account_no, status, created_at, created_by) VALUES (?,?,?,?,?,?,?)',
    norm(i.code).toUpperCase(), norm(i.description), i.balAccountType, i.balAccountNo || null, i.status, now(), user.username,
  );
  await audit(user, 'PAYMENT_METHOD_CREATE', 'payment_method', info.lastInsertRowid, { code: i.code });
  return { id: Number(info.lastInsertRowid) };
}

export async function updatePaymentMethod(id: number, i: PaymentMethodInput, user: Actor): Promise<void> {
  const before = await getPaymentMethodById(id);
  if (!before) throw new AppError('Payment method not found', 'NOT_FOUND');
  await run(
    'UPDATE payment_method SET code = ?, description = ?, bal_account_type = ?, bal_account_no = ?, status = ? WHERE id = ?',
    norm(i.code).toUpperCase(), norm(i.description), i.balAccountType, i.balAccountNo || null, i.status, id,
  );
  await audit(user, 'PAYMENT_METHOD_UPDATE', 'payment_method', id, {});
}

export async function deletePaymentMethod(id: number, user: Actor): Promise<void> {
  const before = await getPaymentMethodById(id);
  if (!before) throw new AppError('Payment method not found', 'NOT_FOUND');
  const used = await one<{ n: number }>(
    `SELECT (SELECT COUNT(*) FROM customer WHERE payment_method_code = @code)
          + (SELECT COUNT(*) FROM vendor   WHERE payment_method_code = @code)
          + (SELECT COUNT(*) FROM receipt_header         WHERE pay_mode_code = @code)
          + (SELECT COUNT(*) FROM payment_voucher_header WHERE pay_mode_code = @code) AS n`,
    { code: before.code },
  );
  if (Number(used?.n ?? 0)) {
    throw new AppError(
      `${before.code} is still used by ${used!.n} party, receipt or voucher — set it Inactive instead`,
      'IN_USE',
    );
  }
  await run('DELETE FROM payment_method WHERE id = ?', id);
  await audit(user, 'PAYMENT_METHOD_DELETE', 'payment_method', id, { code: before.code });
}

/* ------------------------------------------------------ Reminder Terms + Levels */

export const listReminderTerms = (): Promise<ReminderTerms[]> =>
  all<ReminderTerms>('SELECT * FROM reminder_terms ORDER BY code');
export const listActiveReminderTerms = (): Promise<ReminderTerms[]> =>
  all<ReminderTerms>("SELECT * FROM reminder_terms WHERE status = 'ACTIVE' ORDER BY code");
export const getReminderTerms = (code: string): Promise<ReminderTerms | undefined> =>
  one<ReminderTerms>('SELECT * FROM reminder_terms WHERE code = ?', code);
export const getReminderTermsById = (id: number): Promise<ReminderTerms | undefined> =>
  one<ReminderTerms>('SELECT * FROM reminder_terms WHERE id = ?', id);
export const listReminderLevels = (termsCode: string): Promise<ReminderLevel[]> =>
  all<ReminderLevel>('SELECT * FROM reminder_level WHERE reminder_terms_code = ? ORDER BY level_no', termsCode);

/** The level to use for a given "how many reminders already issued" count (BC caps at the
 *  highest defined level). */
export async function reminderLevelFor(termsCode: string, priorReminders: number): Promise<ReminderLevel | undefined> {
  const levels = await listReminderLevels(termsCode);
  if (!levels.length) return undefined;
  const target = Math.min(priorReminders + 1, levels[levels.length - 1].level_no);
  return levels.find((l) => l.level_no === target) ?? levels[levels.length - 1];
}

export interface ReminderTermsInput {
  code: string; description: string; maxNoOfReminders: number; postInterest: boolean;
  postAdditionalFee: boolean; minAmount: number; dontRemindOnHold: boolean; status: 'ACTIVE' | 'INACTIVE';
}
export interface ReminderLevelInput {
  levelNo: number; gracePeriod: string; dueDateCalculation: string; calculateInterest: boolean;
  additionalFee: number; addFeePerLine: number; beginText: string | null; endText: string | null;
}

export async function createReminderTerms(i: ReminderTermsInput, levels: ReminderLevelInput[], user: Actor): Promise<{ id: number }> {
  if (!norm(i.code)) throw new AppError('A code is required', 'VALIDATION');
  if (await hasAnyRow('reminder_terms', 'code = ?', norm(i.code))) throw new AppError('Reminder terms with this code already exist', 'DUPLICATE');
  const info = await run(
    `INSERT INTO reminder_terms (code, description, max_no_of_reminders, post_interest, post_additional_fee, min_amount, dont_remind_on_hold, status, created_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    norm(i.code).toUpperCase(), norm(i.description), Math.max(1, Math.round(i.maxNoOfReminders)),
    i.postInterest ? 1 : 0, i.postAdditionalFee ? 1 : 0, Math.round(i.minAmount), i.dontRemindOnHold ? 1 : 0, i.status, now(), user.username,
  );
  await replaceReminderLevels(norm(i.code).toUpperCase(), levels, user);
  await audit(user, 'REMINDER_TERMS_CREATE', 'reminder_terms', info.lastInsertRowid, { code: i.code });
  return { id: Number(info.lastInsertRowid) };
}

export async function updateReminderTerms(id: number, i: ReminderTermsInput, levels: ReminderLevelInput[], user: Actor): Promise<void> {
  const before = await getReminderTermsById(id);
  if (!before) throw new AppError('Reminder terms not found', 'NOT_FOUND');
  await run(
    `UPDATE reminder_terms SET description = ?, max_no_of_reminders = ?, post_interest = ?, post_additional_fee = ?,
       min_amount = ?, dont_remind_on_hold = ?, status = ? WHERE id = ?`,
    norm(i.description), Math.max(1, Math.round(i.maxNoOfReminders)), i.postInterest ? 1 : 0,
    i.postAdditionalFee ? 1 : 0, Math.round(i.minAmount), i.dontRemindOnHold ? 1 : 0, i.status, id,
  );
  await replaceReminderLevels(before.code, levels, user);
  await audit(user, 'REMINDER_TERMS_UPDATE', 'reminder_terms', id, {});
}

async function replaceReminderLevels(termsCode: string, levels: ReminderLevelInput[], _user: Actor): Promise<void> {
  const clean = levels
    .filter((l) => l.levelNo > 0)
    .sort((a, b) => a.levelNo - b.levelNo);
  for (const l of clean) {
    if (!isValidDateFormula(l.gracePeriod)) throw new AppError(`Level ${l.levelNo}: the Grace Period is not a valid date formula`, 'VALIDATION');
    if (!isValidDateFormula(l.dueDateCalculation)) throw new AppError(`Level ${l.levelNo}: the Due Date Calculation is not a valid date formula`, 'VALIDATION');
  }
  await run('DELETE FROM reminder_level WHERE reminder_terms_code = ?', termsCode);
  let n = 1;
  for (const l of clean) {
    await run(
      `INSERT INTO reminder_level (reminder_terms_code, level_no, grace_period, due_date_calculation, calculate_interest, additional_fee, add_fee_per_line, begin_text, end_text)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      termsCode, n, norm(l.gracePeriod).toUpperCase(), norm(l.dueDateCalculation).toUpperCase(),
      l.calculateInterest ? 1 : 0, Math.round(l.additionalFee), Math.round(l.addFeePerLine),
      l.beginText?.trim() || null, l.endText?.trim() || null,
    );
    n += 1;
  }
}

/* ------------------------------------------------------------ Finance Charge Terms */

export const listFinanceChargeTerms = (): Promise<FinanceChargeTerms[]> =>
  all<FinanceChargeTerms>('SELECT * FROM finance_charge_terms ORDER BY code');
export const listActiveFinanceChargeTerms = (): Promise<FinanceChargeTerms[]> =>
  all<FinanceChargeTerms>("SELECT * FROM finance_charge_terms WHERE status = 'ACTIVE' ORDER BY code");
export const getFinanceChargeTerms = (code: string): Promise<FinanceChargeTerms | undefined> =>
  one<FinanceChargeTerms>('SELECT * FROM finance_charge_terms WHERE code = ?', code);
export const getFinanceChargeTermsById = (id: number): Promise<FinanceChargeTerms | undefined> =>
  one<FinanceChargeTerms>('SELECT * FROM finance_charge_terms WHERE id = ?', id);

export interface FinanceChargeTermsInput {
  code: string; description: string; interestRate: number; minAmount: number; additionalFee: number;
  gracePeriod: string; dueDateCalculation: string; interestPeriodDays: number;
  interestCalculationMethod: 'Average Daily Balance' | 'Balance Due'; postInterest: boolean;
  postAdditionalFee: boolean; lineDescription: string; beginText: string | null; endText: string | null;
  status: 'ACTIVE' | 'INACTIVE';
}

function assertFcTerms(i: FinanceChargeTermsInput): void {
  if (!norm(i.code)) throw new AppError('A code is required', 'VALIDATION');
  if (!norm(i.description)) throw new AppError('A description is required', 'VALIDATION');
  if (i.interestRate < 0) throw new AppError('Interest rate cannot be negative', 'VALIDATION');
  if (i.interestPeriodDays <= 0) throw new AppError('Interest period days must be greater than zero', 'VALIDATION');
  if (!isValidDateFormula(i.gracePeriod)) throw new AppError('The Grace Period is not a valid date formula', 'VALIDATION');
  if (!isValidDateFormula(i.dueDateCalculation)) throw new AppError('The Due Date Calculation is not a valid date formula', 'VALIDATION');
}

export async function createFinanceChargeTerms(i: FinanceChargeTermsInput, user: Actor): Promise<{ id: number }> {
  assertFcTerms(i);
  if (await hasAnyRow('finance_charge_terms', 'code = ?', norm(i.code))) throw new AppError('Finance charge terms with this code already exist', 'DUPLICATE');
  const info = await run(
    `INSERT INTO finance_charge_terms (code, description, interest_rate, min_amount, additional_fee, grace_period,
       due_date_calculation, interest_period_days, interest_calculation_method, post_interest, post_additional_fee,
       line_description, begin_text, end_text, status, created_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    norm(i.code).toUpperCase(), norm(i.description), i.interestRate, Math.round(i.minAmount), Math.round(i.additionalFee),
    norm(i.gracePeriod).toUpperCase(), norm(i.dueDateCalculation).toUpperCase(), Math.round(i.interestPeriodDays),
    i.interestCalculationMethod, i.postInterest ? 1 : 0, i.postAdditionalFee ? 1 : 0, norm(i.lineDescription) || 'Finance Charge',
    i.beginText?.trim() || null, i.endText?.trim() || null, i.status, now(), user.username,
  );
  await audit(user, 'FINANCE_CHARGE_TERMS_CREATE', 'finance_charge_terms', info.lastInsertRowid, { code: i.code });
  return { id: Number(info.lastInsertRowid) };
}

export async function updateFinanceChargeTerms(id: number, i: FinanceChargeTermsInput, user: Actor): Promise<void> {
  assertFcTerms(i);
  const before = await getFinanceChargeTermsById(id);
  if (!before) throw new AppError('Finance charge terms not found', 'NOT_FOUND');
  await run(
    `UPDATE finance_charge_terms SET description = ?, interest_rate = ?, min_amount = ?, additional_fee = ?, grace_period = ?,
       due_date_calculation = ?, interest_period_days = ?, interest_calculation_method = ?, post_interest = ?,
       post_additional_fee = ?, line_description = ?, begin_text = ?, end_text = ?, status = ? WHERE id = ?`,
    norm(i.description), i.interestRate, Math.round(i.minAmount), Math.round(i.additionalFee), norm(i.gracePeriod).toUpperCase(),
    norm(i.dueDateCalculation).toUpperCase(), Math.round(i.interestPeriodDays), i.interestCalculationMethod,
    i.postInterest ? 1 : 0, i.postAdditionalFee ? 1 : 0, norm(i.lineDescription) || 'Finance Charge',
    i.beginText?.trim() || null, i.endText?.trim() || null, i.status, id,
  );
  await audit(user, 'FINANCE_CHARGE_TERMS_UPDATE', 'finance_charge_terms', id, {});
}

/* ------------------------------------------------------- Sales & Receivables Setup */

const DEFAULT_SETUP: SalesReceivablesSetup = {
  id: 1, default_customer_posting_group_code: null, default_payment_terms_code: null,
  default_reminder_terms_code: null, default_fin_charge_terms_code: null, stockout_warning: 1,
  credit_warnings: 'Both', invoice_rounding: 0, invoice_rounding_precision: 0,
  allow_receivables_posting_from: null, allow_receivables_posting_to: null, updated_at: null, updated_by: null,
};

export async function getSalesReceivablesSetup(): Promise<SalesReceivablesSetup> {
  const row = await one<SalesReceivablesSetup>('SELECT * FROM sales_receivables_setup WHERE id = 1');
  return row ?? DEFAULT_SETUP;
}

export interface SalesReceivablesSetupInput {
  defaultCustomerPostingGroupCode: string | null;
  defaultPaymentTermsCode: string | null;
  defaultReminderTermsCode: string | null;
  defaultFinChargeTermsCode: string | null;
  stockoutWarning: boolean;
  creditWarnings: 'Both' | 'Credit Limit' | 'Overdue Balance' | 'No Warning';
  invoiceRounding: boolean;
  invoiceRoundingPrecision: number;
  allowReceivablesPostingFrom: string | null;
  allowReceivablesPostingTo: string | null;
}

export async function saveSalesReceivablesSetup(i: SalesReceivablesSetupInput, user: Actor): Promise<void> {
  if (i.defaultCustomerPostingGroupCode && !(await hasAnyRow('customer_posting_group', 'code = ?', i.defaultCustomerPostingGroupCode))) {
    throw new AppError('Unknown customer posting group', 'VALIDATION');
  }
  if (i.defaultPaymentTermsCode && !(await hasAnyRow('payment_terms', 'code = ?', i.defaultPaymentTermsCode))) {
    throw new AppError('Unknown payment terms', 'VALIDATION');
  }
  if (i.allowReceivablesPostingFrom && i.allowReceivablesPostingTo && i.allowReceivablesPostingFrom > i.allowReceivablesPostingTo) {
    throw new AppError('Allow Posting From cannot be after Allow Posting To', 'VALIDATION');
  }
  await run(
    `INSERT INTO sales_receivables_setup (id, default_customer_posting_group_code, default_payment_terms_code,
       default_reminder_terms_code, default_fin_charge_terms_code, stockout_warning, credit_warnings, invoice_rounding,
       invoice_rounding_precision, allow_receivables_posting_from, allow_receivables_posting_to, updated_at, updated_by)
     VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (id) DO UPDATE SET
       default_customer_posting_group_code = EXCLUDED.default_customer_posting_group_code,
       default_payment_terms_code = EXCLUDED.default_payment_terms_code,
       default_reminder_terms_code = EXCLUDED.default_reminder_terms_code,
       default_fin_charge_terms_code = EXCLUDED.default_fin_charge_terms_code,
       stockout_warning = EXCLUDED.stockout_warning, credit_warnings = EXCLUDED.credit_warnings,
       invoice_rounding = EXCLUDED.invoice_rounding, invoice_rounding_precision = EXCLUDED.invoice_rounding_precision,
       allow_receivables_posting_from = EXCLUDED.allow_receivables_posting_from,
       allow_receivables_posting_to = EXCLUDED.allow_receivables_posting_to,
       updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
    i.defaultCustomerPostingGroupCode || null, i.defaultPaymentTermsCode || null, i.defaultReminderTermsCode || null,
    i.defaultFinChargeTermsCode || null, i.stockoutWarning ? 1 : 0, i.creditWarnings, i.invoiceRounding ? 1 : 0,
    Math.round(i.invoiceRoundingPrecision), i.allowReceivablesPostingFrom || null, i.allowReceivablesPostingTo || null,
    now(), user.username,
  );
  await audit(user, 'SALES_RECEIVABLES_SETUP_SAVE', 'sales_receivables_setup', 1, i);
}
