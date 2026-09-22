'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { useRunAction } from '@/components/ui/run-action';
import { EmptyState, Pill } from '@/components/ui/primitives';
import { saveIncidentRequest, deleteIncidentRequest } from '@/app/actions/admissions';
import { formatDate, today } from '@/lib/format';
import type { StudentIncidentView, IncidentKind } from '@/lib/incidents';

const KINDS: { value: IncidentKind; label: string }[] = [
  { value: 'DISCIPLINE', label: 'Discipline' }, { value: 'MEDICAL', label: 'Medical / sick bay' }, { value: 'EXEAT', label: 'Exeat / leave-out' }, { value: 'NOTE', label: 'Note' },
];
const kindLabel = (k: string) => KINDS.find((x) => x.value === k)?.label ?? k;
const kindTone = (k: string) => (k === 'DISCIPLINE' ? 'bad' : k === 'MEDICAL' ? 'warn' : k === 'EXEAT' ? 'info' : undefined) as 'bad' | 'warn' | 'info' | undefined;

function IncidentFields({ i }: { i?: StudentIncidentView | null }) {
  const [kind, setKind] = useState<string>(i?.kind ?? 'DISCIPLINE');
  return (
    <>
      <div className="grid g3">
        <Field name="kind" label="Kind" type="select" required defaultValue={kind} options={KINDS} onChange={(e) => setKind(e.target.value)} />
        <Field name="date" label="Date" type="date" required defaultValue={i?.date ?? today()} />
        <Field name="follow_up" label={kind === 'EXEAT' ? 'Expected back' : kind === 'MEDICAL' ? 'Review date' : 'Follow-up date'} type="date" defaultValue={i?.follow_up} />
      </div>
      <Field name="title" label="Title" required defaultValue={i?.title} placeholder={kind === 'EXEAT' ? 'e.g. Weekend exeat — family function' : kind === 'MEDICAL' ? 'e.g. Sick bay — fever' : 'e.g. Late for prep'} />
      <Field name="details" label="Details" type="textarea" rows={3} defaultValue={i?.details} />
      <div className="grid g2">
        <Field name="action_taken" label="Action taken" defaultValue={i?.action_taken} placeholder="e.g. Guardian called; detention Friday" />
        <Field name="status" label="Status" type="select" defaultValue={i?.status ?? 'OPEN'} options={['OPEN', 'CLOSED']} />
      </div>
    </>
  );
}

/** The student's discipline / medical / exeat log — add and edit inline, on the card. */
export function IncidentsCard({ studentId, rows, canManage }: { studentId: number; rows: StudentIncidentView[]; canManage: boolean }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const { run, busy } = useRunAction();
  return (
    <div className="card">
      <div className="card-head">
        <div><h3>Discipline, medical & exeats</h3><div className="card-sub">{rows.filter((r) => r.status === 'OPEN').length} open · {rows.length} on file</div></div>
        <div className="spacer" />
        {canManage && !adding ? <button type="button" className="btn sm" onClick={() => { setEditing(null); setAdding(true); }}>Add record</button> : null}
      </div>
      {adding ? (
        <div className="sub-card" style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 8, marginBottom: 12 }}>
          <FormModal inline title="" onClose={() => setAdding(false)} onSubmit={(v) => saveIncidentRequest(studentId, v)} submitLabel="Save record" successTitle="Record saved">
            <IncidentFields />
          </FormModal>
        </div>
      ) : null}
      {rows.length ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Kind</th><th>Title</th><th>Action taken</th><th>Follow-up</th><th>Status</th><th className="num" /></tr></thead>
            <tbody>
              {rows.map((r) => (
                editing === r.id ? (
                  <tr key={r.id}><td colSpan={7}>
                    <FormModal inline title="" onClose={() => setEditing(null)} onSubmit={(v) => saveIncidentRequest(studentId, { ...v, id: r.id })} submitLabel="Save" successTitle="Record updated">
                      <IncidentFields i={r} />
                    </FormModal>
                  </td></tr>
                ) : (
                  <tr key={r.id} className={r.status === 'CLOSED' ? 'muted' : undefined}>
                    <td>{formatDate(r.date)}</td>
                    <td><Pill tone={kindTone(r.kind)}>{kindLabel(r.kind)}</Pill></td>
                    <td><b>{r.title}</b>{r.details ? <div className="tiny">{r.details}</div> : null}</td>
                    <td>{r.action_taken ?? '—'}</td>
                    <td>{r.follow_up ? formatDate(r.follow_up) : '—'}</td>
                    <td><Pill status={r.status} tone={r.status === 'OPEN' ? 'warn' : 'ok'} /></td>
                    <td className="num">{canManage ? (
                      <span className="inline" style={{ gap: 4, justifyContent: 'flex-end' }}>
                        <button type="button" className="btn sm ghost" onClick={() => { setAdding(false); setEditing(r.id); }}>Edit</button>
                        <button type="button" className="btn sm ghost" disabled={busy} onClick={() => run(() => deleteIncidentRequest(r.id, studentId), { confirm: { title: 'Delete this record?', confirmLabel: 'Delete', danger: true }, successTitle: 'Record deleted' })}>Delete</button>
                      </span>
                    ) : null}</td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyState icon="🩺" title="Nothing on record" />}
    </div>
  );
}
