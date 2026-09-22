/*
 * Business Central-style Permission Sets.
 *
 * A role's access is a set of lines, each granting rights on one Object:
 * a database Table (Read/Insert/Modify/Delete) or an application Page (an
 * Execute right — can this screen be reached at all). Business verbs like
 * "post a receipt" aren't single-table CRUD (postReceipt() posts a journal,
 * rewrites the repayment schedule, and moves two balances in one
 * transaction) so a literal 1:1 swap of "permission string" for "table
 * right" can't express them. ACTIONS below is the bridge: one named grant of
 * (owning page, table rights[]) per business operation, built directly from
 * an inventory of what each of the app's server actions actually reads and
 * writes. A call site asks for one action (`requireAction('FEES_INVOICE_POST')`)
 * and both the page Execute right and every table right it lists are
 * checked together — but the *admin-configurable unit*, in the Permission
 * Set editor, is genuinely the table and the page, not this registry.
 */
import { all } from './db.ts';
import type { SessionUser } from './types.ts';

export type ObjectType = 'TABLE' | 'PAGE';
export type Right = 'read' | 'insert' | 'modify' | 'delete';

const humanize = (identifier: string): string => identifier
  .replace(/_/g, ' ')
  .replace(/\b\w/g, (c) => c.toUpperCase());

/** Tables that must never appear in the Permission Set line dropdown: pure
 *  auth/session plumbing, and the permission engine's own storage (granting
 *  raw RIMD on permission_set_line would be a privilege-escalation hole). */
const EXCLUDED_TABLES = new Set(['session', 'permission_set_line']);

/** The live set of tables a Permission Set line may target — same
 *  information_schema introspection as lib/configPackages.ts's
 *  listConfigPackageTables(), so a new Prisma model appears here with no
 *  catalogue edit. */
export async function listPermissionTables(): Promise<{ name: string; label: string }[]> {
  const rows = await all<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
  );
  return rows
    .filter((r) => !EXCLUDED_TABLES.has(r.table_name) && !r.table_name.startsWith('_'))
    .map((r) => ({ name: r.table_name, label: humanize(r.table_name) }));
}

export interface PageObject {
  code: string;
  label: string;
  route: string;
  /**
   * The module page this screen sits inside. A finance module is one route with a tab per
   * screen — Sales Invoices, Posted documents, Aged AR — and BC grants each of those pages on
   * its own, so each tab is a page here too. Execute on the parent opens the module; Execute on
   * the child opens that screen. Granting the parent also grants every child (see
   * expandActionsToLines and the backfill in migration 20260930000000), so a permission set
   * starts with the whole module and the admin takes screens away, or builds one up screen by
   * screen from the parent alone.
   */
  parent?: string;
}

/** Pages are compiled routes, not database rows, so — unlike tables — this
 *  catalogue is maintained by hand: the BC equivalent of compiled Page
 *  objects. `/approvals` previously had no permission gate at all; giving it
 *  its own page closes that gap. */
