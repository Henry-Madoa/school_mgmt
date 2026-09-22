import 'server-only';
import { enqueueMessage, deliverMessage, registerTransport, TransportNotConfigured } from './outbox.ts';
import type { OutboxMessage } from './types.ts';

/*
 * SMS — recorded in the message outbox (lib/outbox.ts), then posted to the gateway; shaped
 * exactly like lib/mailer.ts.
 *
 * The AL reaches an SMS gateway through Codeunit "Notifications Management".SendSms; which gateway
 * is a per-deployment choice (Africa's Talking, Infobip, a bank's own aggregator), so this is a
 * seam rather than an integration: configure SMS_GATEWAY_URL and SMS_API_KEY and it posts there;
 * leave them unset and it logs instead.
 *
 * A failed or unconfigured send must never block the posting that triggered it — the money has
 * already moved and the document is already posted. sendSms() queues the text and makes one
 * attempt; the OUTBOX_DISPATCH job retries failures and parks what cannot be sent.
 */

export interface SendSmsInput {
  /** The recipient's number. Normalised to E.164 against SMS_COUNTRY_CODE (default +254). */
  to: string;
  message: string;
  /** The sender ID the gateway should show — AL's SMSSource. */
  source?: string;
  /** The document this text is about — shown on the outbox so a failed send can be traced. */
  reference?: { type: string; no: string } | null;
}

/**
 * Kenyan numbers are written locally as often as internationally, so `0722…`, `722…`,
 * `254722…` and `+254722…` all have to reach the same handset.
 */
export function normalisePhone(raw: string, countryCode = process.env.SMS_COUNTRY_CODE || '254'): string | null {
  const digits = String(raw ?? '').replace(/[^\d+]/g, '').replace(/^\+/, '');
  if (!digits) return null;
  if (digits.startsWith(countryCode)) return `+${digits}`;
  if (digits.startsWith('0')) return `+${countryCode}${digits.slice(1)}`;
  // A bare subscriber number, already missing both the trunk zero and the country code.
  if (digits.length >= 9 && digits.length <= 10) return `+${countryCode}${digits}`;
  return `+${digits}`;
}

/** The transport: one POST to the gateway, throwing on anything but a 2xx so the outbox can retry. */
export async function deliverSms(m: OutboxMessage): Promise<string | null> {
  const url = process.env.SMS_GATEWAY_URL;
  if (!url) throw new TransportNotConfigured('SMS_GATEWAY_URL is not set — SMS is not configured on this server');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.SMS_API_KEY ? { Authorization: `Bearer ${process.env.SMS_API_KEY}` } : {}),
    },
    body: JSON.stringify({ to: m.recipient, message: m.body, from: m.sender || undefined }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`gateway returned ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  // Gateways differ; keep whatever id-like field comes back for the trail.
  const body = await res.json().catch(() => null) as { id?: string; messageId?: string; MessageId?: string } | null;
  return body?.id ?? body?.messageId ?? body?.MessageId ?? null;
}
registerTransport('SMS', deliverSms);

export async function sendSms({ to, message, source, reference = null }: SendSmsInput): Promise<void> {
  const number = normalisePhone(to);
  if (!number) {
    console.log('[sms] no usable phone number — skipping send');
    return;
  }
  try {
    const id = await enqueueMessage({ channel: 'SMS', recipient: number, body: message, sender: source || process.env.SMS_SENDER_ID || null, reference });
    const r = await deliverMessage(id);
    if (!r.ok) console.warn('[sms] not delivered yet', { id, to: number, error: r.error });
  } catch (err) {
    console.error('[sms] could not queue', err);
  }
}
