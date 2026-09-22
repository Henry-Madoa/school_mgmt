'use server';

import { revalidatePath } from 'next/cache';
import { requireAction, requireAnyAction, requireUser } from '@/lib/session';
import { resolveActingEmployee } from '@/lib/selfService';
import { actionResult } from '@/lib/errors';
import { all } from '@/lib/db';
import {
  saveImprestPurpose, deleteImprestPurpose, createImprestRequest, updateImprestRequest, deleteImprestRequest,
  submitImprestRequest, cancelImprestApproval, approveImprestRequest, rejectImprestRequest, reopenImprestRequest,
  issueImprest, saveImprestSurrender, submitImprestSurrender, cancelImprestSurrenderApproval, approveImprestSurrender,
  rejectImprestSurrender, reopenImprestSurrender, postImprestSurrender, transferImprestToPayroll,
  createPettyCash, updatePettyCash, deletePettyCash, submitPettyCash, cancelPettyCashApproval, approvePettyCash,
  rejectPettyCash, reopenPettyCash, postPettyCash, markPettyCashPaid, listImprestsAwaitingIssue,
  type ImprestInput, type ImprestLineInput, type SurrenderInput, type PettyCashInput, type PettyCashLineInput,
} from '@/lib/imprest';
import { findPendingRoutedTask, decideWorkflowTask } from '@/lib/workflow';
import type { ActionResult, Cents, FormValues, ImprestRequestFor, ImprestSettlement, IsoDate } from '@/lib/types';

const revalidate = (no?: string) => {
  for (const p of ['/imprest', '/approvals', '/cash-management', '/payroll', '/self-service', '/self-service/imprest', '/self-service/petty-cash', '/dashboard']) revalidatePath(p);
  if (no) { revalidatePath(`/imprest/view/${no}`); revalidatePath(`/imprest/petty-cash/${no}`); }
};

const money = (v: unknown): Cents => (v === '' || v == null ? 0 : Math.round(Number(v) * 100));
const opt = (v: unknown): string | null => (v == null || v === '' ? null : String(v));

/* ---------------------------------------------------------------- purposes */

export async function saveImprestPurposeRequest(values: FormValues, isNew: boolean): Promise<ActionResult<{ saved: true }>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_POOL_IMPREST_PURPOSES_MANAGE');
    await saveImprestPurpose({ code: String(values.code || ''), description: String(values.description || ''), status: Number(values.inactive) ? 'INACTIVE' : 'ACTIVE' }, user, isNew);
    revalidatePath('/admin', 'layout');
    return { saved: true };
  });
}

export async function deleteImprestPurposeRequest(code: string): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_POOL_IMPREST_PURPOSES_MANAGE');
    await deleteImprestPurpose(code, user);
    revalidatePath('/admin', 'layout');
    return { deleted: true };
  });
}

/* ---------------------------------------------------------------- imprest */

export interface ImprestLineDraft { glAccountCode: string; narration: string; quantity: string; unitCost: string; requestAmount: string }
export interface SurrenderLineDraft { id: number; actualSpent: string; surrenderNote: string }
export interface PettyCashLineDraft { glAccountCode: string; description: string; amount: string }

async function glIdsByCode(codes: string[]): Promise<Map<string, number>> {
  const rows = codes.length ? await all<{ id: number; code: string }>(`SELECT id, code FROM gl_account WHERE code = ANY(?)`, codes) : [];
  return new Map(rows.map((r) => [r.code, r.id]));
}

async function toImprestInput(v: FormValues, lines: ImprestLineDraft[]): Promise<ImprestInput> {
  const ids = await glIdsByCode(lines.map((l) => l.glAccountCode).filter(Boolean));
  const mapped: ImprestLineInput[] = lines
    .filter((l) => l.glAccountCode || Number(l.requestAmount))
    .map((l) => ({
      glAccountId: ids.get(l.glAccountCode) ?? 0, narration: l.narration || null,
      quantity: Number(l.quantity) || 1, unitCost: money(l.unitCost), requestAmount: money(l.requestAmount),
    }));
  return {
    employeeId: Number(v.employeeId), requestDate: String(v.requestDate || ''), purposeCode: opt(v.purposeCode),
    purpose: String(v.purpose || ''), description: opt(v.description), requestFor: String(v.requestFor || 'Self') as ImprestRequestFor,
    departureLocation: opt(v.departureLocation), departureDate: opt(v.departureDate) as IsoDate | null, returnDate: opt(v.returnDate) as IsoDate | null,
    justification: opt(v.justification), phoneNo: opt(v.phoneNo), payingBankAccountId: v.payingBankAccountId ? Number(v.payingBankAccountId) : null,
    payModeCode: opt(v.payModeCode), paymentTxNo: opt(v.paymentTxNo), chequeDate: opt(v.chequeDate) as IsoDate | null, lines: mapped,
  };
}

