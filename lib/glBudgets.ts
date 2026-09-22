/*
 * G/L budgets — Business Central's G/L Budget Names / G/L Budget Entries / Budget matrix, in this app's terms.
 *
 * A budget is a name; its figures are G/L budget entries — one row per (account, date, dimension
 * pair, amount). The matrix (app/budgets/[name]) is the editing surface: lines are G/L accounts
 * (or a global dimension's values), columns are periods of the chosen length; typing over a cell
 * replaces that cell's entries with one. The entries list beneath is the raw ledger of the budget.
 *
 * Amounts are kept in the account's natural direction, the same sign the trial balance's `net`
 * carries (income budgets positive, expense budgets positive), so a budget cell and its actual
 * compare directly, and a Financial Report column of Ledger Entry Type "Budget Entries" drops
 * straight into the same formulas as the actuals. A budget therefore holds income AND expense
 * (and balance-sheet) accounts side by side; the matrix's "Income/Balance" filter narrows the view.
 *
 * Copy G/L Budget, Export/Import Budget to/from Excel and Delete Budget follow the BC reports of the
 * same names (Report 96 / 82 / 81), including the adjustment factor, rounding method and date
 * change formula on the copy, and Replace/Add on the import.
 */
import { one, all, run, tx, audit } from './db.ts';
import { AppError } from './errors.ts';
import { trialBalance } from './accounting.ts';
import { matchesTotaling } from './gl.ts';
import { applyDateFormula, isValidDateFormula } from './dateFormula.ts';
import { today } from './format.ts';
import type { Actor, Cents, GlAccountType, IsoDate } from './types.ts';

/* ================================================================== budget names */

export interface GlBudgetName { name: string; description: string | null; blocked: boolean; created_at: string; created_by: string | null }
export interface GlBudgetNameView extends GlBudgetName { entries: number; total: Cents; first_date: IsoDate | null; last_date: IsoDate | null }

export const listBudgets = (): Promise<GlBudgetNameView[]> =>
  all<GlBudgetNameView>(
    `SELECT b.*, COUNT(e.id) AS entries, COALESCE(SUM(e.amount), 0) AS total, MIN(e.date) AS first_date, MAX(e.date) AS last_date
     FROM gl_budget_name b LEFT JOIN gl_budget_entry e ON e.budget_name = b.name GROUP BY b.name ORDER BY b.name`,
  );
export const getBudget = (name: string): Promise<GlBudgetNameView | undefined> =>
  one<GlBudgetNameView>(
    `SELECT b.*, COUNT(e.id) AS entries, COALESCE(SUM(e.amount), 0) AS total, MIN(e.date) AS first_date, MAX(e.date) AS last_date
     FROM gl_budget_name b LEFT JOIN gl_budget_entry e ON e.budget_name = b.name WHERE b.name = ? GROUP BY b.name`, name,
  );

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,29}$/;

export async function createBudget(input: { name: string; description?: string | null }, user: Actor): Promise<{ name: string }> {
  const name = input.name.trim().toUpperCase();
  if (!NAME_RE.test(name)) throw new AppError('A budget name is up to 30 letters, digits, spaces, dots, dashes or underscores', 'VALIDATION');
  if (await one('SELECT 1 FROM gl_budget_name WHERE name = ?', name)) throw new AppError('That budget already exists', 'DUPLICATE');
  await run('INSERT INTO gl_budget_name (name, description, created_at, created_by) VALUES (?,?,?,?)', name, input.description?.trim() || null, new Date().toISOString(), user.username);
  await audit(user, 'GL_BUDGET_CREATE', 'gl_budget_name', name, {});
  return { name };
}

export async function updateBudget(name: string, input: { description?: string | null; blocked?: boolean }, user: Actor): Promise<void> {
  const b = await one<GlBudgetName>('SELECT * FROM gl_budget_name WHERE name = ?', name);
  if (!b) throw new AppError('Budget not found', 'NOT_FOUND');
  await run('UPDATE gl_budget_name SET description = ?, blocked = ? WHERE name = ?', input.description?.trim() || null, input.blocked ?? b.blocked, name);
  await audit(user, 'GL_BUDGET_UPDATE', 'gl_budget_name', name, input);
}

