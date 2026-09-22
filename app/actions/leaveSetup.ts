'use server';

import { revalidatePath } from 'next/cache';
import { requireAction } from '@/lib/session';
import { actionResult } from '@/lib/errors';
import {
  saveLeaveType, deleteLeaveType, createLeaveCalendar, saveHoliday, deleteHoliday,
  saveAccrueMatrixRow, deleteAccrueMatrixRow, type LeaveTypeInput,
} from '@/lib/leaveManagement';
import type { ActionResult, FormValues } from '@/lib/types';

const REVALIDATE = '/admin/pool/hr-payroll';

function toLeaveTypeInput(values: FormValues): LeaveTypeInput {
  return {
    id: values.id ? Number(values.id) : null,
    code: String(values.code || ''), name: String(values.name || ''),
    standardDays: Number(values.standardDays), accrues: !!Number(values.accrues),
    daysToAccrue: Number(values.daysToAccrue), unlimitedDays: !!Number(values.unlimitedDays),
    gender: String(values.gender || 'ANY'), balanceTreatment: String(values.balanceTreatment || 'IGNORE'),
    maxCarryForwardDays: Number(values.maxCarryForwardDays),
    inclusiveOfSaturday: !!Number(values.inclusiveOfSaturday), inclusiveOfSunday: !!Number(values.inclusiveOfSunday),
    inclusiveOfHolidays: !!Number(values.inclusiveOfHolidays), fixedDays: !!Number(values.fixedDays),
    isAnnual: !!Number(values.isAnnual), maxApplicableDays: values.maxApplicableDays ? Number(values.maxApplicableDays) : null,
    checkBalance: !!Number(values.checkBalance), isSickLeave: !!Number(values.isSickLeave),
    requiresAdminApproval: !!Number(values.requiresAdminApproval),
    leaveBalanceNotificationThreshold: values.leaveBalanceNotificationThreshold ? Number(values.leaveBalanceNotificationThreshold) : null,
    disabled: !!Number(values.disabled),
  };
}

export async function saveLeaveTypeRequest(values: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('HR_LEAVE_TYPES_MANAGE');
    const res = await saveLeaveType(toLeaveTypeInput(values), user);
    revalidatePath(REVALIDATE);
    return res;
  });
}

export async function deleteLeaveTypeRequest(id: number): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => {
    const user = await requireAction('HR_LEAVE_TYPES_MANAGE');
    await deleteLeaveType(id, user);
    revalidatePath(REVALIDATE);
    return { deleted: true };
  });
}

export async function createLeaveCalendarRequest(values: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('HR_LEAVE_CALENDAR_MANAGE');
    const res = await createLeaveCalendar({
      code: String(values.code || ''), startDate: String(values.startDate || ''), endDate: String(values.endDate || ''),
      makeCurrent: !!Number(values.makeCurrent),
    }, user);
    revalidatePath(REVALIDATE);
    return res;
  });
}

export async function saveHolidayRequest(values: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('HR_HOLIDAYS_MANAGE');
    const res = await saveHoliday({
      id: values.id ? Number(values.id) : null, date: String(values.date || ''),
      reason: String(values.reason || ''), recurring: !!Number(values.recurring),
    }, user);
    revalidatePath(REVALIDATE);
    return res;
  });
}

export async function deleteHolidayRequest(id: number): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => {
    const user = await requireAction('HR_HOLIDAYS_MANAGE');
    await deleteHoliday(id, user);
    revalidatePath(REVALIDATE);
    return { deleted: true };
  });
}

export async function saveAccrueMatrixRowRequest(values: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('HR_ACCRUE_MATRIX_MANAGE');
    const res = await saveAccrueMatrixRow({
      id: values.id ? Number(values.id) : null, leaveTypeId: Number(values.leaveTypeId), jobGradeId: Number(values.jobGradeId),
      daysToAccrue: Number(values.daysToAccrue), leaveDayWorthCents: values.leaveDayWorthCents ? Math.round(Number(values.leaveDayWorthCents) * 100) : 0,
    }, user);
    revalidatePath(REVALIDATE);
    return res;
  });
}

export async function deleteAccrueMatrixRowRequest(id: number): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => {
    const user = await requireAction('HR_ACCRUE_MATRIX_MANAGE');
    await deleteAccrueMatrixRow(id, user);
    revalidatePath(REVALIDATE);
    return { deleted: true };
  });
}