export const PAGES: PageObject[] = [
  { code: 'DASHBOARD', label: 'Dashboard', route: '/dashboard' },
  { code: 'APPROVALS', label: 'Approvals', route: '/approvals' },
  { code: 'MPESA', label: 'M-Pesa Payments', route: '/mpesa' },
  { code: 'GL', label: 'General Ledger', route: '/accounting' },
  { code: 'GL_TRIAL_BALANCE', label: 'General Ledger › Trial Balance', route: '/accounting/trial-balance', parent: 'GL' },
  { code: 'GL_JOURNALS', label: 'General Ledger › Journals', route: '/accounting/journals', parent: 'GL' },
  { code: 'GL_ACCOUNTS', label: 'General Ledger › Chart of Accounts', route: '/accounting/accounts', parent: 'GL' },
  { code: 'GL_PERIODS', label: 'General Ledger › Accounting Periods', route: '/accounting/periods', parent: 'GL' },
  { code: 'GL_CLOSE_INCOME_STATEMENT', label: 'General Ledger › Close Income Statement', route: '/accounting/close-income-statement', parent: 'GL' },
  { code: 'INVENTORY', label: 'Inventory', route: '/inventory' },
  { code: 'INVENTORY_ITEMS', label: 'Inventory › Items', route: '/inventory/items', parent: 'INVENTORY' },
  { code: 'INVENTORY_ITEM_JOURNAL', label: 'Inventory › Item Journal', route: '/inventory/item-journal', parent: 'INVENTORY' },
  { code: 'INVENTORY_ITEM_QUANTITIES', label: 'Inventory › Qty per Location', route: '/inventory/item-quantities', parent: 'INVENTORY' },
  { code: 'INVENTORY_LEDGER', label: 'Inventory › Ledger Entries', route: '/inventory/ledger-entries', parent: 'INVENTORY' },
  { code: 'INVENTORY_REORDER', label: 'Inventory › Reorder Suggestions', route: '/inventory/reorder-suggestions', parent: 'INVENTORY' },
  { code: 'INVENTORY_LOCATIONS', label: 'Inventory › Locations', route: '/inventory/locations', parent: 'INVENTORY' },
  { code: 'INVENTORY_UNITS', label: 'Inventory › Units of Measure', route: '/inventory/units-of-measure', parent: 'INVENTORY' },
  { code: 'INVENTORY_POSTING_GROUPS', label: 'Inventory › Posting Groups', route: '/inventory/posting-groups', parent: 'INVENTORY' },
  { code: 'FIXED_ASSETS', label: 'Fixed Assets', route: '/fixed-assets' },
  { code: 'FA_ASSETS', label: 'Fixed Assets › Assets', route: '/fixed-assets/assets', parent: 'FIXED_ASSETS' },
  { code: 'FA_JOURNAL', label: 'Fixed Assets › FA Journal', route: '/fixed-assets/journal', parent: 'FIXED_ASSETS' },
  { code: 'FA_DEPRECIATION', label: 'Fixed Assets › Calculate Depreciation', route: '/fixed-assets/depreciation', parent: 'FIXED_ASSETS' },
  { code: 'FA_LEDGER', label: 'Fixed Assets › Ledger Entries', route: '/fixed-assets/ledger-entries', parent: 'FIXED_ASSETS' },
  { code: 'FA_BOOK_VALUE', label: 'Fixed Assets › Book Value', route: '/fixed-assets/book-value', parent: 'FIXED_ASSETS' },
  { code: 'FA_MAINTENANCE', label: 'Fixed Assets › Maintenance', route: '/fixed-assets/maintenance', parent: 'FIXED_ASSETS' },
  { code: 'FA_CLASSES', label: 'Fixed Assets › Classes', route: '/fixed-assets/classes', parent: 'FIXED_ASSETS' },
  { code: 'FA_LOCATIONS', label: 'Fixed Assets › Locations', route: '/fixed-assets/locations', parent: 'FIXED_ASSETS' },
  { code: 'FA_POSTING_GROUPS', label: 'Fixed Assets › Posting Groups', route: '/fixed-assets/posting-groups', parent: 'FIXED_ASSETS' },
  { code: 'FA_BOOKS', label: 'Fixed Assets › Books & Setup', route: '/fixed-assets/depreciation-books', parent: 'FIXED_ASSETS' },
  { code: 'RECEIVABLES', label: 'Receivables', route: '/receivables' },
  { code: 'RECEIVABLES_CUSTOMERS', label: 'Receivables › Customers', route: '/receivables', parent: 'RECEIVABLES' },
  { code: 'RECEIVABLES_QUOTES', label: 'Receivables › Sales Quotes', route: '/receivables/quotes', parent: 'RECEIVABLES' },
  { code: 'RECEIVABLES_ORDERS', label: 'Receivables › Sales Orders', route: '/receivables/orders', parent: 'RECEIVABLES' },
  { code: 'RECEIVABLES_SALES_INVOICES', label: 'Receivables › Sales Invoices', route: '/receivables/sales-invoices', parent: 'RECEIVABLES' },
  { code: 'RECEIVABLES_CREDIT_MEMOS', label: 'Receivables › Sales Credit Memos', route: '/receivables/credit-memos', parent: 'RECEIVABLES' },
  { code: 'RECEIVABLES_POSTED', label: 'Receivables › Posted Sales Documents', route: '/receivables/posted-documents', parent: 'RECEIVABLES' },
  { code: 'RECEIVABLES_REMINDERS', label: 'Receivables › Reminders', route: '/receivables/reminders', parent: 'RECEIVABLES' },
  { code: 'RECEIVABLES_FINANCE_CHARGES', label: 'Receivables › Finance Charge Memos', route: '/receivables/finance-charges', parent: 'RECEIVABLES' },
  { code: 'RECEIVABLES_LEDGER', label: 'Receivables › Customer Ledger Entries', route: '/receivables/ledger-entries', parent: 'RECEIVABLES' },
  { code: 'RECEIVABLES_AGED_AR', label: 'Receivables › Aged Accounts Receivable', route: '/receivables/aged-ar', parent: 'RECEIVABLES' },
  { code: 'RECEIVABLES_STATEMENT', label: 'Receivables › Customer Statement', route: '/receivables/statement', parent: 'RECEIVABLES' },
  { code: 'RECEIVABLES_REMINDER_TERMS', label: 'Receivables › Reminder Terms', route: '/receivables/reminder-terms', parent: 'RECEIVABLES' },
  { code: 'RECEIVABLES_SETUP', label: 'Receivables › Sales & Receivables Setup', route: '/receivables/setup', parent: 'RECEIVABLES' },
  { code: 'PAYABLES', label: 'Payables', route: '/payables' },
  { code: 'PAYABLES_VENDORS', label: 'Payables › Vendors', route: '/payables', parent: 'PAYABLES' },
  { code: 'PAYABLES_QUOTES', label: 'Payables › Purchase Quotes', route: '/payables/quotes', parent: 'PAYABLES' },
  { code: 'PAYABLES_ORDERS', label: 'Payables › Purchase Orders', route: '/payables/orders', parent: 'PAYABLES' },
  { code: 'PAYABLES_PURCHASE_INVOICES', label: 'Payables › Purchase Invoices', route: '/payables/purchase-invoices', parent: 'PAYABLES' },
  { code: 'PAYABLES_CREDIT_MEMOS', label: 'Payables › Purchase Credit Memos', route: '/payables/credit-memos', parent: 'PAYABLES' },
  { code: 'PAYABLES_POSTED', label: 'Payables › Posted Purchase Documents', route: '/payables/posted-documents', parent: 'PAYABLES' },
  { code: 'PAYABLES_LEDGER', label: 'Payables › Vendor Ledger Entries', route: '/payables/ledger-entries', parent: 'PAYABLES' },
  { code: 'PAYABLES_AGED_AP', label: 'Payables › Aged Accounts Payable', route: '/payables/aged-ap', parent: 'PAYABLES' },
  { code: 'PAYABLES_STATEMENT', label: 'Payables › Vendor Statement', route: '/payables/statement', parent: 'PAYABLES' },
  { code: 'PAYABLES_SETUP', label: 'Payables › Purchases & Payables Setup', route: '/payables/setup', parent: 'PAYABLES' },
  { code: 'CASH_MGMT', label: 'Cash Management', route: '/cash-management' },
  { code: 'CASH_MGMT_BANK_ACCOUNTS', label: 'Cash Management › Bank Accounts', route: '/cash-management', parent: 'CASH_MGMT' },
  { code: 'CASH_MGMT_BANK_LEDGER', label: 'Cash Management › Bank Ledger Entries', route: '/cash-management/ledger-entries', parent: 'CASH_MGMT' },
  { code: 'CASH_MGMT_RECONCILIATIONS', label: 'Cash Management › Bank Reconciliation', route: '/cash-management/reconciliations', parent: 'CASH_MGMT' },
  { code: 'CASH_MGMT_RECEIPTS', label: 'Cash Management › Receipts', route: '/cash-management/receipts', parent: 'CASH_MGMT' },
  { code: 'CASH_MGMT_PAYMENT_VOUCHERS', label: 'Cash Management › Payment Vouchers', route: '/cash-management/payment-vouchers', parent: 'CASH_MGMT' },
  { code: 'CASH_MGMT_CURRENCIES', label: 'Cash Management › Currencies', route: '/cash-management/currencies', parent: 'CASH_MGMT' },
  { code: 'CASH_MGMT_EXCHANGE_RATES', label: 'Cash Management › Exchange Rates', route: '/cash-management/exchange-rates', parent: 'CASH_MGMT' },
  { code: 'CASH_MGMT_POSTING_GROUPS', label: 'Cash Management › Bank Posting Groups', route: '/cash-management/posting-groups', parent: 'CASH_MGMT' },
  { code: 'CASH_MGMT_EXTERNAL_BANKS', label: 'Cash Management › External Banks', route: '/cash-management/external-banks', parent: 'CASH_MGMT' },
  { code: 'CASH_MGMT_SETUP', label: 'Cash Management › Cash Management Setup', route: '/cash-management/setup', parent: 'CASH_MGMT' },
  { code: 'IMPREST', label: 'Staff Cash Desk (Imprest, Petty Cash & Claims)', route: '/imprest' },
  { code: 'REQUISITIONS', label: 'Store & Purchase Requisitions', route: '/requisitions' },
  { code: 'ADMIN_POOL_IMPREST_PURPOSES', label: 'Imprest Purposes', route: '/admin/pool/finance/imprest-purposes' },
  { code: 'VAT_REPORTS', label: 'VAT & Withholding Tax', route: '/finance/vat' },
  { code: 'REPORTS', label: 'Reports', route: '/reports' },
  { code: 'FINANCIAL_REPORTS', label: 'Financial Reports', route: '/finance/financial-reports' },
  { code: 'GL_BUDGETS', label: 'Budgets', route: '/budgets' },
  { code: 'ADMIN_COMPANY', label: 'Company Information', route: '/admin/company' },
  { code: 'ADMIN_APPEARANCE', label: 'Appearance & Theme', route: '/admin/appearance' },
  { code: 'ADMIN_POOL_CURRENCIES', label: 'Currencies', route: '/admin/pool/finance/currencies' },
  { code: 'ADMIN_POOL_VAT', label: 'VAT Posting Setup', route: '/admin/pool/finance/vat-posting-setup' },
  { code: 'ADMIN_POOL_COUNTIES', label: 'Counties', route: '/admin/pool/general/counties' },
  { code: 'ADMIN_POOL_DIMENSIONS', label: 'Global Dimensions', route: '/admin/pool/general/dimensions' },
  { code: 'ADMIN_NO_SERIES', label: 'No. Series', route: '/admin/pool/general/no-series' },
  { code: 'ADMIN_PROFILES', label: 'Role Centre Profiles', route: '/admin/pool/general/profiles' },
  { code: 'ADMIN_WORKFLOWS_DEFINITIONS', label: 'Workflows', route: '/admin/workflows/definitions' },
  { code: 'ADMIN_WORKFLOWS_GROUPS', label: 'Approval User Groups', route: '/admin/workflows/groups' },
  { code: 'ADMIN_WORKFLOWS_TABLES', label: 'Table Relations', route: '/admin/workflows/tables' },
  { code: 'ADMIN_USERS', label: 'Users', route: '/admin/security/users' },
  { code: 'ADMIN_WORKFLOWS_SETUP', label: 'User Setup', route: '/admin/security/setup' },
  { code: 'ADMIN_ROLES', label: 'Permission Sets', route: '/admin/security/roles' },
  { code: 'ADMIN_AUDIT', label: 'Audit Trail', route: '/admin/security/audit' },
  { code: 'ADMIN_CHANGELOG', label: 'Change Log Management', route: '/admin/security/changelog' },
  { code: 'ADMIN_DATA', label: 'Data Management', route: '/admin/data' },
  { code: 'ADMIN_COMPANIES', label: 'Companies', route: '/admin/company/companies' },
  { code: 'ADMIN_JOB_QUEUE', label: 'System Automation', route: '/admin/pool/general/automation' },
  { code: 'ADMIN_WEB_SERVICES', label: 'Web Services (Integration)', route: '/admin/data/web-services' },
  { code: 'ADMIN_OUTBOX', label: 'Message Outbox', route: '/admin/data/outbox' },
  // Academics — the school modules (lib/students.ts, lib/academics.ts, lib/fees/*).
  { code: 'STUDENTS', label: 'Students', route: '/students' },
  { code: 'ADMISSIONS', label: 'Admissions (Applications)', route: '/admissions' },
  { code: 'INCIDENTS', label: 'Student Incidents (Discipline, Medical, Exeats)', route: '/incidents' },
  { code: 'TRANSPORT', label: 'Transport (Routes, Buses, Drivers, Work Tickets)', route: '/transport' },
  { code: 'HOSTEL', label: 'Hostel (Beds & Allocations)', route: '/hostel' },
  { code: 'LIBRARY', label: 'Library (Catalogue & Loans)', route: '/library' },
  { code: 'GUARDIANS', label: 'Guardians', route: '/guardians' },
  { code: 'TEACHERS', label: 'Teaching Staff', route: '/teachers' },
  { code: 'CLASSES', label: 'Classes (Streams)', route: '/classes' },
  { code: 'TIMETABLE', label: 'Timetable', route: '/timetable' },
  { code: 'ATTENDANCE', label: 'Attendance Register', route: '/attendance' },
  { code: 'ASSESSMENTS', label: 'Assessments', route: '/assessments' },
  { code: 'REPORT_CARDS', label: 'Report Cards', route: '/report-cards' },
  { code: 'ANNOUNCEMENTS', label: 'Announcements', route: '/announcements' },
  { code: 'FEES', label: 'Fees', route: '/fees' },
  { code: 'FEES_STRUCTURE', label: 'Fees › Fee Structure', route: '/fees/structure', parent: 'FEES' },
  { code: 'FEES_INVOICE_RUNS', label: 'Fees › Invoice Runs', route: '/fees/invoice-runs', parent: 'FEES' },
  { code: 'FEES_INVOICES', label: 'Fees › Student Invoices', route: '/fees/invoices', parent: 'FEES' },
  { code: 'FEES_BALANCES', label: 'Fees › Fee Balances', route: '/fees/balances', parent: 'FEES' },
  { code: 'FEES_STATEMENT', label: 'Fees › Student Fee Statement', route: '/fees/statement', parent: 'FEES' },
  { code: 'ADMIN_ACADEMIC_YEARS', label: 'Academic Years & Terms', route: '/admin/pool/academics/academic-years' },
  { code: 'ADMIN_ACADEMIC_STRUCTURE', label: 'Education Levels, Grades & Streams', route: '/admin/pool/academics/structure' },
  { code: 'ADMIN_SUBJECTS', label: 'Subjects', route: '/admin/pool/academics/subjects' },
  { code: 'ADMIN_GRADING', label: 'Grading Scales', route: '/admin/pool/academics/grading' },
  { code: 'ADMIN_ASSESSMENT_TYPES', label: 'Assessment Types', route: '/admin/pool/academics/assessment-types' },
  { code: 'ADMIN_FEE_ITEMS', label: 'Fee Items', route: '/admin/pool/academics/fee-items' },
  // The Teacher and Student/Parent portals — the same academic documents scoped to the login's
  // own record (User Setup's employee / student / guardian link), like Employee Self Service.
  { code: 'TEACHER_PORTAL', label: 'Teacher Portal (My Classes)', route: '/my-classes' },
  { code: 'STUDENT_PORTAL', label: 'Student / Parent Portal', route: '/portal' },
  { code: 'EMPLOYEES', label: 'Employees', route: '/employees' },
  { code: 'COMPANY_JOBS', label: 'Company Jobs', route: '/company-jobs' },
  { code: 'ORGANOGRAM', label: 'Organogram', route: '/organogram' },
  { code: 'EMPLOYEE_EDITS', label: 'Employee Editing', route: '/employee-edits' },
  { code: 'EMPLOYEE_CONTRACT_CHANGES', label: 'Employee Contract / Salary Changes', route: '/employee-contract-changes' },
  { code: 'EMPLOYEE_EXITS', label: 'Employee Exits', route: '/employee-exits' },
  { code: 'ADMIN_HR_JOB_GRADES', label: 'Job Grades', route: '/admin/pool/hr-payroll/job-grades' },
  { code: 'ADMIN_HR_SALARY_SCALES', label: 'Salary Scales', route: '/admin/pool/hr-payroll/salary-scales' },
  { code: 'ADMIN_HR_CONTRACT_TYPES', label: 'Employment Contract Types', route: '/admin/pool/hr-payroll/contract-types' },
  { code: 'ADMIN_HR_TERMINATION_REASONS', label: 'Termination Reasons', route: '/admin/pool/hr-payroll/termination-reasons' },
  { code: 'ADMIN_HR_CLEARANCE_SECTIONS', label: 'Exit Clearance Sections', route: '/admin/pool/hr-payroll/clearance-sections' },
  { code: 'LEAVE_APPLICATIONS', label: 'Leave Applications', route: '/leave-applications' },
  { code: 'LEAVE_ADJUSTMENTS', label: 'Leave Adjustments', route: '/leave-adjustments' },
  { code: 'LEAVE_RECALLS', label: 'Leave Recalls', route: '/leave-recalls' },
  { code: 'LEAVE_PLANS', label: 'Leave Plans', route: '/leave-plans' },
  { code: 'ADMIN_HR_LEAVE_TYPES', label: 'Leave Types', route: '/admin/pool/hr-payroll/leave-types' },
  { code: 'ADMIN_HR_LEAVE_CALENDAR', label: 'Leave Calendar', route: '/admin/pool/hr-payroll/leave-calendar' },
  { code: 'ADMIN_HR_HOLIDAYS', label: 'Holidays', route: '/admin/pool/hr-payroll/holidays' },
  { code: 'ADMIN_HR_ACCRUE_MATRIX', label: 'Leave Accrual Matrix', route: '/admin/pool/hr-payroll/accrue-matrix' },
  { code: 'PAYROLL', label: 'Payroll', route: '/payroll' },
  { code: 'PAYROLL_PERIODS', label: 'Payroll Periods', route: '/payroll/periods' },
  // Employee Self Service — the AL "SS" pages (SSPurchaseOrderList, SSBudgetPlans, ...): each
  // list is the same document filtered to the signed-in user's own Employee No. (User Setup).
  { code: 'SELF_SERVICE', label: 'Employee Self Service', route: '/self-service' },
  { code: 'SELF_SERVICE_PAYSLIPS', label: 'Employee Self Service › My Payslips', route: '/self-service/payslips', parent: 'SELF_SERVICE' },
  { code: 'SELF_SERVICE_P9', label: 'Employee Self Service › My P9', route: '/self-service/p9', parent: 'SELF_SERVICE' },
  { code: 'SELF_SERVICE_RECORD', label: 'Employee Self Service › My Record', route: '/self-service/record', parent: 'SELF_SERVICE' },
  { code: 'SELF_SERVICE_LEAVE', label: 'Employee Self Service › My Leave Applications', route: '/self-service/leave', parent: 'SELF_SERVICE' },
  { code: 'SELF_SERVICE_LEAVE_PLANS', label: 'Employee Self Service › My Leave Plans', route: '/self-service/leave-plans', parent: 'SELF_SERVICE' },
  { code: 'SELF_SERVICE_IMPREST', label: 'Employee Self Service › My Imprests', route: '/self-service/imprest', parent: 'SELF_SERVICE' },
  { code: 'SELF_SERVICE_PETTY_CASH', label: 'Employee Self Service › My Petty Cash', route: '/self-service/petty-cash', parent: 'SELF_SERVICE' },
  { code: 'SELF_SERVICE_REQUISITIONS', label: 'Employee Self Service › My Requisitions', route: '/self-service/requisitions', parent: 'SELF_SERVICE' },
  { code: 'ADMIN_PAYROLL_SETUP', label: 'Payroll Setup', route: '/admin/pool/hr-payroll/payroll-setup' },
  { code: 'ADMIN_PAYROLL_POSTING_GROUPS', label: 'Payroll Posting Groups', route: '/admin/pool/hr-payroll/posting-groups' },
  { code: 'ADMIN_PAYROLL_PAYE_BANDS', label: 'PAYE Bands', route: '/admin/pool/hr-payroll/paye-bands' },
  { code: 'ADMIN_PAYROLL_NSSF_TIERS', label: 'NSSF Tiers', route: '/admin/pool/hr-payroll/nssf-tiers' },
  { code: 'ADMIN_PAYROLL_TRANSACTION_CODES', label: 'Payroll Transaction Codes', route: '/admin/pool/hr-payroll/transaction-codes' },
];

export interface ActionGrant {
  page: string;
  tables: [table: string, right: Right][];
}

/**
 * One entry per surviving business operation from the old resource:action
 * catalogue. Where a single old permission string served more than one
 * physically distinct screen (one READ gated the list, the application
 * *and* the edit request alike), it is split per page here — otherwise a
 * role granted access to one of those screens would silently reach all
 * three, which defeats the point of per-page Execute rights.
 *
 * Two known bugs in the old catalogue are fixed as a side effect, not
 * carried forward: `ADMIN:CHANGE_LOG_MANAGE` was checked at 4 call sites but
 * never actually granted by any literal permission (only by the `*`
 * wildcard) — ADMIN_CHANGE_LOG_MANAGE below is real. `FEES:WRITE_OFF` and
 * `REPORT:EXPORT` were declared and seeded but never checked anywhere —
 * dropped, nothing maps to them.
 */
