/*
 * Fixed Asset depreciation engine — Business Central domain knowledge, no AL source to port
 * (see lib/faJournal.ts's header). Supports the four commonly-used methods:
 *
 *   - Straight-Line          a fixed fraction of the depreciable basis per period, from the
 *                            useful life (No. of Depreciation Years / Depreciation Ending Date)
 *                            or an explicit Straight-Line %.
 *   - Declining-Balance 1    Declining-Balance % of the current book value per period.
 *   - DB1/SL                 the larger of the two each period (BC switches permanently to SL
 *                            once SL >= DB — approximated here as a per-period max, which
 *                            converges to the same total; documented simplification).
 *   - Manual                 never auto-calculated; the user posts Depreciation lines by hand.
 *
 * Day count follows Business Central's 30/360 convention (DeprBook."Fiscal Year 365 Days" is
 * off by default): every month is 30 days, every year 360. Depreciation stops when Book Value
 * reaches Salvage Value, and the Depreciation Book's Default Final Rounding Amount sweeps up a
 * small remainder so an asset lands exactly on its salvage value.
 *
 * calculateDepreciation() is the Calculate Depreciation batch (BC Report 5692): it drafts Open
 * FA Journal lines for the whole book, which then go through the normal submit -> approve ->
 * post flow. It posts nothing itself.
 */
import { one, all, run, audit, nextSequence } from './db.ts';
import { AppError } from './errors.ts';
import type { Actor, Cents, FaDepreciationMethod, FaDepreciationSuggestion, IsoDate } from './types.ts';

/** Business Central's 30/360 day count between two ISO dates (from exclusive of nothing —
 *  both endpoints are real posting dates; BC counts the interval inclusive of the start day's
 *  remaining life, i.e. the plain difference). Clamps day-of-month to 30. */
export function depreciationDays(fromDate: IsoDate, toDate: IsoDate): number {
  if (!fromDate || !toDate || toDate <= fromDate) return 0;
  const [y1, m1, d1raw] = fromDate.split('-').map(Number);
  const [y2, m2, d2raw] = toDate.split('-').map(Number);
  const d1 = Math.min(d1raw, 30);
  const d2 = Math.min(d2raw, 30);
  return (y2 - y1) * 360 + (m2 - m1) * 30 + (d2 - d1);
}

export interface DepreciationInputs {
  depreciation_method: FaDepreciationMethod;
  depreciation_starting_date: IsoDate | null;
  depreciation_ending_date: IsoDate | null;
  no_of_depreciation_years: number | null;
  straight_line_pct: number;
  declining_balance_pct: number;
  salvage_value: Cents;
  last_depreciation_date: IsoDate | null;
  acquisition_cost: Cents;
  accumulated_depreciation: Cents; // stored as a negative number (a reduction)
  write_down_amount: Cents;        // stored as a negative number
  appreciation_amount: Cents;      // stored as a positive number
  book_value: Cents;
  disposed: 0 | 1;
}

export interface DepreciationResult {
  /** Negative — the amount to post as a Depreciation FA Journal line (its own `amount` field is
   *  the absolute value; this is the signed ledger effect). */
  amount: Cents;
  days: number;
  newBookValue: Cents;
}

/** The straight-line rate as a fraction per year (0..1). Prefers an explicit Straight-Line %,
 *  then No. of Depreciation Years, then derives it from the Depreciation Ending Date. */
function straightLineYearRate(b: DepreciationInputs): number {
  if (b.straight_line_pct > 0) return b.straight_line_pct / 100;
  if (b.no_of_depreciation_years && b.no_of_depreciation_years > 0) return 1 / b.no_of_depreciation_years;
  if (b.depreciation_starting_date && b.depreciation_ending_date) {
    const totalDays = depreciationDays(b.depreciation_starting_date, b.depreciation_ending_date);
    if (totalDays > 0) return 360 / totalDays;
  }
  return 0;
}

/**
 * The depreciation to post for one asset+book up to `upToDate`. Read-only and side-effect-free,
 * so it is safe to call speculatively (a live preview) as well as authoritatively (the batch and
 * postFaJournalLine). Returns zero for a Manual book, a disposed asset, or when nothing is due.
 */
export function computeDepreciation(
  b: DepreciationInputs, upToDate: IsoDate, finalRoundingAmount: Cents = 0,
): DepreciationResult {
  const zero: DepreciationResult = { amount: 0, days: 0, newBookValue: b.book_value };
  if (b.disposed) return zero;
  if (b.depreciation_method === 'Manual') return zero;
  if (!b.depreciation_starting_date || upToDate < b.depreciation_starting_date) return zero;

  const from = b.last_depreciation_date && b.last_depreciation_date > b.depreciation_starting_date
    ? b.last_depreciation_date
    : b.depreciation_starting_date;
  const days = depreciationDays(from, upToDate);
  if (days <= 0) return zero;

  // Basis: acquisition cost + write-downs (negative) + appreciation, less salvage. Book Value is
  // acquisition + accum. depreciation (negative) + write-down (negative) + appreciation.
  const depreciableBasis = b.acquisition_cost + b.write_down_amount + b.appreciation_amount - b.salvage_value;
  const roomToDepreciate = b.book_value - b.salvage_value;
  if (depreciableBasis <= 0 || roomToDepreciate <= 0) return zero;

  let periodAmount = 0;
  const slYearRate = straightLineYearRate(b);
  const slAmount = Math.round(depreciableBasis * slYearRate * days / 360);
  const dbAmount = b.declining_balance_pct > 0
    ? Math.round((b.book_value - b.salvage_value) * (b.declining_balance_pct / 100) * days / 360)
    : 0;

  switch (b.depreciation_method) {
    case 'Straight-Line': periodAmount = slAmount; break;
    case 'Declining-Balance 1': periodAmount = dbAmount; break;
    case 'DB1/SL': periodAmount = Math.max(slAmount, dbAmount); break;
    default: periodAmount = 0;
  }

  // Never depreciate below salvage value.
  periodAmount = Math.min(periodAmount, roomToDepreciate);

  // Final rounding: if what's left after this period is within the rounding amount, take it all.
  if (finalRoundingAmount > 0 && roomToDepreciate - periodAmount <= finalRoundingAmount) {
    periodAmount = roomToDepreciate;
  }

  if (periodAmount <= 0) return zero;
  return { amount: -periodAmount, days, newBookValue: b.book_value - periodAmount };
}

