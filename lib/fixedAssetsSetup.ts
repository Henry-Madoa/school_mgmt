/*
 * Fixed Assets setup masters — Business Central Tables 5628 (FA Class), 5629 (FA Subclass),
 * 5643 (FA Location), 5611 (Depreciation Book), 5606 (FA Posting Group), 5603 (FA Setup) and
 * 5616 (Maintenance). Structured exactly like lib/inventorySetup.ts: `assertX` validators,
 * duplicate-code guards, `audit()`, and INACTIVE instead of a hard delete so posted history
 * never dangles.
 *
 * No AL source exists for any of this — the companion "Sacco Demo AL" extension only adds Motor
 * Vehicle fields on top of Business Central's stock FA tables. See lib/faJournal.ts's header.
 */
import { one, all, run, audit, hasAnyRow } from './db.ts';
import { AppError } from './errors.ts';
import type {
  Actor, DepreciationBook, FaClass, FaLocation, FaPostingGroup, FaPostingGroupView, FaSetup,
  FaSubclass, Maintenance,
} from './types.ts';

const norm = (v: unknown): string => String(v ?? '').trim();
const now = (): string => new Date().toISOString();

/* --------------------------------------------------------------------- FA Class */

export const listFaClasses = (): Promise<FaClass[]> =>
  all<FaClass>('SELECT * FROM fa_class ORDER BY code');

export const listActiveFaClasses = (): Promise<FaClass[]> =>
  all<FaClass>("SELECT * FROM fa_class WHERE status = 'ACTIVE' ORDER BY code");

export const getFaClass = (id: number): Promise<FaClass | undefined> =>
  one<FaClass>('SELECT * FROM fa_class WHERE id = ?', id);

export interface FaClassInput { code: string; description: string; status: 'ACTIVE' | 'INACTIVE' }

function assertFaClass(input: FaClassInput): void {
  if (!norm(input.code)) throw new AppError('A code is required', 'VALIDATION');
  if (!norm(input.description)) throw new AppError('A description is required', 'VALIDATION');
}

export async function createFaClass(input: FaClassInput, user: Actor): Promise<{ id: number }> {
  assertFaClass(input);
  if (await hasAnyRow('fa_class', 'code = ?', norm(input.code))) throw new AppError('An FA class with this code already exists', 'DUPLICATE');
  const info = await run(
    'INSERT INTO fa_class (code, description, status, created_at, created_by) VALUES (?,?,?,?,?)',
    norm(input.code).toUpperCase(), norm(input.description), input.status, now(), user.username,
  );
  await audit(user, 'FA_CLASS_CREATE', 'fa_class', info.lastInsertRowid, { code: input.code });
  return { id: Number(info.lastInsertRowid) };
}

export async function updateFaClass(id: number, input: FaClassInput, user: Actor): Promise<void> {
  assertFaClass(input);
  const before = await getFaClass(id);
  if (!before) throw new AppError('FA class not found', 'NOT_FOUND');
  if (await hasAnyRow('fa_class', 'code = ? AND id <> ?', norm(input.code), id)) throw new AppError('An FA class with this code already exists', 'DUPLICATE');
  await run(
    'UPDATE fa_class SET code = ?, description = ?, status = ? WHERE id = ?',
    norm(input.code).toUpperCase(), norm(input.description), input.status, id,
  );
  await audit(user, 'FA_CLASS_UPDATE', 'fa_class', id, {});
}

/* ------------------------------------------------------------------ FA Subclass */

const SUBCLASS_SELECT = `
  SELECT s.*, c.description AS fa_class_description
  FROM fa_subclass s
  LEFT JOIN fa_class c ON c.code = s.fa_class_code`;

export const listFaSubclasses = (): Promise<(FaSubclass & { fa_class_description: string | null })[]> =>
  all(`${SUBCLASS_SELECT} ORDER BY s.code`);

export const listActiveFaSubclasses = (): Promise<FaSubclass[]> =>
  all<FaSubclass>("SELECT * FROM fa_subclass WHERE status = 'ACTIVE' ORDER BY code");

export const getFaSubclass = (id: number): Promise<FaSubclass | undefined> =>
  one<FaSubclass>('SELECT * FROM fa_subclass WHERE id = ?', id);

export interface FaSubclassInput {
  code: string; description: string; faClassCode: string | null; status: 'ACTIVE' | 'INACTIVE';
}

