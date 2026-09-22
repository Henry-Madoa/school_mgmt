/*
 * Contact-detail validation shared by every card that captures a phone number or an email
 * address — member registration and editing, employees, users, employers, customers, vendors and
 * the company card. The browser checks the same shapes through Field's `phone`/`email` types
 * (components/ui/field.tsx), but a Server Action can be called without ever rendering that form,
 * so the rule is enforced here as well and this module is the single definition of it.
 *
 * Deliberately permissive about presentation: '+254 720 111 222', '0720-111222' and
 * '(020) 2211334' are all accepted — only the digits are counted, against E.164's 7..15.
 */
import { AppError } from './errors.ts';

/**
 * What a phone `<input>` accepts, kept deliberately equivalent to isPhone() below: an optional
 * leading +, then only digits, spaces, hyphens and brackets, and — via the leading lookahead —
 * between 7 and 15 actual digits, so the browser rejects exactly what the server would.
 */
export const PHONE_PATTERN = '(?=(?:\\D*\\d){7,15}\\D*$)\\+?[\\d ()-]+';
export const PHONE_TITLE = 'Enter a phone number, e.g. 0712 345678 or +254 712 345678';

/**
 * What an email `<input>` accepts. A bare `type="email"` is far looser than it looks — the HTML
 * spec deliberately allows an intranet host, so 'accounts@rvt' passes the browser and only fails
 * once the Server Action rejects it. Pairing the input with this pattern makes the browser hold
 * the same line as isEmail(): something before the @, a dotted domain, and a real suffix.
 */
export const EMAIL_PATTERN = '[^\\s@]+@[^\\s@]+\\.[A-Za-z]{2,}';
export const EMAIL_TITLE = 'Enter a full email address, e.g. accounts@example.co.ke';

const EMAIL_RE = new RegExp(`^${EMAIL_PATTERN}$`);

/** Just the dialling digits, dropping spaces, hyphens, brackets and a leading +. */
export const phoneDigits = (value: string): string => value.replace(/\D/g, '');

/** True for a plausible phone number — E.164 allows 7 to 15 digits. */
export function isPhone(value: string): boolean {
  const raw = value.trim();
  if (!raw || !/^\+?[0-9 ()-]+$/.test(raw)) return false;
  const digits = phoneDigits(raw);
  return digits.length >= 7 && digits.length <= 15;
}

export const isEmail = (value: string): boolean => EMAIL_RE.test(value.trim());

/** Throws unless `value` is a usable phone number. A blank is left to the caller's own
 *  required-field check, so an optional phone stays optional. */
export function assertPhone(value: unknown, label = 'Phone number'): void {
  const raw = String(value ?? '').trim();
  if (!raw) return;
  if (!isPhone(raw)) throw new AppError(`${label} is not a valid phone number`, 'VALIDATION');
}

/** Throws unless `value` is a usable email address; a blank is left to the caller. */
export function assertEmail(value: unknown, label = 'Email address'): void {
  const raw = String(value ?? '').trim();
  if (!raw) return;
  if (!isEmail(raw)) throw new AppError(`${label} is not a valid email address`, 'VALIDATION');
}

/*
 * Most savers in this codebase write a whitelist of columns straight from a request body
 * (MEMBER_FIELDS, APPLICATION_FIELDS, the employer/employee column lists). Rather than naming
 * every contact column in every module, these walk the bag and check whatever looks like a phone
 * or an email — so a column added later is covered without another edit here.
 */

/** 'contact_person_phone' -> 'Contact person phone', for the message the user reads. */
const label = (key: string): string => {
  const words = key.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** Columns whose name mentions a phone or an email but which hold something else entirely. */
const isContactColumn = (key: string): 'phone' | 'email' | null => {
  if (/_at$/.test(key) || /^(notify|is|has|allow)_/.test(key)) return null;
  if (/phone|telephone|mobile/i.test(key)) return 'phone';
  if (/email/i.test(key)) return 'email';
  return null;
};

/** Validates every phone/email-looking column present in a column bag. */
export function assertContactColumns(values: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const kind = isContactColumn(key);
    if (kind === 'phone') assertPhone(value, label(key));
    else if (kind === 'email') assertEmail(value, label(key));
  }
}

/** Same, for a list of sub-rows (next of kin, nominees, signatories, emergency contacts). */
export function assertContactRows(rows: readonly Record<string, unknown>[]): void {
  rows.forEach((row) => assertContactColumns(row));
}

/** The common case: a record carrying one phone and one email, both optional. */
export function assertContactDetails(
  { phone, email }: { phone?: unknown; email?: unknown },
  labels: { phone?: string; email?: string } = {},
): void {
  assertPhone(phone, labels.phone ?? 'Phone number');
  assertEmail(email, labels.email ?? 'Email address');
}
