'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FormModal } from '@/components/ui/form-modal';
import { Field, readForm } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { DefinitionList, Pill } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { useRunAction } from '@/components/ui/run-action';
import { LineRowsPanel, type LineColumn } from '@/components/ui/line-rows-editor';
import { humanise } from '@/lib/format';
import {
  createCompanyJobRequest, updateCompanyJobRequest, deleteCompanyJobRequest, submitCompanyJobRequest,
  cancelCompanyJobApprovalRequest, approveCompanyJobRequest, rejectCompanyJobRequest, reopenCompanyJobRequest,
  retireCompanyJobRequest, setJobResponsibilitiesRequest, setJobRequirementsRequest, setJobQualificationsRequest,
} from '@/app/actions/companyJobs';
import {
  JOB_QUALIFICATION_TYPES, JOB_QUALIFICATION_PRIORITIES, JOB_COMPETENCY_LEVELS, JOB_SKILLS_CATEGORIES,
  type HrCompanyJobView, type HrCompanyJobResponsibility, type HrCompanyJobRequirement, type HrCompanyJobQualification,
  type HrJobGrade, type DimensionValue,
} from '@/lib/types';

export interface JobLookups {
  /** Approved positions a job may report to (the one being edited is filtered out by the card). */
  jobs: Pick<HrCompanyJobView, 'id' | 'job_id' | 'name' | 'status'>[];
  jobGrades: HrJobGrade[];
  globalDimension1Values: DimensionValue[]; globalDimension2Values: DimensionValue[];
  caption1: string; caption2: string;
}

const SKILLS = JOB_SKILLS_CATEGORIES.map((s) => ({ value: s, label: s }));

/* ------------------------------------------------------------------------------ the fields */

/** The AL card's General group, shared by the New modal and the card's in-place edit. */
function JobFields({ job, lookups }: { job?: HrCompanyJobView | null; lookups: JobLookups }) {
  const [reportsTo, setReportsTo] = useState(String(job?.reports_to_job_id ?? ''));
  const [gradeId, setGradeId] = useState(String(job?.job_grade_id ?? ''));
  const [dim1Id, setDim1Id] = useState(String(job?.global_dimension_1_id ?? ''));
  const [dim2Id, setDim2Id] = useState(String(job?.global_dimension_2_id ?? ''));
  const parents = lookups.jobs.filter((j) => j.id !== job?.id);
  return (
    <>
      <div className="grid g2">
        <Field name="job_id" label="Job ID" defaultValue={job?.job_id ?? ''} disabled={!!job}
          hint={job ? undefined : 'Leave blank to number automatically (JOB0001…)'} />
        <Field name="name" label="Job title" required defaultValue={job?.name ?? ''} />
      </div>
      <div className="grid g2">
        <Field name="profession" label="Profession" defaultValue={job?.profession ?? ''} />
        <SearchableSelect id="f_reports_to" name="reports_to_job_id" label="Immediate supervisor (position reporting to)"
          items={parents} getValue={(j) => String(j.id)} getLabel={(j) => `${j.job_id} — ${j.name}`}
          value={reportsTo} onChange={setReportsTo} placeholder="Search position…" emptyText="No approved positions"
          hint="Leave blank for the top of the organogram" />
      </div>
      <div className="grid g3">
        <SearchableSelect id="f_job_grade" name="job_grade_id" label="Grade"
          items={lookups.jobGrades} getValue={(g) => String(g.id)} getLabel={(g) => `${g.code} — ${g.name}`}
          value={gradeId} onChange={setGradeId} placeholder="Search grade…" />
        <SearchableSelect id="f_gd1" name="global_dimension_1_id" label={lookups.caption1}
          items={lookups.globalDimension1Values} getValue={(d) => String(d.id)} getLabel={(d) => `${d.code} — ${d.name}`}
          value={dim1Id} onChange={setDim1Id} placeholder={`Search ${lookups.caption1.toLowerCase()}…`} />
        <SearchableSelect id="f_gd2" name="global_dimension_2_id" label={lookups.caption2}
          items={lookups.globalDimension2Values} getValue={(d) => String(d.id)} getLabel={(d) => `${d.code} — ${d.name}`}
          value={dim2Id} onChange={setDim2Id} placeholder={`Search ${lookups.caption2.toLowerCase()}…`} />
      </div>
      <Field name="objective" label="Objective / function" type="textarea" defaultValue={job?.objective ?? ''} />
      <div className="grid g2">
        <Field name="no_of_posts" label="No. of posts" type="number" required min={0} step="1" defaultValue={String(job?.no_of_posts ?? 1)} />
        <Field name="is_management" label="Management position" type="checkbox" defaultValue={job?.is_management ? 1 : 0}
          hint="Management positions are listed first among their peers on the organogram" />
      </div>
      <div className="grid g3">
        <Field name="skills_category" label="Primary skills category" type="select" options={[{ value: '', label: '—' }, ...SKILLS]} defaultValue={job?.skills_category ?? ''} />
        <Field name="skills_category_2" label="2nd skills category" type="select" options={[{ value: '', label: '—' }, ...SKILLS]} defaultValue={job?.skills_category_2 ?? ''} />
        <Field name="skills_category_3" label="3rd skills category" type="select" options={[{ value: '', label: '—' }, ...SKILLS]} defaultValue={job?.skills_category_3 ?? ''} />
      </div>
    </>
  );
}

