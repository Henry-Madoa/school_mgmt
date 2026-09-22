/* Payment Voucher — split out of lib/types.ts; import from '@/lib/types', never from here directly. */
import type { Cents, IsoDate, IsoDateTime, PaymentVoucherLineType, PaymentVoucherType, ReceiptStatus} from '../types.ts';

/* --------------------------------------------------------------- Payment Voucher */

export interface PaymentVoucherHeader {
  id: number;
  no: string;
  date: IsoDate;
  pv_type: PaymentVoucherType | null;
  pay_mode_code: string | null;
  cheque_no: string | null;
  cheque_date: IsoDate | null;
  cheque_received_by: string | null;
  paying_bank_account_id: number;
  currency_code: string;
  currency_factor: number;
  description: string | null;
  payee_name: string | null;
  payee_external_bank_code: string | null;
  payee_bank_branch_code: string | null;
  payee_account_no: string | null;
  global_dimension_1_id: number | null;
  global_dimension_2_id: number | null;
  total_amount: Cents;
  approval_limit: Cents;
  status: ReceiptStatus;
  posted: boolean;
  decision_reason: string | null;
  prepared_by: string | null;
  journal_id: number | null;
  created_at: IsoDateTime | null;
  created_by: string | null;
  posted_at: IsoDateTime | null;
  posted_by: string | null;
  employee_id: number | null;
}

export interface PaymentVoucherHeaderView extends PaymentVoucherHeader {
  paying_bank_account_code: string;
  employee_no: string | null;
  employee_name: string | null;
  line_count: number;
  journal_no: string | null;
}

export interface PaymentVoucherLine {
  id: number;
  payment_voucher_header_id: number;
  line_no: number;
  line_type: PaymentVoucherLineType;
  account_no: string | null;
  account_name: string | null;
  description: string | null;
  amount: Cents;
  applies_to_doc_no: string | null;
  vat_prod_posting_group_code: string | null;
  wht_code_one: string | null;
  wht_code_two: string | null;
  vat_amount: Cents;
  wht_amount_one: Cents;
  wht_amount_two: Cents;
  wht_base: Cents;
  net_amount: Cents;
  purchase_invoice_amount: Cents;
  global_dimension_1_id: number | null;
  global_dimension_2_id: number | null;
}

export interface PaymentVoucherDetail extends PaymentVoucherHeaderView {
  lines: PaymentVoucherLine[];
}

export interface PostedPaymentVoucher {
  id: number;
  no: string;
  pv_no: string;
  date: IsoDate;
  pay_mode_code: string | null;
  cheque_no: string | null;
  cheque_date: IsoDate | null;
  cheque_received_by: string | null;
  paying_bank_account_id: number;
  currency_code: string;
  currency_factor: number;
  description: string | null;
  payee_name: string | null;
  payee_external_bank_code: string | null;
  payee_bank_branch_code: string | null;
  payee_account_no: string | null;
  posting_date: IsoDate;
  total_amount: Cents;
  journal_id: number | null;
  prepared_by: string | null;
  approved_by: string | null;
  created_at: IsoDateTime | null;
  created_by: string | null;
  /** The Payment Type the voucher was raised under — the printout varies by it. */
  pv_type: PaymentVoucherType | null;
  employee_id: number | null;
}

export interface PostedPaymentVoucherLine {
  id: number;
  posted_payment_voucher_id: number;
  line_no: number;
  line_type: PaymentVoucherLineType;
  account_no: string | null;
  account_name: string | null;
  description: string | null;
  amount: Cents;
  applies_to_doc_no: string | null;
  vat_prod_posting_group_code: string | null;
  wht_code_one: string | null;
  wht_code_two: string | null;
  vat_amount: Cents;
  wht_amount_one: Cents;
  wht_amount_two: Cents;
  wht_base: Cents;
  net_amount: Cents;
}
