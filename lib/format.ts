/*
 * Presentation helpers. Pure functions with no database or DOM access, so the
 * same code formats a figure on the server during SSR and in the browser after
 * hydration — which is what keeps the two renders byte-identical.
 */
import type { Cents } from './types.ts';

export interface FormatConfig {
  symbol: string;
  locale: string;
  code: string;
}

export interface MoneyOptions extends Partial<FormatConfig> {
  decimals?: number;
  showSymbol?: boolean;
}

export const DEFAULT_FORMAT: FormatConfig = { symbol: 'KSh', locale: 'en-KE', code: 'KES' };

/** Minor units -> "KSh 12,345.00". */
export function formatMoney(cents: Cents | null | undefined, opts: MoneyOptions = {}): string {
  const { symbol = DEFAULT_FORMAT.symbol, locale = DEFAULT_FORMAT.locale, decimals = 2, showSymbol = true } = opts;
  const value = Number(cents || 0) / 100;
  const prefix = showSymbol ? `${symbol} ` : '';
  return prefix + value.toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Minor units -> "KSh 1.2M". For stat tiles and chart axes, where width is scarce. */
export function formatMoneyShort(cents: Cents | null | undefined, opts: Partial<FormatConfig> = {}): string {
  const { symbol = DEFAULT_FORMAT.symbol } = opts;
  const raw = Number(cents || 0);
  const v = Math.abs(raw) / 100;
  const sign = raw < 0 ? '-' : '';
  const prefix = `${symbol} `;
  if (v >= 1e9) return `${sign}${prefix}${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${sign}${prefix}${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${sign}${prefix}${(v / 1e3).toFixed(1)}K`;
  return `${sign}${prefix}${v.toFixed(0)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(String(iso).length <= 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${formatDate(iso)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "2026-08" -> "Aug '26". */
export function formatMonth(ym: string | null | undefined): string {
  if (!ym) return '';
  const [y, m] = String(ym).split('-');
  return `${MONTHS[Number(m) - 1]} '${String(y).slice(2)}`;
}

export const today = (): string => new Date().toISOString().slice(0, 10);

/** "019 · Nyeri" — a county or sub-county with its code in front, or just the name when it has none. */
export const codedName = (c: { code?: string | null; name: string }): string => (c.code ? `${c.code} · ${c.name}` : c.name);

export const startOfYear = (): string => `${new Date().getFullYear()}-01-01`;

/** `iso` shifted by `n` whole days (calendar days, ignoring time). */
export function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** First day of the fiscal year that contains `iso`, given the org's FY start (month 1-12, day
 *  1-31). A FY starting 1 January is the calendar year; one starting in a later month runs into
 *  the next calendar year, so a date before that month belongs to the FY that opened last year. */
export function startOfFiscalYear(iso: string, fyStartMonth = 1, fyStartDay = 1): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const y = d.getUTCFullYear();
  const startThisYear = Date.UTC(y, fyStartMonth - 1, fyStartDay);
  const year = d.getTime() >= startThisYear ? y : y - 1;
  return `${year}-${String(fyStartMonth).padStart(2, '0')}-${String(fyStartDay).padStart(2, '0')}`;
}

/** Last day of the fiscal year that contains `iso` — the day before the next FY starts. */
export function endOfFiscalYear(iso: string, fyStartMonth = 1, fyStartDay = 1): string {
  const start = startOfFiscalYear(iso, fyStartMonth, fyStartDay);
  const startYear = Number(start.slice(0, 4));
  const nextStart = `${startYear + 1}-${String(fyStartMonth).padStart(2, '0')}-${String(fyStartDay).padStart(2, '0')}`;
  return addDaysIso(nextStart, -1);
}

/** One term of a Business-Central-style Date Filter — "T"/"TODAY" (case-insensitive), an ISO
 *  `YYYY-MM-DD`, or a `DD/MM/YYYY`/`DD/MM/YY` date as typed in the BC screenshot this mirrors
 *  ("01/01/26"). Returns null for anything unparseable, so the caller can tell a genuinely
 *  blank side of a range apart from a typo. */
