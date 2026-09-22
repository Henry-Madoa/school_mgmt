/* reports — split out of lib/types.ts; import from '@/lib/types', never from here directly. */
import type { Cents } from '../types.ts';

/* ---------------------------------------------------------------- reports */

export interface ReportLine {
  code: string;
  name: string;
  amount: Cents;
}

export interface BalanceSheet {
  assets: ReportLine[];
  liabilities: ReportLine[];
  equity: ReportLine[];
  surplus: Cents;
  totals: { assets: Cents; liabilities: Cents; equity: Cents; equityAndLiabilities: Cents };
  balanced: boolean;
}

export interface IncomeStatement {
  income: ReportLine[];
  expense: ReportLine[];
  totalIncome: Cents;
  totalExpense: Cents;
  surplus: Cents;
  from?: string;
  to?: string;
}