export const ACTIONS = {

  // M-Pesa — paybill receipts and STK payment requests (lib/mpesa). _INITIATE sends a request to
  // a handset; _ALLOCATE points an unmatched receipt at a student's fee account and posts it.
  MPESA_READ: { page: 'MPESA', tables: [['mpesa_transaction', 'read']] },
  MPESA_INITIATE: { page: 'MPESA', tables: [['mpesa_transaction', 'insert']] },
  MPESA_ALLOCATE: {
    page: 'MPESA',
    tables: [['mpesa_transaction', 'modify'], ['receipt_header', 'insert'], ['receipt_line', 'insert'], ['posted_receipt', 'insert'], ['posted_receipt_line', 'insert'], ['cust_ledger_entry', 'insert'], ['cust_ledger_entry', 'modify'], ['detailed_cust_ledger_entry', 'insert'], ['customer', 'modify'], ['journal', 'insert'], ['journal_line', 'insert'], ['bank_account_ledger_entry', 'insert']],
  },


  /** The Cheque Types master (ceilings, clearing account, clearing charge). */

  // General Ledger
  GL_READ: { page: 'GL', tables: [['journal', 'read'], ['journal_line', 'read'], ['gl_account', 'read']] },
  GL_JOURNAL_CREATE: { page: 'GL', tables: [['journal', 'insert'], ['journal_line', 'insert'], ['workflow_task', 'insert']] },
  GL_JOURNAL_APPROVE: { page: 'GL', tables: [['journal', 'insert'], ['journal_line', 'insert']] },
  GL_JOURNAL_REVERSE: { page: 'GL', tables: [['journal', 'insert'], ['journal', 'modify'], ['journal_line', 'insert']] },
  GL_PERIOD_CLOSE: { page: 'GL', tables: [['accounting_period', 'modify']] },
  /** Create Fiscal Year — the next year's periods (lib/gl.ts createFiscalYear). */
  GL_PERIOD_CREATE: { page: 'GL', tables: [['accounting_period', 'insert']] },
  /** Close Income Statement posts the year-end transfer journal (lib/closeIncomeStatement.ts). */
  GL_CLOSE_INCOME_STATEMENT: { page: 'GL_CLOSE_INCOME_STATEMENT', tables: [['journal', 'insert'], ['journal_line', 'insert'], ['accounting_period', 'read']] },
  GL_ACCOUNT_MANAGE: { page: 'GL', tables: [['gl_account', 'insert'], ['gl_account', 'modify'], ['change_log_entry', 'insert']] },
  GL_BANK_RECONCILE: {
    page: 'GL',
    tables: [['bank_reconciliation', 'insert'], ['bank_reconciliation', 'modify'], ['bank_account_ledger_entry', 'modify']],
  },

  // Inventory — Business Central-style Items/Item Journal (see lib/itemJournal.ts). _JOURNAL_POST
  // debits/credits the item's Inventory Posting Group / Product Posting Group G/L accounts.
  INVENTORY_READ: {
    page: 'INVENTORY',
    tables: [
      ['item', 'read'], ['item_unit_of_measure', 'read'], ['stockkeeping_unit', 'read'],
      ['item_journal_line', 'read'], ['item_ledger_entry', 'read'], ['item_application_entry', 'read'],
      ['location', 'read'], ['unit_of_measure', 'read'], ['inventory_posting_group', 'read'], ['product_posting_group', 'read'],
    ],
  },
  INVENTORY_ITEM_MANAGE: {
    page: 'INVENTORY',
    tables: [
      ['item', 'insert'], ['item', 'modify'], ['item', 'delete'],
      ['item_unit_of_measure', 'insert'], ['item_unit_of_measure', 'modify'], ['item_unit_of_measure', 'delete'],
    ],
  },
  /** Locations, Units of Measure, Inventory Posting Groups, Product Posting Groups. */
  INVENTORY_SETUP_MANAGE: {
    page: 'INVENTORY',
    tables: [
      ['location', 'insert'], ['location', 'modify'], ['location', 'delete'],
      ['unit_of_measure', 'insert'], ['unit_of_measure', 'modify'], ['unit_of_measure', 'delete'],
      ['inventory_posting_group', 'insert'], ['inventory_posting_group', 'modify'], ['inventory_posting_group', 'delete'],
      ['product_posting_group', 'insert'], ['product_posting_group', 'modify'], ['product_posting_group', 'delete'],
    ],
  },
  INVENTORY_JOURNAL_CREATE: {
    page: 'INVENTORY',
    tables: [
      ['item_journal_line', 'insert'], ['item_journal_line', 'modify'], ['item_journal_line', 'delete'],
      ['workflow_task', 'insert'], ['workflow_task', 'modify'],
    ],
  },
  INVENTORY_JOURNAL_APPROVE: { page: 'INVENTORY', tables: [['item_journal_line', 'modify']] },
  INVENTORY_JOURNAL_POST: {
    page: 'INVENTORY',
    tables: [
      ['item_journal_line', 'modify'], ['item', 'modify'], ['stockkeeping_unit', 'insert'], ['stockkeeping_unit', 'modify'],
      ['item_ledger_entry', 'insert'], ['item_ledger_entry', 'modify'], ['item_application_entry', 'insert'],
      ['journal', 'insert'], ['journal_line', 'insert'],
    ],
  },

  // Fixed Assets — Business Central-style FA subledger (see lib/faJournal.ts). _JOURNAL_POST
  // debits/credits the asset's FA Posting Group accounts through the shared postJournal() engine,
  // maker-checker, same shape as Inventory's Item Journal.
  FIXED_ASSETS_READ: {
    page: 'FIXED_ASSETS',
    tables: [
      ['fixed_asset', 'read'], ['fa_depreciation_book', 'read'], ['fa_journal_line', 'read'], ['fa_ledger_entry', 'read'],
      ['fa_class', 'read'], ['fa_subclass', 'read'], ['fa_location', 'read'], ['fa_posting_group', 'read'],
      ['depreciation_book', 'read'], ['fa_setup', 'read'], ['maintenance', 'read'], ['gl_account', 'read'],
    ],
  },
  FIXED_ASSETS_ASSET_MANAGE: {
    page: 'FIXED_ASSETS',
    tables: [
      ['fixed_asset', 'insert'], ['fixed_asset', 'modify'], ['fixed_asset', 'delete'],
      ['fa_depreciation_book', 'insert'], ['fa_depreciation_book', 'modify'],
    ],
  },
  /** FA Classes, Subclasses, Locations, Posting Groups, Depreciation Books, FA Setup, Maintenance. */
  FIXED_ASSETS_SETUP_MANAGE: {
    page: 'FIXED_ASSETS',
    tables: [
      ['fa_class', 'insert'], ['fa_class', 'modify'], ['fa_class', 'delete'],
      ['fa_subclass', 'insert'], ['fa_subclass', 'modify'], ['fa_subclass', 'delete'],
      ['fa_location', 'insert'], ['fa_location', 'modify'], ['fa_location', 'delete'],
      ['fa_posting_group', 'insert'], ['fa_posting_group', 'modify'], ['fa_posting_group', 'delete'],
      ['depreciation_book', 'insert'], ['depreciation_book', 'modify'], ['depreciation_book', 'delete'],
      ['fa_setup', 'insert'], ['fa_setup', 'modify'],
      ['maintenance', 'insert'], ['maintenance', 'modify'], ['maintenance', 'delete'],
    ],
  },
  FIXED_ASSETS_JOURNAL_CREATE: {
    page: 'FIXED_ASSETS',
    tables: [
      ['fa_journal_line', 'insert'], ['fa_journal_line', 'modify'], ['fa_journal_line', 'delete'],
      ['workflow_task', 'insert'], ['workflow_task', 'modify'],
    ],
  },
  FIXED_ASSETS_JOURNAL_APPROVE: { page: 'FIXED_ASSETS', tables: [['fa_journal_line', 'modify']] },
  FIXED_ASSETS_JOURNAL_POST: {
    page: 'FIXED_ASSETS',
    tables: [
      ['fa_journal_line', 'modify'], ['fa_ledger_entry', 'insert'], ['fa_depreciation_book', 'modify'],
      ['fixed_asset', 'modify'], ['journal', 'insert'], ['journal_line', 'insert'],
    ],
  },
  /** The Calculate Depreciation batch — drafts Open FA Journal lines, posts nothing itself. */
  FIXED_ASSETS_DEPRECIATION_RUN: {
    page: 'FIXED_ASSETS',
    tables: [['fa_journal_line', 'insert'], ['fa_journal_line', 'modify']],
  },

  // Receivables — Business Central Sales & Receivables (see lib/salesDocuments.ts,
  // lib/cashReceipts.ts, lib/reminders.ts, lib/custLedger.ts). Sales documents are maker-checker
  // (Open -> Pending Approval -> Released -> Posted); posting a Sales Invoice / Credit Memo can
  // also move stock (Item lines) and dispose a fixed asset (Fixed Asset lines).
  RECEIVABLES_READ: {
    page: 'RECEIVABLES',
    tables: [
      ['customer', 'read'], ['customer_posting_group', 'read'], ['payment_terms', 'read'], ['payment_method', 'read'],
      ['reminder_terms', 'read'], ['reminder_level', 'read'], ['finance_charge_terms', 'read'], ['sales_receivables_setup', 'read'],
      ['sales_header', 'read'], ['sales_line', 'read'], ['posted_sales_document', 'read'], ['posted_sales_line', 'read'],
      ['cust_ledger_entry', 'read'], ['detailed_cust_ledger_entry', 'read'],
      ['reminder_header', 'read'], ['reminder_line', 'read'], ['gl_account', 'read'],
    ],
  },
  RECEIVABLES_CUSTOMER_MANAGE: {
    page: 'RECEIVABLES',
    tables: [['customer', 'insert'], ['customer', 'modify'], ['customer', 'delete']],
  },
  /** Customer Posting Groups, Payment Terms / Methods, Reminder & Finance Charge Terms, Setup. */
  RECEIVABLES_SETUP_MANAGE: {
    page: 'RECEIVABLES',
    tables: [
      ['customer_posting_group', 'insert'], ['customer_posting_group', 'modify'], ['customer_posting_group', 'delete'],
      ['payment_terms', 'insert'], ['payment_terms', 'modify'], ['payment_terms', 'delete'],
      ['payment_method', 'insert'], ['payment_method', 'modify'], ['payment_method', 'delete'],
      ['reminder_terms', 'insert'], ['reminder_terms', 'modify'], ['reminder_terms', 'delete'],
      ['reminder_level', 'insert'], ['reminder_level', 'modify'], ['reminder_level', 'delete'],
      ['finance_charge_terms', 'insert'], ['finance_charge_terms', 'modify'], ['finance_charge_terms', 'delete'],
      ['sales_receivables_setup', 'insert'], ['sales_receivables_setup', 'modify'],
    ],
  },
  RECEIVABLES_SALES_CREATE: {
    page: 'RECEIVABLES',
    tables: [
      ['sales_header', 'insert'], ['sales_header', 'modify'], ['sales_header', 'delete'],
      ['sales_line', 'insert'], ['sales_line', 'modify'], ['sales_line', 'delete'],
      ['workflow_task', 'insert'], ['workflow_task', 'modify'],
    ],
  },
  RECEIVABLES_SALES_APPROVE: { page: 'RECEIVABLES', tables: [['sales_header', 'modify']] },
  RECEIVABLES_SALES_POST: {
    page: 'RECEIVABLES',
    tables: [
      ['sales_header', 'modify'], ['sales_header', 'delete'], ['sales_line', 'modify'],
      ['posted_sales_document', 'insert'], ['posted_sales_line', 'insert'],
      ['cust_ledger_entry', 'insert'], ['cust_ledger_entry', 'modify'], ['detailed_cust_ledger_entry', 'insert'],
      ['customer', 'modify'], ['item', 'modify'], ['item_ledger_entry', 'insert'], ['item_application_entry', 'insert'],
      ['stockkeeping_unit', 'insert'], ['stockkeeping_unit', 'modify'],
      ['fixed_asset', 'modify'], ['fa_depreciation_book', 'modify'], ['fa_ledger_entry', 'insert'],
      ['journal', 'insert'], ['journal_line', 'insert'],
    ],
  },
  /** Create Reminders / Finance Charge Memos and Issue them. */
  RECEIVABLES_REMINDER_MANAGE: {
    page: 'RECEIVABLES',
    tables: [
      ['reminder_header', 'insert'], ['reminder_header', 'modify'], ['reminder_header', 'delete'],
      ['reminder_line', 'insert'], ['reminder_line', 'delete'],
      ['cust_ledger_entry', 'insert'], ['cust_ledger_entry', 'modify'], ['detailed_cust_ledger_entry', 'insert'],
      ['customer', 'modify'], ['journal', 'insert'], ['journal_line', 'insert'],
    ],
  },
  /** Apply / unapply Cust. Ledger Entries from the ledger screen. */
  RECEIVABLES_APPLY_ENTRIES: {
    page: 'RECEIVABLES',
    tables: [
      ['cust_ledger_entry', 'modify'], ['detailed_cust_ledger_entry', 'insert'], ['detailed_cust_ledger_entry', 'modify'],
      ['customer', 'modify'], ['journal', 'insert'], ['journal_line', 'insert'],
    ],
  },

  // Payables — Business Central Purchases & Payables (see lib/purchaseDocuments.ts,
  // lib/paymentJournal.ts, lib/vendLedger.ts). The mirror of RECEIVABLES_*. Purchase documents
  // are maker-checker; posting a Purchase Invoice / Credit Memo can also receive stock (Item
  // lines) and acquire a fixed asset (Fixed Asset lines).
  PAYABLES_READ: {
    page: 'PAYABLES',
    tables: [
      ['vendor', 'read'], ['vendor_posting_group', 'read'], ['payment_terms', 'read'], ['payment_method', 'read'],
      ['purchases_payables_setup', 'read'], ['purchase_header', 'read'], ['purchase_line', 'read'],
      ['posted_purchase_document', 'read'], ['posted_purchase_line', 'read'],
      ['vendor_ledger_entry', 'read'], ['detailed_vendor_ledger_entry', 'read'], ['gl_account', 'read'],
      ['vat_posting_setup', 'read'], ['vat_product_posting_group', 'read'], ['vat_business_posting_group', 'read'],
      ['vat_entry', 'read'],
    ],
  },
  PAYABLES_VENDOR_MANAGE: {
    page: 'PAYABLES',
    tables: [['vendor', 'insert'], ['vendor', 'modify'], ['vendor', 'delete']],
  },
  /** Vendor Posting Groups + Purchases & Payables Setup. */
  PAYABLES_SETUP_MANAGE: {
    page: 'PAYABLES',
    tables: [
      ['vendor_posting_group', 'insert'], ['vendor_posting_group', 'modify'], ['vendor_posting_group', 'delete'],
      ['purchases_payables_setup', 'insert'], ['purchases_payables_setup', 'modify'],
    ],
  },
  PAYABLES_PURCHASE_CREATE: {
    page: 'PAYABLES',
    tables: [
      ['purchase_header', 'insert'], ['purchase_header', 'modify'], ['purchase_header', 'delete'],
      ['purchase_line', 'insert'], ['purchase_line', 'modify'], ['purchase_line', 'delete'],
      ['workflow_task', 'insert'], ['workflow_task', 'modify'],
    ],
  },
  PAYABLES_PURCHASE_APPROVE: { page: 'PAYABLES', tables: [['purchase_header', 'modify']] },
  PAYABLES_PURCHASE_POST: {
    page: 'PAYABLES',
    tables: [
      ['purchase_header', 'modify'], ['purchase_header', 'delete'], ['purchase_line', 'modify'],
      ['posted_purchase_document', 'insert'], ['posted_purchase_line', 'insert'],
      ['vendor_ledger_entry', 'insert'], ['vendor_ledger_entry', 'modify'], ['detailed_vendor_ledger_entry', 'insert'],
      ['vendor', 'modify'], ['item', 'modify'], ['item_ledger_entry', 'insert'],
      ['stockkeeping_unit', 'insert'], ['stockkeeping_unit', 'modify'],
      ['fixed_asset', 'modify'], ['fa_depreciation_book', 'modify'], ['fa_ledger_entry', 'insert'],
      ['journal', 'insert'], ['journal_line', 'insert'], ['vat_entry', 'insert'],
    ],
  },
  /** Apply / unapply Vendor Ledger Entries from the ledger screen. */
  PAYABLES_APPLY_ENTRIES: {
    page: 'PAYABLES',
    tables: [
      ['vendor_ledger_entry', 'modify'], ['detailed_vendor_ledger_entry', 'insert'], ['detailed_vendor_ledger_entry', 'modify'],
      ['vendor', 'modify'], ['journal', 'insert'], ['journal_line', 'insert'],
    ],
  },

  // Cash Management — Bank Accounts, Reconciliation, Receipts, Payment Vouchers, Currencies.
  CASH_MGMT_READ: {
    page: 'CASH_MGMT',
    tables: [
      ['bank_account', 'read'], ['bank_account_ledger_entry', 'read'], ['bank_acc_posting_group', 'read'],
      ['bank_reconciliation', 'read'], ['bank_rec_line', 'read'], ['currency', 'read'], ['currency_exchange_rate', 'read'],
      ['external_bank', 'read'], ['external_bank_branch', 'read'], ['cash_management_setup', 'read'],
      ['receipt_header', 'read'], ['receipt_line', 'read'], ['posted_receipt', 'read'], ['posted_receipt_line', 'read'],
      ['payment_voucher_header', 'read'], ['payment_voucher_line', 'read'], ['posted_payment_voucher', 'read'],
      ['posted_payment_voucher_line', 'read'], ['wht_certificate', 'read'], ['wht_certificate_line', 'read'],
      ['vat_posting_setup', 'read'], ['gl_account', 'read'],
    ],
  },
  CASH_MGMT_BANK_MANAGE: {
    page: 'CASH_MGMT',
    tables: [
      ['bank_account', 'insert'], ['bank_account', 'modify'], ['bank_acc_posting_group', 'insert'],
      ['bank_acc_posting_group', 'modify'], ['bank_acc_posting_group', 'delete'], ['gl_account', 'modify'],
      ['external_bank', 'insert'], ['external_bank', 'modify'], ['external_bank', 'delete'],
      ['external_bank_branch', 'insert'], ['external_bank_branch', 'modify'], ['external_bank_branch', 'delete'],
    ],
  },
  CASH_MGMT_SETUP_MANAGE: {
    page: 'CASH_MGMT',
    tables: [['cash_management_setup', 'insert'], ['cash_management_setup', 'modify']],
  },
  CASH_MGMT_CURRENCY_MANAGE: {
    page: 'CASH_MGMT',
    tables: [
      ['currency', 'insert'], ['currency', 'modify'], ['currency_exchange_rate', 'insert'],
      ['currency_exchange_rate', 'modify'], ['currency_exchange_rate', 'delete'],
    ],
  },
  CASH_MGMT_RECONCILE: {
    page: 'CASH_MGMT',
    tables: [
      ['bank_reconciliation', 'insert'], ['bank_reconciliation', 'modify'], ['bank_rec_line', 'insert'],
      ['bank_rec_line', 'modify'], ['bank_rec_line', 'delete'], ['bank_account_ledger_entry', 'modify'],
      ['bank_account', 'modify'], ['journal', 'insert'], ['journal_line', 'insert'],
    ],
  },
  CASH_MGMT_FX_ADJUST: {
    page: 'CASH_MGMT',
    tables: [
      ['cust_ledger_entry', 'modify'], ['vendor_ledger_entry', 'modify'], ['detailed_cust_ledger_entry', 'insert'],
      ['detailed_vendor_ledger_entry', 'insert'], ['bank_account', 'modify'], ['journal', 'insert'], ['journal_line', 'insert'],
    ],
  },
  CASH_MGMT_RECEIPT_CREATE: {
    page: 'CASH_MGMT',
    tables: [
      ['receipt_header', 'insert'], ['receipt_header', 'modify'], ['receipt_header', 'delete'],
      ['receipt_line', 'insert'], ['receipt_line', 'modify'], ['receipt_line', 'delete'],
      ['workflow_task', 'insert'], ['workflow_task', 'modify'],
    ],
  },
  CASH_MGMT_RECEIPT_APPROVE: { page: 'CASH_MGMT', tables: [['receipt_header', 'modify']] },
  CASH_MGMT_RECEIPT_POST: {
    page: 'CASH_MGMT',
    tables: [
      ['receipt_header', 'modify'], ['posted_receipt', 'insert'], ['posted_receipt_line', 'insert'],
      ['cust_ledger_entry', 'insert'], ['cust_ledger_entry', 'modify'], ['detailed_cust_ledger_entry', 'insert'],
      ['vendor_ledger_entry', 'insert'], ['vendor_ledger_entry', 'modify'], ['detailed_vendor_ledger_entry', 'insert'],
      ['customer', 'modify'], ['vendor', 'modify'], ['bank_account', 'modify'], ['bank_account_ledger_entry', 'insert'],
      ['journal', 'insert'], ['journal_line', 'insert'],
    ],
  },
  CASH_MGMT_PV_CREATE: {
    page: 'CASH_MGMT',
    tables: [
      ['payment_voucher_header', 'insert'], ['payment_voucher_header', 'modify'], ['payment_voucher_header', 'delete'],
      ['payment_voucher_line', 'insert'], ['payment_voucher_line', 'modify'], ['payment_voucher_line', 'delete'],
      ['workflow_task', 'insert'], ['workflow_task', 'modify'],
    ],
  },
  CASH_MGMT_PV_APPROVE: { page: 'CASH_MGMT', tables: [['payment_voucher_header', 'modify']] },
  CASH_MGMT_PV_POST: {
    page: 'CASH_MGMT',
    tables: [
      ['payment_voucher_header', 'modify'], ['posted_payment_voucher', 'insert'], ['posted_payment_voucher_line', 'insert'],
      ['vendor_ledger_entry', 'insert'], ['vendor_ledger_entry', 'modify'], ['detailed_vendor_ledger_entry', 'insert'],
      ['cust_ledger_entry', 'insert'], ['cust_ledger_entry', 'modify'], ['detailed_cust_ledger_entry', 'insert'],
      ['vendor', 'modify'], ['customer', 'modify'], ['bank_account', 'modify'], ['bank_account_ledger_entry', 'insert'],
      ['vat_entry', 'insert'], ['wht_certificate', 'insert'], ['wht_certificate_line', 'insert'],
      ['journal', 'insert'], ['journal_line', 'insert'],
    ],
  },
  CASH_MGMT_APPLY_ENTRIES: {
    page: 'CASH_MGMT',
    tables: [
      ['cust_ledger_entry', 'modify'], ['vendor_ledger_entry', 'modify'], ['detailed_cust_ledger_entry', 'insert'],
      ['detailed_vendor_ledger_entry', 'insert'], ['customer', 'modify'], ['vendor', 'modify'],
      ['journal', 'insert'], ['journal_line', 'insert'],
    ],
  },

  // VAT + Withholding Tax
  VAT_REPORT_READ: { page: 'VAT_REPORTS', tables: [['vat_entry', 'read'], ['wht_certificate', 'read'], ['wht_certificate_line', 'read']] },
  VAT_SETUP_MANAGE: {
    page: 'ADMIN_POOL_VAT',
    tables: [
      ['vat_business_posting_group', 'insert'], ['vat_business_posting_group', 'modify'], ['vat_business_posting_group', 'delete'],
      ['vat_product_posting_group', 'insert'], ['vat_product_posting_group', 'modify'], ['vat_product_posting_group', 'delete'],
      ['vat_posting_setup', 'insert'], ['vat_posting_setup', 'modify'], ['vat_posting_setup', 'delete'],
    ],
  },
  WHT_CERTIFICATE_PRINT: { page: 'CASH_MGMT', tables: [['wht_certificate', 'read'], ['wht_certificate_line', 'read']] },
  WHT_MARK_REMITTED: { page: 'VAT_REPORTS', tables: [['wht_certificate', 'modify'], ['vat_entry', 'modify']] },
  CURRENCY_SETUP_MANAGE: {
    page: 'ADMIN_POOL_CURRENCIES',
    tables: [['currency', 'insert'], ['currency', 'modify'], ['currency_exchange_rate', 'insert'], ['currency_exchange_rate', 'modify'], ['currency_exchange_rate', 'delete']],
  },

  // Reporting — pure aggregation, execute-only (see file header).
  DASHBOARD_VIEW: { page: 'DASHBOARD', tables: [] },
  REPORTS_VIEW: { page: 'REPORTS', tables: [] },
  APPROVALS_VIEW: { page: 'APPROVALS', tables: [] },

  // Financial Reports (Account Schedules) — Business Central Financial Report / Acc. Schedule
  // designer and runner (see lib/financialReports.ts). _READ runs and prints a report from the
  // ledger; _MANAGE edits the row definitions, column layouts and the report pairings.
  /** G/L budgets (lib/glBudgets.ts) — read for the matrix and Budget vs Actual; manage to type figures. */
  GL_BUDGETS_READ: { page: 'GL_BUDGETS', tables: [['gl_budget_name', 'read'], ['gl_budget_entry', 'read']] },
  GL_BUDGETS_MANAGE: {
    page: 'GL_BUDGETS',
    tables: [['gl_budget_name', 'insert'], ['gl_budget_name', 'modify'], ['gl_budget_name', 'delete'], ['gl_budget_entry', 'insert'], ['gl_budget_entry', 'modify'], ['gl_budget_entry', 'delete']],
  },
  FINANCIAL_REPORTS_READ: {
    page: 'FINANCIAL_REPORTS',
    tables: [
      ['financial_report', 'read'], ['acc_schedule_name', 'read'], ['acc_schedule_line', 'read'],
      ['column_layout_name', 'read'], ['column_layout', 'read'],
      ['gl_account', 'read'], ['journal', 'read'], ['journal_line', 'read'],
    ],
  },
  FINANCIAL_REPORTS_MANAGE: {
    page: 'FINANCIAL_REPORTS',
    tables: [
      ['financial_report', 'insert'], ['financial_report', 'modify'], ['financial_report', 'delete'],
      ['acc_schedule_name', 'insert'], ['acc_schedule_name', 'modify'], ['acc_schedule_name', 'delete'],
      ['acc_schedule_line', 'insert'], ['acc_schedule_line', 'modify'], ['acc_schedule_line', 'delete'],
      ['column_layout_name', 'insert'], ['column_layout_name', 'modify'], ['column_layout_name', 'delete'],
      ['column_layout', 'insert'], ['column_layout', 'modify'], ['column_layout', 'delete'],
    ],
  },

  // Admin Centre
  ADMIN_ORG_MANAGE: { page: 'ADMIN_COMPANY', tables: [['organisation', 'modify']] },
  ADMIN_THEME_MANAGE: { page: 'ADMIN_APPEARANCE', tables: [['theme', 'modify']] },
  ADMIN_USER_MANAGE: {
    page: 'ADMIN_USERS',
    tables: [
      ['app_user', 'insert'], ['app_user', 'modify'],
      // Assigning Role Centre Profiles to a user happens on the same form.
      ['user_profile', 'insert'], ['user_profile', 'delete'],
      // Per-user permission overrides (the Permissions editor on the Users tab).
      ['user_permission_line', 'insert'], ['user_permission_line', 'modify'], ['user_permission_line', 'delete'],
    ],
  },
  ADMIN_ROLE_MANAGE: { page: 'ADMIN_ROLES', tables: [['role', 'insert'], ['role', 'modify']] },

  // Role Centre Profiles — the landing-page selector catalogue (Admin Centre → Setup Pool →
  // General). A Profile grants no rights of its own; see lib/profiles.ts. _READ lists them (the
  // user form needs it to render the assignment checkboxes), _MANAGE edits the custom ones.
  ADMIN_PROFILES_READ: { page: 'ADMIN_PROFILES', tables: [['profile', 'read']] },
  ADMIN_PROFILES_MANAGE: {
    page: 'ADMIN_PROFILES',
    tables: [
      ['profile', 'insert'], ['profile', 'modify'], ['profile', 'delete'],
      ['user_profile', 'insert'], ['user_profile', 'delete'],
    ],
  },
  /** Versioned classification bands, provision rates and prudential limits (lib/regulatory.ts). */
  /** Delinquency, portfolio, exposure and prudential returns (lib/creditReports.ts). */
  /** SASRA Sectorial Lending classification masters (see lib/economicSectors.ts). */
  /** Business Central No. Series Management (see lib/noSeries.ts). */
  ADMIN_NO_SERIES_READ: {
    page: 'ADMIN_NO_SERIES',
    tables: [['no_series', 'read'], ['no_series_line', 'read'], ['no_series_setup', 'read']],
  },
  ADMIN_NO_SERIES_MANAGE: {
    page: 'ADMIN_NO_SERIES',
    tables: [
      ['no_series', 'insert'], ['no_series', 'modify'], ['no_series', 'delete'],
      ['no_series_line', 'insert'], ['no_series_line', 'modify'], ['no_series_line', 'delete'],
      ['no_series_setup', 'insert'], ['no_series_setup', 'modify'],
    ],
  },
  /** The admin-defined list of predefined account instructions (see lib/accountInstructions.ts). */
  ADMIN_POOL_COUNTIES_MANAGE: { page: 'ADMIN_POOL_COUNTIES', tables: [['county', 'insert'], ['county', 'modify'], ['sub_county', 'insert'], ['sub_county', 'delete']] },
  ADMIN_POOL_DIMENSIONS_MANAGE: {
    page: 'ADMIN_POOL_DIMENSIONS',
    tables: [['global_dimension_1_value', 'insert'], ['global_dimension_1_value', 'modify'], ['global_dimension_2_value', 'insert'], ['global_dimension_2_value', 'modify'], ['organisation', 'modify']],
  },
  ADMIN_WORKFLOWS_DEFINITIONS_MANAGE: {
    page: 'ADMIN_WORKFLOWS_DEFINITIONS',
    tables: [['workflow', 'insert'], ['workflow', 'modify'], ['workflow_condition', 'insert'], ['workflow_condition', 'delete'], ['workflow_step', 'insert'], ['workflow_step', 'delete']],
  },
  ADMIN_WORKFLOWS_GROUPS_MANAGE: {
    page: 'ADMIN_WORKFLOWS_GROUPS',
    tables: [['workflow_user_group', 'insert'], ['workflow_user_group', 'modify'], ['workflow_user_group_member', 'insert'], ['workflow_user_group_member', 'delete']],
  },
  ADMIN_WORKFLOWS_SETUP_MANAGE: { page: 'ADMIN_WORKFLOWS_SETUP', tables: [['approval_user_setup', 'insert'], ['approval_user_setup', 'modify']] },
  ADMIN_WORKFLOWS_TABLES_MANAGE: {
    page: 'ADMIN_WORKFLOWS_TABLES',
    tables: [['workflow_table_relation', 'insert'], ['workflow_table_relation_field', 'insert'], ['workflow_table_relation_field', 'delete']],
  },
  ADMIN_CONFIG_PACKAGE_MANAGE: {
    page: 'ADMIN_DATA',
    tables: [['config_package', 'insert'], ['config_package', 'modify'], ['config_package', 'delete'], ['config_package_field', 'insert'], ['config_package_field', 'delete']],
  },
  ADMIN_CHANGE_LOG_MANAGE: {
    page: 'ADMIN_CHANGELOG',
    tables: [['change_log_setup', 'insert'], ['change_log_setup', 'modify'], ['change_log_setup', 'delete'], ['change_log_entry', 'read']],
  },
  ADMIN_AUDIT_VIEW: { page: 'ADMIN_AUDIT', tables: [['audit_log', 'read']] },

  // System Automation (Job Queue) — mirrors Business Central's Job Queue Entry: the admin sets
  // up recurring background tasks (currently just Entrance Fee Recovery — see lib/jobQueue.ts's
  // JOB_HANDLERS) that the in-process scheduler (instrumentation.ts) polls and runs unattended.
  // One grant covers the whole screen, including manually running an entry on demand — same
  // shape ACCOUNT_ACTIVATION_APPROVE bundles its own posting rights under a single action.
  // Business Central Web Services (Admin Centre → Integration): registering objects
  // as OData/SOAP services, issuing users' Web Service Access Keys, reading the call log.
  // Companies (Admin Centre → Companies): copying the live company into a test company, deleting
  // a copy. Switching between companies needs no grant — a copy holds the same users and rights.
  COMPANIES_READ: { page: 'ADMIN_COMPANIES', tables: [['company', 'read']] },
  COMPANIES_MANAGE: { page: 'ADMIN_COMPANIES', tables: [['company', 'insert'], ['company', 'modify'], ['company', 'delete']] },
  // Message Outbox — every outbound e-mail/SMS and its delivery state (lib/outbox.ts).
  OUTBOX_READ: { page: 'ADMIN_OUTBOX', tables: [['message_outbox', 'read']] },
  OUTBOX_MANAGE: { page: 'ADMIN_OUTBOX', tables: [['message_outbox', 'modify'], ['message_outbox', 'delete']] },
  WEB_SERVICES_READ: {
    page: 'ADMIN_WEB_SERVICES',
    tables: [['web_service', 'read'], ['web_service_access_key', 'read'], ['web_service_log', 'read'], ['app_user', 'read']],
  },
  WEB_SERVICES_MANAGE: {
    page: 'ADMIN_WEB_SERVICES',
    tables: [
      ['web_service', 'insert'], ['web_service', 'modify'], ['web_service', 'delete'],
      ['web_service_access_key', 'insert'], ['web_service_access_key', 'modify'], ['web_service_access_key', 'delete'],
      ['web_service_log', 'delete'],
    ],
  },
  ADMIN_JOB_QUEUE_MANAGE: {
    page: 'ADMIN_JOB_QUEUE',
    tables: [
      ['job_queue_entry', 'insert'], ['job_queue_entry', 'modify'], ['job_queue_entry', 'delete'],
      ['session', 'delete'], ['message_outbox', 'modify'], ['mpesa_transaction', 'modify'],
    ],
  },

  // Academics — students, staff, classes, registers and grades (lib/students.ts, lib/academics.ts).
  STUDENTS_READ: { page: 'STUDENTS', tables: [['student', 'read'], ['student_guardian', 'read'], ['guardian', 'read'], ['enrollment', 'read'], ['customer', 'read'], ['cust_ledger_entry', 'read']] },
  /** Admission: the student, their guardians and the Receivables customer that is their fee account. */
  STUDENTS_CREATE: {
    page: 'STUDENTS',
    tables: [['student', 'insert'], ['student_guardian', 'insert'], ['guardian', 'insert'], ['enrollment', 'insert'], ['customer', 'insert']],
  },
  STUDENTS_UPDATE: {
    page: 'STUDENTS',
    tables: [['student', 'modify'], ['student_guardian', 'insert'], ['student_guardian', 'delete'], ['guardian', 'modify'], ['enrollment', 'insert'], ['enrollment', 'modify'], ['customer', 'modify'], ['attachment', 'insert'], ['attachment', 'delete']],
  },
  ADMISSIONS_READ: { page: 'ADMISSIONS', tables: [['admission_application', 'read']] },
  /** Enquiries, applications, offers — and admitting one, which creates the student like STUDENTS_CREATE does. */
  ADMISSIONS_MANAGE: {
    page: 'ADMISSIONS',
    tables: [['admission_application', 'insert'], ['admission_application', 'modify'], ['student', 'insert'], ['student_guardian', 'insert'], ['guardian', 'insert'], ['enrollment', 'insert'], ['customer', 'insert']],
  },
  INCIDENTS_READ: { page: 'INCIDENTS', tables: [['student_incident', 'read']] },
  TRANSPORT_READ: { page: 'TRANSPORT', tables: [['transport_route', 'read'], ['transport_stop', 'read'], ['school_bus', 'read'], ['driver_profile', 'read'], ['student_transport', 'read'], ['bus_work_ticket', 'read'], ['fixed_asset', 'read']] },
  /** Routes, stops, buses, drivers and which students ride — the transport office. */
  TRANSPORT_MANAGE: {
    page: 'TRANSPORT',
    tables: [['transport_route', 'insert'], ['transport_route', 'modify'], ['transport_route', 'delete'], ['transport_stop', 'insert'], ['transport_stop', 'modify'], ['transport_stop', 'delete'],
      ['school_bus', 'insert'], ['school_bus', 'modify'], ['driver_profile', 'insert'], ['driver_profile', 'modify'], ['driver_profile', 'delete'], ['student_transport', 'insert'], ['student_transport', 'modify'], ['student_transport', 'delete'], ['student_fee_option', 'insert'], ['student_fee_option', 'delete']],
  },
  /** Opening, closing and cancelling work tickets — the transport office or the driver's supervisor. */
  TRANSPORT_WORK_TICKETS: { page: 'TRANSPORT', tables: [['bus_work_ticket', 'insert'], ['bus_work_ticket', 'modify'], ['school_bus', 'modify']] },
  HOSTEL_READ: { page: 'HOSTEL', tables: [['hostel', 'read'], ['hostel_room', 'read'], ['hostel_bed', 'read'], ['bed_allocation', 'read']] },
  HOSTEL_MANAGE: { page: 'HOSTEL', tables: [['hostel', 'insert'], ['hostel', 'modify'], ['hostel_room', 'insert'], ['hostel_room', 'modify'], ['hostel_room', 'delete'], ['hostel_bed', 'insert'], ['hostel_bed', 'modify'], ['hostel_bed', 'delete'], ['bed_allocation', 'insert'], ['bed_allocation', 'modify']] },
  LIBRARY_READ: { page: 'LIBRARY', tables: [['library_setup', 'read'], ['library_book', 'read'], ['library_copy', 'read'], ['library_loan', 'read']] },
  /** The catalogue and the loan desk — issue, return, fines. */
  LIBRARY_MANAGE: { page: 'LIBRARY', tables: [['library_book', 'insert'], ['library_book', 'modify'], ['library_copy', 'insert'], ['library_copy', 'modify'], ['library_loan', 'insert'], ['library_loan', 'modify']] },
  /** Library rules and the fines account, and charging a fine to a student's fee account. */
  LIBRARY_SETUP_MANAGE: { page: 'LIBRARY', tables: [['library_setup', 'insert'], ['library_setup', 'modify'], ['sales_header', 'insert'], ['sales_line', 'insert']] },
  INCIDENTS_MANAGE: { page: 'INCIDENTS', tables: [['student_incident', 'insert'], ['student_incident', 'modify'], ['student_incident', 'delete']] },
  /** Electives a student takes — set on the student card by the academics office. */
  STUDENTS_SUBJECTS_MANAGE: { page: 'STUDENTS', tables: [['student_subject', 'insert'], ['student_subject', 'delete']] },
  GUARDIANS_READ: { page: 'GUARDIANS', tables: [['guardian', 'read'], ['student_guardian', 'read']] },
  GUARDIANS_MANAGE: { page: 'GUARDIANS', tables: [['guardian', 'insert'], ['guardian', 'modify'], ['guardian', 'delete']] },
  TEACHERS_READ: { page: 'TEACHERS', tables: [['teacher_profile', 'read'], ['employee', 'read'], ['teacher_subject_assignment', 'read']] },
  /** Flag an employee as teaching staff, and assign the subjects/streams they teach. */
  TEACHERS_MANAGE: {
    page: 'TEACHERS',
    tables: [['teacher_profile', 'insert'], ['teacher_profile', 'modify'], ['teacher_profile', 'delete'], ['teacher_subject_assignment', 'insert'], ['teacher_subject_assignment', 'delete']],
  },
  CLASSES_READ: { page: 'CLASSES', tables: [['stream', 'read'], ['student', 'read'], ['enrollment', 'read']] },
  /** Open streams for a year, set class teachers, move students between streams, promote at year end. */
  CLASSES_MANAGE: {
    page: 'CLASSES',
    tables: [['stream', 'insert'], ['stream', 'modify'], ['stream', 'delete'], ['student', 'modify'], ['enrollment', 'insert'], ['enrollment', 'modify']],
  },
  TIMETABLE_READ: { page: 'TIMETABLE', tables: [['timetable_slot', 'read']] },
  TIMETABLE_MANAGE: { page: 'TIMETABLE', tables: [['timetable_slot', 'insert'], ['timetable_slot', 'modify'], ['timetable_slot', 'delete']] },
  ATTENDANCE_READ: { page: 'ATTENDANCE', tables: [['attendance_record', 'read']] },
  ATTENDANCE_MARK: { page: 'ATTENDANCE', tables: [['attendance_record', 'insert'], ['attendance_record', 'modify']] },
  ASSESSMENTS_READ: { page: 'ASSESSMENTS', tables: [['assessment_record', 'read']] },
  ASSESSMENTS_ENTER: { page: 'ASSESSMENTS', tables: [['assessment_record', 'insert'], ['assessment_record', 'modify'], ['assessment_record', 'delete']] },
  REPORT_CARDS_READ: { page: 'REPORT_CARDS', tables: [['report_card', 'read'], ['assessment_record', 'read'], ['attendance_record', 'read']] },
  REPORT_CARDS_PUBLISH: { page: 'REPORT_CARDS', tables: [['report_card', 'insert'], ['report_card', 'modify']] },
  ANNOUNCEMENTS_READ: { page: 'ANNOUNCEMENTS', tables: [['announcement', 'read']] },
  ANNOUNCEMENTS_MANAGE: { page: 'ANNOUNCEMENTS', tables: [['announcement', 'insert'], ['announcement', 'modify'], ['announcement', 'delete']] },

  // Fees — priced per grade per term, invoiced through Receivables, collected through Receipts (lib/fees/*).
  FEES_READ: {
    page: 'FEES',
    tables: [['fee_item', 'read'], ['fee_structure', 'read'], ['fee_invoice_run', 'read'], ['fee_invoice', 'read'], ['customer', 'read'], ['cust_ledger_entry', 'read'], ['posted_sales_document', 'read'], ['posted_sales_line', 'read']],
  },
  FEES_STRUCTURE_MANAGE: { page: 'FEES_STRUCTURE', tables: [['fee_structure', 'insert'], ['fee_structure', 'modify'], ['fee_structure', 'delete']] },
  /** Raise and post the term's invoices — one posted sales invoice per student, in one run. */
  FEES_INVOICE_RUN: {
    page: 'FEES_INVOICE_RUNS',
    tables: [
      ['fee_invoice_run', 'insert'], ['fee_invoice_run', 'modify'], ['fee_invoice', 'insert'],
      ['sales_header', 'insert'], ['sales_line', 'insert'], ['posted_sales_document', 'insert'], ['posted_sales_line', 'insert'],
      ['cust_ledger_entry', 'insert'], ['detailed_cust_ledger_entry', 'insert'], ['customer', 'modify'],
      ['journal', 'insert'], ['journal_line', 'insert'],
    ],
  },
  /** Send fee balance reminders to guardians by SMS / e-mail. */
  FEES_REMIND: { page: 'FEES_BALANCES', tables: [['message_outbox', 'insert']] },
  ADMIN_ACADEMIC_YEARS_MANAGE: {
    page: 'ADMIN_ACADEMIC_YEARS',
    tables: [['academic_year', 'insert'], ['academic_year', 'modify'], ['academic_year', 'delete'], ['academic_term', 'insert'], ['academic_term', 'modify'], ['academic_term', 'delete']],
  },
  ADMIN_ACADEMIC_STRUCTURE_MANAGE: {
    page: 'ADMIN_ACADEMIC_STRUCTURE',
    tables: [['education_level', 'insert'], ['education_level', 'modify'], ['education_level', 'delete'], ['grade_level', 'insert'], ['grade_level', 'modify'], ['grade_level', 'delete'], ['stream', 'insert'], ['stream', 'modify'], ['stream', 'delete']],
  },
  ADMIN_SUBJECTS_MANAGE: {
    page: 'ADMIN_SUBJECTS',
    tables: [['subject', 'insert'], ['subject', 'modify'], ['subject', 'delete'], ['subject_offering', 'insert'], ['subject_offering', 'delete']],
  },
  ADMIN_GRADING_MANAGE: {
    page: 'ADMIN_GRADING',
    tables: [['grading_scale', 'insert'], ['grading_scale', 'modify'], ['grading_scale', 'delete'], ['assessment_band', 'insert'], ['assessment_band', 'modify'], ['assessment_band', 'delete']],
  },
  ADMIN_ASSESSMENT_TYPES_MANAGE: { page: 'ADMIN_ASSESSMENT_TYPES', tables: [['assessment_type', 'insert'], ['assessment_type', 'modify'], ['assessment_type', 'delete']] },
  ADMIN_FEE_ITEMS_MANAGE: { page: 'ADMIN_FEE_ITEMS', tables: [['fee_item', 'insert'], ['fee_item', 'modify'], ['fee_item', 'delete']] },

  // Portals. A teacher's own classes; a student's or guardian's own record — everything read
  // through these is scoped server-side to the login's linked record (lib/portal.ts).
  TEACHER_PORTAL_VIEW: {
    page: 'TEACHER_PORTAL',
    tables: [['teacher_subject_assignment', 'read'], ['stream', 'read'], ['student', 'read'], ['timetable_slot', 'read'], ['announcement', 'read']],
  },
  TEACHER_PORTAL_ATTENDANCE: { page: 'TEACHER_PORTAL', tables: [['attendance_record', 'read'], ['attendance_record', 'insert'], ['attendance_record', 'modify']] },
  TEACHER_PORTAL_ASSESSMENTS: { page: 'TEACHER_PORTAL', tables: [['assessment_record', 'read'], ['assessment_record', 'insert'], ['assessment_record', 'modify']] },
  TEACHER_PORTAL_ANNOUNCE: { page: 'TEACHER_PORTAL', tables: [['announcement', 'insert']] },
  STUDENT_PORTAL_VIEW: {
    page: 'STUDENT_PORTAL',
    tables: [
      ['student', 'read'], ['guardian', 'read'], ['student_guardian', 'read'], ['enrollment', 'read'], ['timetable_slot', 'read'],
      ['assessment_record', 'read'], ['report_card', 'read'], ['attendance_record', 'read'], ['announcement', 'read'],
      ['customer', 'read'], ['cust_ledger_entry', 'read'], ['posted_sales_document', 'read'], ['fee_invoice', 'read'],
      ['student_transport', 'read'], ['transport_route', 'read'], ['transport_stop', 'read'], ['school_bus', 'read'], ['bed_allocation', 'read'], ['hostel_bed', 'read'], ['hostel_room', 'read'], ['hostel', 'read'], ['library_loan', 'read'], ['library_copy', 'read'], ['library_book', 'read'],
    ],
  },
  /** Pay fees from the portal — an M-Pesa STK push to the parent's own phone for their own child. */
  STUDENT_PORTAL_PAY: { page: 'STUDENT_PORTAL', tables: [['mpesa_transaction', 'insert'], ['mpesa_transaction', 'read']] },

  // Employee Management (see lib/employees.ts). The staff master itself is maker-checker at
  // onboarding only (New -> Pending Approval -> Active); once Active, further changes route
  // through Employee Editing / Employee Contract Change / Employee Exit below instead.
  EMPLOYEES_READ: {
    page: 'EMPLOYEES',
    tables: [
      ['employee', 'read'], ['employee_next_of_kin', 'read'], ['employee_beneficiary', 'read'],
      ['employee_dependant', 'read'], ['employee_emergency_contact', 'read'],
      ['employee_professional_body', 'read'], ['employee_work_history', 'read'],
      ['employee_bank_account', 'read'], ['employee_contract', 'read'],
    ],
  },
  EMPLOYEES_CREATE: {
    page: 'EMPLOYEES',
    tables: [
      ['employee', 'insert'], ['employee', 'modify'], ['employee', 'delete'],
      ['employee_next_of_kin', 'insert'], ['employee_next_of_kin', 'delete'],
      ['employee_beneficiary', 'insert'], ['employee_beneficiary', 'delete'],
      ['employee_dependant', 'insert'], ['employee_dependant', 'delete'],
      ['employee_emergency_contact', 'insert'], ['employee_emergency_contact', 'delete'],
      ['employee_professional_body', 'insert'], ['employee_professional_body', 'delete'],
      ['employee_work_history', 'insert'], ['employee_work_history', 'delete'],
      ['employee_bank_account', 'insert'], ['employee_bank_account', 'delete'],
      ['workflow_task', 'insert'], ['workflow_task', 'modify'],
    ],
  },
  EMPLOYEES_APPROVE: {
    page: 'EMPLOYEES',
    tables: [['employee', 'modify'], ['employee_contract', 'insert'], ['employee_contract', 'modify']],
  },

  // Employee Editing — request, review and approve changes to an employee record.
  EMPLOYEE_EDITS_READ: { page: 'EMPLOYEE_EDITS', tables: [['employee_edit_request', 'read']] },
  EMPLOYEE_EDITS_UPDATE: {
    page: 'EMPLOYEE_EDITS',
    tables: [
      ['employee_edit_request', 'insert'], ['employee_edit_request', 'modify'],
      ['employee_edit_next_of_kin', 'insert'], ['employee_edit_next_of_kin', 'delete'],
      ['employee_edit_beneficiary', 'insert'], ['employee_edit_beneficiary', 'delete'],
      ['employee_edit_dependant', 'insert'], ['employee_edit_dependant', 'delete'],
      ['employee_edit_emergency_contact', 'insert'], ['employee_edit_emergency_contact', 'delete'],
      ['employee_edit_professional_body', 'insert'], ['employee_edit_professional_body', 'delete'],
      ['employee_edit_work_history', 'insert'], ['employee_edit_work_history', 'delete'],
      ['employee_edit_bank_account', 'insert'], ['employee_edit_bank_account', 'delete'],
    ],
  },
  /** Delete an Open (not yet submitted) edit request, with its proposed sub-entity rows. */
  EMPLOYEE_EDITS_DELETE: {
    page: 'EMPLOYEE_EDITS',
    tables: [
      ['employee_edit_request', 'delete'],
      ['employee_edit_next_of_kin', 'delete'], ['employee_edit_beneficiary', 'delete'], ['employee_edit_dependant', 'delete'],
      ['employee_edit_emergency_contact', 'delete'], ['employee_edit_professional_body', 'delete'],
      ['employee_edit_work_history', 'delete'], ['employee_edit_bank_account', 'delete'],
    ],
  },
  EMPLOYEE_EDITS_APPROVE: {
    page: 'EMPLOYEE_EDITS',
    tables: [
      ['employee_edit_request', 'modify'], ['employee', 'modify'],
      ['employee_next_of_kin', 'insert'], ['employee_next_of_kin', 'delete'],
      ['employee_beneficiary', 'insert'], ['employee_beneficiary', 'delete'],
      ['employee_dependant', 'insert'], ['employee_dependant', 'delete'],
      ['employee_emergency_contact', 'insert'], ['employee_emergency_contact', 'delete'],
      ['employee_professional_body', 'insert'], ['employee_professional_body', 'delete'],
      ['employee_work_history', 'insert'], ['employee_work_history', 'delete'],
      ['employee_bank_account', 'insert'], ['employee_bank_account', 'delete'],
    ],
  },

  // Employee Contract / Salary Change — New Contract / Renewal / Salary Increment.
  EMPLOYEE_CONTRACT_CHANGES_READ: { page: 'EMPLOYEE_CONTRACT_CHANGES', tables: [['employee_contract_change', 'read']] },
  EMPLOYEE_CONTRACT_CHANGES_CREATE: {
    page: 'EMPLOYEE_CONTRACT_CHANGES',
    tables: [['employee_contract_change', 'insert'], ['employee_contract_change', 'modify'], ['employee_contract_change', 'delete'], ['workflow_task', 'insert'], ['workflow_task', 'modify']],
  },
  EMPLOYEE_CONTRACT_CHANGES_APPROVE: {
    page: 'EMPLOYEE_CONTRACT_CHANGES',
    tables: [['employee_contract_change', 'modify'], ['employee_contract', 'insert'], ['employee', 'modify']],
  },

  // Employee Exit — offboarding + independent clearance checklist (see lib/employeeExits.ts).
  EMPLOYEE_EXITS_READ: {
    page: 'EMPLOYEE_EXITS',
    tables: [['employee_exit', 'read'], ['employee_exit_final_due_line', 'read'], ['employee_exit_clearance_line', 'read']],
  },
  EMPLOYEE_EXITS_CREATE: {
    page: 'EMPLOYEE_EXITS',
    tables: [
      ['employee_exit', 'insert'], ['employee_exit', 'modify'], ['employee_exit_final_due_line', 'insert'],
      ['employee_exit_final_due_line', 'delete'], ['employee_exit_clearance_line', 'insert'],
      ['workflow_task', 'insert'], ['workflow_task', 'modify'],
    ],
  },
  EMPLOYEE_EXITS_APPROVE: { page: 'EMPLOYEE_EXITS', tables: [['employee_exit', 'modify']] },
  EMPLOYEE_EXITS_CLEAR: {
    page: 'EMPLOYEE_EXITS',
    tables: [['employee_exit', 'modify'], ['employee_exit_clearance_line', 'modify'], ['employee', 'modify']],
  },

  // Employee Management setup masters (Admin Centre -> Setup Pool -> HR & Payroll). Department is
  // Global Dimension 2 (Admin Centre -> Setup Pool -> General -> Global Dimensions), not a
  // bespoke master here.
  HR_JOB_GRADES_READ: { page: 'ADMIN_HR_JOB_GRADES', tables: [['hr_job_grade', 'read']] },
  HR_SALARY_SCALES_READ: { page: 'ADMIN_HR_SALARY_SCALES', tables: [['hr_salary_scale', 'read'], ['hr_salary_scale_benefit', 'read'], ['hr_job_grade', 'read']] },
  HR_SALARY_SCALES_MANAGE: {
    page: 'ADMIN_HR_SALARY_SCALES',
    tables: [
      ['hr_salary_scale', 'insert'], ['hr_salary_scale', 'modify'], ['hr_salary_scale', 'delete'],
      ['hr_salary_scale_benefit', 'insert'], ['hr_salary_scale_benefit', 'modify'], ['hr_salary_scale_benefit', 'delete'],
      ['employee', 'modify'], ['employee_payroll_transaction', 'insert'], ['employee_payroll_transaction', 'modify'], ['employee_payroll_transaction', 'delete'],
    ],
  },
  HR_JOB_GRADES_MANAGE: {
    page: 'ADMIN_HR_JOB_GRADES',
    tables: [['hr_job_grade', 'insert'], ['hr_job_grade', 'modify'], ['hr_job_grade', 'delete']],
  },
  HR_CONTRACT_TYPES_READ: { page: 'ADMIN_HR_CONTRACT_TYPES', tables: [['hr_employment_contract_type', 'read']] },
  HR_CONTRACT_TYPES_MANAGE: {
    page: 'ADMIN_HR_CONTRACT_TYPES',
    tables: [['hr_employment_contract_type', 'insert'], ['hr_employment_contract_type', 'modify'], ['hr_employment_contract_type', 'delete']],
  },
  HR_TERMINATION_REASONS_READ: { page: 'ADMIN_HR_TERMINATION_REASONS', tables: [['hr_termination_reason', 'read']] },
  HR_TERMINATION_REASONS_MANAGE: {
    page: 'ADMIN_HR_TERMINATION_REASONS',
    tables: [['hr_termination_reason', 'insert'], ['hr_termination_reason', 'modify'], ['hr_termination_reason', 'delete']],
  },
  HR_CLEARANCE_SECTIONS_READ: { page: 'ADMIN_HR_CLEARANCE_SECTIONS', tables: [['hr_clearance_section', 'read']] },
  HR_CLEARANCE_SECTIONS_MANAGE: {
    page: 'ADMIN_HR_CLEARANCE_SECTIONS',
    tables: [['hr_clearance_section', 'insert'], ['hr_clearance_section', 'modify'], ['hr_clearance_section', 'delete']],
  },

  // Leave Management (see lib/leaveManagement.ts).
  LEAVE_APPLICATIONS_READ: {
    page: 'LEAVE_APPLICATIONS',
    tables: [['hr_leave_application', 'read'], ['hr_leave_ledger_entry', 'read']],
  },
  LEAVE_APPLICATIONS_CREATE: {
    page: 'LEAVE_APPLICATIONS',
    tables: [['hr_leave_application', 'insert'], ['hr_leave_application', 'modify'], ['hr_leave_application', 'delete'], ['workflow_task', 'insert'], ['workflow_task', 'modify']],
  },
  LEAVE_APPLICATIONS_APPROVE: {
    page: 'LEAVE_APPLICATIONS',
    tables: [['hr_leave_application', 'modify'], ['hr_leave_ledger_entry', 'insert']],
  },
  LEAVE_ADJUSTMENTS_READ: { page: 'LEAVE_ADJUSTMENTS', tables: [['hr_leave_adjustment', 'read'], ['hr_leave_adjustment_line', 'read']] },
  LEAVE_ADJUSTMENTS_CREATE: {
    page: 'LEAVE_ADJUSTMENTS',
    tables: [
      ['hr_leave_adjustment', 'insert'], ['hr_leave_adjustment', 'modify'], ['hr_leave_adjustment', 'delete'],
      ['hr_leave_adjustment_line', 'insert'], ['hr_leave_adjustment_line', 'delete'],
      ['workflow_task', 'insert'], ['workflow_task', 'modify'],
    ],
  },
  LEAVE_ADJUSTMENTS_APPROVE: {
    page: 'LEAVE_ADJUSTMENTS',
    tables: [['hr_leave_adjustment', 'modify'], ['hr_leave_ledger_entry', 'insert']],
  },
  COMPANY_JOBS_READ: { page: 'COMPANY_JOBS', tables: [['company_job', 'read'], ['company_job_responsibility', 'read'], ['company_job_requirement', 'read'], ['company_job_qualification', 'read'], ['employee', 'read']] },
  COMPANY_JOBS_CREATE: {
    page: 'COMPANY_JOBS',
    tables: [
      ['company_job', 'insert'], ['company_job', 'modify'], ['company_job', 'delete'],
      ['company_job_responsibility', 'insert'], ['company_job_responsibility', 'delete'],
      ['company_job_requirement', 'insert'], ['company_job_requirement', 'delete'],
      ['company_job_qualification', 'insert'], ['company_job_qualification', 'delete'],
    ],
  },
  COMPANY_JOBS_APPROVE: { page: 'COMPANY_JOBS', tables: [['company_job', 'modify']] },
  ORGANOGRAM_VIEW: { page: 'ORGANOGRAM', tables: [['company_job', 'read'], ['employee', 'read']] },
  LEAVE_RECALLS_READ: { page: 'LEAVE_RECALLS', tables: [['hr_leave_recall', 'read']] },
  LEAVE_RECALLS_CREATE: {
    page: 'LEAVE_RECALLS',
    tables: [['hr_leave_recall', 'insert'], ['hr_leave_recall', 'modify'], ['hr_leave_recall', 'delete'], ['workflow_task', 'insert'], ['workflow_task', 'modify']],
  },
  LEAVE_RECALLS_APPROVE: { page: 'LEAVE_RECALLS', tables: [['hr_leave_recall', 'modify'], ['hr_leave_ledger_entry', 'insert']] },
  LEAVE_PLANS_READ: { page: 'LEAVE_PLANS', tables: [['hr_leave_plan', 'read'], ['hr_leave_plan_line', 'read']] },
  LEAVE_PLANS_CREATE: {
    page: 'LEAVE_PLANS',
    tables: [
      ['hr_leave_plan', 'insert'], ['hr_leave_plan', 'modify'], ['hr_leave_plan', 'delete'],
      ['hr_leave_plan_line', 'insert'], ['hr_leave_plan_line', 'delete'],
      ['workflow_task', 'insert'], ['workflow_task', 'modify'],
    ],
  },
  LEAVE_PLANS_APPROVE: { page: 'LEAVE_PLANS', tables: [['hr_leave_plan', 'modify']] },

  // Leave Management setup masters + periodic runs.
  HR_LEAVE_TYPES_READ: { page: 'ADMIN_HR_LEAVE_TYPES', tables: [['hr_leave_type', 'read']] },
  HR_LEAVE_TYPES_MANAGE: {
    page: 'ADMIN_HR_LEAVE_TYPES',
    tables: [['hr_leave_type', 'insert'], ['hr_leave_type', 'modify'], ['hr_leave_type', 'delete']],
  },
  HR_LEAVE_CALENDAR_READ: { page: 'ADMIN_HR_LEAVE_CALENDAR', tables: [['hr_leave_calendar', 'read']] },
  HR_LEAVE_CALENDAR_MANAGE: {
    page: 'ADMIN_HR_LEAVE_CALENDAR',
    tables: [['hr_leave_calendar', 'insert'], ['hr_leave_calendar', 'modify'], ['hr_leave_ledger_entry', 'insert'], ['hr_leave_ledger_entry', 'modify']],
  },
  HR_HOLIDAYS_READ: { page: 'ADMIN_HR_HOLIDAYS', tables: [['hr_holiday', 'read']] },
  HR_HOLIDAYS_MANAGE: { page: 'ADMIN_HR_HOLIDAYS', tables: [['hr_holiday', 'insert'], ['hr_holiday', 'modify'], ['hr_holiday', 'delete']] },
  HR_ACCRUE_MATRIX_READ: { page: 'ADMIN_HR_ACCRUE_MATRIX', tables: [['hr_leave_days_to_accrue', 'read']] },
  HR_ACCRUE_MATRIX_MANAGE: {
    page: 'ADMIN_HR_ACCRUE_MATRIX',
    tables: [['hr_leave_days_to_accrue', 'insert'], ['hr_leave_days_to_accrue', 'modify'], ['hr_leave_days_to_accrue', 'delete']],
  },
  HR_LEAVE_ACCRUAL_RUN: { page: 'ADMIN_HR_ACCRUE_MATRIX', tables: [['hr_leave_ledger_entry', 'insert']] },

  // Payroll (see lib/payroll.ts). _RUN computes/re-computes a period's payslip lines (no G/L
  // effect yet); _APPROVE decides the period; _CLOSE posts the journal and rolls recurring
  // transactions into the next period — the same tier CASH_MANAGEMENT_POST carries.
  PAYROLL_READ: {
    page: 'PAYROLL',
    tables: [['employee_payroll_transaction', 'read'], ['payroll_period_transaction', 'read'], ['payroll_p9_line', 'read']],
  },
  PAYROLL_MANAGE_TRANSACTIONS: {
    page: 'PAYROLL',
    tables: [['employee_payroll_transaction', 'insert'], ['employee_payroll_transaction', 'modify'], ['employee_payroll_transaction', 'delete']],
  },
  PAYROLL_PERIODS_READ: { page: 'PAYROLL_PERIODS', tables: [['payroll_period', 'read']] },
  PAYROLL_PERIODS_CREATE: { page: 'PAYROLL_PERIODS', tables: [['payroll_period', 'insert'], ['workflow_task', 'insert'], ['workflow_task', 'modify']] },
  PAYROLL_PERIODS_RUN: {
    page: 'PAYROLL_PERIODS',
    tables: [['payroll_period_transaction', 'insert'], ['payroll_period_transaction', 'modify'], ['payroll_p9_line', 'insert'], ['employee_payroll_transaction', 'modify']],
  },
  PAYROLL_PERIODS_APPROVE: { page: 'PAYROLL_PERIODS', tables: [['payroll_period', 'modify']] },
  PAYROLL_PERIODS_CLOSE: {
    page: 'PAYROLL_PERIODS',
    tables: [
      ['payroll_period', 'insert'], ['payroll_period', 'modify'], ['employee_payroll_transaction', 'insert'],
      ['journal', 'insert'], ['journal_line', 'insert'],
    ],
  },

  // Payroll setup masters.
  PAYROLL_SETUP_READ: { page: 'ADMIN_PAYROLL_SETUP', tables: [['hr_payroll_setup', 'read']] },
  PAYROLL_SETUP_MANAGE: { page: 'ADMIN_PAYROLL_SETUP', tables: [['hr_payroll_setup', 'modify']] },
  PAYROLL_POSTING_GROUPS_READ: { page: 'ADMIN_PAYROLL_POSTING_GROUPS', tables: [['payroll_posting_group', 'read']] },
  PAYROLL_POSTING_GROUPS_MANAGE: {
    page: 'ADMIN_PAYROLL_POSTING_GROUPS',
    tables: [['payroll_posting_group', 'insert'], ['payroll_posting_group', 'modify'], ['payroll_posting_group', 'delete']],
  },
  PAYROLL_PAYE_BANDS_READ: { page: 'ADMIN_PAYROLL_PAYE_BANDS', tables: [['payroll_paye_band', 'read']] },
  PAYROLL_PAYE_BANDS_MANAGE: {
    page: 'ADMIN_PAYROLL_PAYE_BANDS',
    tables: [['payroll_paye_band', 'insert'], ['payroll_paye_band', 'modify'], ['payroll_paye_band', 'delete']],
  },
  PAYROLL_NSSF_TIERS_READ: { page: 'ADMIN_PAYROLL_NSSF_TIERS', tables: [['payroll_nssf_tier', 'read']] },
  PAYROLL_NSSF_TIERS_MANAGE: {
    page: 'ADMIN_PAYROLL_NSSF_TIERS',
    tables: [['payroll_nssf_tier', 'insert'], ['payroll_nssf_tier', 'modify'], ['payroll_nssf_tier', 'delete']],
  },
  PAYROLL_TRANSACTION_CODES_READ: { page: 'ADMIN_PAYROLL_TRANSACTION_CODES', tables: [['payroll_transaction_code', 'read']] },
  PAYROLL_TRANSACTION_CODES_MANAGE: {
    page: 'ADMIN_PAYROLL_TRANSACTION_CODES',
    tables: [['payroll_transaction_code', 'insert'], ['payroll_transaction_code', 'modify'], ['payroll_transaction_code', 'delete']],
  },
  // Petty Cash & Imprest — lib/imprest.ts. _CREATE raises requests, petty cash and surrenders;
  // _ISSUE pays an approved imprest out (moves a bank account and the employee subledger);
  // _POST posts a surrender or a petty cash; _PAYROLL_RECOVER is HR sending an unsurrendered
  // imprest to payroll.
  IMPREST_READ: { page: 'IMPREST', tables: [['imprest_request', 'read'], ['petty_cash', 'read'], ['staff_claim', 'read'], ['employee_ledger_entry', 'read'], ['employee', 'read']] },
  IMPREST_CREATE: {
    page: 'IMPREST',
    tables: [
      ['imprest_request', 'insert'], ['imprest_request', 'modify'], ['imprest_request', 'delete'],
      ['imprest_request_line', 'insert'], ['imprest_request_line', 'modify'], ['imprest_request_line', 'delete'],
      ['petty_cash', 'insert'], ['petty_cash', 'modify'], ['petty_cash', 'delete'],
      ['petty_cash_line', 'insert'], ['petty_cash_line', 'modify'], ['petty_cash_line', 'delete'],
      ['staff_claim', 'insert'], ['staff_claim', 'modify'], ['staff_claim', 'delete'],
      ['staff_claim_line', 'insert'], ['staff_claim_line', 'modify'], ['staff_claim_line', 'delete'],
      ['workflow_task', 'insert'], ['workflow_task', 'modify'],
    ],
  },
  IMPREST_APPROVE: { page: 'IMPREST', tables: [['imprest_request', 'modify'], ['petty_cash', 'modify'], ['staff_claim', 'modify']] },
  IMPREST_ISSUE: {
    page: 'IMPREST',
    tables: [['imprest_request', 'modify'], ['employee_ledger_entry', 'insert'], ['journal', 'insert'], ['journal_line', 'insert']],
  },
  IMPREST_POST: {
    page: 'IMPREST',
    tables: [
      ['imprest_request', 'modify'], ['imprest_request_line', 'modify'], ['petty_cash', 'modify'], ['staff_claim', 'modify'],
      ['employee_ledger_entry', 'insert'], ['journal', 'insert'], ['journal_line', 'insert'],
      ['employee_payroll_transaction', 'insert'],
    ],
  },
  IMPREST_PAYROLL_RECOVER: { page: 'IMPREST', tables: [['imprest_request', 'modify'], ['employee_payroll_transaction', 'insert']] },
  // Store & Purchase Requisitions — lib/requisitions.ts. _CREATE raises and edits a requisition;
  // _APPROVE decides it and trims quantities approved; _ISSUE is the store admin issuing stock
  // (posts item journal lines); _PROCESS is procurement reviewing lines into purchase quotes /
  // orders or closing the PR.
  REQUISITIONS_READ: { page: 'REQUISITIONS', tables: [['requisition', 'read'], ['requisition_line', 'read'], ['employee', 'read'], ['item', 'read'], ['location', 'read'], ['vendor', 'read']] },
  REQUISITIONS_CREATE: {
    page: 'REQUISITIONS',
    tables: [
      ['requisition', 'insert'], ['requisition', 'modify'], ['requisition', 'delete'],
      ['requisition_line', 'insert'], ['requisition_line', 'modify'], ['requisition_line', 'delete'],
      ['workflow_task', 'insert'], ['workflow_task', 'modify'],
    ],
  },
  REQUISITIONS_APPROVE: { page: 'REQUISITIONS', tables: [['requisition', 'modify'], ['requisition_line', 'modify']] },

  // Employee Self Service. Same tables as the HR / Staff Cash Desk / Requisitions actions, on
  // the self-service pages instead: a user holding only these reaches only their own documents
  // (lib/selfService.ts scopes lists and stamps new documents with their employee), while the
  // document cards accept either the module's action or the self-service one plus ownership.
  SELF_SERVICE_VIEW: { page: 'SELF_SERVICE', tables: [['employee', 'read'], ['approval_user_setup', 'read']] },
  SELF_SERVICE_PAYSLIP_READ: { page: 'SELF_SERVICE_PAYSLIPS', tables: [['payroll_period', 'read'], ['payroll_period_transaction', 'read']] },
  SELF_SERVICE_P9_READ: { page: 'SELF_SERVICE_P9', tables: [['payroll_period', 'read'], ['payroll_p9_line', 'read']] },
  /** My Record: the employee's own record, and Employee Editing requests raised against it
   *  (AL Employee Change Request — Validate("Employee No", UserSetup."Employee No.")). */
  SELF_SERVICE_RECORD_READ: {
    page: 'SELF_SERVICE_RECORD',
    tables: [
      ['employee', 'read'], ['employee_edit_request', 'read'],
      ['employee_next_of_kin', 'read'], ['employee_beneficiary', 'read'], ['employee_dependant', 'read'],
      ['employee_emergency_contact', 'read'], ['employee_professional_body', 'read'], ['employee_work_history', 'read'],
      ['employee_bank_account', 'read'], ['employee_contract', 'read'],
    ],
  },
  SELF_SERVICE_RECORD_UPDATE: {
    page: 'SELF_SERVICE_RECORD',
    tables: [
      ['employee_edit_request', 'insert'], ['employee_edit_request', 'modify'],
      ['employee_edit_next_of_kin', 'insert'], ['employee_edit_next_of_kin', 'delete'],
      ['employee_edit_beneficiary', 'insert'], ['employee_edit_beneficiary', 'delete'],
      ['employee_edit_dependant', 'insert'], ['employee_edit_dependant', 'delete'],
      ['employee_edit_emergency_contact', 'insert'], ['employee_edit_emergency_contact', 'delete'],
      ['employee_edit_professional_body', 'insert'], ['employee_edit_professional_body', 'delete'],
      ['employee_edit_work_history', 'insert'], ['employee_edit_work_history', 'delete'],
      ['employee_edit_bank_account', 'insert'], ['employee_edit_bank_account', 'delete'],
      ['workflow_task', 'insert'], ['workflow_task', 'modify'],
    ],
  },
  SELF_SERVICE_RECORD_DELETE: {
    page: 'SELF_SERVICE_RECORD',
    tables: [
      ['employee_edit_request', 'delete'],
      ['employee_edit_next_of_kin', 'delete'], ['employee_edit_beneficiary', 'delete'], ['employee_edit_dependant', 'delete'],
      ['employee_edit_emergency_contact', 'delete'], ['employee_edit_professional_body', 'delete'],
      ['employee_edit_work_history', 'delete'], ['employee_edit_bank_account', 'delete'],
    ],
  },
  SELF_SERVICE_LEAVE_READ: {
    page: 'SELF_SERVICE_LEAVE',
    tables: [['hr_leave_application', 'read'], ['hr_leave_ledger_entry', 'read'], ['hr_leave_type', 'read']],
  },
  SELF_SERVICE_LEAVE_CREATE: {
    page: 'SELF_SERVICE_LEAVE',
    tables: [['hr_leave_application', 'insert'], ['hr_leave_application', 'modify'], ['hr_leave_application', 'delete'], ['workflow_task', 'insert'], ['workflow_task', 'modify']],
  },
  SELF_SERVICE_LEAVE_PLANS_READ: { page: 'SELF_SERVICE_LEAVE_PLANS', tables: [['hr_leave_plan', 'read'], ['hr_leave_plan_line', 'read']] },
  SELF_SERVICE_LEAVE_PLANS_CREATE: {
    page: 'SELF_SERVICE_LEAVE_PLANS',
    tables: [
      ['hr_leave_plan', 'insert'], ['hr_leave_plan', 'modify'], ['hr_leave_plan', 'delete'],
      ['hr_leave_plan_line', 'insert'], ['hr_leave_plan_line', 'delete'],
      ['workflow_task', 'insert'], ['workflow_task', 'modify'],
    ],
  },
  SELF_SERVICE_IMPREST_READ: {
    page: 'SELF_SERVICE_IMPREST',
    tables: [['imprest_request', 'read'], ['imprest_request_line', 'read'], ['employee_ledger_entry', 'read'], ['imprest_purpose', 'read']],
  },
  SELF_SERVICE_IMPREST_CREATE: {
    page: 'SELF_SERVICE_IMPREST',
    tables: [
      ['imprest_request', 'insert'], ['imprest_request', 'modify'], ['imprest_request', 'delete'],
      ['imprest_request_line', 'insert'], ['imprest_request_line', 'modify'], ['imprest_request_line', 'delete'],
      ['workflow_task', 'insert'], ['workflow_task', 'modify'],
    ],
  },
  SELF_SERVICE_PETTY_CASH_READ: { page: 'SELF_SERVICE_PETTY_CASH', tables: [['petty_cash', 'read'], ['petty_cash_line', 'read']] },
  SELF_SERVICE_PETTY_CASH_CREATE: {
    page: 'SELF_SERVICE_PETTY_CASH',
    tables: [
      ['petty_cash', 'insert'], ['petty_cash', 'modify'], ['petty_cash', 'delete'],
      ['petty_cash_line', 'insert'], ['petty_cash_line', 'modify'], ['petty_cash_line', 'delete'],
      ['workflow_task', 'insert'], ['workflow_task', 'modify'],
    ],
  },
  SELF_SERVICE_REQUISITIONS_READ: {
    page: 'SELF_SERVICE_REQUISITIONS',
    tables: [['requisition', 'read'], ['requisition_line', 'read'], ['item', 'read'], ['location', 'read'], ['vendor', 'read']],
  },
  SELF_SERVICE_REQUISITIONS_CREATE: {
    page: 'SELF_SERVICE_REQUISITIONS',
    tables: [
      ['requisition', 'insert'], ['requisition', 'modify'], ['requisition', 'delete'],
      ['requisition_line', 'insert'], ['requisition_line', 'modify'], ['requisition_line', 'delete'],
      ['workflow_task', 'insert'], ['workflow_task', 'modify'],
    ],
  },
  REQUISITIONS_ISSUE: {
    page: 'REQUISITIONS',
    tables: [
      ['requisition', 'modify'], ['requisition_line', 'modify'], ['item_journal_line', 'insert'], ['item_journal_line', 'modify'],
      ['item_ledger_entry', 'insert'], ['stockkeeping_unit', 'insert'], ['stockkeeping_unit', 'modify'], ['item', 'modify'],
      ['journal', 'insert'], ['journal_line', 'insert'],
    ],
  },
  REQUISITIONS_PROCESS: {
    page: 'REQUISITIONS',
    tables: [['requisition', 'modify'], ['requisition_line', 'modify'], ['purchase_header', 'insert'], ['purchase_header', 'modify'], ['purchase_line', 'insert'], ['purchase_line', 'delete']],
  },
  ADMIN_POOL_IMPREST_PURPOSES_MANAGE: { page: 'ADMIN_POOL_IMPREST_PURPOSES', tables: [['imprest_purpose', 'insert'], ['imprest_purpose', 'modify'], ['imprest_purpose', 'delete']] },
} as const satisfies Record<string, ActionGrant>;