function assertFaSubclass(input: FaSubclassInput): void {
  if (!norm(input.code)) throw new AppError('A code is required', 'VALIDATION');
  if (!norm(input.description)) throw new AppError('A description is required', 'VALIDATION');
}

export async function createFaSubclass(input: FaSubclassInput, user: Actor): Promise<{ id: number }> {
  assertFaSubclass(input);
  if (await hasAnyRow('fa_subclass', 'code = ?', norm(input.code))) throw new AppError('An FA subclass with this code already exists', 'DUPLICATE');
  const info = await run(
    'INSERT INTO fa_subclass (code, description, fa_class_code, status, created_at, created_by) VALUES (?,?,?,?,?,?)',
    norm(input.code).toUpperCase(), norm(input.description), input.faClassCode || null, input.status, now(), user.username,
  );
  await audit(user, 'FA_SUBCLASS_CREATE', 'fa_subclass', info.lastInsertRowid, { code: input.code });
  return { id: Number(info.lastInsertRowid) };
}

export async function updateFaSubclass(id: number, input: FaSubclassInput, user: Actor): Promise<void> {
  assertFaSubclass(input);
  const before = await getFaSubclass(id);
  if (!before) throw new AppError('FA subclass not found', 'NOT_FOUND');
  if (await hasAnyRow('fa_subclass', 'code = ? AND id <> ?', norm(input.code), id)) throw new AppError('An FA subclass with this code already exists', 'DUPLICATE');
  await run(
    'UPDATE fa_subclass SET code = ?, description = ?, fa_class_code = ?, status = ? WHERE id = ?',
    norm(input.code).toUpperCase(), norm(input.description), input.faClassCode || null, input.status, id,
  );
  await audit(user, 'FA_SUBCLASS_UPDATE', 'fa_subclass', id, {});
}

/* ------------------------------------------------------------------ FA Location */

export const listFaLocations = (): Promise<FaLocation[]> =>
  all<FaLocation>('SELECT * FROM fa_location ORDER BY code');

export const listActiveFaLocations = (): Promise<FaLocation[]> =>
  all<FaLocation>("SELECT * FROM fa_location WHERE status = 'ACTIVE' ORDER BY code");

export const getFaLocation = (id: number): Promise<FaLocation | undefined> =>
  one<FaLocation>('SELECT * FROM fa_location WHERE id = ?', id);

export interface FaLocationInput { code: string; description: string; status: 'ACTIVE' | 'INACTIVE' }

function assertFaLocation(input: FaLocationInput): void {
  if (!norm(input.code)) throw new AppError('A code is required', 'VALIDATION');
  if (!norm(input.description)) throw new AppError('A description is required', 'VALIDATION');
}

export async function createFaLocation(input: FaLocationInput, user: Actor): Promise<{ id: number }> {
  assertFaLocation(input);
  if (await hasAnyRow('fa_location', 'code = ?', norm(input.code))) throw new AppError('An FA location with this code already exists', 'DUPLICATE');
  const info = await run(
    'INSERT INTO fa_location (code, description, status, created_at, created_by) VALUES (?,?,?,?,?)',
    norm(input.code).toUpperCase(), norm(input.description), input.status, now(), user.username,
  );
  await audit(user, 'FA_LOCATION_CREATE', 'fa_location', info.lastInsertRowid, { code: input.code });
  return { id: Number(info.lastInsertRowid) };
}

export async function updateFaLocation(id: number, input: FaLocationInput, user: Actor): Promise<void> {
  assertFaLocation(input);
  const before = await getFaLocation(id);
  if (!before) throw new AppError('FA location not found', 'NOT_FOUND');
  if (await hasAnyRow('fa_location', 'code = ? AND id <> ?', norm(input.code), id)) throw new AppError('An FA location with this code already exists', 'DUPLICATE');
  await run(
    'UPDATE fa_location SET code = ?, description = ?, status = ? WHERE id = ?',
    norm(input.code).toUpperCase(), norm(input.description), input.status, id,
  );
  await audit(user, 'FA_LOCATION_UPDATE', 'fa_location', id, {});
}

/* -------------------------------------------------------------------- Maintenance */

export const listMaintenanceCodes = (): Promise<Maintenance[]> =>
  all<Maintenance>('SELECT * FROM maintenance ORDER BY code');

export const listActiveMaintenanceCodes = (): Promise<Maintenance[]> =>
  all<Maintenance>("SELECT * FROM maintenance WHERE status = 'ACTIVE' ORDER BY code");

