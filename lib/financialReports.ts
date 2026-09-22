/*
 * Financial Reports (Account Schedules) — a Business Central port.
 *
 * A Row Definition (acc_schedule_name + acc_schedule_line) maps G/L accounts and formulas onto
 * report lines; a Column Layout (column_layout_name + column_layout) says which period each
 * column measures; a Financial Report pairs one of each. runFinancialReport() evaluates the two
 * against posted journal lines and returns a ready-to-render grid.
 *
 * The heavy lifting is reused, not rebuilt: trialBalance() (lib/accounting.ts) does the
 * per-account period sums and the LEFT-JOIN-then-filter dimension handling; matchesTotaling()
 * (lib/gl.ts) parses the "A..B|C" account filter; applyDateFormula() (lib/dateFormula.ts) does
 * the prior-period column shift; evalFormula() (lib/expr.ts) evaluates the row/column formulas.
 */
import { all, one, run, audit } from './db.ts';
import { AppError } from './errors.ts';
import { trialBalance } from './accounting.ts';
import { matchesTotaling, buildDimensionJoinClause } from './gl.ts';
import { budgetBalances } from './glBudgets.ts';
import { applyDateFormula } from './dateFormula.ts';
import { evalFormula, formulaIdentifiers, isValidFormula } from './expr.ts';
import { addDaysIso, startOfFiscalYear, endOfFiscalYear, formatDate, today } from './format.ts';
import type { FilterCondition } from './listFilters.ts';
import type {
  AccScheduleLine, AccScheduleName, Actor, ColumnLayout, ColumnLayoutName, ColumnLayoutType,
  FinancialReport, FinancialReportResult, FinReportColumn, FinReportRow, GlAccount,
  TrialBalanceRow,
} from './types.ts';

/* ============================================================ Column Layout Name (BC T334) */

export const listColumnLayoutNames = (): Promise<ColumnLayoutName[]> =>
  all<ColumnLayoutName>('SELECT * FROM column_layout_name ORDER BY name');

export const getColumnLayoutName = (name: string): Promise<ColumnLayoutName | undefined> =>
  one<ColumnLayoutName>('SELECT * FROM column_layout_name WHERE name = ?', name);

export interface ColumnLayoutNameInput { id?: number | null; name: string; description?: string }

export async function saveColumnLayoutName(input: ColumnLayoutNameInput, user: Actor): Promise<{ id: number }> {
  const name = input.name.trim().toUpperCase();
  if (!name) throw new AppError('A layout name is required', 'VALIDATION');
  const description = (input.description ?? '').trim();

  if (input.id) {
    const info = await run('UPDATE column_layout_name SET description = ? WHERE id = ?', description, input.id);
    if (!info.changes) throw new AppError('Column layout not found', 'NOT_FOUND');
    await audit(user, 'FIN_REPORT_COLUMN_LAYOUT_UPDATE', 'column_layout_name', input.id, { name });
    return { id: input.id };
  }
  if (await one('SELECT 1 FROM column_layout_name WHERE name = ?', name)) {
    throw new AppError('A column layout with that name already exists', 'DUPLICATE');
  }
  const info = await run(
    'INSERT INTO column_layout_name (name, description, created_at, created_by) VALUES (?,?,?,?)',
    name, description, new Date().toISOString(), user.username,
  );
  await audit(user, 'FIN_REPORT_COLUMN_LAYOUT_CREATE', 'column_layout_name', info.lastInsertRowid, { name });
  return { id: Number(info.lastInsertRowid) };
}

export async function deleteColumnLayoutName(name: string, user: Actor): Promise<void> {
  if (await one('SELECT 1 FROM financial_report WHERE column_group = ?', name)) {
    throw new AppError('This column layout is used by a Financial Report — change the report first', 'IN_USE');
  }
  const info = await run('DELETE FROM column_layout_name WHERE name = ?', name);
  if (!info.changes) throw new AppError('Column layout not found', 'NOT_FOUND');
  await audit(user, 'FIN_REPORT_COLUMN_LAYOUT_DELETE', 'column_layout_name', null, { name });
}

/* ---------------------------------------------------------------- Column Layout (BC T333) */

export const listColumnLayoutLines = (layoutName: string): Promise<ColumnLayout[]> =>
  all<ColumnLayout>(
    `SELECT c.* FROM column_layout c
     JOIN column_layout_name n ON n.id = c.column_layout_name_id
     WHERE n.name = ? ORDER BY c.line_no, c.id`,
    layoutName,
  );

