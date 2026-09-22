import {
  one, all, run, tx, audit, hasAnyRow,
} from './db.ts';
import { AppError } from './errors.ts';
import { hashPassword, destroyOtherSessions } from './auth.ts';
import { requireAction } from './session.ts';
import { setUserProfiles } from './profiles.ts';
import { setUserPermissionSets } from './userPermissions.ts';
import { passwordStrengthError } from './password.ts';
import { listPermissionTables } from './permissions.ts';
import { buildFilterClause, type FilterCondition, type FilterFieldDef } from './listFilters.ts';
import { buildOrderClause, type SortState } from './listSort.ts';
import type {
  Actor, AuditEntry, PermissionSetLine, Role, RoleWithUsage, UserListRow, UserStatus,
} from './types.ts';
import { assertContactDetails } from './validate.ts';

export { listPermissionTables };

/* --------------------------------------------------------------------- roles */
/*
 * One grouped join for userCount, plus one query for every role's lines —
 * still just 2 queries total, not 1 + N.
 */
export async function listRoles(): Promise<RoleWithUsage[]> {
  const [roles, lines] = await Promise.all([
    all<Role & { userCount: number }>(
      `SELECT r.*, COUNT(u.id) AS "userCount"
       FROM role r LEFT JOIN app_user u ON u.role_id = r.id
       GROUP BY r.id ORDER BY r.id`,
    ),
    all<PermissionSetLine>('SELECT * FROM permission_set_line ORDER BY role_id, object_type, object_name'),
  ]);
  const byRole = new Map<number, PermissionSetLine[]>();
  for (const line of lines) byRole.set(line.role_id, [...(byRole.get(line.role_id) ?? []), line]);
  return roles.map((r) => ({ ...r, lines: byRole.get(r.id) ?? [] }));
}

export interface RoleLineInput {
  objectType: 'TABLE' | 'PAGE';
  objectName: string;
  read?: boolean;
  insert?: boolean;
  modify?: boolean;
  delete?: boolean;
  execute?: boolean;
}

export interface RoleInput {
  name?: string;
  description?: string | null;
  lines?: RoleLineInput[];
  /** Users holding the set must sign in with an authenticator code (lib/totp.ts). */
  requireTwoFactor?: boolean;
}

async function replaceLines(roleId: number, lines: RoleLineInput[]): Promise<void> {
  await run('DELETE FROM permission_set_line WHERE role_id = ?', roleId);
  for (const line of lines) {
    await run(
      `INSERT INTO permission_set_line
        (role_id, object_type, object_name, read_perm, insert_perm, modify_perm, delete_perm, execute_perm)
       VALUES (?,?,?,?,?,?,?,?)`,
      roleId, line.objectType, line.objectName,
      line.read ? 1 : 0, line.insert ? 1 : 0, line.modify ? 1 : 0, line.delete ? 1 : 0, line.execute ? 1 : 0,
    );
  }
}

export async function createRole(
  { name, description, lines = [], requireTwoFactor = false }: RoleInput,
  user: Actor,
): Promise<{ id: number }> {
  if (!name) throw new AppError('Role name is required', 'VALIDATION');
  return tx(async () => {
    const info = await run('INSERT INTO role (name, description, require_two_factor) VALUES (?,?,?)', name, description || null, !!requireTwoFactor);
    const id = Number(info.lastInsertRowid);
    await replaceLines(id, lines);
    await audit(user, 'ROLE_CREATE', 'role', id, { name, lines: lines.length });
    return { id };
  });
}

export async function updateRole(
  id: number,
  { name, description, lines, requireTwoFactor }: RoleInput,
  user: Actor,
): Promise<Role> {
  const role = await one<Role>('SELECT * FROM role WHERE id = ?', id);
  if (!role) throw new AppError('Role not found', 'NOT_FOUND');
  if (role.is_system) throw new AppError('The System Administrator role cannot be modified', 'SYSTEM_ROLE');
  return tx(async () => {
    await run(
      `UPDATE role SET name=COALESCE(?,name), description=COALESCE(?,description), require_two_factor=COALESCE(?,require_two_factor) WHERE id=?`,
      name ?? null, description ?? null, requireTwoFactor ?? null, id,
    );
    if (lines) await replaceLines(id, lines);
    await audit(user, 'ROLE_UPDATE', 'role', id, { lines: lines?.length });
    return (await one<Role>('SELECT * FROM role WHERE id = ?', id))!;
  });
}

