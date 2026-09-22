/* VAT + Withholding Tax — split out of lib/types.ts; import from '@/lib/types', never from here directly. */
import type { Cents, DocumentStatus, Flag, IsoDate, IsoDateTime, SignatureBlock } from '../types.ts';

/* --------------------------------------------------------------- VAT + Withholding Tax */

export type TaxType = 'VAT' | 'WHT';
export type VatCalculationType = 'Normal' | 'Zero VAT' | 'Exempt';

export interface VatBusinessPostingGroup {
  id: number;
  code: string;
  description: string;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface VatProductPostingGroup {
  id: number;
  code: string;
  description: string;
  tax_type: TaxType;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface VatPostingSetup {
  id: number;
  vat_bus_posting_group_code: string;
  vat_prod_posting_group_code: string;
  tax_type: TaxType;
  vat_pct: number;
  vat_calculation_type: VatCalculationType;
  tax_account_id: number | null;
  wht_base: 'Net' | 'Gross';
  blocked: Flag;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface VatPostingSetupView extends VatPostingSetup {
  tax_account_code: string | null;
  tax_account_name: string | null;
  vat_prod_description: string | null;
}

export interface VatEntry {
  id: number;
  posting_date: IsoDate;
  document_type: string;
  document_no: string;
  type: 'Purchase' | 'Settlement';
  tax_type: TaxType;
  vat_bus_posting_group_code: string | null;
  vat_prod_posting_group_code: string | null;
  vat_pct: number;
  base: Cents;
  amount: Cents;
  base_fcy: Cents;
  amount_fcy: Cents;
  currency_code: string;
  currency_factor: number;
  bill_to_pay_to_no: string | null;
  vendor_pin: string | null;
  wht_certificate_no: string | null;
  journal_id: number | null;
  source_type: string | null;
  source_id: number | null;
  closed: Flag;
  created_at: IsoDateTime | null;
}

export interface WhtCertificate {
  id: number;
  no: string;
  vendor_id: number;
  vendor_name: string | null;
  vendor_pin: string | null;
  payment_voucher_no: string;
  certificate_date: IsoDate;
  gross_amount: Cents;
  total_wht: Cents;
  remitted: Flag;
  remittance_ref: string | null;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface WhtCertificateLine {
  id: number;
  wht_certificate_id: number;
  line_no: number;
  wht_code: string;
  description: string | null;
  rate: number;
  base: Cents;
  wht_amount: Cents;
  vat_entry_id: number | null;
}

export interface WhtCertificateView extends WhtCertificate {
  vendor_no: string;
}

export interface WhtCertificateDetail extends WhtCertificateView {
  lines: WhtCertificateLine[];
}

/** The one place the AL "Payment Voucher Lines".Amount arithmetic lives. */
export interface LineTaxResult {
  vatBase: Cents;
  vatAmount: Cents;
  netOfVat: Cents;
  whtBase: Cents;
  whtOne: Cents;
  whtTwo: Cents;
  netPaid: Cents;
}

export interface WhtCertificateSlipLine {
  wht_code: string;
  description: string;
  rate: number;
  base: Cents;
  wht_amount: Cents;
}

export interface WhtCertificateSlip {
  org_name: string;
  org_address: string;
  org_pin: string | null;
  certificate_no: string;
  certificate_date: IsoDate;
  vendor_name: string;
  vendor_pin: string | null;
  payment_voucher_no: string;
  gross_amount: Cents;
  total_wht: Cents;
  total_wht_words: string;
  lines: WhtCertificateSlipLine[];
  /** The issuing officer's signature on file, resolved at print time (lib/userSignatures.ts). */
  issued_by_signature: SignatureBlock | null;
}

export interface VatInputListingRow {
  vat_prod_posting_group_code: string;
  description: string | null;
  vat_pct: number;
  base: Cents;
  amount: Cents;
  entry_count: number;
}

export interface WhtAnalysisRow {
  bill_to_pay_to_no: string | null;
  vendor_name: string | null;
  vendor_pin: string | null;
  wht_code: string | null;
  rate: number;
  base: Cents;
  amount: Cents;
  entry_count: number;
}

/* ================================================================================================
 * HR & Payroll — Employee Management (ported from the ERP AL, object range 52203xxx).
 * ================================================================================================ */

/** Collapses AL's two overlapping status fields into one lifecycle. */
/** AL Payroll Salary Card "Payment Mode". */
export type PaymentMode = 'Bank Transfer' | 'Cheque' | 'Cash' | 'M-Pesa';
export const PAYMENT_MODES: PaymentMode[] = ['Bank Transfer', 'Cheque', 'Cash', 'M-Pesa'];

export type EmployeeStatus =
  | 'NEW' | 'PENDING_APPROVAL' | 'ACTIVE' | 'ON_LEAVE' | 'PENDING_FINAL_PAYMENT' | 'INACTIVE' | 'TERMINATED';

/** AL Tab52203636 "Salary Scale Pointers" — a notch on a job grade's salary scale. */
export interface HrSalaryScale {
  id: number; job_grade_id: number; code: string; name: string | null; basic_pay_cents: Cents;
  sequence: number; status: 'ACTIVE' | 'INACTIVE'; created_at: IsoDateTime | null; created_by: string | null;
}
/** AL Tab52203627 "Income/Deduction Configuration" — one earning / deduction a notch confers. */
export interface HrSalaryScaleBenefit {
  id: number; salary_scale_id: number; transaction_code_id: number; amount_cents: Cents; notes: string | null;
}
export interface HrSalaryScaleBenefitView extends HrSalaryScaleBenefit {
  transaction_code: string; transaction_name: string; transaction_type: PayrollTransactionType;
}
export interface HrSalaryScaleView extends HrSalaryScale {
  job_grade_code: string; job_grade_name: string;
  employee_count: number;
  benefits: HrSalaryScaleBenefitView[];
}

export interface HrJobGrade {
  id: number; code: string; name: string;
  notice_period_days: number; probation_notice_period_days: number;
  leave_allowance_amount: Cents; training_allowance_amount: Cents; overtime_allowance_amount: Cents;
  status: string; created_at: IsoDateTime | null; created_by: string | null;
}

export interface HrEmploymentContractType {
  id: number; code: string; name: string; default_notice_period_days: number; status: string;
  created_at: IsoDateTime | null; created_by: string | null;
}

export interface HrTerminationReason {
  id: number; code: string; description: string; pay_gratuity: boolean; status: string;
  created_at: IsoDateTime | null; created_by: string | null;
}

export interface HrClearanceSection {
  id: number; code: string; name: string; owner_email: string | null; sort_order: number; status: string;
  created_at: IsoDateTime | null; created_by: string | null;
}

export interface Employee {
  id: number;
  employee_no: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  gender: string | null;
  date_of_birth: IsoDate | null;
  national_id: string | null;
  kra_pin: string | null;
  nssf_no: string | null;
  shif_no: string | null;
  marital_status: string | null;
  phone: string | null;
  alt_phone: string | null;
  email: string | null;
  physical_address: string | null;
  county_id: number | null;
  sub_county_id: number | null;
  job_title: string | null;
  job_grade_id: number | null;
  /** AL Employee."Job Code" — the Company Job (position) held; drives the organogram. */
  company_job_id: number | null;
  contract_type_id: number | null;
  nature_of_employment: 'PERMANENT' | 'CONTRACT' | 'BOARD' | 'SECONDED';
  employee_type: 'STAFF' | 'DRIVER' | 'INTERN' | 'NYSC';
  employment_date: IsoDate;
  probation_period_months: number;
  probation_end_date: IsoDate | null;
  probation_status: 'ON_PROBATION' | 'CONFIRMED' | 'EXTENDED' | 'TERMINATED';
  confirmed_date: IsoDate | null;
  manager_id: number | null;
  overview_manager_id: number | null;
  bank_code: string | null;
  bank_branch: string | null;
  bank_account_no: string | null;
  posting_group_id: number | null;
  global_dimension_1_id: number | null;
  global_dimension_2_id: number | null;
  salary_scale_id: number | null;
  basic_pay_cents: Cents;
  /** AL Tab52203623 "Payroll Salary Card" — how the employee is paid (basic pay is the contract's). */
  payment_mode: PaymentMode;
  payroll_currency_code: string | null;
  pays_nssf: boolean;
  pays_shif: boolean;
  pays_paye: boolean;
  payslip_message: string | null;
  suspend_pay: boolean;
  suspension_date: IsoDate | null;
  suspension_reasons: string | null;
  stop_relief: boolean;
  insurance_certificate: boolean;
  /** Passport photo / specimen signature — Cloudinary public_ids, or null. */
  photo_image: string | null;
  signature_image: string | null;
  photo_url: string | null;
  disabled: boolean;
  disability_notes: string | null;
  status: EmployeeStatus;
  decision_reason: string | null;
  termination_reason_id: number | null;
  termination_date: IsoDate | null;
  notes: string | null;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface EmployeeView extends Employee {
  job_grade_name: string | null;
  company_job_code: string | null; company_job_name: string | null;
  posting_group_code: string | null;
  posting_group_name: string | null;
  contract_type_name: string | null;
  manager_first_name: string | null;
  manager_last_name: string | null;
  county_name: string | null;
  sub_county_name: string | null;
  global_dimension_1_code: string | null;
  global_dimension_1_name: string | null;
  global_dimension_2_code: string | null;
  global_dimension_2_name: string | null;
}

export interface EmployeeNextOfKin {
  id: number; employee_id: number; full_name: string; relationship: string | null;
  id_no: string | null; phone: string | null; email: string | null;
}

export interface EmployeeBeneficiary {
  id: number; employee_id: number; full_name: string; id_no: string | null; date_of_birth: IsoDate | null;
  relationship: string | null; gender: string | null; phone: string | null; email: string | null;
  percentage: number; is_minor: boolean;
}

export interface EmployeeDependant {
  id: number; employee_id: number; full_name: string; id_or_birth_cert_no: string | null;
  date_of_birth: IsoDate | null; relationship: string | null; gender: string | null;
  is_student: boolean; status: string;
}

export interface EmployeeEmergencyContact {
  id: number; employee_id: number; full_name: string; relationship: string | null;
  phone: string | null; alt_phone: string | null; email: string | null;
}

export interface EmployeeProfessionalBody {
  id: number; employee_id: number; body_name: string; membership_no: string | null;
  from_date: IsoDate | null; to_date: IsoDate | null;
}

export interface EmployeeWorkHistory {
  id: number; employee_id: number; institution: string; position_held: string | null;
  from_date: IsoDate | null; to_date: IsoDate | null; reason_for_leaving: string | null;
}

export interface EmployeeBankAccount {
  id: number; employee_id: number; bank_code: string | null; branch: string | null;
  account_no: string; percentage: number;
}

export interface EmployeeContract {
  id: number; employee_id: number; contract_type_id: number | null;
  start_date: IsoDate; end_date: IsoDate | null; job_title: string | null; grade_id: number | null;
  salary_cents: Cents; notice_period_days: number | null; is_current: boolean; status: string;
  created_at: IsoDateTime | null; created_by: string | null;
}

/** One edit request per employee, carrying the proposed bio-data
 *  field values, plus a replace-all shadow table per sub-entity list (see lib/employeeEdits.ts). */
export interface EmployeeEditRequest {
  no: string;
  employee_id: number;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  gender: string | null;
  date_of_birth: IsoDate | null;
  national_id: string | null;
  kra_pin: string | null;
  nssf_no: string | null;
  shif_no: string | null;
  marital_status: string | null;
  phone: string | null;
  alt_phone: string | null;
  email: string | null;
  physical_address: string | null;
  county_id: number | null;
  sub_county_id: number | null;
  job_title: string | null;
  job_grade_id: number | null;
  /** AL Employee."Job Code" — the Company Job (position) held; drives the organogram. */
  company_job_id: number | null;
  bank_code: string | null;
  bank_branch: string | null;
  bank_account_no: string | null;
  global_dimension_1_id: number | null;
  global_dimension_2_id: number | null;
  posting_group_id: number | null;
  /** AL "J-G Steps" — the salary-scale notch within the job grade; null = off-scale. */
  salary_scale_id: number | null;
  /** Payroll Salary Card "Basic Pay" — kept in step with the current contract's salary. */
  basic_pay_cents: Cents;
  /** AL Tab52203623 "Payroll Salary Card" — how the employee is paid (basic pay is the contract's). */
  payment_mode: PaymentMode;
  payroll_currency_code: string | null;
  pays_nssf: boolean;
  pays_shif: boolean;
  pays_paye: boolean;
  payslip_message: string | null;
  suspend_pay: boolean;
  suspension_date: IsoDate | null;
  suspension_reasons: string | null;
  stop_relief: boolean;
  insurance_certificate: boolean;
  /** Proposed passport photo / specimen signature (Cloudinary public_ids), applied with the rest. */
  photo_image: string | null;
  signature_image: string | null;
  status: DocumentStatus;
  decision_reason: string | null;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface EmployeeEditRequestView extends EmployeeEditRequest {
  company_job_code: string | null; company_job_name: string | null;
  employee_no: string; employee_first_name: string; employee_last_name: string;
  job_grade_name: string | null; county_name: string | null; sub_county_name: string | null;
  posting_group_code: string | null; posting_group_name: string | null;
  global_dimension_1_code: string | null; global_dimension_1_name: string | null;
  global_dimension_2_code: string | null; global_dimension_2_name: string | null;
}

export type EmployeeEditNextOfKin = Omit<EmployeeNextOfKin, 'employee_id'> & { edit_no: string };
export type EmployeeEditBeneficiary = Omit<EmployeeBeneficiary, 'employee_id'> & { edit_no: string };
export type EmployeeEditDependant = Omit<EmployeeDependant, 'employee_id' | 'status'> & { edit_no: string };
export type EmployeeEditEmergencyContact = Omit<EmployeeEmergencyContact, 'employee_id'> & { edit_no: string };
export type EmployeeEditProfessionalBody = Omit<EmployeeProfessionalBody, 'employee_id'> & { edit_no: string };
export type EmployeeEditWorkHistory = Omit<EmployeeWorkHistory, 'employee_id'> & { edit_no: string };
export type EmployeeEditBankAccount = Omit<EmployeeBankAccount, 'employee_id'> & { edit_no: string };

export type EmployeeContractChangeNature = 'NEW_CONTRACT' | 'RENEWAL' | 'SALARY_INCREMENT';

export interface EmployeeContractChange {
  no: string;
  employee_id: number;
  nature: EmployeeContractChangeNature;
  contract_type_id: number | null;
  proposed_start_date: IsoDate | null;
  proposed_end_date: IsoDate | null;
  proposed_salary_cents: Cents | null;
  proposed_grade_id: number | null;
  reason: string | null;
  status: DocumentStatus;
  decision_reason: string | null;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface EmployeeContractChangeView extends EmployeeContractChange {
  employee_no: string; employee_first_name: string; employee_last_name: string;
}

export type EmployeeExitDueType = 'LEAVE_ENCASHMENT' | 'NOTICE_PENALTY' | 'NOTICE_INCOME' | 'GRATUITY' | 'UNCLEARED_ITEMS';

export interface EmployeeExit {
  no: string;
  employee_id: number;
  termination_reason_id: number | null;
  date_of_notice: IsoDate | null;
  date_of_exit: IsoDate | null;
  notice_period_days: number | null;
  notice_fully_served: boolean | null;
  reasons_for_not_serving_notice: string | null;
  can_be_reemployed: boolean | null;
  cleared: boolean;
  status: DocumentStatus;
  decision_reason: string | null;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface EmployeeExitView extends EmployeeExit {
  employee_no: string; employee_first_name: string; employee_last_name: string;
}

export interface EmployeeExitFinalDueLine {
  id: number; exit_no: string; due_type: EmployeeExitDueType; description: string | null; amount_cents: Cents;
}

export interface EmployeeExitClearanceLine {
  id: number; exit_no: string; section_id: number; cleared: boolean;
  cleared_by: string | null; cleared_at: IsoDateTime | null; remarks: string | null;
}

export interface EmployeeExitClearanceLineView extends EmployeeExitClearanceLine {
  section_code: string; section_name: string; owner_email: string | null;
}

/* ================================================================================================
 * HR & Payroll — Leave Management (ported from the ERP AL, object range 52203xxx).
 * ================================================================================================ */

export type LeaveGender = 'ANY' | 'MALE' | 'FEMALE';
export type LeaveBalanceTreatment = 'IGNORE' | 'CARRY_FORWARD' | 'CONVERT_CASH';

export interface HrLeaveType {
  id: number; code: string; name: string;
  standard_days: number; accrues: boolean; days_to_accrue: number; unlimited_days: boolean;
  gender: LeaveGender; balance_treatment: LeaveBalanceTreatment; max_carry_forward_days: number;
  inclusive_of_saturday: boolean; inclusive_of_sunday: boolean; inclusive_of_holidays: boolean;
  fixed_days: boolean; is_annual: boolean; max_applicable_days: number | null;
  check_balance: boolean; is_sick_leave: boolean; requires_admin_approval: boolean;
  leave_balance_notification_threshold: number | null; disabled: boolean; status: string;
  created_at: IsoDateTime | null; created_by: string | null;
}

export interface HrLeaveCalendar {
  id: number; code: string; start_date: IsoDate; end_date: IsoDate;
  is_current: boolean; closed: boolean; closed_at: IsoDateTime | null; closed_by: string | null;
  created_at: IsoDateTime | null; created_by: string | null;
}

export interface HrHoliday { id: number; date: IsoDate; reason: string; recurring: boolean }

export interface HrLeaveDaysToAccrue {
  id: number; leave_type_id: number; job_grade_id: number; days_to_accrue: number; leave_day_worth_cents: Cents;
}

export type LeaveLedgerEntryType = 'POSITIVE' | 'NEGATIVE' | 'REIMBURSEMENT' | 'OPENING_BALANCE' | 'ACCRUED';

export interface HrLeaveLedgerEntry {
  id: number; employee_id: number; leave_type_id: number; leave_calendar_id: number;
  quantity: number; entry_type: LeaveLedgerEntryType; posting_date: IsoDate;
  document_no: string | null; source_type: string | null; source_id: string | null;
  closed: boolean; description: string | null; created_at: IsoDateTime | null; created_by: string | null;
}

export type LeaveApplicationNature = 'APPLICATION' | 'REIMBURSEMENT';

export interface HrLeaveApplication {
  no: string; employee_id: number; leave_type_id: number; nature: LeaveApplicationNature;
  leave_calendar_id: number; start_date: IsoDate; end_date: IsoDate;
  days_applied: number; weekend_days: number; holiday_days: number; total_days: number;
  reliever_id: number | null; status: DocumentStatus; decision_reason: string | null;
  leave_allowance_payable: boolean; posted: boolean; posting_date: IsoDate | null;
  days_dropped: number | null; days_to_reimburse: number | null; justification: string | null;
  created_at: IsoDateTime | null; created_by: string | null;
}

export interface HrLeaveApplicationView extends HrLeaveApplication {
  employee_no: string; employee_first_name: string; employee_last_name: string;
  leave_type_name: string; reliever_first_name: string | null; reliever_last_name: string | null;
  balance: number;
}

export interface HrLeaveAdjustment {
  no: string; leave_type_id: number; type: 'POSITIVE' | 'NEGATIVE'; description: string | null;
  days: number; status: DocumentStatus; decision_reason: string | null;
  created_at: IsoDateTime | null; created_by: string | null;
}

export interface HrLeaveAdjustmentView extends HrLeaveAdjustment { leave_type_name: string; line_count: number }

export interface HrLeaveAdjustmentLine {
  id: number; adjustment_no: string; employee_id: number; days: number;
}
export interface HrLeaveAdjustmentLineView extends HrLeaveAdjustmentLine {
  employee_no: string; employee_first_name: string; employee_last_name: string;
}

export interface HrLeaveRecall {
  no: string; employee_id: number; application_no: string; days_to_recall: number;
  status: DocumentStatus; decision_reason: string | null;
  created_at: IsoDateTime | null; created_by: string | null;
}
export interface HrLeaveRecallView extends HrLeaveRecall {
  employee_no: string; employee_first_name: string; employee_last_name: string;
  application_start_date: IsoDate; application_end_date: IsoDate; application_days_applied: number;
}

export interface HrLeavePlan {
  no: string; employee_id: number; leave_calendar_id: number;
  status: DocumentStatus; decision_reason: string | null;
  created_at: IsoDateTime | null; created_by: string | null;
}
export interface HrLeavePlanView extends HrLeavePlan {
  employee_no: string; employee_first_name: string; employee_last_name: string;
}
export interface HrLeavePlanLine { id: number; plan_no: string; start_date: IsoDate; end_date: IsoDate; days: number }

/* ================================================================================================
 * HR & Payroll — Payroll (ported from the ERP AL, object range 52203xxx). Posts real
 * double-entry journals on period close via the existing postJournal() engine.
 * ================================================================================================ */

export interface HrPayrollSetup {
  id: 1;
  personal_relief_cents: Cents; insurance_relief_pct: number; max_relief_cents: Cents;
  /** Owner-occupier interest cap per month — P9 column F (KES 30,000 from 27 Dec 2024). */
  mortgage_relief_cents: Cents; shif_pct: number; shif_based_on: 'GROSS' | 'BASIC' | 'TAXABLE';
  nssf_employer_factor: number; housing_levy_enabled: boolean; housing_levy_pct: number;
  housing_levy_based_on: 'GROSS' | 'BASIC' | 'TAXABLE'; minimum_relief_threshold_cents: Cents;
  secondary_tax_pct: number; monthly_working_days: number;
  /** P9 column E3 — the fixed monthly cap on the defined-contribution deduction. */
  pension_deduction_cap_cents: Cents;
  /** P9 column J — cap on the post-retirement medical fund deduction. */
  prmf_cap_cents: Cents;
  /** Whether SHIF (col. I) and the Affordable Housing Levy (col. H) are deducted before tax. */
  shif_deductible: boolean; housing_levy_deductible: boolean;
  updated_at: IsoDateTime | null; updated_by: string | null;
}

export interface PayrollPostingGroup {
  id: number; code: string; name: string;
  salary_expense_account_id: number; paye_payable_account_id: number; net_pay_payable_account_id: number;
  nssf_employee_payable_account_id: number; nssf_employer_expense_account_id: number; nssf_employer_payable_account_id: number;
  shif_payable_account_id: number;
  housing_levy_employee_payable_account_id: number; housing_levy_employer_expense_account_id: number;
  housing_levy_employer_payable_account_id: number;
  created_at: IsoDateTime | null; created_by: string | null;
}

export interface PayrollPayeBand { id: number; sort_order: number; upper_bound_cents: Cents | null; rate_pct: number }
export interface PayrollNssfTier {
  id: number; tier_no: number; lower_limit_cents: Cents; upper_limit_cents: Cents; employee_rate_pct: number; employer_rate_pct: number;
}

export type PayrollTransactionType = 'INCOME' | 'DEDUCTION' | 'COMPANY_DEDUCTION';
export type PayrollBalanceType = 'NONE' | 'INCREASING' | 'REDUCING';
export type PayrollSpecialType =
  | 'NONE' | 'BASIC_SALARY' | 'HOUSE_ALLOWANCE' | 'TRANSPORT_ALLOWANCE' | 'OVERTIME' | 'ACTING_ALLOWANCE'
  | 'LEAVE_ALLOWANCE' | 'GRATUITY' | 'PENSION' | 'MORTGAGE' | 'INSURANCE' | 'LOAN' | 'SALARY_ARREARS' | 'DIRECTORS_FEE'
  /** Taxable but not paid in cash — P9 columns B and C; kept off the journal and the net pay. */
  | 'NON_CASH_BENEFIT' | 'VALUE_OF_QUARTERS'
  /** Post-retirement medical fund — an allowable deduction, P9 column J. */
  | 'PRMF';

export type PayrollAmountPreference = 'FORMULA' | 'HIGHER' | 'LOWER';

export interface PayrollTransactionCode {
  id: number; code: string; name: string; type: PayrollTransactionType; taxable: boolean;
  /** AL "Is Formula" / Formula: the amount is computed from the employee's period transactions,
   *  e.g. `[BPAY]*0.15`; "Amount Preference" picks between it and the line's own amount. */
  is_formula: boolean; formula: string | null; amount_preference: PayrollAmountPreference;
  /** Employer-side contribution on a deduction (AL "Include Employer Deduction"): a multiple of
   *  the employee's amount (2 = the employer pays double), or a formula that overrides it. */
  employer_factor: number; employer_formula: string | null;
  fixed_amount_cents: Cents; upper_limit_cents: Cents | null;
  balance_type: PayrollBalanceType; special_type: PayrollSpecialType;
  gl_account_id: number | null; employer_gl_account_id: number | null; for_every_employee: boolean;
  status: string; created_at: IsoDateTime | null; created_by: string | null;
}

export type PayrollPeriodStatus = 'OPEN' | 'PENDING_APPROVAL' | 'APPROVED' | 'CLOSED';

export interface PayrollPeriod {
  id: number; period_name: string; start_date: IsoDate; end_date: IsoDate; status: PayrollPeriodStatus;
  decision_reason: string | null; closed_at: IsoDateTime | null; closed_by: string | null;
  created_at: IsoDateTime | null; created_by: string | null;
}

export interface EmployeePayrollTransaction {
  id: number; employee_id: number; transaction_code_id: number; payroll_period_id: number;
  amount_cents: Cents; original_amount_cents: Cents | null; balance_cents: Cents | null;
  no_of_periods: number | null; executed_periods: number; stopped: boolean; temporary: boolean;
  notes: string | null;
  /** The window the line is in force (either side open when null). */
  start_date: IsoDate | null; end_date: IsoDate | null;
  /** The salary-scale notch that conferred this line, when it did. */
  salary_scale_id: number | null;
  created_at: IsoDateTime | null; created_by: string | null;
}
export interface EmployeePayrollTransactionView extends EmployeePayrollTransaction {
  transaction_code_name: string; transaction_type: PayrollTransactionType;
}

/** AL Tab52203619 "Payroll Period Transaction" — one computed line of an employee's payroll for
 *  a period. Basic pay, the tax workings, statutories and net pay carry the run's own codes and
 *  no transaction_code_id; only Earnings & Deductions lines point at a code. */
export interface PayrollPeriodTransaction {
  id: number; payroll_period_id: number; employee_id: number;
  transaction_code: string; transaction_code_id: number | null; transaction_name: string;
  transaction_type: 'INCOME' | 'DEDUCTION' | 'COMPANY_DEDUCTION' | 'MEMO' | 'NET';
  group_text: string; group_order: number; sub_group_order: number; payslip_order: number;
  amount_cents: Cents; balance_cents: Cents | null; original_amount_cents: Cents | null; no_of_units: number | null;
  gl_account_id: number | null; post_as: 'DEBIT' | 'CREDIT' | null; post_to_journal: boolean;
  journal_account_type: 'GL' | 'EMPLOYEE'; company_deduction: boolean;
  imprest_no: string | null;
  posting_group_id: number | null; payment_mode: string | null; salary_scale_id: number | null;
  global_dimension_1_id: number | null; global_dimension_2_id: number | null;
  staff_name: string | null; bank_code: string | null; bank_branch: string | null; bank_account_no: string | null;
  created_at: IsoDateTime | null;
}
export interface PayrollPeriodTransactionView extends PayrollPeriodTransaction {
  employee_no: string; employee_first_name: string; employee_last_name: string;
}

export interface PayrollP9Line {
  id: number; employee_id: number; payroll_period_id: number;
  basic_pay_cents: Cents; gross_pay_cents: Cents; taxable_pay_cents: Cents; tax_charged_cents: Cents;
  insurance_relief_cents: Cents; personal_relief_cents: Cents; paye_cents: Cents; nssf_cents: Cents;
  shif_cents: Cents; housing_levy_cents: Cents; deductions_cents: Cents; net_pay_cents: Cents;
  /** P9 columns B, C, the staff pension inside E2, E (lowest of E1/E2/E3), F and J. */
  benefits_cents: Cents; quarters_cents: Cents; pension_cents: Cents; defined_contribution_cents: Cents;
  owner_occupier_interest_cents: Cents; prmf_cents: Cents;
  created_at: IsoDateTime | null;
}