export async function requestImprest(values: FormValues, lines: ImprestLineDraft[]): Promise<ActionResult<{ no: string }>> {
  return actionResult(async () => {
    const user = await requireAnyAction('IMPREST_CREATE', 'SELF_SERVICE_IMPREST_CREATE');
    // Self Service: the request is always the signed-in employee's own.
    const input = await toImprestInput(values, lines);
    input.employeeId = await resolveActingEmployee(user, 'IMPREST_CREATE', input.employeeId || null);
    const res = await createImprestRequest(input, user);
    revalidate();
    return res;
  });
}

export async function saveImprest(no: string, values: FormValues, lines: ImprestLineDraft[]): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const user = await requireAnyAction('IMPREST_CREATE', 'SELF_SERVICE_IMPREST_CREATE');
    const input = await toImprestInput(values, lines);
    input.employeeId = await resolveActingEmployee(user, 'IMPREST_CREATE', input.employeeId || null);
    await updateImprestRequest(no, input, user);
    revalidate(no);
    return { updated: true };
  });
}

export async function deleteImprestRequestAction(no: string): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => {
    const user = await requireAnyAction('IMPREST_CREATE', 'SELF_SERVICE_IMPREST_CREATE');
    await deleteImprestRequest(no, user);
    revalidate();
    return { deleted: true };
  });
}

export async function submitImprestAction(no: string): Promise<ActionResult<{ updated: true; autoApproved: boolean }>> {
  return actionResult(async () => {
    const user = await requireAnyAction('IMPREST_CREATE', 'SELF_SERVICE_IMPREST_CREATE');
    const { autoApproved } = await submitImprestRequest(no, user);
    revalidate(no);
    return { updated: true, autoApproved };
  });
}

export async function cancelImprestApprovalAction(no: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const user = await requireAnyAction('IMPREST_CREATE', 'SELF_SERVICE_IMPREST_CREATE');
    await cancelImprestApproval(no, user);
    revalidate(no);
    return { updated: true };
  });
}

export async function approveImprestAction(no: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const routed = await findPendingRoutedTask('IMPREST_REQUEST', no);
    if (routed) await decideWorkflowTask(routed.id, true, null, await requireUser());
    else await approveImprestRequest(no, await requireAction('IMPREST_APPROVE'));
    revalidate(no);
    return { updated: true };
  });
}

export async function rejectImprestAction(no: string, reason: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const routed = await findPendingRoutedTask('IMPREST_REQUEST', no);
    if (routed) await decideWorkflowTask(routed.id, false, reason || null, await requireUser());
    else await rejectImprestRequest(no, reason || null, await requireAction('IMPREST_APPROVE'));
    revalidate(no);
    return { updated: true };
  });
}

export async function reopenImprestAction(no: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    await reopenImprestRequest(no, await requireAction('IMPREST_APPROVE'));
    revalidate(no);
    return { updated: true };
  });
}

export async function issueImprestAction(no: string): Promise<ActionResult<{ journalNo: string; dueDate: IsoDate }>> {
  return actionResult(async () => {
    const res = await issueImprest(no, await requireAction('IMPREST_ISSUE'));
    revalidate(no);
    return res;
  });
}

/* -------------------------------------------------------------- surrender */

