'use server';

import { revalidatePath } from 'next/cache';
import { requireAction, requireUser } from '@/lib/session';
import { actionResult } from '@/lib/errors';
import {
  createLeaveAdjustment, setAdjustmentEmployees, deleteLeaveAdjustment, submitLeaveAdjustment,
  cancelLeaveAdjustmentApproval, approveLeaveAdjustment, rejectLeaveAdjustment,
} from '@/lib/leaveManagement';
import { findPendingRoutedTask, decideWorkflowTask } from '@/lib/workflow';
import type { ActionResult, FormValues } from '@/lib/types';

const revalidate = (no?: string) => {
  for (const p of ['/leave-adjustments', '/approvals']) revalidatePath(p);
  if (no) revalidatePath(`/leave-adjustments/view/${no}`);
};

export async function requestLeaveAdjustment(values: FormValues): Promise<ActionResult<{ no: string }>> {
  return actionResult(async () => {
    const user = await requireAction('LEAVE_ADJUSTMENTS_CREATE');
    const res = await createLeaveAdjustment({
      leaveTypeId: Number(values.leaveTypeId), type: String(values.type || 'POSITIVE') as 'POSITIVE' | 'NEGATIVE',
      description: values.description ? String(values.description) : null, days: Number(values.days),
    }, user);
    revalidate();
    return res;
  });
}

export async function setAdjustmentEmployeesRequest(no: string, employeeIds: number[]): Promise<ActionResult<{ saved: true }>> {
  return actionResult(async () => {
    const user = await requireAction('LEAVE_ADJUSTMENTS_CREATE');
    await setAdjustmentEmployees(no, employeeIds, user);
    revalidate(no);
    return { saved: true };
  });
}

export async function deleteLeaveAdjustmentRequest(no: string): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => {
    const user = await requireAction('LEAVE_ADJUSTMENTS_CREATE');
    await deleteLeaveAdjustment(no, user);
    revalidate();
    return { deleted: true };
  });
}

export async function submitLeaveAdjustmentRequest(no: string): Promise<ActionResult<{ updated: true; autoApproved: boolean }>> {
  return actionResult(async () => {
    const user = await requireAction('LEAVE_ADJUSTMENTS_CREATE');
    const { autoApproved } = await submitLeaveAdjustment(no, user);
    revalidate(no);
    return { updated: true, autoApproved };
  });
}

export async function cancelLeaveAdjustmentApprovalRequest(no: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const user = await requireAction('LEAVE_ADJUSTMENTS_CREATE');
    await cancelLeaveAdjustmentApproval(no, user);
    revalidate(no);
    return { updated: true };
  });
}

export async function approveLeaveAdjustmentRequest(no: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const routed = await findPendingRoutedTask('LEAVE_ADJUSTMENT', no);
    if (routed) {
      const user = await requireUser();
      await decideWorkflowTask(routed.id, true, null, user);
    } else {
      const user = await requireAction('LEAVE_ADJUSTMENTS_APPROVE');
      await approveLeaveAdjustment(no, user);
    }
    revalidate(no);
    return { updated: true };
  });
}

export async function rejectLeaveAdjustmentRequest(no: string, reason: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const routed = await findPendingRoutedTask('LEAVE_ADJUSTMENT', no);
    if (routed) {
      const user = await requireUser();
      await decideWorkflowTask(routed.id, false, reason || null, user);
    } else {
      const user = await requireAction('LEAVE_ADJUSTMENTS_APPROVE');
      await rejectLeaveAdjustment(no, reason || null, user);
    }
    revalidate(no);
    return { updated: true };
  });
}