export interface ColumnLayoutLineInput {
  id?: number | null;
  layoutName: string;
  lineNo?: number | null;
  columnNo: string;
  columnHeader?: string;
  columnType: ColumnLayoutType;
  amountType?: string;
  /** ENTRIES (actuals) or BUDGET_ENTRIES — the latter needs a budgetName. */
  ledgerEntryType?: string;
  budgetName?: string | null;
  formula?: string;
  comparisonDateFormula?: string;
  show?: string;
  roundingFactor?: string;
}

export async function saveColumnLayoutLine(input: ColumnLayoutLineInput, user: Actor): Promise<{ id: number }> {
  const parent = await getColumnLayoutName(input.layoutName);
  if (!parent) throw new AppError('Column layout not found', 'NOT_FOUND');
  const columnNo = input.columnNo.trim();
  if (!columnNo) throw new AppError('A Column No. is required', 'VALIDATION');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(columnNo)) {
    throw new AppError('Column No. must be a plain identifier (letters, digits, underscore) so formulas can name it', 'VALIDATION');
  }
  const formula = (input.formula ?? '').trim();
  if (input.columnType === 'FORMULA' && !formula) throw new AppError('A Formula column needs a formula', 'VALIDATION');
  if (formula && !isValidFormula(formula)) throw new AppError('That formula does not parse', 'VALIDATION');

  const ledgerEntryType = input.ledgerEntryType === 'BUDGET_ENTRIES' ? 'BUDGET_ENTRIES' : 'ENTRIES';
  const budgetName = ledgerEntryType === 'BUDGET_ENTRIES' ? (input.budgetName ?? '').trim() : '';
  if (ledgerEntryType === 'BUDGET_ENTRIES' && !budgetName) throw new AppError('A Budget Entries column needs a budget name', 'VALIDATION');
  const fields = {
    column_no: columnNo,
    column_header: (input.columnHeader ?? '').trim() || columnNo,
    column_type: input.columnType,
    amount_type: input.amountType ?? 'NET_AMOUNT',
    ledger_entry_type: ledgerEntryType,
    budget_name: budgetName || null,
    formula,
    comparison_date_formula: (input.comparisonDateFormula ?? '').trim(),
    show: input.show ?? 'ALWAYS',
    rounding_factor: input.roundingFactor ?? 'NONE',
  };

  if (input.id) {
    await run(
      `UPDATE column_layout SET column_no=?, column_header=?, column_type=?, amount_type=?, formula=?,
        comparison_date_formula=?, show=?, rounding_factor=?, ledger_entry_type=?, budget_name=? WHERE id = ?`,
      fields.column_no, fields.column_header, fields.column_type, fields.amount_type, fields.formula,
      fields.comparison_date_formula, fields.show, fields.rounding_factor, fields.ledger_entry_type, fields.budget_name, input.id,
    );
    await audit(user, 'FIN_REPORT_COLUMN_UPDATE', 'column_layout', input.id, { layout: parent.name, columnNo });
    return { id: input.id };
  }
  const lineNo = input.lineNo ?? await nextLineNo('column_layout', 'column_layout_name_id', parent.id);
  const info = await run(
    `INSERT INTO column_layout (column_layout_name_id, line_no, column_no, column_header, column_type,
       amount_type, formula, comparison_date_formula, show, rounding_factor, ledger_entry_type, budget_name, created_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    parent.id, lineNo, fields.column_no, fields.column_header, fields.column_type, fields.amount_type,
    fields.formula, fields.comparison_date_formula, fields.show, fields.rounding_factor, fields.ledger_entry_type, fields.budget_name,
    new Date().toISOString(), user.username,
  );
  await audit(user, 'FIN_REPORT_COLUMN_CREATE', 'column_layout', info.lastInsertRowid, { layout: parent.name, columnNo });
  return { id: Number(info.lastInsertRowid) };
}

export async function deleteColumnLayoutLine(id: number, user: Actor): Promise<void> {
  const info = await run('DELETE FROM column_layout WHERE id = ?', id);
  if (!info.changes) throw new AppError('Column not found', 'NOT_FOUND');
  await audit(user, 'FIN_REPORT_COLUMN_DELETE', 'column_layout', id);
}

export async function duplicateColumnLayout(name: string, newName: string, user: Actor): Promise<{ id: number }> {
  const src = await getColumnLayoutName(name);
  if (!src) throw new AppError('Column layout not found', 'NOT_FOUND');
  const created = await saveColumnLayoutName({ name: newName, description: `${src.description} (copy)`.trim() }, user);
  for (const line of await listColumnLayoutLines(name)) {
    await run(
      `INSERT INTO column_layout (column_layout_name_id, line_no, column_no, column_header, column_type,
         amount_type, formula, comparison_date_formula, show, rounding_factor, created_at, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      created.id, line.line_no, line.column_no, line.column_header, line.column_type, line.amount_type,
      line.formula, line.comparison_date_formula, line.show, line.rounding_factor,
      new Date().toISOString(), user.username,
    );
  }
  return created;
}

