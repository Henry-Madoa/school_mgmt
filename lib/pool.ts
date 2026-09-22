import { one, all, run, tx, audit } from './db.ts';
import { AppError } from './errors.ts';
import type { Actor, County, CountyWithUsage, DimensionValue, SubCounty, SubCountyWithUsage } from './types.ts';

/* ------------------------------------------------------------------- counties */
export const listCounties = (): Promise<CountyWithUsage[]> =>
  all<CountyWithUsage>(
    `SELECT c.*, COUNT(DISTINCT s.id) AS sub_counties, COUNT(DISTINCT m.id) AS students
     FROM county c
     LEFT JOIN sub_county s ON s.county_id = c.id
     LEFT JOIN student m ON m.county_id = c.id
     GROUP BY c.id ORDER BY c.code NULLS LAST, c.name`,
  );

export const listActiveCounties = (): Promise<County[]> =>
  all<County>("SELECT * FROM county WHERE status = 'ACTIVE' ORDER BY code NULLS LAST, name");

export const listSubCounties = (): Promise<SubCountyWithUsage[]> =>
  all<SubCountyWithUsage>(
    `SELECT s.*, c.name AS county_name, COUNT(m.id) AS students
     FROM sub_county s
     JOIN county c ON c.id = s.county_id
     LEFT JOIN student m ON m.sub_county_id = s.id
     GROUP BY s.id, c.name ORDER BY c.name, s.name`,
  );

export const listActiveSubCounties = (): Promise<SubCounty[]> =>
  all<SubCounty>("SELECT * FROM sub_county WHERE status = 'ACTIVE' ORDER BY code NULLS LAST, name");

export interface CountyInput {
  /** The official three-digit code; a new county without one is numbered after the last. */
  code?: string | null;
  name?: string;
  status?: string | null;
}

/** A sub-county row as drafted in a county's own child grid — `id` is unset for a new row. */
export interface SubCountyDraft {
  id?: number | string | null;
  /** Left blank, the next <county code>-<nn> is assigned. */
  code?: string | null;
  name: string;
  status?: string | null;
}

/** A county code is three digits; the next free one follows the highest on file. */
async function resolveCountyCode(code: string | null | undefined, excludeId: number | null): Promise<string> {
  const wanted = String(code ?? '').trim();
  if (wanted) {
    if (!/^\d{3}$/.test(wanted)) throw new AppError('A county code is three digits, e.g. 019', 'VALIDATION');
    const clash = await one('SELECT 1 FROM county WHERE code = ? AND id <> ?', wanted, excludeId ?? -1);
    if (clash) throw new AppError(`County code ${wanted} is already used`, 'DUPLICATE');
    return wanted;
  }
  const max = await one<{ m: string | null }>('SELECT MAX(code) AS m FROM county');
  return String((Number(max?.m ?? '0') || 0) + 1).padStart(3, '0');
}

/**
 * Reconciles a county's sub-counties against the submitted grid, —
 * a sub-county can already be referenced by student.sub_county_id, so
 * rows are matched by id and updated in place rather than wiped and reinserted,
 * and a row can only be dropped once no student still points at it.
 */
async function replaceSubCounties(countyId: number, rows: SubCountyDraft[]): Promise<void> {
  const existing = await all<SubCounty>('SELECT * FROM sub_county WHERE county_id = ?', countyId);
  const submittedIds = new Set(rows.filter((r) => r.id).map((r) => Number(r.id)));

  for (const old of existing) {
    if (submittedIds.has(old.id)) continue;
    if (await one('SELECT 1 FROM student WHERE sub_county_id = ?', old.id)) {
      throw new AppError(`Cannot remove "${old.name}" — students are already assigned to it`, 'IN_USE');
    }
    await run('DELETE FROM sub_county WHERE id = ?', old.id);
  }

  const county = await one<{ code: string | null }>('SELECT code FROM county WHERE id = ?', countyId);
  const prefix = county?.code ?? String(countyId).padStart(3, '0');
  // Blank codes take the next <county>-<nn> after the highest already on file or in this grid.
  let nextNo = Math.max(0, ...existing.map((s) => Number((s.code ?? '').split('-')[1]) || 0), ...rows.map((r) => Number(String(r.code ?? '').split('-')[1]) || 0));
  const seen = new Set<string>();
  const seenCodes = new Set<string>();
  for (const row of rows) {
    const name = String(row.name || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) throw new AppError(`Duplicate sub-county name "${name}"`, 'VALIDATION');
    seen.add(key);
    let code = String(row.code ?? '').trim().toUpperCase();
    if (!code) code = `${prefix}-${String(++nextNo).padStart(2, '0')}`;
    if (seenCodes.has(code)) throw new AppError(`Duplicate sub-county code "${code}"`, 'VALIDATION');
    seenCodes.add(code);

    const id = row.id ? Number(row.id) : null;
    if (await one(`SELECT 1 FROM sub_county WHERE code = ? AND id ${id ? '<> ?' : 'IS NOT NULL'}`, ...(id ? [code, id] : [code]))) {
      throw new AppError(`Sub-county code "${code}" is already used`, 'DUPLICATE');
    }
    if (await one(
      `SELECT 1 FROM sub_county WHERE county_id = ? AND lower(name) = lower(?) AND id ${id ? '<> ?' : 'IS NOT NULL'}`,
      ...(id ? [countyId, name, id] : [countyId, name]),
    )) {
      throw new AppError(`Sub-county "${name}" already exists for this county`, 'DUPLICATE');
    }

    if (id) {
      await run('UPDATE sub_county SET code=?, name=?, status=? WHERE id=? AND county_id=?', code, name, row.status || 'ACTIVE', id, countyId);
    } else {
      await run('INSERT INTO sub_county (county_id, code, name, status) VALUES (?,?,?,?)', countyId, code, name, row.status || 'ACTIVE');
    }
  }
}

