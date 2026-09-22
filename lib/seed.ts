/*
 * Seeds the school, its chart of accounts, RBAC, every finance/HR setup table, the Kenyan CBC
 * academic structure and (unless SEED_DEMO_DATA=false) a demonstration school: an academic
 * year in progress, classes, teaching staff on the payroll, students with guardians, a term's
 * timetable, registers, marks, a fee structure invoiced and part-paid. Idempotent: skips if the
 * organisation already exists.
 */
import crypto from 'node:crypto';
import { one, all, run, tx, nextSequence, hasAnyRow } from './db.ts';
import { hashPassword } from './auth.ts';
import { PRESETS } from './themes.ts';
import { addMonths } from './dates.ts';
import { expandActionsToLines, type ActionKey } from './permissions.ts';
import { NO_SERIES_DOCUMENTS } from './noSeries.ts';
import * as faLib from './fixedAssets.ts';
import * as faJournalLib from './faJournal.ts';
import * as faDeprLib from './fixedAssetDepreciation.ts';
import * as vendorLib from './vendors.ts';
import * as purchaseLib from './purchaseDocuments.ts';
import * as employees from './employees.ts';
import * as academics from './academics/setup.ts';
import * as teachers from './academics/teachers.ts';
import * as students from './students.ts';
import * as feeSetup from './fees/setup.ts';
import * as feeInvoices from './fees/invoices.ts';
import { createReceipt, postReceipt } from './receipts.ts';
import { createAnnouncement } from './announcements.ts';
import type { Actor, Cents, GlAccountStructureType, GlAccountType, IsoDate, IsoDateTime } from './types.ts';

const K = (n: number): Cents => Math.round(n * 100); // shillings -> cents
const SYS: Actor = { id: 1, username: 'system' };

