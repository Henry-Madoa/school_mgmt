/*
 * The workflow engine — Business-Central-style approval routing shared by
 * every document type (journals, receipts, purchase documents, leave, payroll ...).
 *
 * A document's own service module (lib/gl.ts, lib/receipts.ts, lib/payroll.ts ...) asks findMatchingWorkflow() whether an admin-defined workflow
 * applies; if so it calls startWorkflow() instead of doing its own permission-
 * gated approval. Nothing here imports those modules at the top level — the
 * finalize step (a task's last step is approved / any step is rejected) reaches
 * back into them with a dynamic import, so the two directions of the reference
 * never form a real circular dependency at module-evaluation time.
 */
import {
  one, all, run, tx, audit, hasAnyRow,
} from './db.ts';
import { AppError } from './errors.ts';
import { sendMail, approvalRequestedEmail, approvalDecidedEmail } from './mailer.ts';
import { notify } from './notifications.ts';
import { DOCUMENT_LINK, documentLabel, DOCUMENT_TABLE, DOCUMENT_TYPE_LABELS } from './workflowConstants.ts';
import type { DocumentFieldDef, DocumentFieldRelation } from './workflowConstants.ts';
import { buildFilterClause, type FilterCondition, type FilterFieldDef } from './listFilters.ts';
import { buildOrderClause, type SortState } from './listSort.ts';
import type {
  Actor, ApprovalUserSetupRow, Cents, DocumentTypeOption, Flag, Workflow, WorkflowApproverType,
  WorkflowCondition, WorkflowConditionOperator, WorkflowDocumentType, WorkflowLevelDecision, WorkflowStep,
  WorkflowTableRelationField, WorkflowTableRelationWithFields, WorkflowTask, WorkflowTaskRow,
  WorkflowTaskWithApprover, WorkflowUserGroupMemberRow, WorkflowUserGroupWithUsage, WorkflowWithDetail,
} from './types.ts';

export * from './workflowConstants.ts';

/* -------------------------------------------------------- condition field catalogue */

/**
 * For document types whose submission code doesn't forward a full table row into
 * findMatchingWorkflow() — JOURNAL is matched before/without ever fetching its own row back (see
 * lib/gl.ts) — the admin's field picker is capped to exactly the columns that call already
 * forwards, so every field an admin enables is guaranteed to actually be evaluated. Every other
 * type forwards its whole row (pickConditionFields() below) so it carries no cap.
 */
const RUNTIME_FIELD_CAP: Partial<Record<WorkflowDocumentType, readonly string[]>> = {
  JOURNAL: ['amount', 'global_dimension_1_id', 'global_dimension_2_id'],
};

/** Which relation-option list (see workflow-form.tsx's `RelationOptions`) a foreign key
 *  pointing at this table should be rendered with. */
const RELATION_BY_TABLE: Record<string, DocumentFieldRelation> = {
  county: 'county',
  global_dimension_1_value: 'globalDimension1',
  global_dimension_2_value: 'globalDimension2',
};

const humanize = (identifier: string): string => identifier
  .replace(/_id$/, '')
  .replace(/_/g, ' ')
  .replace(/\b\w/g, (c) => c.toUpperCase());

/** Real columns and FK targets of `table`, as introspected from Postgres itself. */
async function tableSchema(table: string): Promise<{ columns: Set<string>; referencedTableByColumn: Map<string, string> }> {
  const [columns, foreignKeys] = await Promise.all([
    all<{ column_name: string }>(
      'SELECT column_name FROM information_schema.columns WHERE table_name = ?', table,
    ),
    all<{ column_name: string; referenced_table: string }>(
      `SELECT kcu.column_name, ccu.table_name AS referenced_table
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = ?`,
      table,
    ),
  ]);
  return {
    columns: new Set(columns.map((c) => c.column_name)),
    referencedTableByColumn: new Map(foreignKeys.map((fk) => [fk.column_name, fk.referenced_table])),
  };
}

function fieldDef(key: string, referencedTableByColumn: Map<string, string>): DocumentFieldDef {
  const referencedTable = referencedTableByColumn.get(key);
  const relation = referencedTable ? RELATION_BY_TABLE[referencedTable] : undefined;
  return { key, label: humanize(referencedTable ?? key), relation };
}

/** Tables that make no sense as a workflow document type however an admin configures one: the
 *  workflow engine's own state, auth/session tables (already have their own Admin Centre UI),
 *  and other admin/audit infrastructure. Not a write-safety denylist like configPackages.ts's
 *  EXCLUDED_TABLES — a workflow only ever reads condition values off a table, never writes it —
 *  just a noise filter so the document-type picker doesn't fill up with tables no one would
 *  ever route an approval on. */
const EXCLUDED_DOCUMENT_TABLES = new Set([
  'session', 'sequence', 'audit_log', 'change_log_setup', 'change_log_entry',
  'app_user', 'role',
  'workflow', 'workflow_condition', 'workflow_step', 'workflow_table_relation',
  'workflow_table_relation_field', 'workflow_user_group', 'workflow_user_group_member',
  'workflow_task', 'approval_user_setup',
  'config_package', 'config_package_field',
]);

/** The table backing a document type: the fixed mapping for a wired business document type, or
 *  (for a workflow defined against any other real table) the document type itself — a non-wired
 *  document type's key IS its table name, per listDocumentTypeOptions() below. */
function tableForDocumentType(documentType: string): string {
  return DOCUMENT_TABLE[documentType as WorkflowDocumentType] ?? documentType;
}

/**
 * Every real table a new table relation may be registered against — the Table Relations tab's
 * own picker, not the workflow form's Document Type dropdown (see listWorkflowDocumentTypes()
 * below, which is what a workflow is actually created against). Introspected live via
 * information_schema, the same approach listConfigPackageTables() in lib/configPackages.ts uses
 * for its own table dropdown.
 */
export async function listDocumentTypeOptions(): Promise<DocumentTypeOption[]> {
  const wired: DocumentTypeOption[] = (Object.keys(DOCUMENT_TABLE) as WorkflowDocumentType[]).map((t) => ({
    documentType: t, table: DOCUMENT_TABLE[t], label: DOCUMENT_TYPE_LABELS[t], wired: true,
  }));
  const wiredTables = new Set(wired.map((w) => w.table));

  const rows = await all<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
  );
  const other: DocumentTypeOption[] = rows
    .filter((r) => (
      !wiredTables.has(r.table_name) && !EXCLUDED_DOCUMENT_TABLES.has(r.table_name) && !r.table_name.startsWith('_')
    ))
    .map((r) => ({ documentType: r.table_name, table: r.table_name, label: humanize(r.table_name), wired: false }));

  return [...wired, ...other];
}

/**
 * Every document type a workflow may actually be created against: the wired business document
 * types (their submission code enforces approvals — see DOCUMENT_TABLE), plus any other document
 * type an admin has already registered by configuring it under Table Relations (a row in
 * workflow_table_relation) — NOT every real table in the database. Table Relations' own picker
 * (listDocumentTypeOptions() above) is where an admin browses the full table list and registers
 * one; only after that does it show up here, so the workflow form's dropdown stays curated
 * instead of listing tables no one has opted into.
 */
export async function listWorkflowDocumentTypes(): Promise<DocumentTypeOption[]> {
  const wired: DocumentTypeOption[] = (Object.keys(DOCUMENT_TABLE) as WorkflowDocumentType[]).map((t) => ({
    documentType: t, table: DOCUMENT_TABLE[t], label: DOCUMENT_TYPE_LABELS[t], wired: true,
  }));
  const wiredTypes = new Set(wired.map((w) => w.documentType));

  const rows = await all<{ document_type: string; table_name: string }>(
    'SELECT document_type, table_name FROM workflow_table_relation ORDER BY document_type',
  );
  const registered: DocumentTypeOption[] = rows
    .filter((r) => !wiredTypes.has(r.document_type))
    .map((r) => ({ documentType: r.document_type, table: r.table_name, label: humanize(r.table_name), wired: false }));

  return [...wired, ...registered];
}

/** Throws unless `documentType` is present in `options` — re-checked before every write this
 *  module makes off a client-supplied document type, since a client payload (or a schema change
 *  since the option was offered) can't be trusted on its own. Callers pass whichever of
 *  listDocumentTypeOptions() / listWorkflowDocumentTypes() matches what they actually offered. */
async function assertDocumentType(documentType: string, options: DocumentTypeOption[]): Promise<void> {
  if (!options.some((o) => o.documentType === documentType)) {
    throw new AppError('Unknown document type', 'VALIDATION');
  }
}

/* ------------------------------------------------------ admin: table relations */

/** Every configured table relation, fields included — the admin listing for
 *  Admin Centre → Workflow Management → Table Relations. */
export async function listWorkflowTableRelations(): Promise<WorkflowTableRelationWithFields[]> {
  const relations = await all<WorkflowTableRelationWithFields>(
    'SELECT * FROM workflow_table_relation ORDER BY document_type',
  );
  const fields = await all<WorkflowTableRelationField>('SELECT * FROM workflow_table_relation_field ORDER BY field_name');
  const byRelation = new Map<number, WorkflowTableRelationField[]>();
  for (const f of fields) byRelation.set(f.table_relation_id, [...(byRelation.get(f.table_relation_id) ?? []), f]);
  return relations.map((r) => ({ ...r, fields: byRelation.get(r.id) ?? [] }));
}

