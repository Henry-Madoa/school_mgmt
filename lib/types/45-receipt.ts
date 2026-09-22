/* Receipt — split out of lib/types.ts; import from '@/lib/types', never from here directly. */
import type { Cents, IsoDate, IsoDateTime, ReceiptLineType, ReceiptStatus } from '../types.ts';

/* --------------------------------------------------------------------- Receipt */

export interface ReceiptHeader {
  id: number;
  no: string;
  receipt_type: ReceiptLineType;
  posting_date: IsoDate;
  bank_account_id: number;
  bank_account_name: string | null;
  pay_mode_code: string | null;
  external_document_no: string | null;
  manual_receipt_no: string | null;
  description: string | null;
  currency_code: string;
  currency_factor: number;
  global_dimension_1_id: number | null;
  global_dimension_2_id: number | null;
  amount: Cents;
  approval_limit: Cents;
  status: ReceiptStatus;
  posted: boolean;
  decision_reason: string | null;
  journal_id: number | null;
  created_at: IsoDateTime | null;
  created_by: string | null;
  posted_at: IsoDateTime | null;
  posted_by: string | null;
  employee_id: number | null;
  /** AL "Received Amount" — what the teller counted, checked against the sum of the lines. */
  received_amount: Cents;
}

export interface ReceiptHeaderView extends ReceiptHeader {
  employee_no: string | null;
  employee_name: string | null;
  bank_account_code: string;
  line_count: number;
  journal_no: string | null;
}

export interface ReceiptLine {
  id: number;
  receipt_header_id: number;
  line_no: number;
  line_type: ReceiptLineType;
  account_no: string | null;
  account_name: string | null;
  description: string | null;
  amount: Cents;
  applies_to_doc_no: string | null;
  global_dimension_1_id: number | null;
  global_dimension_2_id: number | null;
}

export interface ReceiptDetail extends ReceiptHeaderView {
  lines: ReceiptLine[];
}

export interface PostedReceipt {
  id: number;
  no: string;
  receipt_no: string;
  receipt_type: ReceiptLineType;
  bank_account_id: number;
  bank_account_name: string | null;
  pay_mode_code: string | null;
  external_document_no: string | null;
  manual_receipt_no: string | null;
  description: string | null;
  currency_code: string;
  currency_factor: number;
  posting_date: IsoDate;
  amount: Cents;
  journal_id: number | null;
  created_at: IsoDateTime | null;
  created_by: string | null;
  employee_id: number | null;
}

export interface PostedReceiptLine {
  id: number;
  posted_receipt_id: number;
  line_no: number;
  line_type: ReceiptLineType;
  account_no: string | null;
  account_name: string | null;
  description: string | null;
  amount: Cents;
  applies_to_doc_no: string | null;
}
