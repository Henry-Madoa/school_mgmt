/* inventory — split out of lib/types.ts; import from '@/lib/types', never from here directly. */
import type { BankAccount, BankAccountLedgerEntryWithJournal, BankReconciliation, Cents, DocumentStatus, Flag, IsoDate, IsoDateTime } from '../types.ts';

/* ------------------------------------------------------------------ inventory */

/** Business Central Table 14, trimmed. Every stock movement happens at one of these. */
export interface Location {
  id: number;
  code: string;
  name: string;
  address: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  created_at: IsoDateTime | null;
  created_by: string | null;
}

/** Business Central Table 204. */
export interface UnitOfMeasure {
  id: number;
  code: string;
  description: string;
  symbol: string | null;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

/** Business Central's Inventory Posting Group — the ledger side of an Item's ledger-subledger
 *  mapping: which G/L account carries this item family's stock value. */
export interface InventoryPostingGroup {
  id: number;
  code: string;
  description: string;
  inventory_gl_account_id: number;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface InventoryPostingGroupView extends InventoryPostingGroup {
  inventory_gl_account_code: string;
  inventory_gl_account_name: string;
  /** Items currently referencing this group — guards deletion. */
  items_using: number;
}

/** Business Central's Gen. Prod. Posting Group — the subledger side of an Item's ledger-subledger
 *  mapping: which P&L account a Positive/Negative Adjmt. offsets against. */
export interface ProductPostingGroup {
  id: number;
  code: string;
  description: string;
  adjustment_gl_account_id: number;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface ProductPostingGroupView extends ProductPostingGroup {
  adjustment_gl_account_code: string;
  adjustment_gl_account_name: string;
  items_using: number;
}

/** Business Central's own five Costing Methods. */
export type ItemCostingMethod = 'FIFO' | 'LIFO' | 'Average' | 'Standard' | 'Specific';

/** The two simplest Business Central Reordering Policies — see calculateReplenishment() in
 *  lib/itemJournal.ts. */
export type ItemReorderingPolicy = 'Fixed Reorder Qty.' | 'Maximum Qty.';

/** Business Central Table 27 "Item", trimmed — see prisma/schema.prisma's model comment for
 *  exactly what was left out and why. */
export interface Item {
  id: number;
  no: string;
  description: string;
  description_2: string | null;
  base_unit_of_measure_id: number;
  purch_unit_of_measure_id: number | null;
  sales_unit_of_measure_id: number | null;
  inventory_posting_group_id: number;
  product_posting_group_id: number;
  costing_method: ItemCostingMethod;
  unit_cost: Cents;
  unit_price: Cents;
  /** Maintained roll-up of this item's stockkeeping_unit rows, across every location. */
  inventory: number;
  reordering_policy: ItemReorderingPolicy;
  reorder_point: number;
  reorder_quantity: number;
  maximum_inventory: number;
  status: 'ACTIVE' | 'BLOCKED';
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface ItemListRow extends Item {
  base_unit_of_measure_code: string;
  purch_unit_of_measure_code: string | null;
  sales_unit_of_measure_code: string | null;
  inventory_posting_group_code: string;
  product_posting_group_code: string;
  below_reorder_point: boolean;
}

/** Business Central Table 5404. `qty_per_unit_of_measure` always converts to the item's own
 *  Base UoM — never UoM-to-UoM. See lib/unitOfMeasureConversion.ts. */
export interface ItemUnitOfMeasure {
  id: number;
  item_id: number;
  unit_of_measure_id: number;
  qty_per_unit_of_measure: number;
}

export interface ItemUnitOfMeasureView extends ItemUnitOfMeasure {
  unit_of_measure_code: string;
  unit_of_measure_description: string;
}

/** Business Central Table 5700 "Stockkeeping Unit" — one item's qty-on-hand at one location,
 *  with an optional per-location override of the item's own reordering defaults. */
export interface StockkeepingUnit {
  id: number;
  item_id: number;
  location_id: number;
  reordering_policy: ItemReorderingPolicy | null;
  reorder_point: number | null;
  reorder_quantity: number | null;
  maximum_inventory: number | null;
  inventory: number;
}

export interface StockByLocationRow extends StockkeepingUnit {
  location_code: string;
  location_name: string;
  /** This row's own override where set, else the item's own default. */
  effective_reordering_policy: ItemReorderingPolicy;
  effective_reorder_point: number;
  effective_reorder_quantity: number;
  effective_maximum_inventory: number;
}

/** One row of the "Item Quantities per Location" report — every item+location combination that
 *  has ever had a movement, with its current qty-on-hand and cost value. */
export interface ItemQuantityByLocationRow {
  item_id: number;
  item_no: string;
  item_description: string;
  base_unit_of_measure_code: string;
  location_id: number;
  location_code: string;
  location_name: string;
  inventory: number;
  unit_cost: Cents;
  /** inventory * unit_cost, at the item's current (not historical per-lot) unit cost. */
  value: Cents;
  below_reorder_point: boolean;
}

/** Business Central's own two entry types this module posts — see prisma/schema.prisma. */
export type ItemJournalEntryType = 'Positive Adjmt.' | 'Negative Adjmt.';

/** Business Central Table 83 "Item Journal Line", scoped to Positive/Negative Adjmt. only.
 *  Lifecycle Open -> Pending Approval -> Approved -> Processed. */
export interface ItemJournalLine {
  id: number;
  no: string;
  posting_date: IsoDate;
  entry_type: ItemJournalEntryType;
  item_id: number;
  location_id: number;
  description: string | null;
  unit_of_measure_id: number;
  qty_per_unit_of_measure: number;
  quantity: number;
  base_quantity: number;
  applies_to_entry_id: number | null;
  unit_cost: Cents;
  amount: Cents;
  status: DocumentStatus;
  decision_reason: string | null;
  posted: boolean;
  journal_id: number | null;
  /** The store requisition line this Negative Adjmt. issued, if any. */
  requisition_line_id: number | null;
  global_dimension_1_id: number | null;
  global_dimension_2_id: number | null;
  created_at: IsoDateTime | null;
  created_by: string | null;
  posted_at: IsoDateTime | null;
  posted_by: string | null;
}

export interface ItemJournalLineView extends ItemJournalLine {
  item_no: string;
  item_description: string;
  item_costing_method: ItemCostingMethod;
  location_code: string;
  unit_of_measure_code: string;
  journal_no: string | null;
  /** Open quantity (in the item's Base UoM) at this item+location — what a Negative Adjmt. may
   *  not exceed. */
  available_quantity: number;
}

/** Business Central Table 32 "Item Ledger Entry" — the posted, immutable stock movement. An
 *  inbound (Positive Adjmt.) entry is a costed lot; `remaining_quantity`/`open` track how much of
 *  it is still unconsumed by an outbound application. */
export interface ItemLedgerEntry {
  id: number;
  item_id: number;
  location_id: number;
  posting_date: IsoDate;
  entry_type: ItemJournalEntryType;
  document_no: string;
  quantity: number;
  remaining_quantity: number;
  open: boolean;
  unit_cost: Cents;
  amount: Cents;
  item_journal_line_id: number;
  created_at: IsoDateTime | null;
}

export interface ItemLedgerEntryView extends ItemLedgerEntry {
  item_no: string;
  item_description: string;
  location_code: string;
}

/** Business Central Table 339 "Item Application Entry" — which inbound lot an outbound entry
 *  consumed, and how much of it. Written for FIFO/LIFO/Average/Specific; Standard writes none. */
export interface ItemApplicationEntry {
  id: number;
  outbound_entry_id: number;
  inbound_entry_id: number;
  quantity: number;
  posting_date: IsoDate;
  created_at: IsoDateTime | null;
}

export interface ItemApplicationEntryView extends ItemApplicationEntry {
  inbound_document_no: string;
  inbound_unit_cost: Cents;
}

/** One row of calculateReplenishment()'s computed report — an item+location at or below its
 *  Reorder Point, with the quantity its Reordering Policy suggests raising. Nothing persists
 *  until "Create adjustment" turns it into a real Item Journal Line. */
export interface ReplenishmentSuggestion {
  item_id: number;
  item_no: string;
  item_description: string;
  location_id: number;
  location_code: string;
  reordering_policy: ItemReorderingPolicy;
  inventory: number;
  reorder_point: number;
  reorder_quantity: number;
  maximum_inventory: number;
  suggested_quantity: number;
}
/* ============================================================================================
 * Fixed Assets — Business Central FA subledger (Tables 5600/5601/5603/5606/5611/5612/5616/5628/
 * 5629/5643). See lib/fixedAssets.ts, lib/faJournal.ts, lib/fixedAssetDepreciation.ts.
 * ========================================================================================== */

export type FaDepreciationMethod = 'Straight-Line' | 'Declining-Balance 1' | 'DB1/SL' | 'Manual';
export type FaPostingType =
  | 'Acquisition Cost' | 'Depreciation' | 'Write-Down' | 'Appreciation' | 'Disposal' | 'Maintenance';
export type FaJournalStatus = 'Open' | 'Pending Approval' | 'Approved' | 'Processed';
export type FaJournalSource = 'MANUAL' | 'CALCULATE_DEPRECIATION';
export type FaDisposalCalcMethod = 'Net' | 'Gross';

export interface FaClass {
  id: number;
  code: string;
  description: string;
  status: 'ACTIVE' | 'INACTIVE';
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface FaSubclass {
  id: number;
  code: string;
  description: string;
  fa_class_code: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface FaLocation {
  id: number;
  code: string;
  description: string;
  status: 'ACTIVE' | 'INACTIVE';
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface Maintenance {
  id: number;
  code: string;
  description: string;
  status: 'ACTIVE' | 'INACTIVE';
  created_at: IsoDateTime | null;
  created_by: string | null;
}

/** Business Central Table 5611 "Depreciation Book". This port always integrates to the G/L. */
export interface DepreciationBook {
  id: number;
  code: string;
  description: string;
  g_l_integration: Flag;
  default_final_rounding_amount: Cents;
  use_rounding_in_periodic_depr: Flag;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

/** Business Central Table 5606 "FA Posting Group" — the eight G/L accounts every FA posting
 *  resolves its debit and credit from. */
export interface FaPostingGroup {
  id: number;
  code: string;
  description: string;
  acquisition_cost_account_id: number;
  accum_depreciation_account_id: number;
  depreciation_expense_account_id: number;
  write_down_expense_account_id: number;
  appreciation_account_id: number;
  maintenance_expense_account_id: number;
  gains_acc_on_disposal_id: number;
  losses_acc_on_disposal_id: number;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface FaPostingGroupView extends FaPostingGroup {
  acquisition_cost_account_code: string;
  accum_depreciation_account_code: string;
  depreciation_expense_account_code: string;
  write_down_expense_account_code: string;
  appreciation_account_code: string;
  maintenance_expense_account_code: string;
  gains_acc_on_disposal_code: string;
  losses_acc_on_disposal_code: string;
  assets_using: number;
}

/** Business Central Table 5603 "FA Setup" — singleton. */
export interface FaSetup {
  id: number;
  default_depreciation_book_code: string | null;
  default_fa_posting_group_code: string | null;
  allow_fa_posting_from: IsoDate | null;
  allow_fa_posting_to: IsoDate | null;
  updated_at: IsoDateTime | null;
  updated_by: string | null;
}

/** Business Central Table 5600 "Fixed Asset". */
export interface FixedAsset {
  id: number;
  no: string;
  description: string;
  description_2: string | null;
  fa_class_code: string | null;
  fa_subclass_code: string | null;
  fa_location_code: string | null;
  responsible_employee: string | null;
  serial_no: string | null;
  vendor_name: string | null;
  asset_tag: string | null;
  global_dimension_1_id: number | null;
  global_dimension_2_id: number | null;
  blocked: Flag;
  inactive: Flag;
  acquisition_date: IsoDate | null;
  disposal_date: IsoDate | null;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface FixedAssetListRow extends FixedAsset {
  fa_class_description: string | null;
  fa_subclass_description: string | null;
  fa_location_description: string | null;
  /** Roll-ups for the default depreciation book, when the asset has a book row. */
  depreciation_book_code: string | null;
  depreciation_method: FaDepreciationMethod | null;
  acquisition_cost: Cents;
  accumulated_depreciation: Cents;
  book_value: Cents;
  disposed: boolean;
}

/** Business Central Table 5612 "FA Depreciation Book" — one row per asset + book. */
export interface FaDepreciationBook {
  id: number;
  fixed_asset_id: number;
  depreciation_book_code: string;
  fa_posting_group_code: string;
  depreciation_method: FaDepreciationMethod;
  depreciation_starting_date: IsoDate | null;
  depreciation_ending_date: IsoDate | null;
  no_of_depreciation_years: number | null;
  straight_line_pct: number;
  declining_balance_pct: number;
  fixed_depr_amount: Cents;
  salvage_value: Cents;
  last_depreciation_date: IsoDate | null;
  disposal_calculation_method: FaDisposalCalcMethod;
  acquisition_cost: Cents;
  accumulated_depreciation: Cents;
  write_down_amount: Cents;
  appreciation_amount: Cents;
  book_value: Cents;
  proceeds_on_disposal: Cents;
  gain_loss_on_disposal: Cents;
  maintenance_total: Cents;
  disposed: Flag;
}

export interface FaDepreciationBookView extends FaDepreciationBook {
  fixed_asset_no: string;
  fixed_asset_description: string;
  fa_posting_group_description: string;
}

/** The FA Journal — a maker-checker document, same lifecycle shape as ItemJournalLine. */
export interface FaJournalLine {
  id: number;
  no: string;
  posting_date: IsoDate;
  document_no: string | null;
  fixed_asset_id: number;
  depreciation_book_code: string;
  fa_posting_type: FaPostingType;
  amount: Cents;
  balancing_gl_account_id: number | null;
  maintenance_code: string | null;
  depr_until_fa_posting_date: Flag;
  no_of_depreciation_days: number | null;
  description: string | null;
  source: FaJournalSource;
  status: FaJournalStatus;
  decision_reason: string | null;
  posted: boolean;
  journal_id: number | null;
  created_at: IsoDateTime | null;
  created_by: string | null;
  posted_at: IsoDateTime | null;
  posted_by: string | null;
}

export interface FaJournalLineView extends FaJournalLine {
  fixed_asset_no: string;
  fixed_asset_description: string;
  balancing_gl_account_code: string | null;
  balancing_gl_account_name: string | null;
  journal_no: string | null;
  book_value: Cents;
  disposed: boolean;
}

/** Business Central Table 5601 "FA Ledger Entry" — the posted, immutable FA movement. */
export interface FaLedgerEntry {
  id: number;
  fixed_asset_id: number;
  depreciation_book_code: string;
  fa_posting_date: IsoDate;
  fa_posting_type: FaPostingType;
  document_no: string;
  description: string | null;
  amount: Cents;
  no_of_depreciation_days: number | null;
  journal_id: number | null;
  fa_journal_line_id: number | null;
  part_of_book_value: Flag;
  maintenance_code: string | null;
  reversed: Flag;
  created_at: IsoDateTime | null;
}

export interface FaLedgerEntryView extends FaLedgerEntry {
  fixed_asset_no: string;
  fixed_asset_description: string;
}

/** One line of calculateDepreciation()'s batch summary. */
export interface FaDepreciationSuggestion {
  fixed_asset_id: number;
  fixed_asset_no: string;
  fixed_asset_description: string;
  amount: Cents;
  days: number;
  new_book_value: Cents;
  no: string;
}

/** One row of the FA Book Value report — computed live from fa_ledger_entry. */
export interface FaBookValueRow {
  fixed_asset_id: number;
  fixed_asset_no: string;
  fixed_asset_description: string;
  fa_class_code: string | null;
  acquisition_cost: Cents;
  depreciation: Cents;
  write_down: Cents;
  appreciation: Cents;
  book_value: Cents;
  disposed: boolean;
}

export interface FaBookValueReport {
  book_code: string;
  as_of: IsoDate;
  rows: FaBookValueRow[];
  totals: {
    acquisition_cost: Cents;
    depreciation: Cents;
    write_down: Cents;
    appreciation: Cents;
    book_value: Cents;
  };
}
/* ============================================================================================
 * Receivables — Business Central Sales & Receivables (Tables 3/5/18/21/36/37/92/110-115/289/
 * 293-296/302-305/311/379). See lib/customers.ts, lib/salesDocuments.ts, lib/custLedger.ts,
 * lib/cashReceipts.ts, lib/reminders.ts, lib/receivablesReports.ts.
 * ========================================================================================== */

export type CustomerBlocked = '' | 'Ship' | 'Invoice' | 'All';
export type PaymentMethodBalAccountType = 'None' | 'G/L Account' | 'Bank Account';
export type SalesDocumentType = 'Quote' | 'Order' | 'Invoice' | 'Credit Memo';
export type SalesLineType = 'Comment' | 'G/L Account' | 'Item' | 'Fixed Asset';
export type SalesDocumentStatus = 'Open' | 'Pending Approval' | 'Released';
export type PostedSalesDocumentType = 'Shipment' | 'Invoice' | 'Credit Memo';
export type CustLedgerDocumentType =
  | 'Invoice' | 'Payment' | 'Credit Memo' | 'Reminder' | 'Finance Charge Memo' | 'Refund';
export type DetailedCustLedgerEntryType =
  | 'Initial Entry' | 'Application' | 'Payment Discount' | 'Correction' | 'Unapplied'
  | 'Realized Gain' | 'Realized Loss' | 'Unrealized Gain' | 'Unrealized Loss';
export type ReminderDocumentType = 'Reminder' | 'Finance Charge Memo';
export type ReminderStatus = 'Open' | 'Issued';
export type ReminderLineType = '' | 'Reminder Line' | 'G/L Account' | 'Line Fee';
export type CreditWarnings = 'Both' | 'Credit Limit' | 'Overdue Balance' | 'No Warning';
export type FinChargeInterestMethod = 'Average Daily Balance' | 'Balance Due';

export interface CustomerPostingGroup {
  id: number;
  code: string;
  description: string;
  receivables_account_id: number;
  service_charge_account_id: number;
  additional_fee_account_id: number;
  payment_disc_debit_account_id: number;
  payment_disc_credit_account_id: number;
  invoice_rounding_account_id: number;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface CustomerPostingGroupView extends CustomerPostingGroup {
  receivables_account_code: string;
  service_charge_account_code: string;
  additional_fee_account_code: string;
  payment_disc_debit_account_code: string;
  payment_disc_credit_account_code: string;
  invoice_rounding_account_code: string;
  customers_using: number;
}

export interface PaymentTerms {
  id: number;
  code: string;
  description: string;
  due_date_calculation: string;
  discount_date_calculation: string;
  discount_pct: number;
  calc_pmt_disc_on_credit_memos: Flag;
  status: 'ACTIVE' | 'INACTIVE';
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface PaymentMethod {
  id: number;
  code: string;
  description: string;
  bal_account_type: PaymentMethodBalAccountType;
  bal_account_no: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface ReminderTerms {
  id: number;
  code: string;
  description: string;
  max_no_of_reminders: number;
  post_interest: Flag;
  post_additional_fee: Flag;
  min_amount: Cents;
  dont_remind_on_hold: Flag;
  status: 'ACTIVE' | 'INACTIVE';
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface ReminderLevel {
  id: number;
  reminder_terms_code: string;
  level_no: number;
  grace_period: string;
  due_date_calculation: string;
  calculate_interest: Flag;
  additional_fee: Cents;
  add_fee_per_line: Cents;
  begin_text: string | null;
  end_text: string | null;
}

export interface FinanceChargeTerms {
  id: number;
  code: string;
  description: string;
  interest_rate: number;
  min_amount: Cents;
  additional_fee: Cents;
  grace_period: string;
  due_date_calculation: string;
  interest_period_days: number;
  interest_calculation_method: FinChargeInterestMethod;
  post_interest: Flag;
  post_additional_fee: Flag;
  line_description: string;
  begin_text: string | null;
  end_text: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface SalesReceivablesSetup {
  id: number;
  default_customer_posting_group_code: string | null;
  default_payment_terms_code: string | null;
  default_reminder_terms_code: string | null;
  default_fin_charge_terms_code: string | null;
  stockout_warning: Flag;
  credit_warnings: CreditWarnings;
  invoice_rounding: Flag;
  invoice_rounding_precision: Cents;
  allow_receivables_posting_from: IsoDate | null;
  allow_receivables_posting_to: IsoDate | null;
  updated_at: IsoDateTime | null;
  updated_by: string | null;
}

/** Business Central Table 18 "Customer". */
export interface Customer {
  id: number;
  no: string;
  name: string;
  name_2: string | null;
  address: string | null;
  address_2: string | null;
  city: string | null;
  post_code: string | null;
  country: string | null;
  contact: string | null;
  phone: string | null;
  email: string | null;
  customer_posting_group_code: string | null;
  payment_terms_code: string | null;
  payment_method_code: string | null;
  reminder_terms_code: string | null;
  fin_charge_terms_code: string | null;
  salesperson: string | null;
  currency_code: string | null;
  credit_limit: Cents;
  blocked: CustomerBlocked;
  global_dimension_1_id: number | null;
  global_dimension_2_id: number | null;
  balance: Cents;
  last_statement_no: number;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface CustomerListRow extends Customer {
  customer_posting_group_description: string | null;
  payment_terms_description: string | null;
  balance_due: Cents;
  credit_limit_exceeded: boolean;
}

export interface CustomerStatistics {
  balance: Cents;
  balance_due: Cents;
  outstanding_orders: Cents;
  overdue_entries: number;
  ledger_entry_count: number;
  credit_limit: Cents;
}

/** Business Central Table 36 "Sales Header". */
export interface SalesHeader {
  id: number;
  document_type: SalesDocumentType;
  no: string;
  customer_id: number;
  sell_to_name: string | null;
  sell_to_address: string | null;
  sell_to_city: string | null;
  sell_to_contact: string | null;
  posting_date: IsoDate;
  document_date: IsoDate;
  due_date: IsoDate | null;
  payment_terms_code: string | null;
  payment_method_code: string | null;
  customer_posting_group_code: string | null;
  your_reference: string | null;
  /** The posted invoice a corrective Credit Memo is raised against (BC Applies-to Doc. No.). */
  applies_to_doc_no: string | null;
  salesperson: string | null;
  currency_code: string;
  currency_factor: number;
  global_dimension_1_id: number | null;
  global_dimension_2_id: number | null;
  status: SalesDocumentStatus;
  amount: Cents;
  decision_reason: string | null;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface SalesHeaderView extends SalesHeader {
  customer_no: string;
  customer_name: string;
  customer_blocked: CustomerBlocked;
}

/** Business Central Table 37 "Sales Line". */
export interface SalesLine {
  id: number;
  sales_header_id: number;
  line_no: number;
  type: SalesLineType;
  no: string | null;
  description: string | null;
  quantity: number;
  unit_price: Cents;
  line_discount_pct: number;
  line_discount_amount: Cents;
  line_amount: Cents;
  qty_to_ship: number;
  qty_shipped: number;
  qty_to_invoice: number;
  qty_invoiced: number;
  location_code: string | null;
  fa_depreciation_book_code: string | null;
  depr_until_date: IsoDate | null;
  global_dimension_1_id: number | null;
  global_dimension_2_id: number | null;
}

export interface SalesDocumentDetail extends SalesHeaderView {
  lines: SalesLine[];
  outstanding_amount: Cents;
  shipped_not_invoiced: Cents;
}

export interface PostedSalesDocument {
  id: number;
  document_type: PostedSalesDocumentType;
  no: string;
  customer_id: number;
  sell_to_name: string | null;
  sell_to_address: string | null;
  sell_to_city: string | null;
  sell_to_contact: string | null;
  posting_date: IsoDate;
  document_date: IsoDate;
  due_date: IsoDate | null;
  order_no: string | null;
  /** The open document this was posted from — what its approval trail is recorded against. */
  source_no: string | null;
  payment_terms_code: string | null;
  your_reference: string | null;
  /** The invoice a posted Credit Memo corrected. */
  applies_to_doc_no: string | null;
  currency_code: string;
  currency_factor: number;
  amount: Cents;
  cust_ledger_entry_id: number | null;
  journal_id: number | null;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface PostedSalesDocumentView extends PostedSalesDocument {
  customer_no: string;
  customer_name: string;
}

export interface PostedSalesLine {
  id: number;
  posted_sales_document_id: number;
  line_no: number;
  type: SalesLineType;
  no: string | null;
  description: string | null;
  quantity: number;
  unit_price: Cents;
  line_discount_amount: Cents;
  line_amount: Cents;
  cogs_amount: Cents;
  item_ledger_entry_id: number | null;
  fa_ledger_entry_id: number | null;
}

/** Business Central Table 21 "Cust. Ledger Entry". */
export interface CustLedgerEntry {
  id: number;
  customer_id: number;
  posting_date: IsoDate;
  document_type: CustLedgerDocumentType;
  document_no: string;
  description: string | null;
  amount: Cents;
  remaining_amount: Cents;
  original_amount: Cents;
  amount_lcy: Cents;
  remaining_amount_lcy: Cents;
  original_amount_lcy: Cents;
  currency_code: string;
  currency_factor: number;
  due_date: IsoDate | null;
  pmt_discount_date: IsoDate | null;
  original_pmt_disc_possible: Cents;
  open: Flag;
  positive: Flag;
  closed_by_entry_no: number | null;
  closed_at_date: IsoDate | null;
  reminder_level: number;
  calculate_interest: Flag;
  source_type: string | null;
  source_id: number | null;
  journal_id: number | null;
  created_at: IsoDateTime | null;
}

export interface CustLedgerEntryView extends CustLedgerEntry {
  customer_no: string;
  customer_name: string;
}

export interface DetailedCustLedgerEntry {
  id: number;
  cust_ledger_entry_id: number;
  entry_type: DetailedCustLedgerEntryType;
  posting_date: IsoDate;
  document_type: string | null;
  document_no: string | null;
  amount: Cents;
  amount_lcy: Cents;
  applied_cust_ledger_entry_id: number | null;
  journal_id: number | null;
  unapplied: Flag;
  unapplied_by_entry_id: number | null;
  created_at: IsoDateTime | null;
}

export interface ReminderHeader {
  id: number;
  document_type: ReminderDocumentType;
  no: string;
  customer_id: number;
  posting_date: IsoDate;
  document_date: IsoDate;
  due_date: IsoDate | null;
  reminder_terms_code: string | null;
  fin_charge_terms_code: string | null;
  reminder_level: number;
  customer_posting_group_code: string | null;
  use_header_level: Flag;
  status: ReminderStatus;
  remaining_amount: Cents;
  interest_amount: Cents;
  additional_fee: Cents;
  total_amount: Cents;
  decision_reason: string | null;
  journal_id: number | null;
  cust_ledger_entry_id: number | null;
  issued_at: IsoDateTime | null;
  issued_by: string | null;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface ReminderHeaderView extends ReminderHeader {
  customer_no: string;
  customer_name: string;
}

export interface ReminderLine {
  id: number;
  reminder_header_id: number;
  line_no: number;
  type: ReminderLineType;
  cust_ledger_entry_id: number | null;
  entry_document_type: string | null;
  entry_document_no: string | null;
  due_date: IsoDate | null;
  original_amount: Cents;
  remaining_amount: Cents;
  no: string | null;
  amount: Cents;
  description: string | null;
  line_type: '' | 'Not Due' | 'On Hold';
}

export interface ReminderDetail extends ReminderHeaderView {
  lines: ReminderLine[];
}

/** One row of the Aged Accounts Receivable report (BC Report 120). */
export interface AgedReceivableRow {
  customer_id: number;
  customer_no: string;
  customer_name: string;
  balance: Cents;
  not_due: Cents;
  bucket_1: Cents;
  bucket_2: Cents;
  bucket_3: Cents;
  bucket_over: Cents;
}

export interface AgedReceivableReport {
  as_of: IsoDate;
  aging_by: 'Due Date' | 'Posting Date';
  period_length: string;
  bucket_labels: [string, string, string, string, string];
  rows: AgedReceivableRow[];
  totals: Omit<AgedReceivableRow, 'customer_id' | 'customer_no' | 'customer_name'>;
}

/** One row of the Customer Statement (BC Report 116). */
export interface CustomerStatementLine {
  posting_date: IsoDate;
  document_type: CustLedgerDocumentType;
  document_no: string;
  description: string | null;
  due_date: IsoDate | null;
  amount: Cents;
  remaining_amount: Cents;
  running_balance: Cents;
}

export interface CustomerStatementReport {
  customer_no: string;
  customer_name: string;
  from: IsoDate;
  to: IsoDate;
  opening_balance: Cents;
  closing_balance: Cents;
  lines: CustomerStatementLine[];
}

/* ============================================================================================
 * Payables — Business Central Purchases & Payables (Tables 23/25/38/39/93/120/122/124/312/380).
 * The mirror image of Receivables. See lib/vendors.ts, lib/purchaseDocuments.ts,
 * lib/vendLedger.ts, lib/paymentJournal.ts, lib/payablesReports.ts.
 * ========================================================================================== */

export type VendorBlocked = '' | 'Payment' | 'Invoice' | 'All';
export type PurchaseDocumentType = 'Quote' | 'Order' | 'Invoice' | 'Credit Memo';
export type PurchaseLineType = 'Comment' | 'G/L Account' | 'Item' | 'Fixed Asset';
export type PurchaseDocumentStatus = 'Open' | 'Pending Approval' | 'Released';
export type PostedPurchaseDocumentType = 'Receipt' | 'Invoice' | 'Credit Memo';
export type VendorLedgerDocumentType =
  | 'Invoice' | 'Payment' | 'Credit Memo' | 'Finance Charge Memo' | 'Refund';
export type DetailedVendorLedgerEntryType =
  | 'Initial Entry' | 'Application' | 'Payment Discount' | 'Correction' | 'Unapplied'
  | 'Realized Gain' | 'Realized Loss' | 'Unrealized Gain' | 'Unrealized Loss';
export interface VendorPostingGroup {
  id: number;
  code: string;
  description: string;
  payables_account_id: number;
  service_charge_account_id: number;
  payment_disc_debit_account_id: number;
  payment_disc_credit_account_id: number;
  invoice_rounding_account_id: number;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface VendorPostingGroupView extends VendorPostingGroup {
  payables_account_code: string;
  service_charge_account_code: string;
  payment_disc_debit_account_code: string;
  payment_disc_credit_account_code: string;
  invoice_rounding_account_code: string;
  vendors_using: number;
}

export interface PurchasesPayablesSetup {
  id: number;
  default_vendor_posting_group_code: string | null;
  default_payment_terms_code: string | null;
  default_vat_bus_posting_group_code: string | null;
  prices_incl_vat: Flag;
  receipt_on_invoice: Flag;
  exact_cost_reversing_mandatory: Flag;
  allow_payables_posting_from: IsoDate | null;
  allow_payables_posting_to: IsoDate | null;
  updated_at: IsoDateTime | null;
  updated_by: string | null;
}

/** Business Central Table 23 "Vendor". */
export interface Vendor {
  id: number;
  no: string;
  name: string;
  name_2: string | null;
  address: string | null;
  address_2: string | null;
  city: string | null;
  post_code: string | null;
  country: string | null;
  contact: string | null;
  phone: string | null;
  email: string | null;
  vendor_posting_group_code: string | null;
  vat_bus_posting_group_code: string | null;
  pin_no: string | null;
  wht_exempt: Flag;
  payment_terms_code: string | null;
  payment_method_code: string | null;
  purchaser: string | null;
  currency_code: string | null;
  credit_limit: Cents;
  blocked: VendorBlocked;
  our_account_no: string | null;
  global_dimension_1_id: number | null;
  global_dimension_2_id: number | null;
  balance: Cents;
  last_statement_no: number;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface VendorListRow extends Vendor {
  vendor_posting_group_description: string | null;
  payment_terms_description: string | null;
  balance_due: Cents;
}

export interface VendorStatistics {
  balance: Cents;
  balance_due: Cents;
  outstanding_orders: Cents;
  overdue_entries: number;
  ledger_entry_count: number;
  credit_limit: Cents;
}

/** Business Central Table 38 "Purchase Header". */
export interface PurchaseHeader {
  id: number;
  document_type: PurchaseDocumentType;
  no: string;
  vendor_id: number;
  buy_from_name: string | null;
  buy_from_address: string | null;
  buy_from_city: string | null;
  buy_from_contact: string | null;
  posting_date: IsoDate;
  document_date: IsoDate;
  due_date: IsoDate | null;
  payment_terms_code: string | null;
  payment_method_code: string | null;
  vendor_posting_group_code: string | null;
  vat_bus_posting_group_code: string | null;
  vendor_invoice_no: string | null;
  /** BC "Applies-to Doc. No." — the posted invoice a credit memo settles when it posts. */
  applies_to_doc_no: string | null;
  purchaser: string | null;
  currency_code: string;
  currency_factor: number;
  global_dimension_1_id: number | null;
  global_dimension_2_id: number | null;
  status: PurchaseDocumentStatus;
  amount: Cents;
  amount_incl_vat: Cents;
  decision_reason: string | null;
  /** AL "Requisition No" — the purchase requisition this was raised from. */
  requisition_no: string | null;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface PurchaseHeaderView extends PurchaseHeader {
  vendor_no: string;
  vendor_name: string;
  vendor_blocked: VendorBlocked;
}

/** Business Central Table 39 "Purchase Line". */
export interface PurchaseLine {
  id: number;
  purchase_header_id: number;
  line_no: number;
  type: PurchaseLineType;
  no: string | null;
  description: string | null;
  quantity: number;
  direct_unit_cost: Cents;
  line_discount_pct: number;
  line_discount_amount: Cents;
  line_amount: Cents;
  vat_prod_posting_group_code: string | null;
  vat_pct: number;
  vat_base_amount: Cents;
  vat_amount: Cents;
  amount_incl_vat: Cents;
  qty_to_receive: number;
  qty_received: number;
  qty_to_invoice: number;
  qty_invoiced: number;
  location_code: string | null;
  fa_depreciation_book_code: string | null;
  global_dimension_1_id: number | null;
  global_dimension_2_id: number | null;
}

export interface PurchaseDocumentDetail extends PurchaseHeaderView {
  lines: PurchaseLine[];
  outstanding_amount: Cents;
  received_not_invoiced: Cents;
}

export interface PostedPurchaseDocument {
  id: number;
  document_type: PostedPurchaseDocumentType;
  no: string;
  vendor_id: number;
  buy_from_name: string | null;
  buy_from_address: string | null;
  buy_from_city: string | null;
  buy_from_contact: string | null;
  posting_date: IsoDate;
  document_date: IsoDate;
  due_date: IsoDate | null;
  order_no: string | null;
  /** The open document this was posted from — what its approval trail is recorded against. */
  source_no: string | null;
  vendor_invoice_no: string | null;
  applies_to_doc_no: string | null;
  payment_terms_code: string | null;
  vat_bus_posting_group_code: string | null;
  currency_code: string;
  currency_factor: number;
  amount: Cents;
  amount_incl_vat: Cents;
  vendor_ledger_entry_id: number | null;
  journal_id: number | null;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface PostedPurchaseDocumentView extends PostedPurchaseDocument {
  vendor_no: string;
  vendor_name: string;
}

export interface PostedPurchaseLine {
  id: number;
  posted_purchase_document_id: number;
  line_no: number;
  type: PurchaseLineType;
  no: string | null;
  description: string | null;
  quantity: number;
  direct_unit_cost: Cents;
  line_discount_amount: Cents;
  line_amount: Cents;
  vat_prod_posting_group_code: string | null;
  vat_pct: number;
  vat_base_amount: Cents;
  vat_amount: Cents;
  amount_incl_vat: Cents;
  item_ledger_entry_id: number | null;
  fa_ledger_entry_id: number | null;
}

/** Business Central Table 25 "Vendor Ledger Entry". */
export interface VendorLedgerEntry {
  id: number;
  vendor_id: number;
  posting_date: IsoDate;
  document_type: VendorLedgerDocumentType;
  document_no: string;
  vendor_invoice_no: string | null;
  description: string | null;
  amount: Cents;
  remaining_amount: Cents;
  original_amount: Cents;
  amount_lcy: Cents;
  remaining_amount_lcy: Cents;
  original_amount_lcy: Cents;
  currency_code: string;
  currency_factor: number;
  due_date: IsoDate | null;
  pmt_discount_date: IsoDate | null;
  original_pmt_disc_possible: Cents;
  open: Flag;
  positive: Flag;
  closed_by_entry_no: number | null;
  closed_at_date: IsoDate | null;
  on_hold: string | null;
  source_type: string | null;
  source_id: number | null;
  journal_id: number | null;
  created_at: IsoDateTime | null;
}

export interface VendorLedgerEntryView extends VendorLedgerEntry {
  vendor_no: string;
  vendor_name: string;
}

export interface DetailedVendorLedgerEntry {
  id: number;
  vendor_ledger_entry_id: number;
  entry_type: DetailedVendorLedgerEntryType;
  posting_date: IsoDate;
  document_type: string | null;
  document_no: string | null;
  amount: Cents;
  amount_lcy: Cents;
  applied_vendor_ledger_entry_id: number | null;
  journal_id: number | null;
  unapplied: Flag;
  unapplied_by_entry_id: number | null;
  created_at: IsoDateTime | null;
}

/** One row of the Aged Accounts Payable report (BC Report 322). */
export interface AgedPayableRow {
  vendor_id: number;
  vendor_no: string;
  vendor_name: string;
  balance: Cents;
  not_due: Cents;
  bucket_1: Cents;
  bucket_2: Cents;
  bucket_3: Cents;
  bucket_over: Cents;
}

export interface AgedPayableReport {
  as_of: IsoDate;
  aging_by: 'Due Date' | 'Posting Date';
  period_length: string;
  bucket_labels: [string, string, string, string, string];
  rows: AgedPayableRow[];
  totals: Omit<AgedPayableRow, 'vendor_id' | 'vendor_no' | 'vendor_name'>;
}

export interface VendorStatementLine {
  posting_date: IsoDate;
  document_type: VendorLedgerDocumentType;
  document_no: string;
  description: string | null;
  due_date: IsoDate | null;
  amount: Cents;
  remaining_amount: Cents;
  running_balance: Cents;
}

export interface VendorStatementReport {
  vendor_no: string;
  vendor_name: string;
  from: IsoDate;
  to: IsoDate;
  opening_balance: Cents;
  closing_balance: Cents;
  lines: VendorStatementLine[];
}

/* ============================================================================================
 * Cash Management (Business Central) + multi-currency. See lib/bankMgmt.ts, lib/cashMgmtSetup.ts,
 * lib/receipts.ts, lib/paymentVouchers.ts.
 * ========================================================================================== */

/**
 * AL's Receipt Type. It is set on the header and fixes what every
 * line may be posted to — a Receipt Type of G/L Account takes G/L lines and nothing else.
 */
export type ReceiptLineType = 'Employee' | 'Customer' | 'Vendor' | 'G/L Account' | 'Bank Account';
export type ReceiptStatus = 'Open' | 'Pending Approval' | 'Approved';
export type PaymentVoucherLineType = 'Employee' | 'G/L Account' | 'Vendor' | 'Customer' | 'Bank Account';

/**
 * AL's Payment Type. It is set on the header and fixes
 * what every line may pay — the AL relates Payment Voucher Lines."Account No" to a different
 * table per Payment Type, so a Supplier Payment pays vendors and nothing else.
 *
 * The AL's Employee Payment is deliberately absent: this system has no
 * employee subledger to post against, and staff advances are paid through payroll's
 * disburse(), so a second path to the same money would be a way to pay it twice.
 */
export type PaymentVoucherType =
  | 'Supplier Payment' | 'Customer Refund' | 'Bank Transfer'
  | 'Direct Expensing' | 'Payroll Settlement' | 'Remittance' | 'Employee Payment';
export type BankLedgerDocumentType =
  '' | 'Payment' | 'Refund' | 'Receipt' | 'Transfer' | 'Reconciliation';
export type BankRecLineType = 'Bank Account Ledger Entry' | 'G/L Adjustment';

export interface Currency {
  id: number;
  code: string;
  description: string;
  symbol: string | null;
  iso_numeric_code: string | null;
  is_base: Flag;
  amount_rounding_precision: Cents;
  invoice_rounding_precision: Cents;
  realized_gains_account_id: number | null;
  realized_losses_account_id: number | null;
  unrealized_gains_account_id: number | null;
  unrealized_losses_account_id: number | null;
  residual_gains_account_id: number | null;
  residual_losses_account_id: number | null;
  blocked: Flag;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface CurrencyView extends Currency {
  realized_gains_account_code: string | null;
  realized_losses_account_code: string | null;
  latest_rate: number | null;
  rate_count: number;
}

export interface CurrencyExchangeRate {
  id: number;
  currency_code: string;
  starting_date: IsoDate;
  exchange_rate_amount: number;
  relational_exch_rate_amount: number;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface BankAccPostingGroup {
  id: number;
  code: string;
  description: string;
  gl_account_id: number;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface BankAccPostingGroupView extends BankAccPostingGroup {
  gl_account_code: string;
  gl_account_name: string;
  accounts_using: number;
}

export interface ExternalBank {
  id: number;
  code: string;
  name: string;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface ExternalBankBranch {
  id: number;
  bank_code: string;
  branch_code: string;
  branch_name: string;
}

export interface CashManagementSetup {
  id: number;
  receipt_approval_limit: Cents;
  pv_approval_limit: Cents;
  default_vat_bus_posting_group_code: string | null;
  bank_charges_account_id: number | null;
  bank_interest_income_account_id: number | null;
  default_receipt_bank_account_id: number | null;
  allow_cm_posting_from: IsoDate | null;
  allow_cm_posting_to: IsoDate | null;
  updated_at: IsoDateTime | null;
  updated_by: string | null;
}

export interface BankRecLine {
  id: number;
  bank_reconciliation_id: number;
  line_no: number;
  type: BankRecLineType;
  transaction_date: IsoDate | null;
  document_no: string | null;
  description: string | null;
  statement_amount: Cents;
  applied_amount: Cents;
  bank_account_ledger_entry_id: number | null;
  gl_account_id: number | null;
  applied: Flag;
}

export interface BankRecLineView extends BankRecLine {
  entry_amount: Cents | null;
  entry_open: Flag | null;
  gl_account_code: string | null;
}

export interface BankReconciliationDetail {
  reconciliation: BankReconciliation;
  bankAccount: BankAccount;
  lines: BankRecLineView[];
  unmatchedEntries: BankAccountLedgerEntryWithJournal[];
  appliedTotal: Cents;
  adjustmentTotal: Cents;
  totalBalance: Cents;
  difference: Cents;
}
