/*
 * A student's fee statement — the customer ledger of their fee account, with a running balance,
 * and the paid/owing summary the portals and the Student 360 show.
 */
import { one, all } from '../db.ts';
import { AppError } from '../errors.ts';
import type { Cents, FeeStatementLine, IsoDate } from '../types.ts';

export interface FeeAccountSummary {
  customer_id: number;
  customer_no: string;
  balance: Cents;
  overdue: Cents;
  invoiced: Cents;
  paid: Cents;
  last_payment_date: IsoDate | null;
  next_due_date: IsoDate | null;
}

export async function feeAccountSummary(studentId: number): Promise<FeeAccountSummary | null> {
  const asOf = new Date().toISOString().slice(0, 10);
  return (await one<FeeAccountSummary>(
    `SELECT c.id AS customer_id, c.no AS customer_no, COALESCE(c.balance, 0) AS balance,
            COALESCE((SELECT SUM(cle.remaining_amount_lcy) FROM cust_ledger_entry cle WHERE cle.customer_id = c.id AND cle.open = 1 AND cle.positive = 1 AND cle.due_date < ?), 0) AS overdue,
            COALESCE((SELECT SUM(cle.amount_lcy) FROM cust_ledger_entry cle WHERE cle.customer_id = c.id AND cle.document_type = 'Invoice'), 0) AS invoiced,
            COALESCE((SELECT SUM(-cle.amount_lcy) FROM cust_ledger_entry cle WHERE cle.customer_id = c.id AND cle.document_type = 'Payment'), 0) AS paid,
            (SELECT MAX(cle.posting_date) FROM cust_ledger_entry cle WHERE cle.customer_id = c.id AND cle.document_type = 'Payment') AS last_payment_date,
            (SELECT MIN(cle.due_date) FROM cust_ledger_entry cle WHERE cle.customer_id = c.id AND cle.open = 1 AND cle.positive = 1) AS next_due_date
     FROM student s JOIN customer c ON c.id = s.customer_id WHERE s.id = ?`, asOf, studentId,
  )) ?? null;
}

export async function feeStatement(studentId: number, from?: IsoDate | null, to?: IsoDate | null): Promise<{ opening: Cents; lines: FeeStatementLine[]; closing: Cents }> {
  const s = await one<{ customer_id: number | null }>('SELECT customer_id FROM student WHERE id = ?', studentId);
  if (!s?.customer_id) throw new AppError('This student has no fee account yet', 'NOT_FOUND');
  const toDate = to || new Date().toISOString().slice(0, 10);
  const fromDate = from || '1900-01-01';
  const opening = await one<{ total: Cents }>('SELECT COALESCE(SUM(amount_lcy), 0) AS total FROM cust_ledger_entry WHERE customer_id = ? AND posting_date < ?', s.customer_id, fromDate);
  const rows = await all<Omit<FeeStatementLine, 'running_balance'>>(
    `SELECT id, posting_date, document_type, document_no, description, amount_lcy AS amount, remaining_amount_lcy AS remaining_amount, due_date
     FROM cust_ledger_entry WHERE customer_id = ? AND posting_date >= ? AND posting_date <= ? ORDER BY posting_date, id`,
    s.customer_id, fromDate, toDate,
  );
  let running = Number(opening?.total ?? 0);
  const lines = rows.map((r) => { running += Number(r.amount); return { ...r, amount: Number(r.amount), remaining_amount: Number(r.remaining_amount), running_balance: running }; });
  return { opening: Number(opening?.total ?? 0), lines, closing: running };
}

/** The posted invoice's own lines — what a fee invoice was made up of. */
export const feeInvoiceLines = (postedInvoiceNo: string): Promise<{ description: string | null; amount: Cents }[]> =>
  all(
    `SELECT l.description, l.line_amount AS amount FROM posted_sales_line l JOIN posted_sales_document d ON d.id = l.posted_sales_document_id
     WHERE d.no = ? ORDER BY l.line_no`, postedInvoiceNo,
  );
