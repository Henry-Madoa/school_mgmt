/*
 * The company a request is working in — resolved from the company cookie that the top-bar
 * switcher sets, falling back to the default (live) company. lib/db.ts routes every query the
 * same way; this is the same answer as a Company row, for screens.
 */
import { cookies } from 'next/headers';
import { COMPANY_COOKIE } from './db.ts';
import { listCompanies, defaultCompany } from './companies.ts';
import { getCurrentUser } from './session.ts';
import type { Company } from './types.ts';

/** The company this request works in, and whether the user may change it (nobody pinned them). */
export async function getActiveCompany(): Promise<Company & { assigned: boolean }> {
  const user = await getCurrentUser().catch(() => null);
  const assignedCode = user?.company_code ?? null;
  let code: string | undefined | null = assignedCode;
  if (!code) { try { code = (await cookies()).get(COMPANY_COOKIE)?.value; } catch { /* outside a request */ } }
  if (code) {
    const match = (await listCompanies()).find((c) => c.code.toUpperCase() === code!.toUpperCase());
    if (match) return { ...match, assigned: !!assignedCode };
  }
  return { ...(await defaultCompany()), assigned: !!assignedCode };
}
