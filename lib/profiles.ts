/*
 * Role Centre Profiles (Business Central "Profile").
 *
 * A Profile is a landing-page selector — it decides which Role Centre (tailored home dashboard) a
 * user sees at `/dashboard` and nothing else. It carries NO permissions: the Permission Set system
 * (role + permission_set_line) is entirely separate and unchanged. An admin assigns one or more
 * Profiles to a user; the user picks the active one from My Settings, exactly the way the Work
 * Date works (lib/postingDates.ts).
 */
import { one, all, run, audit } from './db.ts';
import { AppError } from './errors.ts';
import type { Actor, Profile } from './types.ts';

export const listProfiles = (): Promise<Profile[]> =>
  all<Profile>('SELECT * FROM profile ORDER BY sort, id');

export const getProfile = (code: string): Promise<Profile | undefined> =>
  one<Profile>('SELECT * FROM profile WHERE code = ?', code);

/** The Role Centre keys the dashboard dispatcher knows how to render. A custom profile must pick
 *  one of these for its `role_centre`. */
export const ROLE_CENTRES = ['SUPER', 'SCHOOL_ADMIN', 'STUDENT_PARENT', 'FINANCE_MANAGER', 'ACCOUNTANT', 'HR_PAYROLL', 'SELF_SERVICE'] as const;
export type RoleCentre = (typeof ROLE_CENTRES)[number];

export interface ProfileInput {
  id?: number | null;
  code: string;
  name: string;
  description?: string;
  roleCentre: string;
  icon?: string;
  sort?: number;
}

/** Create / edit a custom profile. The six seeded system profiles cannot be renamed-by-code or
 *  re-pointed at a different Role Centre (their `code` and `role_centre` are locked). */
export async function saveProfile(input: ProfileInput, user: Actor): Promise<{ id: number }> {
  const name = input.name.trim();
  if (!name) throw new AppError('A profile name is required', 'VALIDATION');
  const roleCentre = input.roleCentre.trim().toUpperCase();
  if (!ROLE_CENTRES.includes(roleCentre as RoleCentre)) {
    throw new AppError(`Role Centre must be one of: ${ROLE_CENTRES.join(', ')}`, 'VALIDATION');
  }
  const description = (input.description ?? '').trim();
  const icon = (input.icon ?? '').trim();
  const sort = Math.round(Number(input.sort) || 0);

  if (input.id) {
    const before = await one<Profile>('SELECT * FROM profile WHERE id = ?', input.id);
    if (!before) throw new AppError('Profile not found', 'NOT_FOUND');
    // System profiles: name/description/icon/sort are editable, code/role_centre are not.
    const nextCentre = before.is_system ? before.role_centre : roleCentre;
    await run(
      'UPDATE profile SET name = ?, description = ?, role_centre = ?, icon = ?, sort = ? WHERE id = ?',
      name, description, nextCentre, icon, sort, input.id,
    );
    await audit(user, 'PROFILE_UPDATE', 'profile', input.id, { code: before.code });
    return { id: input.id };
  }

  const code = input.code.trim().toUpperCase();
  if (!code) throw new AppError('A profile code is required', 'VALIDATION');
  if (await one('SELECT 1 FROM profile WHERE code = ?', code)) {
    throw new AppError('A profile with that code already exists', 'DUPLICATE');
  }
  const info = await run(
    `INSERT INTO profile (code, name, description, role_centre, icon, sort, is_default, is_system, created_at, created_by)
     VALUES (?,?,?,?,?,?,0,0,?,?)`,
    code, name, description, roleCentre, icon, sort, new Date().toISOString(), user.username,
  );
  await audit(user, 'PROFILE_CREATE', 'profile', info.lastInsertRowid, { code });
  return { id: Number(info.lastInsertRowid) };
}

export async function deleteProfile(code: string, user: Actor): Promise<void> {
  const p = await one<Profile>('SELECT * FROM profile WHERE code = ?', code);
  if (!p) throw new AppError('Profile not found', 'NOT_FOUND');
  if (p.is_system) throw new AppError('A built-in Role Centre profile cannot be deleted', 'SYSTEM_PROFILE');
  // user_profile + app_user.active_profile_id both cascade / null on delete (see the migration).
  await run('DELETE FROM profile WHERE id = ?', p.id);
  await audit(user, 'PROFILE_DELETE', 'profile', null, { code });
}

/* ------------------------------------------------------------------ assignment */

export const listUserProfiles = (userId: number): Promise<Profile[]> =>
  all<Profile>(
    `SELECT p.* FROM user_profile up JOIN profile p ON p.id = up.profile_id
     WHERE up.user_id = ? ORDER BY p.sort, p.id`,
    userId,
  );

/** Replaces the set of Profiles assigned to a user. Keeps their active profile valid: if the
 *  active one was removed (or they had none), it resets to the default profile among the new set,
 *  else the first. An empty set clears everything (the user then falls back to the Super
 *  stand-in). */
export async function setUserProfiles(userId: number, profileIds: number[], actor: Actor): Promise<void> {
  const ids = [...new Set(profileIds.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0))];
  const valid = ids.length
    ? await all<{ id: number; is_default: number }>(
      `SELECT id, is_default FROM profile WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids,
    )
    : [];
  const validIds = new Set(valid.map((v) => v.id));

  await run('DELETE FROM user_profile WHERE user_id = ?', userId);
  for (const id of validIds) {
    await run('INSERT INTO user_profile (user_id, profile_id) VALUES (?,?)', userId, id);
  }

  const current = await one<{ active_profile_id: number | null }>(
    'SELECT active_profile_id FROM app_user WHERE id = ?', userId,
  );
  const stillValid = current?.active_profile_id != null && validIds.has(current.active_profile_id);
  if (!stillValid) {
    const next = valid.find((v) => v.is_default)?.id ?? [...validIds][0] ?? null;
    await run('UPDATE app_user SET active_profile_id = ? WHERE id = ?', next, userId);
  }
  await audit(actor, 'USER_PROFILES_SET', 'app_user', userId, { profileIds: [...validIds] });
}

/** My Settings — switch the active Role Centre. Only a Profile the user actually holds may be
 *  chosen; anything else (or a blank) resets to the default / first assigned. No permission
 *  required, exactly like the Work Date. */
export async function setActiveProfile(userId: number, profileId: number | null, actor: Actor): Promise<Profile> {
  const assigned = await listUserProfiles(userId);
  let chosen = profileId != null ? assigned.find((p) => p.id === Number(profileId)) : undefined;
  if (!chosen) chosen = assigned.find((p) => p.is_default) ?? assigned[0];
  await run('UPDATE app_user SET active_profile_id = ? WHERE id = ?', chosen?.id ?? null, userId);
  await audit(actor, 'ACTIVE_PROFILE_SET', 'app_user', userId, { profile: chosen?.code ?? null });
  return chosen ?? (await getProfile('SUPER'))!;
}
