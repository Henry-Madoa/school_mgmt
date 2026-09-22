/*
 * Payables reports — computed live from vendor_ledger_entry, the read-only aggregation idiom of
 * lib/receivablesReports.ts.
 *
 *  - getAgedAccountsPayable()  Business Central Report 322 "Aged Accounts Payable".
 *  - getVendorStatement()      Business Central Report 321 "Vendor - Balance to Date" style statement.
 */
import { one, all } from './db.ts';
import { AppError } from './errors.ts';
import { today } from './format.ts';
import { applyDateFormula, daysBetween } from './dateFormula.ts';
import { buildFilterClause, type FilterCondition, type FilterFieldDef } from './listFilters.ts';
import type {
  AgedPayableReport, AgedPayableRow, Cents, IsoDate, VendorLedgerDocumentType, VendorStatementLine,
  VendorStatementReport,
} from './types.ts';

export const AGED_AP_FILTER_FIELDS: FilterFieldDef[] = [
  { key: 'vendor_posting_group_code', label: 'Posting Group', type: 'select', column: 'v.vendor_posting_group_code' },
  { key: 'city', label: 'City', type: 'text', column: 'v.city' },
];

export interface GetAgedAPOptions {
  asOf?: IsoDate;
  agingBy?: 'Due Date' | 'Posting Date';
  periodLength?: string;
  search?: string;
  filters?: FilterCondition[];
}

/**
 * Aged Accounts Payable — per vendor, open vendor_ledger_entry.remaining_amount bucketed by how
 * far past `agingBy` each entry is at `asOf`. Four ageing buckets sized by `periodLength`
 * (default 30D), plus a "Not Due" column and the running Balance. Grand total ties to `2150`.
 */
export async function getAgedAccountsPayable(
  { asOf, agingBy = 'Due Date', periodLength = '30D', search = '', filters = [] }: GetAgedAPOptions = {},
): Promise<AgedPayableReport> {
  const cutoff = asOf || today();
  const p1 = Math.max(1, daysBetween(cutoff, applyDateFormula(cutoff, periodLength || '30D')));
  const b1 = p1;
  const b2 = p1 * 2;
  const b3 = p1 * 3;
  const { clause, params } = buildFilterClause(AGED_AP_FILTER_FIELDS, filters);

  const entries = await all<{
    vendor_id: number; vendor_no: string; vendor_name: string;
    remaining_amount: Cents; anchor_date: IsoDate | null;
  }>(
    `SELECT v.id AS vendor_id, v.no AS vendor_no, v.name AS vendor_name,
            e.remaining_amount_lcy AS remaining_amount,
            ${agingBy === 'Due Date' ? 'COALESCE(e.due_date, e.posting_date)' : 'e.posting_date'} AS anchor_date
     FROM vendor_ledger_entry e
     JOIN vendor v ON v.id = e.vendor_id
     WHERE e.open = 1 AND e.remaining_amount <> 0 AND e.posting_date <= @cutoff
       AND (v.no ILIKE @like OR v.name ILIKE @like)
       ${clause}`,
    { cutoff, like: `%${String(search).trim()}%`, ...params },
  );

  const byVendor = new Map<number, AgedPayableRow>();
  for (const e of entries) {
    const row = byVendor.get(e.vendor_id) ?? {
      vendor_id: e.vendor_id, vendor_no: e.vendor_no, vendor_name: e.vendor_name,
      balance: 0, not_due: 0, bucket_1: 0, bucket_2: 0, bucket_3: 0, bucket_over: 0,
    };
    row.balance += e.remaining_amount;
    const overdueDays = e.anchor_date ? daysBetween(e.anchor_date, cutoff) : 0;
    if (overdueDays <= 0) row.not_due += e.remaining_amount;
    else if (overdueDays <= b1) row.bucket_1 += e.remaining_amount;
    else if (overdueDays <= b2) row.bucket_2 += e.remaining_amount;
    else if (overdueDays <= b3) row.bucket_3 += e.remaining_amount;
    else row.bucket_over += e.remaining_amount;
    byVendor.set(e.vendor_id, row);
  }

  const rows = [...byVendor.values()].sort((a, b) => a.vendor_no.localeCompare(b.vendor_no));
  const totals = rows.reduce(
    (acc, r) => ({
      balance: acc.balance + r.balance, not_due: acc.not_due + r.not_due,
      bucket_1: acc.bucket_1 + r.bucket_1, bucket_2: acc.bucket_2 + r.bucket_2,
      bucket_3: acc.bucket_3 + r.bucket_3, bucket_over: acc.bucket_over + r.bucket_over,
    }),
    { balance: 0, not_due: 0, bucket_1: 0, bucket_2: 0, bucket_3: 0, bucket_over: 0 },
  );

  return {
    as_of: cutoff,
    aging_by: agingBy,
    period_length: periodLength,
    bucket_labels: ['Not Due', `1 – ${b1}`, `${b1 + 1} – ${b2}`, `${b2 + 1} – ${b3}`, `Over ${b3}`],
    rows,
    totals,
  };
}

/** Total open payables at a date — should tie to (Σ Vendor Posting Group payables accounts) on
 *  the trial balance. */
export async function payablesTotal(asOf: IsoDate): Promise<Cents> {
  const row = await one<{ total: Cents }>(
    'SELECT COALESCE(SUM(remaining_amount_lcy), 0) AS total FROM vendor_ledger_entry WHERE open = 1 AND posting_date <= ?', asOf,
  );
  return row?.total ?? 0;
}

/* ------------------------------------------------------------- vendor statement */

export async function getVendorStatement(
  { vendorNo, from, to }: { vendorNo: string; from?: IsoDate; to?: IsoDate },
): Promise<VendorStatementReport> {
  const vendor = await one<{ id: number; no: string; name: string }>(
    'SELECT id, no, name FROM vendor WHERE no = ?', vendorNo,
  );
  if (!vendor) throw new AppError('Vendor not found', 'NOT_FOUND');
  const toDate = to || today();
  const fromDate = from || `${toDate.slice(0, 4)}-01-01`;

  const opening = await one<{ total: Cents }>(
    'SELECT COALESCE(SUM(amount), 0) AS total FROM vendor_ledger_entry WHERE vendor_id = ? AND posting_date < ?',
    vendor.id, fromDate,
  );
  const rows = await all<{
    posting_date: IsoDate; document_type: VendorLedgerDocumentType; document_no: string; description: string | null;
    due_date: IsoDate | null; amount: Cents; remaining_amount: Cents;
  }>(
    `SELECT posting_date, document_type, document_no, description, due_date, amount, remaining_amount
     FROM vendor_ledger_entry
     WHERE vendor_id = ? AND posting_date >= ? AND posting_date <= ?
     ORDER BY posting_date, id`,
    vendor.id, fromDate, toDate,
  );

  let running = opening?.total ?? 0;
  const lines: VendorStatementLine[] = rows.map((r) => {
    running += r.amount;
    return { ...r, running_balance: running };
  });

  return {
    vendor_no: vendor.no,
    vendor_name: vendor.name,
    from: fromDate,
    to: toDate,
    opening_balance: opening?.total ?? 0,
    closing_balance: running,
    lines,
  };
}
