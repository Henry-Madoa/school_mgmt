'use server';

import { revalidatePath } from 'next/cache';
import { requireAction } from '@/lib/session';
import { actionResult } from '@/lib/errors';
import {
  saveJobGrade, deleteJobGrade,
  saveContractType, deleteContractType, saveTerminationReason, deleteTerminationReason,
  saveClearanceSection, deleteClearanceSection,
} from '@/lib/hrSetup';
import type { ActionResult, FormValues } from '@/lib/types';

const REVALIDATE = '/admin/pool/hr-payroll';

export async function saveJobGradeRequest(values: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('HR_JOB_GRADES_MANAGE');
    const result = await saveJobGrade({
      id: values.id ? Number(values.id) : null,
      code: String(values.code || ''), name: String(values.name || ''),
      noticePeriodDays: Number(values.notice_period_days),
      probationNoticePeriodDays: Number(values.probation_notice_period_days),
      leaveAllowanceAmount: Number(values.leave_allowance_amount),
      trainingAllowanceAmount: Number(values.training_allowance_amount),
      overtimeAllowanceAmount: Number(values.overtime_allowance_amount),
    }, user);
    revalidatePath(REVALIDATE);
    return result;
  });
}

export async function deleteJobGradeRequest(id: number): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => {
    const user = await requireAction('HR_JOB_GRADES_MANAGE');
    await deleteJobGrade(id, user);
    revalidatePath(REVALIDATE);
    return { deleted: true };
  });
}

export async function saveContractTypeRequest(values: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('HR_CONTRACT_TYPES_MANAGE');
    const result = await saveContractType({
      id: values.id ? Number(values.id) : null,
      code: String(values.code || ''), name: String(values.name || ''),
      defaultNoticePeriodDays: Number(values.default_notice_period_days),
    }, user);
    revalidatePath(REVALIDATE);
    return result;
  });
}

export async function deleteContractTypeRequest(id: number): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => {
    const user = await requireAction('HR_CONTRACT_TYPES_MANAGE');
    await deleteContractType(id, user);
    revalidatePath(REVALIDATE);
    return { deleted: true };
  });
}

export async function saveTerminationReasonRequest(values: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('HR_TERMINATION_REASONS_MANAGE');
    const result = await saveTerminationReason({
      id: values.id ? Number(values.id) : null,
      code: String(values.code || ''), description: String(values.description || ''),
      payGratuity: !!Number(values.pay_gratuity),
    }, user);
    revalidatePath(REVALIDATE);
    return result;
  });
}

export async function deleteTerminationReasonRequest(id: number): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => {
    const user = await requireAction('HR_TERMINATION_REASONS_MANAGE');
    await deleteTerminationReason(id, user);
    revalidatePath(REVALIDATE);
    return { deleted: true };
  });
}

export async function saveClearanceSectionRequest(values: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('HR_CLEARANCE_SECTIONS_MANAGE');
    const result = await saveClearanceSection({
      id: values.id ? Number(values.id) : null,
      code: String(values.code || ''), name: String(values.name || ''),
      ownerEmail: values.owner_email ? String(values.owner_email) : null,
      sortOrder: Number(values.sort_order || 0),
    }, user);
    revalidatePath(REVALIDATE);
    return result;
  });
}

export async function deleteClearanceSectionRequest(id: number): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => {
    const user = await requireAction('HR_CLEARANCE_SECTIONS_MANAGE');
    await deleteClearanceSection(id, user);
    revalidatePath(REVALIDATE);
    return { deleted: true };
  });
}
