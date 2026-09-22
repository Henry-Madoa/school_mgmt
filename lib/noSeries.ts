/*
 * No. Series Management — Business Central's No. Series (Table 308), No. Series
 * Line (Table 309) and the "…Nos." setup fields, ported to this system.
 *
 *  - `no_series`        — the series header: Code, Description, Default/Manual Nos., Date Order.
 *  - `no_series_line`   — one or more date-effective ranges: Starting Date, Starting No.,
 *                         Ending No., Increment-by No., Warning No., Last No./Date Used, Open.
 *  - `no_series_setup`  — which series each numbered document draws from (BC keeps these on the
 *                         setup cards as "Student Nos.", "Invoice Nos." … — consolidated here onto
 *                         the Admin Centre → No. Series card).
 *
 * `getNextNo()` is the faithful GetNextNo(SeriesCode, Date, ModifySeries): find the line whose
 * Starting Date is the latest on or before the document date, take Last No. Used + Increment-by
 * (or Starting No. for the first one), refuse once Ending No. is passed, and stamp the line.
 *
 * `nextSequence()` is the app's existing entry point: it resolves the document → its series via
 * `no_series_setup`, and still falls back to the legacy flat `sequence` counter for any code that
 * has not been migrated onto a series yet, so numbering never breaks mid-upgrade.
 */
import { one, all, run, tx, hasAnyRow, audit } from './db.ts';
import { AppError } from './errors.ts';
import { today } from './format.ts';
import { incrementNo, noExceeds, compareNo } from './noSeriesFormat.ts';
import type { Actor } from './types.ts';
import type {
  NoSeries, NoSeriesLine, NoSeriesWithLines, NoSeriesListRow, DocumentNoSeriesRow,
} from './types.ts';

/* ------------------------------------------------------------------ catalogue */

export interface NoSeriesDocument { code: string; label: string; category: string }

/**
 * Every numbered document in the system and where it sits on the No. Series card. `code` doubles
 * as the default series code and as the key `nextSequence(code)` is still called with across the
 * services. Keep in step with the seed and the add_no_series migration.
 */