/** The real columns of a document type's table that are still available to add as a condition
 *  field — real columns that exist, aren't already enabled, and (for JOURNAL) fall inside
 *  the runtime cap above, so nothing offered here could ever silently fail to match. A document
 *  type with no runtime cap (every wired type but JOURNAL, and every non-wired type) offers
 *  every real column. */
export async function listAddableTableColumns(documentType: string): Promise<string[]> {
  const { columns } = await tableSchema(tableForDocumentType(documentType));
  const cap = RUNTIME_FIELD_CAP[documentType as WorkflowDocumentType];
  const already = new Set(await listConditionFieldKeys(documentType));
  return [...columns]
    .filter((c) => !already.has(c) && (!cap || cap.includes(c)))
    .sort((a, b) => a.localeCompare(b));
}

/** The field keys currently enabled for a document type's conditions — empty until an admin
 *  has configured (or re-configured) that document type's table relation. */
export async function listConditionFieldKeys(documentType: string): Promise<string[]> {
  const relation = await one<{ id: number }>(
    'SELECT id FROM workflow_table_relation WHERE document_type = ?', documentType,
  );
  if (!relation) return [];
  const rows = await all<{ field_name: string }>(
    'SELECT field_name FROM workflow_table_relation_field WHERE table_relation_id = ?', relation.id,
  );
  return rows.map((r) => r.field_name);
}

/**
 * Replaces the enabled field set for a document type's table relation, creating the relation row
 * (table_name always tableForDocumentType(documentType) — never admin-supplied) the first time a
 * document type is configured. Every field name is re-validated against the real table and the
 * runtime cap server-side, since a client payload can't be trusted to have respected either.
 */
export async function saveWorkflowTableRelationFields(
  documentType: string, fieldNames: string[], user: Actor,
): Promise<void> {
  await assertDocumentType(documentType, await listDocumentTypeOptions());
  const table = tableForDocumentType(documentType);
  const { columns } = await tableSchema(table);
  const cap = RUNTIME_FIELD_CAP[documentType as WorkflowDocumentType];
  const valid = [...new Set(fieldNames)].filter((f) => columns.has(f) && (!cap || cap.includes(f)));

  await tx(async () => {
    const existing = await one<{ id: number }>(
      'SELECT id FROM workflow_table_relation WHERE document_type = ?', documentType,
    );
    const relationId = existing
      ? existing.id
      : Number((await run(
        'INSERT INTO workflow_table_relation (document_type, table_name, created_at, created_by) VALUES (?,?,?,?)',
        documentType, table, new Date().toISOString(), user.username,
      )).lastInsertRowid);

    await run('DELETE FROM workflow_table_relation_field WHERE table_relation_id = ?', relationId);
    for (const field of valid) {
      await run(
        'INSERT INTO workflow_table_relation_field (table_relation_id, field_name) VALUES (?,?)', relationId, field,
      );
    }
    await audit(user, 'WORKFLOW_TABLE_RELATION_SAVE', 'workflow_table_relation', relationId, { document_type: documentType, fields: valid });
  });
}

/**
 * The condition fields available for a document type, read off the real table and the admin's
 * enabled field list: which of the currently-enabled keys still exist as columns (a
 * renamed/dropped column just disappears from the picker), plus, for any that are foreign keys,
 * which table they reference — so the admin form can offer a picklist of that table's actual
 * rows instead of a raw id, and dimension fields inherit the org's own captions.
 */
export async function listConditionFieldDefs(documentType: string): Promise<DocumentFieldDef[]> {
  const keys = await listConditionFieldKeys(documentType);
  if (!keys.length) return [];
  const { columns, referencedTableByColumn } = await tableSchema(tableForDocumentType(documentType));
  return keys.filter((key) => columns.has(key)).map((key) => fieldDef(key, referencedTableByColumn));
}

/** Lifts the admin-enabled condition fields off a document row, for handing to
 *  `findMatchingWorkflow()` — keeps that call in lockstep with the admin field catalogue above
 *  instead of duplicating the key list at the call site. Only meaningful for a document type
 *  whose service fetches its own full row before matching; JOURNAL builds its fields object by
 *  hand from local variables instead. */
export async function pickConditionFields(
  documentType: WorkflowDocumentType, row: object,
): Promise<Record<string, number | string | null>> {
  const keys = await listConditionFieldKeys(documentType);
  const source = row as Record<string, number | string | null | undefined>;
  const out: Record<string, number | string | null> = {};
  for (const key of keys) out[key] = source[key] ?? null;
  return out;
}

/* ----------------------------------------------------------- condition match */

function evalCondition(fieldValue: number | string | null, c: WorkflowCondition): boolean {
  if (fieldValue === null || fieldValue === undefined || fieldValue === '') return false;
  const num = Number(fieldValue);
  const numeric = !Number.isNaN(num) && !Number.isNaN(Number(c.value));
  switch (c.operator) {
    case '=': return numeric ? num === Number(c.value) : String(fieldValue) === c.value;
    case '!=': return numeric ? num !== Number(c.value) : String(fieldValue) !== c.value;
    case '>': return numeric && num > Number(c.value);
    case '>=': return numeric && num >= Number(c.value);
    case '<': return numeric && num < Number(c.value);
    case '<=': return numeric && num <= Number(c.value);
    case 'BETWEEN': return numeric && num >= Number(c.value) && num <= Number(c.value2 ?? c.value);
    default: return false;
  }
}

/** The first ACTIVE workflow (with at least one step) whose conditions all match. */
export async function findMatchingWorkflow(
  documentType: WorkflowDocumentType,
  fields: Record<string, number | string | null>,
): Promise<{ workflow: Workflow; steps: WorkflowStep[] } | null> {
  const workflows = await all<Workflow>(
    'SELECT * FROM workflow WHERE document_type = ? AND enabled = 1 ORDER BY id', documentType,
  );
  for (const wf of workflows) {
    const conditions = await all<WorkflowCondition>(
      'SELECT * FROM workflow_condition WHERE workflow_id = ?', wf.id,
    );
    if (!conditions.every((c) => evalCondition(fields[c.field] ?? null, c))) continue;
    const steps = await all<WorkflowStep>(
      'SELECT * FROM workflow_step WHERE workflow_id = ? ORDER BY step_no', wf.id,
    );
    if (!steps.length) continue;
    return { workflow: wf, steps };
  }
  return null;
}

/* -------------------------------------------------------------- routing */

/** The lowest sequence a group has any member at — the level a fresh task starts on. */
async function lowestGroupSequence(groupId: number): Promise<number | null> {
  const row = await one<{ seq: number | null }>(
    'SELECT MIN(sequence) AS seq FROM workflow_user_group_member WHERE group_id = ?', groupId,
  );
  return row?.seq ?? null;
}

/** The next sequence above `afterSequence` a group has a member at, or null if that was the last one. */
async function nextGroupSequence(groupId: number, afterSequence: number): Promise<number | null> {
  const row = await one<{ seq: number | null }>(
    'SELECT MIN(sequence) AS seq FROM workflow_user_group_member WHERE group_id = ? AND sequence > ?',
    groupId, afterSequence,
  );
  return row?.seq ?? null;
}

async function userIdByUsername(username: string): Promise<number | null> {
  const row = await one<{ id: number }>('SELECT id FROM app_user WHERE username = ?', username);
  return row?.id ?? null;
}

async function resolveApprover(
  step: WorkflowStep, requestedByUsername: string,
): Promise<{ userIds: number[]; groupId: number | null; sequence: number | null; requesterId: number | null }> {
  const requesterId = await userIdByUsername(requestedByUsername);

  if (step.approver_type === 'USER') {
    return { userIds: step.approver_user_id ? [step.approver_user_id] : [], groupId: null, sequence: null, requesterId };
  }
  if (step.approver_type === 'USER_GROUP') {
    const sequence = step.approver_group_id ? await lowestGroupSequence(step.approver_group_id) : null;
    return { userIds: [], groupId: step.approver_group_id, sequence, requesterId };
  }

  // DIRECT_APPROVER: the requester's configured approver, falling back to
  // whoever is flagged as an Approval Administrator if none is set up.
  if (requesterId == null) throw new AppError('Requesting user not found', 'USER_NOT_FOUND');

  const setup = await one<{ approver_id: number | null }>(
    'SELECT approver_id FROM approval_user_setup WHERE user_id = ?', requesterId,
  );
  if (setup?.approver_id) return { userIds: [setup.approver_id], groupId: null, sequence: null, requesterId };

  const admins = await all<{ user_id: number }>(
    'SELECT user_id FROM approval_user_setup WHERE is_approval_administrator = 1',
  );
  if (admins.length) return { userIds: admins.map((a) => a.user_id), groupId: null, sequence: null, requesterId };

  throw new AppError(
    'No approver is configured for this request. Ask an administrator to set up an Approver in '
    + 'User Setup, or flag someone as an Approval Administrator.',
    'NO_APPROVER',
  );
}