export type ActionKey = keyof typeof ACTIONS;

/* --------------------------------------------------------------- checks */

export function canTable(user: SessionUser | null | undefined, table: string, right: Right): boolean {
  if (!user) return false;
  if (user.is_system) return true;
  return !!user.permissionSet.tables[table]?.[right];
}

export function canPage(user: SessionUser | null | undefined, page: string): boolean {
  if (!user) return false;
  if (user.is_system) return true;
  return !!user.permissionSet.pages[page];
}

/** The screens inside a module page — the tabs of /receivables, /payables, and so on. */
export function childPages(parent: string): PageObject[] {
  return PAGES.filter((p) => p.parent === parent);
}

/**
 * Which of a module's tabs this user may open, keyed by the tab's page code. A module's tab strip
 * is built from this so a screen the user cannot execute is not offered, and the module's default
 * tab can fall through to the first one they can.
 */
export function allowedChildPages(user: SessionUser | null | undefined, parent: string): Set<string> {
  return new Set(childPages(parent).filter((p) => canPage(user, p.code)).map((p) => p.code));
}

export function canAction(user: SessionUser | null | undefined, key: ActionKey): boolean {
  if (!user) return false;
  if (user.is_system) return true;
  const grant = ACTIONS[key];
  return canPage(user, grant.page) && grant.tables.every(([t, r]) => canTable(user, t, r));
}

