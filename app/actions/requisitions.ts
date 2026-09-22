'use server';

import { revalidatePath } from 'next/cache';
import { requireAction, requireAnyAction, requireUser } from '@/lib/session';
import { resolveActingEmployee } from '@/lib/selfService';
import { actionResult } from '@/lib/errors';
import {
  createRequisition, updateRequisition, deleteRequisition, submitRequisition, cancelRequisitionApproval, approveRequisition, rejectRequisition,
  reopenRequisition, setQuantityApproved, setQuantityToIssue, issueStoreItems, confirmStoreReceipt, setLineDecision, executeRequisitionReview,
  closePurchaseRequisition, WORKFLOW_TYPE, type RequisitionInput, type RequisitionLineInput, type ExecuteReviewResult,
} from '@/lib/requisitions';
import { findPendingRoutedTask, decideWorkflowTask } from '@/lib/workflow';
import type { ActionResult, Cents, FormValues, IsoDate, ProcurementMethod, RequisitionCloseReason, RequisitionDecision, RequisitionLineType, RequisitionType } from '@/lib/types';

export interface RequisitionLineDraft { type: string; no: string; description: string; unitOfMeasureId: string; quantity: string; unitPrice: string; locationId: string }

const revalidate = (no?: string) => {
  for (const p of ['/requisitions', '/requisitions/store', '/requisitions/purchase', '/self-service', '/self-service/requisitions', '/dashboard', '/approvals', '/payables', '/payables/purchase-orders', '/payables/purchase-quotes', '/inventory/item-journal', '/inventory/items']) revalidatePath(p);
  if (no) revalidatePath(`/requisitions/view/${no}`);
};
const money = (v: unknown): Cents => (v === '' || v == null ? 0 : Math.round(Number(v) * 100));
const opt = (v: unknown): string | null => (v == null || v === '' ? null : String(v));
const optDate = (v: unknown): IsoDate | null => opt(v) as IsoDate | null;
const optNum = (v: unknown): number | null => (v == null || v === '' ? null : Number(v));

function toInput(type: RequisitionType, v: FormValues, lines: RequisitionLineDraft[]): RequisitionInput {
  const mapped: RequisitionLineInput[] = lines.filter((l) => l.no).map((l) => ({
    type: (type === 'Store Requisition' ? 'Item' : l.type || 'Item') as RequisitionLineType, no: l.no, description: l.description || null,
    unitOfMeasureId: optNum(l.unitOfMeasureId), quantity: Number(l.quantity) || 0, unitPrice: money(l.unitPrice), locationId: optNum(l.locationId),
  }));
  return {
    requisitionType: type, employeeId: Number(v.employeeId), title: String(v.title || ''), description: opt(v.description),
    requisitionDate: String(v.requisitionDate || '') as IsoDate, neededByDate: optDate(v.neededByDate), expirationDate: optDate(v.expirationDate),
    requestedDeliveryDate: optDate(v.requestedDeliveryDate), locationId: optNum(v.locationId),
    procurementMethod: opt(v.procurementMethod) as ProcurementMethod | null, supplierId: optNum(v.supplierId), lines: mapped,
  };
}

