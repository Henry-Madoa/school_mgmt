/*
 * Business Central "DateFormula" evaluator — the little language Payment Terms, Reminder Levels
 * and Finance Charge Terms use for Due Date / Discount Date / Grace Period calculations.
 *
 * Supported terms (case-insensitive), chained left to right with optional `+` / `-` separators:
 *   <sign><n><D|W|M|Q|Y>   add n days / weeks / months / quarters / years   (e.g. 30D, -14D, 1M)
 *   C<D|W|M|Q|Y>           jump to the end of the current day/week/month/quarter/year (CM, CY)
 *   <n>                    a bare number is treated as days (BC's own shorthand)
 *
 * e.g.  `30D` = +30 days · `1M` = +1 month · `CM` = end of this month · `CM+10D` = the 10th of
 * next month · `CQ` = end of this quarter. An empty formula returns the base date unchanged.
 *
 * This is a focused subset — BC also supports `W` week-of-year and `WD` weekday anchors, which no
 * Payment Terms / Reminder setup in this app needs.
 */
import { addMonths } from './dates.ts';
import type { IsoDate } from './types.ts';

const isoOf = (d: Date): IsoDate => d.toISOString().slice(0, 10);
const parseIso = (d: IsoDate): Date => new Date(`${d}T00:00:00Z`);

function addDays(iso: IsoDate, n: number): IsoDate {
  return isoOf(new Date(parseIso(iso).getTime() + n * 86_400_000));
}

/** End of the calendar period containing `iso`. */
function endOfPeriod(iso: IsoDate, unit: 'D' | 'W' | 'M' | 'Q' | 'Y'): IsoDate {
  const d = parseIso(iso);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (unit) {
    case 'D': return iso;
    case 'W': {
      // BC weeks end on Sunday (ISO day 7); getUTCDay() Sunday = 0.
      const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
      return addDays(iso, 7 - dow);
    }
    case 'M': return isoOf(new Date(Date.UTC(y, m + 1, 0)));
    case 'Q': {
      const qEndMonth = Math.floor(m / 3) * 3 + 3; // 3, 6, 9, 12
      return isoOf(new Date(Date.UTC(y, qEndMonth, 0)));
    }
    case 'Y': return `${y}-12-31`;
    default: return iso;
  }
}

const TERM = /([+-]?)\s*(C?)(\d*)\s*([DWMQY]?)/gi;

export function applyDateFormula(baseDate: IsoDate, formula: string | null | undefined): IsoDate {
  const f = String(formula ?? '').trim();
  if (!f) return baseDate;

  let result = baseDate;
  let matched = false;
  for (const m of f.matchAll(TERM)) {
    const [whole, sign, current, digits, unitRaw] = m;
    if (!whole.trim()) continue;
    matched = true;
    const unit = (unitRaw || 'D').toUpperCase() as 'D' | 'W' | 'M' | 'Q' | 'Y';
    const s = sign === '-' ? -1 : 1;

    if (current.toUpperCase() === 'C') {
      result = endOfPeriod(result, unit);
      if (digits) {
        // "CM+10D" style trailing offset is a separate term; a digit glued to C (rare) is an offset too.
        result = shift(result, s * Number(digits), unit);
      }
      continue;
    }
    if (!digits) continue;
    result = shift(result, s * Number(digits), unit);
  }
  return matched ? result : baseDate;
}

function shift(iso: IsoDate, n: number, unit: 'D' | 'W' | 'M' | 'Q' | 'Y'): IsoDate {
  switch (unit) {
    case 'D': return addDays(iso, n);
    case 'W': return addDays(iso, n * 7);
    case 'M': return addMonths(iso, n);
    case 'Q': return addMonths(iso, n * 3);
    case 'Y': return addMonths(iso, n * 12);
    default: return iso;
  }
}

/** Whole days between two ISO dates (b − a), calendar days, ignoring time. */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((parseIso(b).getTime() - parseIso(a).getTime()) / 86_400_000);
}

/** Reject a formula the evaluator cannot make sense of (surfaced by the setup validators). */
export function isValidDateFormula(formula: string | null | undefined): boolean {
  const f = String(formula ?? '').trim();
  if (!f) return true;
  return /^([+-]?\s*(C[DWMQY]|\d+\s*[DWMQY]?)\s*)+$/i.test(f);
}