export async function deleteBudget(name: string, user: Actor): Promise<void> {
  if (!(await one('SELECT 1 FROM gl_budget_name WHERE name = ?', name))) throw new AppError('Budget not found', 'NOT_FOUND');
  const used = await one('SELECT 1 FROM column_layout WHERE budget_name = ?', name);
  if (used) throw new AppError('A Financial Report column layout reads this budget — point it elsewhere first', 'IN_USE');
  await run('DELETE FROM gl_budget_name WHERE name = ?', name);
  await audit(user, 'GL_BUDGET_DELETE', 'gl_budget_name', name, {});
}

async function assertOpen(name: string): Promise<GlBudgetName> {
  const b = await one<GlBudgetName>('SELECT * FROM gl_budget_name WHERE name = ?', name);
  if (!b) throw new AppError('Budget not found', 'NOT_FOUND');
  if (b.blocked) throw new AppError('This budget is blocked — unblock it to change figures', 'VALIDATION');
  return b;
}

/* ================================================================== periods (View by) */

export type ViewBy = 'DAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR' | 'PERIOD';
export type ViewAs = 'NET_CHANGE' | 'BALANCE_AT_DATE';
export type RoundingFactor = 'NONE' | '1' | '1000' | '1000000';
export interface BudgetPeriod { key: string; label: string; start: IsoDate; end: IsoDate }

const isoOf = (d: Date): IsoDate => d.toISOString().slice(0, 10);
const utc = (iso: IsoDate): Date => new Date(`${iso}T00:00:00Z`);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MAX_COLUMNS = 120;

/** The twelve months of the fiscal year that contains `date`, as YYYY-MM. */
export async function fiscalMonths(date: IsoDate): Promise<{ start: IsoDate; end: IsoDate; months: string[] }> {
  const org = await one<{ fy_start_month: number | null }>('SELECT fy_start_month FROM organisation WHERE id = 1');
  const fyMonth = org?.fy_start_month ?? 1;
  const [y, m] = date.split('-').map(Number);
  const startYear = m >= fyMonth ? y : y - 1;
  const months: string[] = [];
  for (let i = 0; i < 12; i++) months.push(isoOf(new Date(Date.UTC(startYear, fyMonth - 1 + i, 1))).slice(0, 7));
  const endD = new Date(Date.UTC(startYear, fyMonth - 1 + 12, 0));
  return { start: `${months[0]}-01`, end: isoOf(endD), months };
}

/** The columns between `from` and `to` for a View by — BC's period buckets (Accounting Period reads the periods table). */
export async function budgetPeriods(from: IsoDate, to: IsoDate, viewBy: ViewBy): Promise<BudgetPeriod[]> {
  if (from > to) throw new AppError('The date filter ends before it starts', 'VALIDATION');
  const out: BudgetPeriod[] = [];
  if (viewBy === 'PERIOD') {
    const rows = await all<{ code: string; start_date: IsoDate; end_date: IsoDate }>(
      'SELECT code, start_date, end_date FROM accounting_period WHERE end_date >= ? AND start_date <= ? ORDER BY start_date', from, to,
    );
    if (!rows.length) throw new AppError('No accounting periods cover the date filter — create the fiscal year under Finance → Accounting Periods, or view by month', 'VALIDATION');
    for (const r of rows) out.push({ key: r.start_date, label: r.code, start: r.start_date < from ? from : r.start_date, end: r.end_date > to ? to : r.end_date });
    return out;
  }
  let cursor = utc(from);
  const end = utc(to);
  while (cursor <= end) {
    let next: Date; let label: string;
    const y = cursor.getUTCFullYear(); const m = cursor.getUTCMonth(); const d = cursor.getUTCDate();
    switch (viewBy) {
      case 'DAY': next = new Date(Date.UTC(y, m, d + 1)); label = isoOf(cursor); break;
      case 'WEEK': { const dow = (cursor.getUTCDay() + 6) % 7; const weekStart = new Date(Date.UTC(y, m, d - dow)); next = new Date(Date.UTC(weekStart.getUTCFullYear(), weekStart.getUTCMonth(), weekStart.getUTCDate() + 7)); label = `Wk of ${isoOf(cursor)}`; break; }
      case 'QUARTER': { const qm = Math.floor(m / 3) * 3; next = new Date(Date.UTC(y, qm + 3, 1)); label = `Q${Math.floor(m / 3) + 1} ${y}`; break; }
      case 'YEAR': next = new Date(Date.UTC(y + 1, 0, 1)); label = String(y); break;
      default: next = new Date(Date.UTC(y, m + 1, 1)); label = `${MONTHS[m]} ${String(y).slice(2)}`;
    }
    const periodEnd = new Date(next.getTime() - 86_400_000);
    out.push({ key: isoOf(cursor), label, start: isoOf(cursor), end: periodEnd > end ? to : isoOf(periodEnd) });
    if (out.length >= MAX_COLUMNS) throw new AppError(`That view would need more than ${MAX_COLUMNS} columns — narrow the date filter or view by a longer period`, 'VALIDATION');
    cursor = next;
  }
  return out;
}

