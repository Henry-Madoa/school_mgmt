import type { IsoDate } from './types.ts';

/** `n` calendar months after `isoDate`, clamped to the last day of the target month. */
export function addMonths(isoDate: IsoDate, n: number): IsoDate {
  const d = new Date(isoDate + 'T00:00:00Z');
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString().slice(0, 10);
}

/** The last calendar day of the month `monthsAhead` months after `isoDate` — Business Central's
 *  CalcDate('CM', ...) / CalcDate('CM+1M', ...). */
export function endOfMonth(isoDate: IsoDate, monthsAhead = 0): IsoDate {
  const d = new Date(isoDate + 'T00:00:00Z');
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + monthsAhead + 1, 0));
  return end.toISOString().slice(0, 10);
}
