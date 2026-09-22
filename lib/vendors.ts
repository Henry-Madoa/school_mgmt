/*
 * Vendor cards — Business Central Table 23. The mirror of lib/customers.ts. `balance` is a
 * maintained roll-up of open vendor_ledger_entry.remaining_amount (see lib/vendLedger.ts's
 * recomputeVendorBalance).
 */
import { one, all, run, nextSequence, audit, hasAnyRow } from './db.ts';
import { assertContactDetails } from './validate.ts';
import { AppError } from './errors.ts';
import { today } from './format.ts';
import { buildFilterClause, type FilterCondition, type FilterFieldDef } from './listFilters.ts';
import { buildOrderClause, type SortState } from './listSort.ts';
import { getPurchasesPayablesSetup } from './payablesSetup.ts';
import type {
  Actor, Cents, Vendor, VendorBlocked, VendorLedgerEntryView, VendorListRow, VendorStatistics,
} from './types.ts';

const BLOCKED_VALUES: VendorBlocked[] = ['', 'Payment', 'Invoice', 'All'];

const SELECT_ROW = `
  SELECT v.*,
         g.description AS vendor_posting_group_description,
         pt.description AS payment_terms_description,
         COALESCE((SELECT SUM(e.remaining_amount) FROM vendor_ledger_entry e
                   WHERE e.vendor_id = v.id AND e.open = 1 AND e.due_date IS NOT NULL AND e.due_date < @today), 0) AS balance_due
  FROM vendor v
  LEFT JOIN vendor_posting_group g ON g.code = v.vendor_posting_group_code
  LEFT JOIN payment_terms pt ON pt.code = v.payment_terms_code`;

export const VENDOR_FILTER_FIELDS: FilterFieldDef[] = [
  { key: 'no', label: 'No.', type: 'text', column: 'v.no' },
  { key: 'name', label: 'Name', type: 'text', column: 'v.name' },
  { key: 'vendor_posting_group_code', label: 'Posting Group', type: 'select', column: 'v.vendor_posting_group_code' },
  { key: 'city', label: 'City', type: 'text', column: 'v.city' },
  {
    key: 'blocked', label: 'Blocked', type: 'select', column: 'v.blocked',
    options: [{ value: 'Payment', label: 'Payment' }, { value: 'Invoice', label: 'Invoice' }, { value: 'All', label: 'All' }],
  },
];

const SORT_COLUMNS: Record<string, string> = {
  no: 'v.no', name: 'v.name', city: 'v.city', balance: 'v.balance', balance_due: 'balance_due',
};

export interface ListVendorsOptions {
  search?: string; filters?: FilterCondition[]; sort?: SortState | null;
}

export const listVendors = (
  { search = '', filters = [], sort = null }: ListVendorsOptions = {},
): Promise<VendorListRow[]> => {
  const { clause, params } = buildFilterClause(VENDOR_FILTER_FIELDS, filters);
  const orderBy = buildOrderClause(SORT_COLUMNS, sort, 'v.no');
  return all<VendorListRow>(
    `${SELECT_ROW}
     WHERE (v.no ILIKE @like OR v.name ILIKE @like OR v.city ILIKE @like OR v.phone ILIKE @like)
       ${clause}
     ${orderBy}`,
    { like: `%${String(search).trim()}%`, today: today(), ...params },
  );
};

export const getVendor = (no: string): Promise<VendorListRow | undefined> =>
  one<VendorListRow>(`${SELECT_ROW} WHERE v.no = @no`, { no, today: today() });

export const getVendorById = (id: number): Promise<Vendor | undefined> =>
  one<Vendor>('SELECT * FROM vendor WHERE id = ?', id);

export const listActiveVendors = (): Promise<Pick<Vendor,
'id' | 'no' | 'name' | 'blocked' | 'vendor_posting_group_code' | 'vat_bus_posting_group_code' | 'payment_terms_code'>[]> =>
  all(`SELECT id, no, name, blocked, vendor_posting_group_code, vat_bus_posting_group_code, payment_terms_code
      FROM vendor ORDER BY no`);

