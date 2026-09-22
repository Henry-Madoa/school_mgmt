'use server';

import { revalidatePath } from 'next/cache';
import { requireAction } from '@/lib/session';
import { actionResult } from '@/lib/errors';
import { retryMessage, cancelMessage, dispatchOutbox, purgeSentMessages } from '@/lib/outbox';
// The transports register with the outbox when these load — a retry from the screen needs them.
import '@/lib/mailer';
import '@/lib/sms';
import type { ActionResult } from '@/lib/types';

const revalidate = () => revalidatePath('/admin/data/outbox');

export async function retryMessageRequest(id: number): Promise<ActionResult<{ ok: boolean; error?: string }>> {
  return actionResult(async () => {
    const user = await requireAction('OUTBOX_MANAGE');
    const r = await retryMessage(id, user);
    revalidate();
    return r;
  });
}

export async function cancelMessageRequest(id: number): Promise<ActionResult<{ cancelled: true }>> {
  return actionResult(async () => {
    const user = await requireAction('OUTBOX_MANAGE');
    await cancelMessage(id, user);
    revalidate();
    return { cancelled: true };
  });
}

/** Run the dispatcher now rather than waiting for the job's next minute. */
export async function dispatchNowRequest(): Promise<ActionResult<{ sent: number; retried: number; failed: number }>> {
  return actionResult(async () => {
    await requireAction('OUTBOX_MANAGE');
    const r = await dispatchOutbox();
    revalidate();
    return r;
  });
}

export async function purgeSentRequest(): Promise<ActionResult<{ removed: number }>> {
  return actionResult(async () => {
    await requireAction('OUTBOX_MANAGE');
    const removed = await purgeSentMessages(90);
    revalidate();
    return { removed };
  });
}
