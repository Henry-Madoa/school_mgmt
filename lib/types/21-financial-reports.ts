/* financial reports (account schedules) — split out of lib/types.ts; import from '@/lib/types', never from here directly. */
import type { Flag } from '../types.ts';

/* ------------------------------------------- financial reports (account schedules) */

export type ColumnLayoutType =
  | 'NET_CHANGE' | 'BALANCE_AT_DATE' | 'BEGINNING_BALANCE' | 'YEAR_TO_DATE' | 'ENTIRE_FISCAL_YEAR' | 'FORMULA';
export type FinReportAmountType = 'NET_AMOUNT' | 'DEBIT_AMOUNT' | 'CREDIT_AMOUNT';
export type ColumnShowType = 'ALWAYS' | 'NEVER' | 'WHEN_POSITIVE' | 'WHEN_NEGATIVE';
export type RoundingFactor = 'NONE' | '1' | '1000' | '1000000';
export type AccScheduleTotalingType = 'POSTING_ACCOUNTS' | 'TOTAL_ACCOUNTS' | 'FORMULA' | 'SET_BASE_FOR_PERCENT';
export type AccScheduleRowType = 'NET_CHANGE' | 'BALANCE_AT_DATE' | 'BEGINNING_BALANCE';
export type AccScheduleShowType = 'YES' | 'NO' | 'IF_ANY_NOT_ZERO' | 'IF_ALL_ZERO';

/** Business Central Table 334 "Column Layout Name". */
export interface ColumnLayoutName {
  id: number;
  name: string;
  description: string;
  created_at: string | null;
  created_by: string | null;
}

/** Business Central Table 333 "Column Layout". */
export interface ColumnLayout {
  id: number;
  column_layout_name_id: number;
  line_no: number;
  column_no: string;
  column_header: string;
  column_type: ColumnLayoutType;
  /** ENTRIES, or BUDGET_ENTRIES to read the budget named in budget_name (lib/glBudgets.ts). */
  ledger_entry_type: string;
  budget_name: string | null;
  amount_type: FinReportAmountType;
  formula: string;
  comparison_date_formula: string;
  show: ColumnShowType;
  rounding_factor: RoundingFactor;
  created_at: string | null;
  created_by: string | null;
}

/** Business Central Table 85 "Acc. Schedule Name" — a Financial Report Row Definition. */
export interface AccScheduleName {
  id: number;
  name: string;
  description: string;
  default_column_layout_name: string | null;
  created_at: string | null;
  created_by: string | null;
}

/** Business Central Table 86 "Acc. Schedule Line". */
export interface AccScheduleLine {
  id: number;
  acc_schedule_name_id: number;
  line_no: number;
  row_no: string;
  description: string;
  totaling_type: AccScheduleTotalingType;
  totaling: string;
  amount_type: FinReportAmountType;
  row_type: AccScheduleRowType;
  show: AccScheduleShowType;
  bold: Flag;
  italic: Flag;
  underline: Flag;
  double_underline: Flag;
  show_opposite_sign: Flag;
  new_page: Flag;
  indentation: number;
  dimension_1_totaling: string;
  dimension_2_totaling: string;
  created_at: string | null;
  created_by: string | null;
}

/** Business Central Table 133 "Financial Report" — a Row Definition paired with a Column Layout. */
export interface FinancialReport {
  id: number;
  name: string;
  description: string;
  row_group: string;
  column_group: string;
  created_at: string | null;
  created_by: string | null;
}

export interface FinReportColumn {
  columnNo: string;
  header: string;
  isFormula: boolean;
  /** Windows shown in the sub-heading, e.g. "01 Jan 2026 – 31 Dec 2026". */
  windowLabel: string;
}

export interface FinReportCell {
  /** null when the column's Show rule blanks it. */
  value: number | null;
  /** A percentage/ratio row is rendered as a plain number, an account row as money. */
  isRatio: boolean;
}

export interface FinReportRow {
  rowNo: string;
  description: string;
  indentation: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  doubleUnderline: boolean;
  newPage: boolean;
  isRatio: boolean;
  /** True for a caption line (no totaling, not a formula) — values are blank. */
  isCaption: boolean;
  hidden: boolean;
  /** Account filter behind an account row, for the Trial Balance drill-down link. */
  totaling: string;
  cells: FinReportCell[];
}

export interface FinancialReportResult {
  reportName: string;
  reportDescription: string;
  rowGroup: string;
  columnGroup: string;
  from: string | null;
  to: string;
  columns: FinReportColumn[];
  rows: FinReportRow[];
}