export function NewJobButton({ lookups }: { lookups: JobLookups }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>New position</button>
      {open ? (
        <FormModal
          title="New company job"
          wide
          onClose={() => setOpen(false)}
          onSubmit={async (values) => {
            const res = await createCompanyJobRequest(values);
            if (res.ok) router.push(`/company-jobs/view/${res.data.id}`);
            return res;
          }}
          submitLabel="Create"
          successTitle="Position drafted"
          successDetail={(d) => `${d.jobId} — add its requirements and responsibilities, then send it for approval`}
        >
          <JobFields lookups={lookups} />
        </FormModal>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------------------ the card */

export function JobDetailsCard({ job, lookups, canEdit }: { job: HrCompanyJobView; lookups: JobLookups; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const form = formRef.current;
    if (!form || !form.reportValidity()) return;
    setBusy(true); setError('');
    try {
      const res = await updateCompanyJobRequest(job.id, readForm(form));
      if (!res.ok) { setError(res.error || 'Could not save'); return; }
      toast('Changes saved', undefined, 'ok');
      setEditing(false);
      router.refresh();
    } finally { setBusy(false); }
  };

  return (
    <CollapsibleCard title="General" sub="The position, where it sits and how many posts it carries"
      actions={canEdit && !editing ? <button type="button" className="btn sm ghost" onClick={() => setEditing(true)}>Edit</button> : null}>
      {!editing ? (
        <div className="grid g2 dl-groups">
          <section className="dl-group">
            <div className="dl-caption">Position</div>
            <DefinitionList items={[
              ['Job ID', <span className="mono" key="id">{job.job_id}</span>],
              ['Job title', job.name],
              ['Profession', job.profession || '—'],
              ['Immediate supervisor', job.reports_to_job_code ? <>{job.reports_to_job_name} <span className="mono">({job.reports_to_job_code})</span></> : <span className="muted-cell">Top of the organogram</span>],
              ['Management', job.is_management ? 'Yes' : 'No'],
              ['Grade', job.job_grade_name ? `${job.job_grade_code} — ${job.job_grade_name}` : '—'],
              [lookups.caption1, job.global_dimension_1_name || '—'],
              [lookups.caption2, job.global_dimension_2_name || '—'],
              ['Status', <Pill status={job.status} key="st" />],
              job.decision_reason ? ['Decision reason', job.decision_reason] : null,
            ]} />
          </section>
          <section className="dl-group">
            <div className="dl-caption">Establishment</div>
            <DefinitionList items={[
              ['No. of posts', job.no_of_posts],
              ['No. of holders', job.occupied],
              ['Vacant positions', <b key="v" style={job.vacant > 0 ? { color: 'var(--warning)' } : undefined}>{job.vacant}</b>],
              ['Objective / function', job.objective ? <span style={{ whiteSpace: 'pre-wrap' }}>{job.objective}</span> : '—'],
              ['Skills categories', [job.skills_category, job.skills_category_2, job.skills_category_3].filter(Boolean).join(', ') || '—'],
            ]} />
          </section>
        </div>
      ) : (
        <>
          <form ref={formRef} onSubmit={(ev) => ev.preventDefault()}>
            <JobFields job={job} lookups={lookups} />
          </form>
          <div className="inline" style={{ marginTop: 'var(--sp)' }}>
            {error ? <div className="modal-error">{error}</div> : null}
            <button type="button" className="btn ghost sm" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
            <button type="button" className="btn sm" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </>
      )}
    </CollapsibleCard>
  );
}

/* ------------------------------------------------------------------------------ the lines */

type TextRow = { description: string };
const TEXT_COLUMNS: LineColumn<TextRow>[] = [{ key: 'description', label: 'Description' }];
const emptyText = (): TextRow => ({ description: '' });

export function ResponsibilitiesPanel({ jobId, rows, canManage }: { jobId: number; rows: HrCompanyJobResponsibility[]; canManage: boolean }) {
  return (
    <LineRowsPanel title="Job responsibilities" sub="What the holder is answerable for" icon="📌"
      rows={rows.map((r) => ({ description: r.description }))} columns={TEXT_COLUMNS}
      edit={{ can: canManage, emptyRow: emptyText, onSave: (r) => setJobResponsibilitiesRequest(jobId, r), successTitle: 'Responsibilities saved' }} />
  );
}

export function RequirementsPanel({ jobId, rows, canManage }: { jobId: number; rows: HrCompanyJobRequirement[]; canManage: boolean }) {
  return (
    <LineRowsPanel title="Job requirements" sub="What the position demands of its holder" icon="📋"
      rows={rows.map((r) => ({ description: r.description }))} columns={TEXT_COLUMNS}
      edit={{ can: canManage, emptyRow: emptyText, onSave: (r) => setJobRequirementsRequest(jobId, r), successTitle: 'Requirements saved' }} />
  );
}

type QualRow = Omit<HrCompanyJobQualification, 'id' | 'job_id'>;
const QUAL_COLUMNS: LineColumn<QualRow>[] = [
  { key: 'qualification_type', label: 'Type', type: 'select', options: JOB_QUALIFICATION_TYPES.map((t) => ({ value: t, label: humanise(t) })), render: (r) => humanise(r.qualification_type) },
  { key: 'qualification', label: 'Qualification' },
  { key: 'description', label: 'Details' },
  { key: 'priority', label: 'Priority', type: 'select', options: JOB_QUALIFICATION_PRIORITIES.map((p) => ({ value: p, label: humanise(p) })), render: (r) => humanise(r.priority) },
  { key: 'competency_level', label: 'Competency', type: 'select', options: [{ value: '', label: '—' }, ...JOB_COMPETENCY_LEVELS.map((l) => ({ value: l, label: humanise(l) }))], render: (r) => (r.competency_level ? humanise(r.competency_level) : '—') },
];
const emptyQual = (): QualRow => ({ qualification_type: 'ACADEMIC', qualification: '', description: null, priority: 'MANDATORY', competency_level: null });

export function QualificationsPanel({ jobId, rows, canManage }: { jobId: number; rows: HrCompanyJobQualification[]; canManage: boolean }) {
  return (
    <LineRowsPanel title="Qualifications & competencies" sub="Academic, professional and experience requirements" icon="🎓"
      rows={rows.map(({ id: _id, job_id: _j, ...r }) => r)} columns={QUAL_COLUMNS}
      edit={{
        can: canManage, emptyRow: emptyQual, successTitle: 'Qualifications saved',
        onSave: (r) => setJobQualificationsRequest(jobId, r.map((q) => ({ ...q, competency_level: q.competency_level || null }))),
      }} />
  );
}

/* ------------------------------------------------------------------------------ the buttons */

export function DeleteButton({ id, className = 'btn sm ghost' }: { id: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => deleteCompanyJobRequest(id), {
        confirm: { title: 'Delete this position?', confirmLabel: 'Delete' }, successTitle: 'Deleted', redirectTo: '/company-jobs',
      })}>
      {busy ? 'Working…' : 'Delete'}
    </button>
  );
}

export function SubmitButton({ id, className = 'btn sm ghost' }: { id: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => submitCompanyJobRequest(id), {
        confirm: { title: 'Send this position for approval?', confirmLabel: 'Send for approval' },
        successTitle: (d) => (d.autoApproved ? 'Approved — the position is now in the establishment' : 'Sent for approval'),
      })}>
      {busy ? 'Working…' : 'Send for approval'}
    </button>
  );
}

