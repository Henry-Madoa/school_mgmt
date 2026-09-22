/*
 * Fixed Asset reports — computed live from fa_ledger_entry, the same read-only aggregation
 * idiom as getTrialBalance() in lib/gl.ts. Nothing here persists.
 */
import { one, all } from './db.ts';
import { AppError } from './errors.ts';
import { today } from './format.ts';
import { buildFilterClause, type FilterCondition, type FilterFieldDef } from './listFilters.ts';
import type { Cents, FaBookValueReport, FaBookValueRow, IsoDate } from './types.ts';

export const FA_BOOK_VALUE_FILTER_FIELDS: FilterFieldDef[] = [
  { key: 'fa_class_code', label: 'FA Class', type: 'select', column: 'fa.fa_class_code' },
  { key: 'fa_location_code', label: 'FA Location', type: 'select', column: 'fa.fa_location_code' },
];

export interface GetFaBookValueOptions {
  bookCode?: string;
  asOf?: IsoDate;
  search?: string;
  filters?: FilterCondition[];
}

/**
 * FA Book Value report (Business Central Report 5601) — per asset, the acquisition cost,
 * depreciation, write-down, appreciation and resulting book value as of a date, for one
 * depreciation book.
 */
export async function getFaBookValueReport(
  { bookCode, asOf, search = '', filters = [] }: GetFaBookValueOptions = {},
): Promise<FaBookValueReport> {
  const book = bookCode
    ?? (await one<{ code: string }>(
      'SELECT COALESCE((SELECT default_depreciation_book_code FROM fa_setup WHERE id = 1), (SELECT MIN(code) FROM depreciation_book)) AS code',
    ))?.code;
  if (!book) throw new AppError('No depreciation book is configured', 'VALIDATION');
  const cutoff = asOf || today();
  const { clause, params } = buildFilterClause(FA_BOOK_VALUE_FILTER_FIELDS, filters);

  const rows = await all<FaBookValueRow>(
    `SELECT fa.id AS fixed_asset_id, fa.no AS fixed_asset_no, fa.description AS fixed_asset_description,
            fa.fa_class_code AS fa_class_code,
            COALESCE(SUM(CASE WHEN e.fa_posting_type = 'Acquisition Cost' THEN e.amount ELSE 0 END), 0) AS acquisition_cost,
            COALESCE(SUM(CASE WHEN e.fa_posting_type = 'Depreciation'      THEN e.amount ELSE 0 END), 0) AS depreciation,
            COALESCE(SUM(CASE WHEN e.fa_posting_type = 'Write-Down'        THEN e.amount ELSE 0 END), 0) AS write_down,
            COALESCE(SUM(CASE WHEN e.fa_posting_type = 'Appreciation'      THEN e.amount ELSE 0 END), 0) AS appreciation,
            COALESCE(SUM(CASE WHEN e.part_of_book_value = 1 THEN e.amount ELSE 0 END), 0) AS book_value,
            (fa.disposal_date IS NOT NULL AND fa.disposal_date <= @cutoff) AS disposed
     FROM fixed_asset fa
     LEFT JOIN fa_ledger_entry e ON e.fixed_asset_id = fa.id
       AND e.depreciation_book_code = @book
       AND e.fa_posting_date <= @cutoff
     WHERE 1=1
       ${search ? 'AND (fa.no ILIKE @like OR fa.description ILIKE @like)' : ''}
       ${clause}
     GROUP BY fa.id, fa.no, fa.description, fa.fa_class_code, fa.disposal_date
     HAVING COALESCE(SUM(CASE WHEN e.fa_posting_type = 'Acquisition Cost' THEN e.amount ELSE 0 END), 0) <> 0
     ORDER BY fa.no`,
    { book, cutoff, like: `%${String(search).trim()}%`, ...params },
  );

  const totals = rows.reduce(
    (acc, r) => ({
      acquisition_cost: acc.acquisition_cost + r.acquisition_cost,
      depreciation: acc.depreciation + r.depreciation,
      write_down: acc.write_down + r.write_down,
      appreciation: acc.appreciation + r.appreciation,
      book_value: acc.book_value + r.book_value,
    }),
    { acquisition_cost: 0, depreciation: 0, write_down: 0, appreciation: 0, book_value: 0 },
  );

  return { book_code: book, as_of: cutoff, rows, totals };
}

/** Total book value across a depreciation book at a date — the figure that should tie to
 *  (cost accounts − accumulated depreciation accounts) on the trial balance. */
export async function faBookValueTotal(bookCode: string, asOf: IsoDate): Promise<Cents> {
  const row = await one<{ total: Cents }>(
    `SELECT COALESCE(SUM(CASE WHEN part_of_book_value = 1 THEN amount ELSE 0 END), 0) AS total
     FROM fa_ledger_entry WHERE depreciation_book_code = ? AND fa_posting_date <= ?`,
    bookCode, asOf,
  );
  return row?.total ?? 0;
}
