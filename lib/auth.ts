import crypto from 'node:crypto';
import { one, all, run, audit } from './db.ts';
import { AppError } from './errors.ts';
import { passwordStrengthError } from './password.ts';
import type {
  Actor, AppUser, PermissionSet, PermissionSetLine, Profile, SessionUser, UserPermissionLine,
} from './types.ts';

/** Used when a user has no Profile assigned yet (or the row is somehow missing) — the app must
 *  still land somewhere, and Super is the original all-round dashboard. */
const SUPER_FALLBACK: Profile = {
  id: 0, code: 'SUPER', name: 'Super Role Centre', description: '', role_centre: 'SUPER',
  icon: '▤', sort: 0, is_default: 1, is_system: 1, created_at: null, created_by: null,
};

/** Every Profile assigned to a user, plus the active one (resolved, never null). A system-admin
 *  user implicitly holds every Profile. */
async function loadProfiles(
  userId: number, activeProfileId: number | null, isSystem: boolean,
): Promise<{ profiles: Profile[]; activeProfile: Profile }> {
  const all_ = await all<Profile>('SELECT * FROM profile ORDER BY sort, id');
  const profiles = isSystem
    ? all_
    : await all<Profile>(
      `SELECT p.* FROM user_profile up JOIN profile p ON p.id = up.profile_id
       WHERE up.user_id = ? ORDER BY p.sort, p.id`,
      userId,
    );
  if (!profiles.length) return { profiles: [SUPER_FALLBACK], activeProfile: SUPER_FALLBACK };
  const activeProfile = profiles.find((p) => p.id === activeProfileId)
    ?? profiles.find((p) => p.is_default)
    ?? profiles[0];
  return { profiles, activeProfile };
}

const SESSION_HOURS = 12;
export const SESSION_COOKIE = 'school_session';

/**
 * A session that has not been used for this long is refused even though its absolute expiry has
 * not passed — a teller who walks away from a signed-in screen. Configurable per deployment
 * (SESSION_IDLE_MINUTES); 0 disables the idle check.
 */
const SESSION_IDLE_MINUTES = Number(process.env.SESSION_IDLE_MINUTES ?? 120) || 0;

/** Sign-in lockout: after this many consecutive failures the account is locked for a growing
 *  period — 1, 2, 4, 8 … minutes, capped at an hour — and every attempt while locked is refused
 *  without touching the password, so a guessing loop learns nothing. */
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MAX_MINUTES = 60;

/** The table holds only the SHA-256 of the token the cookie carries. */
export const hashSessionToken = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');

