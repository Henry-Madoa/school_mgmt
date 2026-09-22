'use server';

import { revalidatePath } from 'next/cache';
import { requireAction } from '@/lib/session';
import { actionResult } from '@/lib/errors';
import { toCents } from '@/lib/format';
import * as feeSetup from '@/lib/fees/setup';
import * as invoices from '@/lib/fees/invoices';
import { sendFeeReminders } from '@/lib/fees/reminders';
import type { ActionResult, Cents, FormValues } from '@/lib/types';

const str = (v: unknown): string => String(v ?? '').trim();
const revalidate = () => { revalidatePath('/fees', 'layout'); revalidatePath('/admin/pool/academics/fee-items'); revalidatePath('/students', 'layout'); revalidatePath('/receivables', 'layout'); revalidatePath('/portal', 'layout'); revalidatePath('/dashboard'); };

export async function saveFeeItemRequest(values: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_FEE_ITEMS_MANAGE');
    const r = await feeSetup.saveFeeItem(values.id ? Number(values.id) : null, { code: str(values.code), name: str(values.name), glAccountId: Number(values.gl_account_id), status: str(values.status) || 'ACTIVE', sort: Number(values.sort) || 1, appliesTo: str(values.applies_to) || 'ALL' }, user);
    revalidate();
    return r;
  });
}
export async function deleteFeeItemRequest(id: number): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => { const user = await requireAction('ADMIN_FEE_ITEMS_MANAGE'); await feeSetup.deleteFeeItem(id, user); revalidate(); return { deleted: true }; });
}

/** One grade's structure for a term — `amounts` is keyed by fee item id, in major units. */
export async function saveGradeFeeStructureRequest(gradeLevelId: number, termId: number, amounts: Record<string, string | number>): Promise<ActionResult<{ saved: true }>> {
  return actionResult(async () => {
    const user = await requireAction('FEES_STRUCTURE_MANAGE');
    const rows = Object.entries(amounts).map(([feeItemId, amount]) => ({ gradeLevelId, feeItemId: Number(feeItemId), amount: toCents(amount) as Cents }));
    await feeSetup.saveGradeFeeStructure(gradeLevelId, termId, rows, user);
    revalidate();
    return { saved: true };
  });
}
export async function copyFeeStructureRequest(fromTermId: number, toTermId: number): Promise<ActionResult<{ copied: number }>> {
  return actionResult(async () => { const user = await requireAction('FEES_STRUCTURE_MANAGE'); const r = await feeSetup.copyFeeStructure(fromTermId, toTermId, user); revalidate(); return r; });
}

export async function createFeeInvoiceRunRequest(values: FormValues, instalments: { pct: number | string; due_date: string }[] = []): Promise<ActionResult<{ no: string }>> {
  return actionResult(async () => {
    const user = await requireAction('FEES_INVOICE_RUN');
    const r = await invoices.createFeeInvoiceRun({
      termId: Number(values.term_id), gradeLevelId: values.grade_level_id ? Number(values.grade_level_id) : null, postingDate: str(values.posting_date), dueDate: str(values.due_date),
      instalments: instalments.map((i) => ({ pct: Number(i.pct), due_date: str(i.due_date) })),
    }, user);
    revalidate();
    return r;
  });
}
export async function postFeeInvoiceRunRequest(no: string): Promise<ActionResult<Awaited<ReturnType<typeof invoices.postFeeInvoiceRun>>>> {
  return actionResult(async () => { const user = await requireAction('FEES_INVOICE_RUN'); const r = await invoices.postFeeInvoiceRun(no, user); revalidate(); return r; });
}
export async function deleteFeeInvoiceRunRequest(no: string): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => { const user = await requireAction('FEES_INVOICE_RUN'); await invoices.deleteFeeInvoiceRun(no, user); revalidate(); return { deleted: true }; });
}

export async function sendFeeRemindersRequest(opts: { studentIds?: number[]; streamId?: number | null; gradeLevelId?: number | null }): Promise<ActionResult<{ reminded: number; skipped: number }>> {
  return actionResult(async () => {
    const user = await requireAction('FEES_REMIND');
    const r = await sendFeeReminders(user, opts);
    revalidatePath('/admin/data/outbox');
    return { reminded: r.reminded, skipped: r.skipped };
  });
}