/**
 * The "can this user open and view this screen" action for a Page — its `*_READ` / `*_VIEW`
 * action, if one exists. Screens with only a `*_MANAGE` action (most Admin setup pages) map to
 * nothing here: page Execute alone is enough to list them.
 */
const PAGE_VIEW_ACTION: Partial<Record<string, ActionKey>> = (() => {
  const map: Partial<Record<string, ActionKey>> = {};
  const keys = Object.keys(ACTIONS) as ActionKey[];
  for (const { code } of PAGES) {
    const read = keys.find((k) => ACTIONS[k].page === code && /_(READ|VIEW)$/.test(k));
    if (read) map[code] = read;
  }
  return map;
})();

/**
 * Whether a navigation entry for `pages` should appear in the sidebar. Stricter than a bare
 * `canPage`: if a screen has a read/view action (e.g. `STUDENTS_READ` bundles page `STUDENTS` + table
 * `student` read), the user must satisfy that too — so a permission set that grants page Execute but
 * not the underlying table Read no longer surfaces a module the user cannot actually use. Falls
 * back to `canPage` for screens with no read/view action (admin setup pages).
 */
export function canNav(user: SessionUser | null | undefined, pages: string | string[]): boolean {
  if (!user) return false;
  if (user.is_system) return true;
  const codes = Array.isArray(pages) ? pages : [pages];
  return codes.some((code) => {
    // The Teacher Portal lives inside Employee Self Service and shows only for a login the User
    // Setup marks as teaching staff — the permission alone is not enough.
    if (code === 'TEACHER_PORTAL' && !user.isTeacher) return false;
    if (!canPage(user, code)) return false;
    const view = PAGE_VIEW_ACTION[code];
    return view ? canAction(user, view) : true;
  });
}

