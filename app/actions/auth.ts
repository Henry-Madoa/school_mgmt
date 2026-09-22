'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import * as auth from '@/lib/auth';
import { audit } from '@/lib/db';
import { getCurrentUser } from '@/lib/session';
import { rateLimit, clientIp, LIMITS } from '@/lib/rateLimit';
import { issuePendingTicket, readPendingTicket, verifyCode, twoFactorRequiredFor } from '@/lib/totp';

export interface SignInState {
  error?: string;
}

export async function signIn(_prevState: SignInState, formData: FormData): Promise<SignInState> {
  const username = formData.get('username');
  const password = formData.get('password');

  const requestHeaders = await headers();
  const ip = requestHeaders.get('x-forwarded-for') || 'local';
  // Throttle before touching the database: per address, and per address + account.
  const addr = clientIp(requestHeaders);
  const perIp = rateLimit(`login:${addr}`, LIMITS.loginPerIp.limit, LIMITS.loginPerIp.windowMs);
  const perAccount = rateLimit(`login:${addr}:${String(username ?? '').trim().toLowerCase()}`, LIMITS.loginPerAccount.limit, LIMITS.loginPerAccount.windowMs);
  if (!perIp.ok || !perAccount.ok) {
    const secs = Math.max(perIp.retryAfterSeconds, perAccount.retryAfterSeconds);
    return { error: `Too many sign-in attempts. Try again in ${Math.ceil(secs / 60)} minute${secs > 90 ? 's' : ''}.` };
  }
  let result: auth.LoginResult | auth.TwoFactorPending | null;
  try {
    result = await auth.login(username, password, ip, requestHeaders.get('user-agent') ?? undefined);
  } catch (e) {
    if (e instanceof auth.LockedOutError) {
      const mins = Math.max(1, Math.ceil((e.until.getTime() - Date.now()) / 60_000));
      return { error: `Too many failed sign-in attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` };
    }
    throw e;
  }

  if (!result) return { error: 'Username or password is incorrect' };

  const store = await cookies();
  if (auth.isTwoFactorPending(result)) {
    // Password accepted; the code screen redeems this five-minute ticket for the session.
    store.set(auth.TWO_FACTOR_TICKET_COOKIE, issuePendingTicket(result.userId, addr), { httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production', maxAge: 5 * 60 });
    redirect('/login/verify');
  }
  return finishSignIn(result);
}

/** The cookies a fresh session sets, and where it lands: password change first, then enrolment if the permission set demands it. */
async function finishSignIn(result: auth.LoginResult): Promise<never> {
  const store = await cookies();
  const secure = process.env.NODE_ENV === 'production';
  store.set(auth.SESSION_COOKIE, result.token, {
    httpOnly: true,          // the SPA kept this in localStorage, where any script could read it
    sameSite: 'lax',
    path: '/',
    secure,
    expires: result.expiresAt,
  });
  store.delete(auth.TWO_FACTOR_TICKET_COOKIE);
  // The forced-change flag middleware.ts reads — a plain marker, not a credential.
  if (result.user?.must_change_password) {
    store.set(auth.PASSWORD_CHANGE_COOKIE, '1', { httpOnly: true, sameSite: 'lax', path: '/', secure, expires: result.expiresAt });
    redirect('/my-settings?password=required');
  }
  store.delete(auth.PASSWORD_CHANGE_COOKIE);
  if (result.user && !result.user.totp_enabled && await twoFactorRequiredFor(result.user.id)) {
    store.set(auth.TWO_FACTOR_ENROL_COOKIE, '1', { httpOnly: true, sameSite: 'lax', path: '/', secure, expires: result.expiresAt });
    redirect('/my-settings?totp=required');
  }
  store.delete(auth.TWO_FACTOR_ENROL_COOKIE);

  redirect('/dashboard');
}

export interface VerifyState { error?: string }

/** The second sign-in screen: an authenticator code (or a recovery code) against the pending ticket. */
export async function verifyTwoFactor(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  const requestHeaders = await headers();
  const addr = clientIp(requestHeaders);
  const store = await cookies();
  const userId = readPendingTicket(store.get(auth.TWO_FACTOR_TICKET_COOKIE)?.value, addr);
  if (!userId) { store.delete(auth.TWO_FACTOR_TICKET_COOKIE); redirect('/login'); }
  const throttle = rateLimit(`2fa:${userId}`, 8, 5 * 60_000);
  if (!throttle.ok) return { error: 'Too many attempts — sign in again in a few minutes.' };
  const code = String(formData.get('code') ?? '');
  if (!(await verifyCode(userId, code))) {
    await audit(null, 'LOGIN_2FA_FAILED', 'app_user', userId, { ip: addr });
    return { error: 'That code is not right. Codes change every 30 seconds — try the current one, or a recovery code.' };
  }
  const result = await auth.completeTwoFactorLogin(userId, requestHeaders.get('x-forwarded-for') || 'local', requestHeaders.get('user-agent') ?? undefined);
  if (!result) return { error: 'This account cannot sign in.' };
  return finishSignIn(result);
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  const token = store.get(auth.SESSION_COOKIE)?.value;
  const user = await getCurrentUser();
  if (user) await audit(user, 'LOGOUT', 'app_user', user.id);
  await auth.destroySession(token);
  store.delete(auth.SESSION_COOKIE);
  store.delete(auth.PASSWORD_CHANGE_COOKIE);
  store.delete(auth.TWO_FACTOR_ENROL_COOKIE);
  store.delete(auth.TWO_FACTOR_TICKET_COOKIE);
  redirect('/login');
}