/**
 * Whether `requesterId` alone satisfies this resolved approver set, so this level should
 * auto-clear the moment its task is created rather than ever sitting there waiting for the
 * requester to approve their own submission. For USER/DIRECT_APPROVER this is true whenever
 * they're the one actually assigned (`primaryUserId` — the same id workflow_task.assigned_to_
 * user_id ends up holding; a DIRECT_APPROVER fallback to several Approval Administrators only
 * ever really assigns the first one, so only that one auto-clears). For a USER_GROUP sequence
 * it's true only when they're the *sole* member at that sequence — the explicit exception:
 * sharing the level with someone else means the requester's own membership doesn't count, and
 * eligibleUserIds() below excludes it so a genuinely different approver still has to decide it.
 */
async function requesterClearsLevel(
  groupId: number | null, sequence: number | null, primaryUserId: number | null, requesterId: number,
): Promise<boolean> {
  if (groupId != null) {
    if (sequence == null) return false;
    const members = await all<{ user_id: number }>(
      'SELECT user_id FROM workflow_user_group_member WHERE group_id = ? AND sequence = ?', groupId, sequence,
    );
    return members.length === 1 && members[0].user_id === requesterId;
  }
  return primaryUserId === requesterId;
}

/** Attributed to the requester as `decided_by` when a level auto-clears because they were its
 *  only possible approver — see requesterClearsLevel(). */
const AUTO_APPROVE_COMMENT = 'Auto-approved — the requester is the assigned approver at this level.';

/**
 * Every user who may currently act on a task: the assignee, or — for a group assigned by
 * sequence — only the members sitting at the task's current (lowest still-pending) sequence
 * level, not the whole group. A user this task was explicitly delegated away from loses
 * eligibility; whoever it was delegated to gains it.
 *
 * A substitute is NOT eligible merely by being someone's substitute — as in Business Central,
 * the request has to be delegated to them first (delegateWorkflowTask()), which is what makes
 * delegation an auditable hand-off rather than a standing second key.
 */
async function eligibleUserIds(
  task: Pick<
    WorkflowTask,
    'assigned_to_user_id' | 'assigned_to_group_id' | 'current_sequence'
    | 'delegated_by_user_id' | 'delegated_to_user_id' | 'requested_by'
  >,
): Promise<number[]> {
  const ids: number[] = [];
  if (task.assigned_to_user_id) ids.push(task.assigned_to_user_id);
  if (task.assigned_to_group_id && task.current_sequence != null) {
    const members = await all<{ user_id: number }>(
      'SELECT user_id FROM workflow_user_group_member WHERE group_id = ? AND sequence = ?',
      task.assigned_to_group_id, task.current_sequence,
    );
    let memberIds = members.map((m) => m.user_id);
    // The requester's own group membership never counts toward clearing a level they share
    // with someone else — see requesterClearsLevel()'s exception. When they're the only member
    // at this sequence there's no one else who ever could act on it, so this leaves them
    // eligible; that shape only survives to here for a task that predates this rule — a fresh
    // one now auto-clears at creation instead of ever staying PENDING (see createTaskForStep()).
    if (memberIds.length > 1) {
      const requesterId = await userIdByUsername(task.requested_by);
      if (requesterId != null) memberIds = memberIds.filter((id) => id !== requesterId);
    }
    ids.push(...memberIds);
  }
  const withDelegation = task.delegated_by_user_id != null
    ? ids.filter((id) => id !== task.delegated_by_user_id)
    : ids;
  if (task.delegated_to_user_id != null) withDelegation.push(task.delegated_to_user_id);
  return [...new Set(withDelegation)];
}

/** Whether `userId` may currently decide this specific pending, routed task. */
export async function isEligibleApprover(
  task: Pick<
    WorkflowTask,
    'assigned_to_user_id' | 'assigned_to_group_id' | 'current_sequence'
    | 'delegated_by_user_id' | 'delegated_to_user_id' | 'requested_by'
  >,
  userId: number,
): Promise<boolean> {
  return (await eligibleUserIds(task)).includes(userId);
}

export interface StartWorkflowInput {
  documentType: WorkflowDocumentType;
  /** The document's own key — a document no., a row id, or a minted journal-draft reference. */
  entityId: string;
  requestedBy: string;
  amount: Cents;
  /** Serialized document data a JOURNAL task needs to actually post once approved. */
  payload?: string | null;
}

/** Notifies (in-app, plus email when requested) whoever can currently act on a pending task. */
async function notifyApprovers(
  documentType: WorkflowDocumentType, entityId: string, requestedBy: string,
  recipients: number[], notifyEmail: boolean,
): Promise<void> {
  const label = documentLabel(documentType, entityId);
  const link = DOCUMENT_LINK[documentType](entityId);
  for (const uid of recipients) {
    await notify(uid, 'WORKFLOW_PENDING', `Approval needed: ${label}`, `Requested by ${requestedBy}`, link);
  }
  if (notifyEmail && recipients.length) {
    const rows = await all<{ email: string | null }>(
      `SELECT email FROM app_user WHERE id IN (${recipients.map(() => '?').join(',')})`, ...recipients,
    );
    for (const r of rows) {
      if (!r.email) continue;
      await sendMail({
        to: r.email,
        subject: `Approval needed: ${label}`,
        html: approvalRequestedEmail(label, requestedBy, link),
      });
    }
  }
}

async function createTaskForStep(workflowId: number, step: WorkflowStep, input: StartWorkflowInput): Promise<number> {
  const { userIds, groupId, sequence, requesterId } = await resolveApprover(step, input.requestedBy);
  const primaryUserId = userIds[0] ?? null;

  const info = await run(
    `INSERT INTO workflow_task
       (workflow_id, workflow_step_id, step_no, document_type, entity_id, assigned_to_user_id,
        assigned_to_group_id, current_sequence, status, requested_by, requested_at, amount, payload)
     VALUES (?,?,?,?,?,?,?,?,'PENDING',?,?,?,?)`,
    workflowId, step.id, step.step_no, input.documentType, input.entityId, primaryUserId,
    groupId, sequence, input.requestedBy, new Date().toISOString(), input.amount, input.payload ?? null,
  );
  const taskId = Number(info.lastInsertRowid);

  // The requester submitted this document straight into their own approval queue — clear this
  // level immediately instead of ever showing it to them as something to act on. See
  // requesterClearsLevel() for the one exception (a USER_GROUP level shared with someone else).
  if (requesterId != null && await requesterClearsLevel(groupId, sequence, primaryUserId, requesterId)) {
    await decideWorkflowTask(taskId, true, AUTO_APPROVE_COMMENT, { id: requesterId, username: input.requestedBy });
    return taskId;
  }

  const recipients = await eligibleUserIds({
    assigned_to_user_id: primaryUserId, assigned_to_group_id: groupId, current_sequence: sequence,
    delegated_by_user_id: null, delegated_to_user_id: null, requested_by: input.requestedBy,
  });
  await notifyApprovers(input.documentType, input.entityId, input.requestedBy, recipients, !!step.notify_email);
  return taskId;
}

/** Kick off the first step of a matched workflow against a freshly-submitted document. */
export async function startWorkflow(
  workflow: Workflow, steps: WorkflowStep[], input: StartWorkflowInput,
): Promise<number> {
  return createTaskForStep(workflow.id, steps[0], input);
}

/**
 * Record a decision made through the old static-permission path (no assignee to
 * check) — kept only for documents that already have a legacy (unrouted) task from
 * before every submission started requiring a matched, enabled workflow.
 */
export async function recordLegacyDecision(
  documentType: WorkflowDocumentType, entityId: string, approved: boolean, reason: string | null, user: Actor,
): Promise<void> {
  await run(
    `UPDATE workflow_task SET status=?, decided_by=?, decided_at=?, comment=?
     WHERE document_type=? AND entity_id=? AND workflow_id IS NULL AND status='PENDING'`,
    approved ? 'APPROVED' : 'REJECTED', user.username, new Date().toISOString(), reason, documentType, entityId,
  );
}

/**
 * Moves the document's own status once its approval task is decided.
 *
 * Every workflow document type must appear here. A missing case fails silently and badly: the
 * task goes APPROVED while the document stays Pending Approval for ever — including when the
 * engine clears a level automatically because the requester is the approver. REMINDER is the
 * one deliberate absence; a reminder has no approve/reject of its own to call.
 */