/* ----------------------------------------------------------------- seed */

/** Seed-only: resolves a role's list of ACTIONS keys into the deduplicated
 *  {role_id, object_type, object_name, rights} rows an admin clicking
 *  through the Permission Set editor would have produced by hand. */
export function expandActionsToLines(
  roleId: number, actionKeys: ActionKey[],
): { role_id: number; object_type: ObjectType; object_name: string; read: boolean; insert: boolean; modify: boolean; delete: boolean; execute: boolean }[] {
  const pages = new Map<string, boolean>();
  const tables = new Map<string, { read: boolean; insert: boolean; modify: boolean; delete: boolean }>();

  for (const key of actionKeys) {
    const grant = ACTIONS[key];
    pages.set(grant.page, true);
    // The module's screens come with the module, so a seeded role opens every tab.
    for (const child of childPages(grant.page)) pages.set(child.code, true);
    for (const [table, right] of grant.tables) {
      const row = tables.get(table) ?? { read: false, insert: false, modify: false, delete: false };
      row[right] = true;
      tables.set(table, row);
    }
  }

  return [
    ...[...pages.keys()].map((page) => ({
      role_id: roleId, object_type: 'PAGE' as const, object_name: page,
      read: false, insert: false, modify: false, delete: false, execute: true,
    })),
    ...[...tables.entries()].map(([table, rights]) => ({
      role_id: roleId, object_type: 'TABLE' as const, object_name: table,
      ...rights, execute: false,
    })),
  ];
}
