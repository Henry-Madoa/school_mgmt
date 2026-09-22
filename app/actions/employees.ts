'use server';

import { revalidatePath } from 'next/cache';
import { requireAction, requireUser } from '@/lib/session';
import { actionResult } from '@/lib/errors';
import {
  createEmployee, updateEmployee, deleteEmployee, submitEmployeeForApproval, cancelEmployeeApproval,
  approveEmployee, rejectEmployee, getEmployee, listNextOfKin, listBeneficiaries, listDependants,
  listEmergencyContacts, listProfessionalBodies, listWorkHistory, listBankAccounts, replaceNextOfKin,
  replaceBeneficiaries, replaceDependants, replaceEmergencyContacts, replaceProfessionalBodies,
  replaceWorkHistory, replaceBankAccounts, listContracts, type EmployeeInput,
} from '@/lib/employees';
import { findPendingRoutedTask, decideWorkflowTask } from '@/lib/workflow';
import type {
  ActionResult, FormValues, EmployeeNextOfKin, EmployeeBeneficiary, EmployeeDependant,
  EmployeeEmergencyContact, EmployeeProfessionalBody, EmployeeWorkHistory, EmployeeBankAccount,
} from '@/lib/types';

const revalidate = (id?: number) => {
  for (const p of ['/employees', '/approvals']) revalidatePath(p);
  if (id) revalidatePath(`/employees/view/${id}`);
};

function toInput(values: FormValues): EmployeeInput {
  const body: EmployeeInput = { ...values } as EmployeeInput;
  for (const k of ['county_id', 'sub_county_id', 'job_grade_id', 'contract_type_id', 'manager_id', 'overview_manager_id', 'global_dimension_1_id', 'global_dimension_2_id', 'company_job_id'] as const) {
    if (values[k] !== undefined) (body as Record<string, unknown>)[k] = values[k] ? Number(values[k]) : null;
  }
  return body;
}

export async function createEmployeeRequest(values: FormValues): Promise<ActionResult<{ id: number; employeeNo: string }>> {
  return actionResult(async () => {
    const user = await requireAction('EMPLOYEES_CREATE');
    const res = await createEmployee(toInput(values), user);
    revalidate();
    return res;
  });
}

export async function updateEmployeeRequest(id: number, values: FormValues): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const user = await requireAction('EMPLOYEES_CREATE');
    await updateEmployee(id, toInput(values), user);
    revalidate(id);
    return { updated: true };
  });
}

export async function deleteEmployeeRequest(id: number): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => {
    const user = await requireAction('EMPLOYEES_CREATE');
    await deleteEmployee(id, user);
    revalidate();
    return { deleted: true };
  });
}

export async function submitEmployeeRequest(id: number): Promise<ActionResult<{ updated: true; autoApproved: boolean }>> {
  return actionResult(async () => {
    const user = await requireAction('EMPLOYEES_CREATE');
    const { autoApproved } = await submitEmployeeForApproval(id, user);
    revalidate(id);
    return { updated: true, autoApproved };
  });
}

export async function cancelEmployeeApprovalRequest(id: number): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const user = await requireAction('EMPLOYEES_CREATE');
    await cancelEmployeeApproval(id, user);
    revalidate(id);
    return { updated: true };
  });
}

export async function approveEmployeeRequest(id: number): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const routed = await findPendingRoutedTask('EMPLOYEE_ONBOARDING', String(id));
    if (routed) {
      const user = await requireUser();
      await decideWorkflowTask(routed.id, true, null, user);
    } else {
      const user = await requireAction('EMPLOYEES_APPROVE');
      await approveEmployee(id, user);
    }
    revalidate(id);
    return { updated: true };
  });
}

export async function rejectEmployeeRequest(id: number, reason: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const routed = await findPendingRoutedTask('EMPLOYEE_ONBOARDING', String(id));
    if (routed) {
      const user = await requireUser();
      await decideWorkflowTask(routed.id, false, reason || null, user);
    } else {
      const user = await requireAction('EMPLOYEES_APPROVE');
      await rejectEmployee(id, reason || null, user);
    }
    revalidate(id);
    return { updated: true };
  });
}

