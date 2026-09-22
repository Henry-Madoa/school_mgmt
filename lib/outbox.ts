/*
 * Message outbox — every outbound e-mail and SMS is written here first, then delivered.
 *
 * Before this, lib/mailer.ts and lib/sms.ts sent inline and swallowed failures: a gateway hiccup
 * or a missing key meant the parent simply never got the slip, and nobody could tell. Now:
 *
 *   enqueue      the caller's send becomes a QUEUED row (channel, recipient, body, what document
 *                it is about) and returns at once — a posting is never held up by a gateway;
 *   deliver      one attempt straight away (best effort, so the normal case is still instant),
 *                then the OUTBOX_DISPATCH job (lib/jobQueue.ts, every minute) picks up whatever
 *                is QUEUED and due, retrying with back-off (1, 5, 15, 60 min) up to max_attempts,
 *                after which the row is FAILED and shows up on Admin Centre → Data Management →
 *                Message Outbox, where it can be retried by hand;
 *   transport    lib/mailer.ts deliverMail() / lib/sms.ts deliverSms() do the actual sending and
 *                THROW on failure — the outbox is the one place that decides what a failure means.
 *
 * An unconfigured transport (no RESEND_API_KEY / SMS_GATEWAY_URL) is not a failure to retry: the
 * row is parked as FAILED with that reason on the first attempt so the queue does not fill with
 * messages nothing can send, and an administrator can see exactly why.
 */
import { one, all, run, audit } from './db.ts';
import { AppError } from './errors.ts';
import type { Actor, OutboxChannel, OutboxMessage, OutboxStatus } from './types.ts';

export interface EnqueueInput {
  channel: OutboxChannel;
  recipient: string;
  subject?: string | null;
  body: string;
  sender?: string | null;
  reference?: { type: string; no: string } | null;
  createdBy?: string | null;
}

/** Thrown by a transport when the channel is not configured at all — parked, not retried. */
export class TransportNotConfigured extends Error {
  constructor(message: string) { super(message); this.name = 'TransportNotConfigured'; }
}

const BACKOFF_MINUTES = [1, 5, 15, 60];
const nowIso = () => new Date().toISOString();
const plusMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

export async function enqueueMessage(input: EnqueueInput): Promise<number> {
  const res = await run(
    `INSERT INTO message_outbox (channel, recipient, subject, body, sender, reference_type, reference_no, status, next_attempt_at, created_at, created_by)
     VALUES (?,?,?,?,?,?,?,'QUEUED',?,?,?)`,
    input.channel, input.recipient, input.subject ?? null, input.body, input.sender ?? null,
    input.reference?.type ?? null, input.reference?.no ?? null, nowIso(), nowIso(), input.createdBy ?? null,
  );
  return Number(res.lastInsertRowid);
}

/* ------------------------------------------------------------------ delivery */

type Transport = (m: OutboxMessage) => Promise<string | null>;
const transports: Partial<Record<OutboxChannel, Transport>> = {};

/** lib/mailer.ts and lib/sms.ts register themselves here (avoids a circular import). */
export function registerTransport(channel: OutboxChannel, transport: Transport): void {
  transports[channel] = transport;
}

/**
 * One delivery attempt for one row. Claims the row (QUEUED → SENDING) so two dispatchers never
 * send the same message; on failure schedules the next attempt or parks it FAILED.
 */
export async function deliverMessage(id: number): Promise<{ ok: boolean; final: boolean; error?: string }> {
  // next_attempt_at doubles as the claim time while the row is SENDING (see dispatchOutbox).
  const claimed = await run(
    "UPDATE message_outbox SET status = 'SENDING', attempts = attempts + 1, next_attempt_at = ? WHERE id = ? AND status = 'QUEUED'", nowIso(), id,
  );
  if (!claimed.changes) return { ok: false, final: false, error: 'not queued' };
  const m = await one<OutboxMessage>('SELECT * FROM message_outbox WHERE id = ?', id);
  if (!m) return { ok: false, final: true, error: 'missing' };
  const transport = transports[m.channel];
  try {
    if (!transport) throw new TransportNotConfigured(`No transport for ${m.channel}`);
    const ref = await transport(m);
    await run("UPDATE message_outbox SET status = 'SENT', sent_at = ?, provider_ref = ?, last_error = NULL WHERE id = ?", nowIso(), ref, id);
    return { ok: true, final: true };
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    const exhausted = m.attempts >= m.max_attempts;
    const park = exhausted || e instanceof TransportNotConfigured;
    if (park) {
      await run("UPDATE message_outbox SET status = 'FAILED', last_error = ?, next_attempt_at = NULL WHERE id = ?", message, id);
      return { ok: false, final: true, error: message };
    }
    const wait = BACKOFF_MINUTES[Math.min(m.attempts - 1, BACKOFF_MINUTES.length - 1)];
    await run("UPDATE message_outbox SET status = 'QUEUED', last_error = ?, next_attempt_at = ? WHERE id = ?", message, plusMinutes(wait), id);
    return { ok: false, final: false, error: message };
  }
}