function parseDateFilterTerm(term: string): string | null {
  const t = term.trim();
  if (!t) return null;
  if (/^t(oday)?$/i.test(t)) return today();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const dmy = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

/** Parses a single-line Business Central Date Filter expression into a {from, to} range:
 *  `A..B` (both bounds), `..B` (open start), `A..` (open end), or a bare `A` (that one day
 *  only) — the exact syntax the Filter Totals "Date Filter" field takes, "T"/"TODAY" included
 *  as today's date. Blank or fully unparseable input returns both bounds null (no filter). */
export function parseDateFilterExpression(expr: string): { from: string | null; to: string | null } {
  const e = (expr || '').trim();
  if (!e) return { from: null, to: null };
  if (e.includes('..')) {
    const i = e.indexOf('..');
    return { from: parseDateFilterTerm(e.slice(0, i)), to: parseDateFilterTerm(e.slice(i + 2)) };
  }
  const single = parseDateFilterTerm(e);
  return { from: single, to: single };
}

/** The reverse of parseDateFilterExpression — {from, to} back into the one-line expression a
 *  Date Filter box should display, so the field round-trips through a page reload or a Back
 *  navigation instead of going blank. */
export function formatDateFilterExpression(from: string | null | undefined, to: string | null | undefined): string {
  if (from && to) return from === to ? from : `${from}..${to}`;
  if (from) return `${from}..`;
  if (to) return `..${to}`;
  return '';
}

/** "24 Aug 2026 09:05:19 +03:00" in the SACCO's own timezone, regardless of what timezone the
 *  rendering server happens to be in — a printed statement's "Date & Time generated" must not
 *  drift with where the Next.js process is hosted. */
export function formatStatementTimestamp(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-KE', {
    timeZone: 'Africa/Nairobi', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')} ${get('month')} ${get('year')} ${get('hour')}:${get('minute')}:${get('second')} +03:00`;
}

/** Whole years between a date of birth and today — the Loan Application/Appraisal printouts'
 *  "Age" field, since the member table stores date_of_birth, not a pre-computed age. */
export function ageFromDob(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const beforeBirthdayThisYear = now.getMonth() < birth.getMonth()
    || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate());
  if (beforeBirthdayThisYear) age--;
  return age;
}

export const initials = (name: string | null | undefined): string =>
  String(name || '?').trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase();

/** Shillings typed by a user -> integer cents. */
export const toCents = (v: string | number | null | undefined): Cents =>
  Math.round(Number(String(v ?? 0).replace(/,/g, '') || 0) * 100);

/** Integer cents -> the decimal string a number input expects. */
export const toUnits = (cents: Cents | null | undefined): string => (Number(cents || 0) / 100).toFixed(2);

export type Tone = '' | 'ok' | 'warn' | 'bad' | 'info' | 'accent';

const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: 'ok', POSTED: 'ok', APPROVED: 'ok', DISBURSED: 'ok', PAID: 'ok', PERFORMING: 'ok', OPEN: 'ok',
  VERIFIED: 'ok', ALLOWED: 'ok', YES: 'ok', ELIGIBLE: 'ok', AVAILABLE: 'ok',
  LINKED_TO_LOAN: 'info', COLLECTED: '',
  CLOSED: '', HEADER: '', RESTRICTED: '', ARCHIVED: '',
  PENDING: 'warn', DUE: 'warn', PARTIAL: 'warn', WATCH: 'warn', DORMANT: 'warn', APPLICATION: 'warn',
  SUBSTANDARD: 'warn', REFERRED: 'warn', 'PENDING APPROVAL': 'warn',
  REJECTED: 'bad', REVERSED: 'bad', SUSPENDED: 'bad', FROZEN: 'bad', DOUBTFUL: 'bad', LOSS: 'bad',
  WRITTEN_OFF: 'bad', 'WRITTEN OFF': 'bad', EXITED: 'bad', DISABLED: 'bad', INACTIVE: 'bad',
  // "Document Status" values (e.g. member_application.status) are Title Case, not SCREAMING_CASE.
  Open: 'ok', Approved: 'ok', Processed: 'ok', Fulfilled: 'ok', Cleared: 'ok', Received: 'ok', Posted: 'ok',
  'Pending Approval': 'warn', 'Pending Prepayment': 'warn', Running: 'warn',
  Rejected: 'bad', Reversed: 'bad', Terminated: 'bad', Bounced: 'bad',
  Closed: '', Archived: '', Retired: '',
};

/** Maps a domain status to the pill tone. */
export const statusTone = (status: string | null | undefined): Tone =>
  STATUS_TONE[String(status ?? '')] ?? '';

/** "WRITTEN_OFF" -> "WRITTEN OFF". */
export const humanise = (s: string | null | undefined): string => String(s ?? '').replace(/_/g, ' ');

/** Byte count -> "1.4 MB", for attachment listings. */
export function formatBytes(bytes: number | null | undefined): string {
  const n = Number(bytes || 0);
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
