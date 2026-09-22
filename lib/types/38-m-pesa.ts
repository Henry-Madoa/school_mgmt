/* M-Pesa — split out of lib/types.ts; import from '@/lib/types', never from here directly. */
import type { Cents, IsoDateTime } from '../types.ts';

/* ---------------------------------------------------------------- M-Pesa */

export type MpesaKind = 'STK' | 'C2B';
/**
 * PENDING   an STK push awaiting the customer / callback
 * RECEIVED  money confirmed by Safaricom but not yet matched to a student fee account
 * POSTED    matched and posted to the ledger
 * FAILED    the customer declined, timed out, or Safaricom reported an error
 * CANCELLED written off by hand (a duplicate, a refund handled elsewhere)
 */
export type MpesaStatus = 'PENDING' | 'RECEIVED' | 'POSTED' | 'FAILED' | 'CANCELLED';

export interface MpesaTransaction {
  id: number;
  kind: MpesaKind;
  status: MpesaStatus;
  phone: string | null;
  payer_name: string | null;
  amount: Cents;
  /** What the payer typed as the account number (C2B BillRefNumber) or what we sent (STK). */
  account_reference: string | null;
  description: string | null;
  mpesa_receipt: string | null;
  transaction_time: string | null;
  merchant_request_id: string | null;
  checkout_request_id: string | null;
  result_code: string | null;
  result_desc: string | null;
  raw_payload: string | null;
  student_id: number | null;
  customer_id: number | null;
  /** The posted receipt (receipt_header.no) that put the money on the fee account. */
  receipt_no: string | null;
  match_note: string | null;
  journal_id: number | null;
  posted_at: IsoDateTime | null;
  posted_by: string | null;
  created_at: IsoDateTime;
  created_by: string | null;
}

export interface MpesaTransactionView extends MpesaTransaction {
  admission_no: string | null;
  student_name: string | null;
  grade_level_name: string | null;
  customer_no: string | null;
  journal_no: string | null;
}
