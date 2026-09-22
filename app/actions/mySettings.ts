'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/session';
import { actionResult, AppError } from '@/lib/errors';
import { setWorkDate, getWorkDate } from '@/lib/postingDates';
import { setActiveProfile } from '@/lib/profiles';
import { cookies } from 'next/headers';
import { changeOwnPassword, PASSWORD_CHANGE_COOKIE, SESSION_COOKIE, TWO_FACTOR_ENROL_COOKIE } from '@/lib/auth';
import { getOrgBrand } from '@/lib/org';
import { beginEnrolment, confirmEnrolment, disableTwoFactor } from '@/lib/totp';
import QRCode from 'qrcode';
import type { ActionResult, Profile } from '@/lib/types';

/** My Settings → Two-factor: a fresh secret, as a QR code (data URL) and the manual key. */
export async function startTwoFactorEnrolment(): Promise<ActionResult<{ secret: string; qr: string }>> {
  return actionResult(async () => {
    const user = await requireUser();
    const org = await getOrgBrand();
    const { secret, otpauth } = await beginEnrolment(user.id, org?.name || 'School');
    const qr = await QRCode.toDataURL(otpauth, { margin: 1, width: 220 });
    return { secret, qr };
  });
}

/** The code from the app confirms the secret; the recovery codes come back once. */
export async function confirmTwoFactorEnrolment(code: string): Promise<ActionResult<{ recoveryCodes: string[] }>> {
  return actionResult(async () => {
    const user = await requireUser();
    const res = await confirmEnrolment(user.id, code, user);
    (await cookies()).delete(TWO_FACTOR_ENROL_COOKIE);
    revalidatePath('/my-settings');
    return res;
  });
}

export async function turnOffTwoFactor(code: string): Promise<ActionResult<{ disabled: true }>> {
  return actionResult(async () => {
    const user = await requireUser();
    await disableTwoFactor(user.id, user, code);
    revalidatePath('/my-settings');
    return { disabled: true };
  });
}

/** Sets (or, given an empty string, clears back to the real system date) the current user's own
 *  Work Date — validated server-side against their effective Allow Posting range regardless of
 *  what the client's date input already enforced. */
export async function saveWorkDate(date: string): Promise<ActionResult<{ workDate: string }>> {
  return actionResult(async () => {
    const user = await requireUser();
    await setWorkDate(user.id, date, user);
    revalidatePath('/my-settings');
    return { workDate: await getWorkDate(user.id) };
  });
}

/** My Settings → Password: the signed-in user changing their own password. Clears the
 *  forced-change flag middleware.ts enforces, and keeps only this browser's session. */
export async function changePassword(currentPassword: string, newPassword: string, confirm: string): Promise<ActionResult<{ changed: true }>> {
  return actionResult(async () => {
    const user = await requireUser();
    if (newPassword !== confirm) throw new AppError('The new password and its confirmation do not match', 'VALIDATION');
    const store = await cookies();
    await changeOwnPassword(user, currentPassword, newPassword, store.get(SESSION_COOKIE)?.value);
    store.delete(PASSWORD_CHANGE_COOKIE);
    revalidatePath('/my-settings');
    return { changed: true };
  });
}

/** My Settings → Role Centre: switch which Profile's dashboard `/dashboard` renders. Only a
 *  Profile the user has been assigned may be chosen; no permission is required, exactly like the
 *  Work Date. Revalidates the whole shell so the sidebar and dashboard update immediately. */
export async function saveActiveProfile(profileId: number | null): Promise<ActionResult<{ profile: Profile }>> {
  return actionResult(async () => {
    const user = await requireUser();
    const profile = await setActiveProfile(user.id, profileId, user);
    revalidatePath('/', 'layout');
    return { profile };
  });
}
