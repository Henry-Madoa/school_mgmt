'use server';

import { revalidatePath } from 'next/cache';
import { requireAction, requireAnyAction, requireUser } from '@/lib/session';
import { resolveActingEmployee } from '@/lib/selfService';
import { destroyAsset } from '@/lib/cloudinary';
import { actionResult } from '@/lib/errors';
import {
  createEmployeeEditRequest, updateEmployeeEditRequest, deleteEmployeeEditRequest, submitEmployeeEditRequest, cancelEmployeeEditApproval,
  approveEmployeeEdit, rejectEmployeeEdit, processEmployeeEdit, getEmployeeEditRequest,
  replaceEditNextOfKin, replaceEditBeneficiaries, replaceEditDependants, replaceEditEmergencyContacts,
  replaceEditProfessionalBodies, replaceEditWorkHistory, replaceEditBankAccounts,
} from '@/lib/employeeEdits';
import { PAYROLL_SALARY_FIELDS, type EmployeeInput } from '@/lib/employees';
import { canAction } from '@/lib/permissions';
import { findPendingRoutedTask, decideWorkflowTask } from '@/lib/workflow';
import type {
  ActionResult, FormValues, EmployeeEditNextOfKin, EmployeeEditBeneficiary, EmployeeEditDependant,
  EmployeeEditEmergencyContact, EmployeeEditProfessionalBody, EmployeeEditWorkHistory, EmployeeEditBankAccount,
} from '@/lib/types';

const revalidate = (no?: string) => {
  for (const p of ['/employee-edits', '/approvals', '/employees', '/self-service', '/self-service/record', '/self-service/employee-editing', '/dashboard']) revalidatePath(p);
  if (no) revalidatePath(`/employee-edits/view/${no}`);
};

export async function createEmployeeEditRequestAction(employeeId: number): Promise<ActionResult<{ no: string }>> {
  return actionResult(async () => {
    const user = await requireAnyAction('EMPLOYEE_EDITS_UPDATE', 'SELF_SERVICE_RECORD_UPDATE');
    // Self Service: the request is always against the signed-in employee's own record.
    const res = await createEmployeeEditRequest(await resolveActingEmployee(user, 'EMPLOYEE_EDITS_UPDATE', employeeId || null), user);
    revalidate();
    return res;
  });
}

/** A cleared picker posts '', which no integer column will take — the id fields have to come
 *  back as a number or a null. */
function toEditInput(values: FormValues): EmployeeInput {
  const body: EmployeeInput = { ...values } as EmployeeInput;
  for (const k of ['county_id', 'sub_county_id', 'job_grade_id', 'global_dimension_1_id', 'global_dimension_2_id', 'company_job_id'] as const) {
    if (values[k] !== undefined) (body as Record<string, unknown>)[k] = values[k] ? Number(values[k]) : null;
  }
  return body;
}

export async function updateEmployeeEditRequestAction(no: string, values: FormValues): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const user = await requireAnyAction('EMPLOYEE_EDITS_UPDATE', 'SELF_SERVICE_RECORD_UPDATE');
    const input = toEditInput(values);
    // The Payroll Salary Card is HR's: an employee editing their own record under Self Service
    // cannot touch it, whatever the form posted.
    if (!canAction(user, 'EMPLOYEE_EDITS_UPDATE')) {
      for (const f of [...PAYROLL_SALARY_FIELDS, 'job_grade_id'] as const) delete (input as Record<string, unknown>)[f];
    }
    await updateEmployeeEditRequest(no, input, user);
    revalidate(no);
    return { updated: true };
  });
}

async function guardOpenEdit(no: string): Promise<void> {
  const req = await getEmployeeEditRequest(no);
  if (!req) throw new Error('Edit request not found');
  if (req.status !== 'Open') throw new Error('Only an open edit request can be edited');
}

