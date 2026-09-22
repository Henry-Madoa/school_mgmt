/*
 * The gate every M-Pesa callback route passes through. Daraja does not sign its callbacks, so
 * two things stand between the ledger and a forged POST:
 *   - the secret in the callback path (MPESA_CALLBACK_SECRET), compared in constant time;
 *   - optionally, MPESA_ALLOWED_IPS — a comma-separated allowlist of the source addresses
 *     Safaricom publishes for its callback servers.
 * Both failing open would let anyone credit accounts, so with no secret configured every
 * callback is refused.
 */
import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { clientIp } from '../rateLimit.ts';

export function callbackAllowed(secretFromPath: string | undefined, headers: Headers): { ok: true } | { ok: false; reason: string } {
  const expected = process.env.MPESA_CALLBACK_SECRET ?? '';
  if (!expected) return { ok: false, reason: 'MPESA_CALLBACK_SECRET is not set' };
  const given = decodeURIComponent(secretFromPath ?? '');
  const a = Buffer.from(given); const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'bad secret' };
  const allow = (process.env.MPESA_ALLOWED_IPS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allow.length) {
    const ip = clientIp(headers);
    if (!allow.includes(ip)) return { ok: false, reason: `source ${ip} not allowed` };
  }
  return { ok: true };
}

/** Daraja expects this exact shape back, and a 200, or it retries. */
export const darajaAck = (ok: boolean, desc = ok ? 'Accepted' : 'Rejected') => Response.json({ ResultCode: ok ? 0 : 1, ResultDesc: desc });
