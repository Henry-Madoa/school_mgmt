/*
 * POST /api/mpesa/c2b/confirmation/<secret> — Daraja confirms a paybill payment has landed
 * (lib/mpesa recordC2bPayment: record once, match, post what matches).
 */
import { callbackAllowed, darajaAck } from '@/lib/mpesa/callbackGuard';
import { recordC2bPayment } from '@/lib/mpesa';
import type { C2bPayload } from '@/lib/mpesa/daraja';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ secret: string }> }): Promise<Response> {
  const { secret } = await params;
  const gate = callbackAllowed(secret, request.headers);
  if (!gate.ok) { console.warn('[mpesa] c2b confirmation refused:', gate.reason); return new Response('Forbidden', { status: 403 }); }
  let body: C2bPayload;
  try { body = await request.json(); } catch { return darajaAck(false, 'Bad JSON'); }
  try {
    const r = await recordC2bPayment(body);
    return darajaAck(true, r.duplicate ? 'Already recorded' : r.posted ? 'Posted' : 'Recorded');
  } catch (e) {
    // Nothing was recorded: answer 500 so a retry (where Safaricom offers one) reaches us again.
    console.error('[mpesa] c2b confirmation failed', e);
    return new Response('Error', { status: 500 });
  }
}
