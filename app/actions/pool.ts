'use server';

import { revalidatePath } from 'next/cache';
import { requireAction } from '@/lib/session';
import { actionResult } from '@/lib/errors';
import * as pool from '@/lib/pool';
import { updateOrg } from '@/lib/org';
import type { ActionResult, County, DimensionValue, FormValues, Organisation } from '@/lib/types';

/* ------------------------------------------------------------------- counties */
export async function saveCounty(
  id: number | null,
  values: FormValues,
  rows: pool.SubCountyDraft[],
): Promise<ActionResult<County | { id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_POOL_COUNTIES_MANAGE');
    const body: pool.CountyInput = {
      code: values.code ? String(values.code).trim() : null,
      name: String(values.name || '').trim(),
      status: values.status ? String(values.status) : null,
    };
    const subCountyRows = rows.filter((r) => String(r.name || '').trim());
    const result = id
      ? await pool.updateCounty(id, body, subCountyRows, user)
      : await pool.createCounty(body, subCountyRows, user);
    revalidatePath('/admin/pool');
    return result;
  });
}

/* ------------------------------------------------------------- global dimensions */
export async function saveDimensionValue(
  slot: pool.DimensionSlot,
  id: number | null,
  values: FormValues,
): Promise<ActionResult<DimensionValue | { id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_POOL_DIMENSIONS_MANAGE');
    const body: pool.DimensionValueInput = {
      code: String(values.code || '').trim().toUpperCase(),
      name: String(values.name || '').trim(),
      status: values.status ? String(values.status) : null,
    };
    const result = id
      ? await pool.updateDimensionValue(slot, id, body, user)
      : await pool.createDimensionValue(slot, body, user);
    revalidatePath('/admin/pool');
    return result;
  });
}

/** Renames the Global Dimension 1/2 field captions app-wide. Kept under ADMIN:POOL_MANAGE
 *  (not ADMIN:ORG_MANAGE) so it stays alongside the rest of the Dimensions setup tab. */
export async function saveDimensionCaptions(values: FormValues): Promise<ActionResult<Organisation>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_POOL_DIMENSIONS_MANAGE');
    const org = await updateOrg({
      global_dimension_1_caption: String(values.global_dimension_1_caption || '').trim() || 'Global Dimension 1 Code',
      global_dimension_2_caption: String(values.global_dimension_2_caption || '').trim() || 'Global Dimension 2 Code',
    }, user);
    revalidatePath('/', 'layout');
    return org;
  });
}