async function finalizeDocument(task: WorkflowTask, approved: boolean, decidedBy: Actor, reason: string | null): Promise<void> {
  switch (task.document_type) {
    case 'JOURNAL': {
      if (approved && task.payload) {
        const svc = await import('./gl.ts');
        await svc.postManualJournal(JSON.parse(task.payload), decidedBy);
      }
      break;
    }
    case 'IMPREST_REQUEST': {
      const svc = await import('./imprest.ts');
      if (approved) await svc.approveImprestRequest(task.entity_id, decidedBy);
      else await svc.rejectImprestRequest(task.entity_id, reason, decidedBy);
      break;
    }
    case 'IMPREST_SURRENDER': {
      const svc = await import('./imprest.ts');
      if (approved) await svc.approveImprestSurrender(task.entity_id, decidedBy);
      else await svc.rejectImprestSurrender(task.entity_id, reason, decidedBy);
      break;
    }
    case 'PETTY_CASH': {
      const svc = await import('./imprest.ts');
      if (approved) await svc.approvePettyCash(task.entity_id, decidedBy);
      else await svc.rejectPettyCash(task.entity_id, reason, decidedBy);
      break;
    }
    case 'STAFF_CLAIM': {
      const svc = await import('./staffClaims.ts');
      if (approved) await svc.approveStaffClaim(task.entity_id, decidedBy);
      else await svc.rejectStaffClaim(task.entity_id, reason, decidedBy);
      break;
    }
    case 'STORE_REQUISITION':
    case 'PURCHASE_REQUISITION': {
      const svc = await import('./requisitions.ts');
      if (approved) await svc.approveRequisition(task.entity_id, decidedBy);
      else await svc.rejectRequisition(task.entity_id, reason, decidedBy);
      break;
    }
    case 'SALES_DOCUMENT': {
      const svc = await import('./salesDocuments.ts');
      if (approved) await svc.approveSalesDocument(task.entity_id, decidedBy);
      else await svc.rejectSalesDocument(task.entity_id, reason, decidedBy);
      break;
    }
    case 'PURCHASE_DOCUMENT': {
      const svc = await import('./purchaseDocuments.ts');
      if (approved) await svc.approvePurchaseDocument(task.entity_id, decidedBy);
      else await svc.rejectPurchaseDocument(task.entity_id, reason, decidedBy);
      break;
    }
    case 'RECEIPT': {
      const svc = await import('./receipts.ts');
      if (approved) await svc.approveReceipt(task.entity_id, decidedBy);
      else await svc.rejectReceipt(task.entity_id, reason, decidedBy);
      break;
    }
    case 'PAYMENT_VOUCHER': {
      const svc = await import('./paymentVouchers.ts');
      if (approved) await svc.approvePaymentVoucher(task.entity_id, decidedBy);
      else await svc.rejectPaymentVoucher(task.entity_id, reason, decidedBy);
      break;
    }
    case 'ITEM_JOURNAL': {
      const svc = await import('./itemJournal.ts');
      if (approved) await svc.approveItemJournalLine(task.entity_id, decidedBy);
      else await svc.rejectItemJournalLine(task.entity_id, reason, decidedBy);
      break;
    }
    case 'FA_JOURNAL': {
      const svc = await import('./faJournal.ts');
      if (approved) await svc.approveFaJournalLine(task.entity_id, decidedBy);
      else await svc.rejectFaJournalLine(task.entity_id, reason, decidedBy);
      break;
    }
    case 'EMPLOYEE_ONBOARDING': {
      const svc = await import('./employees.ts');
      if (approved) await svc.approveEmployee(Number(task.entity_id), decidedBy);
      else await svc.rejectEmployee(Number(task.entity_id), reason, decidedBy);
      break;
    }
    case 'EMPLOYEE_EDIT': {
      const svc = await import('./employeeEdits.ts');
      if (approved) await svc.approveEmployeeEdit(task.entity_id, decidedBy);
      else await svc.rejectEmployeeEdit(task.entity_id, reason, decidedBy);
      break;
    }
    case 'EMPLOYEE_CONTRACT_CHANGE': {
      const svc = await import('./employeeContractChanges.ts');
      if (approved) await svc.approveContractChange(task.entity_id, decidedBy);
      else await svc.rejectContractChange(task.entity_id, reason, decidedBy);
      break;
    }
    case 'EMPLOYEE_EXIT': {
      const svc = await import('./employeeExits.ts');
      if (approved) await svc.approveExit(task.entity_id, decidedBy);
      else await svc.rejectExit(task.entity_id, reason, decidedBy);
      break;
    }
    case 'LEAVE_APPLICATION': {
      const svc = await import('./leaveManagement.ts');
      if (approved) await svc.approveLeaveApplication(task.entity_id, decidedBy);
      else await svc.rejectLeaveApplication(task.entity_id, reason, decidedBy);
      break;
    }
    case 'LEAVE_ADJUSTMENT': {
      const svc = await import('./leaveManagement.ts');
      if (approved) await svc.approveLeaveAdjustment(task.entity_id, decidedBy);
      else await svc.rejectLeaveAdjustment(task.entity_id, reason, decidedBy);
      break;
    }
    case 'LEAVE_RECALL': {
      const svc = await import('./leaveManagement.ts');
      if (approved) await svc.approveLeaveRecall(task.entity_id, decidedBy);
      else await svc.rejectLeaveRecall(task.entity_id, reason, decidedBy);
      break;
    }
    case 'COMPANY_JOB': {
      const svc = await import('./companyJobs.ts');
      if (approved) await svc.approveCompanyJob(Number(task.entity_id), decidedBy);
      else await svc.rejectCompanyJob(Number(task.entity_id), reason, decidedBy);
      break;
    }
    case 'LEAVE_PLAN': {
      const svc = await import('./leaveManagement.ts');
      if (approved) await svc.approveLeavePlan(task.entity_id, decidedBy);
      else await svc.rejectLeavePlan(task.entity_id, reason, decidedBy);
      break;
    }
    case 'PAYROLL_PERIOD': {
      const svc = await import('./payroll.ts');
      if (approved) await svc.approvePayrollPeriod(Number(task.entity_id), decidedBy);
      else await svc.rejectPayrollPeriod(Number(task.entity_id), reason, decidedBy);
      break;
    }
  }
}

async function notifyRequester(task: WorkflowTask, approved: boolean, decidedByUsername: string, comment: string | null): Promise<void> {
  const requester = await one<{ id: number; email: string | null }>(
    'SELECT id, email FROM app_user WHERE username = ?', task.requested_by,
  );
  if (!requester) return;
  const label = documentLabel(task.document_type, task.entity_id);
  const link = DOCUMENT_LINK[task.document_type](task.entity_id);
  await notify(
    requester.id, approved ? 'WORKFLOW_APPROVED' : 'WORKFLOW_REJECTED',
    `${label} ${approved ? 'approved' : 'rejected'}`, comment || null, link,
  );
  if (requester.email) {
    await sendMail({
      to: requester.email,
      subject: `${label} ${approved ? 'approved' : 'rejected'}`,
      html: approvalDecidedEmail(label, approved, decidedByUsername, comment, link),
    });
  }
}

/** Whether a document is currently routed through a workflow — the action layer uses this to
 *  decide between the assignment-based decideWorkflowTask() path and the legacy permission-gated one. */
export async function findPendingRoutedTask(
  documentType: WorkflowDocumentType, entityId: string,
): Promise<WorkflowTask | null> {
  const task = await one<WorkflowTask>(
    "SELECT * FROM workflow_task WHERE document_type=? AND entity_id=? AND workflow_id IS NOT NULL AND status='PENDING'",
    documentType, String(entityId),
  );
  return task || null;
}

/** Resolved names of whoever may currently act on a still-PENDING task — the same
 *  eligibility eligibleUserIds() already computes for the authorization check, just turned
 *  into something the requester can read: a person's name, or "Group name — member, member"
 *  for a group step. Null once the task has been decided. */
