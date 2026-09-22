/*
 * Domain vocabulary shared by server and client code.
 *
 * These lists populate <select> options, so client components import them. They
 * must therefore stay free of any database import: pulling a constant out of a
 * service module would drag the database client into the browser bundle, and
 * the build fails on its `require('fs')`.
 */
import type {
  AnnouncementAudience, DocumentStatus, GlAccountStructureType, GlAccountType, JobQueueStatus, JobQueueType, PayMode, UserStatus,
} from './types.ts';

export const TITLES = ['', 'Mr.', 'Ms.', 'Mrs.', 'Dr.', 'Prof.'];
export const GENDERS = ['', 'MALE', 'FEMALE'];
export const MARITAL_STATUSES = ['', 'SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED'];

/** Relationship options for next-of-kin, guardian and emergency-contact records. */
export const RELATIONSHIPS = [
  '', 'Spouse', 'Son', 'Daughter', 'Father', 'Mother', 'Brother', 'Sister', 'Nephew', 'Niece', 'Guardian', 'Other',
];

/** How a payment was actually made, alongside which bank account received or paid it. */
export const PAY_MODES: { value: PayMode; label: string }[] = [
  { value: 'CASH', label: 'Cash' },
  { value: 'MPESA', label: 'M-Pesa' },
  { value: 'BANK', label: 'Bank deposit' },
  { value: 'EFT', label: 'EFT / RTGS' },
  { value: 'CHEQUE', label: 'Cheque' },
];

/** The generic Active/Inactive status pair on every setup record. */
export const PRODUCT_STATUSES = ['ACTIVE', 'INACTIVE'];

/** System Automation (Job Queue)'s own Job Type/Status option lists (Admin Centre → System
 *  Automation). Job Type is deliberately a short, hand-maintained list — see JobQueueType. */
export const JOB_QUEUE_TYPES: { value: JobQueueType; label: string }[] = [
  { value: 'SESSION_PURGE', label: 'Session Purge' },
  { value: 'OUTBOX_DISPATCH', label: 'Message Outbox Dispatch' },
  { value: 'MPESA_STK_QUERY', label: 'M-Pesa Payment Request Status' },
  { value: 'FEE_REMINDERS', label: 'Fee Balance Reminders' },
];
export const JOB_QUEUE_STATUSES: JobQueueStatus[] = ['READY', 'ON HOLD'];

export const GL_ACCOUNT_TYPES: GlAccountType[] =
  ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'];

/** Account types whose balance increases on the debit side. */
export const NATURAL_DEBIT_TYPES: GlAccountType[] = ['ASSET', 'EXPENSE'];

/** Business Central's G/L "Account Type" — the account's structural role in the chart,
 *  as opposed to `type` (ASSET/LIABILITY/…) above, which is its financial-statement
 *  category. Only POSTING accounts ever carry ledger entries or a balance of their own;
 *  TOTAL and END_TOTAL roll one up from the Totaling range of accounts they name. */
export const GL_ACCOUNT_STRUCTURE_TYPES: { value: GlAccountStructureType; label: string }[] = [
  { value: 'POSTING', label: 'Posting' },
  { value: 'HEADING', label: 'Heading' },
  { value: 'TOTAL', label: 'Total' },
  { value: 'BEGIN_TOTAL', label: 'Begin-Total' },
  { value: 'END_TOTAL', label: 'End-Total' },
];

export const USER_STATUSES: UserStatus[] = ['ACTIVE', 'SUSPENDED', 'DISABLED'];

/** What kind of institution this is — shown on Company Information and printed headers. */
export const SCHOOL_TYPES = [
  'Public Primary School',
  'Public Secondary School',
  'Private Primary School',
  'Private Secondary School',
  'Private Composite School',
  'International School',
  'Special Needs School',
  'Technical & Vocational College',
];

/** Suggested document labels; the field is free text so a school can use its own. */
export const ATTACHMENT_CATEGORIES = [
  'Birth certificate', 'National ID / Passport', 'Report card', 'Medical record',
  'Admission letter', 'Transfer letter', 'Fee agreement', 'Correspondence', 'Other',
];

/** The full "Document Status" vocabulary — a document only drives itself through some of these. */
export const DOCUMENT_STATUSES: DocumentStatus[] = [
  'Open', 'Pending Approval', 'Approved', 'Processed',
];

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Timetable day names, indexed by ISO day-of-week (1 = Monday). */
export const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Who an announcement is addressed to (lib/announcements.ts). */
export const ANNOUNCEMENT_AUDIENCES: { value: AnnouncementAudience; label: string }[] = [
  { value: 'ALL', label: 'Everyone' },
  { value: 'STAFF', label: 'All staff' },
  { value: 'TEACHERS', label: 'Teaching staff' },
  { value: 'STUDENTS', label: 'Students' },
  { value: 'GUARDIANS', label: 'Parents & guardians' },
  { value: 'GRADE_LEVEL', label: 'One grade' },
  { value: 'STREAM', label: 'One class' },
];
