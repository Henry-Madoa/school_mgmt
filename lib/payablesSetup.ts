/*
 * Payables setup masters — Business Central Tables 93 (Vendor Posting Group) and 312 (Purchases &
 * Payables Setup). Payment Terms (Table 3) and Payment Method (Table 289) are shared with
 * Receivables and managed there (lib/receivablesSetup.ts). Structured like lib/receivablesSetup.ts:
 * `assertX` validators, duplicate-code guards, `audit()`.
 */
import { one, all, run, audit, hasAnyRow } from './db.ts';
import { AppError } from './errors.ts';
import type {
  Actor, PurchasesPayablesSetup, VendorPostingGroup, VendorPostingGroupView,
} from './types.ts';

const norm = (v: unknown): string => String(v ?? '').trim();
const now = (): string => new Date().toISOString();

/* ----------------------------------------------------------- Vendor Posting Group */

const VPG_SELECT = `
  SELECT g.*,
         pay.code  AS payables_account_code, sc.code AS service_charge_account_code,
         pdd.code  AS payment_disc_debit_account_code, pdc.code AS payment_disc_credit_account_code,
         ir.code   AS invoice_rounding_account_code,
         (SELECT COUNT(*) FROM vendor v WHERE v.vendor_posting_group_code = g.code) AS vendors_using
  FROM vendor_posting_group g
  JOIN gl_account pay ON pay.id = g.payables_account_id
  JOIN gl_account sc  ON sc.id  = g.service_charge_account_id
  JOIN gl_account pdd ON pdd.id = g.payment_disc_debit_account_id
  JOIN gl_account pdc ON pdc.id = g.payment_disc_credit_account_id
  JOIN gl_account ir  ON ir.id  = g.invoice_rounding_account_id`;

export const listVendorPostingGroups = (): Promise<VendorPostingGroupView[]> =>
  all<VendorPostingGroupView>(`${VPG_SELECT} ORDER BY g.code`);

export const getVendorPostingGroup = (code: string): Promise<VendorPostingGroup | undefined> =>
  one<VendorPostingGroup>('SELECT * FROM vendor_posting_group WHERE code = ?', code);

export const getVendorPostingGroupById = (id: number): Promise<VendorPostingGroup | undefined> =>
  one<VendorPostingGroup>('SELECT * FROM vendor_posting_group WHERE id = ?', id);

export interface VendorPostingGroupInput {
  code: string;
  description: string;
  payablesAccountId: number;
  serviceChargeAccountId: number;
  paymentDiscDebitAccountId: number;
  paymentDiscCreditAccountId: number;
  invoiceRoundingAccountId: number;
}

const VPG_COLS = `code, description, payables_account_id, service_charge_account_id,
  payment_disc_debit_account_id, payment_disc_credit_account_id, invoice_rounding_account_id`;

const vpgValues = (i: VendorPostingGroupInput): unknown[] => [
  norm(i.code).toUpperCase(), norm(i.description), i.payablesAccountId, i.serviceChargeAccountId,
  i.paymentDiscDebitAccountId, i.paymentDiscCreditAccountId, i.invoiceRoundingAccountId,
];

function assertVpg(i: VendorPostingGroupInput): void {
  if (!norm(i.code)) throw new AppError('A code is required', 'VALIDATION');
  if (!norm(i.description)) throw new AppError('A description is required', 'VALIDATION');
  for (const [label, id] of [
    ['Payables Account', i.payablesAccountId], ['Service Charge Account', i.serviceChargeAccountId],
    ['Payment Disc. Debit Account', i.paymentDiscDebitAccountId],
    ['Payment Disc. Credit Account', i.paymentDiscCreditAccountId],
    ['Invoice Rounding Account', i.invoiceRoundingAccountId],
  ] as const) {
    if (!id) throw new AppError(`A ${label} is required`, 'VALIDATION');
  }
}

export async function createVendorPostingGroup(i: VendorPostingGroupInput, user: Actor): Promise<{ id: number }> {
  assertVpg(i);
  if (await hasAnyRow('vendor_posting_group', 'code = ?', norm(i.code))) throw new AppError('A vendor posting group with this code already exists', 'DUPLICATE');
  const info = await run(
    `INSERT INTO vendor_posting_group (${VPG_COLS}, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?)`,
    ...vpgValues(i), now(), user.username,
  );
  await audit(user, 'VENDOR_POSTING_GROUP_CREATE', 'vendor_posting_group', info.lastInsertRowid, { code: i.code });
  return { id: Number(info.lastInsertRowid) };
}