export async function contractsForEmployee(id: number) {
  return actionResult(async () => {
    await requireAction('EMPLOYEES_READ');
    return listContracts(id);
  });
}

/* ------------------------------------------------------------------- sub-entities */

async function guardEditable(id: number): Promise<void> {
  const emp = await getEmployee(id);
  if (!emp) throw new Error('Employee not found');
  if (emp.status !== 'NEW') throw new Error('Only a new, not-yet-submitted employee record can be edited directly — use Employee Editing instead');
}

export async function saveNextOfKin(id: number, rows: Omit<EmployeeNextOfKin, 'id' | 'employee_id'>[]): Promise<ActionResult<{ saved: true }>> {
  return actionResult(async () => {
    await requireAction('EMPLOYEES_CREATE');
    await guardEditable(id);
    await replaceNextOfKin(id, rows);
    revalidate(id);
    return { saved: true };
  });
}

export async function saveBeneficiaries(id: number, rows: Omit<EmployeeBeneficiary, 'id' | 'employee_id'>[]): Promise<ActionResult<{ saved: true }>> {
  return actionResult(async () => {
    await requireAction('EMPLOYEES_CREATE');
    await guardEditable(id);
    await replaceBeneficiaries(id, rows);
    revalidate(id);
    return { saved: true };
  });
}

export async function saveDependants(id: number, rows: Omit<EmployeeDependant, 'id' | 'employee_id'>[]): Promise<ActionResult<{ saved: true }>> {
  return actionResult(async () => {
    await requireAction('EMPLOYEES_CREATE');
    await guardEditable(id);
    await replaceDependants(id, rows);
    revalidate(id);
    return { saved: true };
  });
}

export async function saveEmergencyContacts(id: number, rows: Omit<EmployeeEmergencyContact, 'id' | 'employee_id'>[]): Promise<ActionResult<{ saved: true }>> {
  return actionResult(async () => {
    await requireAction('EMPLOYEES_CREATE');
    await guardEditable(id);
    await replaceEmergencyContacts(id, rows);
    revalidate(id);
    return { saved: true };
  });
}

export async function saveProfessionalBodies(id: number, rows: Omit<EmployeeProfessionalBody, 'id' | 'employee_id'>[]): Promise<ActionResult<{ saved: true }>> {
  return actionResult(async () => {
    await requireAction('EMPLOYEES_CREATE');
    await guardEditable(id);
    await replaceProfessionalBodies(id, rows);
    revalidate(id);
    return { saved: true };
  });
}

export async function saveWorkHistory(id: number, rows: Omit<EmployeeWorkHistory, 'id' | 'employee_id'>[]): Promise<ActionResult<{ saved: true }>> {
  return actionResult(async () => {
    await requireAction('EMPLOYEES_CREATE');
    await guardEditable(id);
    await replaceWorkHistory(id, rows);
    revalidate(id);
    return { saved: true };
  });
}

export async function saveBankAccounts(id: number, rows: Omit<EmployeeBankAccount, 'id' | 'employee_id'>[]): Promise<ActionResult<{ saved: true }>> {
  return actionResult(async () => {
    await requireAction('EMPLOYEES_CREATE');
    await guardEditable(id);
    await replaceBankAccounts(id, rows);
    revalidate(id);
    return { saved: true };
  });
}

export async function subEntitiesForEmployee(id: number) {
  return actionResult(async () => {
    await requireAction('EMPLOYEES_READ');
    const [nextOfKin, beneficiaries, dependants, emergencyContacts, professionalBodies, workHistory, bankAccounts] = await Promise.all([
      listNextOfKin(id), listBeneficiaries(id), listDependants(id), listEmergencyContacts(id),
      listProfessionalBodies(id), listWorkHistory(id), listBankAccounts(id),
    ]);
    return { nextOfKin, beneficiaries, dependants, emergencyContacts, professionalBodies, workHistory, bankAccounts };
  });
}