export const getMaintenance = (id: number): Promise<Maintenance | undefined> =>
  one<Maintenance>('SELECT * FROM maintenance WHERE id = ?', id);

export interface MaintenanceInput { code: string; description: string; status: 'ACTIVE' | 'INACTIVE' }

function assertMaintenance(input: MaintenanceInput): void {
  if (!norm(input.code)) throw new AppError('A code is required', 'VALIDATION');
  if (!norm(input.description)) throw new AppError('A description is required', 'VALIDATION');
}

export async function createMaintenance(input: MaintenanceInput, user: Actor): Promise<{ id: number }> {
  assertMaintenance(input);
  if (await hasAnyRow('maintenance', 'code = ?', norm(input.code))) throw new AppError('A maintenance code with this code already exists', 'DUPLICATE');
  const info = await run(
    'INSERT INTO maintenance (code, description, status, created_at, created_by) VALUES (?,?,?,?,?)',
    norm(input.code).toUpperCase(), norm(input.description), input.status, now(), user.username,
  );
  await audit(user, 'MAINTENANCE_CREATE', 'maintenance', info.lastInsertRowid, { code: input.code });
  return { id: Number(info.lastInsertRowid) };
}

export async function updateMaintenance(id: number, input: MaintenanceInput, user: Actor): Promise<void> {
  assertMaintenance(input);
  const before = await getMaintenance(id);
  if (!before) throw new AppError('Maintenance code not found', 'NOT_FOUND');
  if (await hasAnyRow('maintenance', 'code = ? AND id <> ?', norm(input.code), id)) throw new AppError('A maintenance code with this code already exists', 'DUPLICATE');
  await run(
    'UPDATE maintenance SET code = ?, description = ?, status = ? WHERE id = ?',
    norm(input.code).toUpperCase(), norm(input.description), input.status, id,
  );
  await audit(user, 'MAINTENANCE_UPDATE', 'maintenance', id, {});
}

/* ------------------------------------------------------------- Depreciation Book */

export const listDepreciationBooks = (): Promise<DepreciationBook[]> =>
  all<DepreciationBook>('SELECT * FROM depreciation_book ORDER BY code');

export const getDepreciationBook = (code: string): Promise<DepreciationBook | undefined> =>
  one<DepreciationBook>('SELECT * FROM depreciation_book WHERE code = ?', code);

export const getDepreciationBookById = (id: number): Promise<DepreciationBook | undefined> =>
  one<DepreciationBook>('SELECT * FROM depreciation_book WHERE id = ?', id);

export interface DepreciationBookInput {
  code: string;
  description: string;
  defaultFinalRoundingAmount: number;
  useRoundingInPeriodicDepr: boolean;
}

function assertDepreciationBook(input: DepreciationBookInput): void {
  if (!norm(input.code)) throw new AppError('A code is required', 'VALIDATION');
  if (!norm(input.description)) throw new AppError('A description is required', 'VALIDATION');
  if (input.defaultFinalRoundingAmount < 0) throw new AppError('The final rounding amount cannot be negative', 'VALIDATION');
}

export async function createDepreciationBook(input: DepreciationBookInput, user: Actor): Promise<{ id: number }> {
  assertDepreciationBook(input);
  if (await hasAnyRow('depreciation_book', 'code = ?', norm(input.code))) throw new AppError('A depreciation book with this code already exists', 'DUPLICATE');
  const info = await run(
    `INSERT INTO depreciation_book (code, description, g_l_integration, default_final_rounding_amount, use_rounding_in_periodic_depr, created_at, created_by)
     VALUES (?,?,1,?,?,?,?)`,
    norm(input.code).toUpperCase(), norm(input.description), Math.round(input.defaultFinalRoundingAmount),
    input.useRoundingInPeriodicDepr ? 1 : 0, now(), user.username,
  );
  await audit(user, 'DEPRECIATION_BOOK_CREATE', 'depreciation_book', info.lastInsertRowid, { code: input.code });
  return { id: Number(info.lastInsertRowid) };
}

export async function updateDepreciationBook(id: number, input: DepreciationBookInput, user: Actor): Promise<void> {
  assertDepreciationBook(input);
  const before = await getDepreciationBookById(id);
  if (!before) throw new AppError('Depreciation book not found', 'NOT_FOUND');
  if (norm(input.code).toUpperCase() !== before.code) {
    throw new AppError('The code of an existing depreciation book cannot be changed', 'VALIDATION');
  }
  await run(
    'UPDATE depreciation_book SET description = ?, default_final_rounding_amount = ?, use_rounding_in_periodic_depr = ? WHERE id = ?',
    norm(input.description), Math.round(input.defaultFinalRoundingAmount), input.useRoundingInPeriodicDepr ? 1 : 0, id,
  );
  await audit(user, 'DEPRECIATION_BOOK_UPDATE', 'depreciation_book', id, {});
}

