/*
 * Per-user permissions — the Business Central "User Permission Sets" model plus a fine-tuning
 * override layer.
 *
 * A user's *granted* rights are the union of their primary role (app_user.role_id) and every
 * additional Permission Set (user_permission_set) — see loadGrantedPermissions() in lib/auth.ts.
 * An admin can then adjust an individual user with per-object overrides (user_permission_line): a
 * row REPLACES the granted rights for that one object, so a user can be restricted as well as
 * enhanced. This module powers the editor.
 */
import { one, all, run, tx, audit } from './db.ts';
import { AppError } from './errors.ts';
import { loadGrantedPermissions } from './auth.ts';
import { PAGES, listPermissionTables } from './permissions.ts';
import type {
  Actor, PermissionRightSet, PermissionSet, UserPermissionLine, UserPermissionMatrix,
  UserPermissionMatrixRow,
} from './types.ts';

const RIGHTS = ['read', 'insert', 'modify', 'delete', 'execute'] as const;

const EMPTY: PermissionRightSet = { read: false, insert: false, modify: false, delete: false, execute: false };

function grantedRights(set: PermissionSet, objectType: 'TABLE' | 'PAGE', objectName: string): PermissionRightSet {
  if (objectType === 'PAGE') return { ...EMPTY, execute: !!set.pages[objectName] };
  const t = set.tables[objectName];
  return t ? { read: t.read, insert: t.insert, modify: t.modify, delete: t.delete, execute: false } : { ...EMPTY };
}

function lineRights(l: UserPermissionLine): PermissionRightSet {
  return {
    read: !!l.read_perm, insert: !!l.insert_perm, modify: !!l.modify_perm,
    delete: !!l.delete_perm, execute: !!l.execute_perm,
  };
}

const sameRights = (a: PermissionRightSet, b: PermissionRightSet): boolean =>
  RIGHTS.every((r) => a[r] === b[r]);

async function userRow(userId: number): Promise<{ id: number; full_name: string; role_id: number; role_name: string; is_system: 0 | 1 }> {
  const row = await one<{ id: number; full_name: string; role_id: number; role_name: string; is_system: 0 | 1 }>(
    `SELECT u.id, u.full_name, u.role_id, r.name AS role_name, r.is_system
     FROM app_user u JOIN role r ON r.id = u.role_id WHERE u.id = ?`,
    userId,
  );
  if (!row) throw new AppError('User not found', 'NOT_FOUND');
  return row;
}

/** The merged permission matrix for the Users → Permissions editor: every object granted by the
 *  user's Permission Sets plus every object the user already overrides, each showing the granted
 *  baseline vs the effective rights. */
export async function getUserPermissionMatrix(userId: number): Promise<UserPermissionMatrix> {
  const [u, tables, overrides] = await Promise.all([
    userRow(userId),
    listPermissionTables(),
    all<UserPermissionLine>('SELECT * FROM user_permission_line WHERE user_id = ?', userId),
  ]);
  const [granted, extraSets] = await Promise.all([
    loadGrantedPermissions(u.id, u.role_id),
    all<{ name: string }>(
      `SELECT r.name FROM user_permission_set ups JOIN role r ON r.id = ups.role_id
       WHERE ups.user_id = ? AND r.id <> ? ORDER BY r.name`,
      u.id, u.role_id,
    ),
  ]);

  const pageLabel = new Map(PAGES.map((p) => [p.code, p.label]));
  const tableLabel = new Map(tables.map((t) => [t.name, t.label]));
  const overrideByKey = new Map(overrides.map((o) => [`${o.object_type}:${o.object_name}`, o]));

  const keys = new Set<string>();
  for (const code of Object.keys(granted.pages)) keys.add(`PAGE:${code}`);
  for (const name of Object.keys(granted.tables)) keys.add(`TABLE:${name}`);
  for (const o of overrides) keys.add(`${o.object_type}:${o.object_name}`);

  const rows: UserPermissionMatrixRow[] = [...keys].map((key) => {
    const [objectType, objectName] = key.split(':') as ['TABLE' | 'PAGE', string];
    const g = grantedRights(granted, objectType, objectName);
    const ov = overrideByKey.get(key);
    return {
      objectType,
      objectName,
      label: (objectType === 'PAGE' ? pageLabel.get(objectName) : tableLabel.get(objectName)) ?? objectName,
      granted: g,
      effective: ov ? lineRights(ov) : g,
      overridden: !!ov,
    };
  });

  rows.sort((a, b) => (
    a.objectType === b.objectType
      ? a.label.localeCompare(b.label)
      : (a.objectType === 'PAGE' ? -1 : 1)
  ));

  return {
    userId: u.id,
    userName: u.full_name,
    role: { id: u.role_id, name: u.role_name, is_system: u.is_system },
    grantedSetNames: [u.role_name, ...extraSets.map((s) => s.name)],
    isSystem: !!u.is_system,
    rows,
  };
}