/* ======================================================= Acc. Schedule Name (BC T85) */

export const listAccScheduleNames = (): Promise<AccScheduleName[]> =>
  all<AccScheduleName>('SELECT * FROM acc_schedule_name ORDER BY name');

export const getAccScheduleName = (name: string): Promise<AccScheduleName | undefined> =>
  one<AccScheduleName>('SELECT * FROM acc_schedule_name WHERE name = ?', name);

export interface AccScheduleNameInput {
  id?: number | null;
  name: string;
  description?: string;
  defaultColumnLayoutName?: string | null;
}

export async function saveAccScheduleName(input: AccScheduleNameInput, user: Actor): Promise<{ id: number }> {
  const name = input.name.trim().toUpperCase();
  if (!name) throw new AppError('A row definition name is required', 'VALIDATION');
  const description = (input.description ?? '').trim();
  const dcl = (input.defaultColumnLayoutName ?? '').trim() || null;

  if (input.id) {
    const info = await run(
      'UPDATE acc_schedule_name SET description = ?, default_column_layout_name = ? WHERE id = ?',
      description, dcl, input.id,
    );
    if (!info.changes) throw new AppError('Row definition not found', 'NOT_FOUND');
    await audit(user, 'FIN_REPORT_ROW_DEF_UPDATE', 'acc_schedule_name', input.id, { name });
    return { id: input.id };
  }
  if (await one('SELECT 1 FROM acc_schedule_name WHERE name = ?', name)) {
    throw new AppError('A row definition with that name already exists', 'DUPLICATE');
  }
  const info = await run(
    'INSERT INTO acc_schedule_name (name, description, default_column_layout_name, created_at, created_by) VALUES (?,?,?,?,?)',
    name, description, dcl, new Date().toISOString(), user.username,
  );
  await audit(user, 'FIN_REPORT_ROW_DEF_CREATE', 'acc_schedule_name', info.lastInsertRowid, { name });
  return { id: Number(info.lastInsertRowid) };
}

export async function deleteAccScheduleName(name: string, user: Actor): Promise<void> {
  if (await one('SELECT 1 FROM financial_report WHERE row_group = ?', name)) {
    throw new AppError('This row definition is used by a Financial Report — change the report first', 'IN_USE');
  }
  const info = await run('DELETE FROM acc_schedule_name WHERE name = ?', name);
  if (!info.changes) throw new AppError('Row definition not found', 'NOT_FOUND');
  await audit(user, 'FIN_REPORT_ROW_DEF_DELETE', 'acc_schedule_name', null, { name });
}

/* ------------------------------------------------------------ Acc. Schedule Line (BC T86) */

export const listAccScheduleLines = (scheduleName: string): Promise<AccScheduleLine[]> =>
  all<AccScheduleLine>(
    `SELECT l.* FROM acc_schedule_line l
     JOIN acc_schedule_name n ON n.id = l.acc_schedule_name_id
     WHERE n.name = ? ORDER BY l.line_no, l.id`,
    scheduleName,
  );

export interface AccScheduleLineInput {
  id?: number | null;
  scheduleName: string;
  lineNo?: number | null;
  rowNo: string;
  description?: string;
  totalingType: string;
  totaling?: string;
  amountType?: string;
  rowType?: string;
  show?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  doubleUnderline?: boolean;
  showOppositeSign?: boolean;
  newPage?: boolean;
  indentation?: number;
  dimension1Totaling?: string;
  dimension2Totaling?: string;
}