export const hasAnyVendors = (): Promise<boolean> => hasAnyRow('vendor');

/* -------------------------------------------------------------------- create / edit */

export interface VendorInput {
  name: string;
  name2?: string | null;
  address?: string | null;
  address2?: string | null;
  city?: string | null;
  postCode?: string | null;
  country?: string | null;
  contact?: string | null;
  phone?: string | null;
  email?: string | null;
  vendorPostingGroupCode?: string | null;
  vatBusPostingGroupCode?: string | null;
  pinNo?: string | null;
  whtExempt?: boolean;
  paymentTermsCode?: string | null;
  paymentMethodCode?: string | null;
  purchaser?: string | null;
  ourAccountNo?: string | null;
  currencyCode?: string | null;
  creditLimit: Cents;
  blocked: VendorBlocked;
  globalDimension1Id?: number | null;
  globalDimension2Id?: number | null;
}

async function assertVendor(input: VendorInput): Promise<void> {
  assertContactDetails({ phone: input.phone, email: input.email });
  if (!input.name?.trim()) throw new AppError('A name is required', 'VALIDATION');
  if (!BLOCKED_VALUES.includes(input.blocked)) throw new AppError('Invalid Blocked value', 'VALIDATION');
  if (input.creditLimit < 0) throw new AppError('Credit limit cannot be negative', 'VALIDATION');
  if (input.vendorPostingGroupCode && !(await hasAnyRow('vendor_posting_group', 'code = ?', input.vendorPostingGroupCode))) {
    throw new AppError('Unknown vendor posting group', 'VALIDATION');
  }
  if (input.paymentTermsCode && !(await hasAnyRow('payment_terms', 'code = ?', input.paymentTermsCode))) {
    throw new AppError('Unknown payment terms', 'VALIDATION');
  }
}

const vendorCols = `name, name_2, address, address_2, city, post_code, country, contact, phone, email,
  vendor_posting_group_code, vat_bus_posting_group_code, pin_no, wht_exempt, payment_terms_code, payment_method_code,
  purchaser, our_account_no, currency_code, credit_limit, blocked, global_dimension_1_id, global_dimension_2_id`;

const vendorValues = (i: VendorInput): unknown[] => [
  i.name.trim(), i.name2?.trim() || null, i.address?.trim() || null, i.address2?.trim() || null, i.city?.trim() || null,
  i.postCode?.trim() || null, i.country?.trim() || null, i.contact?.trim() || null, i.phone?.trim() || null, i.email?.trim() || null,
  i.vendorPostingGroupCode || null, i.vatBusPostingGroupCode || null, i.pinNo?.trim() || null, i.whtExempt ? 1 : 0,
  i.paymentTermsCode || null, i.paymentMethodCode || null, i.purchaser?.trim() || null,
  i.ourAccountNo?.trim() || null, i.currencyCode || null, Math.round(i.creditLimit), i.blocked,
  i.globalDimension1Id || null, i.globalDimension2Id || null,
];

export async function createVendor(input: VendorInput, user: Actor): Promise<{ no: string }> {
  await assertVendor(input);
  const setup = await getPurchasesPayablesSetup();
  const filled: VendorInput = {
    ...input,
    vendorPostingGroupCode: input.vendorPostingGroupCode || setup.default_vendor_posting_group_code,
    vatBusPostingGroupCode: input.vatBusPostingGroupCode || setup.default_vat_bus_posting_group_code,
    paymentTermsCode: input.paymentTermsCode || setup.default_payment_terms_code,
  };
  const no = await nextSequence('VENDOR');
  const values = [no, ...vendorValues(filled), new Date().toISOString(), user.username];
  await run(
    `INSERT INTO vendor (no, ${vendorCols}, created_at, created_by) VALUES (${values.map(() => '?').join(',')})`,
    ...values,
  );
  await audit(user, 'VENDOR_CREATE', 'vendor', no, { name: input.name });
  return { no };
}