export async function saveSurrenderAction(no: string, values: FormValues, lines: SurrenderLineDraft[]): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const user = await requireAnyAction('IMPREST_CREATE', 'SELF_SERVICE_IMPREST_CREATE');
    const input: SurrenderInput = {
      surrenderDate: String(values.surrenderDate || ''),
      lines: lines.map((l) => ({ id: l.id, actualSpent: money(l.actualSpent), surrenderNote: l.surrenderNote || null })),
      settlement: (opt(values.settlement) as ImprestSettlement | null),
      receivingBankAccountId: values.receivingBankAccountId ? Number(values.receivingBankAccountId) : null,
      receiptModeCode: opt(values.receiptModeCode), receiptTxNo: opt(values.receiptTxNo),
      claimPayingBankAccountId: values.claimPayingBankAccountId ? Number(values.claimPayingBankAccountId) : null,
      claimPayModeCode: opt(values.claimPayModeCode), claimPaymentTxNo: opt(values.claimPaymentTxNo),
    };
    await saveImprestSurrender(no, input, user);
    revalidate(no);
    return { updated: true };
  });
}

export async function submitSurrenderAction(no: string): Promise<ActionResult<{ updated: true; autoApproved: boolean }>> {
  return actionResult(async () => {
    const { autoApproved } = await submitImprestSurrender(no, await requireAnyAction('IMPREST_CREATE', 'SELF_SERVICE_IMPREST_CREATE'));
    revalidate(no);
    return { updated: true, autoApproved };
  });
}

export async function cancelSurrenderApprovalAction(no: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    await cancelImprestSurrenderApproval(no, await requireAnyAction('IMPREST_CREATE', 'SELF_SERVICE_IMPREST_CREATE'));
    revalidate(no);
    return { updated: true };
  });
}

export async function approveSurrenderAction(no: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const routed = await findPendingRoutedTask('IMPREST_SURRENDER', no);
    if (routed) await decideWorkflowTask(routed.id, true, null, await requireUser());
    else await approveImprestSurrender(no, await requireAction('IMPREST_APPROVE'));
    revalidate(no);
    return { updated: true };
  });
}

export async function rejectSurrenderAction(no: string, reason: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const routed = await findPendingRoutedTask('IMPREST_SURRENDER', no);
    if (routed) await decideWorkflowTask(routed.id, false, reason || null, await requireUser());
    else await rejectImprestSurrender(no, reason || null, await requireAction('IMPREST_APPROVE'));
    revalidate(no);
    return { updated: true };
  });
}

export async function reopenSurrenderAction(no: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    await reopenImprestSurrender(no, await requireAction('IMPREST_APPROVE'));
    revalidate(no);
    return { updated: true };
  });
}

export async function postSurrenderAction(no: string): Promise<ActionResult<{ journalNo: string; refund: Cents; claim: Cents; toPayroll: boolean }>> {
  return actionResult(async () => {
    const res = await postImprestSurrender(no, await requireAction('IMPREST_POST'));
    revalidate(no);
    return res;
  });
}

export async function transferImprestToPayrollAction(no: string): Promise<ActionResult<{ amount: Cents; periodName: string }>> {
  return actionResult(async () => {
    const res = await transferImprestToPayroll(no, await requireAction('IMPREST_PAYROLL_RECOVER'));
    revalidate(no);
    return res;
  });
}

/* -------------------------------------------------------------- petty cash */

async function toPettyCashInput(v: FormValues, lines: PettyCashLineDraft[]): Promise<PettyCashInput> {
  const ids = await glIdsByCode(lines.map((l) => l.glAccountCode).filter(Boolean));
  const mapped: PettyCashLineInput[] = lines
    .filter((l) => l.glAccountCode || Number(l.amount))
    .map((l) => ({ glAccountId: ids.get(l.glAccountCode) ?? 0, description: l.description || null, amount: money(l.amount) }));
  return {
    employeeId: Number(v.employeeId), requestDate: String(v.requestDate || ''), postingDate: opt(v.postingDate) as IsoDate | null,
    payingBankAccountId: v.payingBankAccountId ? Number(v.payingBankAccountId) : null, paymentTo: opt(v.paymentTo), onBehalfOf: opt(v.onBehalfOf),
    paymentNarration: String(v.paymentNarration || ''), payModeCode: opt(v.payModeCode), paymentTxNo: opt(v.paymentTxNo),
    chequeDate: opt(v.chequeDate) as IsoDate | null, lines: mapped,
  };
}

