/*
 * Plain constants shared by both the server-only workflow engine (lib/workflow.ts)
 * and client-side admin forms (app/admin/workflow-form.tsx). Kept in their own
 * module with no database or mailer imports so a 'use client' component can
 * pull these in without dragging lib/db.ts / lib/mailer.ts into the browser
 * bundle (mailer.ts is 'server-only' and Next.js fails the build otherwise).
 */
import type { WorkflowApproverType, WorkflowConditionOperator, WorkflowDocumentType } from './types.ts';

/** Keys into the option lists a workflow-form.tsx caller supplies (see `RelationOptions`
 *  there) — lets a condition field that stores a foreign key render a picklist of the
 *  actual related rows instead of asking the admin to type a raw id. */
export type DocumentFieldRelation = 'county' | 'globalDimension1' | 'globalDimension2';

/** A condition field as shown in the admin UI — `label` and `relation` are read off the
 *  real table/column metadata by `listConditionFieldDefs()` in lib/workflow.ts, not hand-typed. */
export interface DocumentFieldDef { key: string; label: string; relation?: DocumentFieldRelation }

/** The DB table backing each document type — the parent row `listWorkflowTableRelations()`
 *  registers per document type, and what `listConditionFieldDefs()` introspects for columns
 *  and foreign keys. Never admin-editable: it's the only table the document's own submission
 *  code (lib/gl.ts, lib/receipts.ts, lib/payroll.ts) actually fetches condition
 *  values from, so letting it be freely set would let an admin configure fields that silently
 *  never match. Which of that table's columns are actually enabled for conditioning is the
 *  admin-managed part — see Admin Centre → Workflow Management → Table Relations. */
export const DOCUMENT_TABLE: Record<WorkflowDocumentType, string> = {
  JOURNAL: 'journal',
  IMPREST_REQUEST: 'imprest_request',
  IMPREST_SURRENDER: 'imprest_request',
  PETTY_CASH: 'petty_cash',
  STAFF_CLAIM: 'staff_claim',
  STORE_REQUISITION: 'requisition',
  PURCHASE_REQUISITION: 'requisition',
  ITEM_JOURNAL: 'item_journal_line',
  FA_JOURNAL: 'fa_journal_line',
  SALES_DOCUMENT: 'sales_header',
  REMINDER: 'reminder_header',
  PURCHASE_DOCUMENT: 'purchase_header',
  RECEIPT: 'receipt_header',
  PAYMENT_VOUCHER: 'payment_voucher_header',
  EMPLOYEE_ONBOARDING: 'employee',
  EMPLOYEE_EDIT: 'employee_edit_request',
  EMPLOYEE_CONTRACT_CHANGE: 'employee_contract_change',
  EMPLOYEE_EXIT: 'employee_exit',
  LEAVE_APPLICATION: 'hr_leave_application',
  LEAVE_ADJUSTMENT: 'hr_leave_adjustment',
  LEAVE_RECALL: 'hr_leave_recall',
  LEAVE_PLAN: 'hr_leave_plan',
  PAYROLL_PERIOD: 'payroll_period',
  COMPANY_JOB: 'company_job',
};

export const DOCUMENT_TYPE_LABELS: Record<WorkflowDocumentType, string> = {
  JOURNAL: 'Journal',
  IMPREST_REQUEST: 'Imprest Request',
  IMPREST_SURRENDER: 'Imprest Surrender',
  PETTY_CASH: 'Petty Cash',
  STAFF_CLAIM: 'Staff Claim',
  STORE_REQUISITION: 'Store Requisition',
  PURCHASE_REQUISITION: 'Purchase Requisition',
  ITEM_JOURNAL: 'Item Journal',
  FA_JOURNAL: 'Fixed Asset Journal',
  SALES_DOCUMENT: 'Sales Document',
  REMINDER: 'Reminder / Finance Charge',
  PURCHASE_DOCUMENT: 'Purchase Document',
  RECEIPT: 'Receipt',
  PAYMENT_VOUCHER: 'Payment Voucher',
  EMPLOYEE_ONBOARDING: 'Employee Onboarding',
  EMPLOYEE_EDIT: 'Employee Detail Edit',
  EMPLOYEE_CONTRACT_CHANGE: 'Employee Contract / Salary Change',
  EMPLOYEE_EXIT: 'Employee Exit',
  LEAVE_APPLICATION: 'Leave Application',
  LEAVE_ADJUSTMENT: 'Leave Adjustment',
  LEAVE_RECALL: 'Leave Recall',
  LEAVE_PLAN: 'Leave Plan',
  PAYROLL_PERIOD: 'Payroll Period',
  COMPANY_JOB: 'Company Job (Organogram)',
};