export async function updateVendor(no: string, input: VendorInput, user: Actor): Promise<void> {
  const before = await getVendorById((await one<{ id: number }>('SELECT id FROM vendor WHERE no = ?', no))?.id ?? 0);
  if (!before) throw new AppError('Vendor not found', 'NOT_FOUND');
  await assertVendor(input);
  const hasEntries = await hasAnyRow('vendor_ledger_entry', 'vendor_id = ?', before.id);
  if (hasEntries && input.vendorPostingGroupCode && input.vendorPostingGroupCode !== before.vendor_posting_group_code) {
    throw new AppError('The Vendor Posting Group cannot change once ledger entries have been posted', 'VALIDATION');
  }
  await run(
    `UPDATE vendor SET name = ?, name_2 = ?, address = ?, address_2 = ?, city = ?, post_code = ?, country = ?,
       contact = ?, phone = ?, email = ?, vendor_posting_group_code = ?, vat_bus_posting_group_code = ?, pin_no = ?,
       wht_exempt = ?, payment_terms_code = ?, payment_method_code = ?,
       purchaser = ?, our_account_no = ?, currency_code = ?, credit_limit = ?, blocked = ?, global_dimension_1_id = ?, global_dimension_2_id = ?
     WHERE id = ?`,
    ...vendorValues(input), before.id,
  );
  await audit(user, 'VENDOR_UPDATE', 'vendor', no, {});
}

/* --------------------------------------------------------------------- statistics */

export async function vendorStatistics(vendorId: number): Promise<VendorStatistics> {
  const v = await one<{ balance: Cents; credit_limit: Cents }>(
    'SELECT balance, credit_limit FROM vendor WHERE id = ?', vendorId,
  );
  const due = await one<{ total: Cents; n: number }>(
    `SELECT COALESCE(SUM(remaining_amount), 0) AS total, COUNT(*) AS n
     FROM vendor_ledger_entry WHERE vendor_id = ? AND open = 1 AND due_date IS NOT NULL AND due_date < ?`,
    vendorId, today(),
  );
  const orders = await one<{ total: Cents }>(
    `SELECT COALESCE(SUM(pl.line_amount - (pl.qty_invoiced / NULLIF(pl.quantity,0) * pl.line_amount)), 0) AS total
     FROM purchase_header ph JOIN purchase_line pl ON pl.purchase_header_id = ph.id
     WHERE ph.vendor_id = ? AND ph.document_type = 'Order'`,
    vendorId,
  );
  const count = await one<{ n: number }>('SELECT COUNT(*) AS n FROM vendor_ledger_entry WHERE vendor_id = ?', vendorId);
  return {
    balance: v?.balance ?? 0,
    balance_due: due?.total ?? 0,
    outstanding_orders: Math.round(orders?.total ?? 0),
    overdue_entries: Number(due?.n ?? 0),
    ledger_entry_count: Number(count?.n ?? 0),
    credit_limit: v?.credit_limit ?? 0,
  };
}

export const getVendorLedgerEntries = (
  { vendorId, openOnly = false }: { vendorId?: number; openOnly?: boolean } = {},
): Promise<VendorLedgerEntryView[]> => all<VendorLedgerEntryView>(
  `SELECT e.*, v.no AS vendor_no, v.name AS vendor_name
   FROM vendor_ledger_entry e JOIN vendor v ON v.id = e.vendor_id
   WHERE 1=1 ${vendorId ? 'AND e.vendor_id = @vendorId' : ''} ${openOnly ? 'AND e.open = 1' : ''}
   ORDER BY e.posting_date DESC, e.id DESC`,
  { vendorId },
);

export const hasAnyVendorLedgerEntries = (): Promise<boolean> => hasAnyRow('vendor_ledger_entry');

/** BC's "Check Vendor Blocked" — a hard block on `blocked`. */
export async function checkVendorAllowed(
  vendorId: number, kind: 'Payment' | 'Invoice',
): Promise<{ blocked: boolean; reason?: string }> {
  const v = await getVendorById(vendorId);
  if (!v) return { blocked: true, reason: 'Vendor not found' };
  if (v.blocked === 'All' || v.blocked === kind) {
    return { blocked: true, reason: `Vendor ${v.no} is blocked for ${v.blocked === 'All' ? 'all transactions' : kind}` };
  }
  return { blocked: false };
}
