'use server';

import { revalidatePath } from 'next/cache';
import { requireAction } from '@/lib/session';
import { actionResult } from '@/lib/errors';
import {
  createJobQueueEntry, updateJobQueueEntry, setJobQueueEntryStatus, deleteJobQueueEntry, runJobQueueEntryNow,
  type JobQueueEntryInput,
} from '@/lib/jobQueue';
import type { ActionResult, FormValues, JobQueueEntry, JobQueueStatus, JobQueueType } from '@/lib/types';

const toInput = (values: FormValues): JobQueueEntryInput => ({
  code: String(values.code || ''),
  description: String(values.description || ''),
  job_type: values.job_type as JobQueueType,
  run_every_minutes: Number(values.run_every_minutes || 0),
  earliest_start_date: values.earliest_start_date ? String(values.earliest_start_date) : null,
});

export async function createJobQueueEntryRequest(values: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_JOB_QUEUE_MANAGE');
    const created = await createJobQueueEntry(toInput(values), user);
    revalidatePath('/admin/automation');
    return created;
  });
}

export async function updateJobQueueEntryRequest(id: number, values: FormValues): Promise<ActionResult<JobQueueEntry>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_JOB_QUEUE_MANAGE');
    const updated = await updateJobQueueEntry(id, toInput(values), user);
    revalidatePath('/admin/automation');
    return updated;
  });
}

export async function setJobQueueEntryStatusRequest(id: number, status: JobQueueStatus): Promise<ActionResult<{ status: JobQueueStatus }>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_JOB_QUEUE_MANAGE');
    await setJobQueueEntryStatus(id, status, user);
    revalidatePath('/admin/automation');
    return { status };
  });
}

export async function deleteJobQueueEntryRequest(id: number): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_JOB_QUEUE_MANAGE');
    await deleteJobQueueEntry(id, user);
    revalidatePath('/admin/automation');
    return { deleted: true };
  });
}

export async function runJobQueueEntryNowRequest(id: number): Promise<ActionResult<{ ran: true }>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_JOB_QUEUE_MANAGE');
    await runJobQueueEntryNow(id, user);
    revalidatePath('/admin/automation');
    revalidatePath('/members');
    revalidatePath('/savings');
    return { ran: true };
  });
}