// deterministic PRNG so demo data is reproducible
let seedState = 20260921;
const rnd = (): number => ((seedState = (seedState * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
const int = (a: number, b: number): number => a + Math.floor(rnd() * (b - a + 1));

type ChartRow = [
  code: string, name: string, type: GlAccountType, parent: string | null, postable: 0 | 1,
  /** Business Central structure type. Omitted rows are Posting (postable) or Heading. */
  accountType?: GlAccountStructureType,
  /** End-Total only — the code range it sums. */
  totaling?: string,
];

/** A school's chart of accounts, bracketed Business Central style so the chart rolls itself up. */
const CHART: ChartRow[] = [
  ['1000', 'CASH AND BANK', 'ASSET', null, 0, 'BEGIN_TOTAL'],
  ['1010', 'Petty Cash', 'ASSET', '1000', 1],
  ['1020', 'Bank Current Account', 'ASSET', '1000', 1],
  ['1030', 'M-Pesa Paybill Account', 'ASSET', '1000', 1],
  ['1040', 'Bank Savings Account', 'ASSET', '1000', 1],
  ['1099', 'CASH AND BANK  TOTALS', 'ASSET', null, 0, 'END_TOTAL', '1000..1099'],
  ['1200', 'RECEIVABLES AND OTHER ASSETS', 'ASSET', null, 0, 'BEGIN_TOTAL'],
  ['1210', 'School Fees Receivable', 'ASSET', '1200', 1],
  ['1215', 'Staff Imprests and Advances', 'ASSET', '1200', 1],
  ['1220', 'Prepayments and Deposits', 'ASSET', '1200', 1],
  ['1250', 'Trade Receivables — Other Customers', 'ASSET', '1200', 1],
  ['1260', 'Input VAT (Recoverable)', 'ASSET', '1200', 1],
  ['1270', 'Inventory — Stores and Supplies', 'ASSET', '1200', 1],
  ['1290', 'Allowance for Doubtful Fees', 'ASSET', '1200', 1],
  ['1299', 'RECEIVABLES AND OTHER ASSETS  TOTALS', 'ASSET', null, 0, 'END_TOTAL', '1200..1299'],
  ['1400', 'PROPERTY, PLANT AND EQUIPMENT', 'ASSET', null, 0, 'BEGIN_TOTAL'],
  ['1410', 'Land and Buildings at Cost', 'ASSET', '1400', 1],
  ['1415', 'Accum. Depreciation — Buildings', 'ASSET', '1400', 1],
  ['1420', 'Furniture, Fittings & Equipment at Cost', 'ASSET', '1400', 1],
  ['1425', 'Accum. Depreciation — Furniture, Fittings & Equipment', 'ASSET', '1400', 1],
  ['1430', 'Motor Vehicles (School Transport) at Cost', 'ASSET', '1400', 1],
  ['1435', 'Accum. Depreciation — Motor Vehicles', 'ASSET', '1400', 1],
  ['1440', 'Computers and ICT Equipment at Cost', 'ASSET', '1400', 1],
  ['1445', 'Accum. Depreciation — Computers and ICT', 'ASSET', '1400', 1],
  ['1499', 'PROPERTY, PLANT AND EQUIPMENT  TOTALS', 'ASSET', null, 0, 'END_TOTAL', '1400..1499'],
  ['2000', 'CURRENT LIABILITIES', 'LIABILITY', null, 0, 'BEGIN_TOTAL'],
  ['2010', 'Accounts Payable and Accruals', 'LIABILITY', '2000', 1],
  ['2020', 'Fees Received in Advance', 'LIABILITY', '2000', 1],
  ['2030', 'Caution Money and Student Deposits', 'LIABILITY', '2000', 1],
  ['2040', 'Output VAT Payable', 'LIABILITY', '2000', 1],
  ['2050', 'Withholding Tax Payable', 'LIABILITY', '2000', 1],
  ['2055', 'Withholding VAT Payable', 'LIABILITY', '2000', 1],
  ['2099', 'CURRENT LIABILITIES  TOTALS', 'LIABILITY', null, 0, 'END_TOTAL', '2000..2099'],
  ['2100', 'TRADE AND OTHER PAYABLES', 'LIABILITY', null, 0, 'BEGIN_TOTAL'],
  ['2150', 'Trade Payables — Vendors', 'LIABILITY', '2100', 1],
  ['2160', 'Goods Received Not Invoiced', 'LIABILITY', '2100', 1],
  ['2170', 'Cheques Not Presented', 'LIABILITY', '2100', 1],
  ['2199', 'TRADE AND OTHER PAYABLES  TOTALS', 'LIABILITY', null, 0, 'END_TOTAL', '2100..2199'],
  ['2200', 'PAYROLL LIABILITIES', 'LIABILITY', null, 0, 'BEGIN_TOTAL'],
  ['2210', 'Net Salaries Payable', 'LIABILITY', '2200', 1],
  ['2220', 'PAYE Payable', 'LIABILITY', '2200', 1],
  ['2230', 'NSSF Payable', 'LIABILITY', '2200', 1],
  ['2240', 'SHIF Payable', 'LIABILITY', '2200', 1],
  ['2250', 'Affordable Housing Levy Payable', 'LIABILITY', '2200', 1],
  ['2260', 'Pension Contributions Payable', 'LIABILITY', '2200', 1],
  ['2299', 'PAYROLL LIABILITIES  TOTALS', 'LIABILITY', null, 0, 'END_TOTAL', '2200..2299'],
  ['2300', 'LONG-TERM LIABILITIES', 'LIABILITY', null, 0, 'BEGIN_TOTAL'],
  ['2310', 'Bank Loans', 'LIABILITY', '2300', 1],
  ['2399', 'LONG-TERM LIABILITIES  TOTALS', 'LIABILITY', null, 0, 'END_TOTAL', '2300..2399'],
  ['3000', 'CAPITAL AND FUNDS', 'EQUITY', null, 0, 'BEGIN_TOTAL'],
  ['3010', 'Capital Fund', 'EQUITY', '3000', 1],
  ['3020', 'Development Fund', 'EQUITY', '3000', 1],
  ['3030', 'Accumulated Fund (Retained Surplus)', 'EQUITY', '3000', 1],
  ['3099', 'CAPITAL AND FUNDS  TOTALS', 'EQUITY', null, 0, 'END_TOTAL', '3000..3099'],
  ['4000', 'FEE INCOME', 'INCOME', null, 0, 'BEGIN_TOTAL'],
  ['4010', 'Tuition Fees', 'INCOME', '4000', 1],
  ['4020', 'Boarding Fees', 'INCOME', '4000', 1],
  ['4030', 'Lunch Programme Fees', 'INCOME', '4000', 1],
  ['4040', 'Transport Fees', 'INCOME', '4000', 1],
  ['4050', 'Activity and Co-curricular Fees', 'INCOME', '4000', 1],
  ['4060', 'Examination and Assessment Fees', 'INCOME', '4000', 1],
  ['4070', 'Admission and Registration Fees', 'INCOME', '4000', 1],
  ['4080', 'Uniform, Books and Stationery Sales', 'INCOME', '4000', 1],
  ['4099', 'FEE INCOME  TOTALS', 'INCOME', null, 0, 'END_TOTAL', '4000..4099'],
  ['4100', 'OTHER INCOME', 'INCOME', null, 0, 'BEGIN_TOTAL'],
  ['4110', 'Government Capitation Grants', 'INCOME', '4100', 1],
  ['4120', 'Donations and Fundraising', 'INCOME', '4100', 1],
  ['4130', 'Hall and Facility Hire', 'INCOME', '4100', 1],
  ['4140', 'Interest Income', 'INCOME', '4100', 1],
  ['4150', 'Late Payment and Reminder Fees', 'INCOME', '4100', 1],
  ['4160', 'Interest on Overdue Fees', 'INCOME', '4100', 1],
  ['4170', 'Gain on Disposal of Property & Equipment', 'INCOME', '4100', 1],
  ['4180', 'Realized Exchange Gain', 'INCOME', '4100', 1],
  ['4185', 'Unrealized Exchange Gain', 'INCOME', '4100', 1],
  ['4190', 'Other Income', 'INCOME', '4100', 1],
  ['4199', 'OTHER INCOME  TOTALS', 'INCOME', null, 0, 'END_TOTAL', '4100..4199'],
  ['5000', 'STAFF COSTS', 'EXPENSE', null, 0, 'BEGIN_TOTAL'],
  ['5010', 'Teaching Staff Salaries', 'EXPENSE', '5000', 1],
  ['5020', 'Non-Teaching Staff Salaries', 'EXPENSE', '5000', 1],
  ['5030', 'Employer NSSF Contributions', 'EXPENSE', '5000', 1],
  ['5035', 'Employer Housing Levy', 'EXPENSE', '5000', 1],
  ['5040', 'Staff Welfare and Medical', 'EXPENSE', '5000', 1],
  ['5050', 'Staff Training and Development', 'EXPENSE', '5000', 1],
  ['5099', 'STAFF COSTS  TOTALS', 'EXPENSE', null, 0, 'END_TOTAL', '5000..5099'],
  ['5100', 'ACADEMIC EXPENSES', 'EXPENSE', null, 0, 'BEGIN_TOTAL'],
  ['5110', 'Teaching and Learning Materials', 'EXPENSE', '5100', 1],
  ['5120', 'Examination Expenses', 'EXPENSE', '5100', 1],
  ['5130', 'Co-curricular Activities', 'EXPENSE', '5100', 1],
  ['5140', 'Library and ICT Resources', 'EXPENSE', '5100', 1],
  ['5199', 'ACADEMIC EXPENSES  TOTALS', 'EXPENSE', null, 0, 'END_TOTAL', '5100..5199'],
  ['5200', 'OPERATING EXPENSES', 'EXPENSE', null, 0, 'BEGIN_TOTAL'],
  ['5210', 'Food and Catering', 'EXPENSE', '5200', 1],
  ['5220', 'Transport, Fuel and Vehicle Running', 'EXPENSE', '5200', 1],
  ['5230', 'Electricity, Water and Utilities', 'EXPENSE', '5200', 1],
  ['5240', 'Repairs and Maintenance', 'EXPENSE', '5200', 1],
  ['5250', 'Administrative Expenses', 'EXPENSE', '5200', 1],
  ['5255', 'Cost of Goods Sold', 'EXPENSE', '5200', 1],
  ['5260', 'Insurance', 'EXPENSE', '5200', 1],
  ['5270', 'Professional and Audit Fees', 'EXPENSE', '5200', 1],
  ['5280', 'Bank Charges', 'EXPENSE', '5200', 1],
  ['5290', 'Depreciation Expense', 'EXPENSE', '5200', 1],
  ['5292', 'Loss on Disposal of Property & Equipment', 'EXPENSE', '5200', 1],
  ['5294', 'Realized Exchange Loss', 'EXPENSE', '5200', 1],
  ['5296', 'Unrealized Exchange Loss', 'EXPENSE', '5200', 1],
  ['5298', 'Bad Debts — Fees Written Off', 'EXPENSE', '5200', 1],
  ['5299', 'OPERATING EXPENSES  TOTALS', 'EXPENSE', null, 0, 'END_TOTAL', '5200..5299'],
  ['5300', 'GOVERNANCE', 'EXPENSE', null, 0, 'BEGIN_TOTAL'],
  ['5310', 'Board of Management Expenses', 'EXPENSE', '5300', 1],
  ['5399', 'GOVERNANCE  TOTALS', 'EXPENSE', null, 0, 'END_TOTAL', '5300..5399'],
];

interface RoleSeed {
  name: string;
  description: string;
  /** Which named actions (see lib/permissions.ts) this role's Permission Set lines
   *  are expanded from. System Administrator gets none — is_system implies full access. */
  actions: ActionKey[];
}

const ACADEMICS: ActionKey[] = [
  'STUDENTS_READ', 'STUDENTS_CREATE', 'STUDENTS_UPDATE', 'GUARDIANS_READ', 'GUARDIANS_MANAGE', 'TEACHERS_READ', 'TEACHERS_MANAGE',
  'CLASSES_READ', 'CLASSES_MANAGE', 'TIMETABLE_READ', 'TIMETABLE_MANAGE', 'ATTENDANCE_READ', 'ATTENDANCE_MARK',
  'ASSESSMENTS_READ', 'ASSESSMENTS_ENTER', 'REPORT_CARDS_READ', 'REPORT_CARDS_PUBLISH', 'ANNOUNCEMENTS_READ', 'ANNOUNCEMENTS_MANAGE',
  'ADMIN_ACADEMIC_YEARS_MANAGE', 'ADMIN_ACADEMIC_STRUCTURE_MANAGE', 'ADMIN_SUBJECTS_MANAGE', 'ADMIN_GRADING_MANAGE', 'ADMIN_ASSESSMENT_TYPES_MANAGE',
];
const FEES: ActionKey[] = ['FEES_READ', 'FEES_STRUCTURE_MANAGE', 'FEES_INVOICE_RUN', 'FEES_REMIND', 'ADMIN_FEE_ITEMS_MANAGE', 'MPESA_READ', 'MPESA_INITIATE', 'MPESA_ALLOCATE'];
const FINANCE: ActionKey[] = [
  'GL_READ', 'GL_JOURNAL_CREATE', 'GL_JOURNAL_APPROVE', 'GL_JOURNAL_REVERSE', 'GL_PERIOD_CLOSE', 'GL_PERIOD_CREATE', 'GL_CLOSE_INCOME_STATEMENT', 'GL_ACCOUNT_MANAGE', 'GL_BANK_RECONCILE',
  'GL_BUDGETS_READ', 'GL_BUDGETS_MANAGE', 'FINANCIAL_REPORTS_READ', 'FINANCIAL_REPORTS_MANAGE', 'REPORTS_VIEW',
  'RECEIVABLES_READ', 'RECEIVABLES_CUSTOMER_MANAGE', 'RECEIVABLES_SETUP_MANAGE', 'RECEIVABLES_SALES_CREATE', 'RECEIVABLES_SALES_APPROVE', 'RECEIVABLES_SALES_POST', 'RECEIVABLES_REMINDER_MANAGE', 'RECEIVABLES_APPLY_ENTRIES',
  'PAYABLES_READ', 'PAYABLES_VENDOR_MANAGE', 'PAYABLES_SETUP_MANAGE', 'PAYABLES_PURCHASE_CREATE', 'PAYABLES_PURCHASE_APPROVE', 'PAYABLES_PURCHASE_POST', 'PAYABLES_APPLY_ENTRIES',
  'CASH_MGMT_READ', 'CASH_MGMT_BANK_MANAGE', 'CASH_MGMT_SETUP_MANAGE', 'CASH_MGMT_CURRENCY_MANAGE', 'CASH_MGMT_RECONCILE', 'CASH_MGMT_FX_ADJUST',
  'CASH_MGMT_RECEIPT_CREATE', 'CASH_MGMT_RECEIPT_APPROVE', 'CASH_MGMT_RECEIPT_POST', 'CASH_MGMT_PV_CREATE', 'CASH_MGMT_PV_APPROVE', 'CASH_MGMT_PV_POST', 'CASH_MGMT_APPLY_ENTRIES',
  'VAT_REPORT_READ', 'VAT_SETUP_MANAGE', 'WHT_CERTIFICATE_PRINT', 'WHT_MARK_REMITTED', 'CURRENCY_SETUP_MANAGE',
  'INVENTORY_READ', 'INVENTORY_ITEM_MANAGE', 'INVENTORY_SETUP_MANAGE', 'INVENTORY_JOURNAL_CREATE', 'INVENTORY_JOURNAL_APPROVE', 'INVENTORY_JOURNAL_POST',
  'FIXED_ASSETS_READ', 'FIXED_ASSETS_ASSET_MANAGE', 'FIXED_ASSETS_SETUP_MANAGE', 'FIXED_ASSETS_JOURNAL_CREATE', 'FIXED_ASSETS_JOURNAL_APPROVE', 'FIXED_ASSETS_JOURNAL_POST', 'FIXED_ASSETS_DEPRECIATION_RUN',
  'IMPREST_READ', 'IMPREST_CREATE', 'IMPREST_APPROVE', 'IMPREST_ISSUE', 'IMPREST_POST', 'IMPREST_PAYROLL_RECOVER', 'ADMIN_POOL_IMPREST_PURPOSES_MANAGE',
  'REQUISITIONS_READ', 'REQUISITIONS_CREATE', 'REQUISITIONS_APPROVE', 'REQUISITIONS_ISSUE', 'REQUISITIONS_PROCESS',
  'ADMIN_NO_SERIES_READ', 'ADMIN_NO_SERIES_MANAGE',
];
const HR: ActionKey[] = [
  'EMPLOYEES_READ', 'EMPLOYEES_CREATE', 'EMPLOYEES_APPROVE', 'EMPLOYEE_EDITS_READ', 'EMPLOYEE_EDITS_UPDATE', 'EMPLOYEE_EDITS_DELETE', 'EMPLOYEE_EDITS_APPROVE',
  'EMPLOYEE_CONTRACT_CHANGES_READ', 'EMPLOYEE_CONTRACT_CHANGES_CREATE', 'EMPLOYEE_CONTRACT_CHANGES_APPROVE',
  'EMPLOYEE_EXITS_READ', 'EMPLOYEE_EXITS_CREATE', 'EMPLOYEE_EXITS_APPROVE', 'EMPLOYEE_EXITS_CLEAR',
  'HR_JOB_GRADES_READ', 'HR_JOB_GRADES_MANAGE', 'HR_SALARY_SCALES_READ', 'HR_SALARY_SCALES_MANAGE', 'HR_CONTRACT_TYPES_READ', 'HR_CONTRACT_TYPES_MANAGE',
  'HR_TERMINATION_REASONS_READ', 'HR_TERMINATION_REASONS_MANAGE', 'HR_CLEARANCE_SECTIONS_READ', 'HR_CLEARANCE_SECTIONS_MANAGE',
  'COMPANY_JOBS_READ', 'COMPANY_JOBS_CREATE', 'COMPANY_JOBS_APPROVE', 'ORGANOGRAM_VIEW',
  'LEAVE_APPLICATIONS_READ', 'LEAVE_APPLICATIONS_CREATE', 'LEAVE_APPLICATIONS_APPROVE', 'LEAVE_ADJUSTMENTS_READ', 'LEAVE_ADJUSTMENTS_CREATE', 'LEAVE_ADJUSTMENTS_APPROVE',
  'LEAVE_RECALLS_READ', 'LEAVE_RECALLS_CREATE', 'LEAVE_RECALLS_APPROVE', 'LEAVE_PLANS_READ', 'LEAVE_PLANS_CREATE', 'LEAVE_PLANS_APPROVE',
  'HR_LEAVE_TYPES_READ', 'HR_LEAVE_TYPES_MANAGE', 'HR_LEAVE_CALENDAR_READ', 'HR_LEAVE_CALENDAR_MANAGE', 'HR_HOLIDAYS_READ', 'HR_HOLIDAYS_MANAGE', 'HR_ACCRUE_MATRIX_READ', 'HR_ACCRUE_MATRIX_MANAGE', 'HR_LEAVE_ACCRUAL_RUN',
  'PAYROLL_READ', 'PAYROLL_MANAGE_TRANSACTIONS', 'PAYROLL_PERIODS_READ', 'PAYROLL_PERIODS_CREATE', 'PAYROLL_PERIODS_RUN', 'PAYROLL_PERIODS_APPROVE', 'PAYROLL_PERIODS_CLOSE',
  'PAYROLL_SETUP_READ', 'PAYROLL_SETUP_MANAGE', 'PAYROLL_POSTING_GROUPS_READ', 'PAYROLL_POSTING_GROUPS_MANAGE', 'PAYROLL_PAYE_BANDS_READ', 'PAYROLL_PAYE_BANDS_MANAGE',
  'PAYROLL_NSSF_TIERS_READ', 'PAYROLL_NSSF_TIERS_MANAGE', 'PAYROLL_TRANSACTION_CODES_READ', 'PAYROLL_TRANSACTION_CODES_MANAGE',
];
const SELF_SERVICE: ActionKey[] = [
  'SELF_SERVICE_VIEW', 'SELF_SERVICE_PAYSLIP_READ', 'SELF_SERVICE_P9_READ', 'SELF_SERVICE_RECORD_READ', 'SELF_SERVICE_RECORD_UPDATE', 'SELF_SERVICE_RECORD_DELETE',
  'SELF_SERVICE_LEAVE_READ', 'SELF_SERVICE_LEAVE_CREATE', 'SELF_SERVICE_LEAVE_PLANS_READ', 'SELF_SERVICE_LEAVE_PLANS_CREATE',
  'SELF_SERVICE_IMPREST_READ', 'SELF_SERVICE_IMPREST_CREATE', 'SELF_SERVICE_PETTY_CASH_READ', 'SELF_SERVICE_PETTY_CASH_CREATE',
  'SELF_SERVICE_REQUISITIONS_READ', 'SELF_SERVICE_REQUISITIONS_CREATE',
];
const COMMON: ActionKey[] = ['DASHBOARD_VIEW', 'APPROVALS_VIEW', 'ANNOUNCEMENTS_READ'];

export const ROLES: RoleSeed[] = [
  { name: 'System Administrator', description: 'Full access including configuration and security.', actions: [] },
  {
    name: 'Principal',
    description: 'Runs the school: every academic module, fee oversight, HR approvals, reports and the approvals queue.',
    actions: [...COMMON, ...ACADEMICS, 'FEES_READ', 'FEES_REMIND', 'MPESA_READ', 'REPORTS_VIEW', 'GL_READ', 'FINANCIAL_REPORTS_READ', 'CASH_MGMT_READ', 'RECEIVABLES_READ', 'PAYABLES_READ',
      'CASH_MGMT_RECEIPT_APPROVE', 'CASH_MGMT_PV_APPROVE', 'RECEIVABLES_SALES_APPROVE', 'PAYABLES_PURCHASE_APPROVE', 'GL_JOURNAL_APPROVE',
      'EMPLOYEES_READ', 'EMPLOYEES_APPROVE', 'EMPLOYEE_EDITS_READ', 'EMPLOYEE_EDITS_APPROVE', 'EMPLOYEE_CONTRACT_CHANGES_READ', 'EMPLOYEE_CONTRACT_CHANGES_APPROVE',
      'EMPLOYEE_EXITS_READ', 'EMPLOYEE_EXITS_APPROVE', 'LEAVE_APPLICATIONS_READ', 'LEAVE_APPLICATIONS_APPROVE', 'LEAVE_PLANS_READ', 'LEAVE_PLANS_APPROVE',
      'PAYROLL_READ', 'PAYROLL_PERIODS_READ', 'PAYROLL_PERIODS_APPROVE', 'IMPREST_READ', 'IMPREST_APPROVE', 'REQUISITIONS_READ', 'REQUISITIONS_APPROVE', 'ORGANOGRAM_VIEW',
      ...SELF_SERVICE, 'ADMIN_AUDIT_VIEW'],
  },
  {
    name: 'Academics Officer',
    description: 'The registrar / dean: admissions, classes, timetables, registers, marks and report cards.',
    actions: [...COMMON, ...ACADEMICS, 'FEES_READ', ...SELF_SERVICE],
  },
  {
    name: 'Teacher',
    description: 'Teaching staff: their own classes, registers, marks and announcements, plus Employee Self Service.',
    actions: [...COMMON, 'TEACHER_PORTAL_VIEW', 'TEACHER_PORTAL_ATTENDANCE', 'TEACHER_PORTAL_ASSESSMENTS', 'TEACHER_PORTAL_ANNOUNCE', 'TIMETABLE_READ', ...SELF_SERVICE],
  },
  {
    name: 'Bursar',
    description: 'Fees, receipts, M-Pesa, receivables and the cash office.',
    actions: [...COMMON, ...FEES, 'STUDENTS_READ', 'GUARDIANS_READ', 'CLASSES_READ',
      'RECEIVABLES_READ', 'RECEIVABLES_CUSTOMER_MANAGE', 'RECEIVABLES_SALES_CREATE', 'RECEIVABLES_SALES_POST', 'RECEIVABLES_REMINDER_MANAGE', 'RECEIVABLES_APPLY_ENTRIES',
      'CASH_MGMT_READ', 'CASH_MGMT_RECEIPT_CREATE', 'CASH_MGMT_RECEIPT_POST', 'CASH_MGMT_PV_CREATE', 'CASH_MGMT_APPLY_ENTRIES', 'CASH_MGMT_RECONCILE', 'CASH_MGMT_BANK_MANAGE',
      'PAYABLES_READ', 'PAYABLES_PURCHASE_CREATE', 'GL_READ', 'REPORTS_VIEW', 'IMPREST_READ', 'IMPREST_CREATE', 'IMPREST_ISSUE', 'IMPREST_POST', ...SELF_SERVICE],
  },
  {
    name: 'Accountant',
    description: 'The ledger: journals, periods, payables, fixed assets, inventory, budgets, tax and the financial statements.',
    actions: [...COMMON, ...FINANCE, 'STUDENTS_READ', 'FEES_READ', 'MPESA_READ', 'ADMIN_POOL_DIMENSIONS_MANAGE', 'ADMIN_CHANGE_LOG_MANAGE', ...SELF_SERVICE],
  },
  {
    name: 'HR & Payroll Officer',
    description: 'Employee records, leave and payroll processing.',
    actions: [...COMMON, ...HR, 'TEACHERS_READ', 'IMPREST_READ', 'IMPREST_PAYROLL_RECOVER', ...SELF_SERVICE],
  },
  {
    name: 'Employee Self Service',
    description: 'Your own payslips, P9, leave, imprests, petty cash and requisitions.',
    actions: [...COMMON, ...SELF_SERVICE],
  },
  {
    name: 'Student / Parent',
    description: 'The Student / Parent portal: timetable, grades, attendance, fees and announcements for your own child(ren).',
    actions: ['STUDENT_PORTAL_VIEW', 'STUDENT_PORTAL_PAY', 'ANNOUNCEMENTS_READ'],
  },
  {
    name: 'Internal Auditor',
    description: 'Read-only across the school, including the audit trail.',
    actions: [...COMMON, 'STUDENTS_READ', 'GUARDIANS_READ', 'TEACHERS_READ', 'CLASSES_READ', 'TIMETABLE_READ', 'ATTENDANCE_READ', 'ASSESSMENTS_READ', 'REPORT_CARDS_READ',
      'FEES_READ', 'MPESA_READ', 'GL_READ', 'GL_BUDGETS_READ', 'FINANCIAL_REPORTS_READ', 'REPORTS_VIEW', 'RECEIVABLES_READ', 'PAYABLES_READ', 'CASH_MGMT_READ', 'VAT_REPORT_READ',
      'INVENTORY_READ', 'FIXED_ASSETS_READ', 'IMPREST_READ', 'REQUISITIONS_READ', 'EMPLOYEES_READ', 'PAYROLL_READ', 'PAYROLL_PERIODS_READ', 'LEAVE_APPLICATIONS_READ',
      'ADMIN_AUDIT_VIEW', 'ADMIN_PROFILES_READ', 'ADMIN_NO_SERIES_READ', 'ORGANOGRAM_VIEW'],
  },
];

export interface SeedResult {
  seeded: boolean;
  demo?: boolean;
  students?: number;
  teachers?: number;
  adminPassword?: string;
}

/** SEED_DEMO_DATA decides; unset = demo everywhere but production. */
const demoSeedWanted = (): boolean => {
  const v = process.env.SEED_DEMO_DATA?.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return process.env.NODE_ENV !== 'production';
};

/** The demonstration school is pending while the setup data exists but no academic year does. */
const demoPending = async (): Promise<boolean> => !(await hasAnyRow('academic_year'));

export async function seedIfEmpty(): Promise<SeedResult> {
  const now = new Date().toISOString();
  const todayIso = now.slice(0, 10);
  const demo = demoSeedWanted();

  /*
   * Two committed stages, each one transaction (service calls nest into SAVEPOINTs, so a
   * stage is still all-or-nothing): the setup data, then the demonstration school. A first
   * boot that dies in the second stage — a remote database over a slow link can take the best
   * part of an hour to post a school's worth of fee invoices — leaves the setup in place and
   * the next call resumes with the school alone rather than starting over or, worse, treating
   * the half-seeded database as seeded.
   */
  const hasOrg = (await one<{ c: number }>('SELECT COUNT(*) c FROM organisation'))!.c > 0;
  if (hasOrg && (!demo || !(await demoPending()))) return { seeded: false };

  let hardened: Pick<SeedResult, 'adminPassword'> = {};
  if (!hasOrg) {
    hardened = await tx(async () => {
      await seedReferenceData(now, todayIso);
      return demo ? {} : hardenForProduction();
    }, { timeout: Number(process.env.SEED_TX_TIMEOUT_MS) || 3_600_000 });
    if (!demo) return { seeded: true, demo, ...hardened };
  }

  const counts = await tx(async () => {
    const result = await seedDemoSchool(now, todayIso);
    await seedFixedAssets(now, todayIso);
    await seedPayables(now, todayIso);
    return result;
  }, { timeout: Number(process.env.SEED_TX_TIMEOUT_MS) || 3_600_000 });

  return { seeded: true, demo, ...counts };
}

/**
 * A production first boot keeps the roles, chart of accounts and setups that seedReferenceData()
 * lays down, but not its sign-ins: the demonstration staff are disabled, and `admin` gets
 * ADMIN_INITIAL_PASSWORD or, failing that, a random one that is logged exactly once at boot for
 * the person doing the install to change straight away.
 */
async function hardenForProduction(): Promise<Pick<SeedResult, 'adminPassword'>> {
  await run("UPDATE app_user SET status = 'DISABLED' WHERE username <> 'admin'");
  const configured = process.env.ADMIN_INITIAL_PASSWORD?.trim();
  const password = configured || crypto.randomBytes(12).toString('base64url');
  await run("UPDATE app_user SET password_hash = ?, must_change_password = true WHERE username = 'admin'", hashPassword(password));
  return configured ? {} : { adminPassword: password };
}

/* ================================================================== reference data */

const acc = async (code: string): Promise<number> =>
  (await one<{ id: number }>('SELECT id FROM gl_account WHERE code = ?', code))!.id;

async function seedReferenceData(now: IsoDateTime, todayIso: IsoDate): Promise<void> {
  const INS_SEQ = 'INSERT INTO sequence (name, prefix, next_no, width) VALUES (?,?,?,?)';
  const SEQUENCES: [string, string, number, number][] = [
    ['STUDENT', 'ADM', 1001, 5], ['FEE_INVOICE_RUN', 'FEE', 1, 5],
    ['JOURNAL', 'JV', 1, 8], ['JOURNAL_DRAFT', 'JVD', 1, 6],
    ['ITEM', 'ITM', 1, 6], ['ITEM_JOURNAL', 'IJL', 1, 6], ['FIXED_ASSET', 'FA', 1, 6], ['FA_JOURNAL', 'FAJ', 1, 6],
    ['CUSTOMER', 'C', 1001, 5], ['SALES_QUOTE', 'SQ', 1, 6], ['SALES_ORDER', 'SO', 1, 6], ['SALES_INVOICE', 'SI', 1, 6], ['SALES_CREDIT_MEMO', 'SM', 1, 6],
    ['POSTED_SALES_SHIPMENT', 'PSHP', 1, 6], ['POSTED_SALES_INVOICE', 'PSI', 1, 6], ['POSTED_SALES_CREDIT_MEMO', 'PSM', 1, 6],
    ['REMINDER', 'REM', 1, 6], ['FIN_CHARGE_MEMO', 'FCM', 1, 6],
    ['VENDOR', 'V', 1001, 5], ['PURCHASE_QUOTE', 'PQ', 1, 6], ['PURCHASE_ORDER', 'PO', 1, 6], ['PURCHASE_INVOICE', 'PI', 1, 6], ['PURCHASE_CREDIT_MEMO', 'PM', 1, 6],
    ['POSTED_PURCHASE_RECEIPT', 'PRCP', 1, 6], ['POSTED_PURCHASE_INVOICE', 'PPI', 1, 6], ['POSTED_PURCHASE_CREDIT_MEMO', 'PPM', 1, 6],
    ['RECEIPT', 'RCT', 1, 6], ['POSTED_RECEIPT', 'PRCT', 1, 6], ['PAYMENT_VOUCHER', 'PV', 1, 6], ['POSTED_PAYMENT_VOUCHER', 'PPV', 1, 6],
    ['BANK_RECONCILIATION', 'BREC', 1, 6], ['WHT_CERTIFICATE', 'WHT', 1, 6],
    ['IMPREST_REQUEST', 'IMP', 1, 5], ['PETTY_CASH', 'PC', 1, 5], ['STAFF_CLAIM', 'SC', 1, 5],
    ['STORE_REQUISITION', 'SRQ', 1, 5], ['PURCHASE_REQUISITION', 'PRQ', 1, 5],
    ['EMPLOYEE', 'EMP', 1, 4], ['EMPLOYEE_EDIT', 'EDT', 1, 6], ['EMPLOYEE_CONTRACT_CHANGE', 'ECC', 1, 6], ['EMPLOYEE_EXIT', 'EXT', 1, 6], ['COMPANY_JOB', 'JOB', 1, 4],
    ['LEAVE_APPLICATION', 'LVA', 1, 6], ['LEAVE_ADJUSTMENT', 'LVJ', 1, 6], ['LEAVE_RECALL', 'LVR', 1, 6], ['LEAVE_PLAN', 'LVP', 1, 6],
  ];
  for (const s of SEQUENCES) await run(INS_SEQ, ...s);

  // Business Central No. Series — mirror every flat counter into a managed series (code ==
  // document code) plus its Admin Centre → No. Series assignment row. From here on the services'
  // nextSequence() calls draw from these; the `sequence` rows above are the fall-back only.
  for (const doc of NO_SERIES_DOCUMENTS) {
    const seq = await one<{ prefix: string; next_no: number; width: number }>('SELECT prefix, next_no, width FROM sequence WHERE name = ?', doc.code);
    if (!seq) continue;
    const startNo = seq.prefix + String(seq.next_no).padStart(seq.width, '0');
    await run('INSERT INTO no_series (code, description, default_nos, manual_nos, date_order) VALUES (?,?,1,0,0) ON CONFLICT (code) DO NOTHING', doc.code, doc.label);
    await run(
      `INSERT INTO no_series_line (series_code, line_no, starting_date, starting_no, increment_by_no, open, allow_gaps) VALUES (?, 10000, NULL, ?, 1, 1, 0)`,
      doc.code, startNo,
    );
    await run(
      `INSERT INTO no_series_setup (document_code, label, category, sort, series_code) VALUES (?,?,?,?,?) ON CONFLICT (document_code) DO NOTHING`,
      doc.code, doc.label, doc.category, NO_SERIES_DOCUMENTS.indexOf(doc), doc.code,
    );
  }

  await run(
    `INSERT INTO organisation (id, name, short_name, motto, registration_no, sasra_licence_no, kra_pin,
      society_type, physical_address, postal_address, city, county, country, phone_primary, phone_secondary,
      email, website, paybill_no, bank_name, bank_account_no, currency_code, currency_symbol, locale, timezone,
      date_format, fy_start_month, fy_start_day, statement_footer, receipt_approval_limit, petty_cash_limit, updated_at, updated_by)
     VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    'Nairobi Green Valley Academy', 'Green Valley Academy', 'Knowledge, Character, Excellence',
    'MOE/PS/2016/1187', 'PRI/2016/00417', 'P051987654W', 'Private Composite School',
    'Green Valley Road, off Kiambu Road', 'P.O. Box 30871–00100', 'Nairobi', 'Nairobi', 'Kenya',
    '+254 700 100 200', '+254 20 260 0100', 'info@greenvalley.ac.ke', 'www.greenvalley.ac.ke',
    '522533', 'Co-operative Bank of Kenya', '01129087654321',
    'KES', 'KSh', 'en-KE', 'Africa/Nairobi', 'dd MMM yyyy', 1, 1,
    'Fees are payable in full by the first day of term. Please quote the admission number on every payment.',
    K(50000), K(20000), now, 'system',
  );
  await run('INSERT INTO company (code, schema_name, display_name, is_default, created_at, created_by) VALUES (?,?,?,true,?,?)',
    'MAIN', 'public', 'Nairobi Green Valley Academy', now, 'system');
  await run('INSERT INTO theme (id, preset, tokens, updated_at, updated_by) VALUES (1,?,?,?,?)', 'sacco-blue', JSON.stringify(PRESETS['sacco-blue']?.tokens ?? PRESETS['emerald-standard'].tokens), now, 'system');

  const INS_ACC = `INSERT INTO gl_account (code, name, type, parent_code, is_postable, account_type, totaling) VALUES (?,?,?,?,?,?,?)`;
  for (const [code, name, type, parent, postable, accountType, totaling] of CHART) {
    await run(INS_ACC, code, name, type, parent, postable, accountType ?? (postable ? 'POSTING' : 'HEADING'), totaling ?? null);
  }
  await indentSeededChart();

  // Roles and their Permission Set lines.
  const INS_ROLE = 'INSERT INTO role (name, description, is_system) VALUES (?,?,?)';
  const INS_LINE = `INSERT INTO permission_set_line (role_id, object_type, object_name, read_perm, insert_perm, modify_perm, delete_perm, execute_perm) VALUES (?,?,?,?,?,?,?,?)`;
  for (const r of ROLES) {
    const isSystem = r.name === 'System Administrator';
    const info = await run(INS_ROLE, r.name, r.description, isSystem ? 1 : 0);
    for (const line of expandActionsToLines(Number(info.lastInsertRowid), [...new Set(r.actions)])) {
      await run(INS_LINE, line.role_id, line.object_type, line.object_name, line.read ? 1 : 0, line.insert ? 1 : 0, line.modify ? 1 : 0, line.delete ? 1 : 0, line.execute ? 1 : 0);
    }
  }
  const roleId = async (n: string): Promise<number> => (await one<{ id: number }>('SELECT id FROM role WHERE name = ?', n))!.id;

  const INS_USER = `INSERT INTO app_user (username, full_name, email, phone, password_hash, role_id, created_at) VALUES (?,?,?,?,?,?,?)`;
  const users: [string, string, string, string, string][] = [
    ['admin', 'Cosmas Rono', 'admin@greenvalley.ac.ke', 'System Administrator', 'admin123'],
    ['principal', 'Dr. Beatrice Njeri', 'principal@greenvalley.ac.ke', 'Principal', 'principal123'],
    ['registrar', 'Dennis Kiptoo', 'registrar@greenvalley.ac.ke', 'Academics Officer', 'registrar123'],
    ['teacher', 'Peter Otieno', 'p.otieno@greenvalley.ac.ke', 'Teacher', 'teacher123'],
    ['bursar', 'Purity Wanjiku', 'bursar@greenvalley.ac.ke', 'Bursar', 'bursar123'],
    ['accountant', 'Samuel Otieno', 'accounts@greenvalley.ac.ke', 'Accountant', 'accountant123'],
    ['hr', 'Lydia Chebet', 'hr@greenvalley.ac.ke', 'HR & Payroll Officer', 'hr123'],
    ['parent', 'James Mwangi', 'james.mwangi@mail.co.ke', 'Student / Parent', 'parent123'],
    ['student', 'Brian Mwangi', 'brian.mwangi@student.greenvalley.ac.ke', 'Student / Parent', 'student123'],
    ['auditor', 'Grace Achieng', 'audit@greenvalley.ac.ke', 'Internal Auditor', 'auditor123'],
  ];
  for (const [un, fn, em, role, pw] of users) {
    await run(INS_USER, un, fn, em, '+254 7' + int(10000000, 99999999), hashPassword(pw), await roleId(role), now);
  }
  const userId = async (un: string): Promise<number> => (await one<{ id: number }>('SELECT id FROM app_user WHERE username = ?', un))!.id;

  // User Setup: the approval administrator fallback, and who may reverse a journal.
  await run('INSERT INTO approval_user_setup (user_id, is_approval_administrator, can_reverse_journal) VALUES (?,1,1)', await userId('admin'));
  await run('INSERT INTO approval_user_setup (user_id, can_reverse_journal) VALUES (?,1)', await userId('accountant'));
  await run('INSERT INTO approval_user_setup (user_id, is_approval_administrator) VALUES (?,1)', await userId('principal'));

  // Role Centre Profiles (Business Central "Profile") — a landing-page selector, independent of permissions.
  const INS_PROFILE = `INSERT INTO profile (code, name, description, role_centre, icon, sort, is_default, is_system, created_at, created_by) VALUES (?,?,?,?,?,?,?,1,?,'system')`;
  const PROFILES: [string, string, string, string, number, 0 | 1][] = [
    ['SUPER', 'Super Role Centre', 'The whole school at a glance — academics and money.', '▤', 10, 1],
    ['SCHOOL_ADMIN', 'School Administration', 'Admissions, classes, registers, marks and report cards.', '🎓', 20, 0],
    ['TEACHER', 'Teacher Portal', 'My classes, registers, marks and timetable.', '🧑‍🏫', 30, 0],
    ['STUDENT_PARENT', 'Student / Parent Portal', 'Timetable, grades, attendance, fees and announcements.', '🎒', 40, 0],
    ['FINANCE_MANAGER', 'Finance Manager Role Centre', 'Fee collection, the balance sheet, cost cover and approvals.', '📈', 50, 0],
    ['ACCOUNTANT', 'Accountant Role Centre', 'Journals, the trial balance, reconciliations and tax.', '📒', 60, 0],
    ['HR_PAYROLL', 'HR & Payroll Role Centre', 'Employee records, leave and payroll processing.', '🧑‍💼', 70, 0],
    ['SELF_SERVICE', 'Employee Self Service', 'Your own payslips, P9, leave, imprests, petty cash and requisitions.', '🙋', 80, 0],
  ];
  for (const [code, name, description, icon, sort, isDefault] of PROFILES) await run(INS_PROFILE, code, name, description, code, icon, sort, isDefault, now);
  const profileId = async (code: string): Promise<number> => (await one<{ id: number }>('SELECT id FROM profile WHERE code = ?', code))!.id;
  const assign: Record<string, string[]> = {
    admin: ['SUPER', 'SCHOOL_ADMIN', 'TEACHER', 'STUDENT_PARENT', 'FINANCE_MANAGER', 'ACCOUNTANT', 'HR_PAYROLL', 'SELF_SERVICE'],
    principal: ['SUPER', 'SCHOOL_ADMIN', 'FINANCE_MANAGER', 'HR_PAYROLL', 'SELF_SERVICE'],
    registrar: ['SCHOOL_ADMIN', 'SELF_SERVICE'],
    teacher: ['TEACHER', 'SELF_SERVICE'],
    bursar: ['FINANCE_MANAGER', 'SCHOOL_ADMIN', 'SELF_SERVICE'],
    accountant: ['ACCOUNTANT', 'FINANCE_MANAGER', 'SELF_SERVICE'],
    hr: ['HR_PAYROLL', 'SELF_SERVICE'],
    parent: ['STUDENT_PARENT'],
    student: ['STUDENT_PARENT'],
    auditor: ['SUPER', 'FINANCE_MANAGER', 'ACCOUNTANT'],
  };
  for (const [un, codes] of Object.entries(assign)) {
    const uid = await userId(un);
    for (const code of codes) await run('INSERT INTO user_profile (user_id, profile_id) VALUES (?,?)', uid, await profileId(code));
    await run('UPDATE app_user SET active_profile_id = ? WHERE id = ?', await profileId(codes[0]), uid);
  }

  // Accounting periods: 13 months back through 2 ahead, all open, the calendar year as the fiscal year.
  const INS_PERIOD = 'INSERT INTO accounting_period (code, start_date, end_date, status, new_fiscal_year) VALUES (?,?,?,?,?)';
  for (let i = 13; i >= -2; i--) {
    const start = addMonths(todayIso.slice(0, 8) + '01', -i);
    const end = addMonths(start, 1);
    const endDate = new Date(new Date(end + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
    await run(INS_PERIOD, start.slice(0, 7), start, endDate, 'OPEN', start.endsWith('-01-01') ? 1 : 0);
  }

  // Global dimensions — Department and Cost Centre, the two BC slots.
  await run("UPDATE organisation SET global_dimension_1_caption = 'Department', global_dimension_2_caption = 'Cost Centre' WHERE id = 1");
  for (const [code, name] of [['ACAD', 'Academics'], ['ADMIN', 'Administration'], ['BOARD', 'Boarding'], ['TRANS', 'Transport'], ['KITCHEN', 'Kitchen & Catering']]) {
    await run("INSERT INTO global_dimension_1_value (code, name, status) VALUES (?,?,'ACTIVE')", code, name);
  }
  for (const [code, name] of [['PP', 'Pre-Primary'], ['PRI', 'Primary'], ['JSS', 'Junior Secondary'], ['HQ', 'Head Office']]) {
    await run("INSERT INTO global_dimension_2_value (code, name, status) VALUES (?,?,'ACTIVE')", code, name);
  }

  // Kenya's 47 counties.
  const COUNTIES = ['Mombasa', 'Kwale', 'Kilifi', 'Tana River', 'Lamu', 'Taita-Taveta', 'Garissa', 'Wajir', 'Mandera', 'Marsabit', 'Isiolo', 'Meru', 'Tharaka-Nithi', 'Embu', 'Kitui', 'Machakos', 'Makueni', 'Nyandarua', 'Nyeri', 'Kirinyaga', "Murang'a", 'Kiambu', 'Turkana', 'West Pokot', 'Samburu', 'Trans Nzoia', 'Uasin Gishu', 'Elgeyo-Marakwet', 'Nandi', 'Baringo', 'Laikipia', 'Nakuru', 'Narok', 'Kajiado', 'Kericho', 'Bomet', 'Kakamega', 'Vihiga', 'Bungoma', 'Busia', 'Siaya', 'Kisumu', 'Homa Bay', 'Migori', 'Kisii', 'Nyamira', 'Nairobi'];
  for (let i = 0; i < COUNTIES.length; i++) await run("INSERT INTO county (code, name, status) VALUES (?,?,'ACTIVE')", String(i + 1).padStart(3, '0'), COUNTIES[i]);
  const nairobi = (await one<{ id: number }>("SELECT id FROM county WHERE name = 'Nairobi'"))!.id;
  for (const [i, n] of ['Westlands', 'Kasarani', 'Roysambu', 'Dagoretti North', 'Langata', 'Kibra', 'Embakasi East', 'Ruaraka', 'Starehe', 'Kamukunji'].entries()) {
    await run("INSERT INTO sub_county (county_id, code, name, status) VALUES (?,?,?,'ACTIVE')", nairobi, `047-${String(i + 1).padStart(2, '0')}`, n);
  }

  /* ---------------------------------------------------------- finance setup */
  const [a1010, a1020, a1030, a1040, a1210, a1215, a1250, a1260, a2050, a2055, a2150, _a4130, a4150, a4160, a4180, a4185, a4190, a5250, a5255, a5294, a5296, a1270, a4080] = await Promise.all(
    ['1010', '1020', '1030', '1040', '1210', '1215', '1250', '1260', '2050', '2055', '2150', '4130', '4150', '4160', '4180', '4185', '4190', '5250', '5255', '5294', '5296', '1270', '4080'].map(acc),
  );
  const INS_BANK_ACCOUNT = 'INSERT INTO bank_account (code, name, gl_account_id, bank_name, account_no, account_type, currency_code, created_at) VALUES (?,?,?,?,?,?,?,?)';
  await run(INS_BANK_ACCOUNT, 'CASH', 'Petty Cash', a1010, null, null, 'PETTY_CASH', 'KES', now);
  await run(INS_BANK_ACCOUNT, 'BANK', 'Bank Current Account', a1020, 'Co-operative Bank of Kenya', '01129087654321', 'MAIN', 'KES', now);
  await run(INS_BANK_ACCOUNT, 'MPESA', 'M-Pesa Paybill 522533', a1030, 'Safaricom M-Pesa', '522533', 'OTHER', 'KES', now);
  await run(INS_BANK_ACCOUNT, 'SAVINGS', 'Bank Savings Account', a1040, 'Co-operative Bank of Kenya', '01129087654322', 'OTHER', 'KES', now);
  const bankId = async (code: string): Promise<number> => (await one<{ id: number }>('SELECT id FROM bank_account WHERE code = ?', code))!.id;
  await run('UPDATE organisation SET mpesa_bank_account_id = ?, imprest_control_account_id = ?, bad_debt_recovery_account_id = ? WHERE id = 1', await bankId('MPESA'), a1215, a4190);
  // Control accounts a manual journal may never touch.
  const noDirect = [a1010, a1020, a1030, a1040, a1210, a1215, a1250, a2150, a1270];
  await run(`UPDATE gl_account SET no_direct_posting = 1 WHERE id IN (${noDirect.map(() => '?').join(',')})`, ...noDirect);

  // Currencies (KES base + USD/EUR with the FX accounts) and bank posting groups.
  await run(`INSERT INTO currency (code, description, symbol, iso_numeric_code, is_base, amount_rounding_precision, created_at, created_by) VALUES ('KES', 'Kenya Shilling', 'KSh', '404', 1, 100, ?, 'system')`, now);
  const INS_CCY = `INSERT INTO currency (code, description, symbol, iso_numeric_code, is_base, amount_rounding_precision,
    realized_gains_account_id, realized_losses_account_id, unrealized_gains_account_id, unrealized_losses_account_id, residual_gains_account_id, residual_losses_account_id, created_at, created_by)
    VALUES (?,?,?,?,0,1,?,?,?,?,?,?,?,'system')`;
  await run(INS_CCY, 'USD', 'US Dollar', '$', '840', a4180, a5294, a4185, a5296, a4180, a5294, now);
  await run(INS_CCY, 'EUR', 'Euro', '€', '978', a4180, a5294, a4185, a5296, a4180, a5294, now);
  const INS_BAPG = "INSERT INTO bank_acc_posting_group (code, description, gl_account_id, created_at, created_by) VALUES (?,?,?,?,'system')";
  await run(INS_BAPG, 'BANK', 'Bank accounts', a1020, now);
  await run(INS_BAPG, 'CASH', 'Cash accounts', a1010, now);
  await run(INS_BAPG, 'MPESA', 'Mobile-money settlement', a1030, now);
  await run("UPDATE bank_account SET balance_lcy = balance, bank_acc_posting_group_code = CASE code WHEN 'CASH' THEN 'CASH' WHEN 'MPESA' THEN 'MPESA' ELSE 'BANK' END");
  await run(
    `INSERT INTO cash_management_setup (id, receipt_approval_limit, pv_approval_limit, default_vat_bus_posting_group_code, bank_charges_account_id, bank_interest_income_account_id, default_receipt_bank_account_id, updated_at, updated_by)
     VALUES (1, ?, ?, 'STANDARD', ?, ?, ?, ?, 'system')`, K(50000), K(20000), await acc('5280'), await acc('4140'), await bankId('BANK'), now,
  );
  for (const [c, n] of [['COOP', 'Co-operative Bank of Kenya'], ['EQUITY', 'Equity Bank'], ['KCB', 'Kenya Commercial Bank'], ['NCBA', 'NCBA Bank'], ['ABSA', 'Absa Bank Kenya'], ['DTB', 'Diamond Trust Bank']]) {
    await run('INSERT INTO external_bank (code, name) VALUES (?,?)', c, n);
  }
  for (const [b, code, name] of [['COOP', '11000', 'Co-op House'], ['COOP', '11026', 'Kiambu Road'], ['EQUITY', '68000', 'Equity Centre'], ['KCB', '01100', 'Moi Avenue'], ['NCBA', '07000', 'Upper Hill']]) {
    await run('INSERT INTO external_bank_branch (bank_code, branch_code, branch_name) VALUES (?,?,?)', b, code, name);
  }

  // VAT + WHT (BC VAT Posting Setup, reused for WHT the way the AL localization does).
  await run("INSERT INTO vat_business_posting_group (code, description, created_at, created_by) VALUES ('STANDARD', 'Standard-rated domestic', ?, 'system')", now);
  const INS_VPPG = "INSERT INTO vat_product_posting_group (code, description, tax_type, created_at, created_by) VALUES (?,?,?,?,'system')";
  for (const [c, d, t] of [['VAT16', 'VAT at 16%', 'VAT'], ['VAT0', 'Zero-rated', 'VAT'], ['EXEMPT', 'VAT exempt (education services)', 'VAT'], ['WHT-PROF', 'WHT — professional fees (5%)', 'WHT'], ['WHT-RENT', 'WHT — rent (10%)', 'WHT'], ['WHT-VAT', 'Withholding VAT (2%)', 'WHT']]) {
    await run(INS_VPPG, c, d, t, now);
  }
  const INS_VPS = `INSERT INTO vat_posting_setup (vat_bus_posting_group_code, vat_prod_posting_group_code, tax_type, vat_pct, vat_calculation_type, tax_account_id, wht_base, created_at, created_by) VALUES ('STANDARD', ?, ?, ?, ?, ?, 'Net', ?, 'system')`;
  await run(INS_VPS, 'VAT16', 'VAT', 16, 'Normal', a1260, now);
  await run(INS_VPS, 'VAT0', 'VAT', 0, 'Zero VAT', a1260, now);
  await run(INS_VPS, 'EXEMPT', 'VAT', 0, 'Exempt', a1260, now);
  await run(INS_VPS, 'WHT-PROF', 'WHT', 5, 'Normal', a2050, now);
  await run(INS_VPS, 'WHT-RENT', 'WHT', 10, 'Normal', a2050, now);
  await run(INS_VPS, 'WHT-VAT', 'WHT', 2, 'Normal', a2055, now);

  // Receivables: payment terms/methods, posting groups (students on FEES), reminders, finance charges.
  const INS_PT = "INSERT INTO payment_terms (code, description, due_date_calculation, discount_date_calculation, discount_pct, created_at, created_by) VALUES (?,?,?,?,?,?,'system')";
  await run(INS_PT, 'COD', 'Cash on Delivery', '0D', '', 0, now);
  await run(INS_PT, '14 DAYS', 'Net 14 days', '14D', '', 0, now);
  await run(INS_PT, '30 DAYS', 'Net 30 days', '30D', '', 0, now);
  await run(INS_PT, 'TERM', 'Payable by the first day of term', '0D', '', 0, now);
  const INS_PM = "INSERT INTO payment_method (code, description, bal_account_type, bal_account_no, created_at, created_by) VALUES (?,?,?,?,?,'system')";
  await run(INS_PM, 'CASH', 'Cash', 'Bank Account', 'CASH', now);
  await run(INS_PM, 'BANK', 'Bank Transfer / Deposit', 'Bank Account', 'BANK', now);
  await run(INS_PM, 'MPESA', 'M-Pesa', 'Bank Account', 'MPESA', now);
  await run(INS_PM, 'CHEQUE', 'Cheque', 'None', null, now);
  const INS_CPG = `INSERT INTO customer_posting_group (code, description, receivables_account_id, service_charge_account_id, additional_fee_account_id, payment_disc_debit_account_id, payment_disc_credit_account_id, invoice_rounding_account_id, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,'system')`;
  await run(INS_CPG, 'FEES', 'Student fee accounts', a1210, a4160, a4150, a5250, a4190, a4190, now);
  await run(INS_CPG, 'TRADE', 'Other customers (hall hire, sales)', a1250, a4160, a4150, a5250, a4190, a4190, now);
  await run(`INSERT INTO reminder_terms (code, description, max_no_of_reminders, post_interest, post_additional_fee, min_amount, created_at, created_by) VALUES ('FEES', 'Fee balance reminders', 3, 0, 0, ?, ?, 'system')`, K(100), now);
  const INS_RL = `INSERT INTO reminder_level (reminder_terms_code, level_no, grace_period, due_date_calculation, calculate_interest, additional_fee, add_fee_per_line, begin_text, end_text) VALUES ('FEES', ?,?,?,?,?,?,?,?)`;
  await run(INS_RL, 1, '7D', '7D', 0, 0, 0, 'Our records show the following fees as overdue. Please arrange payment.', 'If payment has already been made, please disregard this reminder.');
  await run(INS_RL, 2, '14D', '7D', 0, 0, 0, 'This is our second reminder for the overdue fees below.', 'Please settle promptly to keep your child in class.');
  await run(INS_RL, 3, '14D', '7D', 0, K(500), 0, 'FINAL REMINDER. The fee account will be referred to the Board if not settled.', 'Contact the bursar immediately to make arrangements.');
  await run(`INSERT INTO finance_charge_terms (code, description, interest_rate, min_amount, additional_fee, grace_period, due_date_calculation, interest_period_days, post_interest, post_additional_fee, line_description, created_at, created_by)
     VALUES ('1%', '1% per month on overdue fees', 12.0, ?, 0, '14D', '14D', 360, 1, 0, 'Interest on overdue fees', ?, 'system')`, K(100), now);
  await run(`INSERT INTO sales_receivables_setup (id, default_customer_posting_group_code, default_payment_terms_code, default_reminder_terms_code, default_fin_charge_terms_code, updated_at, updated_by) VALUES (1, 'FEES', 'TERM', 'FEES', '1%', ?, 'system')`, now);
  await run("INSERT INTO inventory_posting_group (code, description, inventory_gl_account_id, created_at, created_by) VALUES ('STORES', 'Stores and supplies', ?, ?, 'system')", a1270, now);
  await run("INSERT INTO product_posting_group (code, description, adjustment_gl_account_id, sales_gl_account_id, cogs_gl_account_id, created_at, created_by) VALUES ('SUPPLIES', 'Uniforms, books and stationery', ?, ?, ?, ?, 'system')", a5255, a4080, a5255, now);

  // Payables.
  const INS_VPG = `INSERT INTO vendor_posting_group (code, description, payables_account_id, service_charge_account_id, payment_disc_debit_account_id, payment_disc_credit_account_id, invoice_rounding_account_id, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,'system')`;
  await run(INS_VPG, 'TRADE', 'Suppliers', a2150, a5250, a5250, a4190, a4190, now);
  await run(INS_VPG, 'UTILITY', 'Utilities and services', a2150, a5250, a5250, a4190, a4190, now);
  await run(`INSERT INTO purchases_payables_setup (id, default_vendor_posting_group_code, default_payment_terms_code, default_vat_bus_posting_group_code, updated_at, updated_by) VALUES (1, 'TRADE', '30 DAYS', 'STANDARD', ?, 'system')`, now);

  // Fixed assets setup.
  await run(`INSERT INTO depreciation_book (code, description, g_l_integration, default_final_rounding_amount, created_at, created_by) VALUES ('SCHOOL', 'School Book', 1, 100, ?, 'system')`, now);
  for (const [code, desc] of [['BUILDINGS', 'Land and Buildings'], ['EQUIPMENT', 'Furniture, Fittings and Equipment'], ['ICT', 'Computers and ICT'], ['VEHICLES', 'Motor Vehicles']]) {
    await run('INSERT INTO fa_class (code, description, created_at, created_by) VALUES (?,?,?,?)', code, desc, now, 'system');
  }
  for (const [code, desc, cls] of [['CLASSROOM', 'Classroom Furniture', 'EQUIPMENT'], ['LAB', 'Laboratory Equipment', 'EQUIPMENT'], ['COMPUTERS', 'Computers and Tablets', 'ICT'], ['BUS', 'School Buses', 'VEHICLES']]) {
    await run('INSERT INTO fa_subclass (code, description, fa_class_code, created_at, created_by) VALUES (?,?,?,?,?)', code, desc, cls, now, 'system');
  }
  await run("INSERT INTO fa_location (code, description, created_at, created_by) VALUES ('MAIN', 'Main Campus', ?, 'system')", now);
  for (const [code, desc] of [['SERVICE', 'Routine Service'], ['REPAIR', 'Repair'], ['INSPECTION', 'Inspection']]) {
    await run('INSERT INTO maintenance (code, description, created_at, created_by) VALUES (?,?,?,?)', code, desc, now, 'system');
  }
  const [a1410, a1415, a1420, a1425, a1430, a1435, a1440, a1445, a5290, a5240, a4170, a5292] = await Promise.all(['1410', '1415', '1420', '1425', '1430', '1435', '1440', '1445', '5290', '5240', '4170', '5292'].map(acc));
  const INS_FAPG = `INSERT INTO fa_posting_group (code, description, acquisition_cost_account_id, accum_depreciation_account_id, depreciation_expense_account_id, write_down_expense_account_id, appreciation_account_id, maintenance_expense_account_id, gains_acc_on_disposal_id, losses_acc_on_disposal_id, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,'system')`;
  await run(INS_FAPG, 'BUILDINGS', 'Land and Buildings', a1410, a1415, a5290, a5290, a1410, a5240, a4170, a5292, now);
  await run(INS_FAPG, 'EQUIPMENT', 'Furniture, Fittings & Equipment', a1420, a1425, a5290, a5290, a1420, a5240, a4170, a5292, now);
  await run(INS_FAPG, 'VEHICLES', 'Motor Vehicles', a1430, a1435, a5290, a5290, a1430, a5240, a4170, a5292, now);
  await run(INS_FAPG, 'ICT', 'Computers and ICT', a1440, a1445, a5290, a5290, a1440, a5240, a4170, a5292, now);
  await run(`INSERT INTO fa_setup (id, default_depreciation_book_code, default_fa_posting_group_code, updated_at, updated_by) VALUES (1, 'SCHOOL', 'EQUIPMENT', ?, 'system')`, now);

  /* ---------------------------------------------------------- HR & payroll setup */
  await run('INSERT INTO hr_payroll_setup (id) VALUES (1)');
  for (const [sort, upper, rate] of [[1, 2400000, 10], [2, 833300, 25], [3, 46766700, 30], [4, 30000000, 32.5], [5, null, 35]] as const) {
    await run('INSERT INTO payroll_paye_band (sort_order, upper_bound_cents, rate_pct) VALUES (?,?,?)', sort, upper, rate);
  }
  await run('INSERT INTO payroll_nssf_tier (tier_no, lower_limit_cents, upper_limit_cents, employee_rate_pct, employer_rate_pct) VALUES (1, 0, 800000, 6, 6)');
  await run('INSERT INTO payroll_nssf_tier (tier_no, lower_limit_cents, upper_limit_cents, employee_rate_pct, employer_rate_pct) VALUES (2, 800000, 7200000, 6, 6)');
  const [a5010, a5020, a2210, a2220, a2230, a2240, a2250, a5030, a5035] = await Promise.all(['5010', '5020', '2210', '2220', '2230', '2240', '2250', '5030', '5035'].map(acc));
  const INS_PPG = `INSERT INTO payroll_posting_group (code, name, salary_expense_account_id, paye_payable_account_id, net_pay_payable_account_id, nssf_employee_payable_account_id, nssf_employer_expense_account_id, nssf_employer_payable_account_id, shif_payable_account_id, housing_levy_employee_payable_account_id, housing_levy_employer_expense_account_id, housing_levy_employer_payable_account_id, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'system')`;
  await run(INS_PPG, 'TEACHING', 'Teaching staff', a5010, a2220, a2210, a2230, a5030, a2230, a2240, a2250, a5035, a2250, now);
  await run(INS_PPG, 'SUPPORT', 'Non-teaching staff', a5020, a2220, a2210, a2230, a5030, a2230, a2240, a2250, a5035, a2250, now);
  const INS_JG = "INSERT INTO hr_job_grade (code, name, created_at, created_by) VALUES (?,?,?,'system')";
  for (const [code, name] of [['T1', 'Teacher I'], ['T2', 'Teacher II'], ['T3', 'Senior Teacher'], ['HOD', 'Head of Department'], ['DP', 'Deputy Principal'], ['P', 'Principal'], ['S1', 'Support Staff I'], ['S2', 'Support Staff II'], ['A1', 'Administrative Officer']]) {
    await run(INS_JG, code, name, now);
  }
  const INS_CT = "INSERT INTO hr_employment_contract_type (code, name, created_at, created_by) VALUES (?,?,?,'system')";
  for (const [code, name] of [['PERM', 'Permanent and Pensionable'], ['CONTRACT', 'Fixed-term Contract'], ['BOM', 'Board of Management Teacher'], ['INTERN', 'Teaching Intern']]) {
    await run(INS_CT, code, name, now);
  }
  const INS_LT = "INSERT INTO hr_leave_type (code, name, standard_days, is_annual, is_sick_leave, gender, created_at, created_by) VALUES (?,?,?,?,?,?,?,'system')";
  for (const [code, name, days, annual, sick, gender] of [['ANNUAL', 'Annual Leave', 30, true, false, 'ANY'], ['SICK', 'Sick Leave', 14, false, true, 'ANY'], ['MATERNITY', 'Maternity Leave', 90, false, false, 'FEMALE'], ['PATERNITY', 'Paternity Leave', 14, false, false, 'MALE'], ['STUDY', 'Study Leave', 10, false, false, 'ANY'], ['COMPASSIONATE', 'Compassionate Leave', 5, false, false, 'ANY']] as const) {
    await run(INS_LT, code, name, days, annual, sick, gender, now);
  }
  for (const [code, name] of [['RESIGN', 'Resignation'], ['RETIRE', 'Retirement'], ['CONTRACT-END', 'End of Contract'], ['DISMISS', 'Dismissal'], ['DECEASED', 'Deceased']]) {
    await run("INSERT INTO hr_termination_reason (code, description, created_at, created_by) VALUES (?,?,?,'system')", code, name, now);
  }
  for (const [code, name] of [['LIBRARY', 'Library'], ['ICT', 'ICT Equipment'], ['FINANCE', 'Finance Office'], ['HR', 'Human Resources'], ['BOARDING', 'Boarding']]) {
    await run("INSERT INTO hr_clearance_section (code, name, created_at, created_by) VALUES (?,?,?,'system')", code, name, now);
  }

  /* ---------------------------------------------------------- financial reports */
  await seedFinancialReports(now);

  /* ---------------------------------------------------------- system automation */
  const INS_JOB = `INSERT INTO job_queue_entry (code, description, job_type, run_every_minutes, status, created_at, created_by) VALUES (?,?,?,?,?,?,'system')`;
  await run(INS_JOB, 'SESSION-PURGE', 'Removes expired and idle sign-in sessions', 'SESSION_PURGE', 60, 'READY', now);
  await run(INS_JOB, 'OUTBOX-DISPATCH', 'Retries queued e-mails and SMS that were not delivered first time', 'OUTBOX_DISPATCH', 5, 'READY', now);
  await run(INS_JOB, 'MPESA-STK-QUERY', 'Asks Safaricom about payment requests whose callback never came', 'MPESA_STK_QUERY', 5, 'ON HOLD', now);
  await run(INS_JOB, 'FEE-REMINDERS', 'Reminds guardians of overdue fee balances by SMS and e-mail, weekly', 'FEE_REMINDERS', 10080, 'ON HOLD', now);

  /* ---------------------------------------------------------- academic structure (Kenyan CBC) */
  await seedCbcStructure(now);
}

/** The Kenyan Competency Based Curriculum: levels, grades, subjects per grade, the competency scale, assessment types, fee items. */
async function seedCbcStructure(now: IsoDateTime): Promise<void> {
  const levels: [string, string[]][] = [
    ['Pre-Primary', ['PP1', 'PP2']],
    ['Lower Primary', ['Grade 1', 'Grade 2', 'Grade 3']],
    ['Upper Primary', ['Grade 4', 'Grade 5', 'Grade 6']],
    ['Junior Secondary', ['Grade 7', 'Grade 8', 'Grade 9']],
  ];
  let levelSort = 0;
  const gradeIds = new Map<string, number>();
  const levelIds = new Map<string, number>();
  for (const [level, grades] of levels) {
    levelSort += 1;
    const info = await run('INSERT INTO education_level (name, sort) VALUES (?,?)', level, levelSort);
    levelIds.set(level, Number(info.lastInsertRowid));
    let gs = 0;
    for (const g of grades) {
      gs += 1;
      const gi = await run('INSERT INTO grade_level (education_level_id, name, sort) VALUES (?,?,?)', info.lastInsertRowid, g, gs);
      gradeIds.set(g, Number(gi.lastInsertRowid));
    }
  }
  const G = (names: string[]): number[] => names.map((n) => gradeIds.get(n)!);
  const pp = G(['PP1', 'PP2']); const lower = G(['Grade 1', 'Grade 2', 'Grade 3']); const upper = G(['Grade 4', 'Grade 5', 'Grade 6']); const jss = G(['Grade 7', 'Grade 8', 'Grade 9']);
  const subjects: [string, string, string | null, boolean, number[]][] = [
    ['LANG', 'Language Activities', 'Pre-Primary', true, pp],
    ['MATH-A', 'Mathematical Activities', 'Pre-Primary', true, pp],
    ['ENV-A', 'Environmental Activities', 'Pre-Primary', true, pp],
    ['PSY-A', 'Psychomotor and Creative Activities', 'Pre-Primary', true, pp],
    ['REL-A', 'Religious Education Activities', 'Pre-Primary', true, pp],
    ['ENG', 'English', null, true, [...lower, ...upper, ...jss]],
    ['KIS', 'Kiswahili', null, true, [...lower, ...upper, ...jss]],
    ['MATH', 'Mathematics', null, true, [...lower, ...upper, ...jss]],
    ['LIT', 'Literacy Activities', 'Lower Primary', true, lower],
    ['ENV', 'Environmental Activities', 'Lower Primary', true, lower],
    ['HYG', 'Hygiene and Nutrition', 'Lower Primary', true, lower],
    ['CRE', 'Christian Religious Education', null, true, [...lower, ...upper, ...jss]],
    ['MOVE', 'Movement and Creative Activities', 'Lower Primary', true, lower],
    ['SCI', 'Science and Technology', 'Upper Primary', true, upper],
    ['AGR', 'Agriculture', null, true, [...upper, ...jss]],
    ['SST', 'Social Studies', null, true, [...upper, ...jss]],
    ['HOME', 'Home Science', 'Upper Primary', true, upper],
    ['ART', 'Creative Arts', null, true, [...upper, ...jss]],
    ['PE', 'Physical and Health Education', null, true, [...upper, ...jss]],
    ['INTSCI', 'Integrated Science', 'Junior Secondary', true, jss],
    ['PRETECH', 'Pre-Technical Studies', 'Junior Secondary', true, jss],
    ['BUS', 'Business Studies', 'Junior Secondary', true, jss],
    ['LSK', 'Life Skills Education', 'Junior Secondary', false, jss],
    ['CSL', 'Computer Science', 'Junior Secondary', false, jss],
    ['FRE', 'French', 'Junior Secondary', false, jss],
  ];
  for (const [code, name, level, core, grades] of subjects) {
    const info = await run("INSERT INTO subject (code, name, education_level_id, is_core, status) VALUES (?,?,?,?,'ACTIVE')", code, name, level ? levelIds.get(level) : null, core);
    for (const g of grades) await run('INSERT INTO subject_offering (subject_id, grade_level_id) VALUES (?,?)', info.lastInsertRowid, g);
  }
  const scale = await run('INSERT INTO grading_scale (name, is_default) VALUES (?, true)', 'CBC Competency Scale');
  const bands: [string, number, number, string][] = [
    ['Exceeding Expectations', 80, 100, '#1a7f37'], ['Meeting Expectations', 60, 79.99, '#1d6fb8'], ['Approaching Expectations', 40, 59.99, '#b7791f'], ['Below Expectations', 0, 39.99, '#c0392b'],
  ];
  for (const [i, [label, min, max, color]] of bands.entries()) {
    await run('INSERT INTO assessment_band (grading_scale_id, label, min_score, max_score, sort, color_hex) VALUES (?,?,?,?,?,?)', scale.lastInsertRowid, label, min, max, i + 1, color);
  }
  for (const [i, [name, weight, exam]] of ([['Formative Assessment 1', 1, false], ['Formative Assessment 2', 1, false], ['Mid-Term Assessment', 1.5, true], ['End of Term Exam', 2, true]] as const).entries()) {
    await run('INSERT INTO assessment_type (name, weight, is_exam, sort) VALUES (?,?,?,?)', name, weight, exam, i + 1);
  }
  const feeItems: [string, string, string][] = [
    ['TUITION', 'Tuition Fees', '4010'], ['BOARDING', 'Boarding Fees', '4020'], ['LUNCH', 'Lunch Programme', '4030'], ['TRANSPORT', 'School Transport', '4040'],
    ['ACTIVITY', 'Activity and Co-curricular Fee', '4050'], ['EXAM', 'Examination and Assessment Fee', '4060'], ['ADMISSION', 'Admission Fee', '4070'], ['BOOKS', 'Books and Stationery', '4080'],
  ];
  for (const [i, [code, name, gl]] of feeItems.entries()) {
    await run("INSERT INTO fee_item (code, name, gl_account_id, status, sort) VALUES (?,?,?,'ACTIVE',?)", code, name, await acc(gl), i + 1);
  }
  void now;
}

/**
 * Financial Reports (Account Schedules) — Business Central-style row definitions + column
 * layouts + report pairings, built from the CHART above so every screen is populated on first run.
 */
async function seedFinancialReports(now: IsoDateTime): Promise<void> {
  const INS_CLN = "INSERT INTO column_layout_name (name, description, created_at, created_by) VALUES (?,?,?,'system')";
  const INS_CL = `INSERT INTO column_layout (column_layout_name_id, line_no, column_no, column_header, column_type, amount_type, formula, comparison_date_formula, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,'system')`;
  const layouts: [string, string, [number, string, string, string, string, string][]][] = [
    ['DEFAULT', 'Single net-change column', [[10000, 'NET', 'Net Change', 'NET_CHANGE', '', '']]],
    ['BALANCE', 'Single balance-at-date column', [[10000, 'BAL', 'Balance', 'BALANCE_AT_DATE', '', '']]],
    ['THIS-VS-LAST', 'This year, last year and the % change', [
      [10000, 'TY', 'This Year', 'NET_CHANGE', '', ''], [20000, 'LY', 'Last Year', 'NET_CHANGE', '', '-1Y'], [30000, 'CHG', 'Change %', 'FORMULA', '(TY-LY)/LY*100', ''],
    ]],
    ['YTD-BAL', 'Year to date and closing balance', [[10000, 'YTD', 'Year to Date', 'YEAR_TO_DATE', '', ''], [20000, 'BAL', 'Balance', 'BALANCE_AT_DATE', '', '']]],
  ];
  for (const [name, description, lines] of layouts) {
    const info = await run(INS_CLN, name, description, now);
    for (const [lineNo, colNo, header, type, formula, cmp] of lines) await run(INS_CL, info.lastInsertRowid, lineNo, colNo, header, type, 'NET_AMOUNT', formula, cmp, now);
  }
  const INS_ASN = "INSERT INTO acc_schedule_name (name, description, default_column_layout_name, created_at, created_by) VALUES (?,?,?,?,'system')";
  const INS_ASL = `INSERT INTO acc_schedule_line (acc_schedule_name_id, line_no, row_no, description, totaling_type, totaling, row_type, show, bold, double_underline, indentation, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'system')`;
  type Row = [number, string, string, string, string, string, string, 0 | 1, 0 | 1, number];
  const schedules: [string, string, string, Row[]][] = [
    ['SCHOOL-BS', 'Statement of Financial Position', 'BALANCE', [
      [10000, 'CASH', 'Cash and bank', 'TOTAL_ACCOUNTS', '1000..1099', 'BALANCE_AT_DATE', 'YES', 0, 0, 1],
      [20000, 'REC', 'Fees receivable and other assets', 'TOTAL_ACCOUNTS', '1200..1299', 'BALANCE_AT_DATE', 'YES', 0, 0, 1],
      [30000, 'PPE', 'Property, plant and equipment', 'TOTAL_ACCOUNTS', '1400..1499', 'BALANCE_AT_DATE', 'YES', 0, 0, 1],
      [40000, 'TA', 'Total assets', 'FORMULA', 'CASH+REC+PPE', 'BALANCE_AT_DATE', 'YES', 1, 1, 0],
      [50000, 'CL', 'Current liabilities', 'TOTAL_ACCOUNTS', '2000..2299', 'BALANCE_AT_DATE', 'YES', 0, 0, 1],
      [60000, 'LTL', 'Long-term liabilities', 'TOTAL_ACCOUNTS', '2300..2399', 'BALANCE_AT_DATE', 'YES', 0, 0, 1],
      [70000, 'TL', 'Total liabilities', 'FORMULA', 'CL+LTL', 'BALANCE_AT_DATE', 'YES', 1, 0, 0],
      [80000, 'EQ', 'Capital and funds', 'TOTAL_ACCOUNTS', '3000..3099', 'BALANCE_AT_DATE', 'YES', 0, 0, 1],
      [90000, 'INC', 'Income (period)', 'TOTAL_ACCOUNTS', '4000..4999', 'BALANCE_AT_DATE', 'NO', 0, 0, 0],
      [100000, 'EXP', 'Expenditure (period)', 'TOTAL_ACCOUNTS', '5000..5999', 'BALANCE_AT_DATE', 'NO', 0, 0, 0],
      [110000, 'SURP', 'Surplus for the period', 'FORMULA', 'INC-EXP', 'BALANCE_AT_DATE', 'YES', 0, 0, 1],
      [120000, 'TE', 'Total funds', 'FORMULA', 'EQ+SURP', 'BALANCE_AT_DATE', 'YES', 1, 0, 0],
      [130000, 'TLE', 'Total funds and liabilities', 'FORMULA', 'TL+TE', 'BALANCE_AT_DATE', 'YES', 1, 1, 0],
      [140000, 'CHK', 'Balance check (assets less funds and liabilities)', 'FORMULA', 'TA-TLE', 'BALANCE_AT_DATE', 'IF_ANY_NOT_ZERO', 0, 0, 0],
    ]],
    ['SCHOOL-PL', 'Statement of Comprehensive Income', 'THIS-VS-LAST', [
      [10000, 'FEES', 'Fee income', 'TOTAL_ACCOUNTS', '4000..4099', 'NET_CHANGE', 'YES', 0, 0, 1],
      [20000, 'OTH', 'Grants, donations and other income', 'TOTAL_ACCOUNTS', '4100..4199', 'NET_CHANGE', 'YES', 0, 0, 1],
      [30000, 'TINC', 'Total income', 'FORMULA', 'FEES+OTH', 'NET_CHANGE', 'YES', 1, 0, 0],
      [40000, 'STAFF', 'Staff costs', 'TOTAL_ACCOUNTS', '5000..5099', 'NET_CHANGE', 'YES', 0, 0, 1],
      [50000, 'ACAD', 'Academic expenses', 'TOTAL_ACCOUNTS', '5100..5199', 'NET_CHANGE', 'YES', 0, 0, 1],
      [60000, 'OPS', 'Operating expenses', 'TOTAL_ACCOUNTS', '5200..5299', 'NET_CHANGE', 'YES', 0, 0, 1],
      [70000, 'GOV', 'Governance', 'TOTAL_ACCOUNTS', '5300..5399', 'NET_CHANGE', 'YES', 0, 0, 1],
      [80000, 'TEXP', 'Total expenditure', 'FORMULA', 'STAFF+ACAD+OPS+GOV', 'NET_CHANGE', 'YES', 1, 0, 0],
      [90000, 'SURP', 'Surplus for the period', 'FORMULA', 'TINC-TEXP', 'NET_CHANGE', 'YES', 1, 1, 0],
    ]],
    ['FEE-COLLECTION', 'Fee income and collection', 'YTD-BAL', [
      [10000, 'INV', 'Fee income recognised', 'TOTAL_ACCOUNTS', '4000..4099', 'NET_CHANGE', 'YES', 0, 0, 0],
      [20000, 'REC', 'Fees still receivable', 'POSTING_ACCOUNTS', '1210', 'BALANCE_AT_DATE', 'YES', 0, 0, 0],
      [30000, 'ADV', 'Fees received in advance', 'POSTING_ACCOUNTS', '2020', 'BALANCE_AT_DATE', 'YES', 0, 0, 0],
      [40000, 'BAD', 'Fees written off', 'POSTING_ACCOUNTS', '5298', 'NET_CHANGE', 'YES', 0, 0, 0],
    ]],
  ];
  for (const [name, description, dcl, rows] of schedules) {
    const info = await run(INS_ASN, name, description, dcl, now);
    for (const [lineNo, rowNo, desc, tType, totaling, rowType, show, bold, dunder, indent] of rows) {
      await run(INS_ASL, info.lastInsertRowid, lineNo, rowNo, desc, tType, totaling, rowType, show, bold, dunder, indent, now);
    }
  }
  const INS_FR = "INSERT INTO financial_report (name, description, row_group, column_group, created_at, created_by) VALUES (?,?,?,?,?,'system')";
  await run(INS_FR, 'STMT-FIN-POSITION', 'Statement of Financial Position', 'SCHOOL-BS', 'BALANCE', now);
  await run(INS_FR, 'STMT-COMPR-INCOME', 'Statement of Comprehensive Income', 'SCHOOL-PL', 'THIS-VS-LAST', now);
  await run(INS_FR, 'FEE-COLLECTION', 'Fee Income and Collection', 'FEE-COLLECTION', 'YTD-BAL', now);
}

/**
 * Stamps gl_account.indentation from the Begin-Total / End-Total bracketing the CHART above
 * declares — the same walk lib/gl.ts's indentChartOfAccounts() performs, inlined here so seeding
 * stays self-contained (no audit row against a user that may not exist yet).
 */
async function indentSeededChart(): Promise<void> {
  const accounts = await all<{ id: number; account_type: string }>('SELECT id, account_type FROM gl_account ORDER BY code');
  let depth = 0;
  for (const a of accounts) {
    if (a.account_type === 'END_TOTAL') depth = Math.max(0, depth - 1);
    await run('UPDATE gl_account SET indentation = ? WHERE id = ?', depth, a.id);
    if (a.account_type === 'BEGIN_TOTAL') depth += 1;
  }
}

/* ================================================================== demonstration school */

const FIRST_M = ['Brian', 'Kevin', 'Dennis', 'Collins', 'Elias', 'Victor', 'Anthony', 'Ian', 'Ryan', 'Mark', 'Emmanuel', 'Joshua', 'Caleb', 'Adrian', 'Samuel', 'Daniel'];
const FIRST_F = ['Faith', 'Mercy', 'Joy', 'Abigail', 'Precious', 'Michelle', 'Angel', 'Tracy', 'Shantel', 'Wendy', 'Naomi', 'Esther', 'Purity', 'Rehema', 'Zawadi', 'Amani'];
const LAST = ['Kamau', 'Otieno', 'Wanjiru', 'Kiprotich', 'Mutiso', 'Achieng', 'Njoroge', 'Chebet', 'Mwangi', 'Odhiambo', 'Wafula', 'Nyambura', 'Kiptoo', 'Muthoni', 'Barasa', 'Auma', 'Gitonga', 'Cheruiyot', 'Wekesa', 'Kariuki', 'Atieno', 'Maina', 'Rono', 'Simiyu'];
const PARENT_M = ['James', 'Peter', 'John', 'Joseph', 'David', 'Paul', 'Francis', 'George', 'Stephen', 'Patrick'];
const PARENT_F = ['Mary', 'Grace', 'Ann', 'Caroline', 'Jane', 'Rose', 'Lucy', 'Susan', 'Beatrice', 'Catherine'];

/** School days (Mon–Fri) between two dates, inclusive, oldest first. */
/**
 * One INSERT for many rows — the demo seed writes thousands of register and mark rows, and on a
 * remote database (Neon from a laptop is ~250 ms a round trip) one statement per row is the
 * difference between seconds and an hour. Chunked to stay under Postgres's parameter limit.
 */
async function insertMany(table: string, columns: string[], rows: unknown[][]): Promise<void> {
  const perRow = columns.length;
  const chunk = Math.max(1, Math.floor(30_000 / perRow));
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const values = part.map(() => `(${columns.map(() => '?').join(',')})`).join(',');
    await run(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${values} ON CONFLICT DO NOTHING`, ...part.flat());
  }
}

/** SEED_TRACE=1 logs how long each phase of the demo seed takes. */
const trace = (() => { let last = Date.now(); return (phase: string) => { if (process.env.SEED_TRACE) { const now = Date.now(); console.log(`  seed: ${phase} (${now - last} ms)`); last = now; } }; })();

function schoolDays(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow >= 1 && dow <= 5) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function seedDemoSchool(now: IsoDateTime, todayIso: IsoDate): Promise<Pick<SeedResult, 'students' | 'teachers'>> {
  const year = Number(todayIso.slice(0, 4));
  const userId = async (un: string): Promise<number> => (await one<{ id: number }>('SELECT id FROM app_user WHERE username = ?', un))!.id;

  /* ---- the academic year in progress: three terms, the one containing today is current ---- */
  const terms = [
    { name: 'Term 1', startDate: `${year}-01-06`, endDate: `${year}-04-04` },
    { name: 'Term 2', startDate: `${year}-04-28`, endDate: `${year}-08-01` },
    { name: 'Term 3', startDate: `${year}-08-25`, endDate: `${year}-10-24` },
  ];
  let currentIdx = terms.findIndex((t) => todayIso >= t.startDate && todayIso <= t.endDate);
  if (currentIdx < 0) currentIdx = Math.max(0, terms.findIndex((t) => todayIso < t.startDate) - 1);
  if (currentIdx < 0) currentIdx = terms.length - 1;
  const { id: yearId } = await academics.createAcademicYear(
    { name: String(year), startDate: `${year}-01-01`, endDate: `${year}-12-31`, isCurrent: true },
    terms.map((t, i) => ({ ...t, isCurrent: i === currentIdx })), SYS,
  );
  const termRows = await academics.listTerms(yearId);
  const term = termRows[currentIdx];
  const previousTerm = currentIdx > 0 ? termRows[currentIdx - 1] : null;

  /* ---- teaching staff on the payroll ---- */
  const gradeOf = async (code: string) => (await one<{ id: number }>('SELECT id FROM hr_job_grade WHERE code = ?', code))!.id;
  const contractOf = async (code: string) => (await one<{ id: number }>('SELECT id FROM hr_employment_contract_type WHERE code = ?', code))!.id;
  const ppg = async (code: string) => (await one<{ id: number }>('SELECT id FROM payroll_posting_group WHERE code = ?', code))!.id;
  const dim1 = async (code: string) => (await one<{ id: number }>('SELECT id FROM global_dimension_1_value WHERE code = ?', code))!.id;
  const dim2 = async (code: string) => (await one<{ id: number }>('SELECT id FROM global_dimension_2_value WHERE code = ?', code))!.id;
  const staff: { first: string; last: string; gender: string; title: string; grade: string; pay: number; teacher?: { tsc: string; qualification: string; specialisation: string }; dept: string; cc: string; login?: string }[] = [
    { first: 'Beatrice', last: 'Njeri', gender: 'FEMALE', title: 'Principal', grade: 'P', pay: 185000, dept: 'ADMIN', cc: 'HQ', login: 'principal', teacher: { tsc: 'TSC/198877', qualification: 'M.Ed', specialisation: 'Educational Leadership' } },
    { first: 'Dennis', last: 'Kiptoo', gender: 'MALE', title: 'Deputy Principal / Registrar', grade: 'DP', pay: 145000, dept: 'ADMIN', cc: 'HQ', login: 'registrar', teacher: { tsc: 'TSC/223411', qualification: 'B.Ed', specialisation: 'Mathematics' } },
    { first: 'Peter', last: 'Otieno', gender: 'MALE', title: 'Teacher — Mathematics & Science', grade: 'T2', pay: 78000, dept: 'ACAD', cc: 'PRI', login: 'teacher', teacher: { tsc: 'TSC/301122', qualification: 'B.Ed (Science)', specialisation: 'Mathematics, Science' } },
    { first: 'Mary', last: 'Achieng', gender: 'FEMALE', title: 'Teacher — Languages', grade: 'T2', pay: 76000, dept: 'ACAD', cc: 'PRI', teacher: { tsc: 'TSC/305566', qualification: 'B.Ed (Arts)', specialisation: 'English, Kiswahili' } },
    { first: 'Samuel', last: 'Kiptoo', gender: 'MALE', title: 'Teacher — Humanities', grade: 'T3', pay: 92000, dept: 'ACAD', cc: 'JSS', teacher: { tsc: 'TSC/287700', qualification: 'B.Ed (Arts)', specialisation: 'Social Studies, CRE' } },
    { first: 'Joyce', last: 'Wambui', gender: 'FEMALE', title: 'Teacher — Pre-Primary', grade: 'T1', pay: 58000, dept: 'ACAD', cc: 'PP', teacher: { tsc: 'TSC/411900', qualification: 'Diploma in ECDE', specialisation: 'Early Childhood' } },
    { first: 'Kevin', last: 'Mutua', gender: 'MALE', title: 'Teacher — Integrated Science & Pre-Tech', grade: 'T2', pay: 80000, dept: 'ACAD', cc: 'JSS', teacher: { tsc: 'TSC/398210', qualification: 'B.Sc + PGDE', specialisation: 'Integrated Science, Pre-Technical Studies' } },
    { first: 'Lydia', last: 'Chebet', gender: 'FEMALE', title: 'HR & Payroll Officer', grade: 'A1', pay: 85000, dept: 'ADMIN', cc: 'HQ', login: 'hr' },
    { first: 'Purity', last: 'Wanjiku', gender: 'FEMALE', title: 'Bursar', grade: 'A1', pay: 95000, dept: 'ADMIN', cc: 'HQ', login: 'bursar' },
    { first: 'Samuel', last: 'Otieno', gender: 'MALE', title: 'Accountant', grade: 'A1', pay: 98000, dept: 'ADMIN', cc: 'HQ', login: 'accountant' },
    { first: 'Joseph', last: 'Wekesa', gender: 'MALE', title: 'School Driver', grade: 'S2', pay: 42000, dept: 'TRANS', cc: 'HQ' },
    { first: 'Rose', last: 'Atieno', gender: 'FEMALE', title: 'Head Cook', grade: 'S1', pay: 35000, dept: 'KITCHEN', cc: 'HQ' },
  ];
  const teacherIds: number[] = [];
  const employeeIdOf = new Map<string, number>();
  for (const s of staff) {
    const isTeacher = !!s.teacher;
    const { id } = await employees.createEmployee({
      first_name: s.first, last_name: s.last, gender: s.gender, job_title: s.title, job_grade_id: await gradeOf(s.grade),
      contract_type_id: await contractOf('PERM'), employment_date: `${year - int(1, 9)}-01-10`, employee_type: isTeacher ? 'TEACHER' : 'STAFF',
      email: `${s.first.toLowerCase()}.${s.last.toLowerCase()}@greenvalley.ac.ke`, phone: `+2547${int(10000000, 99999999)}`,
      national_id: String(int(20000000, 39999999)), kra_pin: `A00${int(1000000, 9999999)}X`, nssf_no: String(int(100000000, 999999999)), shif_no: String(int(1000000, 9999999)),
      global_dimension_1_id: await dim1(s.dept), global_dimension_2_id: await dim2(s.cc),
      posting_group_id: await ppg(isTeacher ? 'TEACHING' : 'SUPPORT'), basic_pay_cents: K(s.pay), payment_mode: 'Bank Transfer',
      bank_code: 'COOP', bank_branch: '11026', bank_account_no: String(int(1000000000, 9999999999)),
    }, SYS);
    await run("UPDATE employee SET status = 'ACTIVE', probation_status = 'CONFIRMED' WHERE id = ?", id);
    await run('INSERT INTO employee_contract (employee_id, contract_type_id, start_date, salary_cents, is_current, created_at, created_by) VALUES (?,?,?,?,true,?,?)',
      id, await contractOf('PERM'), `${year - 1}-01-01`, K(s.pay), now, 'system');
    employeeIdOf.set(`${s.first} ${s.last}`, id);
    if (s.teacher) {
      await teachers.saveTeacherProfile({ employeeId: id, tscNumber: s.teacher.tsc, qualification: s.teacher.qualification, specialisation: s.teacher.specialisation }, SYS);
      teacherIds.push(id);
    }
    if (s.login) {
      await run(
        `INSERT INTO approval_user_setup (user_id, employee_id) VALUES (?,?)
         ON CONFLICT (user_id) DO UPDATE SET employee_id = EXCLUDED.employee_id`, await userId(s.login), id,
      );
    }
  }
  const T = (name: string): number => employeeIdOf.get(name)!;

  /* ---- classes for the year ---- */
  const grades = await academics.listGradeLevels();
  const gradeByName = new Map(grades.map((g) => [g.name, g.id]));
  const classes: [string, string, string][] = [
    ['PP1', 'Sunflower', 'Joyce Wambui'], ['PP2', 'Daisy', 'Joyce Wambui'],
    ['Grade 1', 'Red', 'Mary Achieng'], ['Grade 2', 'Red', 'Mary Achieng'], ['Grade 3', 'Red', 'Peter Otieno'],
    ['Grade 4', 'East', 'Peter Otieno'], ['Grade 4', 'West', 'Samuel Kiptoo'], ['Grade 5', 'East', 'Samuel Kiptoo'], ['Grade 6', 'East', 'Mary Achieng'],
    ['Grade 7', 'North', 'Kevin Mutua'], ['Grade 8', 'North', 'Kevin Mutua'], ['Grade 9', 'North', 'Dennis Kiptoo'],
  ];
  const streamIds: { id: number; grade: string; gradeId: number; name: string; teacher: number }[] = [];
  for (const [grade, name, teacher] of classes) {
    const { id } = await academics.saveStream(null, { gradeLevelId: gradeByName.get(grade)!, academicYearId: yearId, name, classTeacherId: T(teacher) }, SYS);
    streamIds.push({ id, grade, gradeId: gradeByName.get(grade)!, name, teacher: T(teacher) });
  }

  /* ---- who teaches what: the class teacher takes the core subjects; specialists take theirs ---- */
  const specialist: Record<string, string> = { MATH: 'Peter Otieno', SCI: 'Peter Otieno', INTSCI: 'Kevin Mutua', PRETECH: 'Kevin Mutua', CSL: 'Kevin Mutua', ENG: 'Mary Achieng', KIS: 'Mary Achieng', SST: 'Samuel Kiptoo', CRE: 'Samuel Kiptoo', AGR: 'Samuel Kiptoo', BUS: 'Dennis Kiptoo' };
  for (const st of streamIds) {
    for (const sub of await academics.listSubjectsForGrade(st.gradeId)) {
      const who = specialist[sub.code] ? T(specialist[sub.code]) : st.teacher;
      await teachers.assignTeacher(who, sub.id, st.id, SYS);
    }
  }

  trace('staff and classes');
  /* ---- students, each with a guardian or two, admitted at the start of the year ---- */
  const nairobi = (await one<{ id: number }>("SELECT id FROM county WHERE name = 'Nairobi'"))!.id;
  const subCounties = await all<{ id: number }>('SELECT id FROM sub_county WHERE county_id = ?', nairobi);
  const studentIds: { id: number; streamId: number; gradeId: number; admissionNo: string }[] = [];
  let parentLoginGuardian: number | null = null;
  let studentLoginStudent: number | null = null;
  for (const st of streamIds) {
    const size = int(9, 13);
    for (let i = 0; i < size; i++) {
      const female = rnd() < 0.5;
      const last = pick(LAST);
      const fatherFirst = pick(PARENT_M); const motherFirst = pick(PARENT_F);
      const guardians: students.GuardianDraft[] = [
        { fullName: `${fatherFirst} ${last}`, phone: `07${int(10000000, 99999999)}`, email: rnd() < 0.6 ? `${fatherFirst.toLowerCase()}.${last.toLowerCase()}${int(1, 99)}@mail.co.ke` : null, relationship: 'Father', occupation: pick(['Teacher', 'Engineer', 'Trader', 'Farmer', 'Civil servant', 'Driver', 'Nurse', 'Accountant']), isPrimary: true },
      ];
      if (rnd() < 0.7) guardians.push({ fullName: `${motherFirst} ${last}`, phone: `07${int(10000000, 99999999)}`, email: null, relationship: 'Mother', isPrimary: false });
      const gradeSort = grades.find((g) => g.id === st.gradeId)!;
      const ageBase = 4 + grades.filter((g) => g.education_level_name === gradeSort.education_level_name && g.sort < gradeSort.sort).length + (['Lower Primary', 'Upper Primary', 'Junior Secondary'].indexOf(gradeSort.education_level_name) + 1) * 2;
      const dob = `${year - ageBase - (rnd() < 0.3 ? 1 : 0)}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`;
      const { id, admissionNo } = await students.admitStudent({
        firstName: female ? pick(FIRST_F) : pick(FIRST_M), lastName: last, gender: female ? 'FEMALE' : 'MALE', dateOfBirth: dob,
        birthCertificateNo: String(int(1000000, 9999999)), nemisUpi: `${String.fromCharCode(65 + int(0, 25))}${int(100000, 999999)}${String.fromCharCode(65 + int(0, 25))}`,
        address: pick(['Kiambu Road', 'Thome', 'Runda', 'Roysambu', 'Garden Estate', 'Kahawa Sukari', 'Ridgeways', 'Muthaiga North']),
        countyId: nairobi, subCountyId: pick(subCounties).id, admissionDate: `${year}-01-06`, streamId: st.id,
        religion: pick(['Christian', 'Christian', 'Muslim', 'Hindu']),
      }, guardians, SYS);
      studentIds.push({ id, streamId: st.id, gradeId: st.gradeId, admissionNo });
      // The demo parent and student logins are the first Grade 4 East family.
      if (!parentLoginGuardian && st.grade === 'Grade 4' && st.name === 'East') {
        const g = await students.listStudentGuardians(id);
        parentLoginGuardian = g.find((x) => x.is_primary)?.id ?? g[0].id;
        studentLoginStudent = id;
        await run('UPDATE guardian SET full_name = ?, email = ? WHERE id = ?', 'James Mwangi', 'james.mwangi@mail.co.ke', parentLoginGuardian);
        await run("UPDATE student SET first_name = 'Brian', last_name = 'Mwangi', gender = 'MALE' WHERE id = ?", id);
        await run("UPDATE guardian g SET full_name = replace(g.full_name, split_part(g.full_name, ' ', 2), 'Mwangi') WHERE g.id IN (SELECT guardian_id FROM student_guardian WHERE student_id = ?)", id);
        await students.updateStudent(id, { firstName: 'Brian', lastName: 'Mwangi', gender: 'MALE', dateOfBirth: dob, admissionDate: `${year}-01-06`, countyId: nairobi }, (await students.listStudentGuardians(id)).map((x) => ({ id: x.id, fullName: x.full_name, phone: x.phone, email: x.email, relationship: x.relationship, isPrimary: x.is_primary })), SYS);
      }
    }
  }
  if (parentLoginGuardian) await run('INSERT INTO approval_user_setup (user_id, guardian_id) VALUES (?,?) ON CONFLICT (user_id) DO UPDATE SET guardian_id = EXCLUDED.guardian_id', await userId('parent'), parentLoginGuardian);
  if (studentLoginStudent) await run('INSERT INTO approval_user_setup (user_id, student_id) VALUES (?,?) ON CONFLICT (user_id) DO UPDATE SET student_id = EXCLUDED.student_id', await userId('student'), studentLoginStudent);

  trace(`students (${studentIds.length})`);
  /* ---- a timetable for the current term: five 40-minute lessons a day per class ---- */
  const slots = [['08:00', '08:40'], ['08:40', '09:20'], ['09:40', '10:20'], ['10:20', '11:00'], ['11:20', '12:00'], ['14:00', '14:40']];
  // Written directly rather than through timetable.saveSlot(): the same clash rule (one lesson per
  // teacher per period) is applied in memory, which turns ~350 checked inserts into one.
  const teacherBusy = new Set<string>();
  const slotRows: unknown[][] = [];
  for (const st of streamIds) {
    const assigns = await teachers.listStreamAssignments(st.id);
    if (!assigns.length) continue;
    let k = st.id % assigns.length;
    for (let day = 1; day <= 5; day++) {
      for (const [start, end] of slots) {
        // Try each assignment in turn until one whose teacher is free at this period.
        let placed = false;
        for (let tries = 0; tries < assigns.length && !placed; tries++) {
          const a = assigns[k % assigns.length]; k += 1;
          const key = `${a.teacher_id}:${day}:${start}`;
          if (teacherBusy.has(key)) continue;
          teacherBusy.add(key);
          slotRows.push([st.id, a.subject_id, a.teacher_id, yearId, term.id, day, start, end, `${st.grade} ${st.name}`]);
          placed = true;
        }
      }
    }
  }
  await insertMany('timetable_slot', ['stream_id', 'subject_id', 'teacher_id', 'academic_year_id', 'term_id', 'day_of_week', 'start_time', 'end_time', 'room'], slotRows);
  trace('timetable');

  /* ---- registers for the term so far (last 15 school days) ---- */
  const registerDays = schoolDays(term.start_date, todayIso < term.end_date ? todayIso : term.end_date).slice(-15);
  const registerRows: unknown[][] = [];
  for (const st of streamIds) {
    const roster = studentIds.filter((s) => s.streamId === st.id);
    for (const day of registerDays) {
      for (const s of roster) {
        const r = rnd();
        registerRows.push([s.id, st.id, day, r < 0.9 ? 'PRESENT' : r < 0.95 ? 'LATE' : r < 0.98 ? 'ABSENT' : 'EXCUSED', null, 'system', now]);
      }
    }
  }
  await insertMany('attendance_record', ['student_id', 'stream_id', 'date', 'status', 'remarks', 'recorded_by', 'recorded_at'], registerRows);
  trace(`registers (${registerRows.length} rows)`);

  /* ---- marks: the previous term complete and published; this term's first assessments in ---- */
  const types = await academics.listAssessmentTypes();
  const scale = await academics.getDefaultGradingScale();
  const subjectsOfGrade = new Map<number, { id: number }[]>();
  for (const st of streamIds) if (!subjectsOfGrade.has(st.gradeId)) subjectsOfGrade.set(st.gradeId, await academics.listSubjectsForGrade(st.gradeId));
  // Same rows assessments.enterMarks() would write (score, band label from the default scale), in one statement per term.
  const markTerm = async (termId: number, typeIds: number[]) => {
    const rows: unknown[][] = [];
    for (const st of streamIds) {
      const roster = studentIds.filter((s) => s.streamId === st.id);
      for (const sub of subjectsOfGrade.get(st.gradeId) ?? []) {
        for (const typeId of typeIds) {
          for (const s of roster) {
            const score = Math.min(100, Math.max(18, Math.round(62 + (rnd() + rnd() - 1) * 40)));
            const band = scale?.bands.find((b) => score >= b.min_score && score <= b.max_score);
            rows.push([s.id, sub.id, typeId, termId, yearId, score, band?.label ?? null, null, 'system', now]);
          }
        }
      }
    }
    await insertMany('assessment_record', ['student_id', 'subject_id', 'assessment_type_id', 'term_id', 'academic_year_id', 'score', 'competency_label', 'remarks', 'recorded_by', 'recorded_at'], rows);
    trace(`marks (${rows.length} rows)`);
  };
  if (previousTerm) {
    await markTerm(previousTerm.id, types.map((t) => t.id));
    for (const st of streamIds) {
      await run(
        `INSERT INTO report_card (student_id, term_id, academic_year_id, class_teacher_remarks, principal_remarks, attendance_summary, is_published, published_at, published_by)
         SELECT s.id, ?, ?, ?, ?, NULL, true, ?, 'system' FROM student s WHERE s.current_stream_id = ? AND s.status = 'ACTIVE'`,
        previousTerm.id, yearId, 'A steady term — keep up the effort and consistency.', 'Good progress. Encourage daily reading at home.', now, st.id,
      );
    }
    trace('report cards');
  }
  await markTerm(term.id, types.slice(0, 2).map((t) => t.id));

  /* ---- fees: a structure per grade for every term of the year, this term invoiced and part-paid ---- */
  const items = new Map((await feeSetup.listActiveFeeItems()).map((i) => [i.code, i.id]));
  const feeFor = (grade: string): [string, number][] => {
    const level = grades.find((g) => g.name === grade)!.education_level_name;
    const tuition = level === 'Pre-Primary' ? 18000 : level === 'Lower Primary' ? 24000 : level === 'Upper Primary' ? 28000 : 36000;
    const rows: [string, number][] = [['TUITION', tuition], ['LUNCH', 9000], ['ACTIVITY', 2500], ['EXAM', level === 'Pre-Primary' ? 0 : 1500], ['BOOKS', level === 'Junior Secondary' ? 4500 : 3000]];
    return rows.filter((r) => r[1] > 0);
  };
  for (const t of termRows) {
    for (const g of grades) {
      await feeSetup.saveGradeFeeStructure(g.id, t.id, feeFor(g.name).map(([code, amount]) => ({ gradeLevelId: g.id, feeItemId: items.get(code)!, amount: K(amount) })), SYS);
    }
  }
  const invoiceTerm = async (t: { id: number; start_date: string }) => {
    const { no } = await feeInvoices.createFeeInvoiceRun({ termId: t.id, postingDate: t.start_date, dueDate: t.start_date }, SYS);
    const r = await feeInvoices.postFeeInvoiceRun(no, SYS);
    // A failure here means the fee posting path itself is broken — say so rather than seed a school with no invoices.
    if (r.failures.length) throw new Error(`Fee invoice run ${no}: ${r.failures.length} of ${r.posted + r.failures.length} students failed to post — first: ${r.failures[0].admission_no}: ${r.failures[0].error}`);
    return r;
  };
  if (previousTerm) await invoiceTerm(previousTerm);
  await invoiceTerm(term);
  trace('fee invoices');

  // Payments: most families have paid something — cash, bank or M-Pesa — through Customer receipts.
  const bank = async (code: string) => (await one<{ id: number }>('SELECT id FROM bank_account WHERE code = ?', code))!.id;
  const banks = { CASH: await bank('CASH'), BANK: await bank('BANK'), MPESA: await bank('MPESA') };
  const bursar: Actor = { id: await userId('bursar'), username: 'bursar' };
  for (const s of studentIds) {
    const balanceRow = await one<{ balance: number; customer_no: string; name: string }>('SELECT c.balance, c.no AS customer_no, c.name FROM customer c JOIN student st ON st.customer_id = c.id WHERE st.id = ?', s.id);
    if (!balanceRow || Number(balanceRow.balance) <= 0) continue;
    const owed = Number(balanceRow.balance);
    const r = rnd();
    const share = r < 0.45 ? 1 : r < 0.8 ? pick([0.5, 0.6, 0.75]) : r < 0.9 ? 0.25 : 0;
    if (!share) continue;
    const amount = Math.round(owed * share / 100) * 100;
    const mode = pick(['MPESA', 'MPESA', 'BANK', 'CASH'] as const);
    const paidOn = pick(registerDays.length ? registerDays : [todayIso]);
    const { no } = await createReceipt({
      receiptType: 'Customer', bankAccountId: banks[mode], postingDate: paidOn, payModeCode: mode, externalDocumentNo: mode === 'MPESA' ? `S${String.fromCharCode(65 + int(0, 25))}${int(10000000, 99999999)}` : null,
      description: `Fees — ${balanceRow.name}`, receivedAmount: amount,
      lines: [{ accountNo: balanceRow.customer_no, description: 'School fees', amount }],
    }, bursar);
    await postReceipt(no, bursar);
  }

  trace('receipts');
  /* ---- announcements ---- */
  await createAnnouncement({ title: `Welcome back — ${term.name} ${year}`, body: `${term.name} runs from ${term.start_date} to ${term.end_date}. Fees are payable in full by the first day of term; pay via M-Pesa paybill 522533 using the admission number as the account.`, audience: 'ALL' }, SYS);
  await createAnnouncement({ title: 'Staff briefing every Monday, 7:30 am', body: 'All teaching staff to attend the weekly briefing in the staffroom. Class registers must be marked by 8:15 am.', audience: 'TEACHERS' }, SYS);
  await createAnnouncement({ title: 'Grade 4 East — parents’ consultation day', body: 'Parents of Grade 4 East are invited to meet the class teacher on the last Friday of the month, 2–4 pm.', audience: 'STREAM', streamId: streamIds.find((s) => s.grade === 'Grade 4' && s.name === 'East')!.id }, SYS);
  await createAnnouncement({ title: 'Junior Secondary science fair', body: 'Grades 7–9 will exhibit their integrated science projects in the assembly hall. Parents welcome.', audience: 'GRADE_LEVEL', gradeLevelId: gradeByName.get('Grade 8')! }, SYS);

  return { students: studentIds.length, teachers: teacherIds.length };
}

/**
 * A small Fixed Assets demo — three assets (a bus, classroom furniture, a computer lab) with their
 * acquisition posted and a year of depreciation run, so every FA screen has data on first run.
 */
async function seedFixedAssets(now: IsoDateTime, todayIso: IsoDate): Promise<void> {
  const bankId = await acc('1020');
  const startDate = addMonths(todayIso, -14).slice(0, 10);
  const firstOfThisMonth = `${todayIso.slice(0, 8)}01`;
  const lastMonthEnd = new Date(new Date(`${firstOfThisMonth}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);

  const demo: { input: Parameters<typeof faLib.createFixedAsset>[0]; group: string; life: number; cost: number; salvage: number }[] = [
    { input: { description: 'Computer Lab — 25 Desktops', faClassCode: 'ICT', faSubclassCode: 'COMPUTERS', faLocationCode: 'MAIN', responsibleEmployee: 'Kevin Mutua', vendorName: 'Copy Cat Ltd', assetTag: 'ICT-0001', blocked: false, inactive: false }, group: 'ICT', life: 4, cost: K(1250000), salvage: K(50000) },
    { input: { description: 'Grade 7–9 Classroom Furniture', faClassCode: 'EQUIPMENT', faSubclassCode: 'CLASSROOM', faLocationCode: 'MAIN', responsibleEmployee: 'Dennis Kiptoo', vendorName: 'Victoria Furnitures', assetTag: 'FF-0012', blocked: false, inactive: false }, group: 'EQUIPMENT', life: 8, cost: K(680000), salvage: 0 },
    { input: { description: 'Toyota Coaster 29-seater School Bus', faClassCode: 'VEHICLES', faSubclassCode: 'BUS', faLocationCode: 'MAIN', responsibleEmployee: 'Joseph Wekesa', vendorName: 'Toyota Kenya', assetTag: 'MV-0001', serialNo: 'JTGFB7180000112233', blocked: false, inactive: false }, group: 'VEHICLES', life: 8, cost: K(7800000), salvage: K(1200000) },
  ];
  for (const d of demo) {
    const { no } = await faLib.createFixedAsset(d.input, SYS);
    const asset = (await one<{ id: number }>('SELECT id FROM fixed_asset WHERE no = ?', no))!;
    await faLib.setFaDepreciationBook(asset.id, {
      depreciationBookCode: 'SCHOOL', faPostingGroupCode: d.group, depreciationMethod: 'Straight-Line', depreciationStartingDate: startDate, depreciationEndingDate: null,
      noOfDepreciationYears: d.life, straightLinePct: 0, decliningBalancePct: 0, salvageValue: d.salvage, disposalCalculationMethod: 'Net',
    }, SYS);
    const lineNo = await nextSequence('FA_JOURNAL');
    await run(
      `INSERT INTO fa_journal_line (no, posting_date, fixed_asset_id, depreciation_book_code, fa_posting_type, amount, balancing_gl_account_id, description, status, created_at, created_by)
       VALUES (?,?,?,?,'Acquisition Cost',?,?,?, 'Approved', ?, 'system')`,
      lineNo, startDate, asset.id, 'SCHOOL', d.cost, bankId, 'Opening acquisition', now,
    );
    await faJournalLib.postFaJournalLine(lineNo, SYS);
  }
  await faDeprLib.calculateDepreciation('SCHOOL', lastMonthEnd, SYS);
  for (const l of await all<{ no: string }>("SELECT no FROM fa_journal_line WHERE fa_posting_type = 'Depreciation' AND status = 'Open'")) {
    await run("UPDATE fa_journal_line SET status = 'Approved' WHERE no = ?", l.no);
    await faJournalLib.postFaJournalLine(l.no, SYS);
  }
}

/** A small Payables demo — three suppliers and a few posted purchase invoices, so Payables and Aged AP have data. */
async function seedPayables(now: IsoDateTime, todayIso: IsoDate): Promise<void> {
  const demo: { input: Parameters<typeof vendorLib.createVendor>[0] }[] = [
    { input: { name: 'Nairobi City Water & Sewerage Co.', city: 'Nairobi', phone: '+254 20 555 1234', email: 'billing@nairobiwater.co.ke', contact: 'Billing Desk', vendorPostingGroupCode: 'UTILITY', paymentTermsCode: '14 DAYS', creditLimit: 0, blocked: '' } },
    { input: { name: 'Text Book Centre Ltd', city: 'Nairobi', phone: '+254 722 998 877', email: 'schools@tbc.co.ke', contact: 'Anne Cheruiyot', vendorPostingGroupCode: 'TRADE', paymentTermsCode: '30 DAYS', creditLimit: K(2000000), blocked: '' } },
    { input: { name: 'Fresh Harvest Foods', city: 'Kiambu', phone: '+254 733 112 233', email: 'orders@freshharvest.co.ke', contact: 'Moses Kariuki', vendorPostingGroupCode: 'TRADE', paymentTermsCode: '14 DAYS', creditLimit: K(800000), blocked: '' } },
  ];
  const vendorIds: number[] = [];
  for (const d of demo) {
    const { no } = await vendorLib.createVendor(d.input, SYS);
    vendorIds.push((await one<{ id: number }>('SELECT id FROM vendor WHERE no = ?', no))!.id);
  }
  await run("UPDATE vendor SET vat_bus_posting_group_code = 'STANDARD' WHERE vat_bus_posting_group_code IS NULL");
  await run("UPDATE vendor SET pin_no = 'P051' || LPAD((id)::text, 6, '0') || 'A' WHERE pin_no IS NULL");
  const postInvoice = async (vendorId: number, postingDate: IsoDate, glCode: string, description: string, amount: number, vendorInvoiceNo: string): Promise<void> => {
    const { no } = await purchaseLib.createPurchaseDocument({ documentType: 'Invoice', vendorId, postingDate, documentDate: postingDate, vendorInvoiceNo }, SYS);
    await purchaseLib.setPurchaseLines(no, [{ type: 'G/L Account', no: glCode, description, quantity: 1, directUnitCost: amount, lineDiscountPct: 0 }], SYS);
    const vend = (await one<{ name: string; address: string | null; city: string | null; contact: string | null }>('SELECT v.name, v.address, v.city, v.contact FROM purchase_header ph JOIN vendor v ON v.id = ph.vendor_id WHERE ph.no = ?', no))!;
    await run(`UPDATE purchase_header SET status = 'Released', due_date = ?, buy_from_name = ?, buy_from_address = ?, buy_from_city = ?, buy_from_contact = ? WHERE no = ?`,
      addMonths(postingDate, 1), vend.name, vend.address, vend.city, vend.contact, no);
    await purchaseLib.postPurchaseDocument(no, { invoice: true }, SYS);
  };
  const oneMonthAgo = addMonths(todayIso, -1).slice(0, 10);
  await postInvoice(vendorIds[0], oneMonthAgo, '5230', 'Water & sewerage — last month', K(46500), 'NWS-88213');
  await postInvoice(vendorIds[1], addMonths(todayIso, -2).slice(0, 10), '5110', 'Grade 7–9 course books', K(384000), 'TBC-2026-1041');
  await postInvoice(vendorIds[2], oneMonthAgo, '5210', 'Kitchen supplies — last month', K(212000), 'FHF-5521');
  void now;
}
