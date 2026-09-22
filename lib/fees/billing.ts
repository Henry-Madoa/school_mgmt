/*
 * What one student owes for a term — the fee structure of their grade, narrowed to the items
 * that apply to them (boarder / day scholar / opted in), less any bursary, scholarship or sibling
 * discount on file. This is the single place the invoice run and its preview ask, so a student is
 * billed exactly what the preview showed.
 */
import { one, all, run, audit, hasAnyRow } from '../db.ts';
import { AppError } from '../errors.ts';
import { gradeFeeLines } from './setup.ts';
import type { Actor, Cents, FeeAppliesTo, StudentFeeDiscount, StudentFeeDiscountView, StudentFeeOption } from '../types.ts';

export interface BillLine { fee_item_id: number; fee_item_name: string; gl_account_code: string; amount: Cents }
export interface BillDiscount { discount_id: number; description: string; fee_item_id: number | null; amount: Cents }
export interface StudentBill {
  lines: BillLine[];
  discounts: BillDiscount[];
  gross: Cents;
  /** Total taken off — a positive number. */
  discount: Cents;
  net: Cents;
}

export interface BillSubject { id: number; grade_level_id: number; boarding_status: string }

/** Does a fee item apply to this student? */
const applies = (appliesTo: FeeAppliesTo | string, s: BillSubject, optedIn: Set<number>, feeItemId: number): boolean =>
  appliesTo === 'BOARDER' ? s.boarding_status === 'BOARDER'
    : appliesTo === 'DAY' ? s.boarding_status !== 'BOARDER'
      : appliesTo === 'OPT_IN' ? optedIn.has(feeItemId)
        : true;

/** A per-run cache of each grade's structure — an invoice run asks for the same grade hundreds of times. */
export type StructureCache = Map<number, Awaited<ReturnType<typeof gradeFeeLines>>>;

export async function studentBill(s: BillSubject, termId: number, cache?: StructureCache): Promise<StudentBill> {
  const structureFor = async () => {
    if (!cache) return gradeFeeLines(s.grade_level_id, termId);
    if (!cache.has(s.grade_level_id)) cache.set(s.grade_level_id, await gradeFeeLines(s.grade_level_id, termId));
    return cache.get(s.grade_level_id)!;
  };
  const [structure, options, discounts] = await Promise.all([
    structureFor(),
    all<{ fee_item_id: number }>('SELECT fee_item_id FROM student_fee_option WHERE student_id = ?', s.id),
    activeDiscountsForTerm(s.id, termId),
  ]);
  const optedIn = new Set(options.map((o) => o.fee_item_id));
  const lines: BillLine[] = structure
    .filter((l) => Number(l.amount) > 0 && applies(l.fee_item_applies_to, s, optedIn, l.fee_item_id))
    .map((l) => ({ fee_item_id: l.fee_item_id, fee_item_name: l.fee_item_name, gl_account_code: l.gl_account_code, amount: Number(l.amount) }));
  const gross = lines.reduce((a, l) => a + l.amount, 0);
  const out: BillDiscount[] = [];
  let remaining = gross;
  for (const d of discounts) {
    const base = d.fee_item_id ? (lines.find((l) => l.fee_item_id === d.fee_item_id)?.amount ?? 0) : gross;
    if (!base) continue;
    const want = d.percent > 0 ? Math.round(base * d.percent / 100) : Math.min(Number(d.amount), base);
    const amount = Math.max(0, Math.min(want, remaining));
    if (!amount) continue;
    remaining -= amount;
    out.push({ discount_id: d.id, description: d.description, fee_item_id: d.fee_item_id, amount });
  }
  const discount = out.reduce((a, d) => a + d.amount, 0);
  return { lines, discounts: out, gross, discount, net: gross - discount };
}

/* ---------------------------------------------------------------- options */

export const listStudentFeeOptions = (studentId: number): Promise<(StudentFeeOption & { fee_item_name: string; fee_item_code: string })[]> =>
  all(`SELECT o.*, fi.name AS fee_item_name, fi.code AS fee_item_code FROM student_fee_option o JOIN fee_item fi ON fi.id = o.fee_item_id WHERE o.student_id = ? ORDER BY fi.sort, fi.name`, studentId);

/** Replaces the student's opt-in items with `feeItemIds` (only OPT_IN items count). */
export async function setStudentFeeOptions(studentId: number, feeItemIds: number[], user: Actor): Promise<void> {
  if (!(await hasAnyRow('student', 'id = ?', studentId))) throw new AppError('Student not found', 'NOT_FOUND');
  const valid = new Set((await all<{ id: number }>("SELECT id FROM fee_item WHERE applies_to = 'OPT_IN' AND status = 'ACTIVE'")).map((r) => r.id));
  const wanted = [...new Set(feeItemIds.map(Number).filter((id) => valid.has(id)))];
  await run('DELETE FROM student_fee_option WHERE student_id = ?', studentId);
  for (const id of wanted) {
    await run('INSERT INTO student_fee_option (student_id, fee_item_id, created_at, created_by) VALUES (?,?,?,?)', studentId, id, new Date().toISOString(), user.username);
  }
  await audit(user, 'STUDENT_FEE_OPTIONS_SET', 'student', studentId, { items: wanted });
}