export async function saveEditNextOfKin(no: string, rows: Omit<EmployeeEditNextOfKin, 'id' | 'edit_no'>[]): Promise<ActionResult<{ saved: true }>> {
  return actionResult(async () => {
    await requireAnyAction('EMPLOYEE_EDITS_UPDATE', 'SELF_SERVICE_RECORD_UPDATE');
    await guardOpenEdit(no);
    await replaceEditNextOfKin(no, rows);
    revalidate(no);
    return { saved: true };
  });
}
export async function saveEditBeneficiaries(no: string, rows: Omit<EmployeeEditBeneficiary, 'id' | 'edit_no'>[]): Promise<ActionResult<{ saved: true }>> {
  return actionResult(async () => {
    await requireAnyAction('EMPLOYEE_EDITS_UPDATE', 'SELF_SERVICE_RECORD_UPDATE');
    await guardOpenEdit(no);
    await replaceEditBeneficiaries(no, rows);
    revalidate(no);
    return { saved: true };
  });
}
export async function saveEditDependants(no: string, rows: Omit<EmployeeEditDependant, 'id' | 'edit_no'>[]): Promise<ActionResult<{ saved: true }>> {
  return actionResult(async () => {
    await requireAnyAction('EMPLOYEE_EDITS_UPDATE', 'SELF_SERVICE_RECORD_UPDATE');
    await guardOpenEdit(no);
    await replaceEditDependants(no, rows);
    revalidate(no);
    return { saved: true };
  });
}
export async function saveEditEmergencyContacts(no: string, rows: Omit<EmployeeEditEmergencyContact, 'id' | 'edit_no'>[]): Promise<ActionResult<{ saved: true }>> {
  return actionResult(async () => {
    await requireAnyAction('EMPLOYEE_EDITS_UPDATE', 'SELF_SERVICE_RECORD_UPDATE');
    await guardOpenEdit(no);
    await replaceEditEmergencyContacts(no, rows);
    revalidate(no);
    return { saved: true };
  });
}
export async function saveEditProfessionalBodies(no: string, rows: Omit<EmployeeEditProfessionalBody, 'id' | 'edit_no'>[]): Promise<ActionResult<{ saved: true }>> {
  return actionResult(async () => {
    await requireAnyAction('EMPLOYEE_EDITS_UPDATE', 'SELF_SERVICE_RECORD_UPDATE');
    await guardOpenEdit(no);
    await replaceEditProfessionalBodies(no, rows);
    revalidate(no);
    return { saved: true };
  });
}
export async function saveEditWorkHistory(no: string, rows: Omit<EmployeeEditWorkHistory, 'id' | 'edit_no'>[]): Promise<ActionResult<{ saved: true }>> {
  return actionResult(async () => {
    await requireAnyAction('EMPLOYEE_EDITS_UPDATE', 'SELF_SERVICE_RECORD_UPDATE');
    await guardOpenEdit(no);
    await replaceEditWorkHistory(no, rows);
    revalidate(no);
    return { saved: true };
  });
}
export async function saveEditBankAccounts(no: string, rows: Omit<EmployeeEditBankAccount, 'id' | 'edit_no'>[]): Promise<ActionResult<{ saved: true }>> {
  return actionResult(async () => {
    await requireAnyAction('EMPLOYEE_EDITS_UPDATE', 'SELF_SERVICE_RECORD_UPDATE');
    await guardOpenEdit(no);
    await replaceEditBankAccounts(no, rows);
    revalidate(no);
    return { saved: true };
  });
}

export async function submitEmployeeEditRequestAction(no: string): Promise<ActionResult<{ updated: true; autoApproved: boolean }>> {
  return actionResult(async () => {
    const user = await requireAnyAction('EMPLOYEE_EDITS_UPDATE', 'SELF_SERVICE_RECORD_UPDATE');
    const { autoApproved } = await submitEmployeeEditRequest(no, user);
    revalidate(no);
    return { updated: true, autoApproved };
  });
}

export async function deleteEmployeeEditRequestAction(no: string): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => {
    const user = await requireAnyAction('EMPLOYEE_EDITS_DELETE', 'SELF_SERVICE_RECORD_DELETE');
    const { orphanedAssets } = await deleteEmployeeEditRequest(no, user);
    for (const id of orphanedAssets) if (!id.startsWith('data:')) await destroyAsset(id).catch(() => undefined);
    revalidate();
    return { deleted: true };
  });
}

export async function cancelEmployeeEditApprovalAction(no: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const user = await requireAnyAction('EMPLOYEE_EDITS_UPDATE', 'SELF_SERVICE_RECORD_UPDATE');
    await cancelEmployeeEditApproval(no, user);
    revalidate(no);
    return { updated: true };
  });
}

export async function approveEmployeeEditAction(no: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const routed = await findPendingRoutedTask('EMPLOYEE_EDIT', no);
    if (routed) {
      const user = await requireUser();
      await decideWorkflowTask(routed.id, true, null, user);
    } else {
      const user = await requireAction('EMPLOYEE_EDITS_APPROVE');
      await approveEmployeeEdit(no, user);
    }
    revalidate(no);
    return { updated: true };
  });
}

export async function rejectEmployeeEditAction(no: string, reason: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const routed = await findPendingRoutedTask('EMPLOYEE_EDIT', no);
    if (routed) {
      const user = await requireUser();
      await decideWorkflowTask(routed.id, false, reason || null, user);
    } else {
      const user = await requireAction('EMPLOYEE_EDITS_APPROVE');
      await rejectEmployeeEdit(no, reason || null, user);
    }
    revalidate(no);
    return { updated: true };
  });
}

export async function processEmployeeEditAction(no: string): Promise<ActionResult<{ employeeId: number }>> {
  return actionResult(async () => {
    const user = await requireAction('EMPLOYEE_EDITS_APPROVE');
    const { employeeId, orphanedAssets } = await processEmployeeEdit(no, user);
    // The photo / signature the employee no longer references are gone from media storage too.
    for (const id of orphanedAssets) if (!id.startsWith('data:')) await destroyAsset(id).catch(() => undefined);
    revalidate(no);
    revalidatePath(`/employees/view/${employeeId}`);
    return { employeeId };
  });
}