/* --------------------------------------------------------------------- users */
export async function listUsers(): Promise<UserListRow[]> {
  const [rows, profileLinks, overrides, extraSets] = await Promise.all([
    all<Omit<UserListRow, 'profile_codes' | 'override_count' | 'extra_permission_set_names'>>(
      `SELECT u.id, u.username, u.full_name, u.email, u.phone, u.status, u.last_login_at, u.created_at, u.company_code,
              u.failed_logins, u.locked_until, u.must_change_password, u.totp_enabled,
              r.name AS role_name, r.id AS role_id
       FROM app_user u JOIN role r ON r.id = u.role_id
       ORDER BY u.full_name`,
    ),
    all<{ user_id: number; code: string }>(
      `SELECT up.user_id, p.code FROM user_profile up JOIN profile p ON p.id = up.profile_id
       ORDER BY p.sort, p.id`,
    ),
    all<{ user_id: number; n: number }>(
      'SELECT user_id, COUNT(*) n FROM user_permission_line GROUP BY user_id',
    ),
    all<{ user_id: number; name: string }>(
      `SELECT ups.user_id, r.name FROM user_permission_set ups JOIN role r ON r.id = ups.role_id
       ORDER BY r.name`,
    ),
  ]);
  const byUser = new Map<number, string[]>();
  for (const l of profileLinks) byUser.set(l.user_id, [...(byUser.get(l.user_id) ?? []), l.code]);
  const overrideByUser = new Map(overrides.map((o) => [o.user_id, Number(o.n)]));
  const extraSetsByUser = new Map<number, string[]>();
  for (const s of extraSets) extraSetsByUser.set(s.user_id, [...(extraSetsByUser.get(s.user_id) ?? []), s.name]);
  return rows.map((r) => ({
    ...r,
    profile_codes: byUser.get(r.id) ?? [],
    extra_permission_set_names: extraSetsByUser.get(r.id) ?? [],
    override_count: overrideByUser.get(r.id) ?? 0,
  }));
}

export interface UserInput {
  username?: string;
  full_name?: string;
  email?: string | null;
  phone?: string | null;
  password?: string | null;
  role_id?: number | null;
  status?: UserStatus | null;
  /** Role Centre Profiles to assign (My Settings then lets the user switch between them).
   *  `undefined` leaves the current set alone; `[]` clears it. */
  profileIds?: number[];
  /** Pin the user to one company (null/'' = not assigned — the user picks on My Settings). */
  company_code?: string | null;
  /** Additional Permission Sets granted on top of the primary role (BC "User Permission Sets").
   *  `undefined` leaves the current set alone; `[]` clears it. Effective rights are the union. */
  permissionSetIds?: number[];
}

export async function createUser(
  { username, full_name, email, phone, password, role_id, profileIds, permissionSetIds, company_code }: UserInput,
  user: Actor,
): Promise<{ id: number }> {
  if (!username || !full_name || !password || !role_id) {
    throw new AppError('Username, name, password and role are required', 'VALIDATION');
  }
  assertContactDetails({ phone, email });
  const pwError = passwordStrengthError(String(password), { username });
  if (pwError) throw new AppError(pwError, 'WEAK_PASSWORD');
  if (await one('SELECT 1 FROM app_user WHERE username = ?', username)) {
    throw new AppError('That username is already taken', 'DUPLICATE');
  }
  return tx(async () => {
    const info = await run(
      `INSERT INTO app_user (username, full_name, email, phone, password_hash, role_id, created_at, company_code)
       VALUES (?,?,?,?,?,?,?,?)`,
      username, full_name, email || null, phone || null, hashPassword(password),
      role_id, new Date().toISOString(), company_code || null,
    );
    const newId = Number(info.lastInsertRowid);
    if (profileIds !== undefined) await setUserProfiles(newId, profileIds, user);
    if (permissionSetIds !== undefined) await setUserPermissionSets(newId, permissionSetIds, user);
    await audit(user, 'USER_CREATE', 'app_user', newId, { username, role_id });
    return { id: newId };
  });
}