export async function requestRequisition(type: RequisitionType, values: FormValues, lines: RequisitionLineDraft[]): Promise<ActionResult<{ no: string }>> {
  return actionResult(async () => {
    const user = await requireAnyAction('REQUISITIONS_CREATE', 'SELF_SERVICE_REQUISITIONS_CREATE');
    // Self Service: the requisition is always the signed-in employee's own.
    const input = toInput(type, values, lines);
    input.employeeId = await resolveActingEmployee(user, 'REQUISITIONS_CREATE', input.employeeId || null);
    const r = await createRequisition(input, user); revalidate(); return r;
  });
}
export async function saveRequisition(no: string, type: RequisitionType, values: FormValues, lines: RequisitionLineDraft[]): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const user = await requireAnyAction('REQUISITIONS_CREATE', 'SELF_SERVICE_REQUISITIONS_CREATE');
    const input = toInput(type, values, lines);
    input.employeeId = await resolveActingEmployee(user, 'REQUISITIONS_CREATE', input.employeeId || null);
    await updateRequisition(no, input, user); revalidate(no); return { updated: true };
  });
}
export async function deleteRequisitionAction(no: string): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => { await deleteRequisition(no, await requireAnyAction('REQUISITIONS_CREATE', 'SELF_SERVICE_REQUISITIONS_CREATE')); revalidate(); return { deleted: true }; });
}
export async function submitRequisitionAction(no: string): Promise<ActionResult<{ updated: true; autoApproved: boolean }>> {
  return actionResult(async () => { const { autoApproved } = await submitRequisition(no, await requireAnyAction('REQUISITIONS_CREATE', 'SELF_SERVICE_REQUISITIONS_CREATE')); revalidate(no); return { updated: true, autoApproved }; });
}
export async function cancelRequisitionApprovalAction(no: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => { await cancelRequisitionApproval(no, await requireAnyAction('REQUISITIONS_CREATE', 'SELF_SERVICE_REQUISITIONS_CREATE')); revalidate(no); return { updated: true }; });
}
export async function approveRequisitionAction(no: string, type: RequisitionType): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const routed = await findPendingRoutedTask(WORKFLOW_TYPE[type], no);
    if (routed) await decideWorkflowTask(routed.id, true, null, await requireUser()); else await approveRequisition(no, await requireAction('REQUISITIONS_APPROVE'));
    revalidate(no); return { updated: true };
  });
}
export async function rejectRequisitionAction(no: string, type: RequisitionType, reason: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const routed = await findPendingRoutedTask(WORKFLOW_TYPE[type], no);
    if (routed) await decideWorkflowTask(routed.id, false, reason || null, await requireUser()); else await rejectRequisition(no, reason || null, await requireAction('REQUISITIONS_APPROVE'));
    revalidate(no); return { updated: true };
  });
}
export async function reopenRequisitionAction(no: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => { await reopenRequisition(no, await requireAction('REQUISITIONS_APPROVE')); revalidate(no); return { updated: true }; });
}
export async function setQuantityApprovedAction(no: string, lineId: number, quantity: number): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => { await setQuantityApproved(no, lineId, quantity, await requireAction('REQUISITIONS_APPROVE')); revalidate(no); return { updated: true }; });
}
export async function setQuantityToIssueAction(no: string, quantities: { lineId: number; quantity: number }[]): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => { await setQuantityToIssue(no, quantities, await requireAction('REQUISITIONS_ISSUE')); revalidate(no); return { updated: true }; });
}
export async function issueStoreItemsAction(no: string, quantities?: { lineId: number; quantity: number }[]): Promise<ActionResult<{ issued: number; complete: boolean; journalLines: string[] }>> {
  return actionResult(async () => {
    const user = await requireAction('REQUISITIONS_ISSUE');
    if (quantities?.length) await setQuantityToIssue(no, quantities, user);
    const r = await issueStoreItems(no, user); revalidate(no); return r;
  });
}
export async function confirmStoreReceiptAction(no: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => { await confirmStoreReceipt(no, await requireAction('REQUISITIONS_CREATE')); revalidate(no); return { updated: true }; });
}
export async function setLineDecisionAction(no: string, lineId: number, decision: string, targetNo: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => { await setLineDecision(no, lineId, decision as RequisitionDecision, targetNo || null, await requireAction('REQUISITIONS_PROCESS')); revalidate(no); return { updated: true }; });
}
export async function executeRequisitionReviewAction(no: string): Promise<ActionResult<ExecuteReviewResult>> {
  return actionResult(async () => { const r = await executeRequisitionReview(no, await requireAction('REQUISITIONS_PROCESS')); revalidate(no); return r; });
}
export async function closePurchaseRequisitionAction(no: string, values: FormValues): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    await closePurchaseRequisition(no, String(values.reason || '') as RequisitionCloseReason, opt(values.note), await requireAction('REQUISITIONS_PROCESS'));
    revalidate(no); return { updated: true };
  });
}
