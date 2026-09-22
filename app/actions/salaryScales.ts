'use server';

import { revalidatePath } from 'next/cache';
import { requireAction } from '@/lib/session';
import { actionResult } from '@/lib/errors';
import {
  saveSalaryScale, deleteSalaryScale, saveScaleBenefit, deleteScaleBenefit, copyScaleBenefits, applySalaryScaleToEmployee,
} from '@/lib/salaryScales';
import type { ActionResult, FormValues } from '@/lib/types';

const revalidate = () => {
  for (const p of ['/admin/pool/hr-payroll/salary-scales', '/admin/pool/hr-payroll', '/employees', '/payroll']) revalidatePath(p);
};

/** A notch on a job grade's scale — create or edit. Basic pay arrives in major units. */
export async function saveSalaryScaleRequest(values: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('HR_SALARY_SCALES_MANAGE');
    const res = await saveSalaryScale({
      id: values.id ? Number(values.id) : null,
      jobGradeId: Number(values.job_grade_id),
      code: String(values.code || ''),
      name: values.name ? String(values.name) : null,
      basicPayCents: Math.round(Number(values.basic_pay || 0) * 100),
      sequence: values.sequence ? Number(values.sequence) : null,
      status: values.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
    }, user);
    revalidate();
    return res;
  });
}

export async function deleteSalaryScaleRequest(id: number): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => {
    const user = await requireAction('HR_SALARY_SCALES_MANAGE');
    await deleteSalaryScale(id, user);
    revalidate();
    return { deleted: true };
  });
}

/** An earning / deduction the notch confers — create or change its amount. */
export async function saveScaleBenefitRequest(scaleId: number, values: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('HR_SALARY_SCALES_MANAGE');
    const res = await saveScaleBenefit({
      salaryScaleId: scaleId, transactionCodeId: Number(values.transaction_code_id),
      amountCents: Math.round(Number(values.amount || 0) * 100), notes: values.notes ? String(values.notes) : null,
    }, user);
    revalidate();
    return res;
  });
}

export async function deleteScaleBenefitRequest(id: number): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => {
    const user = await requireAction('HR_SALARY_SCALES_MANAGE');
    await deleteScaleBenefit(id, user);
    revalidate();
    return { deleted: true };
  });
}

export async function copyScaleBenefitsRequest(fromScaleId: number, toScaleId: number): Promise<ActionResult<{ copied: number }>> {
  return actionResult(async () => {
    const user = await requireAction('HR_SALARY_SCALES_MANAGE');
    const res = await copyScaleBenefits(fromScaleId, toScaleId, user);
    revalidate();
    return res;
  });
}

/** Re-confers the employee's current notch — after benefits were edited by hand and HR wants the
 *  scale's definition back, or after a notch was reconfigured. */
export async function reapplySalaryScaleRequest(employeeId: number): Promise<ActionResult<{ basicPay: number; benefits: number }>> {
  return actionResult(async () => {
    const user = await requireAction('EMPLOYEES_CREATE');
    const emp = await (await import('@/lib/employees')).getEmployee(employeeId);
    if (!emp?.salary_scale_id) throw new (await import('@/lib/errors')).AppError('This employee is not on a salary scale notch', 'VALIDATION');
    const res = await applySalaryScaleToEmployee(employeeId, emp.salary_scale_id, user);
    revalidatePath(`/payroll/view/${employeeId}`);
    revalidatePath(`/employees/view/${employeeId}`);
    return res;
  });
}