async function describePendingWith(task: WorkflowTask): Promise<string | null> {
  if (task.status !== 'PENDING') return null;
  const ids = await eligibleUserIds(task);
  if (!ids.length) return null;
  const users = await all<{ username: string; full_name: string | null }>(
    `SELECT username, full_name FROM app_user WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids,
  );
  const names = users.map((u) => u.full_name || u.username);
  // A delegated task is with one person for a reason the requester should be able to see.
  if (task.delegated_to_user_id != null && task.delegated_by_user_id != null) {
    const from = await one<{ username: string; full_name: string | null }>(
      'SELECT username, full_name FROM app_user WHERE id = ?', task.delegated_by_user_id,
    );
    const fromName = from?.full_name || from?.username;
    return fromName ? `${names.join(', ')} (delegated by ${fromName})` : names.join(', ');
  }
  if (task.assigned_to_group_id) {
    const group = await one<{ name: string }>('SELECT name FROM workflow_user_group WHERE id = ?', task.assigned_to_group_id);
    return group ? `${group.name} — ${names.join(', ')}` : names.join(', ');
  }
  return names.join(', ');
}

/** Every group-sequence level a task has already cleared, oldest first. A multi-level group
 *  step advances by mutating the same task row's current_sequence (see decideWorkflowTask()
 *  above) rather than inserting a new row per level, so there's nowhere on workflow_task itself
 *  to keep who cleared level 1 once the task has moved to level 2 — this reconstructs that
 *  history from the WORKFLOW_TASK_LEVEL_APPROVE entries decideWorkflowTask() logs to the
 *  system audit log, scoped back down to this one task. */
async function listLevelDecisions(taskId: number, documentType: string, entityId: string): Promise<WorkflowLevelDecision[]> {
  const rows = await all<{ at: string; username: string | null; detail: string | null }>(
    `SELECT at, username, detail FROM audit_log
     WHERE action = 'WORKFLOW_TASK_LEVEL_APPROVE' AND entity = ? AND entity_id = ?
     ORDER BY at, id`,
    documentType, entityId,
  );
  const decisions: WorkflowLevelDecision[] = [];
  for (const r of rows) {
    if (!r.detail) continue;
    try {
      const parsed = JSON.parse(r.detail) as { taskId?: number; sequence?: number; comment?: string | null };
      if (parsed.taskId !== taskId) continue;
      decisions.push({
        sequence: Number(parsed.sequence) || 0, decided_by: r.username || '—', decided_at: r.at,
        comment: parsed.comment ?? null,
      });
    } catch {
      // Malformed detail on an old/foreign audit row — skip it rather than break the trail.
    }
  }
  return decisions;
}

/** Every task a document has ever been routed through, oldest first — a multi-step
 *  workflow produces one row per step, each with its own sender and (once acted on)
 *  its own decider. A document's Audit Trail tab renders this as its approval history:
 *  `pending_with` tells the requester who a still-open step is currently sitting with, and
 *  `level_decisions` fills in a group-sequence step's already-cleared levels, which the task
 *  row alone can't show (see listLevelDecisions() above). */
export async function listWorkflowTasksForDocument(
  documentType: WorkflowDocumentType, entityId: string,
): Promise<WorkflowTaskWithApprover[]> {
  const tasks = await all<WorkflowTask>(
    'SELECT * FROM workflow_task WHERE document_type=? AND entity_id=? ORDER BY requested_at, id',
    documentType, String(entityId),
  );
  return Promise.all(tasks.map(async (t) => ({
    ...t,
    pending_with: await describePendingWith(t),
    level_decisions: t.assigned_to_group_id ? await listLevelDecisions(t.id, documentType, entityId) : [],
  })));
}

export interface DecideResult { finalized: boolean; approved: boolean }

/** Act on a routed (workflow_id set) task — authorization is by assignment, not a raw permission. */
export async function decideWorkflowTask(
  taskId: number, decision: boolean, comment: string | null, actingUser: Actor,
): Promise<DecideResult> {
  const task = await one<WorkflowTask>('SELECT * FROM workflow_task WHERE id = ?', taskId);
  if (!task) throw new AppError('Approval task not found', 'NOT_FOUND');
  if (task.status !== 'PENDING') throw new AppError('This item has already been decided', 'BAD_STATUS');
  if (!task.workflow_id) throw new AppError('This item is not routed through a workflow', 'NOT_ROUTED');
  if (!(await isEligibleApprover(task, actingUser.id))) {
    throw new AppError('You are not the assigned approver for this item', 'NOT_ASSIGNED');
  }

  return tx(async () => {
    // A group task with more sequence levels above this one: this approval only
    // clears the current level — the rest of that level drops out, and the task
    // stays PENDING for the next level's members. The step itself doesn't move.
    // Any delegation was specific to the level that just cleared, so it lapses too.
    if (decision && task.assigned_to_group_id && task.current_sequence != null) {
      const nextSequenceLevel = await nextGroupSequence(task.assigned_to_group_id, task.current_sequence);
      if (nextSequenceLevel != null) {
        await run(
          'UPDATE workflow_task SET current_sequence = ?, delegated_by_user_id = NULL, delegated_to_user_id = NULL WHERE id = ?',
          nextSequenceLevel, taskId,
        );
        // The task row itself only ever holds the *final* decision (decided_by/decided_at/
        // comment), since a group-sequence step advances by mutating current_sequence in place
        // rather than inserting a new task per level. Without this, who cleared level 1 (and
        // when, with what comment) would be lost the moment the task moves to level 2 — so it's
        // logged here and reconstructed by listWorkflowTasksForDocument() for the document's own
        // Approval Details trail, not just the admin-only system audit log.
        await audit(
          actingUser, 'WORKFLOW_TASK_LEVEL_APPROVE', task.document_type, task.entity_id,
          { taskId, sequence: task.current_sequence, nextSequence: nextSequenceLevel, comment },
        );

        // The requester alone occupies the new level — no one else could ever clear it, so
        // don't leave their own request pending on themselves; cascade straight through.
        const requesterId = await userIdByUsername(task.requested_by);
        if (requesterId != null && await requesterClearsLevel(task.assigned_to_group_id, nextSequenceLevel, null, requesterId)) {
          return decideWorkflowTask(taskId, true, AUTO_APPROVE_COMMENT, { id: requesterId, username: task.requested_by });
        }

        const nextRecipients = await eligibleUserIds({
          assigned_to_user_id: null, assigned_to_group_id: task.assigned_to_group_id, current_sequence: nextSequenceLevel,
          delegated_by_user_id: null, delegated_to_user_id: null, requested_by: task.requested_by,
        });
        const step = task.workflow_step_id
          ? await one<{ notify_email: number }>('SELECT notify_email FROM workflow_step WHERE id = ?', task.workflow_step_id)
          : null;
        await notifyApprovers(task.document_type, task.entity_id, task.requested_by, nextRecipients, !!step?.notify_email);
        return { finalized: false, approved: true };
      }
    }

    await run(
      'UPDATE workflow_task SET status=?, decided_by=?, decided_at=?, comment=? WHERE id=?',
      decision ? 'APPROVED' : 'REJECTED', actingUser.username, new Date().toISOString(), comment, taskId,
    );
    await audit(actingUser, decision ? 'WORKFLOW_TASK_APPROVE' : 'WORKFLOW_TASK_REJECT', task.document_type, task.entity_id, { comment });

    if (!decision) {
      await finalizeDocument(task, false, actingUser, comment);
      await notifyRequester(task, false, actingUser.username, comment);
      return { finalized: true, approved: false };
    }

    const nextStep = await one<WorkflowStep>(
      'SELECT * FROM workflow_step WHERE workflow_id = ? AND step_no = ?', task.workflow_id, task.step_no + 1,
    );
    if (nextStep) {
      await createTaskForStep(task.workflow_id!, nextStep, {
        documentType: task.document_type, entityId: task.entity_id, requestedBy: task.requested_by,
        amount: task.amount, payload: task.payload,
      });
      return { finalized: false, approved: true };
    }

    await finalizeDocument(task, true, actingUser, comment);
    await notifyRequester(task, true, actingUser.username, comment);
    return { finalized: true, approved: true };
  });
}

/** Who a delegation would hand the task to, and how that person was arrived at. */
export interface DelegateTarget {
  userId: number;
  username: string;
  name: string;
  /** Which link of the chain produced them — surfaced so the acting user isn't guessing. */
  via: 'substitute' | 'approver' | 'administrator';
}

/**
 * Who a pending task hands off to, resolved the way Business Central's
 * `SubstituteUserIdForApprovalEntry` does: the current approver's **Substitute**, failing that
 * their **Approver**, failing that any **Approval Administrator**. Null when the whole chain
 * yields nobody — BC errors at that point too, and so does delegateWorkflowTask() below.
 *
 * Only active users qualify: delegating to a disabled account would strand the document.
 */
export async function resolveDelegateTarget(currentApproverId: number): Promise<DelegateTarget | null> {
  const named = async (id: number | null | undefined, via: DelegateTarget['via']): Promise<DelegateTarget | null> => {
    if (!id || id === currentApproverId) return null;
    const u = await one<{ id: number; username: string; full_name: string | null }>(
      "SELECT id, username, full_name FROM app_user WHERE id = ? AND status = 'ACTIVE'", id,
    );
    return u ? { userId: u.id, username: u.username, name: u.full_name || u.username, via } : null;
  };

  const setup = await one<{ substitute_id: number | null; approver_id: number | null }>(
    'SELECT substitute_id, approver_id FROM approval_user_setup WHERE user_id = ?', currentApproverId,
  );
  return (await named(setup?.substitute_id, 'substitute'))
    ?? (await named(setup?.approver_id, 'approver'))
    ?? (await named(
      (await one<{ user_id: number }>(
        `SELECT s.user_id FROM approval_user_setup s JOIN app_user u ON u.id = s.user_id
         WHERE s.is_approval_administrator = 1 AND s.user_id <> ? AND u.status = 'ACTIVE'
         ORDER BY s.user_id LIMIT 1`,
        currentApproverId,
      ))?.user_id,
      'administrator',
    ));
}

/** The user a pending task currently sits with — the person a delegation resolves from. */
const currentApproverOf = (task: WorkflowTask, actingUserId: number): number =>
  task.delegated_to_user_id ?? task.assigned_to_user_id ?? actingUserId;

/**
 * Whether `userId` may delegate this task — mirrors Business Central, where the Delegate action
 * on Requests to Approve is open to the approver the request sits with AND to an approval
 * administrator (who is how a request gets moving again when its approver is away and set no
 * substitute of their own).
 */
export async function canDelegateTask(task: WorkflowTask, userId: number): Promise<boolean> {
  if (task.status !== 'PENDING' || !task.workflow_id) return false;
  if (await isEligibleApprover(task, userId)) return true;
  const admin = await one<{ user_id: number }>(
    'SELECT user_id FROM approval_user_setup WHERE user_id = ? AND is_approval_administrator = 1', userId,
  );
  return !!admin;
}

/**
 * Hands a pending task off to the current approver's substitute — Business Central's Delegate
 * action, including its fallback chain (see resolveDelegateTarget()).
 *
 * The delegator loses eligibility on this task; the delegate gains it, until the task is decided
 * or (for a sequenced group) its level moves on. Returns who it went to, so the caller can say so
 * rather than leaving the user to go and look.
 */
export async function delegateWorkflowTask(taskId: number, actingUser: Actor): Promise<DelegateTarget> {
  const task = await one<WorkflowTask>('SELECT * FROM workflow_task WHERE id = ?', taskId);
  if (!task) throw new AppError('Approval task not found', 'NOT_FOUND');
  if (task.status !== 'PENDING') throw new AppError('This item has already been decided', 'BAD_STATUS');
  if (!task.workflow_id) throw new AppError('This item is not routed through a workflow', 'NOT_ROUTED');
  if (!(await canDelegateTask(task, actingUser.id))) {
    throw new AppError(
      'Only the approver this item is with — or an Approval Administrator — can delegate it.',
      'NOT_ASSIGNED',
    );
  }

  const from = currentApproverOf(task, actingUser.id);
  const target = await resolveDelegateTarget(from);
  if (!target) {
    throw new AppError(
      'There is no one to delegate this to. Set a Substitute or an Approver for the current '
      + 'approver in Admin Centre → System Security → User Setup, or flag someone as an '
      + 'Approval Administrator.',
      'NO_SUBSTITUTE',
    );
  }

  await run(
    'UPDATE workflow_task SET delegated_by_user_id = ?, delegated_to_user_id = ? WHERE id = ?',
    from, target.userId, taskId,
  );
  await audit(actingUser, 'WORKFLOW_TASK_DELEGATE', task.document_type, task.entity_id, {
    taskId, from, to: target.userId, via: target.via,
  });
  await notifyApprovers(task.document_type, task.entity_id, actingUser.username, [target.userId], true);
  return target;
}

/* --------------------------------------------------------------- worklists */

async function decorateTasks(rows: WorkflowTask[]): Promise<WorkflowTaskRow[]> {
  const workflowIds = [...new Set(rows.map((r) => r.workflow_id).filter((x): x is number => x != null))];
  const workflows = workflowIds.length
    ? await all<{ id: number; name: string }>(
      `SELECT id, name FROM workflow WHERE id IN (${workflowIds.map(() => '?').join(',')})`, ...workflowIds,
    )
    : [];
  const nameById = new Map(workflows.map((w) => [w.id, w.name]));
  return rows.map((r) => ({
    ...r,
    workflow_name: r.workflow_id ? nameById.get(r.workflow_id) ?? null : null,
    document_label: documentLabel(r.document_type, r.entity_id),
    link: DOCUMENT_LINK[r.document_type](r.entity_id),
  }));
}

/** The Approvals page's dynamic-filter registry — every meaningful column across its three
 *  tabs (Open/History/Sent). Legacy (unrouted) tasks are out of scope everywhere on this page —
 *  every document type now requires a matching workflow to even be submitted, so `workflow_id`
 *  is never null for anything a user would still need to act on. */
export const WORKFLOW_TASK_FILTER_FIELDS: FilterFieldDef[] = [
  { key: 'entity_id', label: 'Document No.', type: 'text', column: 't.entity_id' },
  {
    key: 'document_type', label: 'Document Type', type: 'select', column: 't.document_type',
    options: (Object.keys(DOCUMENT_TYPE_LABELS) as WorkflowDocumentType[])
      .map((k) => ({ value: k, label: DOCUMENT_TYPE_LABELS[k] })),
  },
  { key: 'amount', label: 'Amount', type: 'number', column: 't.amount' },
  { key: 'requested_by', label: 'Requested By', type: 'text', column: 't.requested_by' },
  { key: 'requested_at', label: 'Requested', type: 'date', column: 't.requested_at', datetime: true },
  {
    key: 'status', label: 'Status', type: 'select', column: 't.status',
    options: [
      { value: 'PENDING', label: 'Pending' }, { value: 'APPROVED', label: 'Approved' },
      { value: 'REJECTED', label: 'Rejected' }, { value: 'CANCELLED', label: 'Cancelled' },
    ],
  },
  { key: 'decided_by', label: 'Decided By', type: 'text', column: 't.decided_by' },
  { key: 'decided_at', label: 'Decided', type: 'date', column: 't.decided_at', datetime: true },
  { key: 'comment', label: 'Comment', type: 'text', column: 't.comment' },
];

const WORKFLOW_TASK_SORT_COLUMNS: Record<string, string> = {
  entity_id: 't.entity_id',
  document_type: 't.document_type',
  amount: 't.amount',
  requested_by: 't.requested_by',
  requested_at: 't.requested_at',
  status: 't.status',
  decided_by: 't.decided_by',
  decided_at: 't.decided_at',
};

export interface ListWorkflowTaskOptions {
  search?: string;
  filters?: FilterCondition[];
  sort?: SortState | null;
}

const SEARCHABLE = '(t.entity_id ILIKE @like OR t.requested_by ILIKE @like OR t.decided_by ILIKE @like)';

/** Pending tasks I may act on: assigned to me directly, as someone's substitute, or via a
 *  group — the Approvals page's "Open Approval Requests" tab. `username` excludes my own group
 *  membership from a level I share with someone else on a request I sent myself — the same
 *  exception isEligibleApprover()/eligibleUserIds() enforce, kept in lockstep here so a self-
 *  submitted request never shows up as something to act on that a click would then just refuse
 *  (see requesterClearsLevel()). */
export async function listMyWorkflowTasks(
  userId: number, username: string, { search = '', filters = [], sort = null }: ListWorkflowTaskOptions = {},
): Promise<WorkflowTaskRow[]> {
  const { clause, params } = buildFilterClause(WORKFLOW_TASK_FILTER_FIELDS, filters);
  const orderBy = buildOrderClause(WORKFLOW_TASK_SORT_COLUMNS, sort, 't.requested_at DESC');
  const rows = await all<WorkflowTask>(
    `SELECT DISTINCT t.* FROM workflow_task t
     LEFT JOIN approval_user_setup su ON su.user_id = t.assigned_to_user_id AND su.substitute_id = @uid
     LEFT JOIN workflow_user_group_member gm
       ON gm.group_id = t.assigned_to_group_id AND gm.user_id = @uid AND gm.sequence = t.current_sequence
       AND NOT (
         t.requested_by = @username AND EXISTS (
           SELECT 1 FROM workflow_user_group_member gm2
           WHERE gm2.group_id = t.assigned_to_group_id AND gm2.sequence = t.current_sequence AND gm2.user_id != @uid
         )
       )
     WHERE t.status = 'PENDING' AND t.workflow_id IS NOT NULL
       AND t.delegated_by_user_id IS DISTINCT FROM @uid
       AND (t.assigned_to_user_id = @uid OR su.user_id IS NOT NULL OR gm.user_id IS NOT NULL OR t.delegated_to_user_id = @uid)
       AND ${SEARCHABLE}
       ${clause}
     ${orderBy}`,
    { uid: userId, username, like: `%${search.trim()}%`, ...params },
  );
  return decorateTasks(rows);
}

/** Every decision I've personally made — the Approvals page's "History" tab. Each task row
 *  already belongs to exactly the one step whoever decided it actually decided, so (unlike
 *  listMySubmittedWorkflowTasks below) there's no multi-step de-duplication to do here. */
export async function listMyDecidedWorkflowTasks(
  username: string, { search = '', filters = [], sort = null }: ListWorkflowTaskOptions = {},
): Promise<WorkflowTaskRow[]> {
  const { clause, params } = buildFilterClause(WORKFLOW_TASK_FILTER_FIELDS, filters);
  const orderBy = buildOrderClause(WORKFLOW_TASK_SORT_COLUMNS, sort, 't.decided_at DESC');
  const rows = await all<WorkflowTask>(
    `SELECT t.* FROM workflow_task t
     WHERE t.decided_by = @username AND t.status != 'PENDING' AND t.workflow_id IS NOT NULL
       AND ${SEARCHABLE}
       ${clause}
     ${orderBy}`,
    { username, like: `%${search.trim()}%`, ...params },
  );
  return decorateTasks(rows);
}

/** Every request I've ever sent for approval — the Approvals page's "Sent" tab. A multi-step
 *  workflow produces one workflow_task row per step, all carrying the same original
 *  requested_by, so this collapses to just the latest (current) step per document — one row
 *  per actual request, showing where it stands now, not one row per internal routing hop. */
export async function listMySubmittedWorkflowTasks(
  username: string, { search = '', filters = [], sort = null }: ListWorkflowTaskOptions = {},
): Promise<WorkflowTaskRow[]> {
  const { clause, params } = buildFilterClause(WORKFLOW_TASK_FILTER_FIELDS, filters);
  const orderBy = buildOrderClause(WORKFLOW_TASK_SORT_COLUMNS, sort, 't.requested_at DESC');
  const rows = await all<WorkflowTask>(
    `SELECT t.* FROM workflow_task t
     WHERE t.requested_by = @username AND t.workflow_id IS NOT NULL
       AND t.id = (
         SELECT MAX(t2.id) FROM workflow_task t2
         WHERE t2.document_type = t.document_type AND t2.entity_id = t.entity_id AND t2.requested_by = @username
       )
       AND ${SEARCHABLE}
       ${clause}
     ${orderBy}`,
    { username, like: `%${search.trim()}%`, ...params },
  );
  return decorateTasks(rows);
}

/** Org-wide pending task count, for the Dashboard's own KPI — not scoped to a user. */
export const pendingWorkflowTaskCount = async (): Promise<number> =>
  (await one<{ c: number }>("SELECT COUNT(*) c FROM workflow_task WHERE status = 'PENDING'"))!.c;

/**
 * Pending tasks this specific user may actually act on — the exact same scope as the Approvals
 * page's "Open Approval Requests" tab (listMyWorkflowTasks), as a COUNT rather than full
 * decorated rows, since this runs on every page load for the sidebar's Approvals badge.
 * Deliberately not the org-wide count: a badge showing every pending approval in the system
 * regardless of who can act on it just trains people to ignore it.
 */
export async function myPendingWorkflowTaskCount(userId: number, username: string): Promise<number> {
  const row = await one<{ c: number }>(
    `SELECT COUNT(DISTINCT t.id) c FROM workflow_task t
     LEFT JOIN approval_user_setup su ON su.user_id = t.assigned_to_user_id AND su.substitute_id = ?
     LEFT JOIN workflow_user_group_member gm
       ON gm.group_id = t.assigned_to_group_id AND gm.user_id = ? AND gm.sequence = t.current_sequence
       AND NOT (
         t.requested_by = ? AND EXISTS (
           SELECT 1 FROM workflow_user_group_member gm2
           WHERE gm2.group_id = t.assigned_to_group_id AND gm2.sequence = t.current_sequence AND gm2.user_id != ?
         )
       )
     WHERE t.status = 'PENDING' AND t.workflow_id IS NOT NULL
       AND t.delegated_by_user_id IS DISTINCT FROM ?
       AND (t.assigned_to_user_id = ? OR su.user_id IS NOT NULL OR gm.user_id IS NOT NULL OR t.delegated_to_user_id = ?)`,
    userId, userId, username, userId, userId, userId, userId,
  );
  return row?.c ?? 0;
}

/** Whether the History tab (everything I've personally decided) has any rows at all, ignoring
 *  search and dynamic filters — lets the page grey out its filter controls only when there's
 *  truly nothing to filter. Same scope as listMyDecidedWorkflowTasks(). */
export const hasAnyDecidedWorkflowTasks = (username: string): Promise<boolean> =>
  hasAnyRow('workflow_task t', "t.decided_by = ? AND t.status != 'PENDING' AND t.workflow_id IS NOT NULL", username);

/** Whether the Sent tab (everything I've ever sent for approval) has any rows at all, ignoring
 *  search and dynamic filters. Same scope as listMySubmittedWorkflowTasks(). */
export const hasAnySubmittedWorkflowTasks = (username: string): Promise<boolean> =>
  hasAnyRow('workflow_task t', 't.requested_by = ? AND t.workflow_id IS NOT NULL', username);

/* ------------------------------------------------------------- admin: workflows */

export interface WorkflowInput {
  name?: string;
  document_type?: string;
  enabled?: Flag | null;
}

export interface ConditionDraft {
  field: string;
  operator: WorkflowConditionOperator;
  value: string;
  value2?: string | null;
}

export interface StepDraft {
  approver_type: WorkflowApproverType;
  approver_user_id?: number | null;
  approver_group_id?: number | null;
  notify_email?: number;
}

export const listWorkflows = (): Promise<WorkflowWithDetail[]> => withDetail(
  all<Workflow>('SELECT * FROM workflow ORDER BY id'),
);

async function withDetail(promise: Promise<Workflow[]>): Promise<WorkflowWithDetail[]> {
  const workflows = await promise;
  return Promise.all(workflows.map(async (w) => ({
    ...w,
    conditions: await all<WorkflowCondition>('SELECT * FROM workflow_condition WHERE workflow_id = ?', w.id),
    steps: await all<WorkflowStep>('SELECT * FROM workflow_step WHERE workflow_id = ? ORDER BY step_no', w.id),
  })));
}

async function replaceConditionsAndSteps(
  workflowId: number, conditions: ConditionDraft[], steps: StepDraft[],
): Promise<void> {
  await run('DELETE FROM workflow_condition WHERE workflow_id = ?', workflowId);
  await run('DELETE FROM workflow_step WHERE workflow_id = ?', workflowId);
  for (const c of conditions) {
    if (!c.field || !c.operator || c.value === undefined || c.value === '') continue;
    await run(
      'INSERT INTO workflow_condition (workflow_id, field, operator, value, value2) VALUES (?,?,?,?,?)',
      workflowId, c.field, c.operator, c.value, c.value2 || null,
    );
  }
  let stepNo = 1;
  for (const s of steps) {
    if (!s.approver_type) continue;
    if (s.approver_type === 'USER' && !s.approver_user_id) continue;
    if (s.approver_type === 'USER_GROUP' && !s.approver_group_id) continue;
    await run(
      `INSERT INTO workflow_step (workflow_id, step_no, approver_type, approver_user_id, approver_group_id, notify_email)
       VALUES (?,?,?,?,?,?)`,
      workflowId, stepNo++, s.approver_type, s.approver_user_id || null, s.approver_group_id || null,
      s.notify_email ? 1 : 0,
    );
  }
}

/** The steps replaceConditionsAndSteps() will actually persist — anything short of a fully
 *  picked approver is silently dropped there, so an "enabled" workflow whose only step is
 *  incomplete would otherwise save with zero real steps. */
const validStepCount = (steps: StepDraft[]): number => steps.filter((s) => (
  s.approver_type
  && !(s.approver_type === 'USER' && !s.approver_user_id)
  && !(s.approver_type === 'USER_GROUP' && !s.approver_group_id)
)).length;

const requireStepsIfEnabled = (enabled: Flag, steps: StepDraft[]): void => {
  if (enabled && !validStepCount(steps)) {
    throw new AppError('An enabled workflow needs at least one approval step', 'VALIDATION');
  }
};

export async function createWorkflow(
  body: WorkflowInput, conditions: ConditionDraft[], steps: StepDraft[], user: Actor,
): Promise<{ id: number }> {
  if (!body.name || !body.document_type) throw new AppError('Name and document type are required', 'VALIDATION');
  await assertDocumentType(body.document_type, await listWorkflowDocumentTypes());
  const enabled = body.enabled ?? 1;
  requireStepsIfEnabled(enabled, steps);
  return tx(async () => {
    const info = await run(
      'INSERT INTO workflow (name, document_type, enabled, created_at, created_by) VALUES (?,?,?,?,?)',
      body.name, body.document_type, enabled, new Date().toISOString(), user.username,
    );
    const id = Number(info.lastInsertRowid);
    await replaceConditionsAndSteps(id, conditions, steps);
    await audit(user, 'WORKFLOW_CREATE', 'workflow', id, { name: body.name });
    return { id };
  });
}

export async function updateWorkflow(
  id: number, body: WorkflowInput, conditions: ConditionDraft[], steps: StepDraft[], user: Actor,
): Promise<{ id: number }> {
  if (body.document_type) await assertDocumentType(body.document_type, await listWorkflowDocumentTypes());
  return tx(async () => {
    const enabled = body.enabled ?? (await one<Workflow>('SELECT enabled FROM workflow WHERE id = ?', id))?.enabled ?? 0;
    requireStepsIfEnabled(enabled, steps);
    await run(
      'UPDATE workflow SET name=COALESCE(?,name), document_type=COALESCE(?,document_type), enabled=COALESCE(?,enabled) WHERE id=?',
      body.name ?? null, body.document_type ?? null, body.enabled ?? null, id,
    );
    await replaceConditionsAndSteps(id, conditions, steps);
    await audit(user, 'WORKFLOW_UPDATE', 'workflow', id, { name: body.name });
    return { id };
  });
}

/* ------------------------------------------------------- admin: user groups */

export const listWorkflowUserGroups = (): Promise<WorkflowUserGroupWithUsage[]> =>
  all<WorkflowUserGroupWithUsage>(
    `SELECT g.*, COUNT(m.id) AS members FROM workflow_user_group g
     LEFT JOIN workflow_user_group_member m ON m.group_id = g.id
     GROUP BY g.id ORDER BY g.name`,
  );

export const listWorkflowUserGroupMembers = (groupId: number): Promise<WorkflowUserGroupMemberRow[]> =>
  all<WorkflowUserGroupMemberRow>(
    'SELECT user_id, sequence FROM workflow_user_group_member WHERE group_id = ? ORDER BY sequence, user_id', groupId,
  );

export interface WorkflowUserGroupInput {
  name?: string;
  status?: string | null;
}

export interface GroupMemberDraft {
  user_id: number;
  sequence?: number;
}

async function replaceGroupMembers(groupId: number, members: GroupMemberDraft[]): Promise<void> {
  await run('DELETE FROM workflow_user_group_member WHERE group_id = ?', groupId);
  const byUser = new Map(members.map((m) => [m.user_id, m.sequence || 1]));
  for (const [userId, sequence] of byUser) {
    await run(
      'INSERT INTO workflow_user_group_member (group_id, user_id, sequence) VALUES (?,?,?)', groupId, userId, sequence,
    );
  }
}

export async function createWorkflowUserGroup(
  body: WorkflowUserGroupInput, members: GroupMemberDraft[], user: Actor,
): Promise<{ id: number }> {
  if (!body.name) throw new AppError('Group name is required', 'VALIDATION');
  return tx(async () => {
    if (await one('SELECT 1 FROM workflow_user_group WHERE name = ?', body.name)) {
      throw new AppError('That group already exists', 'DUPLICATE');
    }
    const info = await run(
      'INSERT INTO workflow_user_group (name, status) VALUES (?,?)', body.name, body.status || 'ACTIVE',
    );
    const id = Number(info.lastInsertRowid);
    await replaceGroupMembers(id, members);
    await audit(user, 'WORKFLOW_GROUP_CREATE', 'workflow_user_group', id, { name: body.name });
    return { id };
  });
}

export async function updateWorkflowUserGroup(
  id: number, body: WorkflowUserGroupInput, members: GroupMemberDraft[], user: Actor,
): Promise<{ id: number }> {
  return tx(async () => {
    await run(
      'UPDATE workflow_user_group SET name=COALESCE(?,name), status=COALESCE(?,status) WHERE id=?',
      body.name ?? null, body.status ?? null, id,
    );
    await replaceGroupMembers(id, members);
    await audit(user, 'WORKFLOW_GROUP_UPDATE', 'workflow_user_group', id, { name: body.name });
    return { id };
  });
}

/* ------------------------------------------------------ admin: approval user setup */

export const listApprovalUserSetup = (): Promise<ApprovalUserSetupRow[]> =>
  all<ApprovalUserSetupRow>(
    `SELECT u.id AS user_id, u.username, u.full_name, u.signature_image,
            s.approver_id, a.full_name AS approver_name,
            s.substitute_id, sub.full_name AS substitute_name,
            COALESCE(s.is_approval_administrator, 0) AS is_approval_administrator,
            COALESCE(s.can_reverse_journal, 0) AS can_reverse_journal,
            s.allow_posting_from, s.allow_posting_to,
            s.allow_posting_from_time, s.allow_posting_to_time,
            s.employee_id, e.employee_no, CASE WHEN e.id IS NULL THEN NULL ELSE e.first_name || ' ' || e.last_name END AS employee_name,
            COALESCE(s.is_teacher, 0) AS is_teacher,
            s.student_id, CASE WHEN st.id IS NULL THEN NULL ELSE st.admission_no || ' — ' || st.first_name || ' ' || st.last_name END AS student_name,
            s.guardian_id, g.full_name AS guardian_name
     FROM app_user u
     LEFT JOIN approval_user_setup s ON s.user_id = u.id
     LEFT JOIN app_user a ON a.id = s.approver_id
     LEFT JOIN app_user sub ON sub.id = s.substitute_id
     LEFT JOIN employee e ON e.id = s.employee_id
     LEFT JOIN student st ON st.id = s.student_id
     LEFT JOIN guardian g ON g.id = s.guardian_id
     ORDER BY u.full_name`,
  );

export interface ApprovalUserSetupInput {
  approver_id?: number | null;
  substitute_id?: number | null;
  is_approval_administrator?: number;
  can_reverse_journal?: number;
  allow_posting_from?: string | null;
  allow_posting_to?: string | null;
  allow_posting_from_time?: string | null;
  allow_posting_to_time?: string | null;
  /** AL User Setup "Employee No." — which employee this login is. */
  employee_id?: number | null;
  /** Teaching staff: the Teacher Portal shows inside Employee Self Service. Needs an employee. */
  is_teacher?: Flag | boolean | null;
  /** A student or guardian login — the Student / Parent portal's subject. One login per record. */
  student_id?: number | null;
  guardian_id?: number | null;
}

export async function saveApprovalUserSetup(
  userId: number, body: ApprovalUserSetupInput, user: Actor,
): Promise<void> {
  if (body.allow_posting_from && body.allow_posting_to && body.allow_posting_from > body.allow_posting_to) {
    throw new AppError('Allow Posting From cannot be after Allow Posting To', 'VALIDATION');
  }
  // One login per employee: AL looks the User Setup up *by* Employee No. (leave applications,
  // recalls, ...), which only works when the mapping is one-to-one.
  const employeeId = body.employee_id || null;
  if (employeeId) {
    const emp = await one<{ id: number; email: string | null; phone: string | null }>('SELECT id, email, phone FROM employee WHERE id = ?', employeeId);
    if (!emp) throw new AppError('Employee not found', 'NOT_FOUND');
    const taken = await one<{ user_id: number; username: string }>(
      'SELECT s.user_id, u.username FROM approval_user_setup s JOIN app_user u ON u.id = s.user_id WHERE s.employee_id = ? AND s.user_id <> ?',
      employeeId, userId,
    );
    if (taken) throw new AppError(`That employee is already linked to user ${taken.username}`, 'DUPLICATE');
    // AL's OnValidate copies the employee's company e-mail and phone onto the User Setup; here
    // the user record carries them, so only blanks are filled — a deliberately typed contact
    // is never overwritten.
    await run(
      'UPDATE app_user SET email = COALESCE(NULLIF(email, \'\'), ?), phone = COALESCE(NULLIF(phone, \'\'), ?) WHERE id = ?',
      emp.email || null, emp.phone || null, userId,
    );
  }
  const isTeacher = !!body.is_teacher;
  if (isTeacher && !employeeId) throw new AppError('A teacher login must be matched to an employee first (Employee No.)', 'VALIDATION');
  // The portal subjects are one-to-one too: a student or guardian has one login.
  const studentId = body.student_id || null;
  const guardianId = body.guardian_id || null;
  if (studentId && guardianId) throw new AppError('A login is either a student or a guardian, not both', 'VALIDATION');
  if (studentId) {
    if (!(await hasAnyRow('student', 'id = ?', studentId))) throw new AppError('Student not found', 'NOT_FOUND');
    const taken = await one<{ username: string }>('SELECT u.username FROM approval_user_setup s JOIN app_user u ON u.id = s.user_id WHERE s.student_id = ? AND s.user_id <> ?', studentId, userId);
    if (taken) throw new AppError(`That student is already linked to user ${taken.username}`, 'DUPLICATE');
  }
  if (guardianId) {
    if (!(await hasAnyRow('guardian', 'id = ?', guardianId))) throw new AppError('Guardian not found', 'NOT_FOUND');
    const taken = await one<{ username: string }>('SELECT u.username FROM approval_user_setup s JOIN app_user u ON u.id = s.user_id WHERE s.guardian_id = ? AND s.user_id <> ?', guardianId, userId);
    if (taken) throw new AppError(`That guardian is already linked to user ${taken.username}`, 'DUPLICATE');
  }
  await run(
    `INSERT INTO approval_user_setup
       (user_id, approver_id, substitute_id, is_approval_administrator, can_reverse_journal,
        allow_posting_from, allow_posting_to, allow_posting_from_time, allow_posting_to_time, employee_id, is_teacher, student_id, guardian_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (user_id) DO UPDATE SET
       approver_id = EXCLUDED.approver_id,
       substitute_id = EXCLUDED.substitute_id,
       is_approval_administrator = EXCLUDED.is_approval_administrator,
       can_reverse_journal = EXCLUDED.can_reverse_journal,
       allow_posting_from = EXCLUDED.allow_posting_from,
       allow_posting_to = EXCLUDED.allow_posting_to,
       allow_posting_from_time = EXCLUDED.allow_posting_from_time,
       allow_posting_to_time = EXCLUDED.allow_posting_to_time,
       employee_id = EXCLUDED.employee_id,
       is_teacher = EXCLUDED.is_teacher,
       student_id = EXCLUDED.student_id,
       guardian_id = EXCLUDED.guardian_id`,
    userId, body.approver_id || null, body.substitute_id || null,
    body.is_approval_administrator ? 1 : 0, body.can_reverse_journal ? 1 : 0,
    body.allow_posting_from || null, body.allow_posting_to || null,
    body.allow_posting_from_time || null, body.allow_posting_to_time || null,
    employeeId, isTeacher ? 1 : 0, studentId, guardianId,
  );
  // A teacher login is teaching staff: make sure the academics office sees them under Teaching
  // Staff (subject assignments hang off the profile) without a second trip to that screen.
  if (isTeacher && employeeId) {
    await run('INSERT INTO teacher_profile (employee_id) VALUES (?) ON CONFLICT (employee_id) DO NOTHING', employeeId);
  }
  await audit(user, 'APPROVAL_USER_SETUP_SAVE', 'approval_user_setup', userId, body);
}

/** Whether `userId` is allowed to reverse a posted journal — a per-user grant in User Setup,
 *  separate from (and in addition to) whichever role-based permission governs the specific
 *  document being reversed (GL_JOURNAL_REVERSE, ...), since a reversal breaks
 *  the append-only posting trail and warrants an explicit, individually auditable grant rather
 *  than a blanket role right. Enforced once, centrally, in accounting.ts's reverseJournal() —
 *  every reversal path in the system posts its compensating entry through that one function, so
 *  checking it there covers GL and any future reversal alike. */
export async function canReverseJournal(userId: number): Promise<boolean> {
  const row = await one<{ can_reverse_journal: number }>(
    'SELECT can_reverse_journal FROM approval_user_setup WHERE user_id = ?', userId,
  );
  return (row?.can_reverse_journal ?? 0) > 0;
}