export const NO_SERIES_DOCUMENTS: NoSeriesDocument[] = [
  { code: 'STUDENT', label: 'Admission No.', category: 'Academics' },
  { code: 'ADMISSION_APPLICATION', label: 'Admission Application No.', category: 'Academics' },
  { code: 'WORK_TICKET', label: 'Bus Work Ticket No.', category: 'Academics' },
  { code: 'LIBRARY_BOOK', label: 'Library Accession No.', category: 'Academics' },
  { code: 'FEE_INVOICE_RUN', label: 'Fee Invoice Run No.', category: 'Academics' },
  { code: 'JOURNAL', label: 'Journal Voucher No.', category: 'Finance' },
  { code: 'JOURNAL_DRAFT', label: 'Journal Draft No.', category: 'Finance' },
  { code: 'ITEM', label: 'Item No.', category: 'Inventory' },
  { code: 'ITEM_JOURNAL', label: 'Item Journal No.', category: 'Inventory' },
  { code: 'FIXED_ASSET', label: 'Fixed Asset No.', category: 'Fixed Assets' },
  { code: 'FA_JOURNAL', label: 'FA Journal No.', category: 'Fixed Assets' },
  { code: 'CUSTOMER', label: 'Customer No.', category: 'Receivables' },
  { code: 'SALES_QUOTE', label: 'Sales Quote No.', category: 'Receivables' },
  { code: 'SALES_ORDER', label: 'Sales Order No.', category: 'Receivables' },
  { code: 'SALES_INVOICE', label: 'Sales Invoice No.', category: 'Receivables' },
  { code: 'SALES_CREDIT_MEMO', label: 'Sales Credit Memo No.', category: 'Receivables' },
  { code: 'POSTED_SALES_SHIPMENT', label: 'Posted Sales Shipment No.', category: 'Receivables' },
  { code: 'POSTED_SALES_INVOICE', label: 'Posted Sales Invoice No.', category: 'Receivables' },
  { code: 'POSTED_SALES_CREDIT_MEMO', label: 'Posted Sales Credit Memo No.', category: 'Receivables' },
  { code: 'REMINDER', label: 'Reminder No.', category: 'Receivables' },
  { code: 'FIN_CHARGE_MEMO', label: 'Finance Charge Memo No.', category: 'Receivables' },
  { code: 'VENDOR', label: 'Vendor No.', category: 'Payables' },
  { code: 'PURCHASE_QUOTE', label: 'Purchase Quote No.', category: 'Payables' },
  { code: 'PURCHASE_ORDER', label: 'Purchase Order No.', category: 'Payables' },
  { code: 'PURCHASE_INVOICE', label: 'Purchase Invoice No.', category: 'Payables' },
  { code: 'PURCHASE_CREDIT_MEMO', label: 'Purchase Credit Memo No.', category: 'Payables' },
  { code: 'POSTED_PURCHASE_RECEIPT', label: 'Posted Purchase Receipt No.', category: 'Payables' },
  { code: 'POSTED_PURCHASE_INVOICE', label: 'Posted Purchase Invoice No.', category: 'Payables' },
  { code: 'POSTED_PURCHASE_CREDIT_MEMO', label: 'Posted Purchase Credit Memo No.', category: 'Payables' },
  { code: 'RECEIPT', label: 'Receipt No.', category: 'Cash Management' },
  { code: 'POSTED_RECEIPT', label: 'Posted Receipt No.', category: 'Cash Management' },
  { code: 'PAYMENT_VOUCHER', label: 'Payment Voucher No.', category: 'Cash Management' },
  { code: 'POSTED_PAYMENT_VOUCHER', label: 'Posted Payment Voucher No.', category: 'Cash Management' },
  { code: 'BANK_RECONCILIATION', label: 'Bank Reconciliation No.', category: 'Cash Management' },
  { code: 'WHT_CERTIFICATE', label: 'Withholding Tax Certificate No.', category: 'Finance' },
  { code: 'IMPREST_REQUEST', label: 'Imprest Request No.', category: 'Finance' },
  { code: 'PETTY_CASH', label: 'Petty Cash No.', category: 'Finance' },
  { code: 'STAFF_CLAIM', label: 'Staff Claim No.', category: 'Finance' },
  { code: 'STORE_REQUISITION', label: 'Store Requisition No.', category: 'Payables' },
  { code: 'PURCHASE_REQUISITION', label: 'Purchase Requisition No.', category: 'Payables' },
  { code: 'EMPLOYEE', label: 'Employee No.', category: 'HR & Payroll' },
  { code: 'EMPLOYEE_EDIT', label: 'Employee Editing No.', category: 'HR & Payroll' },
  { code: 'EMPLOYEE_CONTRACT_CHANGE', label: 'Contract / Salary Change No.', category: 'HR & Payroll' },
  { code: 'EMPLOYEE_EXIT', label: 'Employee Exit No.', category: 'HR & Payroll' },
  { code: 'COMPANY_JOB', label: 'Company Job No.', category: 'HR & Payroll' },
  { code: 'LEAVE_APPLICATION', label: 'Leave Application No.', category: 'HR & Payroll' },
  { code: 'LEAVE_ADJUSTMENT', label: 'Leave Adjustment No.', category: 'HR & Payroll' },
  { code: 'LEAVE_RECALL', label: 'Leave Recall No.', category: 'HR & Payroll' },
  { code: 'LEAVE_PLAN', label: 'Leave Plan No.', category: 'HR & Payroll' },
];

const DOC_ORDER = new Map(NO_SERIES_DOCUMENTS.map((d, i) => [d.code, i]));
const DOC_META = new Map(NO_SERIES_DOCUMENTS.map((d) => [d.code, d]));

/* -------------------------------------------------------------- number engine */

/** Pick the date-effective line — BC uses the one with the greatest Starting Date not after the
 *  document date; lines with no Starting Date are always in scope. */
function applicableLine(lines: NoSeriesLine[], date: string): NoSeriesLine | undefined {
  const open = lines
    .filter((l) => l.open && (!l.starting_date || l.starting_date <= date))
    .sort((a, b) => (a.starting_date || '').localeCompare(b.starting_date || '') || a.line_no - b.line_no);
  return open[open.length - 1];
}

interface NextNoResult { no: string; line: NoSeriesLine }

