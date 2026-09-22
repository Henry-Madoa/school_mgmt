/* journals — split out of lib/types.ts; import from '@/lib/types', never from here directly. */
import type { Actor, Cents, GlAccountType, IsoDate, IsoDateTime } from '../types.ts';

/* ---------------------------------------------------------------- journals */

export interface Journal {
  id: number;
  journal_no: string;
  value_date: IsoDate;
  posted_at: IsoDateTime;
  source_module: string;
  event_type: string;
  description: string | null;
  reference: string | null;
  amount: Cents;
  posted_by: string | null;
  reverses_id: number | null;
  reversed_by_id: number | null;
  idempotency_key: string | null;
  global_dimension_1_id: number | null;
  global_dimension_2_id: number | null;
  currency_code: string;
  currency_factor: number;
  /** BC closing date ("C31/12/2025"): posted by Close Income Statement — see lib/accounting.ts. */
  closing_entry: number;
}

export interface JournalListRow extends Journal {
  global_dimension_1_code: string | null;
  global_dimension_2_code: string | null;
}

export interface JournalLine {
  id: number;
  journal_id: number;
  line_no: number;
  gl_account_id: number;
  debit: Cents;
  credit: Cents;
  debit_lcy: Cents;
  credit_lcy: Cents;
  currency_code: string;
  currency_factor: number;
  narration: string | null;
  global_dimension_1_id: number | null;
  global_dimension_2_id: number | null;
}

export interface JournalLineWithAccount extends JournalLine {
  code: string;
  name: string;
  type: GlAccountType;
  global_dimension_1_code: string | null;
  global_dimension_2_code: string | null;
}

/** A journal line as supplied to postJournal, before it is resolved and stored. Amounts are in
 *  the journal's transaction currency (`currencyCode`); postJournal derives the LCY amounts. */
export interface JournalLineInput {
  /** GL account id (number) or account code (string). */
  account: number | string;
  debit?: Cents;
  credit?: Cents;
  narration?: string | null;
  /** Explicit per-line override — falls back to the header default (see PostJournalOptions) when omitted. */
  globalDimension1Id?: number | null;
  globalDimension2Id?: number | null;
  /** For a line hitting a bank control account — stamped onto its bank_account_ledger_entry. */
  bankDocumentType?: string | null;
  bankDocumentNo?: string | null;
  bankExternalDocumentNo?: string | null;
}

export interface PostJournalOptions {
  valueDate: IsoDate;
  module: string;
  eventType: string;
  description?: string | null;
  reference?: string | null;
  /** Header default dimensions, applied to every line that does not carry its own. */
  globalDimension1Id?: number | null;
  globalDimension2Id?: number | null;
  lines: JournalLineInput[];
  user?: Actor | null;
  idempotencyKey?: string | null;
  /** Transaction currency. Omitted → the base currency (KES); line amounts are then LCY. */
  currencyCode?: string | null;
  /** LCY per 1 unit of `currencyCode`. Omitted → resolved from currency_exchange_rate at valueDate. */
  currencyFactor?: number | null;
  /** Business Central's closing date: the journal is dated `valueDate` (a fiscal year's last day)
   *  but sits after it — outside a "..valueDate" filter, inside "..the day after". Only Close
   *  Income Statement sets it; a closed accounting period does not block it, since it changes no
   *  period's result. */
  closingEntry?: boolean;
}

export interface PostedJournal {
  id: number;
  journal_no: string;
  amount: Cents;
  /** Set when an idempotency key matched an existing journal. */
  duplicate?: boolean;
}

export interface LedgerLine extends JournalLine {
  journal_no: string;
  reference: string | null;
  value_date: IsoDate;
  closing_entry: number;
  description: string | null;
  source_module: string;
  global_dimension_1_code: string | null;
  global_dimension_2_code: string | null;
}

export interface AccountingPeriod {
  id: number;
  code: string; // YYYY-MM
  start_date: IsoDate;
  end_date: IsoDate;
  /** Whether postings are accepted — BC's Allow Posting gate, independent of the fiscal close. */
  status: 'OPEN' | 'CLOSED';
  /** BC "New Fiscal Year": this period starts a fiscal year. */
  new_fiscal_year: number;
  /** BC "Closed": set by Close Year on every period of the year; never cleared. */
  fiscally_closed: number;
  /** BC "Date Locked": set alongside fiscally_closed. */
  date_locked: number;
}