export async function saveAccScheduleLine(input: AccScheduleLineInput, user: Actor): Promise<{ id: number }> {
  const parent = await getAccScheduleName(input.scheduleName);
  if (!parent) throw new AppError('Row definition not found', 'NOT_FOUND');
  const rowNo = input.rowNo.trim();
  if (!rowNo) throw new AppError('A Row No. is required', 'VALIDATION');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(rowNo)) {
    throw new AppError('Row No. must be a plain identifier (letters, digits, underscore) so formulas can name it', 'VALIDATION');
  }
  const totaling = (input.totaling ?? '').trim();
  if (input.totalingType === 'FORMULA') {
    if (!totaling) throw new AppError('A Formula row needs a formula', 'VALIDATION');
    if (!isValidFormula(totaling)) throw new AppError('That formula does not parse', 'VALIDATION');
  }
  const b = (v: unknown): 0 | 1 => (v ? 1 : 0);
  const fields = {
    row_no: rowNo,
    description: (input.description ?? '').trim(),
    totaling_type: input.totalingType,
    totaling,
    amount_type: input.amountType ?? 'NET_AMOUNT',
    row_type: input.rowType ?? 'NET_CHANGE',
    show: input.show ?? 'YES',
    bold: b(input.bold),
    italic: b(input.italic),
    underline: b(input.underline),
    double_underline: b(input.doubleUnderline),
    show_opposite_sign: b(input.showOppositeSign),
    new_page: b(input.newPage),
    indentation: Math.max(0, Math.min(6, Math.round(Number(input.indentation) || 0))),
    dimension_1_totaling: (input.dimension1Totaling ?? '').trim(),
    dimension_2_totaling: (input.dimension2Totaling ?? '').trim(),
  };

  if (input.id) {
    await run(
      `UPDATE acc_schedule_line SET row_no=?, description=?, totaling_type=?, totaling=?, amount_type=?,
         row_type=?, show=?, bold=?, italic=?, underline=?, double_underline=?, show_opposite_sign=?,
         new_page=?, indentation=?, dimension_1_totaling=?, dimension_2_totaling=? WHERE id = ?`,
      fields.row_no, fields.description, fields.totaling_type, fields.totaling, fields.amount_type,
      fields.row_type, fields.show, fields.bold, fields.italic, fields.underline, fields.double_underline,
      fields.show_opposite_sign, fields.new_page, fields.indentation, fields.dimension_1_totaling,
      fields.dimension_2_totaling, input.id,
    );
    await audit(user, 'FIN_REPORT_ROW_UPDATE', 'acc_schedule_line', input.id, { schedule: parent.name, rowNo });
    return { id: input.id };
  }
  const lineNo = input.lineNo ?? await nextLineNo('acc_schedule_line', 'acc_schedule_name_id', parent.id);
  const info = await run(
    `INSERT INTO acc_schedule_line (acc_schedule_name_id, line_no, row_no, description, totaling_type, totaling,
       amount_type, row_type, show, bold, italic, underline, double_underline, show_opposite_sign, new_page,
       indentation, dimension_1_totaling, dimension_2_totaling, created_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    parent.id, lineNo, fields.row_no, fields.description, fields.totaling_type, fields.totaling,
    fields.amount_type, fields.row_type, fields.show, fields.bold, fields.italic, fields.underline,
    fields.double_underline, fields.show_opposite_sign, fields.new_page, fields.indentation,
    fields.dimension_1_totaling, fields.dimension_2_totaling, new Date().toISOString(), user.username,
  );
  await audit(user, 'FIN_REPORT_ROW_CREATE', 'acc_schedule_line', info.lastInsertRowid, { schedule: parent.name, rowNo });
  return { id: Number(info.lastInsertRowid) };
}

export async function deleteAccScheduleLine(id: number, user: Actor): Promise<void> {
  const info = await run('DELETE FROM acc_schedule_line WHERE id = ?', id);
  if (!info.changes) throw new AppError('Row not found', 'NOT_FOUND');
  await audit(user, 'FIN_REPORT_ROW_DELETE', 'acc_schedule_line', id);
}

export async function duplicateAccScheduleName(name: string, newName: string, user: Actor): Promise<{ id: number }> {
  const src = await getAccScheduleName(name);
  if (!src) throw new AppError('Row definition not found', 'NOT_FOUND');
  const created = await saveAccScheduleName({
    name: newName, description: `${src.description} (copy)`.trim(),
    defaultColumnLayoutName: src.default_column_layout_name,
  }, user);
  for (const l of await listAccScheduleLines(name)) {
    await run(
      `INSERT INTO acc_schedule_line (acc_schedule_name_id, line_no, row_no, description, totaling_type, totaling,
         amount_type, row_type, show, bold, italic, underline, double_underline, show_opposite_sign, new_page,
         indentation, dimension_1_totaling, dimension_2_totaling, created_at, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      created.id, l.line_no, l.row_no, l.description, l.totaling_type, l.totaling, l.amount_type, l.row_type,
      l.show, l.bold, l.italic, l.underline, l.double_underline, l.show_opposite_sign, l.new_page,
      l.indentation, l.dimension_1_totaling, l.dimension_2_totaling, new Date().toISOString(), user.username,
    );
  }
  return created;
}