export async function createCounty(
  { code, name, status }: CountyInput,
  subCountyRows: SubCountyDraft[],
  user: Actor,
): Promise<{ id: number }> {
  if (!name) throw new AppError('County name is required', 'VALIDATION');

  return tx(async () => {
    if (await one('SELECT 1 FROM county WHERE name = ?', name)) {
      throw new AppError('That county already exists', 'DUPLICATE');
    }
    const resolvedCode = await resolveCountyCode(code, null);
    const info = await run('INSERT INTO county (code, name, status) VALUES (?,?,?)', resolvedCode, name, status || 'ACTIVE');
    const id = Number(info.lastInsertRowid);
    await replaceSubCounties(id, subCountyRows);
    await audit(user, 'COUNTY_CREATE', 'county', id, { name, subCounties: subCountyRows.length });
    return { id };
  });
}

export async function updateCounty(
  id: number,
  { code, name, status }: CountyInput,
  subCountyRows: SubCountyDraft[],
  user: Actor,
): Promise<County> {
  return tx(async () => {
    const resolvedCode = await resolveCountyCode(code, id);
    await run(
      'UPDATE county SET code=?, name=COALESCE(?,name), status=COALESCE(?,status) WHERE id=?',
      resolvedCode, name ?? null, status ?? null, id,
    );
    await replaceSubCounties(id, subCountyRows);
    await audit(user, 'COUNTY_UPDATE', 'county', id, { name, status, subCounties: subCountyRows.length });
    return (await one<County>('SELECT * FROM county WHERE id=?', id))!;
  });
}

/* ------------------------------------------------------------- global dimensions */

export type DimensionSlot = 1 | 2;

const DIMENSION_TABLE: Record<DimensionSlot, string> = {
  1: 'global_dimension_1_value',
  2: 'global_dimension_2_value',
};

export interface DimensionValueInput {
  code?: string;
  name?: string;
  status?: string | null;
}

export const listDimensionValues = (slot: DimensionSlot): Promise<DimensionValue[]> =>
  all<DimensionValue>(`SELECT * FROM ${DIMENSION_TABLE[slot]} ORDER BY name`);

export const listActiveDimensionValues = (slot: DimensionSlot): Promise<DimensionValue[]> =>
  all<DimensionValue>(`SELECT * FROM ${DIMENSION_TABLE[slot]} WHERE status = 'ACTIVE' ORDER BY name`);

export async function createDimensionValue(
  slot: DimensionSlot, { code, name, status }: DimensionValueInput, user: Actor,
): Promise<{ id: number }> {
  if (!code || !name) throw new AppError('Code and name are required', 'VALIDATION');
  const table = DIMENSION_TABLE[slot];
  if (await one(`SELECT 1 FROM ${table} WHERE code = ? OR name = ?`, code, name)) {
    throw new AppError('That value already exists', 'DUPLICATE');
  }
  const info = await run(
    `INSERT INTO ${table} (code, name, status) VALUES (?,?,?)`,
    code, name, status || 'ACTIVE',
  );
  await audit(user, `GLOBAL_DIMENSION_${slot}_VALUE_CREATE`, table, info.lastInsertRowid, { code, name });
  return { id: Number(info.lastInsertRowid) };
}

export async function updateDimensionValue(
  slot: DimensionSlot, id: number, { name, status }: DimensionValueInput, user: Actor,
): Promise<DimensionValue> {
  const table = DIMENSION_TABLE[slot];
  await run(
    `UPDATE ${table} SET name=COALESCE(?,name), status=COALESCE(?,status) WHERE id=?`,
    name ?? null, status ?? null, id,
  );
  await audit(user, `GLOBAL_DIMENSION_${slot}_VALUE_UPDATE`, table, id, { name, status });
  return (await one<DimensionValue>(`SELECT * FROM ${table} WHERE id=?`, id))!;
}