/* ================================================================== the matrix */

export type LinesBy = 'ACCOUNT' | 'DIM1' | 'DIM2';
export type AccountScope = 'INCOME_STATEMENT' | 'BALANCE_SHEET' | 'ALL';

export interface BudgetMatrixOptions {
  name: string;
  from: IsoDate;
  to: IsoDate;
  viewBy?: ViewBy;
  viewAs?: ViewAs;
  linesBy?: LinesBy;
  /** BC "G/L Acc. Filter": codes and ranges, e.g. 4000..4999|5100. */
  accountFilter?: string | null;
  scope?: AccountScope;
  /** Global dimension value ids to restrict the entries counted (and to stamp on cells typed). */
  dim1Id?: number | null;
  dim2Id?: number | null;
  /** Show every account, even with no figure in view (BC's default); off = only lines with figures. */
  showAll?: boolean;
}

export interface BudgetMatrixRow {
  /** The account's id (lines by account) or the dimension value's id (lines by dimension); 0 = no dimension value. */
  line_id: number;
  code: string;
  name: string;
  type: GlAccountType | 'DIMENSION';
  cells: Record<string, Cents>;
  total: Cents;
}
export interface BudgetMatrix {
  name: string; from: IsoDate; to: IsoDate; viewBy: ViewBy; viewAs: ViewAs; linesBy: LinesBy;
  periods: BudgetPeriod[]; rows: BudgetMatrixRow[]; totals: Record<string, Cents>; grand: Cents;
  /** Income and expense sub-totals per period, so the matrix shows the budgeted surplus. */
  income: Record<string, Cents>; expense: Record<string, Cents>;
  editable: boolean;
}

const scopeTypes = (scope: AccountScope): GlAccountType[] =>
  scope === 'INCOME_STATEMENT' ? ['INCOME', 'EXPENSE'] : scope === 'BALANCE_SHEET' ? ['ASSET', 'LIABILITY', 'EQUITY'] : ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'];

