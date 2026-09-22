/*
 * Admin Centre navigation — its top-level tabs, the Setup Pool categories and screens, and the
 * Workflow / Security sub-tabs. Kept out of the page so the global search (lib/globalSearch.ts)
 * can index every admin screen the user may reach, with the same permission rule the page uses.
 */
import { canPage } from './permissions.ts';
import type { TabDefinition } from '@/components/ui/primitives';

export interface AdminTab extends TabDefinition {
  /** A tab shows up once the user can execute any one of these pages — Setup Pool
   *  merges the pages of everything nested under it. */
  page: string | string[];
}

export const hasTabAccess = (user: Parameters<typeof canPage>[0], t: AdminTab): boolean =>
  (Array.isArray(t.page) ? t.page : [t.page]).some((p) => canPage(user, p));

/**
 * Setup Pool — every reference/setup screen, grouped into business categories. Each screen keeps
 * its own ADMIN_* (or module) page permission; a category shows once the user can reach any one
 * of its screens. URL: /admin/pool/<category>/<screen>.
 */
export interface PoolGroup { key: string; label: string; screens: AdminTab[] }
export const POOL_GROUPS: PoolGroup[] = [
  {
    key: 'general', label: 'General', screens: [
      { key: 'school-setup', label: 'School Setup', page: 'ADMIN_COMPANY' },
      { key: 'counties', label: 'Counties', page: 'ADMIN_POOL_COUNTIES' },
      { key: 'dimensions', label: 'Global Dimensions', page: 'ADMIN_POOL_DIMENSIONS' },
      { key: 'document-no-series', label: 'Document No. Series', page: 'ADMIN_NO_SERIES' },
      { key: 'no-series', label: 'No. Series', page: 'ADMIN_NO_SERIES' },
      { key: 'automation', label: 'System Automation', page: 'ADMIN_JOB_QUEUE' },
    ],
  },
  {
    key: 'academics', label: 'Academics', screens: [
      { key: 'academic-years', label: 'Academic Years & Terms', page: 'ADMIN_ACADEMIC_YEARS' },
      { key: 'structure', label: 'Levels, Grades & Streams', page: 'ADMIN_ACADEMIC_STRUCTURE' },
      { key: 'subjects', label: 'Subjects', page: 'ADMIN_SUBJECTS' },
      { key: 'grading', label: 'Grading Scales', page: 'ADMIN_GRADING' },
      { key: 'assessment-types', label: 'Assessment Types', page: 'ADMIN_ASSESSMENT_TYPES' },
      { key: 'fee-items', label: 'Fee Items', page: 'ADMIN_FEE_ITEMS' },
    ],
  },
  {
    key: 'finance', label: 'Finance', screens: [
      { key: 'gl-setup', label: 'General Ledger Setup', page: 'ADMIN_COMPANY' },
      { key: 'sales-receivables-setup', label: 'Sales & Receivables Setup', page: 'RECEIVABLES' },
      { key: 'purchases-payables-setup', label: 'Purchases & Payables Setup', page: 'PAYABLES' },
      { key: 'payment-terms', label: 'Payment Terms', page: 'RECEIVABLES' },
      { key: 'payment-methods', label: 'Payment Methods', page: 'RECEIVABLES' },
      { key: 'customer-posting-groups', label: 'Customer Posting Groups', page: 'RECEIVABLES' },
      { key: 'vendor-posting-groups', label: 'Vendor Posting Groups', page: 'PAYABLES' },
      
      { key: 'currencies', label: 'Currencies', page: 'ADMIN_POOL_CURRENCIES' },
      { key: 'vat-posting-setup', label: 'VAT Posting Setup', page: 'ADMIN_POOL_VAT' },
      { key: 'imprest-purposes', label: 'Imprest Purposes', page: 'ADMIN_POOL_IMPREST_PURPOSES' },
      
    ],
  },
  {
    key: 'hr-payroll', label: 'HR & Payroll', screens: [
      { key: 'job-grades', label: 'Job Grades', page: 'ADMIN_HR_JOB_GRADES' },
      { key: 'salary-scales', label: 'Salary Scales', page: 'ADMIN_HR_SALARY_SCALES' },
      { key: 'contract-types', label: 'Employment Contract Types', page: 'ADMIN_HR_CONTRACT_TYPES' },
      { key: 'termination-reasons', label: 'Termination Reasons', page: 'ADMIN_HR_TERMINATION_REASONS' },
      { key: 'clearance-sections', label: 'Exit Clearance Sections', page: 'ADMIN_HR_CLEARANCE_SECTIONS' },
      { key: 'leave-types', label: 'Leave Types', page: 'ADMIN_HR_LEAVE_TYPES' },
      { key: 'leave-calendar', label: 'Leave Calendar', page: 'ADMIN_HR_LEAVE_CALENDAR' },
      { key: 'holidays', label: 'Holidays', page: 'ADMIN_HR_HOLIDAYS' },
      { key: 'accrue-matrix', label: 'Leave Accrual Matrix', page: 'ADMIN_HR_ACCRUE_MATRIX' },
      { key: 'payroll-setup', label: 'Payroll Setup', page: 'ADMIN_PAYROLL_SETUP' },
      { key: 'posting-groups', label: 'Payroll Posting Groups', page: 'ADMIN_PAYROLL_POSTING_GROUPS' },
      { key: 'paye-bands', label: 'PAYE Bands', page: 'ADMIN_PAYROLL_PAYE_BANDS' },
      { key: 'nssf-tiers', label: 'NSSF Tiers', page: 'ADMIN_PAYROLL_NSSF_TIERS' },
      { key: 'transaction-codes', label: 'Payroll Transaction Codes', page: 'ADMIN_PAYROLL_TRANSACTION_CODES' },
    ],
  },
];
export const POOL_PAGES: string[] = POOL_GROUPS.flatMap((g) =>
  g.screens.flatMap((s) => (Array.isArray(s.page) ? s.page : [s.page])));