/* ------------------------------------------------------------------ the batch */

interface FaBookRow extends DepreciationInputs {
  fa_depreciation_book_id: number;
  fixed_asset_id: number;
  fixed_asset_no: string;
  fixed_asset_description: string;
  blocked: 0 | 1;
  inactive: 0 | 1;
}

/**
 * Calculate Depreciation (BC Report 5692) — drafts one Open Depreciation FA Journal line per
 * asset on the book with a non-zero amount due at `faPostingDate`. Posts nothing; the lines go
 * through the normal maker-checker flow (or "Post all approved").
 */
export async function calculateDepreciation(
  bookCode: string, faPostingDate: IsoDate, user: Actor,
  opts: { onlyFixedAssetId?: number | null } = {},
): Promise<{ created: number; skipped: number; lines: FaDepreciationSuggestion[] }> {
  if (!faPostingDate) throw new AppError('An FA posting date is required', 'VALIDATION');
  const book = await one<{ code: string; default_final_rounding_amount: Cents }>(
    'SELECT code, default_final_rounding_amount FROM depreciation_book WHERE code = ?', bookCode,
  );
  if (!book) throw new AppError('Unknown depreciation book', 'NOT_FOUND');

  const rows = await all<FaBookRow>(
    `SELECT b.id AS fa_depreciation_book_id, b.fixed_asset_id,
            fa.no AS fixed_asset_no, fa.description AS fixed_asset_description,
            fa.blocked, fa.inactive,
            b.depreciation_method, b.depreciation_starting_date, b.depreciation_ending_date,
            b.no_of_depreciation_years, b.straight_line_pct, b.declining_balance_pct,
            b.salvage_value, b.last_depreciation_date, b.acquisition_cost, b.accumulated_depreciation,
            b.write_down_amount, b.appreciation_amount, b.book_value, b.disposed
     FROM fa_depreciation_book b
     JOIN fixed_asset fa ON fa.id = b.fixed_asset_id
     WHERE b.depreciation_book_code = @bookCode
       ${opts.onlyFixedAssetId ? 'AND b.fixed_asset_id = @onlyId' : ''}
     ORDER BY fa.no`,
    { bookCode, onlyId: opts.onlyFixedAssetId ?? 0 },
  );

  const lines: FaDepreciationSuggestion[] = [];
  let skipped = 0;

  for (const r of rows) {
    if (r.blocked || r.inactive || r.disposed) { skipped += 1; continue; }
    if (r.depreciation_method === 'Manual') { skipped += 1; continue; }
    // Don't create a second Open Depreciation line for the same asset+book+date.
    const dup = await one<{ id: number }>(
      `SELECT id FROM fa_journal_line
       WHERE fixed_asset_id = ? AND depreciation_book_code = ? AND fa_posting_type = 'Depreciation'
         AND status <> 'Processed' AND posting_date = ?`,
      r.fixed_asset_id, bookCode, faPostingDate,
    );
    if (dup) { skipped += 1; continue; }

    const result = computeDepreciation(r, faPostingDate, book.default_final_rounding_amount);
    if (result.amount === 0) { skipped += 1; continue; }

    const no = await nextSequence('FA_JOURNAL');
    await run(
      `INSERT INTO fa_journal_line
        (no, posting_date, fixed_asset_id, depreciation_book_code, fa_posting_type, amount,
         no_of_depreciation_days, description, source, created_at, created_by)
       VALUES (?,?,?,?,'Depreciation',?,?,?, 'CALCULATE_DEPRECIATION', ?, ?)`,
      no, faPostingDate, r.fixed_asset_id, bookCode, Math.abs(result.amount), result.days,
      `Depreciation ${r.fixed_asset_no} to ${faPostingDate}`, new Date().toISOString(), user.username,
    );
    lines.push({
      fixed_asset_id: r.fixed_asset_id,
      fixed_asset_no: r.fixed_asset_no,
      fixed_asset_description: r.fixed_asset_description,
      amount: Math.abs(result.amount),
      days: result.days,
      new_book_value: result.newBookValue,
      no,
    });
  }

  await audit(user, 'FA_CALCULATE_DEPRECIATION', 'depreciation_book', bookCode, {
    faPostingDate, created: lines.length, skipped,
  });
  return { created: lines.length, skipped, lines };
}