export async function updateUser(
  id: number,
  { full_name, email, phone, role_id, status, password, profileIds, permissionSetIds, company_code }: UserInput,
  user: Actor,
): Promise<{ updated: true }> {
  if (Number(id) === user.id && status && status !== 'ACTIVE') {
    throw new AppError('You cannot deactivate your own account', 'SELF_LOCKOUT');
  }
  assertContactDetails({ phone, email });
  if (password) {
    const existing = await one<{ username: string }>('SELECT username FROM app_user WHERE id = ?', id);
    const pwError = passwordStrengthError(String(password), { username: existing?.username });
    if (pwError) throw new AppError(pwError, 'WEAK_PASSWORD');
  }
  await tx(async () => {
    await run(
      `UPDATE app_user SET full_name=COALESCE(?,full_name), email=COALESCE(?,email), phone=COALESCE(?,phone),
        role_id=COALESCE(?,role_id), status=COALESCE(?,status),
        password_hash=COALESCE(?,password_hash) WHERE id=?`,
      full_name ?? null, email ?? null, phone ?? null, role_id ?? null, status ?? null,
      password ? hashPassword(password) : null, id,
    );
    // The company pin is the one field where '' means "clear" — undefined leaves it alone.
    if (company_code !== undefined) await run('UPDATE app_user SET company_code = ?::text WHERE id = ?', company_code || null, id);
    if (password) {
      // A reset signs the user out everywhere and clears any lockout — the new password is the
      // only way back in. Deactivating an account drops its sessions the same way.
      await run('UPDATE app_user SET password_changed_at = ?, must_change_password = true, failed_logins = 0, locked_until = NULL WHERE id = ?', new Date().toISOString(), id);
      await destroyOtherSessions(Number(id));
    }
    if (status && status !== 'ACTIVE') await destroyOtherSessions(Number(id));
    if (profileIds !== undefined) await setUserProfiles(id, profileIds, user);
    if (permissionSetIds !== undefined) await setUserPermissionSets(id, permissionSetIds, user);
  });
  const { invalidateAssignedCompanies } = await import('./db.ts');
  invalidateAssignedCompanies();
  await audit(user, 'USER_UPDATE', 'app_user', id, { role_id, status, passwordReset: !!password, company_code });
  return { updated: true };
}
/** Audit trail list's dynamic-filter registry — every meaningful column (id/user_id are
 *  excluded as purely internal). `at` is a full timestamp filtered by a date-only input,
 *  hence `datetime: true` (see lib/listFilters.ts's end-of-day handling). */
export const AUDIT_FILTER_FIELDS: FilterFieldDef[] = [
  { key: 'at', label: 'When', type: 'date', datetime: true },
  { key: 'username', label: 'User', type: 'text' },
  { key: 'action', label: 'Action', type: 'text' },
  { key: 'entity', label: 'Entity', type: 'text' },
  { key: 'entity_id', label: 'Entity Id', type: 'text' },
  { key: 'detail', label: 'Detail', type: 'text' },
  { key: 'ip', label: 'IP Address', type: 'text' },
];

/** Audit trail list's sortable columns — every column shown in the table. */
const AUDIT_SORT_COLUMNS: Record<string, string> = {
  at: 'at',
  username: 'username',
  action: 'action',
  entity: 'entity',
  detail: 'detail',
};

export interface ListAuditLogOptions {
  search?: string;
  limit?: number;
  filters?: FilterCondition[];
  sort?: SortState | null;
}

/** Gated here, not just by the Admin Centre tab that leads to it — a direct
 *  Read right on audit_log so no future call path can reach it unguarded. */
export async function listAuditLog(
  { search = '', limit = 300, filters = [], sort = null }: ListAuditLogOptions = {},
): Promise<AuditEntry[]> {
  await requireAction('ADMIN_AUDIT_VIEW');
  const { clause, params } = buildFilterClause(AUDIT_FILTER_FIELDS, filters);
  const orderBy = buildOrderClause(AUDIT_SORT_COLUMNS, sort, 'id DESC');
  return all<AuditEntry>(
    `SELECT * FROM audit_log
     WHERE (username ILIKE @like OR action ILIKE @like OR entity ILIKE @like)
       ${clause}
     ${orderBy} LIMIT @limit`,
    { like: `%${String(search).trim()}%`, limit: Math.min(limit, 500), ...params },
  );
}

/** Whether the audit trail has any entries at all, ignoring search and dynamic filters — lets
 *  the page grey out its filter controls only when there's truly nothing to filter. Gated the
 *  same as listAuditLog(). */
export async function hasAnyAuditLog(): Promise<boolean> {
  await requireAction('ADMIN_AUDIT_VIEW');
  return hasAnyRow('audit_log');
}