export const ADMIN_TABS: AdminTab[] = [
  { key: 'company', label: 'Company Information', page: ['ADMIN_COMPANY', 'ADMIN_COMPANIES'] },
  { key: 'appearance', label: 'Appearance & Theme', page: 'ADMIN_APPEARANCE' },
  { key: 'pool', label: 'Setup Pool', page: POOL_PAGES },
  {
    key: 'workflows', label: 'Workflow Management',
    page: ['ADMIN_WORKFLOWS_DEFINITIONS', 'ADMIN_WORKFLOWS_GROUPS', 'ADMIN_WORKFLOWS_TABLES'],
  },
  {
    key: 'security', label: 'System Security',
    page: ['ADMIN_USERS', 'ADMIN_WORKFLOWS_SETUP', 'ADMIN_ROLES', 'ADMIN_PROFILES', 'ADMIN_AUDIT', 'ADMIN_CHANGELOG'],
  },
  { key: 'data', label: 'Data Management', page: ['ADMIN_DATA', 'ADMIN_WEB_SERVICES', 'ADMIN_OUTBOX'] },
];

/** Company Information's own sub-navigation: this company's details, and the list of companies. */
export const COMPANY_TABS: AdminTab[] = [
  { key: 'information', label: 'Company Information', page: 'ADMIN_COMPANY' },
  { key: 'companies', label: 'Companies', page: 'ADMIN_COMPANIES' },
];

/** Data Management's own sub-navigation: import/export, then the Integration (web service) screens. */
export const DATA_TABS: AdminTab[] = [
  { key: 'management', label: 'Configuration Package', page: 'ADMIN_DATA' },
  { key: 'web-services', label: 'Web Services', page: 'ADMIN_WEB_SERVICES' },
  { key: 'web-service-keys', label: 'Web Service Access Keys', page: 'ADMIN_WEB_SERVICES' },
  { key: 'web-service-log', label: 'Web Service Log', page: 'ADMIN_WEB_SERVICES' },
  { key: 'outbox', label: 'Message Outbox', page: 'ADMIN_OUTBOX' },
];

/** Workflow Management's own sub-navigation. */
export const WORKFLOW_TABS: AdminTab[] = [
  { key: 'definitions', label: 'Workflows', page: 'ADMIN_WORKFLOWS_DEFINITIONS' },
  { key: 'groups', label: 'Approval User Groups', page: 'ADMIN_WORKFLOWS_GROUPS' },
  { key: 'tables', label: 'Table Relations', page: 'ADMIN_WORKFLOWS_TABLES' },
];

/** System Security's own sub-navigation. */
export const SECURITY_TABS: AdminTab[] = [
  { key: 'users', label: 'Users', page: 'ADMIN_USERS' },
  { key: 'setup', label: 'User Setup', page: 'ADMIN_WORKFLOWS_SETUP' },
  { key: 'roles', label: 'Permission Sets', page: 'ADMIN_ROLES' },
  { key: 'profiles', label: 'Role Centre Profiles', page: 'ADMIN_PROFILES' },
  { key: 'audit', label: 'Audit Trail', page: 'ADMIN_AUDIT' },
  { key: 'changelog', label: 'Change Log Management', page: 'ADMIN_CHANGELOG' },
];