export async function budgetMatrix(o: BudgetMatrixOptions): Promise<BudgetMatrix> {
  const viewBy = o.viewBy ?? 'MONTH'; const viewAs = o.viewAs ?? 'NET_CHANGE'; const linesBy = o.linesBy ?? 'ACCOUNT';
  const periods = await budgetPeriods(o.from, o.to, viewBy);
  const types = scopeTypes(o.scope ?? 'INCOME_STATEMENT');
  const accounts = (await all<{ id: number; code: string; name: string; type: GlAccountType }>(
    "SELECT id, code, name, type FROM gl_account WHERE is_postable = 1 AND status = 'ACTIVE' AND type = ANY(@types) ORDER BY code", { types },
  )).filter((a) => !o.accountFilter?.trim() || matchesTotaling(a.code, o.accountFilter));
  const accountIds = accounts.map((a) => a.id);
  // Balance at date needs everything before the window too.
  const entries = await all<{ gl_account_id: number; date: IsoDate; amount: Cents; global_dimension_1_id: number | null; global_dimension_2_id: number | null }>(
    `SELECT gl_account_id, date, amount, global_dimension_1_id, global_dimension_2_id FROM gl_budget_entry
     WHERE budget_name = @name AND gl_account_id = ANY(@ids) AND date <= @to ${viewAs === 'NET_CHANGE' ? 'AND date >= @from' : ''}
       ${o.dim1Id ? 'AND global_dimension_1_id = @d1' : ''} ${o.dim2Id ? 'AND global_dimension_2_id = @d2' : ''}`,
    { name: o.name, ids: accountIds, from: o.from, to: o.to, d1: o.dim1Id ?? null, d2: o.dim2Id ?? null },
  );
  // Lines: accounts, or the values of a global dimension (plus a "no value" line).
  let lines: { line_id: number; code: string; name: string; type: GlAccountType | 'DIMENSION' }[];
  const dimKey = linesBy === 'DIM1' ? 'global_dimension_1_id' : 'global_dimension_2_id';
  if (linesBy === 'ACCOUNT') lines = accounts.map((a) => ({ line_id: a.id, code: a.code, name: a.name, type: a.type }));
  else {
    const values = await all<{ id: number; code: string; name: string }>(`SELECT id, code, name FROM ${linesBy === 'DIM1' ? 'global_dimension_1_value' : 'global_dimension_2_value'} WHERE status = 'ACTIVE' ORDER BY code`);
    lines = [...values.map((v) => ({ line_id: v.id, code: v.code, name: v.name, type: 'DIMENSION' as const })), { line_id: 0, code: '', name: '(no dimension value)', type: 'DIMENSION' as const }];
  }
  const typeOf = new Map(accounts.map((a) => [a.id, a.type]));
  const cellOf = new Map<string, Cents>(); // `${line}|${periodKey}`
  const income: Record<string, Cents> = {}; const expense: Record<string, Cents> = {};
  for (const p of periods) { income[p.key] = 0; expense[p.key] = 0; }
  const opening = new Map<number, Cents>(); // balance-at-date: per line, before the window
  for (const e of entries) {
    const lineId = linesBy === 'ACCOUNT' ? e.gl_account_id : (e[dimKey] ?? 0);
    if (e.date < o.from) { opening.set(lineId, (opening.get(lineId) ?? 0) + Number(e.amount)); continue; }
    const p = periods.find((x) => e.date >= x.start && e.date <= x.end);
    if (!p) continue;
    const k = `${lineId}|${p.key}`;
    cellOf.set(k, (cellOf.get(k) ?? 0) + Number(e.amount));
    const t = typeOf.get(e.gl_account_id);
    if (t === 'INCOME') income[p.key] += Number(e.amount); else if (t === 'EXPENSE') expense[p.key] += Number(e.amount);
  }
  const totals: Record<string, Cents> = Object.fromEntries(periods.map((p) => [p.key, 0]));
  let rows: BudgetMatrixRow[] = lines.map((l) => {
    const cells: Record<string, Cents> = {};
    let running = opening.get(l.line_id) ?? 0; let total = 0;
    for (const p of periods) {
      const v = cellOf.get(`${l.line_id}|${p.key}`) ?? 0;
      running += v;
      cells[p.key] = viewAs === 'BALANCE_AT_DATE' ? running : v;
      total += v; totals[p.key] += viewAs === 'BALANCE_AT_DATE' ? running : v;
    }
    return { ...l, cells, total: viewAs === 'BALANCE_AT_DATE' ? running : total };
  });
  if (o.showAll === false) rows = rows.filter((r) => r.total !== 0 || Object.values(r.cells).some((v) => v !== 0));
  if (viewAs === 'BALANCE_AT_DATE') for (const p of periods) { income[p.key] = 0; expense[p.key] = 0; }
  return {
    name: o.name, from: o.from, to: o.to, viewBy, viewAs, linesBy, periods, rows, totals, income, expense,
    grand: Object.values(totals).reduce((s, v) => s + v, 0),
    editable: linesBy === 'ACCOUNT' && viewAs === 'NET_CHANGE',
  };
}

/** Type an amount over a matrix cell: the period's entries for that account (and dimension filter) are replaced by one dated the period's first day. */
export async function setBudgetCell(
  name: string, accountId: number, period: { start: IsoDate; end: IsoDate }, amount: Cents, user: Actor,
  dims: { dim1Id?: number | null; dim2Id?: number | null } = {},
): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(period.start) || !/^\d{4}-\d{2}-\d{2}$/.test(period.end)) throw new AppError('Bad period', 'VALIDATION');
  await assertOpen(name);
  const acct = await one<{ id: number }>('SELECT id FROM gl_account WHERE id = ? AND is_postable = 1', accountId);
  if (!acct) throw new AppError('Account not found or not a posting account', 'NOT_FOUND');
  await tx(async () => {
    await run(
      `DELETE FROM gl_budget_entry WHERE budget_name = @name AND gl_account_id = @acct AND date >= @from AND date <= @to
         ${dims.dim1Id ? 'AND global_dimension_1_id = @d1' : ''} ${dims.dim2Id ? 'AND global_dimension_2_id = @d2' : ''}`,
      { name, acct: accountId, from: period.start, to: period.end, d1: dims.dim1Id ?? null, d2: dims.dim2Id ?? null },
    );
    if (Math.round(amount) !== 0) {
      await run('INSERT INTO gl_budget_entry (budget_name, gl_account_id, date, amount, global_dimension_1_id, global_dimension_2_id, created_at, created_by) VALUES (?,?,?,?,?,?,?,?)',
        name, accountId, period.start, Math.round(amount), dims.dim1Id ?? null, dims.dim2Id ?? null, new Date().toISOString(), user.username);
    }
  });
}