export function CancelApprovalButton({ id, className = 'btn sm ghost' }: { id: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => cancelCompanyJobApprovalRequest(id), {
        confirm: { title: 'Recall this position?', confirmLabel: 'Recall' }, successTitle: 'Recalled — back to Open',
      })}>
      {busy ? 'Working…' : 'Cancel approval request'}
    </button>
  );
}

export { DelegateButton } from '@/components/ui/delegate-button';

export function ApproveButton({ id, className = 'btn sm' }: { id: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => approveCompanyJobRequest(id), {
        confirm: { title: 'Approve this position?', confirmLabel: 'Approve' }, successTitle: 'Approved — the position is now in the establishment',
      })}>
      {busy ? 'Working…' : 'Approve'}
    </button>
  );
}

export function RejectButton({ id, className = 'btn sm ghost' }: { id: number; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Reject</button>
      {open ? (
        <FormModal title="Reject position" onClose={() => setOpen(false)}
          onSubmit={(values) => rejectCompanyJobRequest(id, String(values.reason || ''))}
          submitLabel="Reject" submitClass="btn danger" successTitle="Rejected — back to Open" resultStyle="popup">
          <Field name="reason" label="Reason" type="textarea" required />
        </FormModal>
      ) : null}
    </>
  );
}

export function ReopenButton({ id, className = 'btn sm ghost' }: { id: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => reopenCompanyJobRequest(id), {
        confirm: { title: 'Reopen this position for changes?', message: 'It leaves the organogram until it is approved again; employees already on it stay placed.', confirmLabel: 'Reopen' },
        successTitle: 'Reopened — edit it, then send it for approval again',
      })}>
      {busy ? 'Working…' : 'Reopen'}
    </button>
  );
}

export function RetireButton({ id, className = 'btn sm ghost' }: { id: number; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Retire position</button>
      {open ? (
        <FormModal title="Retire this position" onClose={() => setOpen(false)}
          onSubmit={(values) => retireCompanyJobRequest(id, String(values.reason || ''))}
          submitLabel="Retire" submitClass="btn danger" successTitle="Position retired" resultStyle="popup">
          <p className="tiny muted-cell">The position leaves the establishment and the organogram. It must have no holders and nothing reporting to it.</p>
          <Field name="reason" label="Reason" type="textarea" required />
        </FormModal>
      ) : null}
    </>
  );
}
