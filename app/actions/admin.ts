'use server';

import { revalidatePath } from 'next/cache';
import { requireAction } from '@/lib/session';
import { actionResult } from '@/lib/errors';
import * as admin from '@/lib/admin';
import * as profiles from '@/lib/profiles';
import * as userPerms from '@/lib/userPermissions';
import { updateOrg, updateTheme } from '@/lib/org';
import { unlockUser } from '@/lib/auth';
import { disableTwoFactor } from '@/lib/totp';
import type {
  ActionResult, FormValues, Organisation, PermissionTableOption, Role,
  Theme, ThemeTokens, UserPermissionMatrix, UserStatus,
} from '@/lib/types';
import type { DesiredPermissionRow } from '@/lib/userPermissions';

/* --------------------------------------------------------------- company */
/** Lift a sign-in lockout by hand (Admin Centre → Users). */
/** Clears a user's two-factor enrolment (a lost phone) — they sign in with the password alone, and re-enrol if their permission set requires it. */
export async function resetTwoFactorRequest(userId: number): Promise<ActionResult<{ reset: true }>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_USER_MANAGE');
    await disableTwoFactor(userId, user);
    revalidatePath('/admin');
    return { reset: true };
  });
}

export async function unlockUserRequest(userId: number): Promise<ActionResult<{ unlocked: true }>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_USER_MANAGE');
    await unlockUser(userId, user);
    revalidatePath('/admin');
    return { unlocked: true };
  });
}

export async function saveOrganisation(values: FormValues): Promise<ActionResult<Organisation>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_ORG_MANAGE');
    const org = await updateOrg({
      ...values,
      fy_start_month: Number(values.fy_start_month),
      fy_start_day: Number(values.fy_start_day),
      allow_posting_from: String(values.allow_posting_from || '').trim() || null,
      allow_posting_to: String(values.allow_posting_to || '').trim() || null,
      receipt_approval_limit: Math.round(Number(values.receipt_approval_limit || 0) * 100),
      petty_cash_limit: Math.round(Number(values.petty_cash_limit || 0) * 100),
      max_outstanding_imprests: Number(values.max_outstanding_imprests ?? 1) || 0,
      imprest_control_account_id: values.imprest_control_account_id ? Number(values.imprest_control_account_id) : null,
      imprest_surrender_period: String(values.imprest_surrender_period || '14D').trim() || '14D',
      bad_debt_recovery_account_id: values.bad_debt_recovery_account_id ? Number(values.bad_debt_recovery_account_id) : null,
      mpesa_bank_account_id: values.mpesa_bank_account_id ? Number(values.mpesa_bank_account_id) : null,
      fee_discount_account_id: values.fee_discount_account_id ? Number(values.fee_discount_account_id) : null,
    }, user);
    // The school's name, logo and currency appear in the shell on every page.
    revalidatePath('/', 'layout');
    return org;
  });
}

/* ------------------------------------------------------------- appearance */
export async function saveTheme(tokens: ThemeTokens, preset: string): Promise<ActionResult<Theme>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_THEME_MANAGE');
    const theme = await updateTheme({ tokens, preset }, user);
    revalidatePath('/', 'layout');
    return theme;
  });
}

/* ------------------------------------------------------------------ users */
/** Create returns the new id; update just confirms. The caller only needs "it worked". */
export type SaveUserResult = { id: number } | { updated: true };

export async function saveUser(id: number | null, values: FormValues): Promise<ActionResult<SaveUserResult>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_USER_MANAGE');
    // The profile / permission-set chips each post one comma-separated hidden field; an empty
    // string is a deliberate "none", absent (undefined) leaves the current set alone.
    const csvIds = (v: unknown): number[] | undefined => (v === undefined
      ? undefined
      : String(v).split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0));
    const body = {
      username: String(values.username || ''),
      full_name: String(values.full_name || ''),
      email: String(values.email || '') || null,
      phone: String(values.phone || '') || null,
      role_id: Number(values.role_id) || null,
      status: (values.status as UserStatus) || null,
      // An empty box means "leave the password alone", not "set it to empty".
      password: String(values.password || '') || null,
      profileIds: csvIds(values.profileIds),
      permissionSetIds: csvIds(values.permissionSetIds),
      company_code: values.company_code === undefined ? undefined : String(values.company_code || '') || null,
    };
    const result = id ? await admin.updateUser(id, body, user) : await admin.createUser(body, user);
    revalidatePath('/admin/users');
    revalidatePath('/', 'layout');
    return result;
  });
}

/* -------------------------------------------------------- role centre profiles */
export async function saveProfileRequest(id: number | null, values: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_PROFILES_MANAGE');
    const res = await profiles.saveProfile({
      id,
      code: String(values.code || ''),
      name: String(values.name || ''),
      description: String(values.description || ''),
      roleCentre: String(values.roleCentre || 'SUPER'),
      icon: String(values.icon || ''),
      sort: Number(values.sort) || 0,
    }, user);
    revalidatePath('/admin/pool/general/profiles');
    revalidatePath('/', 'layout');
    return res;
  });
}

export async function deleteProfileRequest(code: string): Promise<ActionResult<null>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_PROFILES_MANAGE');
    await profiles.deleteProfile(code, user);
    revalidatePath('/admin/pool/general/profiles');
    revalidatePath('/', 'layout');
    return null;
  });
}

/* ------------------------------------------------------------------ roles */
export async function saveRole(
  id: number | null,
  values: FormValues,
  lines: admin.RoleLineInput[],
): Promise<ActionResult<{ id?: number } | Role>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_ROLE_MANAGE');
    const body = {
      name: String(values.name || ''),
      description: String(values.description || '') || null,
      lines,
      requireTwoFactor: !!Number(values.require_two_factor ?? 0),
    };
    const result = id ? await admin.updateRole(id, body, user) : await admin.createRole(body, user);
    revalidatePath('/admin/roles');
    // Editing a permission set changes the sidebar and access of everyone holding it.
    revalidatePath('/', 'layout');
    return result;
  });
}

export async function listPermissionTablesAction(): Promise<ActionResult<PermissionTableOption[]>> {
  return actionResult(async () => {
    await requireAction('ADMIN_ROLE_MANAGE');
    return admin.listPermissionTables();
  });
}

/* --------------------------------------------------- per-user permission overrides */
export async function fetchUserPermissionMatrix(userId: number): Promise<ActionResult<UserPermissionMatrix>> {
  return actionResult(async () => {
    await requireAction('ADMIN_USER_MANAGE');
    return userPerms.getUserPermissionMatrix(userId);
  });
}

export async function saveUserPermissionsRequest(
  userId: number, rows: DesiredPermissionRow[],
): Promise<ActionResult<{ overrides: number }>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_USER_MANAGE');
    const res = await userPerms.setUserPermissions(userId, rows, user);
    revalidatePath('/admin/users');
    revalidatePath('/', 'layout');
    return res;
  });
}

export async function resetUserPermissionsRequest(userId: number): Promise<ActionResult<null>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_USER_MANAGE');
    await userPerms.resetUserPermissions(userId, user);
    revalidatePath('/admin/users');
    revalidatePath('/', 'layout');
    return null;
  });
}