/* ================================================================== budget entries (the raw rows) */

export interface BudgetEntryView {
  id: number; budget_name: string; gl_account_id: number; account_code: string; account_name: string; date: IsoDate; amount: Cents; description: string | null;
  global_dimension_1_id: number | null; dim1_code: string | null; global_dimension_2_id: number | null; dim2_code: string | null; created_at: string; created_by: string | null;
}
export interface BudgetEntryFilter { name: string; from?: IsoDate | null; to?: IsoDate | null; accountFilter?: string | null; accountId?: number | null; dim1Id?: number | null; dim2Id?: number | null; limit?: number }

export async function listBudgetEntries(f: BudgetEntryFilter): Promise<BudgetEntryView[]> {
  const rows = await all<BudgetEntryView>(
    `SELECT e.*, a.code AS account_code, a.name AS account_name, d1.code AS dim1_code, d2.code AS dim2_code
     FROM gl_budget_entry e JOIN gl_account a ON a.id = e.gl_account_id
     LEFT JOIN global_dimension_1_value d1 ON d1.id = e.global_dimension_1_id
     LEFT JOIN global_dimension_2_value d2 ON d2.id = e.global_dimension_2_id
     WHERE e.budget_name = @name AND (@from::text IS NULL OR e.date >= @from::text) AND (@to::text IS NULL OR e.date <= @to::text)
       ${f.accountId ? 'AND e.gl_account_id = @acct' : ''} ${f.dim1Id ? 'AND e.global_dimension_1_id = @d1' : ''} ${f.dim2Id ? 'AND e.global_dimension_2_id = @d2' : ''}
     ORDER BY e.date, a.code, e.id LIMIT @limit`,
    { name: f.name, from: f.from ?? null, to: f.to ?? null, acct: f.accountId ?? null, d1: f.dim1Id ?? null, d2: f.dim2Id ?? null, limit: f.limit ?? 2000 },
  );
  return f.accountFilter?.trim() ? rows.filter((r) => matchesTotaling(r.account_code, f.accountFilter)) : rows;
}

export interface BudgetEntryInput { accountId: number; date: IsoDate; amount: Cents; description?: string | null; dim1Id?: number | null; dim2Id?: number | null }

async function validateEntry(i: BudgetEntryInput): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.date)) throw new AppError('A date is required', 'VALIDATION');
  if (!Number.isFinite(i.amount)) throw new AppError('An amount is required', 'VALIDATION');
  const acct = await one<{ id: number }>('SELECT id FROM gl_account WHERE id = ? AND is_postable = 1', i.accountId);
  if (!acct) throw new AppError('Pick a posting G/L account', 'VALIDATION');
}

export async function createBudgetEntry(name: string, i: BudgetEntryInput, user: Actor): Promise<{ id: number }> {
  await assertOpen(name); await validateEntry(i);
  const r = await run('INSERT INTO gl_budget_entry (budget_name, gl_account_id, date, amount, description, global_dimension_1_id, global_dimension_2_id, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?)',
    name, i.accountId, i.date, Math.round(i.amount), i.description?.trim() || null, i.dim1Id ?? null, i.dim2Id ?? null, new Date().toISOString(), user.username);
  return { id: Number(r.lastInsertRowid) };
}
export async function updateBudgetEntry(id: number, i: BudgetEntryInput, user: Actor): Promise<void> {
  const e = await one<{ budget_name: string }>('SELECT budget_name FROM gl_budget_entry WHERE id = ?', id);
  if (!e) throw new AppError('Budget entry not found', 'NOT_FOUND');
  await assertOpen(e.budget_name); await validateEntry(i);
  await run('UPDATE gl_budget_entry SET gl_account_id = ?, date = ?, amount = ?, description = ?, global_dimension_1_id = ?, global_dimension_2_id = ? WHERE id = ?',
    i.accountId, i.date, Math.round(i.amount), i.description?.trim() || null, i.dim1Id ?? null, i.dim2Id ?? null, id);
  void user;
}
export async function deleteBudgetEntry(id: number, user: Actor): Promise<void> {
  const e = await one<{ budget_name: string }>('SELECT budget_name FROM gl_budget_entry WHERE id = ?', id);
  if (!e) throw new AppError('Budget entry not found', 'NOT_FOUND');
  await assertOpen(e.budget_name);
  await run('DELETE FROM gl_budget_entry WHERE id = ?', id);
  void user;
}