export async function updateVendorPostingGroup(id: number, i: VendorPostingGroupInput, user: Actor): Promise<void> {
  assertVpg(i);
  const before = await getVendorPostingGroupById(id);
  if (!before) throw new AppError('Vendor posting group not found', 'NOT_FOUND');
  if (norm(i.code).toUpperCase() !== before.code) throw new AppError('The code of an existing vendor posting group cannot be changed', 'VALIDATION');
  await run(
    `UPDATE vendor_posting_group SET description = ?, payables_account_id = ?, service_charge_account_id = ?,
       payment_disc_debit_account_id = ?, payment_disc_credit_account_id = ?, invoice_rounding_account_id = ?
     WHERE id = ?`,
    norm(i.description), i.payablesAccountId, i.serviceChargeAccountId, i.paymentDiscDebitAccountId,
    i.paymentDiscCreditAccountId, i.invoiceRoundingAccountId, id,
  );
  await audit(user, 'VENDOR_POSTING_GROUP_UPDATE', 'vendor_posting_group', id, {});
}

/** As with the customer side: removable only while no vendor still names it. */
export async function deleteVendorPostingGroup(id: number, user: Actor): Promise<void> {
  const before = await getVendorPostingGroupById(id);
  if (!before) throw new AppError('Vendor posting group not found', 'NOT_FOUND');
  const used = await one<{ n: number }>(
    'SELECT COUNT(*) AS n FROM vendor WHERE vendor_posting_group_code = ?', before.code,
  );
  if (Number(used?.n ?? 0)) {
    throw new AppError(
      `${before.code} is still on ${used!.n} vendor${Number(used!.n) === 1 ? '' : 's'} — move them to another group first`,
      'IN_USE',
    );
  }
  await run('DELETE FROM vendor_posting_group WHERE id = ?', id);
  await audit(user, 'VENDOR_POSTING_GROUP_DELETE', 'vendor_posting_group', id, { code: before.code });
}

/* -------------------------------------------------------- Purchases & Payables Setup */

const DEFAULT_SETUP: PurchasesPayablesSetup = {
  id: 1, default_vendor_posting_group_code: null, default_payment_terms_code: null,
  default_vat_bus_posting_group_code: null, prices_incl_vat: 0,
  receipt_on_invoice: 1, exact_cost_reversing_mandatory: 0,
  allow_payables_posting_from: null, allow_payables_posting_to: null, updated_at: null, updated_by: null,
};

export async function getPurchasesPayablesSetup(): Promise<PurchasesPayablesSetup> {
  const row = await one<PurchasesPayablesSetup>('SELECT * FROM purchases_payables_setup WHERE id = 1');
  return row ?? DEFAULT_SETUP;
}

export interface PurchasesPayablesSetupInput {
  defaultVendorPostingGroupCode: string | null;
  defaultPaymentTermsCode: string | null;
  receiptOnInvoice: boolean;
  exactCostReversingMandatory: boolean;
  allowPayablesPostingFrom: string | null;
  allowPayablesPostingTo: string | null;
}

export async function savePurchasesPayablesSetup(i: PurchasesPayablesSetupInput, user: Actor): Promise<void> {
  if (i.defaultVendorPostingGroupCode && !(await hasAnyRow('vendor_posting_group', 'code = ?', i.defaultVendorPostingGroupCode))) {
    throw new AppError('Unknown vendor posting group', 'VALIDATION');
  }
  if (i.defaultPaymentTermsCode && !(await hasAnyRow('payment_terms', 'code = ?', i.defaultPaymentTermsCode))) {
    throw new AppError('Unknown payment terms', 'VALIDATION');
  }
  if (i.allowPayablesPostingFrom && i.allowPayablesPostingTo && i.allowPayablesPostingFrom > i.allowPayablesPostingTo) {
    throw new AppError('Allow Posting From cannot be after Allow Posting To', 'VALIDATION');
  }
  await run(
    `INSERT INTO purchases_payables_setup (id, default_vendor_posting_group_code, default_payment_terms_code,
       receipt_on_invoice, exact_cost_reversing_mandatory, allow_payables_posting_from, allow_payables_posting_to,
       updated_at, updated_by)
     VALUES (1,?,?,?,?,?,?,?,?)
     ON CONFLICT (id) DO UPDATE SET
       default_vendor_posting_group_code = EXCLUDED.default_vendor_posting_group_code,
       default_payment_terms_code = EXCLUDED.default_payment_terms_code,
       receipt_on_invoice = EXCLUDED.receipt_on_invoice,
       exact_cost_reversing_mandatory = EXCLUDED.exact_cost_reversing_mandatory,
       allow_payables_posting_from = EXCLUDED.allow_payables_posting_from,
       allow_payables_posting_to = EXCLUDED.allow_payables_posting_to,
       updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
    i.defaultVendorPostingGroupCode || null, i.defaultPaymentTermsCode || null, i.receiptOnInvoice ? 1 : 0,
    i.exactCostReversingMandatory ? 1 : 0, i.allowPayablesPostingFrom || null, i.allowPayablesPostingTo || null,
    now(), user.username,
  );
  await audit(user, 'PURCHASES_PAYABLES_SETUP_SAVE', 'purchases_payables_setup', 1, i);
}