async function computeNext(seriesCode: string, date: string, lock: boolean): Promise<NextNoResult> {
  const series = await one<NoSeries>('SELECT * FROM no_series WHERE code = ?', seriesCode);
  if (!series) throw new AppError(`No. Series "${seriesCode}" is not defined`, 'NO_SERIES_MISSING');

  const lines = await all<NoSeriesLine>(
    `SELECT * FROM no_series_line WHERE series_code = ? ORDER BY line_no${lock ? ' FOR UPDATE' : ''}`,
    seriesCode,
  );
  const line = applicableLine(lines, date);
  if (!line) {
    if (lines.length && lines.every((l) => !l.open)) {
      throw new AppError(`No. Series "${seriesCode}" has run out of numbers`, 'NO_SERIES_EXHAUSTED');
    }
    throw new AppError(
      lines.length
        ? `No. Series "${seriesCode}" has no line effective on ${date}`
        : `No. Series "${seriesCode}" has no lines — add a range with a Starting No.`,
      'NO_SERIES_NO_LINE',
    );
  }
  if (series.date_order && line.last_date_used && line.last_date_used > date) {
    throw new AppError(
      `No. Series "${seriesCode}" runs in date order — its last number was assigned on `
      + `${line.last_date_used}, which is after ${date}`, 'NO_SERIES_DATE_ORDER',
    );
  }

  const no = line.last_no_used
    ? incrementNo(line.last_no_used, line.increment_by_no || 1)
    : line.starting_no;
  if (noExceeds(no, line.ending_no)) {
    throw new AppError(
      `No. Series "${seriesCode}" has run out — ${line.ending_no} is its last number`,
      'NO_SERIES_EXHAUSTED',
    );
  }
  return { no, line };
}

/**
 * BC's NoSeriesManagement.GetNextNo(SeriesCode, PostingDate, true): hand out the next number and
 * advance the line. Serialised per series by `SELECT … FOR UPDATE` inside the surrounding
 * transaction, so two clerks can never be given the same number.
 */
export async function getNextNo(seriesCode: string, date?: string): Promise<string> {
  const d = date || today();
  return tx(async () => {
    const { no, line } = await computeNext(seriesCode, d, true);
    // The line closes once its next number would spill past Ending No.
    const willClose = !!line.ending_no
      && noExceeds(incrementNo(no, line.increment_by_no || 1), line.ending_no);
    await run(
      'UPDATE no_series_line SET last_no_used = ?, last_date_used = ?, open = ? WHERE id = ?',
      no, d, willClose ? 0 : 1, line.id,
    );
    return no;
  });
}

/**
 * GetNextNo `count` times in one round trip — the same numbers, the same line advance, but the
 * series is read and written once instead of once per document.
 *
 * For a batch that issues thousands of ledger entries at a stroke (an invoice run billing
 * every student), asking the database for each number in turn costs more than the posting itself.
 * The numbers are still contiguous, still serialised by the same `FOR UPDATE`, and still stop at
 * the line’s Ending No.
 */
export async function nextSequenceBatch(name: string, count: number, date?: string): Promise<string[]> {
  if (count <= 0) return [];
  const d = date || today();
  const setup = await one<{ series_code: string | null }>(
    'SELECT series_code FROM no_series_setup WHERE document_code = ?', name,
  );
  const seriesCode = setup?.series_code || name;
  if (!(await hasAnyRow('no_series', 'code = ?', seriesCode))) {
    // The legacy flat counter advances by `count` in one UPDATE and the block is expanded here.
    const row = await one<{ prefix: string; next_no: number; width: number }>(
      'UPDATE sequence SET next_no = next_no + ? WHERE name = ? RETURNING prefix, next_no - ? AS next_no, width',
      count, name, count,
    );
    if (!row) throw new Error('Unknown sequence: ' + name);
    return Array.from({ length: count }, (_, i) =>
      row.prefix + String(Number(row.next_no) + i).padStart(row.width, '0'));
  }

  return tx(async () => {
    const { no, line } = await computeNext(seriesCode, d, true);
    const step = line.increment_by_no || 1;
    const numbers: string[] = [no];
    let last = no;
    for (let i = 1; i < count; i += 1) {
      last = incrementNo(last, step);
      if (noExceeds(last, line.ending_no)) {
        throw new AppError(
          `No. Series "${seriesCode}" has only ${numbers.length} of the ${count} numbers this batch needs`,
          'NO_SERIES_EXHAUSTED',
        );
      }
      numbers.push(last);
    }
    const willClose = !!line.ending_no && noExceeds(incrementNo(last, step), line.ending_no);
    await run(
      'UPDATE no_series_line SET last_no_used = ?, last_date_used = ?, open = ? WHERE id = ?',
      last, d, willClose ? 0 : 1, line.id,
    );
    return numbers;
  });
}

