/* requisitions — split out of lib/types.ts; import from '@/lib/types', never from here directly. */
import type { Cents, DocumentStatus, IsoDate, IsoDateTime, PurchaseDocumentType } from '../types.ts';

/* ------------------------------------------------------- requisitions */

export type RequisitionType = 'Store Requisition' | 'Purchase Requisition';
export type RequisitionLineType = 'Item' | 'G/L Account' | 'Fixed Asset';
/** Enum52203430 "Procurement Methods". */
export type ProcurementMethod = 'RFQ' | 'RFP' | 'Direct Procurement' | 'Restricted Tendering' | 'Open Tendering' | 'Low Value Procurement';
/** Pag52203556 Requisitions Review — what procurement does with an approved purchase requisition line. */
export type RequisitionDecision = '' | 'RFQ' | 'Order' | 'Append to Order';
/** AL "PR Closed By". */
export type RequisitionCloseReason = 'Purchase Order' | 'Direct Receipt of Goods/Services' | 'Rejection';
/** Open | Pending Approval | Approved, plus Received once the store requester confirms receipt. */
export type RequisitionStatus = DocumentStatus | 'Received';

/** AL Tab52203515 "Requisition Header". */
export interface Requisition {
  no: string;
  requisition_type: RequisitionType;
  employee_id: number;
  title: string;
  description: string | null;
  requisition_date: IsoDate;
  needed_by_date: IsoDate | null;
  expiration_date: IsoDate | null;
  requested_delivery_date: IsoDate | null;
  currency_code: string;
  location_id: number | null;
  procurement_method: ProcurementMethod | null;
  supplier_id: number | null;
  status: RequisitionStatus;
  decision_reason: string | null;
  issued: boolean;
  issued_at: IsoDateTime | null;
  issued_by: string | null;
  received: boolean;
  received_at: IsoDateTime | null;
  received_by: string | null;
  pr_closed: boolean;
  pr_closed_by: RequisitionCloseReason | null;
  pr_closed_at: IsoDateTime | null;
  pr_closed_by_user: string | null;
  pr_close_reason: string | null;
  po_generated_directly: boolean;
  po_generated_by: string | null;
  po_generated_at: IsoDateTime | null;
  po_number: string | null;
  global_dimension_1_id: number | null;
  global_dimension_2_id: number | null;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface RequisitionView extends Requisition {
  employee_no: string;
  first_name: string;
  last_name: string;
  job_title: string | null;
  location_code: string | null;
  location_name: string | null;
  supplier_no: string | null;
  supplier_name: string | null;
  /** AL flowfields "Quantity Requested" / Amount, plus the issue and processing progress. */
  total_quantity: number;
  total_quantity_approved: number;
  total_quantity_issued: number;
  total_amount: Cents;
  lines: number;
  lines_processed: number;
}

/** AL Tab52203516 "Requisition Lines". */
export interface RequisitionLine {
  id: number;
  requisition_no: string;
  line_no: number;
  type: RequisitionLineType;
  no: string;
  description: string;
  item_id: number | null;
  gl_account_id: number | null;
  unit_of_measure_id: number | null;
  quantity: number;
  quantity_approved: number;
  unit_price: Cents;
  amount: Cents;
  location_id: number | null;
  quantity_to_issue: number;
  quantity_issued: number;
  issued_at: IsoDateTime | null;
  issued_by: string | null;
  decision: RequisitionDecision;
  target_no: string | null;
  processed: boolean;
  order_no: string | null;
}

export interface RequisitionLineView extends RequisitionLine {
  unit_of_measure_code: string | null;
  location_code: string | null;
  /** AL "Quantity in Store" — on hand at the line's location, in the line's unit. */
  quantity_in_store: number;
  /** For Append to Order / RFQ / Order — the vendor or order the target resolves to. */
  target_name: string | null;
}

export interface RequisitionDetail extends RequisitionView {
  line_items: RequisitionLineView[];
  /** Purchase documents raised from this requisition (purchase_header.requisition_no). */
  documents: { no: string; document_type: PurchaseDocumentType; vendor_no: string; vendor_name: string; status: string; amount: Cents }[];
  /** Store issues posted from this requisition (item_journal_line.requisition_line_id). */
  issues: { no: string; line_no: number; item_no: string; description: string; quantity: number; posting_date: IsoDate; posted_by: string | null; location_code: string }[];
}
