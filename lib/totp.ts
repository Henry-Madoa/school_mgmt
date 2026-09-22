/*
 * Two-factor sign-in with an authenticator app — RFC 6238 TOTP (HMAC-SHA1, 30-second steps,
 * six digits), implemented on node:crypto so no third-party code sees the secrets.
 *
 * Enrolment (My Settings → Two-factor authentication): a secret is generated and shown as a QR
 * code / manual key; the user proves the app works by typing one code, and the secret is then
 * stored encrypted with TOTP_ENCRYPTION_KEY (falling back to a key derived from DATABASE_URL, which
 * keeps a fresh clone working but is not a secret — set the env in production). Ten single-use
 * recovery codes are shown once and kept hashed.
 *
 * Sign-in (lib/auth.ts): a correct password on an enrolled account does not open a session; it
 * mints a short-lived, signed "pending" ticket the /login/verify page redeems with a code. A
 * code step is accepted once (totp_last_step), so a captured code cannot be replayed within its
 * window. A permission set flagged require_two_factor forces enrolment at the next sign-in — the
 * user lands on My Settings and can go nowhere else until it is done (middleware.ts).
 */
import 'server-only';
import crypto from 'node:crypto';
import { one, run, audit } from './db.ts';
import { AppError } from './errors.ts';
import type { Actor } from './types.ts';

const STEP_SECONDS = 30;
const DIGITS = 6;
const WINDOW = 1; // accept the previous and next step too (clock drift)
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/* ------------------------------------------------------------------ base32 */

export function base32Encode(buf: Buffer): string {
  let bits = 0; let value = 0; let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0; let value = 0; const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/* ------------------------------------------------------------------ codes */

export function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', secret).update(msg).digest();
  const offset = h[h.length - 1] & 0xf;
  const code = ((h[offset] & 0x7f) << 24) | ((h[offset + 1] & 0xff) << 16) | ((h[offset + 2] & 0xff) << 8) | (h[offset + 3] & 0xff);
  return String(code % 10 ** DIGITS).padStart(DIGITS, '0');
}
export const currentStep = (now = Date.now()): number => Math.floor(now / 1000 / STEP_SECONDS);
export const totpAt = (secret: Buffer, step: number): string => hotp(secret, step);

/** The step a code matches within the drift window, or null. */
export function matchTotp(secret: Buffer, code: string, now = Date.now()): number | null {
  const wanted = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(wanted)) return null;
  const step = currentStep(now);
  for (let d = -WINDOW; d <= WINDOW; d++) {
    const s = step + d;
    const expected = hotp(secret, s);
    if (expected.length === wanted.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(wanted))) return s;
  }
  return null;
}

export const generateSecret = (): string => base32Encode(crypto.randomBytes(20));
export const otpauthUrl = (issuer: string, account: string, secret: string): string =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;

/* ------------------------------------------------------------------ at-rest encryption + tickets */