/** GetNextNo with ModifySeries = false — what the number *would* be, no side effect. */
export async function peekNextNo(seriesCode: string, date?: string): Promise<string | null> {
  try {
    const { no } = await computeNext(seriesCode, date || today(), false);
    return no;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------- app-wide entry point */

async function legacyNextSequence(name: string): Promise<string> {
  const row = await one<{ prefix: string; next_no: number; width: number }>(
    'UPDATE sequence SET next_no = next_no + 1 WHERE name = ? RETURNING prefix, next_no - 1 AS next_no, width',
    name,
  );
  if (!row) throw new Error('Unknown sequence: ' + name);
  return row.prefix + String(row.next_no).padStart(row.width, '0');
}

/**
 * The services call this with a *document* code. Resolve it to a series through `no_series_setup`
 * (so an admin can repoint "Student No." at a different series), use the No. Series engine when one
 * exists, and otherwise fall back to the flat `sequence` counter.
 */
export async function nextSequence(name: string, date?: string): Promise<string> {
  const setup = await one<{ series_code: string | null }>(
    'SELECT series_code FROM no_series_setup WHERE document_code = ?', name,
  );
  const seriesCode = setup?.series_code || name;
  if (await hasAnyRow('no_series', 'code = ?', seriesCode)) return getNextNo(seriesCode, date);
  return legacyNextSequence(name);
}

/* --------------------------------------------------------------- admin: read */

export async function listNoSeries(): Promise<NoSeriesListRow[]> {
  const rows = await all<NoSeries & {
    line_count: number; starting_no: string | null; ending_no: string | null;
    last_no_used: string | null; last_date_used: string | null; increment_by_no: number | null;
    starting_date: string | null; used_by: number;
  }>(
    `SELECT s.*,
            COUNT(l.id)                                              AS line_count,
            (ARRAY_AGG(l.starting_no      ORDER BY l.line_no DESC))[1] AS starting_no,
            (ARRAY_AGG(l.ending_no        ORDER BY l.line_no DESC))[1] AS ending_no,
            (ARRAY_AGG(l.last_no_used     ORDER BY l.line_no DESC))[1] AS last_no_used,
            (ARRAY_AGG(l.last_date_used   ORDER BY l.line_no DESC))[1] AS last_date_used,
            (ARRAY_AGG(l.increment_by_no  ORDER BY l.line_no DESC))[1] AS increment_by_no,
            (ARRAY_AGG(l.starting_date    ORDER BY l.line_no DESC))[1] AS starting_date,
            (SELECT COUNT(*) FROM no_series_setup ns WHERE ns.series_code = s.code) AS used_by
     FROM no_series s
     LEFT JOIN no_series_line l ON l.series_code = s.code
     GROUP BY s.code
     ORDER BY s.code`,
  );
  const out: NoSeriesListRow[] = [];
  for (const r of rows) {
    out.push({ ...r, line_count: Number(r.line_count), used_by: Number(r.used_by), next_no: await peekNextNo(r.code) });
  }
  return out;
}

/** Every series with its lines and a live next-number preview — the No. Series admin screen. */
export async function listNoSeriesWithLines(): Promise<(NoSeriesWithLines & { next_no: string | null; used_by: number })[]> {
  const [series, lines] = await Promise.all([
    all<NoSeries>('SELECT * FROM no_series ORDER BY code'),
    all<NoSeriesLine>('SELECT * FROM no_series_line ORDER BY series_code, line_no'),
  ]);
  const usage = await all<{ series_code: string; c: number }>(
    'SELECT series_code, COUNT(*) AS c FROM no_series_setup WHERE series_code IS NOT NULL GROUP BY series_code',
  );
  const usedBy = new Map(usage.map((u) => [u.series_code, Number(u.c)]));
  const out: (NoSeriesWithLines & { next_no: string | null; used_by: number })[] = [];
  for (const s of series) {
    out.push({
      ...s,
      lines: lines.filter((l) => l.series_code === s.code),
      used_by: usedBy.get(s.code) ?? 0,
      next_no: await peekNextNo(s.code),
    });
  }
  return out;
}

export async function getNoSeries(code: string): Promise<NoSeriesWithLines | undefined> {
  const series = await one<NoSeries>('SELECT * FROM no_series WHERE code = ?', code);
  if (!series) return undefined;
  const lines = await all<NoSeriesLine>(
    'SELECT * FROM no_series_line WHERE series_code = ? ORDER BY line_no', code,
  );
  return { ...series, lines };
}

/** The Admin Centre → No. Series card: one row per numbered document, grouped by module. */
export async function listDocumentNoSeries(): Promise<DocumentNoSeriesRow[]> {
  const rows = await all<{
    document_code: string; label: string; category: string; sort: number;
    series_code: string | null; series_description: string | null;
    last_no_used: string | null; manual_nos: number | null;
  }>(
    `SELECT ns.document_code, ns.label, ns.category, ns.sort,
            ns.series_code, s.description AS series_description, s.manual_nos,
            (SELECT l.last_no_used FROM no_series_line l
              WHERE l.series_code = ns.series_code ORDER BY l.line_no DESC LIMIT 1) AS last_no_used
     FROM no_series_setup ns
     LEFT JOIN no_series s ON s.code = ns.series_code`,
  );
  const withNext = await Promise.all(rows.map(async (r) => ({
    document_code: r.document_code,
    label: r.label,
    category: r.category,
    sort: DOC_ORDER.get(r.document_code) ?? r.sort,
    series_code: r.series_code,
    series_description: r.series_description,
    last_no_used: r.last_no_used,
    manual_nos: Number(r.manual_nos ?? 0),
    next_no: r.series_code ? await peekNextNo(r.series_code) : null,
  })));
  return withNext.sort((a, b) =>
    a.category.localeCompare(b.category) || a.sort - b.sort || a.label.localeCompare(b.label));
}

export const listNoSeriesCodes = (): Promise<{ code: string; description: string }[]> =>
  all('SELECT code, description FROM no_series ORDER BY code');

/* -------------------------------------------------------------- admin: write */

const norm = (v: unknown): string => String(v ?? '').trim();
const optNo = (v: unknown): string | null => (norm(v) === '' ? null : norm(v).toUpperCase());

export interface NoSeriesInput {
  code: string;
  description: string;
  defaultNos: boolean;
  manualNos: boolean;
  dateOrder: boolean;
}

export async function saveNoSeries(input: NoSeriesInput, original: string | null, user: Actor): Promise<void> {
  const code = norm(input.code).toUpperCase();
  if (!code) throw new AppError('A No. Series needs a code');
  if (!/^[A-Z0-9._-]+$/.test(code)) throw new AppError('Code may use letters, digits, dot, dash and underscore only');

  if (original && original !== code) throw new AppError('The code of an existing No. Series cannot be changed');

  const exists = await hasAnyRow('no_series', 'code = ?', code);
  if (exists && !original) throw new AppError(`No. Series "${code}" already exists`);

  if (original) {
    await run(
      'UPDATE no_series SET description = ?, default_nos = ?, manual_nos = ?, date_order = ? WHERE code = ?',
      norm(input.description), input.defaultNos ? 1 : 0, input.manualNos ? 1 : 0, input.dateOrder ? 1 : 0, code,
    );
  } else {
    await run(
      'INSERT INTO no_series (code, description, default_nos, manual_nos, date_order) VALUES (?,?,?,?,?)',
      code, norm(input.description), input.defaultNos ? 1 : 0, input.manualNos ? 1 : 0, input.dateOrder ? 1 : 0,
    );
  }
  await audit(user, original ? 'NO_SERIES_UPDATE' : 'NO_SERIES_CREATE', 'no_series', code, input);
}

export async function deleteNoSeries(code: string, user: Actor): Promise<void> {
  if (await hasAnyRow('no_series_setup', 'series_code = ?', code)) {
    throw new AppError('This series is still assigned to one or more documents — reassign them first');
  }
  await run('DELETE FROM no_series_line WHERE series_code = ?', code);
  await run('DELETE FROM no_series WHERE code = ?', code);
  await audit(user, 'NO_SERIES_DELETE', 'no_series', code);
}

export interface NoSeriesLineInput {
  id?: number | null;
  seriesCode: string;
  startingDate: string | null;
  startingNo: string;
  endingNo: string | null;
  warningNo: string | null;
  incrementByNo: number;
  lastNoUsed: string | null;
  allowGaps: boolean;
}

export async function saveNoSeriesLine(input: NoSeriesLineInput, user: Actor): Promise<void> {
  const seriesCode = norm(input.seriesCode).toUpperCase();
  if (!(await hasAnyRow('no_series', 'code = ?', seriesCode))) throw new AppError('Unknown No. Series');

  const startingNo = optNo(input.startingNo);
  if (!startingNo) throw new AppError('Starting No. is required');
  const endingNo = optNo(input.endingNo);
  const lastNoUsed = optNo(input.lastNoUsed);
  const warningNo = optNo(input.warningNo);
  const increment = Math.max(1, Math.trunc(Number(input.incrementByNo) || 1));

  if (endingNo && compareNo(startingNo, endingNo) > 0) {
    throw new AppError('Ending No. must not come before Starting No.');
  }
  if (lastNoUsed && endingNo && noExceeds(lastNoUsed, endingNo)) {
    throw new AppError('Last No. Used is already past Ending No.');
  }
  // BC re-opens the line whenever there is still room under Ending No.
  const stillOpen = !endingNo || !lastNoUsed || !noExceeds(incrementNo(lastNoUsed, increment), endingNo);

  if (input.id) {
    await run(
      `UPDATE no_series_line SET starting_date = ?, starting_no = ?, ending_no = ?, warning_no = ?,
              increment_by_no = ?, last_no_used = ?, allow_gaps = ?, open = ? WHERE id = ?`,
      input.startingDate || null, startingNo, endingNo, warningNo, increment,
      lastNoUsed, input.allowGaps ? 1 : 0, stillOpen ? 1 : 0, input.id,
    );
  } else {
    const maxLine = await one<{ m: number | null }>(
      'SELECT MAX(line_no) AS m FROM no_series_line WHERE series_code = ?', seriesCode,
    );
    await run(
      `INSERT INTO no_series_line (series_code, line_no, starting_date, starting_no, ending_no,
              warning_no, increment_by_no, last_no_used, allow_gaps, open)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      seriesCode, (maxLine?.m ?? 0) + 10000, input.startingDate || null, startingNo, endingNo,
      warningNo, increment, lastNoUsed, input.allowGaps ? 1 : 0, stillOpen ? 1 : 0,
    );
  }
  await audit(user, input.id ? 'NO_SERIES_LINE_UPDATE' : 'NO_SERIES_LINE_CREATE', 'no_series_line', input.id ?? seriesCode, input);
}

export async function deleteNoSeriesLine(id: number, user: Actor): Promise<void> {
  const line = await one<{ series_code: string }>('SELECT series_code FROM no_series_line WHERE id = ?', id);
  if (!line) return;
  const count = await one<{ c: number }>(
    'SELECT COUNT(*) AS c FROM no_series_line WHERE series_code = ?', line.series_code,
  );
  if (Number(count?.c ?? 0) <= 1) throw new AppError('A No. Series must keep at least one line');
  await run('DELETE FROM no_series_line WHERE id = ?', id);
  await audit(user, 'NO_SERIES_LINE_DELETE', 'no_series_line', id);
}

export async function assignDocumentNoSeries(
  documentCode: string, seriesCode: string | null, user: Actor,
): Promise<void> {
  const meta = DOC_META.get(documentCode);
  const known = await hasAnyRow('no_series_setup', 'document_code = ?', documentCode);
  if (!meta && !known) throw new AppError(`Unknown numbered document "${documentCode}"`);

  const series = seriesCode ? norm(seriesCode).toUpperCase() : null;
  if (series && !(await hasAnyRow('no_series', 'code = ?', series))) {
    throw new AppError(`No. Series "${series}" is not defined`);
  }
  if (known) {
    await run('UPDATE no_series_setup SET series_code = ? WHERE document_code = ?', series, documentCode);
  } else {
    await run(
      'INSERT INTO no_series_setup (document_code, label, category, sort, series_code) VALUES (?,?,?,?,?)',
      documentCode, meta!.label, meta!.category, DOC_ORDER.get(documentCode) ?? 0, series,
    );
  }
  await audit(user, 'NO_SERIES_ASSIGN', 'no_series_setup', documentCode, { seriesCode: series });
}