const humanizeIdentifier = (identifier: string): string => identifier
  .replace(/_id$/, '')
  .replace(/_/g, ' ')
  .replace(/\b\w/g, (c) => c.toUpperCase());

/** A document type's display label: the curated business name for a wired type, or the
 *  humanized table name for any other document type returned by listDocumentTypeOptions(). */
export function documentTypeLabel(documentType: string): string {
  return DOCUMENT_TYPE_LABELS[documentType as WorkflowDocumentType] ?? humanizeIdentifier(documentType);
}

export const CONDITION_OPERATORS: { value: WorkflowConditionOperator; label: string }[] = [
  { value: '=', label: 'equals' },
  { value: '!=', label: 'does not equal' },
  { value: '>', label: 'greater than' },
  { value: '>=', label: 'greater than or equal to' },
  { value: '<', label: 'less than' },
  { value: '<=', label: 'less than or equal to' },
  { value: 'BETWEEN', label: 'between' },
];

export const APPROVER_TYPES: { value: WorkflowApproverType; label: string }[] = [
  { value: 'USER', label: 'Specific user' },
  { value: 'DIRECT_APPROVER', label: "Requester's approver" },
  { value: 'USER_GROUP', label: 'Workflow user group' },
];

export const DOCUMENT_LINK: Record<WorkflowDocumentType, (entityId: string) => string> = {
  JOURNAL: () => '/approvals',
  IMPREST_REQUEST: (id) => `/imprest/view/${id}`,
  IMPREST_SURRENDER: (id) => `/imprest/view/${id}`,
  PETTY_CASH: (id) => `/imprest/petty-cash/${id}`,
  STAFF_CLAIM: (id) => `/imprest/staff-claims/${id}`,
  STORE_REQUISITION: (id) => `/requisitions/view/${id}`,
  PURCHASE_REQUISITION: (id) => `/requisitions/view/${id}`,
  ITEM_JOURNAL: () => '/inventory/item-journal',
  FA_JOURNAL: () => '/fixed-assets/journal',
  // A notification opens the document itself, not the list it sits in. Once posted, the card
  // forwards to the posted document (the source header is gone, but source_no still points here).
  SALES_DOCUMENT: (id) => `/receivables/documents/${id}`,
  REMINDER: () => '/receivables/reminders',
  PURCHASE_DOCUMENT: (id) => `/payables/documents/${id}`,
  RECEIPT: (id) => `/cash-management/receipts/${id}`,
  PAYMENT_VOUCHER: (id) => `/cash-management/payment-vouchers/${id}`,
  EMPLOYEE_ONBOARDING: (id) => `/employees/view/${id}`,
  EMPLOYEE_EDIT: (id) => `/employee-edits/view/${id}`,
  EMPLOYEE_CONTRACT_CHANGE: (id) => `/employee-contract-changes/view/${id}`,
  EMPLOYEE_EXIT: (id) => `/employee-exits/view/${id}`,
  LEAVE_APPLICATION: (id) => `/leave-applications/view/${id}`,
  LEAVE_ADJUSTMENT: (id) => `/leave-adjustments/view/${id}`,
  LEAVE_RECALL: (id) => `/leave-recalls/view/${id}`,
  LEAVE_PLAN: (id) => `/leave-plans/view/${id}`,
  PAYROLL_PERIOD: (id) => `/payroll/periods/view/${id}`,
  COMPANY_JOB: (id) => `/company-jobs/view/${id}`,
};

export function documentLabel(documentType: WorkflowDocumentType, entityId: string): string {
  return `${DOCUMENT_TYPE_LABELS[documentType]} ${entityId}`;
}

/** Close Income Statement: the posting description used when none is typed (shared with the client form). */
export const CLOSE_INCOME_STATEMENT_DESCRIPTION = 'Close Income Statement';
