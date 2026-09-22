'use server';

import { revalidatePath } from 'next/cache';
import { requireAction, requireAnyAction, requireUser } from '@/lib/session';
import { resolveActingEmployee } from '@/lib/selfService';
import { actionResult } from '@/lib/errors';
import {
  createLeavePlan, setPlanLines, deleteLeavePlan, submitLeavePlan, cancelLeavePlanApproval,
  approveLeavePlan, rejectLeavePlan,
} from '@/lib/leaveManagement';
import { findPendingRoutedTask, decideWorkflowTask } from '@/lib/workflow';
import type { ActionResult } from '@/lib/types';

const revalidate = (no?: string) => {
  for (const p of ['/leave-plans', '/approvals', '/self-service', '/self-service/leave-plans', '/dashboard']) revalidatePath(p);
  if (no) revalidatePath(`/leave-plans/view/${no}`);
};

export async function requestLeavePlan(employeeId: number): Promise<ActionResult<{ no: string }>> {
  return actionResult(async () => {
    const user = await requireAnyAction('LEAVE_PLANS_CREATE', 'SELF_SERVICE_LEAVE_PLANS_CREATE');
    const res = await createLeavePlan(await resolveActingEmployee(user, 'LEAVE_PLANS_CREATE', employeeId || null), user);
    revalidate();
    return res;
  });
}

export async function setPlanLinesRequest(no: string, lines: { startDate: string; endDate: string }[]): Promise<ActionResult<{ saved: true }>> {
  return actionResult(async () => {
    const user = await requireAnyAction('LEAVE_PLANS_CREATE', 'SELF_SERVICE_LEAVE_PLANS_CREATE');
    await setPlanLines(no, lines, user);
    revalidate(no);
    return { saved: true };
  });
}

export async function deleteLeavePlanRequest(no: string): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => {
    const user = await requireAnyAction('LEAVE_PLANS_CREATE', 'SELF_SERVICE_LEAVE_PLANS_CREATE');
    await deleteLeavePlan(no, user);
    revalidate();
    return { deleted: true };
  });
}

export async function submitLeavePlanRequest(no: string): Promise<ActionResult<{ updated: true; autoApproved: boolean }>> {
  return actionResult(async () => {
    const user = await requireAnyAction('LEAVE_PLANS_CREATE', 'SELF_SERVICE_LEAVE_PLANS_CREATE');
    const { autoApproved } = await submitLeavePlan(no, user);
    revalidate(no);
    return { updated: true, autoApproved };
  });
}

export async function cancelLeavePlanApprovalRequest(no: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const user = await requireAnyAction('LEAVE_PLANS_CREATE', 'SELF_SERVICE_LEAVE_PLANS_CREATE');
    await cancelLeavePlanApproval(no, user);
    revalidate(no);
    return { updated: true };
  });
}

export async function approveLeavePlanRequest(no: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const routed = await findPendingRoutedTask('LEAVE_PLAN', no);
    if (routed) {
      const user = await requireUser();
      await decideWorkflowTask(routed.id, true, null, user);
    } else {
      const user = await requireAction('LEAVE_PLANS_APPROVE');
      await approveLeavePlan(no, user);
    }
    revalidate(no);
    return { updated: true };
  });
}

export async function rejectLeavePlanRequest(no: string, reason: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const routed = await findPendingRoutedTask('LEAVE_PLAN', no);
    if (routed) {
      const user = await requireUser();
      await decideWorkflowTask(routed.id, false, reason || null, user);
    } else {
      const user = await requireAction('LEAVE_PLANS_APPROVE');
      await rejectLeavePlan(no, reason || null, user);
    }
    revalidate(no);
    return { updated: true };
  });
}
