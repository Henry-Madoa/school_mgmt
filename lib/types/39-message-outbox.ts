/* message outbox — split out of lib/types.ts; import from '@/lib/types', never from here directly. */
import type { Flag, IsoDateTime, NotificationType } from '../types.ts';

/* ---------------------------------------------------------------- message outbox */

export type OutboxChannel = 'EMAIL' | 'SMS';
/** SENDING is transient — a dispatcher has claimed the row and is talking to the gateway. */
export type OutboxStatus = 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED' | 'CANCELLED';

/** One outbound e-mail or SMS (lib/outbox.ts): recorded first, delivered by the OUTBOX_DISPATCH job. */
export interface OutboxMessage {
  id: number;
  channel: OutboxChannel;
  /** E-mail address(es), comma-separated, or an E.164 phone number. */
  recipient: string;
  subject: string | null;
  body: string;
  /** The SMS sender id / e-mail from-address the transport was asked to show. */
  sender: string | null;
  reference_type: string | null;
  reference_no: string | null;
  status: OutboxStatus;
  attempts: number;
  max_attempts: number;
  next_attempt_at: IsoDateTime | null;
  last_error: string | null;
  provider_ref: string | null;
  created_at: IsoDateTime;
  created_by: string | null;
  sent_at: IsoDateTime | null;
}

export interface AppNotification {
  id: number;
  user_id: number;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  is_read: Flag;
  created_at: IsoDateTime;
}