/** BC "Delete Budget": every entry of the budget inside the filter (all of them with no filter). */
export async function deleteBudgetEntries(name: string, f: { from?: IsoDate | null; to?: IsoDate | null; accountFilter?: string | null; dim1Id?: number | null; dim2Id?: number | null }, user: Actor): Promise<{ deleted: number }> {
  await assertOpen(name);
  const rows = await listBudgetEntries({ name, from: f.from, to: f.to, accountFilter: f.accountFilter, dim1Id: f.dim1Id, dim2Id: f.dim2Id, limit: 1_000_000 });
  if (!rows.length) return { deleted: 0 };
  await run('DELETE FROM gl_budget_entry WHERE id = ANY(?)', rows.map((r) => r.id));
  await audit(user, 'GL_BUDGET_DELETE_ENTRIES', 'gl_budget_name', name, { deleted: rows.length, filter: f });
  return { deleted: rows.length };
}

/* ================================================================== Copy G/L Budget (BC Report 96) */

export type RoundingMethod = 'NONE' | '1' | '10' | '100' | '1000';
export interface CopyBudgetOptions {
  /** Where the figures come from: the ledger (actuals) or another budget's entries. */
  source: 'GL_ENTRY' | 'GL_BUDGET_ENTRY';
  sourceBudget?: string | null;
  sourceFrom: IsoDate;
  sourceTo: IsoDate;
  accountFilter?: string | null;
  sourceDim1Id?: number | null;
  sourceDim2Id?: number | null;
  targetBudget: string;
  adjustmentFactor?: number;
  roundingMethod?: RoundingMethod;
  /** BC "Date Change Formula": +1Y moves last year's figures to this year. */
  dateChangeFormula?: string | null;
  /** Keep the source dimensions on the copied entries (BC's Dimension copy); off = no dimensions. */
  copyDimensions?: boolean;
  /** Clear what the target already holds for the (shifted) date range before copying. */
  replace?: boolean;
}

const roundTo = (cents: Cents, method: RoundingMethod): Cents => {
  if (method === 'NONE') return Math.round(cents);
  const unit = Number(method) * 100;
  return Math.round(cents / unit) * unit;
};

export async function copyGlBudget(o: CopyBudgetOptions, user: Actor): Promise<{ entries: number; total: Cents }> {
  await assertOpen(o.targetBudget);
  const factor = o.adjustmentFactor ?? 1;
  if (!(factor > 0)) throw new AppError('The adjustment factor must be positive (1 = as is, 1.1 = plus 10%)', 'VALIDATION');
  if (o.dateChangeFormula && !isValidDateFormula(o.dateChangeFormula)) throw new AppError('The date change formula is not valid (e.g. +1Y, +6M, -1Q)', 'VALIDATION');
  if (o.sourceFrom > o.sourceTo) throw new AppError('The source date filter ends before it starts', 'VALIDATION');
  if (o.source === 'GL_BUDGET_ENTRY' && !o.sourceBudget) throw new AppError('Pick the source budget', 'VALIDATION');
  const method = o.roundingMethod ?? 'NONE';
  const shift = (d: IsoDate) => (o.dateChangeFormula ? applyDateFormula(d, o.dateChangeFormula) : d);

  type Src = { gl_account_id: number; date: IsoDate; amount: Cents; d1: number | null; d2: number | null; description: string | null };
  let source: Src[];
  if (o.source === 'GL_BUDGET_ENTRY') {
    source = (await all<{ gl_account_id: number; date: IsoDate; amount: Cents; global_dimension_1_id: number | null; global_dimension_2_id: number | null; description: string | null; code: string }>(
      `SELECT e.gl_account_id, e.date, e.amount, e.global_dimension_1_id, e.global_dimension_2_id, e.description, a.code FROM gl_budget_entry e JOIN gl_account a ON a.id = e.gl_account_id
       WHERE e.budget_name = @b AND e.date >= @from AND e.date <= @to ${o.sourceDim1Id ? 'AND e.global_dimension_1_id = @d1' : ''} ${o.sourceDim2Id ? 'AND e.global_dimension_2_id = @d2' : ''}`,
      { b: o.sourceBudget, from: o.sourceFrom, to: o.sourceTo, d1: o.sourceDim1Id ?? null, d2: o.sourceDim2Id ?? null },
    )).filter((r) => !o.accountFilter?.trim() || matchesTotaling(r.code, o.accountFilter))
      .map((r) => ({ gl_account_id: r.gl_account_id, date: r.date, amount: Number(r.amount), d1: r.global_dimension_1_id, d2: r.global_dimension_2_id, description: r.description }));
  } else {
    // Actuals, month by month (a G/L entry copy in BC lands one budget entry per period), net of the account's direction.
    source = [];
    const months = await budgetPeriods(o.sourceFrom, o.sourceTo, 'MONTH');
    for (const m of months) {
      const rows = await trialBalance({ from: m.start, asOf: m.end });
      for (const r of rows) {
        if (o.accountFilter?.trim() && !matchesTotaling(r.code, o.accountFilter)) continue;
        if (!r.net) continue;
        source.push({ gl_account_id: r.id, date: m.start, amount: r.net, d1: null, d2: null, description: `Actuals ${m.label}` });
      }
    }
  }
  return tx(async () => {
    let entries = 0; let total = 0;
    const now = new Date().toISOString();
    if (o.replace && source.length) {
      const dates = source.map((s) => shift(s.date)).sort();
      await run('DELETE FROM gl_budget_entry WHERE budget_name = ? AND date >= ? AND date <= ?', o.targetBudget, dates[0], dates[dates.length - 1]);
    }
    for (const s of source) {
      const amount = roundTo(s.amount * factor, method);
      if (!amount) continue;
      await run('INSERT INTO gl_budget_entry (budget_name, gl_account_id, date, amount, description, global_dimension_1_id, global_dimension_2_id, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?)',
        o.targetBudget, s.gl_account_id, shift(s.date), amount, s.description, o.copyDimensions === false ? null : s.d1, o.copyDimensions === false ? null : s.d2, now, user.username);
      entries++; total += amount;
    }
    await audit(user, 'GL_BUDGET_COPY', 'gl_budget_name', o.targetBudget, { source: o.source, sourceBudget: o.sourceBudget, factor, method, dateChangeFormula: o.dateChangeFormula, entries });
    return { entries, total };
  });
}

