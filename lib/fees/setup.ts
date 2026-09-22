/*
 * Fee setup — the fee items (Tuition, Lunch, Transport …, each naming the income account it is
 * recognised in) and the fee structure: what each grade pays for each item in a term.
 */
import { one, all, run, tx, audit, hasAnyRow } from '../db.ts';
import { AppError } from '../errors.ts';
import type { Actor, Cents, FeeItem, FeeItemView, FeeStructureView } from '../types.ts';

export const listFeeItems = (): Promise<FeeItemView[]> =>
  all<FeeItemView>(
    `SELECT fi.*, g.code AS gl_account_code, g.name AS gl_account_name FROM fee_item fi JOIN gl_account g ON g.id = fi.gl_account_id
     ORDER BY fi.status, fi.sort, fi.name`,
  );

export const listActiveFeeItems = (): Promise<FeeItem[]> => all<FeeItem>("SELECT * FROM fee_item WHERE status = 'ACTIVE' ORDER BY sort, name");

export interface FeeItemInput { code: string; name: string; glAccountId: number; status?: string; sort?: number }

export async function saveFeeItem(id: number | null, input: FeeItemInput, user: Actor): Promise<{ id: number }> {
  const code = String(input.code || '').trim().toUpperCase();
  const name = String(input.name || '').trim();
  if (!code || !name) throw new AppError('A fee item needs a code and a name', 'VALIDATION');
  const acc = await one<{ type: string; is_postable: number; status: string }>('SELECT type, is_postable, status FROM gl_account WHERE id = ?', input.glAccountId);
  if (!acc) throw new AppError('Pick the income account the fee is recognised in', 'VALIDATION');
  if (!acc.is_postable || acc.status !== 'ACTIVE') throw new AppError('The income account must be an active posting account', 'VALIDATION');
  if (acc.type !== 'INCOME') throw new AppError('A fee item posts to an INCOME account', 'VALIDATION');
  if (await hasAnyRow('fee_item', `code = ? ${id ? 'AND id <> ?' : ''}`, ...(id ? [code, id] : [code]))) throw new AppError(`Fee item ${code} already exists`, 'DUPLICATE');
  if (id) {
    await run('UPDATE fee_item SET code=?, name=?, gl_account_id=?, status=?, sort=? WHERE id=?', code, name, input.glAccountId, input.status || 'ACTIVE', Number(input.sort) || 1, id);
    await audit(user, 'FEE_ITEM_UPDATE', 'fee_item', id, { code });
    return { id };
  }
  const info = await run('INSERT INTO fee_item (code, name, gl_account_id, status, sort) VALUES (?,?,?,?,?)', code, name, input.glAccountId, input.status || 'ACTIVE', Number(input.sort) || 1);
  await audit(user, 'FEE_ITEM_CREATE', 'fee_item', info.lastInsertRowid, { code });
  return { id: Number(info.lastInsertRowid) };
}

export async function deleteFeeItem(id: number, user: Actor): Promise<void> {
  if (await hasAnyRow('fee_structure', 'fee_item_id = ?', id)) throw new AppError('The fee structure uses this item — mark it Inactive instead', 'IN_USE');
  await run('DELETE FROM fee_item WHERE id = ?', id);
  await audit(user, 'FEE_ITEM_DELETE', 'fee_item', id, {});
}

/* ---------------------------------------------------------------- structure */

const STRUCTURE_SELECT = `
  SELECT fs.*, g.name AS grade_level_name, t.name AS term_name, y.name AS year_name, fi.code AS fee_item_code, fi.name AS fee_item_name
  FROM fee_structure fs
  JOIN grade_level g ON g.id = fs.grade_level_id
  JOIN education_level el ON el.id = g.education_level_id
  JOIN academic_term t ON t.id = fs.term_id
  JOIN academic_year y ON y.id = t.academic_year_id
  JOIN fee_item fi ON fi.id = fs.fee_item_id`;

export const listFeeStructure = (termId: number): Promise<FeeStructureView[]> =>
  all<FeeStructureView>(`${STRUCTURE_SELECT} WHERE fs.term_id = ? ORDER BY el.sort, g.sort, fi.sort, fi.name`, termId);

/** What one grade pays in a term, item by item — the invoice lines a fee run raises. */
export const gradeFeeLines = (gradeLevelId: number, termId: number): Promise<FeeStructureView[]> =>
  all<FeeStructureView>(`${STRUCTURE_SELECT} WHERE fs.grade_level_id = ? AND fs.term_id = ? AND fi.status = 'ACTIVE' ORDER BY fi.sort, fi.name`, gradeLevelId, termId);

export interface FeeStructureRow { gradeLevelId: number; feeItemId: number; amount: Cents; appliesTo?: string | null }

/** Replaces one grade's structure for a term with the submitted rows (a zero amount removes the item). */
export async function saveGradeFeeStructure(gradeLevelId: number, termId: number, rows: FeeStructureRow[], user: Actor): Promise<void> {
  if (!(await hasAnyRow('grade_level', 'id = ?', gradeLevelId))) throw new AppError('Grade not found', 'NOT_FOUND');
  if (!(await hasAnyRow('academic_term', 'id = ?', termId))) throw new AppError('Term not found', 'NOT_FOUND');
  await tx(async () => {
    await run('DELETE FROM fee_structure WHERE grade_level_id = ? AND term_id = ?', gradeLevelId, termId);
    for (const r of rows) {
      const amount = Math.round(Number(r.amount) || 0);
      if (amount < 0) throw new AppError('Fee amounts cannot be negative', 'VALIDATION');
      if (!amount) continue;
      await run(
        'INSERT INTO fee_structure (grade_level_id, term_id, fee_item_id, amount, applies_to) VALUES (?,?,?,?,?)',
        gradeLevelId, termId, r.feeItemId, amount, r.appliesTo?.trim().toUpperCase() || 'ALL',
      );
    }
  });
  await audit(user, 'FEE_STRUCTURE_SAVE', 'grade_level', gradeLevelId, { termId, items: rows.filter((r) => Number(r.amount) > 0).length });
}

/** Copies a whole term's structure into another (empty) term — the usual start of a new term. */
export async function copyFeeStructure(fromTermId: number, toTermId: number, user: Actor): Promise<{ copied: number }> {
  if (fromTermId === toTermId) throw new AppError('Pick a different term to copy into', 'VALIDATION');
  if (await hasAnyRow('fee_structure', 'term_id = ?', toTermId)) throw new AppError('The target term already has a fee structure', 'VALIDATION');
  const r = await run(
    `INSERT INTO fee_structure (grade_level_id, term_id, fee_item_id, amount, applies_to)
     SELECT grade_level_id, ?, fee_item_id, amount, applies_to FROM fee_structure WHERE term_id = ?`, toTermId, fromTermId,
  );
  await audit(user, 'FEE_STRUCTURE_COPY', 'academic_term', toTermId, { fromTermId, copied: r.changes });
  return { copied: r.changes };
}
