'use server';

import { revalidatePath } from 'next/cache';
import { requireAction, requireUser } from '@/lib/session';
import { actionResult } from '@/lib/errors';
import {
  createContractChange, deleteContractChange, submitContractChange, cancelContractChangeApproval,
  approveContractChange, rejectContractChange, type ContractChangeInput,
} from '@/lib/employeeContractChanges';
import { findPendingRoutedTask, decideWorkflowTask } from '@/lib/workflow';
import type { ActionResult, FormValues, EmployeeContractChangeNature } from '@/lib/types';

const revalidate = (no?: string) => {
  for (const p of ['/employee-contract-changes', '/approvals', '/employees']) revalidatePath(p);
  if (no) revalidatePath(`/employee-contract-changes/view/${no}`);
};

function toInput(values: FormValues): ContractChangeInput {
  return {
    employeeId: Number(values.employeeId),
    nature: String(values.nature || 'NEW_CONTRACT') as EmployeeContractChangeNature,
    contractTypeId: values.contractTypeId ? Number(values.contractTypeId) : null,
    proposedStartDate: values.proposedStartDate ? String(values.proposedStartDate) : null,
    proposedEndDate: values.proposedEndDate ? String(values.proposedEndDate) : null,
    proposedSalaryCents: values.proposedSalaryCents ? Math.round(Number(values.proposedSalaryCents) * 100) : null,
    proposedGradeId: values.proposedGradeId ? Number(values.proposedGradeId) : null,
    reason: values.reason ? String(values.reason) : null,
  };
}

export async function requestContractChange(values: FormValues): Promise<ActionResult<{ no: string }>> {
  return actionResult(async () => {
    const user = await requireAction('EMPLOYEE_CONTRACT_CHANGES_CREATE');
    const res = await createContractChange(toInput(values), user);
    revalidate();
    return res;
  });
}

export async function deleteContractChangeRequest(no: string): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => {
    const user = await requireAction('EMPLOYEE_CONTRACT_CHANGES_CREATE');
    await deleteContractChange(no, user);
    revalidate();
    return { deleted: true };
  });
}

export async function submitContractChangeRequest(no: string): Promise<ActionResult<{ updated: true; autoApproved: boolean }>> {
  return actionResult(async () => {
    const user = await requireAction('EMPLOYEE_CONTRACT_CHANGES_CREATE');
    const { autoApproved } = await submitContractChange(no, user);
    revalidate(no);
    return { updated: true, autoApproved };
  });
}

export async function cancelContractChangeApprovalRequest(no: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const user = await requireAction('EMPLOYEE_CONTRACT_CHANGES_CREATE');
    await cancelContractChangeApproval(no, user);
    revalidate(no);
    return { updated: true };
  });
}

export async function approveContractChangeRequest(no: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const routed = await findPendingRoutedTask('EMPLOYEE_CONTRACT_CHANGE', no);
    if (routed) {
      const user = await requireUser();
      await decideWorkflowTask(routed.id, true, null, user);
    } else {
      const user = await requireAction('EMPLOYEE_CONTRACT_CHANGES_APPROVE');
      await approveContractChange(no, user);
    }
    revalidate(no);
    return { updated: true };
  });
}

export async function rejectContractChangeRequest(no: string, reason: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const routed = await findPendingRoutedTask('EMPLOYEE_CONTRACT_CHANGE', no);
    if (routed) {
      const user = await requireUser();
      await decideWorkflowTask(routed.id, false, reason || null, user);
    } else {
      const user = await requireAction('EMPLOYEE_CONTRACT_CHANGES_APPROVE');
      await rejectContractChange(no, reason || null, user);
    }
    revalidate(no);
    return { updated: true };
  });
}