/* -------------------------------------------------------------- discounts */

const DISCOUNT_SELECT = `
  SELECT d.*, fi.name AS fee_item_name, ft.name || ' ' || fy.name AS from_term_name, tt.name || ' ' || ty.name AS to_term_name
  FROM student_fee_discount d
  LEFT JOIN fee_item fi ON fi.id = d.fee_item_id
  LEFT JOIN academic_term ft ON ft.id = d.from_term_id LEFT JOIN academic_year fy ON fy.id = ft.academic_year_id
  LEFT JOIN academic_term tt ON tt.id = d.to_term_id LEFT JOIN academic_year ty ON ty.id = tt.academic_year_id`;

export const listStudentFeeDiscounts = (studentId: number): Promise<StudentFeeDiscountView[]> =>
  all<StudentFeeDiscountView>(`${DISCOUNT_SELECT} WHERE d.student_id = ? ORDER BY d.status, d.id`, studentId);

/** The discounts in force for a term — the term falls inside each one's range (by term start date). */
export const activeDiscountsForTerm = (studentId: number, termId: number): Promise<StudentFeeDiscount[]> =>
  all<StudentFeeDiscount>(
    `SELECT d.* FROM student_fee_discount d
     JOIN academic_term t ON t.id = ?
     LEFT JOIN academic_term ft ON ft.id = d.from_term_id
     LEFT JOIN academic_term tt ON tt.id = d.to_term_id
     WHERE d.student_id = ? AND d.status = 'ACTIVE'
       AND (ft.id IS NULL OR ft.start_date <= t.start_date) AND (tt.id IS NULL OR tt.start_date >= t.start_date)
     ORDER BY d.fee_item_id NULLS LAST, d.id`, termId, studentId,
  );

export interface DiscountInput {
  feeItemId?: number | null; percent?: number | null; amount?: Cents | null; description: string;
  fromTermId?: number | null; toTermId?: number | null; status?: string | null;
}

export async function saveStudentFeeDiscount(id: number | null, studentId: number, input: DiscountInput, user: Actor): Promise<{ id: number }> {
  if (!(await hasAnyRow('student', 'id = ?', studentId))) throw new AppError('Student not found', 'NOT_FOUND');
  const description = String(input.description || '').trim();
  if (!description) throw new AppError('Say what the discount is — e.g. "Sibling discount", "Board of Governors bursary"', 'VALIDATION');
  const percent = Number(input.percent) || 0;
  const amount = Math.round(Number(input.amount) || 0);
  if ((percent > 0) === (amount > 0)) throw new AppError('Give either a percentage or a fixed amount per term, not both', 'VALIDATION');
  if (percent < 0 || percent > 100 || amount < 0) throw new AppError('A discount is 0–100% or a positive amount', 'VALIDATION');
  if (input.feeItemId && !(await hasAnyRow('fee_item', 'id = ?', input.feeItemId))) throw new AppError('Fee item not found', 'NOT_FOUND');
  if (input.fromTermId && input.toTermId) {
    const [f, t] = await Promise.all([
      one<{ start_date: string }>('SELECT start_date FROM academic_term WHERE id = ?', input.fromTermId),
      one<{ start_date: string }>('SELECT start_date FROM academic_term WHERE id = ?', input.toTermId),
    ]);
    if (f && t && f.start_date > t.start_date) throw new AppError('The discount cannot end before it starts', 'VALIDATION');
  }
  const status = input.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
  if (id) {
    await run('UPDATE student_fee_discount SET fee_item_id=?, percent=?, amount=?, description=?, from_term_id=?, to_term_id=?, status=? WHERE id=? AND student_id=?',
      input.feeItemId || null, percent, amount, description, input.fromTermId || null, input.toTermId || null, status, id, studentId);
    await audit(user, 'STUDENT_FEE_DISCOUNT_UPDATE', 'student', studentId, { id, description });
    return { id };
  }
  const info = await run(
    'INSERT INTO student_fee_discount (student_id, fee_item_id, percent, amount, description, from_term_id, to_term_id, status, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)',
    studentId, input.feeItemId || null, percent, amount, description, input.fromTermId || null, input.toTermId || null, status, new Date().toISOString(), user.username,
  );
  await audit(user, 'STUDENT_FEE_DISCOUNT_CREATE', 'student', studentId, { description, percent, amount });
  return { id: Number(info.lastInsertRowid) };
}

export async function deleteStudentFeeDiscount(id: number, user: Actor): Promise<void> {
  const d = await one<{ student_id: number }>('SELECT student_id FROM student_fee_discount WHERE id = ?', id);
  if (!d) throw new AppError('Discount not found', 'NOT_FOUND');
  await run('DELETE FROM student_fee_discount WHERE id = ?', id);
  await audit(user, 'STUDENT_FEE_DISCOUNT_DELETE', 'student', d.student_id, { id });
}
