import { isEmail, isPhone, phoneDigits } from '@/lib/validate';

/*
 * Business Central's ExtendedDatatype = E-Mail / Phone No.: a stored contact detail is not just
 * text on the card, it is actionable — clicking an address opens the mail client on a new
 * message, clicking a number hands off to the device's dialler (or Teams/Skype on a desktop).
 *
 * A value that fails lib/validate.ts's own rules is rendered as plain text rather than as a
 * broken link: rows captured before these checks existed can still hold anything.
 */

/** `mailto:` on the click, for a value that really is an address. */
export function EmailLink({ value, fallback = '—' }: { value?: string | null; fallback?: string }) {
  const email = String(value ?? '').trim();
  if (!email) return <>{fallback}</>;
  if (!isEmail(email)) return <>{email}</>;
  return (
    <a href={`mailto:${encodeURIComponent(email)}`} className="contact-link" title={`Write to ${email}`}>
      {email}
    </a>
  );
}

/** `tel:` on the click. The href keeps only the diallable characters — a leading + and digits —
 *  while the card still shows the number the way it was keyed in. */
export function PhoneLink({ value, fallback = '—' }: { value?: string | null; fallback?: string }) {
  const phone = String(value ?? '').trim();
  if (!phone) return <>{fallback}</>;
  if (!isPhone(phone)) return <>{phone}</>;
  const dial = `${phone.startsWith('+') ? '+' : ''}${phoneDigits(phone)}`;
  return (
    <a href={`tel:${dial}`} className="contact-link" title={`Call ${phone}`}>
      {phone}
    </a>
  );
}