/* -------------------------------------------------------------- FA Posting Group */

const FAPG_SELECT = `
  SELECT g.*,
         acq.code  AS acquisition_cost_account_code,
         accd.code AS accum_depreciation_account_code,
         dep.code  AS depreciation_expense_account_code,
         wd.code   AS write_down_expense_account_code,
         appr.code AS appreciation_account_code,
         maint.code AS maintenance_expense_account_code,
         gain.code AS gains_acc_on_disposal_code,
         loss.code AS losses_acc_on_disposal_code,
         (SELECT COUNT(*) FROM fa_depreciation_book b WHERE b.fa_posting_group_code = g.code) AS assets_using
  FROM fa_posting_group g
  JOIN gl_account acq  ON acq.id  = g.acquisition_cost_account_id
  JOIN gl_account accd ON accd.id = g.accum_depreciation_account_id
  JOIN gl_account dep  ON dep.id  = g.depreciation_expense_account_id
  JOIN gl_account wd   ON wd.id   = g.write_down_expense_account_id
  JOIN gl_account appr ON appr.id = g.appreciation_account_id
  JOIN gl_account maint ON maint.id = g.maintenance_expense_account_id
  JOIN gl_account gain ON gain.id = g.gains_acc_on_disposal_id
  JOIN gl_account loss ON loss.id = g.losses_acc_on_disposal_id`;

export const listFaPostingGroups = (): Promise<FaPostingGroupView[]> =>
  all<FaPostingGroupView>(`${FAPG_SELECT} ORDER BY g.code`);

export const getFaPostingGroup = (code: string): Promise<FaPostingGroup | undefined> =>
  one<FaPostingGroup>('SELECT * FROM fa_posting_group WHERE code = ?', code);

export const getFaPostingGroupById = (id: number): Promise<FaPostingGroup | undefined> =>
  one<FaPostingGroup>('SELECT * FROM fa_posting_group WHERE id = ?', id);

export interface FaPostingGroupInput {
  code: string;
  description: string;
  acquisitionCostAccountId: number;
  accumDepreciationAccountId: number;
  depreciationExpenseAccountId: number;
  writeDownExpenseAccountId: number;
  appreciationAccountId: number;
  maintenanceExpenseAccountId: number;
  gainsAccOnDisposalId: number;
  lossesAccOnDisposalId: number;
}

function assertFaPostingGroup(input: FaPostingGroupInput): void {
  if (!norm(input.code)) throw new AppError('A code is required', 'VALIDATION');
  if (!norm(input.description)) throw new AppError('A description is required', 'VALIDATION');
  const accounts: [string, number][] = [
    ['Acquisition Cost account', input.acquisitionCostAccountId],
    ['Accum. Depreciation account', input.accumDepreciationAccountId],
    ['Depreciation Expense account', input.depreciationExpenseAccountId],
    ['Write-Down Expense account', input.writeDownExpenseAccountId],
    ['Appreciation account', input.appreciationAccountId],
    ['Maintenance Expense account', input.maintenanceExpenseAccountId],
    ['Gains Acc. on Disposal', input.gainsAccOnDisposalId],
    ['Losses Acc. on Disposal', input.lossesAccOnDisposalId],
  ];
  for (const [label, id] of accounts) {
    if (!id) throw new AppError(`A ${label} is required`, 'VALIDATION');
  }
}

const FAPG_COLS = `code, description, acquisition_cost_account_id, accum_depreciation_account_id,
  depreciation_expense_account_id, write_down_expense_account_id, appreciation_account_id,
  maintenance_expense_account_id, gains_acc_on_disposal_id, losses_acc_on_disposal_id`;

const fapgValues = (input: FaPostingGroupInput): unknown[] => [
  norm(input.code).toUpperCase(), norm(input.description),
  input.acquisitionCostAccountId, input.accumDepreciationAccountId, input.depreciationExpenseAccountId,
  input.writeDownExpenseAccountId, input.appreciationAccountId, input.maintenanceExpenseAccountId,
  input.gainsAccOnDisposalId, input.lossesAccOnDisposalId,
];

