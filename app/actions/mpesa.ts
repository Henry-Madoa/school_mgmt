'use server';

import { revalidatePath } from 'next/cache';
import { requireAction } from '@/lib/session';
import { actionResult } from '@/lib/errors';
import {
  requestStkPayment, allocateMpesaTransaction, cancelMpesaTransaction, postMpesaTransaction, queryStkStatus,
  registerC2bUrls, mpesaConfig,
} from '@/lib/mpesa';
import { requirePortalStudent } from '@/lib/portal';
import type { ActionResult, FormValues } from '@/lib/types';

const revalidate = (id?: number) => {
  for (const p of ['/mpesa', '/fees', '/students', '/cash-management', '/portal']) revalidatePath(p, 'layout');
  if (id) revalidatePath(`/mpesa/view/${id}`);
};

export async function requestStkPaymentRequest(values: FormValues): Promise<ActionResult<{ id: number; customerMessage: string }>> {
  return actionResult(async () => {
    const user = await requireAction('MPESA_INITIATE');
    const res = await requestStkPayment({
      phone: String(values.phone || ''),
      amount: Math.round(Number(values.amount || 0) * 100),
      studentId: Number(values.studentId || 0),
      description: values.description ? String(values.description) : null,
    }, user);
    revalidate();
    return res;
  });
}

/** The Student / Parent portal's "Pay now" — only for a child on the login's own account. */
export async function portalStkPaymentRequest(values: FormValues): Promise<ActionResult<{ id: number; customerMessage: string }>> {
  return actionResult(async () => {
    const user = await requireAction('STUDENT_PORTAL_PAY');
    const student = await requirePortalStudent(user, Number(values.studentId || 0));
    const res = await requestStkPayment({ phone: String(values.phone || ''), amount: Math.round(Number(values.amount || 0) * 100), studentId: student.id, description: 'School fees' }, user);
    revalidate();
    return res;
  });
}

export async function allocateMpesaRequest(id: number, values: FormValues): Promise<ActionResult<{ ok: boolean; error?: string }>> {
  return actionResult(async () => {
    const user = await requireAction('MPESA_ALLOCATE');
    const res = await allocateMpesaTransaction(id, { studentId: Number(values.studentId || 0) }, user);
    revalidate(id);
    return res;
  });
}

export async function postMpesaRequest(id: number): Promise<ActionResult<{ ok: boolean; error?: string }>> {
  return actionResult(async () => {
    const user = await requireAction('MPESA_ALLOCATE');
    const res = await postMpesaTransaction(id, user);
    revalidate(id);
    return res;
  });
}

export async function cancelMpesaRequest(id: number, reason: string): Promise<ActionResult<{ cancelled: true }>> {
  return actionResult(async () => {
    const user = await requireAction('MPESA_ALLOCATE');
    await cancelMpesaTransaction(id, reason, user);
    revalidate(id);
    return { cancelled: true };
  });
}

export async function queryStkRequest(id: number): Promise<ActionResult<{ status: string; desc: string }>> {
  return actionResult(async () => {
    await requireAction('MPESA_READ');
    const res = await queryStkStatus(id);
    revalidate(id);
    return res;
  });
}

/** Tell Safaricom where the paybill callbacks live (once per shortcode, after deployment). */
export async function registerC2bUrlsRequest(): Promise<ActionResult<{ description: string }>> {
  return actionResult(async () => {
    await requireAction('MPESA_ALLOCATE');
    const c = mpesaConfig();
    if (!c) throw new Error('M-Pesa is not configured on this server');
    const r = await registerC2bUrls(c);
    return { description: r.ResponseDescription ?? 'Registered' };
  });
}
