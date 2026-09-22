'use server';

import { revalidatePath } from 'next/cache';
import { requireAction, requireUser } from '@/lib/session';
import { actionResult } from '@/lib/errors';
import * as workflow from '@/lib/workflow';
import { decideWorkflowTask, delegateWorkflowTask, type DelegateTarget } from '@/lib/workflow';
import type { ActionResult, DocumentTypeOption, FormValues, Workflow, WorkflowUserGroup } from '@/lib/types';

export async function saveWorkflow(
  id: number | null,
  values: FormValues,
  conditions: workflow.ConditionDraft[],
  steps: workflow.StepDraft[],
): Promise<ActionResult<Workflow | { id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_WORKFLOWS_DEFINITIONS_MANAGE');
    const body: workflow.WorkflowInput = {
      name: String(values.name || '').trim(),
      document_type: String(values.document_type || ''),
      enabled: values.enabled === undefined ? null : (Number(values.enabled) ? 1 : 0),
    };
    const result = id
      ? await workflow.updateWorkflow(id, body, conditions, steps, user)
      : await workflow.createWorkflow(body, conditions, steps, user);
    revalidatePath('/admin/workflows');
    return result;
  });
}

/** The live document-type picker for the workflow creation form — every wired business document
 *  type plus every other document type an admin has registered under Table Relations (see
 *  listWorkflowDocumentTypes() in lib/workflow.ts), not every real table in the database. */
export async function listWorkflowDocumentTypes(): Promise<ActionResult<DocumentTypeOption[]>> {
  return actionResult(async () => {
    await requireAction('ADMIN_WORKFLOWS_DEFINITIONS_MANAGE');
    return workflow.listWorkflowDocumentTypes();
  });
}

/** The condition fields currently enabled for a document type — fetched lazily as the workflow
 *  form's document-type selection changes, rather than precomputed for every document type up
 *  front, since that set can now be arbitrarily large (any real table, not just the 4 wired
 *  types). */
export async function getWorkflowConditionFields(documentType: string): Promise<ActionResult<workflow.DocumentFieldDef[]>> {
  return actionResult(async () => {
    await requireAction('ADMIN_WORKFLOWS_DEFINITIONS_MANAGE');
    return workflow.listConditionFieldDefs(documentType);
  });
}

/** The real, not-yet-enabled columns of a document type's table — fetched lazily by the Table
 *  Relations "Configure fields" modal when it opens, for the same reason as
 *  getWorkflowConditionFields() above. */
export async function getWorkflowAddableColumns(documentType: string): Promise<ActionResult<string[]>> {
  return actionResult(async () => {
    await requireAction('ADMIN_WORKFLOWS_TABLES_MANAGE');
    return workflow.listAddableTableColumns(documentType);
  });
}

export async function saveWorkflowUserGroup(
  id: number | null,
  values: FormValues,
  members: workflow.GroupMemberDraft[],
): Promise<ActionResult<WorkflowUserGroup | { id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_WORKFLOWS_GROUPS_MANAGE');
    const body: workflow.WorkflowUserGroupInput = {
      name: String(values.name || '').trim(),
      status: values.status ? String(values.status) : null,
    };
    const result = id
      ? await workflow.updateWorkflowUserGroup(id, body, members, user)
      : await workflow.createWorkflowUserGroup(body, members, user);
    revalidatePath('/admin/workflows');
    return result;
  });
}

/** Replaces the enabled condition-field set for a document type's table relation — creating the
 *  relation (against its fixed, non-editable table) the first time that document type is configured. */
export async function saveWorkflowTableRelationFields(
  documentType: string, fieldNames: string[],
): Promise<ActionResult<{ saved: true }>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_WORKFLOWS_TABLES_MANAGE');
    await workflow.saveWorkflowTableRelationFields(documentType, fieldNames, user);
    revalidatePath('/admin/workflows');
    return { saved: true };
  });
}

export async function saveApprovalUserSetupRow(
  userId: number,
  values: FormValues,
): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_WORKFLOWS_SETUP_MANAGE');
    await workflow.saveApprovalUserSetup(userId, {
      approver_id: Number(values.approver_id) || null,
      substitute_id: Number(values.substitute_id) || null,
      is_approval_administrator: Number(values.is_approval_administrator) ? 1 : 0,
      can_reverse_journal: Number(values.can_reverse_journal) ? 1 : 0,
      allow_posting_from: String(values.allow_posting_from || '').trim() || null,
      allow_posting_to: String(values.allow_posting_to || '').trim() || null,
      allow_posting_from_time: String(values.allow_posting_from_time || '').trim() || null,
      allow_posting_to_time: String(values.allow_posting_to_time || '').trim() || null,
      employee_id: Number(values.employee_id) || null,
    }, user);
    revalidatePath('/admin/workflows');
    return { updated: true };
  });
}

/** Act on a task assigned to me (or my group / the approver I substitute for). */
export async function decideMyTask(
  taskId: number, approve: boolean, comment: string,
): Promise<ActionResult<workflow.DecideResult>> {
  return actionResult(async () => {
    const user = await requireUser();
    const result = await decideWorkflowTask(taskId, approve, comment.trim() || null, user);
    revalidatePath('/approvals');
    revalidatePath('/member-applications');
    revalidatePath('/loans');
    revalidatePath('/accounting');
    return result;
  });
}

/**
 * Hand a pending task off to the current approver's substitute — Business Central's Delegate
 * action. Returns who it went to so the confirmation can name them.
 */
export async function delegateMyTask(taskId: number): Promise<ActionResult<DelegateTarget>> {
  return actionResult(async () => {
    const user = await requireUser();
    const target = await delegateWorkflowTask(taskId, user);
    revalidatePath('/approvals');
    revalidatePath('/member-applications');
    revalidatePath('/loans');
    revalidatePath('/accounting');
    revalidatePath('/receivables');
    revalidatePath('/payables');
    return target;
  });
}
