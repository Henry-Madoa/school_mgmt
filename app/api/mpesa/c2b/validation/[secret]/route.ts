/*
 * POST /api/mpesa/c2b/validation/<secret> — Daraja asks whether to accept a paybill payment.
 * Every genuine payment is accepted: a wrong account number is a matching problem for the
 * M-Pesa screen, not a reason to bounce a parent's money back to their phone.
 */
import { callbackAllowed, darajaAck } from '@/lib/mpesa/callbackGuard';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ secret: string }> }): Promise<Response> {
  const { secret } = await params;
  const gate = callbackAllowed(secret, request.headers);
  if (!gate.ok) { console.warn('[mpesa] c2b validation refused:', gate.reason); return new Response('Forbidden', { status: 403 }); }
  return darajaAck(true);
}