/** The job: every QUEUED row whose time has come, oldest first. */
export async function dispatchOutbox(limit = 200): Promise<{ sent: number; retried: number; failed: number }> {
  // Rows claimed over ten minutes ago and still SENDING belong to a dispatcher that died mid-send.
  await run("UPDATE message_outbox SET status = 'QUEUED', last_error = COALESCE(last_error, 'dispatcher lost'), next_attempt_at = ? WHERE status = 'SENDING' AND next_attempt_at < ?", nowIso(), new Date(Date.now() - 10 * 60_000).toISOString());
  const due = await all<{ id: number }>(
    "SELECT id FROM message_outbox WHERE status = 'QUEUED' AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY id LIMIT ?", nowIso(), limit,
  );
  const out = { sent: 0, retried: 0, failed: 0 };
  for (const { id } of due) {
    const r = await deliverMessage(id);
    if (r.ok) out.sent++; else if (r.final) out.failed++; else out.retried++;
  }
  return out;
}

/* ------------------------------------------------------------------ admin */

export interface OutboxStats { queued: number; failed: number; sent_today: number }
export const outboxStats = async (): Promise<OutboxStats> => {
  const r = await one<{ queued: number; failed: number; sent_today: number }>(
    `SELECT COUNT(*) FILTER (WHERE status IN ('QUEUED', 'SENDING')) AS queued,
            COUNT(*) FILTER (WHERE status = 'FAILED') AS failed,
            COUNT(*) FILTER (WHERE status = 'SENT' AND sent_at >= ?) AS sent_today
     FROM message_outbox`, `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`,
  );
  return { queued: Number(r?.queued ?? 0), failed: Number(r?.failed ?? 0), sent_today: Number(r?.sent_today ?? 0) };
};

export const listOutbox = (status?: OutboxStatus | 'ALL', search = '', limit = 300): Promise<OutboxMessage[]> =>
  all<OutboxMessage>(
    `SELECT * FROM message_outbox
     WHERE (recipient ILIKE @like OR COALESCE(subject, '') ILIKE @like OR COALESCE(reference_no, '') ILIKE @like)
       ${status && status !== 'ALL' ? 'AND status = @status' : ''}
     ORDER BY id DESC LIMIT @limit`,
    { like: `%${search.trim()}%`, status: status ?? null, limit },
  );

export const getOutboxMessage = (id: number): Promise<OutboxMessage | undefined> => one<OutboxMessage>('SELECT * FROM message_outbox WHERE id = ?', id);

/** Put a FAILED (or CANCELLED) message back in the queue and try it now. */
export async function retryMessage(id: number, user: Actor): Promise<{ ok: boolean; error?: string }> {
  const m = await getOutboxMessage(id);
  if (!m) throw new AppError('Message not found', 'NOT_FOUND');
  if (m.status === 'SENT') throw new AppError('This message was already sent', 'VALIDATION');
  await run("UPDATE message_outbox SET status = 'QUEUED', attempts = 0, next_attempt_at = ?, last_error = NULL WHERE id = ?", nowIso(), id);
  await audit(user, 'OUTBOX_RETRY', 'message_outbox', id, { channel: m.channel, recipient: m.recipient });
  const r = await deliverMessage(id);
  return { ok: r.ok, error: r.error };
}

export async function cancelMessage(id: number, user: Actor): Promise<void> {
  const m = await getOutboxMessage(id);
  if (!m) throw new AppError('Message not found', 'NOT_FOUND');
  if (m.status === 'SENT') throw new AppError('This message was already sent', 'VALIDATION');
  await run("UPDATE message_outbox SET status = 'CANCELLED', next_attempt_at = NULL WHERE id = ?", id);
  await audit(user, 'OUTBOX_CANCEL', 'message_outbox', id, {});
}

/** Housekeeping: drop SENT rows older than `days` (bodies can be large). */
export async function purgeSentMessages(days = 90): Promise<number> {
  const r = await run("DELETE FROM message_outbox WHERE status = 'SENT' AND sent_at < ?", new Date(Date.now() - days * 86_400_000).toISOString());
  return Number(r.changes);
}
