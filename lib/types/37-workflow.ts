/* workflow — split out of lib/types.ts; import from '@/lib/types', never from here directly. */
import type { Cents, Flag, IsoDate, IsoDateTime } from '../types.ts';

/* --------------------------------------------------------------- workflow */

export type WorkflowDocumentType =
  | 'JOURNAL' | 'ITEM_JOURNAL' | 'FA_JOURNAL'
  | 'IMPREST_REQUEST' | 'IMPREST_SURRENDER' | 'PETTY_CASH' | 'STAFF_CLAIM'
  | 'STORE_REQUISITION' | 'PURCHASE_REQUISITION'
  | 'SALES_DOCUMENT' | 'REMINDER'
  | 'PURCHASE_DOCUMENT'
  | 'RECEIPT' | 'PAYMENT_VOUCHER'
  | 'EMPLOYEE_ONBOARDING' | 'EMPLOYEE_EDIT' | 'EMPLOYEE_CONTRACT_CHANGE' | 'EMPLOYEE_EXIT'
  | 'LEAVE_APPLICATION' | 'LEAVE_ADJUSTMENT' | 'LEAVE_RECALL' | 'LEAVE_PLAN' | 'PAYROLL_PERIOD'
  | 'COMPANY_JOB';
export type WorkflowApproverType = 'USER' | 'DIRECT_APPROVER' | 'USER_GROUP';
export type WorkflowConditionOperator = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'BETWEEN';
export type WorkflowTaskStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface Workflow {
  id: number;
  name: string;
  /** One of the wired WorkflowDocumentType literals, or (for a workflow defined against any
   *  other real table) that table's own name — see DocumentTypeOption / listDocumentTypeOptions(). */
  document_type: string;
  enabled: Flag;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

/** One selectable document type in a workflow's dropdown — the live, denylist-filtered set of
 *  every real table, not just the fixed handful with a wired submission flow. */
export interface DocumentTypeOption {
  documentType: string;
  table: string;
  label: string;
  /** Whether a submission flow actually calls findMatchingWorkflow() for this document type.
   *  False for any table beyond the wired set: an admin can still configure conditions and
   *  approval steps for it, but it stays inert — no code path creates a task from it — until
   *  real integration code is added, the same way JOURNAL/RECEIPT/etc. were. */
  wired: boolean;
}

export interface WorkflowCondition {
  id: number;
  workflow_id: number;
  field: string;
  operator: WorkflowConditionOperator;
  value: string;
  value2: string | null;
}

export interface WorkflowStep {
  id: number;
  workflow_id: number;
  step_no: number;
  approver_type: WorkflowApproverType;
  approver_user_id: number | null;
  approver_group_id: number | null;
  notify_email: Flag;
}

/** A workflow with its condition and step child rows, as edited/displayed as one unit. */
export interface WorkflowWithDetail extends Workflow {
  conditions: WorkflowCondition[];
  steps: WorkflowStep[];
}

/** Registers the one DB table backing a document type's workflow conditions — admin-managed
 *  under Admin Centre → Workflow Management → Table Relations. `table_name` is never freely
 *  editable: for a wired document type it always mirrors DOCUMENT_TABLE[document_type]
 *  (lib/workflowConstants.ts) — the only table that type's submission code actually fetches
 *  condition values from — and for any other document type it's forced to match the document
 *  type itself, since that IS the table name there (see DocumentTypeOption). */
export interface WorkflowTableRelation {
  id: number;
  document_type: string;
  table_name: string;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

/** One column of a table relation's table that's enabled as a workflow condition field. */
export interface WorkflowTableRelationField {
  id: number;
  table_relation_id: number;
  field_name: string;
}

export interface WorkflowTableRelationWithFields extends WorkflowTableRelation {
  fields: WorkflowTableRelationField[];
}

/** An admin-defined CSV export/import package (Admin Centre → Data Management) — which table,
 *  and via ConfigPackageField, which of that table's columns are included. */
export interface ConfigPackage {
  id: number;
  code: string;
  name: string;
  table_name: string;
  key_field: string | null;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface ConfigPackageField {
  id: number;
  package_id: number;
  field_name: string;
  column_no: number;
}

export interface ConfigPackageWithFields extends ConfigPackage {
  fields: ConfigPackageField[];
}

/** One selectable table in the package's table dropdown — the live, denylist-filtered set. */
export interface ConfigPackageTableOption {
  table_name: string;
  label: string;
}

/** One selectable column of a package's table — `relation_table` is set when the column is a
 *  foreign key, so export/import can resolve it to/from a human-readable code instead of a raw id.
 *  `required` (NOT NULL, no default) matters for import: a row that doesn't match the package's
 *  key field gets inserted as new, so it must supply every required column or the insert fails —
 *  importConfigPackage() checks this up front instead of surfacing a raw DB constraint error.
 *  `filter_type` drives which operators the export filter builder offers for this column. */
export interface ConfigPackageColumn {
  name: string;
  label: string;
  relation_table: string | null;
  required: boolean;
  filter_type: 'text' | 'number' | 'date' | 'select';
}

export interface ConfigImportRowResult {
  row: number;
  status: 'INSERTED' | 'UPDATED' | 'ERROR';
  message?: string;
}

export interface ConfigImportResult {
  inserted: number;
  updated: number;
  errors: number;
  rows: ConfigImportRowResult[];
}

export interface WorkflowUserGroup {
  id: number;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface WorkflowUserGroupWithUsage extends WorkflowUserGroup {
  members: number;
}

/** One member of an approval user group, with the sequence level they approve at. */
export interface WorkflowUserGroupMemberRow {
  user_id: number;
  sequence: number;
}

export interface ApprovalUserSetup {
  id: number;
  user_id: number;
  approver_id: number | null;
  substitute_id: number | null;
  is_approval_administrator: Flag;
  can_reverse_journal: Flag;
  /** This user's own Allow Posting From/To override — null falls back to the organisation's. */
  allow_posting_from: IsoDate | null;
  allow_posting_to: IsoDate | null;
  /** Time-of-day refinement on the two boundary dates only — see the schema's own doc comment. */
  allow_posting_from_time: string | null;
  allow_posting_to_time: string | null;
  /** AL User Setup "Employee No." — the employee this login is; Self Service hangs off it. */
  employee_id: number | null;
  /** The login is teaching staff: the Teacher Portal shows inside Self Service. */
  is_teacher: Flag;
  /** A student or guardian login — the Student / Parent portal's subject. */
  student_id: number | null;
  guardian_id: number | null;
}

/** One row of the Approval User Setup grid — the user plus their configured setup, if any. */
export interface ApprovalUserSetupRow {
  user_id: number;
  username: string;
  full_name: string;
  /** The user's scanned signature — a Cloudinary public_id, or null when none is on file. */
  signature_image: string | null;
  approver_id: number | null;
  approver_name: string | null;
  substitute_id: number | null;
  substitute_name: string | null;
  employee_id: number | null;
  employee_no: string | null;
  employee_name: string | null;
  is_teacher: Flag;
  student_id: number | null;
  student_name: string | null;
  guardian_id: number | null;
  guardian_name: string | null;
  is_approval_administrator: Flag;
  can_reverse_journal: Flag;
  allow_posting_from: IsoDate | null;
  allow_posting_to: IsoDate | null;
  allow_posting_from_time: string | null;
  allow_posting_to_time: string | null;
}

export interface WorkflowTask {
  id: number;
  workflow_id: number | null;
  workflow_step_id: number | null;
  step_no: number;
  document_type: WorkflowDocumentType;
  entity_id: string;
  assigned_to_user_id: number | null;
  assigned_to_group_id: number | null;
  /** The group's currently-pending sequence level; null when assigned to a single user. */
  current_sequence: number | null;
  /** Set when the current approver hands this task to their substitute. */
  delegated_by_user_id: number | null;
  delegated_to_user_id: number | null;
  status: WorkflowTaskStatus;
  requested_by: string;
  requested_at: IsoDateTime;
  decided_by: string | null;
  decided_at: IsoDateTime | null;
  comment: string | null;
  amount: Cents;
  payload: string | null;
}

/** A task row as shown in the "My Approvals" worklist — with display labels resolved. */
export interface WorkflowTaskRow extends WorkflowTask {
  workflow_name: string | null;
  /** A short human label for the document (receipt no., application no., journal no.). */
  document_label: string;
  /** Where "Review" / clicking the row should navigate. */
  link: string;
}

/** One group-sequence level a task has already cleared, reconstructed from the system audit
 *  log since the task row itself only ever holds the final decision. */
export interface WorkflowLevelDecision {
  sequence: number;
  decided_by: string;
  decided_at: IsoDateTime;
  comment: string | null;
}

/** A task row as shown on a document's own Approval Details table. */
export interface WorkflowTaskWithApprover extends WorkflowTask {
  /** Who may currently act on this task — a resolved name, or "Group name — member, member".
   *  Only populated while status is PENDING; null once decided. */
  pending_with: string | null;
  /** For a group task with multiple sequence levels, each level already cleared, oldest
   *  first. Empty for a single-approver task, or a group task still on its first level. */
  level_decisions: WorkflowLevelDecision[];
}

export type NotificationType = 'WORKFLOW_PENDING' | 'WORKFLOW_APPROVED' | 'WORKFLOW_REJECTED';