export async function createFaPostingGroup(input: FaPostingGroupInput, user: Actor): Promise<{ id: number }> {
  assertFaPostingGroup(input);
  if (await hasAnyRow('fa_posting_group', 'code = ?', norm(input.code))) throw new AppError('An FA posting group with this code already exists', 'DUPLICATE');
  const info = await run(
    `INSERT INTO fa_posting_group (${FAPG_COLS}, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ...fapgValues(input), now(), user.username,
  );
  await audit(user, 'FA_POSTING_GROUP_CREATE', 'fa_posting_group', info.lastInsertRowid, { code: input.code });
  return { id: Number(info.lastInsertRowid) };
}

export async function updateFaPostingGroup(id: number, input: FaPostingGroupInput, user: Actor): Promise<void> {
  assertFaPostingGroup(input);
  const before = await getFaPostingGroupById(id);
  if (!before) throw new AppError('FA posting group not found', 'NOT_FOUND');
  if (norm(input.code).toUpperCase() !== before.code) {
    throw new AppError('The code of an existing FA posting group cannot be changed', 'VALIDATION');
  }
  await run(
    `UPDATE fa_posting_group SET description = ?, acquisition_cost_account_id = ?, accum_depreciation_account_id = ?,
       depreciation_expense_account_id = ?, write_down_expense_account_id = ?, appreciation_account_id = ?,
       maintenance_expense_account_id = ?, gains_acc_on_disposal_id = ?, losses_acc_on_disposal_id = ?
     WHERE id = ?`,
    norm(input.description), input.acquisitionCostAccountId, input.accumDepreciationAccountId,
    input.depreciationExpenseAccountId, input.writeDownExpenseAccountId, input.appreciationAccountId,
    input.maintenanceExpenseAccountId, input.gainsAccOnDisposalId, input.lossesAccOnDisposalId, id,
  );
  await audit(user, 'FA_POSTING_GROUP_UPDATE', 'fa_posting_group', id, {});
}

/* -------------------------------------------------------------------- FA Setup */

const DEFAULT_SETUP: FaSetup = {
  id: 1, default_depreciation_book_code: null, default_fa_posting_group_code: null,
  allow_fa_posting_from: null, allow_fa_posting_to: null, updated_at: null, updated_by: null,
};

export async function getFaSetup(): Promise<FaSetup> {
  const row = await one<FaSetup>('SELECT * FROM fa_setup WHERE id = 1');
  return row ?? DEFAULT_SETUP;
}

export interface FaSetupInput {
  defaultDepreciationBookCode: string | null;
  defaultFaPostingGroupCode: string | null;
  allowFaPostingFrom: string | null;
  allowFaPostingTo: string | null;
}

export async function saveFaSetup(input: FaSetupInput, user: Actor): Promise<void> {
  if (input.defaultDepreciationBookCode && !(await hasAnyRow('depreciation_book', 'code = ?', input.defaultDepreciationBookCode))) {
    throw new AppError('Unknown depreciation book', 'VALIDATION');
  }
  if (input.defaultFaPostingGroupCode && !(await hasAnyRow('fa_posting_group', 'code = ?', input.defaultFaPostingGroupCode))) {
    throw new AppError('Unknown FA posting group', 'VALIDATION');
  }
  if (input.allowFaPostingFrom && input.allowFaPostingTo && input.allowFaPostingFrom > input.allowFaPostingTo) {
    throw new AppError('Allow FA Posting From cannot be after Allow FA Posting To', 'VALIDATION');
  }
  await run(
    `INSERT INTO fa_setup (id, default_depreciation_book_code, default_fa_posting_group_code, allow_fa_posting_from, allow_fa_posting_to, updated_at, updated_by)
     VALUES (1,?,?,?,?,?,?)
     ON CONFLICT (id) DO UPDATE SET
       default_depreciation_book_code = EXCLUDED.default_depreciation_book_code,
       default_fa_posting_group_code = EXCLUDED.default_fa_posting_group_code,
       allow_fa_posting_from = EXCLUDED.allow_fa_posting_from,
       allow_fa_posting_to = EXCLUDED.allow_fa_posting_to,
       updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
    input.defaultDepreciationBookCode || null, input.defaultFaPostingGroupCode || null,
    input.allowFaPostingFrom || null, input.allowFaPostingTo || null, now(), user.username,
  );
  await audit(user, 'FA_SETUP_SAVE', 'fa_setup', 1, input);
}
