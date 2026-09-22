/*
 * Receivables reports — computed live from cust_ledger_entry, the read-only aggregation idiom of
 * lib/gl.ts's getTrialBalance() / lib/fixedAssetReports.ts.
 *
 *  - getAgedAccountsReceivable()  Business Central Report 120 "Aged Accounts Receivable".
 *  - getCustomerStatement()       Business Central Report 116 "Statement".
 */
import { one, all } from './db.ts';
import { AppError } from './errors.ts';
import { today } from './format.ts';
import { applyDateFormula, daysBetween } from './dateFormula.ts';
import { buildFilterClause, type FilterCondition, type FilterFieldDef } from './listFilters.ts';
import type {
  AgedReceivableReport, AgedReceivableRow, Cents, CustLedgerDocumentType, CustomerStatementLine,
  CustomerStatementReport, IsoDate,
} from './types.ts';

export const AGED_AR_FILTER_FIELDS: FilterFieldDef[] = [
  { key: 'customer_posting_group_code', label: 'Posting Group', type: 'select', column: 'c.customer_posting_group_code' },
  { key: 'city', label: 'City', type: 'text', column: 'c.city' },
];

export interface GetAgedAROptions {
  asOf?: IsoDate;
  agingBy?: 'Due Date' | 'Posting Date';
  periodLength?: string;
  search?: string;
  filters?: FilterCondition[];
}

/**
 * Aged Accounts Receivable — per customer, open cust_ledger_entry.remaining_amount bucketed by
 * how far past `agingBy` each entry is at `asOf`. Four ageing buckets sized by `periodLength`
 * (default 30D), plus a "Not Due" column and the running Balance.
 */
export async function getAgedAccountsReceivable(
  { asOf, agingBy = 'Due Date', periodLength = '30D', search = '', filters = [] }: GetAgedAROptions = {},
): Promise<AgedReceivableReport> {
  const cutoff = asOf || today();
  // Period length in days — from the date formula (e.g. 30D → 30, 1M → ~30).
  const p1 = Math.max(1, daysBetween(cutoff, applyDateFormula(cutoff, periodLength || '30D')));
  const b1 = p1;
  const b2 = p1 * 2;
  const b3 = p1 * 3;
  const { clause, params } = buildFilterClause(AGED_AR_FILTER_FIELDS, filters);

  const entries = await all<{
    customer_id: number; customer_no: string; customer_name: string;
    remaining_amount: Cents; anchor_date: IsoDate | null;
  }>(
    `SELECT c.id AS customer_id, c.no AS customer_no, c.name AS customer_name,
            e.remaining_amount_lcy AS remaining_amount,
            ${agingBy === 'Due Date' ? 'COALESCE(e.due_date, e.posting_date)' : 'e.posting_date'} AS anchor_date
     FROM cust_ledger_entry e
     JOIN customer c ON c.id = e.customer_id
     WHERE e.open = 1 AND e.remaining_amount <> 0 AND e.posting_date <= @cutoff
       AND (c.no ILIKE @like OR c.name ILIKE @like)
       ${clause}`,
    { cutoff, like: `%${String(search).trim()}%`, ...params },
  );

  const byCustomer = new Map<number, AgedReceivableRow>();
  for (const e of entries) {
    const row = byCustomer.get(e.customer_id) ?? {
      customer_id: e.customer_id, customer_no: e.customer_no, customer_name: e.customer_name,
      balance: 0, not_due: 0, bucket_1: 0, bucket_2: 0, bucket_3: 0, bucket_over: 0,
    };
    row.balance += e.remaining_amount;
    const overdueDays = e.anchor_date ? daysBetween(e.anchor_date, cutoff) : 0;
    if (overdueDays <= 0) row.not_due += e.remaining_amount;
    else if (overdueDays <= b1) row.bucket_1 += e.remaining_amount;
    else if (overdueDays <= b2) row.bucket_2 += e.remaining_amount;
    else if (overdueDays <= b3) row.bucket_3 += e.remaining_amount;
    else row.bucket_over += e.remaining_amount;
    byCustomer.set(e.customer_id, row);
  }

  const rows = [...byCustomer.values()].sort((a, b) => a.customer_no.localeCompare(b.customer_no));
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

/** Total open receivables at a date — should tie to (Σ Customer Posting Group receivables
 *  accounts) on the trial balance. */
export async function receivablesTotal(asOf: IsoDate): Promise<Cents> {
  const row = await one<{ total: Cents }>(
    'SELECT COALESCE(SUM(remaining_amount_lcy), 0) AS total FROM cust_ledger_entry WHERE open = 1 AND posting_date <= ?', asOf,
  );
  return row?.total ?? 0;
}

/* ------------------------------------------------------------- customer statement */

export async function getCustomerStatement(
  { customerNo, from, to }: { customerNo: string; from?: IsoDate; to?: IsoDate },
): Promise<CustomerStatementReport> {
  const customer = await one<{ id: number; no: string; name: string }>(
    'SELECT id, no, name FROM customer WHERE no = ?', customerNo,
  );
  if (!customer) throw new AppError('Customer not found', 'NOT_FOUND');
  const toDate = to || today();
  const fromDate = from || `${toDate.slice(0, 4)}-01-01`;

  const opening = await one<{ total: Cents }>(
    'SELECT COALESCE(SUM(amount), 0) AS total FROM cust_ledger_entry WHERE customer_id = ? AND posting_date < ?',
    customer.id, fromDate,
  );
  const rows = await all<{
    posting_date: IsoDate; document_type: CustLedgerDocumentType; document_no: string; description: string | null;
    due_date: IsoDate | null; amount: Cents; remaining_amount: Cents;
  }>(
    `SELECT posting_date, document_type, document_no, description, due_date, amount, remaining_amount
     FROM cust_ledger_entry
     WHERE customer_id = ? AND posting_date >= ? AND posting_date <= ?
     ORDER BY posting_date, id`,
    customer.id, fromDate, toDate,
  );

  let running = opening?.total ?? 0;
  const lines: CustomerStatementLine[] = rows.map((r) => {
    running += r.amount;
    return { ...r, running_balance: running };
  });

  return {
    customer_no: customer.no,
    customer_name: customer.name,
    from: fromDate,
    to: toDate,
    opening_balance: opening?.total ?? 0,
    closing_balance: running,
    lines,
  };
}