export async function requestPettyCash(values: FormValues, lines: PettyCashLineDraft[]): Promise<ActionResult<{ no: string }>> {
  return actionResult(async () => {
    const user = await requireAnyAction('IMPREST_CREATE', 'SELF_SERVICE_PETTY_CASH_CREATE');
    const input = await toPettyCashInput(values, lines);
    input.employeeId = await resolveActingEmployee(user, 'IMPREST_CREATE', input.employeeId || null);
    const res = await createPettyCash(input, user);
    revalidate();
    return res;
  });
}

export async function savePettyCash(no: string, values: FormValues, lines: PettyCashLineDraft[]): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const user = await requireAnyAction('IMPREST_CREATE', 'SELF_SERVICE_PETTY_CASH_CREATE');
    const input = await toPettyCashInput(values, lines);
    input.employeeId = await resolveActingEmployee(user, 'IMPREST_CREATE', input.employeeId || null);
    await updatePettyCash(no, input, user);
    revalidate(no);
    return { updated: true };
  });
}

export async function deletePettyCashAction(no: string): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => {
    await deletePettyCash(no, await requireAnyAction('IMPREST_CREATE', 'SELF_SERVICE_PETTY_CASH_CREATE'));
    revalidate();
    return { deleted: true };
  });
}

export async function submitPettyCashAction(no: string): Promise<ActionResult<{ updated: true; autoApproved: boolean }>> {
  return actionResult(async () => {
    const { autoApproved } = await submitPettyCash(no, await requireAnyAction('IMPREST_CREATE', 'SELF_SERVICE_PETTY_CASH_CREATE'));
    revalidate(no);
    return { updated: true, autoApproved };
  });
}

export async function cancelPettyCashApprovalAction(no: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    await cancelPettyCashApproval(no, await requireAnyAction('IMPREST_CREATE', 'SELF_SERVICE_PETTY_CASH_CREATE'));
    revalidate(no);
    return { updated: true };
  });
}

export async function approvePettyCashAction(no: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const routed = await findPendingRoutedTask('PETTY_CASH', no);
    if (routed) await decideWorkflowTask(routed.id, true, null, await requireUser());
    else await approvePettyCash(no, await requireAction('IMPREST_APPROVE'));
    revalidate(no);
    return { updated: true };
  });
}

export async function rejectPettyCashAction(no: string, reason: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const routed = await findPendingRoutedTask('PETTY_CASH', no);
    if (routed) await decideWorkflowTask(routed.id, false, reason || null, await requireUser());
    else await rejectPettyCash(no, reason || null, await requireAction('IMPREST_APPROVE'));
    revalidate(no);
    return { updated: true };
  });
}

export async function reopenPettyCashAction(no: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    await reopenPettyCash(no, await requireAction('IMPREST_APPROVE'));
    revalidate(no);
    return { updated: true };
  });
}

export async function postPettyCashAction(no: string): Promise<ActionResult<{ journalNo: string }>> {
  return actionResult(async () => {
    const res = await postPettyCash(no, await requireAction('IMPREST_POST'));
    revalidate(no);
    return res;
  });
}

export async function markPettyCashPaidAction(no: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    await markPettyCashPaid(no, await requireAction('IMPREST_POST'));
    revalidate(no);
    return { updated: true };
  });
}

/* ------------------------------------------------------------------ lookups */

/** The employee's imprests a receipt or voucher line may be applied to. */
export async function employeeImprestsRequest(employeeId: number, mode: 'issue' | 'settle'): Promise<ActionResult<{ no: string; purpose: string; amount: Cents }[]>> {
  return actionResult(async () => {
    await requireAction('CASH_MGMT_READ');
    if (mode === 'issue') return (await listImprestsAwaitingIssue(employeeId)).map((r) => ({ no: r.no, purpose: r.purpose, amount: r.request_amount }));
    return all<{ no: string; purpose: string; amount: Cents }>(
      `SELECT r.no, r.purpose, COALESCE((SELECT SUM(le.amount) FROM employee_ledger_entry le WHERE le.employee_id = r.employee_id AND le.document_no = r.no), 0)::bigint AS amount
       FROM imprest_request r WHERE r.employee_id = ? AND r.posted AND NOT r.surrendered ORDER BY r.no`, employeeId);
  });
}
