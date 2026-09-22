import 'server-only';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, userFromToken } from './auth.ts';
import { ACTIONS, canAction, canPage, canTable, type ActionKey, type Right } from './permissions.ts';
import { ForbiddenError } from './errors.ts';
import type { SessionUser } from './types.ts';

/**
 * The signed-in user for the current request.
 *
 * The SPA kept its bearer token in localStorage; Server Components cannot read
 * that, and it was readable by any injected script. The token now lives in an
 * httpOnly cookie. `cache()` dedupes the session lookup across every component
 * that asks for the user while rendering one request.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  return userFromToken(store.get(SESSION_COOKIE)?.value);
});

/** The current user, or a redirect to the sign-in screen. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

/** The current user, or a thrown ForbiddenError if they lack `right` on `table`. */
export async function requireTable(table: string, right: Right): Promise<SessionUser> {
  const user = await requireUser();
  if (!canTable(user, table, right)) throw new ForbiddenError(`${table}:${right}`);
  return user;
}

/** The current user, or a thrown ForbiddenError if they lack Execute on `page`. */
export async function requirePage(page: string): Promise<SessionUser> {
  const user = await requireUser();
  if (!canPage(user, page)) throw new ForbiddenError(page);
  return user;
}

/** The current user, or a thrown ForbiddenError if they lack the page + table rights `key` needs. */
export async function requireAction(key: ActionKey): Promise<SessionUser> {
  const user = await requireUser();
  if (!canAction(user, key)) throw new ForbiddenError(ACTIONS[key].page);
  return user;
}

/** Non-throwing action check for the current user — for UI visibility only. */
export async function currentCanAction(key: ActionKey): Promise<boolean> {
  return canAction(await getCurrentUser(), key);
}

/**
 * Passes when the user holds ANY of the actions — an HR officer's module action or an employee's
 * self-service one (lib/selfService.ts). The first key names the permission in the refusal,
 * since it is the module's own action the screen is really about.
 */
export async function requireAnyAction(...keys: ActionKey[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!keys.some((k) => canAction(user, k))) throw new ForbiddenError(ACTIONS[keys[0]].page);
  return user;
}

/** Non-throwing counterpart of requireAnyAction — for UI visibility only. */
export async function currentCanAnyAction(...keys: ActionKey[]): Promise<boolean> {
  const user = await getCurrentUser();
  return keys.some((k) => canAction(user, k));
}

/** Non-throwing page-execute check for the current user — for UI visibility only. */
export async function currentCanPage(page: string): Promise<boolean> {
  return canPage(await getCurrentUser(), page);
}

/**
 * The tab gate for a module whose screens are pages of their own (lib/permissions.ts PAGES,
 * `parent`). Returns the tabs the user may open, for the tab strip. The requested tab must be
 * one of them — except that the module's bare route lands on its default tab, and a user who
 * cannot open that one is sent to the first tab they can rather than shown a wall.
 */
export function requireModuleTab<T extends { key: string }>(
  user: SessionUser, tabs: T[], pageOf: Record<string, string>, tab: string,
  atModuleRoot: boolean, hrefFor: (key: string) => string,
): T[] {
  const visible = tabs.filter((t) => canPage(user, pageOf[t.key]));
  if (!canPage(user, pageOf[tab])) {
    if (atModuleRoot && visible.length) redirect(hrefFor(visible[0].key));
    throw new ForbiddenError(pageOf[tab]);
  }
  return visible;
}
