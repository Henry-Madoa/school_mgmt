/* bank subledger — split out of lib/types.ts; import from '@/lib/types', never from here directly. */
import type { BankAccountType, Cents, Flag, IsoDate, IsoDateTime } from '../types.ts';

/* ------------------------------------------------------------- bank subledger */

export interface BankAccount {
  id: number;
  code: string;
  name: string;
  gl_account_id: number;
  bank_name: string | null;
  account_no: string | null;
  balance: Cents;
  status: 'ACTIVE' | 'INACTIVE';
  /** FOSA tellering role — see lib/cashManagement.ts. */
  account_type: BankAccountType;
  currency_code: string;
  balance_lcy: Cents;
  bank_acc_posting_group_code: string | null;
  bank_branch_no: string | null;
  bank_sort_code: string | null;
  external_bank_code: string | null;
  iban: string | null;
  swift_code: string | null;
  min_balance: Cents;
  last_statement_no: number;
  balance_last_statement: Cents;
  blocked: Flag;
}

export interface BankAccountListRow extends BankAccount {
  gl_account_code: string;
  gl_account_name: string;
}

export interface BankAccountLedgerEntry {
  id: number;
  bank_account_id: number;
  journal_id: number;
  journal_line_id: number;
  posting_date: IsoDate;
  description: string | null;
  amount: Cents;
  running_balance: Cents;
  amount_lcy: Cents;
  currency_code: string;
  currency_factor: number;
  document_type: string;
  document_no: string | null;
  external_document_no: string | null;
  open: Flag;
  statement_no: string | null;
  statement_line_no: number | null;
  reversed: Flag;
  reconciled: Flag;
  bank_reconciliation_id: number | null;
}

export interface BankAccountLedgerEntryWithJournal extends BankAccountLedgerEntry {
  journal_no: string;
  source_module: string;
}

export interface BankReconciliation {
  id: number;
  bank_account_id: number;
  statement_no: string | null;
  statement_date: IsoDate;
  statement_balance: Cents;
  balance_last_statement: Cents;
  status: 'OPEN' | 'POSTED';
  posted: boolean;
  posted_by: string | null;
  posted_at: IsoDateTime | null;
  journal_id: number | null;
  created_by: string | null;
  created_at: IsoDateTime | null;
  completed_by: string | null;
  completed_at: IsoDateTime | null;
}

export interface BankReconciliationWorksheet {
  reconciliation: BankReconciliation;
  bankAccount: BankAccount;
  entries: BankAccountLedgerEntryWithJournal[];
  clearedTotal: Cents;
  difference: Cents;
}

/** A savings account bucketed by days since its last transaction — the SACCO-realistic
 *  stand-in for Business Central's Vendor Aging Report, which needs invoice due dates that a
 *  member's deposit account has no equivalent of. */
