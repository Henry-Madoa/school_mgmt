/*
 * The request proxy (Next 16's successor to middleware) — deliberately tiny and database-free.
 *
 * Forced password change: sign-in sets the `school_pwchange` flag cookie when the account is
 * marked must_change_password (an administrator's reset, a production first boot), and a
 * successful change on My Settings clears it. While the flag is present every page except
 * My Settings, sign-in and the API surface is sent to the password form. The flag is a marker,
 * not a credential: it carries no identity and grants nothing — lib/auth.ts enforces the actual
 * session on every request as before.
 */
import { NextResponse, type NextRequest } from 'next/server';

const PASSWORD_CHANGE_COOKIE = 'school_pwchange';
/** Same idea for two-factor enrolment a permission set requires (lib/auth.ts TWO_FACTOR_ENROL_COOKIE). */
const TWO_FACTOR_ENROL_COOKIE = 'school_2faenrol';
const OPEN_WHILE_FORCED = ['/my-settings', '/login', '/api/', '/ODataV4', '/WS', '/_next/', '/favicon'];

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const forced = request.cookies.get(PASSWORD_CHANGE_COOKIE)?.value === '1' ? '?password=required'
    : request.cookies.get(TWO_FACTOR_ENROL_COOKIE)?.value === '1' ? '?totp=required' : null;
  if (forced && !OPEN_WHILE_FORCED.some((p) => pathname === p || pathname.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = '/my-settings';
    url.search = forced;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Everything but Next's own static assets.
  matcher: ['/((?!_next/static|_next/image).*)'],
};
