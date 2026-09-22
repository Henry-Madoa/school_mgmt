/* chart of accounts — split out of lib/types.ts; import from '@/lib/types', never from here directly. */
import type { Cents, Flag } from '../types.ts';

/* -------------------------------------------------------- chart of accounts */

export type GlAccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';

/** Business Central's G/L "Account Type" — the account's structural role in the chart
 *  (see lib/constants.ts's GL_ACCOUNT_STRUCTURE_TYPES). */
export type GlAccountStructureType = 'POSTING' | 'HEADING' | 'TOTAL' | 'BEGIN_TOTAL' | 'END_TOTAL';

export interface GlAccount {
  id: number;
  code: string;
  name: string;
  type: GlAccountType;
  parent_code: string | null;
  is_postable: Flag;
  account_type: GlAccountStructureType;
  /** For TOTAL/END_TOTAL only — the code range(s)/list of Posting accounts this row sums,
   *  Business Central style (e.g. "1010..1099|1200"). */
  totaling: string | null;
  /** Depth in the Begin-Total / End-Total bracketing, written by Indent Chart of Accounts
   *  (lib/gl.ts's indentChartOfAccounts()). 0 until the chart has been indented. */
  indentation: number;
  balance: Cents;
  status: 'ACTIVE' | 'INACTIVE';
  /** Blocks this account from a manual G/L journal line — see lib/gl.ts's createJournal(). */
  no_direct_posting: Flag;
  vat_bus_posting_group_code: string | null;
  vat_prod_posting_group_code: string | null;
}

export interface TrialBalanceRow {
  id: number;
  code: string;
  name: string;
  type: GlAccountType;
  debit: Cents;
  credit: Cents;
  /** Signed balance in the natural direction of the account type. */
  net: Cents;
  debit_balance: Cents;
  credit_balance: Cents;
}
