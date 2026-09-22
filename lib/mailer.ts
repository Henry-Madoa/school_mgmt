import 'server-only';
import { Resend } from 'resend';
import { enqueueMessage, deliverMessage, registerTransport, TransportNotConfigured } from './outbox.ts';
import type { OutboxMessage } from './types.ts';

/*
 * E-mail — recorded in the message outbox (lib/outbox.ts), then delivered through Resend.
 *
 * sendMail() never throws and never blocks the workflow action or posting that triggered it:
 * it writes the outbox row and makes one immediate attempt; a failure is retried by the
 * OUTBOX_DISPATCH job and, if it keeps failing, parked where an administrator can see it.
 * RESEND_API_KEY absent (a fresh clone before the admin has configured it) parks the row with
 * that reason rather than pretending it was sent.
 */

let client: Resend | null | undefined;

function getClient(): Resend | null {
  if (client !== undefined) return client;
  const key = process.env.RESEND_API_KEY;
  client = key ? new Resend(key) : null;
  return client;
}

export interface SendMailInput {
  to: string | string[];
  subject: string;
  html: string;
  /** The document this message is about — shown on the outbox so a failed send can be traced. */
  reference?: { type: string; no: string } | null;
}

const fromAddress = (): string => process.env.RESEND_FROM_EMAIL || 'notifications@example.com';

/** The transport: one real send, throwing on failure so the outbox can retry or park it. */
export async function deliverMail(m: OutboxMessage): Promise<string | null> {
  const resend = getClient();
  if (!resend) throw new TransportNotConfigured('RESEND_API_KEY is not set — e-mail is not configured on this server');
  const to = m.recipient.split(',').map((s) => s.trim()).filter(Boolean);
  const { data, error } = await resend.emails.send({ from: m.sender || fromAddress(), to, subject: m.subject ?? '', html: m.body });
  if (error) throw new Error(`${error.name}: ${error.message}`);
  return data?.id ?? null;
}
registerTransport('EMAIL', deliverMail);

export async function sendMail({ to, subject, html, reference = null }: SendMailInput): Promise<void> {
  const recipient = (Array.isArray(to) ? to : [to]).map((s) => String(s).trim()).filter(Boolean).join(', ');
  if (!recipient) return;
  try {
    const id = await enqueueMessage({ channel: 'EMAIL', recipient, subject, body: html, sender: fromAddress(), reference });
    const r = await deliverMessage(id);
    if (!r.ok) console.warn('[mailer] not delivered yet', { id, to: recipient, subject, error: r.error });
  } catch (err) {
    console.error('[mailer] could not queue', err);
  }
}

const appUrl = (): string => (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');

const wrapper = (title: string, bodyHtml: string, link: string): string => `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
    <h2 style="margin:0 0 12px;">${title}</h2>
    ${bodyHtml}
    <p style="margin-top:24px;">
      <a href="${appUrl()}${link}" style="background:#0f7b52;color:#fff;padding:10px 18px;
        border-radius:6px;text-decoration:none;display:inline-block;">Open in School Manager</a>
    </p>
  </div>`;

export function approvalRequestedEmail(documentLabel: string, requestedBy: string, link: string): string {
  return wrapper(
    'Approval requested',
    `<p><b>${documentLabel}</b> was submitted by <b>${requestedBy}</b> and is waiting for your decision.</p>`,
    link,
  );
}

export function approvalDecidedEmail(
  documentLabel: string, approved: boolean, decidedBy: string, comment: string | null, link: string,
): string {
  return wrapper(
    approved ? 'Request approved' : 'Request rejected',
    `<p><b>${documentLabel}</b> was ${approved ? 'approved' : 'rejected'} by <b>${decidedBy}</b>.</p>
     ${comment ? `<p style="color:#555;">"${comment}"</p>` : ''}`,
    link,
  );
}