/* =========================================================== Financial Report (BC T133) */

export const listFinancialReports = (): Promise<FinancialReport[]> =>
  all<FinancialReport>('SELECT * FROM financial_report ORDER BY name');

export const getFinancialReport = (name: string): Promise<FinancialReport | undefined> =>
  one<FinancialReport>('SELECT * FROM financial_report WHERE name = ?', name);

export interface FinancialReportInput {
  id?: number | null;
  name: string;
  description?: string;
  rowGroup: string;
  columnGroup: string;
}

export async function saveFinancialReport(input: FinancialReportInput, user: Actor): Promise<{ id: number }> {
  const name = input.name.trim().toUpperCase();
  if (!name) throw new AppError('A report name is required', 'VALIDATION');
  const rowGroup = input.rowGroup.trim();
  const columnGroup = input.columnGroup.trim();
  if (!rowGroup || !(await getAccScheduleName(rowGroup))) throw new AppError('Pick an existing row definition', 'VALIDATION');
  if (!columnGroup || !(await getColumnLayoutName(columnGroup))) throw new AppError('Pick an existing column layout', 'VALIDATION');
  const description = (input.description ?? '').trim();

  if (input.id) {
    const info = await run(
      'UPDATE financial_report SET description = ?, row_group = ?, column_group = ? WHERE id = ?',
      description, rowGroup, columnGroup, input.id,
    );
    if (!info.changes) throw new AppError('Report not found', 'NOT_FOUND');
    await audit(user, 'FIN_REPORT_UPDATE', 'financial_report', input.id, { name });
    return { id: input.id };
  }
  if (await one('SELECT 1 FROM financial_report WHERE name = ?', name)) {
    throw new AppError('A report with that name already exists', 'DUPLICATE');
  }
  const info = await run(
    'INSERT INTO financial_report (name, description, row_group, column_group, created_at, created_by) VALUES (?,?,?,?,?,?)',
    name, description, rowGroup, columnGroup, new Date().toISOString(), user.username,
  );
  await audit(user, 'FIN_REPORT_CREATE', 'financial_report', info.lastInsertRowid, { name });
  return { id: Number(info.lastInsertRowid) };
}

export async function deleteFinancialReport(name: string, user: Actor): Promise<void> {
  const info = await run('DELETE FROM financial_report WHERE name = ?', name);
  if (!info.changes) throw new AppError('Report not found', 'NOT_FOUND');
  await audit(user, 'FIN_REPORT_DELETE', 'financial_report', null, { name });
}

/* ------------------------------------------------------------------------- helpers */

async function nextLineNo(table: string, parentCol: string, parentId: number): Promise<number> {
  const row = await one<{ mx: number | null }>(
    `SELECT MAX(line_no) AS mx FROM ${table} WHERE ${parentCol} = ?`, parentId,
  );
  return (Number(row?.mx ?? 0) || 0) + 10000;
}

/* ==================================================================== the engine */

type Window = { from: string | null; to: string | null } | null;

interface FyStart { month: number; day: number }

/** The date window a column of `type` measures, given the report's base [from, to] and the
 *  column's own Comparison Date Formula (applied to both endpoints). null ⇒ a Formula column. */