function serverKey(): Buffer {
  const env = process.env.TOTP_ENCRYPTION_KEY;
  if (env) return crypto.createHash('sha256').update(env).digest();
  return crypto.createHash('sha256').update(`totp:${process.env.DATABASE_URL ?? 'dev'}`).digest();
}
export function encryptSecret(secret: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', serverKey(), iv);
  const enc = Buffer.concat([c.update(secret, 'utf8'), c.final()]);
  return `${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${enc.toString('base64url')}`;
}
export function decryptSecret(blob: string): string {
  const [iv, tag, enc] = blob.split('.');
  const d = crypto.createDecipheriv('aes-256-gcm', serverKey(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64url')), d.final()]).toString('utf8');
}

/** A signed "password accepted, code pending" ticket — five minutes, bound to the user and their address. */
export function issuePendingTicket(userId: number, ip: string | null): string {
  const payload = Buffer.from(JSON.stringify({ u: userId, ip: ip ?? '', exp: Date.now() + 5 * 60_000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', serverKey()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
export function readPendingTicket(ticket: string | undefined, ip: string | null): number | null {
  if (!ticket) return null;
  const [payload, sig] = ticket.split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', serverKey()).update(payload).digest('base64url');
  if (expected.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { u: number; ip: string; exp: number };
    if (p.exp < Date.now()) return null;
    if (p.ip && ip && p.ip !== ip) return null;
    return p.u;
  } catch { return null; }
}

/* ------------------------------------------------------------------ enrolment + verification */

interface UserTotp { id: number; username: string; totp_secret: string | null; totp_enabled: boolean; totp_recovery_codes: string | null; totp_last_step: number | null }
const hashCode = (c: string): string => crypto.createHash('sha256').update(c.toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');

/** Start enrolment: a fresh secret held (encrypted, not yet enabled) until a code confirms it. */
export async function beginEnrolment(userId: number, issuer: string): Promise<{ secret: string; otpauth: string }> {
  const u = await one<UserTotp>('SELECT id, username, totp_secret, totp_enabled, totp_recovery_codes, totp_last_step FROM app_user WHERE id = ?', userId);
  if (!u) throw new AppError('User not found', 'NOT_FOUND');
  if (u.totp_enabled) throw new AppError('Two-factor sign-in is already switched on — switch it off first to enrol a new device', 'VALIDATION');
  const secret = generateSecret();
  await run('UPDATE app_user SET totp_secret = ?, totp_enabled = false WHERE id = ?', encryptSecret(secret), userId);
  return { secret, otpauth: otpauthUrl(issuer, u.username, secret) };
}

/** Confirm enrolment with a code from the app; returns the recovery codes, shown once. */
export async function confirmEnrolment(userId: number, code: string, actor: Actor): Promise<{ recoveryCodes: string[] }> {
  const u = await one<UserTotp>('SELECT id, username, totp_secret, totp_enabled, totp_recovery_codes, totp_last_step FROM app_user WHERE id = ?', userId);
  if (!u?.totp_secret) throw new AppError('Start enrolment first', 'VALIDATION');
  if (u.totp_enabled) throw new AppError('Already enrolled', 'VALIDATION');
  const step = matchTotp(base32Decode(decryptSecret(u.totp_secret)), code);
  if (step == null) throw new AppError('That code is not right — check the time on your phone and try the next one', 'VALIDATION');
  const codes = Array.from({ length: 10 }, () => crypto.randomBytes(5).toString('hex').toUpperCase().replace(/(.{5})/, '$1-'));
  await run('UPDATE app_user SET totp_enabled = true, totp_enrolled_at = ?, totp_recovery_codes = ?, totp_last_step = ? WHERE id = ?',
    new Date().toISOString(), JSON.stringify(codes.map(hashCode)), step, userId);
  await audit(actor, 'TOTP_ENROLLED', 'app_user', userId, {});
  return { recoveryCodes: codes };
}

/** Verify a sign-in code or a recovery code. A recovery code is consumed. */
export async function verifyCode(userId: number, code: string): Promise<boolean> {
  const u = await one<UserTotp>('SELECT id, username, totp_secret, totp_enabled, totp_recovery_codes, totp_last_step FROM app_user WHERE id = ?', userId);
  if (!u?.totp_enabled || !u.totp_secret) return false;
  const trimmed = String(code ?? '').trim();
  if (/^\d{6}$/.test(trimmed.replace(/\s/g, ''))) {
    const step = matchTotp(base32Decode(decryptSecret(u.totp_secret)), trimmed);
    if (step == null) return false;
    if (u.totp_last_step != null && step <= Number(u.totp_last_step)) return false; // replay of a used code
    await run('UPDATE app_user SET totp_last_step = ? WHERE id = ?', step, userId);
    return true;
  }
  const hashes: string[] = u.totp_recovery_codes ? JSON.parse(u.totp_recovery_codes) : [];
  const h = hashCode(trimmed);
  const idx = hashes.indexOf(h);
  if (idx < 0) return false;
  hashes.splice(idx, 1);
  await run('UPDATE app_user SET totp_recovery_codes = ? WHERE id = ?', JSON.stringify(hashes), userId);
  await audit({ id: userId, username: u.username }, 'TOTP_RECOVERY_USED', 'app_user', userId, { remaining: hashes.length });
  return true;
}

/** The user switches it off (with a current code), or an administrator resets it for them. */
export async function disableTwoFactor(userId: number, actor: Actor, code?: string): Promise<void> {
  if (code !== undefined && !(await verifyCode(userId, code))) throw new AppError('That code is not right', 'VALIDATION');
  await run('UPDATE app_user SET totp_secret = NULL, totp_enabled = false, totp_enrolled_at = NULL, totp_recovery_codes = NULL, totp_last_step = NULL WHERE id = ?', userId);
  await audit(actor, 'TOTP_DISABLED', 'app_user', userId, { byAdmin: actor.id !== userId });
}

export const remainingRecoveryCodes = async (userId: number): Promise<number> => {
  const u = await one<{ totp_recovery_codes: string | null }>('SELECT totp_recovery_codes FROM app_user WHERE id = ?', userId);
  return u?.totp_recovery_codes ? (JSON.parse(u.totp_recovery_codes) as string[]).length : 0;
};

/** Whether this user's permission set requires two-factor sign-in. */
export const twoFactorRequiredFor = async (userId: number): Promise<boolean> =>
  !!(await one<{ x: number }>('SELECT 1 AS x FROM app_user u JOIN role r ON r.id = u.role_id WHERE u.id = ? AND r.require_two_factor = true', userId));
