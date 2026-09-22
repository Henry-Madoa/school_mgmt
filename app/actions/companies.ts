'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { requireAction, requireUser } from '@/lib/session';
import { actionResult } from '@/lib/errors';
import { copyCompany, deleteCompany, renameCompany, getCompany, type CopyCompanyResult, type CompanyDataOption } from '@/lib/companies';
import { getActiveCompany } from '@/lib/companyContext';
import { COMPANY_COOKIE } from '@/lib/db';
import type { ActionResult, FormValues } from '@/lib/types';

export async function copyCompanyRequest(values: FormValues): Promise<ActionResult<CopyCompanyResult>> {
  return actionResult(async () => {
    const user = await requireAction('COMPANIES_MANAGE');
    const res = await copyCompany({
      sourceCode: String(values.source ?? ''), newCode: String(values.code ?? ''), displayName: String(values.display_name ?? ''),
      dataOption: (['FULL', 'SETUP', 'EMPTY'].includes(String(values.data_option)) ? String(values.data_option) : 'FULL') as CompanyDataOption,
      renameOrganisation: Number(values.rename_organisation) === 1,
    }, user);
    revalidatePath('/admin/company/companies');
    return res;
  });
}

export async function deleteCompanyRequest(code: string): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => {
    const user = await requireAction('COMPANIES_MANAGE');
    const active = await getActiveCompany();
    await deleteCompany(code, user, active.code);
    // If the deleted company was the active one, the cookie now points nowhere — clear it.
    const store = await cookies();
    if ((store.get(COMPANY_COOKIE)?.value ?? '').toUpperCase() === code.toUpperCase()) store.delete(COMPANY_COOKIE);
    revalidatePath('/admin/company/companies');
    return { deleted: true };
  });
}

export async function renameCompanyRequest(code: string, values: FormValues): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const user = await requireAction('COMPANIES_MANAGE');
    await renameCompany(code, String(values.display_name ?? ''), user);
    revalidatePath('/admin/company/companies');
    return { updated: true };
  });
}

/** Switch the signed-in user's browser to another company — any user may, since a copy holds
 *  the same users and permissions (BC: the company picker on the top bar). */
export async function switchCompanyRequest(code: string): Promise<ActionResult<{ code: string; displayName: string }>> {
  return actionResult(async () => {
    const me = await requireUser();
    if (me.company_code) throw new Error('An administrator has assigned you to a company — ask them to change it');
    const c = await getCompany(code);
    if (!c) throw new Error(`Company ${code} not found`);
    const store = await cookies();
    if (c.is_default) store.delete(COMPANY_COOKIE);
    else store.set(COMPANY_COOKIE, c.code, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 30 });
    return { code: c.code, displayName: c.display_name };
  });
}