/* ================================================================== Excel (BC Reports 82 / 81) */

/** The sheet layout both directions share: one row per G/L account, one column per period. */
export interface BudgetSheet { headers: string[]; periods: BudgetPeriod[]; rows: { code: string; name: string; amounts: Cents[] }[] }

export async function budgetSheet(o: BudgetMatrixOptions): Promise<BudgetSheet> {
  const m = await budgetMatrix({ ...o, linesBy: 'ACCOUNT', viewAs: 'NET_CHANGE', showAll: true });
  return {
    headers: ['G/L Account No.', 'Name', ...m.periods.map((p) => p.start)],
    periods: m.periods,
    rows: m.rows.map((r) => ({ code: r.code, name: r.name, amounts: m.periods.map((p) => r.cells[p.key] ?? 0) })),
  };
}

export interface ImportBudgetOptions { name: string; mode: 'REPLACE' | 'ADD'; description?: string | null; dim1Id?: number | null; dim2Id?: number | null }
export interface ImportBudgetResult { inserted: number; replaced: number; skipped: { row: number; reason: string }[] }

/**
 * Read the sheet the export wrote (or one typed to the same layout): column A account code, column
 * B ignored (name), every further column headed by a date (or YYYY-MM) is a period. REPLACE clears
 * each imported account's entries in the sheet's date span first; ADD stacks new entries.
 */
