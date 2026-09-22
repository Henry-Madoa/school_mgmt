'use server';

import { revalidatePath } from 'next/cache';
import { requireAction, requireUser } from '@/lib/session';
import { actionResult } from '@/lib/errors';
import {
  createExit, updateExit, addFinalDueLine, removeFinalDueLine, submitExit, cancelExitApproval,
  approveExit, rejectExit, clearExitSection, type ExitInput,
} from '@/lib/employeeExits';
import { findPendingRoutedTask, decideWorkflowTask } from '@/lib/workflow';
import type { ActionResult, FormValues, EmployeeExitFinalDueLine } from '@/lib/types';

const revalidate = (no?: string) => {
  for (const p of ['/employee-exits', '/approvals', '/employees']) revalidatePath(p);
  if (no) revalidatePath(`/employee-exits/view/${no}`);
};

function toInput(values: FormValues): ExitInput {
  return {
    employeeId: Number(values.employeeId),
    terminationReasonId: values.terminationReasonId ? Number(values.terminationReasonId) : null,
    dateOfNotice: values.dateOfNotice ? String(values.dateOfNotice) : null,
    dateOfExit: values.dateOfExit ? String(values.dateOfExit) : null,
    noticePeriodDays: values.noticePeriodDays ? Number(values.noticePeriodDays) : null,
    canBeReemployed: values.canBeReemployed !== undefined ? !!Number(values.canBeReemployed) : null,
    reasonsForNotServingNotice: values.reasonsForNotServingNotice ? String(values.reasonsForNotServingNotice) : null,
  };
}

export async function requestExit(values: FormValues): Promise<ActionResult<{ no: string }>> {
  return actionResult(async () => {
    const user = await requireAction('EMPLOYEE_EXITS_CREATE');
    const res = await createExit(toInput(values), user);
    revalidate();
    return res;
  });
}

export async function updateExitRequest(no: string, values: FormValues): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const user = await requireAction('EMPLOYEE_EXITS_CREATE');
    await updateExit(no, toInput(values), user);
    revalidate(no);
    return { updated: true };
  });
}

export async function addFinalDueLineRequest(
  no: string, line: { dueType: EmployeeExitFinalDueLine['due_type']; description?: string; amountCents: number },
): Promise<ActionResult<{ added: true }>> {
  return actionResult(async () => {
    const user = await requireAction('EMPLOYEE_EXITS_CREATE');
    await addFinalDueLine(no, line, user);
    revalidate(no);
    return { added: true };
  });
}

export async function removeFinalDueLineRequest(no: string, lineId: number): Promise<ActionResult<{ removed: true }>> {
  return actionResult(async () => {
    const user = await requireAction('EMPLOYEE_EXITS_CREATE');
    await removeFinalDueLine(no, lineId, user);
    revalidate(no);
    return { removed: true };
  });
}

export async function submitExitRequest(no: string): Promise<ActionResult<{ updated: true; autoApproved: boolean }>> {
  return actionResult(async () => {
    const user = await requireAction('EMPLOYEE_EXITS_CREATE');
    const { autoApproved } = await submitExit(no, user);
    revalidate(no);
    return { updated: true, autoApproved };
  });
}

export async function cancelExitApprovalRequest(no: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const user = await requireAction('EMPLOYEE_EXITS_CREATE');
    await cancelExitApproval(no, user);
    revalidate(no);
    return { updated: true };
  });
}

export async function approveExitRequest(no: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const routed = await findPendingRoutedTask('EMPLOYEE_EXIT', no);
    if (routed) {
      const user = await requireUser();
      await decideWorkflowTask(routed.id, true, null, user);
      revalidate(no);
      return { updated: true };
    }
    const user = await requireAction('EMPLOYEE_EXITS_APPROVE');
    await approveExit(no, user);
    revalidate(no);
    return { updated: true };
  });
}

export async function rejectExitRequest(no: string, reason: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const routed = await findPendingRoutedTask('EMPLOYEE_EXIT', no);
    if (routed) {
      const user = await requireUser();
      await decideWorkflowTask(routed.id, false, reason || null, user);
    } else {
      const user = await requireAction('EMPLOYEE_EXITS_APPROVE');
      await rejectExit(no, reason || null, user);
    }
    revalidate(no);
    return { updated: true };
  });
}

export async function clearExitSectionRequest(no: string, sectionId: number, remarks: string): Promise<ActionResult<{ fullyCleared: boolean }>> {
  return actionResult(async () => {
    const user = await requireAction('EMPLOYEE_EXITS_CLEAR');
    const res = await clearExitSection(no, sectionId, remarks || null, user);
    revalidate(no);
    revalidatePath('/employees');
    return res;
  });
}