function windowFor(
  type: ColumnLayoutType, base: { from: string | null; to: string }, fy: FyStart, comparison: string,
): Window {
  const cmp = (d: string | null): string | null => (d && comparison ? applyDateFormula(d, comparison) : d);
  switch (type) {
    case 'FORMULA':
      return null;
    case 'NET_CHANGE':
      return { from: cmp(base.from), to: cmp(base.to) };
    case 'BALANCE_AT_DATE':
      return { from: null, to: cmp(base.to) };
    case 'BEGINNING_BALANCE':
      // Balance the instant before the period opened. With no period start there is nothing before it.
      return { from: null, to: cmp(base.from ? addDaysIso(base.from, -1) : '0001-01-01') };
    case 'YEAR_TO_DATE':
      return { from: cmp(startOfFiscalYear(base.to, fy.month, fy.day)), to: cmp(base.to) };
    case 'ENTIRE_FISCAL_YEAR':
      return {
        from: cmp(startOfFiscalYear(base.to, fy.month, fy.day)),
        to: cmp(endOfFiscalYear(base.to, fy.month, fy.day)),
      };
    default:
      return { from: cmp(base.from), to: cmp(base.to) };
  }
}

function windowLabel(win: Window, isBalance: boolean): string {
  if (!win) return 'formula';
  if (isBalance || !win.from) return win.to ? `as at ${formatDate(win.to)}` : 'all dates';
  return `${formatDate(win.from)} – ${formatDate(win.to ?? today())}`;
}

const round = (n: number, factor: string): number => {
  const f = Number(factor);
  return Number.isFinite(f) && f > 1 ? n / f : n;
};

const isRatioFormula = (formula: string): boolean => formula.includes('/');

export interface RunFinancialReportOptions {
  /** A Financial Report name — resolves both row + column group. */
  reportName?: string;
  /** Or drive the two directly (the run page's column-layout override, and the test suite). */
  rowGroup?: string;
  columnGroup?: string;
  from?: string | null;
  to?: string | null;
  /** The run page's dimension / dimension-totaling filter bar. */
  filters?: FilterCondition[];
}