export interface DesiredPermissionRow {
  objectType: 'TABLE' | 'PAGE';
  objectName: string;
  rights: Partial<PermissionRightSet>;
}

/**
 * Persists a user's overrides. For each desired object we compare the requested rights with the
 * granted baseline (primary role ∪ additional sets): identical → no override row (any existing
 * one is deleted); different → an override row holding the requested rights (upserted).
 */
export async function setUserPermissions(
  userId: number, desired: DesiredPermissionRow[], actor: Actor,
): Promise<{ overrides: number }> {
  const u = await userRow(userId);
  if (u.is_system) throw new AppError('The System Administrator has unrestricted access — per-user overrides do not apply', 'SYSTEM_USER');
  const granted = await loadGrantedPermissions(u.id, u.role_id);
  const now = new Date().toISOString();
  const changed: string[] = [];

  await tx(async () => {
    for (const d of desired) {
      const base = grantedRights(granted, d.objectType, d.objectName);
      const want: PermissionRightSet = { ...EMPTY, ...d.rights };
      if (d.objectType === 'PAGE') { want.read = want.insert = want.modify = want.delete = false; } else { want.execute = false; }
      const key = `${d.objectType}:${d.objectName}`;

      if (sameRights(want, base)) {
        const info = await run(
          'DELETE FROM user_permission_line WHERE user_id = ? AND object_type = ? AND object_name = ?',
          userId, d.objectType, d.objectName,
        );
        if (info.changes) changed.push(key);
        continue;
      }
      await run(
        `INSERT INTO user_permission_line
           (user_id, object_type, object_name, read_perm, insert_perm, modify_perm, delete_perm, execute_perm, created_at, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT (user_id, object_type, object_name) DO UPDATE SET
           read_perm = EXCLUDED.read_perm, insert_perm = EXCLUDED.insert_perm,
           modify_perm = EXCLUDED.modify_perm, delete_perm = EXCLUDED.delete_perm,
           execute_perm = EXCLUDED.execute_perm`,
        userId, d.objectType, d.objectName,
        want.read ? 1 : 0, want.insert ? 1 : 0, want.modify ? 1 : 0, want.delete ? 1 : 0, want.execute ? 1 : 0,
        now, actor.username,
      );
      changed.push(key);
    }
  });

  const count = await one<{ n: number }>('SELECT COUNT(*) n FROM user_permission_line WHERE user_id = ?', userId);
  await audit(actor, 'USER_PERMISSIONS_SET', 'app_user', userId, { changed, overrides: Number(count?.n ?? 0) });
  return { overrides: Number(count?.n ?? 0) };
}

/** Removes every override — the user falls straight back to their granted Permission Sets. */
export async function resetUserPermissions(userId: number, actor: Actor): Promise<void> {
  const info = await run('DELETE FROM user_permission_line WHERE user_id = ?', userId);
  await audit(actor, 'USER_PERMISSIONS_RESET', 'app_user', userId, { removed: info.changes });
}

/* --------------------------------------------------- additional Permission Sets (BC "User Permission Sets") */

export const listUserPermissionSets = (userId: number): Promise<{ id: number; name: string }[]> =>
  all<{ id: number; name: string }>(
    `SELECT r.id, r.name FROM user_permission_set ups JOIN role r ON r.id = ups.role_id
     WHERE ups.user_id = ? ORDER BY r.name`,
    userId,
  );

/** Replaces the set of additional Permission Sets granted to a user (beyond their primary role).
 *  The primary role is never listed here. */
export async function setUserPermissionSets(userId: number, roleIds: number[], actor: Actor): Promise<void> {
  const primary = await one<{ role_id: number }>('SELECT role_id FROM app_user WHERE id = ?', userId);
  const wanted = [...new Set(roleIds.map(Number).filter((n) => Number.isInteger(n) && n > 0 && n !== primary?.role_id))];
  const valid = wanted.length
    ? (await all<{ id: number }>(`SELECT id FROM role WHERE id IN (${wanted.map(() => '?').join(',')})`, ...wanted)).map((r) => r.id)
    : [];
  await tx(async () => {
    await run('DELETE FROM user_permission_set WHERE user_id = ?', userId);
    for (const rid of valid) {
      await run(
        'INSERT INTO user_permission_set (user_id, role_id, created_at, created_by) VALUES (?,?,?,?)',
        userId, rid, new Date().toISOString(), actor.username,
      );
    }
  });
  await audit(actor, 'USER_PERMISSION_SETS_SET', 'app_user', userId, { roleIds: valid });
}