export function hashPassword(plain: string, salt?: string): string {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(plain, s, 64).toString('hex');
  return `scrypt$${s}$${h}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  try {
    const [alg, salt, hash] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const candidate = crypto.scryptSync(plain, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(hash, 'hex'));
  } catch {
    return false;
  }
}

async function createSession(user: Pick<AppUser, 'id'>, ip?: string, userAgent?: string): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_HOURS * 3600 * 1000);
  await run(
    'INSERT INTO session (token, user_id, created_at, expires_at, last_seen_at, ip, user_agent) VALUES (?,?,?,?,?,?,?)',
    hashSessionToken(token), user.id, now.toISOString(), expiresAt.toISOString(), now.toISOString(),
    ip?.slice(0, 64) ?? null, userAgent?.slice(0, 250) ?? null,
  );
  await run('UPDATE app_user SET last_login_at = ?, failed_logins = 0, locked_until = NULL WHERE id = ?', now.toISOString(), user.id);
  return { token, expiresAt };
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (token) await run('DELETE FROM session WHERE token = ?', hashSessionToken(token));
}

/** Every other session of a user — an administrator's reset, or a password change, signs them out everywhere else. */
export async function destroyOtherSessions(userId: number, keepToken?: string): Promise<number> {
  const res = keepToken
    ? await run('DELETE FROM session WHERE user_id = ? AND token <> ?', userId, hashSessionToken(keepToken))
    : await run('DELETE FROM session WHERE user_id = ?', userId);
  return res.changes;
}

/** Expired and idle sessions, swept by the SESSION_PURGE job (lib/jobQueue.ts). */
export async function purgeStaleSessions(): Promise<number> {
  const now = new Date();
  const idleBefore = SESSION_IDLE_MINUTES > 0 ? new Date(now.getTime() - SESSION_IDLE_MINUTES * 60_000).toISOString() : null;
  const res = await run(
    'DELETE FROM session WHERE expires_at < ? OR (?::text IS NOT NULL AND COALESCE(last_seen_at, created_at) < ?)',
    now.toISOString(), idleBefore, idleBefore,
  );
  return res.changes;
}

/** last_seen_at is written at most once a minute per session — a page renders many components
 *  that each ask for the user, and none of them should cost a write. */
const TOUCH_INTERVAL_MS = 60_000;

export async function userFromToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const hashed = hashSessionToken(token);
  const session = await one<{ token: string; user_id: number; expires_at: string; last_seen_at: string | null; created_at: string | null }>(
    'SELECT * FROM session WHERE token = ?', hashed,
  );
  if (!session) return null;
  const now = Date.now();
  const lastSeen = Date.parse(session.last_seen_at ?? session.created_at ?? '') || now;
  const idle = SESSION_IDLE_MINUTES > 0 && now - lastSeen > SESSION_IDLE_MINUTES * 60_000;
  if (new Date(session.expires_at).getTime() < now || idle) {
    await run('DELETE FROM session WHERE token = ?', hashed);
    return null;
  }
  if (now - lastSeen > TOUCH_INTERVAL_MS) {
    await run('UPDATE session SET last_seen_at = ? WHERE token = ?', new Date(now).toISOString(), hashed);
  }

  return sessionUserById(session.user_id);
}

/** The signed-in user's full session shape — permissions and profiles resolved — for an active
 *  account. Shared by the cookie session and the web services' Basic authentication. */
export async function sessionUserById(userId: number): Promise<SessionUser | null> {
  const row = await one<AppUser & { role_name: string; is_system: 0 | 1 }>(
    `SELECT u.*, r.name AS role_name, r.is_system AS is_system
     FROM app_user u JOIN role r ON r.id = u.role_id WHERE u.id = ?`,
    userId,
  );
  if (!row || row.status !== 'ACTIVE') return null;

  // The session user travels to server components and the assistant: no hashes or secrets on it.
  const { password_hash: _hash, totp_secret: _totp, totp_recovery_codes: _codes, ...rest } = row;
  const [permissionSet, { profiles, activeProfile }] = await Promise.all([
    loadUserEffectivePermissions(row.id, row.role_id, !!row.is_system),
    loadProfiles(row.id, row.active_profile_id, !!row.is_system),
  ]);
  return { ...rest, totp_secret: null, totp_recovery_codes: null, permissionSet, profiles, activeProfile };
}

/** Folds a role's permission_set_line rows into direct {table}/{page} lookups. */
export async function loadPermissionSet(roleId: number): Promise<PermissionSet> {
  const lines = await all<PermissionSetLine>('SELECT * FROM permission_set_line WHERE role_id = ?', roleId);
  const set: PermissionSet = { tables: {}, pages: {} };
  for (const line of lines) {
    if (line.object_type === 'PAGE') {
      if (line.execute_perm) set.pages[line.object_name] = true;
    } else {
      set.tables[line.object_name] = {
        read: !!line.read_perm, insert: !!line.insert_perm, modify: !!line.modify_perm, delete: !!line.delete_perm,
      };
    }
  }
  return set;
}

/** ORs `other` into `set` in place — the Business Central "union of every assigned Permission
 *  Set" rule. */
function unionInto(set: PermissionSet, other: PermissionSet): void {
  for (const [code, on] of Object.entries(other.pages)) {
    if (on) set.pages[code] = true;
  }
  for (const [name, r] of Object.entries(other.tables)) {
    const cur = set.tables[name] ?? { read: false, insert: false, modify: false, delete: false };
    set.tables[name] = {
      read: cur.read || r.read, insert: cur.insert || r.insert,
      modify: cur.modify || r.modify, delete: cur.delete || r.delete,
    };
  }
}

/**
 * The permissions a user is *granted* — the Business Central union of their primary role
 * (`app_user.role_id`) plus every additional Permission Set assigned to them
 * (`user_permission_set`). Per-user overrides are NOT applied here — this is the baseline the
 * override editor diffs against.
 */
export async function loadGrantedPermissions(userId: number, roleId: number): Promise<PermissionSet> {
  const [set, extraSetIds] = await Promise.all([
    loadPermissionSet(roleId),
    all<{ role_id: number }>('SELECT role_id FROM user_permission_set WHERE user_id = ?', userId),
  ]);
  for (const { role_id } of extraSetIds) {
    if (role_id !== roleId) unionInto(set, await loadPermissionSet(role_id));
  }
  return set;
}

/**
 * A user's *effective* permissions, Business Central style:
 *   1. `loadGrantedPermissions` — the union of the primary role + every additional Permission Set
 *   2. then each per-user override (`user_permission_line`) applied on top — an override row
 *      replaces the granted rights for that one object, so an admin can also *restrict* a user.
 * System-admin users are unrestricted; canX() short-circuits on is_system, so their set is left
 * empty regardless of any assigned sets or override rows.
 */
export async function loadUserEffectivePermissions(
  userId: number, roleId: number, isSystem: boolean,
): Promise<PermissionSet> {
  if (isSystem) return { tables: {}, pages: {} };
  const [set, overrides] = await Promise.all([
    loadGrantedPermissions(userId, roleId),
    all<UserPermissionLine>('SELECT * FROM user_permission_line WHERE user_id = ?', userId),
  ]);
  for (const o of overrides) {
    if (o.object_type === 'PAGE') {
      if (o.execute_perm) set.pages[o.object_name] = true;
      else delete set.pages[o.object_name];
    } else {
      set.tables[o.object_name] = {
        read: !!o.read_perm, insert: !!o.insert_perm, modify: !!o.modify_perm, delete: !!o.delete_perm,
      };
    }
  }
  return set;
}

export interface LoginResult {
  token: string;
  expiresAt: Date;
  user: SessionUser | null;
}

/** The password was right but the account is enrolled for two-factor sign-in: no session yet. */
export interface TwoFactorPending { twoFactor: true; userId: number }
export const isTwoFactorPending = (r: LoginResult | TwoFactorPending): r is TwoFactorPending => 'twoFactor' in r;

/** The second half of a two-factor sign-in, once lib/totp.ts has accepted the code. */
export async function completeTwoFactorLogin(userId: number, ip?: string, userAgent?: string): Promise<LoginResult | null> {
  const row = await one<AppUser>('SELECT * FROM app_user WHERE id = ?', userId);
  if (!row || row.status !== 'ACTIVE') return null;
  await run('UPDATE app_user SET failed_logins = 0, locked_until = NULL WHERE id = ?', row.id);
  const { token, expiresAt } = await createSession(row, ip, userAgent);
  await audit(row as Actor, 'LOGIN', 'app_user', row.id, { ip, twoFactor: true });
  return { token, expiresAt, user: await userFromToken(token) };
}

/** The flag cookie middleware.ts reads while a user whose permission set requires two-factor sign-in has not enrolled. */
export const TWO_FACTOR_ENROL_COOKIE = 'school_2faenrol';
/** The signed "password accepted, code pending" ticket between the two sign-in screens. */
export const TWO_FACTOR_TICKET_COOKIE = 'school_2fa';

export class LockedOutError extends Error {
  readonly until: Date;
  // A plain field rather than a parameter property, so Node's type-stripping runner (scripts/, test/) can load this file.
  constructor(until: Date) {
    super('Too many failed sign-in attempts — try again later');
    this.name = 'LockedOutError';
    this.until = until;
  }
}

/**
 * Sign in. A wrong password counts against the account; once LOCKOUT_THRESHOLD failures stack up
 * the account locks for a doubling period, and attempts during the lock are refused before the
 * password is even checked. A successful sign-in clears the count. Unknown usernames are refused
 * the same way as wrong passwords, with the same timing, so the response does not reveal which.
 */
export async function login(username: unknown, password: unknown, ip?: string, userAgent?: string): Promise<LoginResult | TwoFactorPending | null> {
  const row = await one<AppUser>('SELECT * FROM app_user WHERE username = ?', String(username || '').trim());
  if (row?.locked_until && new Date(row.locked_until) > new Date()) {
    await audit(null, 'LOGIN_LOCKED', 'app_user', row.id, { username, ip });
    throw new LockedOutError(new Date(row.locked_until));
  }
  if (!row || row.status !== 'ACTIVE' || !verifyPassword(String(password ?? ''), row.password_hash)) {
    if (row) {
      const failures = (row.failed_logins ?? 0) + 1;
      const lockMinutes = failures >= LOCKOUT_THRESHOLD ? Math.min(2 ** (failures - LOCKOUT_THRESHOLD), LOCKOUT_MAX_MINUTES) : 0;
      const lockedUntil = lockMinutes ? new Date(Date.now() + lockMinutes * 60_000).toISOString() : null;
      await run('UPDATE app_user SET failed_logins = ?, locked_until = ? WHERE id = ?', failures, lockedUntil, row.id);
      await audit(null, 'LOGIN_FAILED', 'app_user', row.id, { username, ip, failures, lockedUntil });
    } else {
      // Cost a wrong username the same as a wrong password so the two are not distinguishable by timing.
      verifyPassword(String(password ?? ''), hashPassword('x'));
      await audit(null, 'LOGIN_FAILED', 'app_user', null, { username, ip });
    }
    return null;
  }
  // An enrolled account gets no session yet — the code screen finishes the sign-in.
  if (row.totp_enabled) {
    await audit(row as Actor, 'LOGIN_PASSWORD_OK', 'app_user', row.id, { ip, awaiting: 'two-factor code' });
    return { twoFactor: true, userId: row.id };
  }
  const { token, expiresAt } = await createSession(row, ip, userAgent);
  await audit(row as Actor, 'LOGIN', 'app_user', row.id, { ip });
  return { token, expiresAt, user: await userFromToken(token) };
}

/** Whether this user must change their password before doing anything else (set by an
 *  administrator's reset, or a production first boot). The sign-in action mirrors it into the
 *  PASSWORD_CHANGE_COOKIE flag that middleware.ts enforces without a database round trip. */
export const PASSWORD_CHANGE_COOKIE = 'school_pwchange';

/**
 * A signed-in user changing their own password (My Settings). The current password is required
 * — a session alone must not be enough to take over an account someone left signed in — and the
 * new one must meet the policy in lib/password.ts. Every other session of the user is dropped.
 */
export async function changeOwnPassword(
  user: Actor, currentPassword: string, newPassword: string, keepToken?: string,
): Promise<void> {
  const row = await one<AppUser>('SELECT * FROM app_user WHERE id = ?', user.id);
  if (!row || row.status !== 'ACTIVE') throw new AppError('Account not found', 'NOT_FOUND');
  if (!verifyPassword(String(currentPassword ?? ''), row.password_hash)) {
    await audit(user, 'PASSWORD_CHANGE_FAILED', 'app_user', user.id, {});
    throw new AppError('Your current password is incorrect', 'VALIDATION');
  }
  if (String(newPassword ?? '') === String(currentPassword ?? '')) throw new AppError('The new password must differ from the current one', 'VALIDATION');
  const weak = passwordStrengthError(String(newPassword ?? ''), { username: row.username });
  if (weak) throw new AppError(weak, 'WEAK_PASSWORD');
  await run(
    'UPDATE app_user SET password_hash = ?, password_changed_at = ?, must_change_password = false, failed_logins = 0, locked_until = NULL WHERE id = ?',
    hashPassword(String(newPassword)), new Date().toISOString(), user.id,
  );
  await destroyOtherSessions(user.id, keepToken);
  await audit(user, 'PASSWORD_CHANGE', 'app_user', user.id, {});
}

/** An administrator lifting a lock by hand (User card). */
export async function unlockUser(userId: number, actor: Actor): Promise<void> {
  await run('UPDATE app_user SET failed_logins = 0, locked_until = NULL WHERE id = ?', userId);
  await audit(actor, 'USER_UNLOCK', 'app_user', userId, {});
}
