/*
 * Amount-in-words, for the Loan Application printout's "AmountInWords" field (design doc
 * §2.2). Pure, no database access.
 */
import type { Cents } from './types.ts';

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const SCALES = ['', 'Thousand', 'Million', 'Billion'];

function threeDigitsToWords(n: number): string {
  let s = '';
  if (n >= 100) {
    s += `${ONES[Math.floor(n / 100)]} Hundred`;
    n %= 100;
    if (n) s += ' ';
  }
  if (n >= 20) {
    s += TENS[Math.floor(n / 10)];
    if (n % 10) s += `-${ONES[n % 10]}`;
  } else if (n > 0) {
    s += ONES[n];
  }
  return s;
}

function integerToWords(n: number): string {
  if (n === 0) return 'Zero';
  const groups: number[] = [];
  let x = n;
  while (x > 0) { groups.push(x % 1000); x = Math.floor(x / 1000); }
  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] === 0) continue;
    parts.push(threeDigitsToWords(groups[i]) + (SCALES[i] ? ` ${SCALES[i]}` : ''));
  }
  return parts.join(' ');
}

/** Integer cents -> "Kenya Shillings One Hundred Thousand Only" (or "... and Fifty Cents Only"
 *  when there's a fractional remainder). */
export function amountInWords(cents: Cents, currencyLabel = 'Kenya Shillings'): string {
  const whole = Math.floor(Math.abs(cents) / 100);
  const fraction = Math.round(Math.abs(cents) % 100);
  const wholeWords = integerToWords(whole);
  if (fraction > 0) {
    return `${currencyLabel} ${wholeWords} and ${integerToWords(fraction)} Cents Only`;
  }
  return `${currencyLabel} ${wholeWords} Only`;
}
