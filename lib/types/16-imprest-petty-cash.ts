/* imprest / petty cash — split out of lib/types.ts; import from '@/lib/types', never from here directly. */
import type { Cents, DocumentStatus, IsoDate, IsoDateTime } from '../types.ts';

/* ------------------------------------------------------ imprest / petty cash */

export type EmployeeLedgerEntryType =
  | 'IMPREST_ISSUE' | 'IMPREST_SURRENDER' | 'IMPREST_REFUND' | 'CLAIM_PAID' | 'PAYROLL_RECOVERY'
  | 'PAYROLL_CLAIM' | 'RECEIPT' | 'PAYMENT' | 'STAFF_CLAIM';

/** The employee subledger — positive means the employee owes the SACCO. */
export interface EmployeeLedgerEntry {
  id: number;
  employee_id: number;
  entry_type: EmployeeLedgerEntryType;
  document_no: string;
  posting_date: IsoDate;
  amount: Cents;
  description: string | null;
  journal_id: number | null;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface EmployeeLedgerEntryView extends EmployeeLedgerEntry {
  employee_no: string;
  first_name: string;
  last_name: string;
  journal_no: string | null;
  running_balance: Cents;
}

export interface ImprestPurpose { code: string; description: string; status: 'ACTIVE' | 'INACTIVE' }

export type ImprestRequestFor = 'Self' | 'Other';
export type ImprestSurrenderStatus = 'Open' | 'Pending Approval' | 'Approved' | 'Closed';
export type ImprestSettlement = 'Receive Now' | 'Deduct from Payroll' | 'Pay Now' | 'Pay from Payroll';

/**
 * Where an imprest stands — the AL keeps Posted / Surrendered / Transfered To Payroll as flags
 * beside two status fields; one word for the list.
 *   Request     the request itself: Open, pending, approved, not yet issued
 *   Issued      money paid out; the employee is in the field, surrender not yet submitted
 *   Surrender   the surrender is in: pending approval, or approved and waiting to be posted
 *   Closed      surrendered and posted (or recovered in full through payroll)
 */
export type ImprestStage = 'Request' | 'Issued' | 'Surrender' | 'Closed';

/** AL Tab52203447 "Request Header" (Imprest / Surrender). */
export interface ImprestRequest {
  no: string;
  employee_id: number;
  request_date: IsoDate;
  purpose_code: string | null;
  purpose: string;
  description: string | null;
  request_for: ImprestRequestFor;
  departure_location: string | null;
  departure_date: IsoDate | null;
  return_date: IsoDate | null;
  total_days: number;
  justification: string | null;
  phone_no: string | null;
  currency_code: string;
  paying_bank_account_id: number | null;
  pay_mode_code: string | null;
  payment_tx_no: string | null;
  cheque_date: IsoDate | null;
  due_date: IsoDate | null;
  status: DocumentStatus;
  decision_reason: string | null;
  posted: boolean;
  posted_at: IsoDateTime | null;
  posted_by: string | null;
  posted_journal_id: number | null;
  pv_no: string | null;
  surrender_status: ImprestSurrenderStatus;
  surrender_date: IsoDate | null;
  surrender_decision_reason: string | null;
  surrendered: boolean;
  surrender_posted_at: IsoDateTime | null;
  surrender_posted_by: string | null;
  surrender_journal_id: number | null;
  settlement: ImprestSettlement | null;
  receiving_bank_account_id: number | null;
  receipt_mode_code: string | null;
  receipt_tx_no: string | null;
  claim_paying_bank_account_id: number | null;
  claim_pay_mode_code: string | null;
  claim_payment_tx_no: string | null;
  transfer_to_payroll: boolean;
  transferred_to_payroll: boolean;
  payroll_transaction_id: number | null;
  payroll_transferred_at: IsoDateTime | null;
  payroll_transferred_by: string | null;
  global_dimension_1_id: number | null;
  global_dimension_2_id: number | null;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface ImprestRequestView extends ImprestRequest {
  employee_no: string;
  first_name: string;
  last_name: string;
  employee_phone: string | null;
  employee_email: string | null;
  job_title: string | null;
  purpose_description: string | null;
  paying_bank_code: string | null;
  paying_bank_name: string | null;
  receiving_bank_code: string | null;
  claim_bank_code: string | null;
  stage: ImprestStage;
  /** FlowFields: Sum of Request Amount / Actual Spent; Net = requested − spent. */
  request_amount: Cents;
  surrender_amount: Cents;
  net_refund: Cents;
  /** The employee's whole subledger balance, not just this imprest. */
  employee_balance: Cents;
  overdue_days: number;
  posted_journal_no: string | null;
  surrender_journal_no: string | null;
  lines: number;
}

/** AL Tab52203449 "Request Lines". */
export interface ImprestRequestLine {
  id: number;
  request_no: string;
  line_no: number;
  gl_account_id: number;
  narration: string | null;
  quantity: number;
  unit_cost: Cents;
  request_amount: Cents;
  actual_spent: Cents;
  surrender_note: string | null;
}

export interface ImprestRequestLineView extends ImprestRequestLine {
  gl_account_code: string;
  gl_account_name: string;
  /** actual − requested: positive is a claim, negative a refund. */
  difference: Cents;
}

export interface ImprestRequestDetail extends ImprestRequestView {
  line_items: ImprestRequestLineView[];
}

/** AL Tab52203444 "Petty Cash Header". */
export interface PettyCash {
  no: string;
  employee_id: number;
  request_date: IsoDate;
  posting_date: IsoDate | null;
  paying_bank_account_id: number | null;
  payment_to: string | null;
  on_behalf_of: string | null;
  payment_narration: string;
  pay_mode_code: string | null;
  payment_tx_no: string | null;
  cheque_date: IsoDate | null;
  currency_code: string;
  status: DocumentStatus;
  decision_reason: string | null;
  posted: boolean;
  posted_at: IsoDateTime | null;
  posted_by: string | null;
  journal_id: number | null;
  paid: boolean;
  paid_at: IsoDateTime | null;
  paid_by: string | null;
  global_dimension_1_id: number | null;
  global_dimension_2_id: number | null;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface PettyCashView extends PettyCash {
  employee_no: string;
  first_name: string;
  last_name: string;
  job_title: string | null;
  paying_bank_code: string | null;
  paying_bank_name: string | null;
  total_amount: Cents;
  journal_no: string | null;
  lines: number;
}

export interface PettyCashLine {
  id: number;
  petty_cash_no: string;
  line_no: number;
  gl_account_id: number;
  description: string | null;
  amount: Cents;
}

export interface PettyCashLineView extends PettyCashLine {
  gl_account_code: string;
  gl_account_name: string;
}

export interface PettyCashDetail extends PettyCashView {
  line_items: PettyCashLineView[];
}

export type StaffClaimSettlement = 'Pay Now' | 'Pay from Payroll';

/** AL Tab52203447 "Request Header" with Request Type Staff Claim. */
export interface StaffClaim {
  no: string;
  employee_id: number;
  claim_date: IsoDate;
  description: string;
  justification: string | null;
  currency_code: string;
  settlement: StaffClaimSettlement;
  paying_bank_account_id: number | null;
  pay_mode_code: string | null;
  payment_tx_no: string | null;
  status: DocumentStatus;
  decision_reason: string | null;
  posted: boolean;
  posted_at: IsoDateTime | null;
  posted_by: string | null;
  journal_id: number | null;
  payment_stopped: boolean;
  stopped_at: IsoDateTime | null;
  stopped_by: string | null;
  stop_reason: string | null;
  transferred_to_payroll: boolean;
  payroll_transaction_id: number | null;
  global_dimension_1_id: number | null;
  global_dimension_2_id: number | null;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface StaffClaimView extends StaffClaim {
  employee_no: string;
  first_name: string;
  last_name: string;
  job_title: string | null;
  paying_bank_code: string | null;
  paying_bank_name: string | null;
  total_amount: Cents;
  journal_no: string | null;
  lines: number;
}

export interface StaffClaimLine {
  id: number;
  claim_no: string;
  line_no: number;
  gl_account_id: number;
  narration: string | null;
  expense_date: IsoDate | null;
  receipt_ref: string | null;
  quantity: number;
  unit_cost: Cents;
  amount: Cents;
}

export interface StaffClaimLineView extends StaffClaimLine {
  gl_account_code: string;
  gl_account_name: string;
}

export interface StaffClaimDetail extends StaffClaimView {
  line_items: StaffClaimLineView[];
}