export async function importBudgetRows(o: ImportBudgetOptions, headers: string[], rows: (string | number | null)[][], user: Actor): Promise<ImportBudgetResult> {
  await assertOpen(o.name);
  const periodCols: { col: number; date: IsoDate }[] = [];
  for (let c = 2; c < headers.length; c++) {
    const h = String(headers[c] ?? '').trim();
    const d = /^\d{4}-\d{2}-\d{2}/.test(h) ? h.slice(0, 10) : /^\d{4}-\d{2}$/.test(h) ? `${h}-01` : null;
    if (d) periodCols.push({ col: c, date: d });
  }
  if (!periodCols.length) throw new AppError('No period columns found — the header row needs dates (2027-01-01) or months (2027-01) from column C onwards', 'VALIDATION');
  const accounts = new Map((await all<{ id: number; code: string }>('SELECT id, code FROM gl_account WHERE is_postable = 1')).map((a) => [a.code.toUpperCase(), a.id]));
  const result: ImportBudgetResult = { inserted: 0, replaced: 0, skipped: [] };
  const dates = periodCols.map((p) => p.date).sort();
  await tx(async () => {
    const now = new Date().toISOString();
    for (let r = 0; r < rows.length; r++) {
      const code = String(rows[r][0] ?? '').trim().toUpperCase();
      if (!code) continue;
      const accountId = accounts.get(code);
      if (!accountId) { result.skipped.push({ row: r + 2, reason: `G/L account ${code} not found or not a posting account` }); continue; }
      if (o.mode === 'REPLACE') {
        const del = await run('DELETE FROM gl_budget_entry WHERE budget_name = ? AND gl_account_id = ? AND date >= ? AND date <= ?', o.name, accountId, dates[0], dates[dates.length - 1]);
        result.replaced += Number(del.changes);
      }
      for (const p of periodCols) {
        const raw = rows[r][p.col];
        const units = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(/[,\s]/g, ''));
        if (!units || !Number.isFinite(units)) continue;
        await run('INSERT INTO gl_budget_entry (budget_name, gl_account_id, date, amount, description, global_dimension_1_id, global_dimension_2_id, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?)',
          o.name, accountId, p.date, Math.round(units * 100), o.description?.trim() || 'Imported from Excel', o.dim1Id ?? null, o.dim2Id ?? null, now, user.username);
        result.inserted++;
      }
    }
    await audit(user, 'GL_BUDGET_IMPORT', 'gl_budget_name', o.name, { mode: o.mode, inserted: result.inserted, replaced: result.replaced, skipped: result.skipped.length });
  });
  return result;
}

/* ================================================================== reading */

/** Budget net per account code for a window — the Financial Reports engine's Budget Entries source. */
export async function budgetBalances(name: string, from: IsoDate | null, to: IsoDate | null): Promise<Map<string, Cents>> {
  const rows = await all<{ code: string; amount: Cents }>(
    `SELECT a.code, SUM(e.amount) AS amount FROM gl_budget_entry e JOIN gl_account a ON a.id = e.gl_account_id
     WHERE e.budget_name = @name AND (@from::text IS NULL OR e.date >= @from::text) AND (@to::text IS NULL OR e.date <= @to::text) GROUP BY a.code`,
    { name, from, to },
  );
  return new Map(rows.map((r) => [r.code, Number(r.amount)]));
}

export interface BudgetVsActualRow { account_id: number; code: string; name: string; type: GlAccountType; budget: Cents; actual: Cents; variance: Cents; variance_pct: number | null }
export interface BudgetVsActual { name: string; from: IsoDate; to: IsoDate; rows: BudgetVsActualRow[]; totals: { income: { budget: Cents; actual: Cents }; expense: { budget: Cents; actual: Cents }; surplus: { budget: Cents; actual: Cents } } }

/** BC "G/L Balance/Budget": budget against actual per account for a window. */
export async function budgetVsActual(name: string, from: IsoDate, to: IsoDate, scope: AccountScope = 'INCOME_STATEMENT', accountFilter?: string | null): Promise<BudgetVsActual> {
  const [budget, actuals] = await Promise.all([budgetBalances(name, from, to), trialBalance({ from, asOf: to })]);
  const types = new Set(scopeTypes(scope));
  const rows: BudgetVsActualRow[] = actuals
    .filter((r) => types.has(r.type) && (!accountFilter?.trim() || matchesTotaling(r.code, accountFilter)))
    .map((r) => {
      const b = budget.get(r.code) ?? 0;
      // Variance reads "good is positive": income over budget, expense under budget; balance sheet = actual − budget.
      const variance = r.type === 'EXPENSE' ? b - r.net : r.net - b;
      return { account_id: r.id, code: r.code, name: r.name, type: r.type, budget: b, actual: r.net, variance, variance_pct: b ? (variance / Math.abs(b)) * 100 : null };
    })
    .filter((r) => r.budget || r.actual);
  const sum = (t: GlAccountType, k: 'budget' | 'actual') => rows.filter((r) => r.type === t).reduce((s, r) => s + r[k], 0);
  const income = { budget: sum('INCOME', 'budget'), actual: sum('INCOME', 'actual') };
  const expense = { budget: sum('EXPENSE', 'budget'), actual: sum('EXPENSE', 'actual') };
  return { name, from, to, rows, totals: { income, expense, surplus: { budget: income.budget - expense.budget, actual: income.actual - expense.actual } } };
}

/** The default window for a budget page: the fiscal year containing today. */
export const defaultBudgetWindow = async (): Promise<{ from: IsoDate; to: IsoDate }> => {
  const fy = await fiscalMonths(today());
  return { from: fy.start, to: fy.end };
};
