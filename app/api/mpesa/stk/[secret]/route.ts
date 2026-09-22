/*
 * POST /api/mpesa/stk/<secret> — Daraja's STK push result callback (lib/mpesa handleStkCallback).
 * Always answers 200 with Daraja's ack shape once the secret checks out, or Safaricom keeps retrying.
 */
import { callbackAllowed, darajaAck } from '@/lib/mpesa/callbackGuard';
import { handleStkCallback } from '@/lib/mpesa';
import type { StkCallbackPayload } from '@/lib/mpesa/daraja';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ secret: string }> }): Promise<Response> {
  const { secret } = await params;
  const gate = callbackAllowed(secret, request.headers);
  if (!gate.ok) { console.warn('[mpesa] stk callback refused:', gate.reason); return new Response('Forbidden', { status: 403 }); }
  let body: StkCallbackPayload;
  try { body = await request.json(); } catch { return darajaAck(false, 'Bad JSON'); }
  try {
    const r = await handleStkCallback(body);
    return darajaAck(true, r.id ? (r.posted ? 'Posted' : 'Recorded') : 'Unknown request');
  } catch (e) {
    console.error('[mpesa] stk callback failed', e);
    return new Response('Error', { status: 500 });
  }
}
