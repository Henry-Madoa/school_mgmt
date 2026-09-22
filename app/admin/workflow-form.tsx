'use client';

import { useEffect, useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { saveWorkflow, getWorkflowConditionFields } from '@/app/actions/workflows';
import { CONDITION_OPERATORS, APPROVER_TYPES } from '@/lib/workflowConstants';
import type { DocumentFieldDef, DocumentFieldRelation } from '@/lib/workflowConstants';
import type {
  UserListRow, WorkflowUserGroupWithUsage, WorkflowWithDetail, DocumentTypeOption,
  WorkflowConditionOperator, WorkflowApproverType, County, DimensionValue,
} from '@/lib/types';

/** One option list per `DocumentFieldRelation` — whichever rows the caller has on hand for
 *  that lookup table. Missing/empty lists just fall back to a plain text input. */
interface RelationOptions {
  county?: County[];
  globalDimension1?: DimensionValue[];
  globalDimension2?: DimensionValue[];
}

const relationLabel = (relation: DocumentFieldRelation, row: { code?: string | null; name?: string; description?: string }) =>
  ('code' in row && row.code ? `${row.code} — ` : '') + (row.name ?? row.description ?? '');

interface ConditionRow {
  field: string;
  operator: WorkflowConditionOperator;
  value: string;
  value2: string;
}

interface StepRow {
  approver_type: WorkflowApproverType;
  approver_user_id: number | '';
  approver_group_id: number | '';
  notify_email: boolean;
}

const emptyCondition = (fields: DocumentFieldDef[]): ConditionRow => ({
  field: fields[0]?.key || '', operator: '>', value: '', value2: '',
});
const emptyStep = (): StepRow => ({ approver_type: 'USER', approver_user_id: '', approver_group_id: '', notify_email: true });

export function WorkflowFormButton({
  workflow, documentTypes, users, groups, county, globalDimension1, globalDimension2,
  dimensionCaption1 = 'Global Dimension 1', dimensionCaption2 = 'Global Dimension 2',
  className = 'btn', children,
}: {
  workflow?: WorkflowWithDetail | null;
  /** The live document-type picker — every wired business document type plus every other real
   *  table, read off lib/workflow.ts's listDocumentTypeOptions(), not hardcoded here. */
  documentTypes: DocumentTypeOption[];
  users: UserListRow[];
  groups: WorkflowUserGroupWithUsage[];
  /** The org's own labels for the two dimension slots (e.g. "Branch", "Cost Centre") — falls
   *  back to the generic name if the caller doesn't have them on hand. */
  dimensionCaption1?: string;
  dimensionCaption2?: string;
  className?: string;
  children: React.ReactNode;
} & RelationOptions) {
  const relationOptions: Record<DocumentFieldRelation, RelationOptions[DocumentFieldRelation]> = {
    county, globalDimension1, globalDimension2,
  };
  const fieldLabel = (f: { label: string; relation?: DocumentFieldRelation }) => (
    f.relation === 'globalDimension1' ? dimensionCaption1
      : f.relation === 'globalDimension2' ? dimensionCaption2
        : f.label
  );
  const [open, setOpen] = useState(false);
  const w = workflow ?? null;
  // A new workflow starts with no document type chosen — defaulting to the first of the list
  // (Admission Application) silently attaches the workflow to the wrong document when the author
  // moves straight on to the conditions. The field is required, so submit blocks until picked.
  const [documentType, setDocumentType] = useState<string>(w?.document_type || '');
  const [fields, setFields] = useState<DocumentFieldDef[]>([]);
  const [loadingFields, setLoadingFields] = useState(false);
  const [conditions, setConditions] = useState<ConditionRow[]>(() =>
    (w?.conditions || []).map((c) => ({
      field: c.field, operator: c.operator, value: c.value, value2: c.value2 || '',
    })));
  const [steps, setSteps] = useState<StepRow[]>(() =>
    (w?.steps || []).map((s) => ({
      approver_type: s.approver_type,
      approver_user_id: s.approver_user_id || '',
      approver_group_id: s.approver_group_id || '',
      notify_email: !!s.notify_email,
    })));

  // Loads the selected document type's condition fields fresh whenever the type changes (or the
  // modal opens) — read live off the real table (lib/workflow.ts's listConditionFieldDefs()), not
  // precomputed for every document type up front, since that set now spans every real table
  // rather than a fixed handful.
  useEffect(() => {
    if (!open || !documentType) { setFields([]); return; }
    let cancelled = false;
    setLoadingFields(true);
    getWorkflowConditionFields(documentType).then((res) => {
      if (cancelled) return;
      setFields(res.ok ? res.data : []);
      setLoadingFields(false);
    });
    return () => { cancelled = true; };
  }, [open, documentType]);

  const selectedType = documentTypes.find((t) => t.documentType === documentType);

  const updateCondition = (i: number, patch: Partial<ConditionRow>) =>
    setConditions((cur) => cur.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const removeCondition = (i: number) => setConditions((cur) => cur.filter((_, k) => k !== i));

  const updateStep = (i: number, patch: Partial<StepRow>) =>
    setSteps((cur) => cur.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const removeStep = (i: number) => setSteps((cur) => cur.filter((_, k) => k !== i));
  const moveStep = (i: number, dir: -1 | 1) =>
    setSteps((cur) => {
      const j = i + dir;
      if (j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          wide
          title={w ? `Edit ${w.name}` : 'Add a workflow'}
          onClose={() => setOpen(false)}
          onSubmit={(values) => saveWorkflow(
            w ? w.id : null,
            values,
            conditions.filter((c) => c.field && c.value !== ''),
            steps.map((s) => ({
              approver_type: s.approver_type,
              approver_user_id: s.approver_user_id || null,
              approver_group_id: s.approver_group_id || null,
              notify_email: s.notify_email ? 1 : 0,
            })),
          )}
          submitLabel="Save workflow"
          successTitle="Workflow saved"
        >
          <div className="grid g3">
            <Field name="name" label="Workflow name" defaultValue={w?.name} required maxLength={80} />
            <SearchableSelect name="document_type" label="Document type" required
              items={documentTypes} getValue={(t) => t.documentType}
              getLabel={(t) => (t.wired ? t.label : `${t.label} (not yet enforced)`)}
              value={documentType} onChange={setDocumentType}
              placeholder="Search document type…" emptyText="No matching document types" />
          </div>
          {w ? (
            <Field name="enabled" label="Enabled" type="checkbox" defaultValue={w.enabled} />
          ) : null}
          {selectedType && !selectedType.wired ? (
            <div className="tiny" style={{ marginTop: 4 }}>
              {selectedType.table} isn't wired into a submission flow yet — conditions and steps can be
              configured here, but no approval task will ever be created from it until that integration exists.
            </div>
          ) : null}

          <h4 className="section-title">Conditions</h4>
          <div className="card-sub">
            All conditions must match for this workflow to apply — leave empty to apply to every submission.
          </div>
          <table style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Field</th><th>Operator</th><th>Value</th><th>Value 2</th><th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {conditions.map((row, i) => {
                const relation = fields.find((f) => f.key === row.field)?.relation;
                const options = relation ? relationOptions[relation] : undefined;
                return (
                  <tr key={i}>
                    <td>
                      <select value={row.field} aria-label="Field"
                        onChange={(e) => updateCondition(i, { field: e.target.value, value: '', value2: '' })}>
                        {fields.map((f) => (
                          <option key={f.key} value={f.key}>{fieldLabel(f)}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select value={row.operator} aria-label="Operator"
                        onChange={(e) => updateCondition(i, { operator: e.target.value as WorkflowConditionOperator })}>
                        {CONDITION_OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </td>
                    <td>
                      {options ? (
                        <SearchableSelect<{ id: number; code?: string | null; name?: string; description?: string }>
                          name={`conditionValue${i}`} ariaLabel="Value"
                          items={options} getValue={(o) => String(o.id)}
                          getLabel={(o) => (relation ? relationLabel(relation, o) : '')}
                          value={row.value} onChange={(v) => updateCondition(i, { value: v })} />
                      ) : (
                        <input type="text" value={row.value} aria-label="Value"
                          onChange={(e) => updateCondition(i, { value: e.target.value })} />
                      )}
                    </td>
                    <td>
                      {row.operator === 'BETWEEN' ? (
                        options ? (
                          <SearchableSelect<{ id: number; code?: string | null; name?: string; description?: string }>
                            name={`conditionValue2_${i}`} ariaLabel="Value 2"
                            items={options} getValue={(o) => String(o.id)}
                            getLabel={(o) => (relation ? relationLabel(relation, o) : '')}
                            value={row.value2} onChange={(v) => updateCondition(i, { value2: v })} />
                        ) : (
                          <input type="text" value={row.value2} aria-label="Value 2"
                            onChange={(e) => updateCondition(i, { value2: e.target.value })} />
                        )
                      ) : null}
                    </td>
                    <td>
                      <button type="button" className="btn sm ghost" onClick={() => removeCondition(i)}
                        aria-label="Remove condition">×</button>
                    </td>
                  </tr>
                );
              })}
              {!conditions.length ? <tr><td colSpan={5} className="tiny">Applies to every submission.</td></tr> : null}
            </tbody>
          </table>
          <div className="inline" style={{ marginTop: 10 }}>
            {/* Until a document type is chosen there are no fields to condition on, so a new
                row would only ever be an empty one. */}
            <button type="button" className="btn ghost sm" disabled={loadingFields || !fields.length}
              onClick={() => setConditions((c) => [...c, emptyCondition(fields)])}>
              {loadingFields ? 'Loading fields…' : 'Add condition'}
            </button>
            {!documentType ? <span className="tiny">Select a document type first.</span> : null}
          </div>

          <h4 className="section-title">Approval steps</h4>
          <div className="card-sub">Executed in order — every step must approve before the document is finalised.</div>
          <table style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th style={{ width: 30 }}>#</th><th>Approver type</th><th>Approver</th>
                <th style={{ width: 90 }}>Email</th><th style={{ width: 90 }} />
              </tr>
            </thead>
            <tbody>
              {steps.map((row, i) => (
                <tr key={i}>
                  <td className="num">{i + 1}</td>
                  <td>
                    <select value={row.approver_type} aria-label="Approver type"
                      onChange={(e) => updateStep(i, { approver_type: e.target.value as WorkflowApproverType })}>
                      {APPROVER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </td>
                  <td>
                    {row.approver_type === 'USER' ? (
                      <SearchableSelect name={`stepApproverUser${i}`} ariaLabel="User"
                        items={users} getValue={(u) => String(u.id)} getLabel={(u) => u.full_name}
                        value={String(row.approver_user_id || '')}
                        onChange={(v) => updateStep(i, { approver_user_id: v ? Number(v) : '' })}
                        placeholder="Search user…" emptyText="No matching users" />
                    ) : row.approver_type === 'USER_GROUP' ? (
                      <SearchableSelect name={`stepApproverGroup${i}`} ariaLabel="Group"
                        items={groups} getValue={(g) => String(g.id)} getLabel={(g) => g.name}
                        value={String(row.approver_group_id || '')}
                        onChange={(v) => updateStep(i, { approver_group_id: v ? Number(v) : '' })}
                        placeholder="Search group…" emptyText="No matching groups" />
                    ) : (
                      <span className="tiny">Resolved from User Setup at request time</span>
                    )}
                  </td>
                  <td>
                    <div className="checkline">
                      <input type="checkbox" checked={row.notify_email} aria-label="Notify by email"
                        onChange={(e) => updateStep(i, { notify_email: e.target.checked })} />
                    </div>
                  </td>
                  <td className="num">
                    <button type="button" className="btn sm ghost" onClick={() => moveStep(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>{' '}
                    <button type="button" className="btn sm ghost" onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1} aria-label="Move down">↓</button>{' '}
                    <button type="button" className="btn sm ghost" onClick={() => removeStep(i)} aria-label="Remove step">×</button>
                  </td>
                </tr>
              ))}
              {!steps.length ? <tr><td colSpan={5} className="tiny">Add at least one step for this workflow to route anything.</td></tr> : null}
            </tbody>
          </table>
          <div className="inline" style={{ marginTop: 10 }}>
            <button type="button" className="btn ghost sm" onClick={() => setSteps((s) => [...s, emptyStep()])}>
              Add step
            </button>
          </div>
        </FormModal>
      ) : null}
    </>
  );
}
