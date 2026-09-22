/*
 * The pure string arithmetic behind No. Series — Business Central's Codeunit 396
 * (NoSeriesManagement) / Table 309 (No. Series Line) number handling, with no
 * database or environment dependencies so `lib/db.ts` can use it without a cycle.
 *
 * A No. ("SO-000123", "M01044", "2026/0001") is treated as
 *   <fixed prefix><the last run of digits><fixed suffix>
 * and only that last digit-run ever changes. BC increments it, re-pads it to at
 * least its original width, and lets it grow past that width on overflow.
 */

interface Parts { prefix: string; digits: string; suffix: string }

/** Split a No. into its fixed text and its (last) numeric run. Returns null when
 *  the string carries no digits at all — an all-text "No." cannot be numbered. */
export function splitNo(no: string): Parts | null {
  const m = no.match(/^(.*?)(\d+)(\D*)$/s);
  return m ? { prefix: m[1], digits: m[2], suffix: m[3] } : null;
}

/** BC's IncrementNoText: add `by` to the numeric run, keeping (at least) its width. */
export function incrementNo(no: string, by = 1): string {
  const p = splitNo(no);
  if (!p) throw new Error(`No. "${no}" has no numeric part to increment`);
  const next = (BigInt(p.digits) + BigInt(Math.trunc(by || 1))).toString();
  const width = p.digits.length;
  return p.prefix + (next.length >= width ? next : next.padStart(width, '0')) + p.suffix;
}

/** How BC orders two Nos. from the same series: compare the fixed text, then the
 *  number by value (not lexically, so "…9" < "…10"). Falls back to a plain string
 *  compare when the two don't share a format. */
export function compareNo(a: string, b: string): number {
  const pa = splitNo(a);
  const pb = splitNo(b);
  if (!pa || !pb || pa.prefix !== pb.prefix || pa.suffix !== pb.suffix) {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  const na = BigInt(pa.digits);
  const nb = BigInt(pb.digits);
  return na < nb ? -1 : na > nb ? 1 : 0;
}

/** `candidate` is past `limit` (the line's Ending No.). */
export const noExceeds = (candidate: string, limit: string | null | undefined): boolean =>
  !!limit && compareNo(candidate, limit) > 0;

/** `candidate` has reached the line's Warning No. (BC starts warning here). */
export const noReachesWarning = (candidate: string, warning: string | null | undefined): boolean =>
  !!warning && compareNo(candidate, warning) >= 0;
