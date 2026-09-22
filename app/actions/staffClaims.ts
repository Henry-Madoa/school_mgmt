'use server';

import { revalidatePath } from 'next/cache';
import { requireAction, requireUser } from '@/lib/session';
import { actionResult } from '@/lib/errors';
import { all } from '@/lib/db';
import {
  createStaffClaim, updateStaffClaim, deleteStaffClaim, setStaffClaimPayment, submitStaffClaim, cancelStaffClaimApproval,
  approveStaffClaim, rejectStaffClaim, reopenStaffClaim, stopStaffClaimPayment, postStaffClaim,
  type StaffClaimInput, type StaffClaimLineInput,
} from '@/lib/staffClaims';
import { findPendingRoutedTask, decideWorkflowTask } from '@/lib/workflow';
import type { ActionResult, Cents, FormValues, IsoDate, StaffClaimSettlement } from '@/lib/types';

export interface StaffClaimLineDraft { glAccountCode: string; narration: string; expenseDate: string; receiptRef: string; quantity: string; unitCost: string; amount: string }

const revalidate = (no?: string) => {
  for (const p of ['/imprest', '/imprest/staff-claims', '/approvals', '/payroll']) revalidatePath(p);
  if (no) revalidatePath(`/imprest/staff-claims/${no}`);
};
const money = (v: unknown): Cents => (v === '' || v == null ? 0 : Math.round(Number(v) * 100));
const opt = (v: unknown): string | null => (v == null || v === '' ? null : String(v));

async function toInput(v: FormValues, lines: StaffClaimLineDraft[]): Promise<StaffClaimInput> {
  const codes = lines.map((l) => l.glAccountCode).filter(Boolean);
  const rows = codes.length ? await all<{ id: number; code: string }>('SELECT id, code FROM gl_account WHERE code = ANY(?)', codes) : [];
  const ids = new Map(rows.map((r) => [r.code, r.id]));
  const mapped: StaffClaimLineInput[] = lines.filter((l) => l.glAccountCode || Number(l.amount)).map((l) => ({
    glAccountId: ids.get(l.glAccountCode) ?? 0, narration: l.narration || null, expenseDate: (l.expenseDate || null) as IsoDate | null,
    receiptRef: l.receiptRef || null, quantity: Number(l.quantity) || 1, unitCost: money(l.unitCost), amount: money(l.amount),
  }));
  return {
    employeeId: Number(v.employeeId), claimDate: String(v.claimDate || ''), description: String(v.description || ''), justification: opt(v.justification),
    settlement: String(v.settlement || 'Pay Now') as StaffClaimSettlement, payingBankAccountId: v.payingBankAccountId ? Number(v.payingBankAccountId) : null,
    payModeCode: opt(v.payModeCode), paymentTxNo: opt(v.paymentTxNo), lines: mapped,
  };
}

export async function requestStaffClaim(values: FormValues, lines: StaffClaimLineDraft[]): Promise<ActionResult<{ no: string }>> {
  return actionResult(async () => { const r = await createStaffClaim(await toInput(values, lines), await requireAction('IMPREST_CREATE')); revalidate(); return r; });
}
export async function saveStaffClaim(no: string, values: FormValues, lines: StaffClaimLineDraft[]): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => { await updateStaffClaim(no, await toInput(values, lines), await requireAction('IMPREST_CREATE')); revalidate(no); return { updated: true }; });
}
export async function setStaffClaimPaymentAction(no: string, values: FormValues): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    await setStaffClaimPayment(no, { settlement: String(values.settlement || 'Pay Now') as StaffClaimSettlement, payingBankAccountId: values.payingBankAccountId ? Number(values.payingBankAccountId) : null, payModeCode: opt(values.payModeCode), paymentTxNo: opt(values.paymentTxNo) }, await requireAction('IMPREST_POST'));
    revalidate(no); return { updated: true };
  });
}
export async function deleteStaffClaimAction(no: string): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => { await deleteStaffClaim(no, await requireAction('IMPREST_CREATE')); revalidate(); return { deleted: true }; });
}
export async function submitStaffClaimAction(no: string): Promise<ActionResult<{ updated: true; autoApproved: boolean }>> {
  return actionResult(async () => { const { autoApproved } = await submitStaffClaim(no, await requireAction('IMPREST_CREATE')); revalidate(no); return { updated: true, autoApproved }; });
}
export async function cancelStaffClaimApprovalAction(no: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => { await cancelStaffClaimApproval(no, await requireAction('IMPREST_CREATE')); revalidate(no); return { updated: true }; });
}
export async function approveStaffClaimAction(no: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const routed = await findPendingRoutedTask('STAFF_CLAIM', no);
    if (routed) await decideWorkflowTask(routed.id, true, null, await requireUser()); else await approveStaffClaim(no, await requireAction('IMPREST_APPROVE'));
    revalidate(no); return { updated: true };
  });
}
export async function rejectStaffClaimAction(no: string, reason: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const routed = await findPendingRoutedTask('STAFF_CLAIM', no);
    if (routed) await decideWorkflowTask(routed.id, false, reason || null, await requireUser()); else await rejectStaffClaim(no, reason || null, await requireAction('IMPREST_APPROVE'));
    revalidate(no); return { updated: true };
  });
}
export async function reopenStaffClaimAction(no: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => { await reopenStaffClaim(no, await requireAction('IMPREST_APPROVE')); revalidate(no); return { updated: true }; });
}
export async function stopStaffClaimAction(no: string, reason: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => { await stopStaffClaimPayment(no, true, reason || null, await requireAction('IMPREST_POST')); revalidate(no); return { updated: true }; });
}
export async function releaseStaffClaimAction(no: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => { await stopStaffClaimPayment(no, false, null, await requireAction('IMPREST_POST')); revalidate(no); return { updated: true }; });
}
export async function postStaffClaimAction(no: string): Promise<ActionResult<{ journalNo: string; toPayroll: boolean }>> {
  return actionResult(async () => { const r = await postStaffClaim(no, await requireAction('IMPREST_POST')); revalidate(no); return r; });
}