export async function runFinancialReport(opts: RunFinancialReportOptions): Promise<FinancialReportResult> {
  let report: FinancialReport | undefined;
  let rowGroup = opts.rowGroup ?? '';
  let columnGroup = opts.columnGroup ?? '';

  if (opts.reportName) {
    report = await getFinancialReport(opts.reportName);
    if (!report) throw new AppError('Financial report not found', 'NOT_FOUND');
    rowGroup = rowGroup || report.row_group;
    columnGroup = columnGroup || report.column_group;
  }
  const rowDef = await getAccScheduleName(rowGroup);
  if (!rowDef) throw new AppError('Row definition not found', 'NOT_FOUND');
  columnGroup = columnGroup || rowDef.default_column_layout_name || '';
  const colDef = columnGroup ? await getColumnLayoutName(columnGroup) : undefined;

  const [org, rowLines, colLinesRaw, accounts] = await Promise.all([
    one<{ fy_start_month: number; fy_start_day: number }>(
      'SELECT fy_start_month, fy_start_day FROM organisation WHERE id = 1',
    ),
    listAccScheduleLines(rowGroup),
    colDef ? listColumnLayoutLines(columnGroup) : Promise.resolve([] as ColumnLayout[]),
    all<GlAccount>('SELECT * FROM gl_account'),
  ]);
  const fy: FyStart = { month: org?.fy_start_month ?? 1, day: org?.fy_start_day ?? 1 };

  // A layout with no columns still renders one plain Net Change column.
  const colLines: ColumnLayout[] = colLinesRaw.length ? colLinesRaw : [{
    id: 0, column_layout_name_id: 0, line_no: 10000, column_no: 'NET', column_header: 'Net Change',
    column_type: 'NET_CHANGE', ledger_entry_type: 'ENTRIES', budget_name: null, amount_type: 'NET_AMOUNT', formula: '',
    comparison_date_formula: '', show: 'ALWAYS', rounding_factor: 'NONE', created_at: null, created_by: null,
  }];

  const to = opts.to || today();
  const base = { from: opts.from ?? null, to };
  const pageFilters = opts.filters ?? [];

  // trialBalance() is memoised per (window × dimension filter) — a "this year vs last year"
  // layout resolves to two DB reads, not one per cell.
  const tbCache = new Map<string, Map<string, TrialBalanceRow>>();
  const balancesFor = async (win: Window, dim1: string, dim2: string): Promise<Map<string, TrialBalanceRow>> => {
    if (!win) return new Map();
    const dimFilters: FilterCondition[] = [...pageFilters];
    if (dim1) dimFilters.push({ field: 'gd1_filter', operator: '=', value: dim1 });
    if (dim2) dimFilters.push({ field: 'gd2_filter', operator: '=', value: dim2 });
    const key = `${win.from ?? ''}|${win.to ?? ''}|${JSON.stringify(dimFilters)}`;
    const hit = tbCache.get(key);
    if (hit) return hit;
    const { clause, params } = await buildDimensionJoinClause(dimFilters, 'fr');
    const rows = await trialBalance({ from: win.from, asOf: win.to, joinClause: clause, joinParams: params });
    const map = new Map(rows.map((r) => [r.code, r]));
    tbCache.set(key, map);
    return map;
  };

  const accountAmount = (
    map: Map<string, TrialBalanceRow>, totaling: string, amountType: string, oppositeSign: boolean,
  ): number => {
    let sum = 0;
    for (const a of accounts) {
      if (a.account_type !== 'POSTING') continue;
      if (!matchesTotaling(a.code, totaling)) continue;
      const r = map.get(a.code);
      if (!r) continue;
      sum += amountType === 'DEBIT_AMOUNT' ? r.debit : amountType === 'CREDIT_AMOUNT' ? r.credit : r.net;
    }
    return oppositeSign ? -sum : sum;
  };

  // Budget Entries columns read lib/glBudgets.ts instead of the ledger, memoised the same way.
  const budgetCache = new Map<string, Map<string, number>>();
  const budgetFor = async (budgetName: string, win: Window): Promise<Map<string, number>> => {
    if (!win) return new Map();
    const key = `${budgetName}|${win.from ?? ''}|${win.to ?? ''}`;
    const hit = budgetCache.get(key);
    if (hit) return hit;
    const map = await budgetBalances(budgetName, win.from ?? null, win.to ?? null);
    budgetCache.set(key, map);
    return map;
  };
  const budgetAmount = (map: Map<string, number>, totaling: string, oppositeSign: boolean): number => {
    let sum = 0;
    for (const a of accounts) {
      if (a.account_type !== 'POSTING' || !matchesTotaling(a.code, totaling)) continue;
      sum += map.get(a.code) ?? 0;
    }
    return oppositeSign ? -sum : sum;
  };

  // Visible columns (drop "Never"); keep a stable order.
  const columns = [...colLines]
    .sort((a, b) => a.line_no - b.line_no || a.id - b.id)
    .filter((c) => c.show !== 'NEVER');
  const rowsSorted = [...rowLines].sort((a, b) => a.line_no - b.line_no || a.id - b.id);

  // grid[rowIdx][colIdx]
  const grid: (number | null)[][] = rowsSorted.map(() => columns.map(() => null));
  const isCaption = (l: AccScheduleLine): boolean =>
    l.totaling_type !== 'FORMULA' && l.totaling_type !== 'SET_BASE_FOR_PERCENT' && !l.totaling.trim();

  // Phase 1 — account rows × non-formula columns.
  for (let ci = 0; ci < columns.length; ci++) {
    const col = columns[ci];
    if (col.column_type === 'FORMULA') continue;
    for (let ri = 0; ri < rowsSorted.length; ri++) {
      const rowLine = rowsSorted[ri];
      if (rowLine.totaling_type === 'FORMULA' || isCaption(rowLine)) continue;
      const rowType = rowLine.row_type && rowLine.row_type !== 'NET_CHANGE' ? rowLine.row_type : col.column_type;
      const win = windowFor(rowType as ColumnLayoutType, base, fy, col.comparison_date_formula);
      if (col.ledger_entry_type === 'BUDGET_ENTRIES' && col.budget_name) {
        const bmap = await budgetFor(col.budget_name, win);
        grid[ri][ci] = round(budgetAmount(bmap, rowLine.totaling, !!rowLine.show_opposite_sign), col.rounding_factor);
        continue;
      }
      const map = await balancesFor(win, rowLine.dimension_1_totaling, rowLine.dimension_2_totaling);
      const amountType = col.amount_type !== 'NET_AMOUNT' ? col.amount_type : rowLine.amount_type;
      grid[ri][ci] = round(
        accountAmount(map, rowLine.totaling, amountType, !!rowLine.show_opposite_sign),
        col.rounding_factor,
      );
    }
  }

  // Phase 2 — formula rows × non-formula columns (evaluate over the rows already in this column).
  for (let ci = 0; ci < columns.length; ci++) {
    if (columns[ci].column_type === 'FORMULA') continue;
    const vars: Record<string, number> = {};
    for (let ri = 0; ri < rowsSorted.length; ri++) {
      if (grid[ri][ci] != null) vars[rowsSorted[ri].row_no] = grid[ri][ci]!;
    }
    for (let ri = 0; ri < rowsSorted.length; ri++) {
      const rowLine = rowsSorted[ri];
      if (rowLine.totaling_type !== 'FORMULA') continue;
      const v = evalFormula(rowLine.totaling, vars);
      grid[ri][ci] = isRatioFormula(rowLine.totaling) ? v : round(v, columns[ci].rounding_factor);
      vars[rowLine.row_no] = v;
    }
  }

  // Phase 3 — every row × formula columns (evaluate over the other columns' value for this row).
  for (let ci = 0; ci < columns.length; ci++) {
    const col = columns[ci];
    if (col.column_type !== 'FORMULA') continue;
    for (let ri = 0; ri < rowsSorted.length; ri++) {
      if (isCaption(rowsSorted[ri])) continue;
      const vars: Record<string, number> = {};
      for (let k = 0; k < columns.length; k++) {
        if (k !== ci && grid[ri][k] != null) vars[columns[k].column_no] = grid[ri][k]!;
      }
      grid[ri][ci] = evalFormula(col.formula, vars);
    }
  }

  // Column Show rules (WHEN_POSITIVE / WHEN_NEGATIVE blank a cell).
  for (let ci = 0; ci < columns.length; ci++) {
    const s = columns[ci].show;
    if (s !== 'WHEN_POSITIVE' && s !== 'WHEN_NEGATIVE') continue;
    for (let ri = 0; ri < rowsSorted.length; ri++) {
      const v = grid[ri][ci];
      if (v == null) continue;
      if ((s === 'WHEN_POSITIVE' && v <= 0) || (s === 'WHEN_NEGATIVE' && v >= 0)) grid[ri][ci] = null;
    }
  }

  const resultColumns: FinReportColumn[] = columns.map((c) => ({
    columnNo: c.column_no,
    header: c.column_header || c.column_no,
    isFormula: c.column_type === 'FORMULA',
    windowLabel: windowLabel(
      windowFor(c.column_type, base, fy, c.comparison_date_formula),
      c.column_type === 'BALANCE_AT_DATE' || c.column_type === 'BEGINNING_BALANCE',
    ),
  }));

  const resultRows: FinReportRow[] = rowsSorted.map((l, ri) => {
    const caption = isCaption(l);
    const ratio = l.totaling_type === 'FORMULA' && isRatioFormula(l.totaling);
    const cells = grid[ri].map((value) => ({ value: caption ? null : value, isRatio: ratio }));
    const nonZero = cells.some((c) => c.value != null && Math.abs(c.value) > 0.0000001);
    let hidden = l.show === 'NO';
    if (l.show === 'IF_ANY_NOT_ZERO') hidden = !nonZero;
    if (l.show === 'IF_ALL_ZERO') hidden = nonZero;
    return {
      rowNo: l.row_no,
      description: l.description || l.row_no,
      indentation: l.indentation,
      bold: !!l.bold,
      italic: !!l.italic,
      underline: !!l.underline,
      doubleUnderline: !!l.double_underline,
      newPage: !!l.new_page,
      isRatio: ratio,
      isCaption: caption,
      hidden,
      totaling: l.totaling_type === 'FORMULA' ? '' : l.totaling,
      cells,
    };
  });

  return {
    reportName: report?.name ?? rowGroup,
    reportDescription: report?.description ?? rowDef.description,
    rowGroup,
    columnGroup,
    from: base.from,
    to: base.to,
    columns: resultColumns,
    rows: resultRows,
  };
}

/** Field key → identifier check for a formula, so the setup screen can flag "row XYZ is unknown". */
export function unknownFormulaRefs(formula: string, knownRefs: string[]): string[] {
  const known = new Set(knownRefs);
  return formulaIdentifiers(formula).filter((id) => !known.has(id));
}
