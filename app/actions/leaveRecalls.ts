'use server';

import { revalidatePath } from 'next/cache';
import { requireAction, requireUser } from '@/lib/session';
import { actionResult } from '@/lib/errors';
import {
  createLeaveRecall, deleteLeaveRecall, submitLeaveRecall, cancelLeaveRecallApproval,
  approveLeaveRecall, rejectLeaveRecall, recallableApplications,
} from '@/lib/leaveManagement';
import { findPendingRoutedTask, decideWorkflowTask } from '@/lib/workflow';
import type { ActionResult, FormValues } from '@/lib/types';

const revalidate = (no?: string) => {
  for (const p of ['/leave-recalls', '/approvals']) revalidatePath(p);
  if (no) revalidatePath(`/leave-recalls/view/${no}`);
};

export async function requestLeaveRecall(values: FormValues): Promise<ActionResult<{ no: string }>> {
  return actionResult(async () => {
    const user = await requireAction('LEAVE_RECALLS_CREATE');
    const res = await createLeaveRecall({
      employeeId: Number(values.employeeId), applicationNo: String(values.applicationNo || ''),
      daysToRecall: Number(values.daysToRecall),
    }, user);
    revalidate();
    return res;
  });
}

export async function deleteLeaveRecallRequest(no: string): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => {
    const user = await requireAction('LEAVE_RECALLS_CREATE');
    await deleteLeaveRecall(no, user);
    revalidate();
    return { deleted: true };
  });
}

export async function submitLeaveRecallRequest(no: string): Promise<ActionResult<{ updated: true; autoApproved: boolean }>> {
  return actionResult(async () => {
    const user = await requireAction('LEAVE_RECALLS_CREATE');
    const { autoApproved } = await submitLeaveRecall(no, user);
    revalidate(no);
    return { updated: true, autoApproved };
  });
}

export async function cancelLeaveRecallApprovalRequest(no: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const user = await requireAction('LEAVE_RECALLS_CREATE');
    await cancelLeaveRecallApproval(no, user);
    revalidate(no);
    return { updated: true };
  });
}

export async function approveLeaveRecallRequest(no: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const routed = await findPendingRoutedTask('LEAVE_RECALL', no);
    if (routed) {
      const user = await requireUser();
      await decideWorkflowTask(routed.id, true, null, user);
    } else {
      const user = await requireAction('LEAVE_RECALLS_APPROVE');
      await approveLeaveRecall(no, user);
    }
    revalidate(no);
    return { updated: true };
  });
}

export async function rejectLeaveRecallRequest(no: string, reason: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const routed = await findPendingRoutedTask('LEAVE_RECALL', no);
    if (routed) {
      const user = await requireUser();
      await decideWorkflowTask(routed.id, false, reason || null, user);
    } else {
      const user = await requireAction('LEAVE_RECALLS_APPROVE');
      await rejectLeaveRecall(no, reason || null, user);
    }
    revalidate(no);
    return { updated: true };
  });
}

export async function recallableApplicationsFor(employeeId: number) {
  return actionResult(async () => {
    await requireAction('LEAVE_RECALLS_CREATE');
    return recallableApplications(employeeId);
  });
}
