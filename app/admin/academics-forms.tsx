'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { useRunAction } from '@/components/ui/run-action';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  saveAcademicYearRequest, setCurrentTermRequest, deleteAcademicYearRequest,
  saveEducationLevelRequest, deleteEducationLevelRequest, saveGradeLevelRequest, deleteGradeLevelRequest, saveStreamRequest, deleteStreamRequest,
  saveSubjectRequest, deleteSubjectRequest, saveGradingScaleRequest, deleteGradingScaleRequest, saveAssessmentTypeRequest, deleteAssessmentTypeRequest,
} from '@/app/actions/academics';
import { saveFeeItemRequest, deleteFeeItemRequest } from '@/app/actions/fees';
import type {
  AcademicYearWithTerms, AssessmentType, EducationLevel, FeeItemView, GradeLevel, GradingScaleWithBands, StreamView, SubjectView,
} from '@/lib/types';

type Opt = { id: number; name: string };

/** A confirm-then-run button shared by every "Delete" below. */
function DeleteButton({ title, message, action, label = 'Delete', className = 'btn sm ghost' }: {
  title: string; message: string; action: () => Promise<{ ok: boolean; error?: string }>; label?: string; className?: string;
}) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(action, { confirm: { title, message, confirmLabel: label }, successTitle: 'Done' })}>
      {busy ? 'Working…' : label}
    </button>
  );
}

/* ---------------------------------------------------------------- academic years */

interface TermRow { id?: number | null; name: string; startDate: string; endDate: string; isCurrent: boolean }

export function AcademicYearFormButton({ year, className = 'btn', children }: { year?: AcademicYearWithTerms | null; className?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const y = year ?? null;
  const nextYear = new Date().getFullYear() + (y ? 0 : 0);
  const blank = (): TermRow[] => [
    { name: 'Term 1', startDate: `${nextYear}-01-06`, endDate: `${nextYear}-04-04`, isCurrent: false },
    { name: 'Term 2', startDate: `${nextYear}-04-28`, endDate: `${nextYear}-08-01`, isCurrent: false },
    { name: 'Term 3', startDate: `${nextYear}-08-25`, endDate: `${nextYear}-10-24`, isCurrent: false },
  ];
  const [terms, setTerms] = useState<TermRow[]>(y ? y.terms.map((t) => ({ id: t.id, name: t.name, startDate: t.start_date, endDate: t.end_date, isCurrent: t.is_current })) : blank());
  const set = (i: number, k: keyof TermRow, v: string | boolean) => setTerms(terms.map((t, idx) => (idx === i ? { ...t, [k]: v } : t)));
  return (
    <>
      <button type="button" className={className} onClick={() => { setTerms(y ? y.terms.map((t) => ({ id: t.id, name: t.name, startDate: t.start_date, endDate: t.end_date, isCurrent: t.is_current })) : blank()); setOpen(true); }}>{children}</button>
      {open ? (
        <FormModal title={y ? `Edit ${y.name}` : 'Add an academic year'} wide onClose={() => setOpen(false)}
          onSubmit={(v) => saveAcademicYearRequest({ ...v, id: y?.id ?? '' }, terms)}
          submitLabel={y ? 'Save changes' : 'Create'} successTitle={y ? 'Academic year updated' : 'Academic year created'}>
          <div className="grid g3">
            <Field name="name" label="Year" required placeholder="e.g. 2026" defaultValue={y?.name ?? String(nextYear)} />
            <Field name="start_date" label="Starts" type="date" required defaultValue={y?.start_date ?? `${nextYear}-01-01`} />
            <Field name="end_date" label="Ends" type="date" required defaultValue={y?.end_date ?? `${nextYear}-12-31`} />
          </div>
          <Field name="is_current" label="This is the current academic year" type="checkbox" defaultValue={y?.is_current ? 1 : 0} />
          <div className="hint" style={{ marginTop: 8 }}>Terms</div>
          <table>
            <thead><tr><th>Name</th><th>Starts</th><th>Ends</th><th>Current</th><th style={{ width: 32 }} /></tr></thead>
            <tbody>
              {terms.map((t, i) => (
                <tr key={i}>
                  <td><input type="text" value={t.name} onChange={(e) => set(i, 'name', e.target.value)} aria-label="Term name" required style={{ width: '100%' }} /></td>
                  <td><input type="date" value={t.startDate} onChange={(e) => set(i, 'startDate', e.target.value)} aria-label="Starts" required /></td>
                  <td><input type="date" value={t.endDate} onChange={(e) => set(i, 'endDate', e.target.value)} aria-label="Ends" required /></td>
                  <td><input type="radio" name="_current_term" checked={t.isCurrent} onChange={() => setTerms(terms.map((x, idx) => ({ ...x, isCurrent: idx === i })))} aria-label="Current term" /></td>
                  <td><button type="button" className="btn sm ghost" aria-label="Remove" onClick={() => setTerms(terms.filter((_, idx) => idx !== i))}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setTerms([...terms, { name: `Term ${terms.length + 1}`, startDate: '', endDate: '', isCurrent: false }])}>Add term</button>
        </FormModal>
      ) : null}
    </>
  );
}

export function SetCurrentTermButton({ termId, className = 'btn sm ghost' }: { termId: number; className?: string }) {
  const { run, busy } = useRunAction();
  return <button type="button" className={className} disabled={busy} onClick={() => run(() => setCurrentTermRequest(termId), { successTitle: 'Current term set' })}>{busy ? '…' : 'Make current'}</button>;
}

export const DeleteAcademicYearButton = ({ id }: { id: number }) => (
  <DeleteButton title="Delete this academic year?" message="Refused once classes or enrolments exist for it." action={() => deleteAcademicYearRequest(id)} />
);

/* ---------------------------------------------------------------- structure */

export function EducationLevelFormButton({ level, className = 'btn', children }: { level?: EducationLevel | null; className?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal title={level ? `Edit ${level.name}` : 'Add an education level'} onClose={() => setOpen(false)}
          onSubmit={(v) => saveEducationLevelRequest({ ...v, id: level?.id ?? '' })} successTitle="Saved">
          <Field name="name" label="Name" required placeholder="e.g. Junior Secondary" defaultValue={level?.name} />
          <Field name="sort" label="Order" type="number" defaultValue={level?.sort ?? 1} />
        </FormModal>
      ) : null}
    </>
  );
}
export const DeleteEducationLevelButton = ({ id }: { id: number }) => (
  <DeleteButton title="Delete this level?" message="Refused while it still has grade levels." action={() => deleteEducationLevelRequest(id)} />
);

export function GradeLevelFormButton({ grade, levels, className = 'btn', children }: { grade?: GradeLevel | null; levels: EducationLevel[]; className?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal title={grade ? `Edit ${grade.name}` : 'Add a grade level'} onClose={() => setOpen(false)}
          onSubmit={(v) => saveGradeLevelRequest({ ...v, id: grade?.id ?? '' })} successTitle="Saved">
          <Field name="education_level_id" label="Education level" type="select" required defaultValue={grade?.education_level_id ?? levels[0]?.id ?? ''}
            options={levels.map((l) => ({ value: l.id, label: l.name }))} />
          <Field name="name" label="Name" required placeholder="e.g. Grade 4" defaultValue={grade?.name} />
          <Field name="sort" label="Order within the level" type="number" defaultValue={grade?.sort ?? 1} />
        </FormModal>
      ) : null}
    </>
  );
}
export const DeleteGradeLevelButton = ({ id }: { id: number }) => (
  <DeleteButton title="Delete this grade?" message="Refused while students or classes are in it." action={() => deleteGradeLevelRequest(id)} />
);

export function StreamFormButton({ stream, grades, years, teachers, defaultYearId, className = 'btn', children }: {
  stream?: StreamView | null; grades: GradeLevel[]; years: Opt[]; teachers: { id: number; employee_no: string; first_name: string; last_name: string }[];
  defaultYearId?: number | null; className?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [teacherId, setTeacherId] = useState(String(stream?.class_teacher_id ?? ''));
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal title={stream ? `Edit ${stream.grade_level_name} ${stream.name}` : 'Open a class'} onClose={() => setOpen(false)}
          onSubmit={(v) => saveStreamRequest({ ...v, id: stream?.id ?? '' })} successTitle="Saved">
          <div className="grid g2">
            <Field name="academic_year_id" label="Academic year" type="select" required defaultValue={stream?.academic_year_id ?? defaultYearId ?? years[0]?.id ?? ''}
              options={years.map((y) => ({ value: y.id, label: y.name }))} />
            <Field name="grade_level_id" label="Grade" type="select" required defaultValue={stream?.grade_level_id ?? grades[0]?.id ?? ''}
              options={grades.map((g) => ({ value: g.id, label: g.name }))} />
          </div>
          <Field name="name" label="Class name" required placeholder="e.g. East, Red, Sunflower" defaultValue={stream?.name} />
          <SearchableSelect id="f_class_teacher" name="class_teacher_id" label="Class teacher" items={teachers}
            getValue={(t) => String(t.id)} getLabel={(t) => `${t.employee_no} — ${t.first_name} ${t.last_name}`}
            value={teacherId} onChange={setTeacherId} placeholder="Search teaching staff…" emptyText="No teaching staff yet" />
        </FormModal>
      ) : null}
    </>
  );
}
export const DeleteStreamButton = ({ id }: { id: number }) => (
  <DeleteButton title="Delete this class?" message="Refused while students are placed in it. Its timetable and assignments are removed." action={() => deleteStreamRequest(id)} />
);

/* ---------------------------------------------------------------- subjects */

export function SubjectFormButton({ subject, levels, grades, className = 'btn', children }: {
  subject?: SubjectView | null; levels: EducationLevel[]; grades: (GradeLevel & { education_level_name?: string })[]; className?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<number[]>(subject?.grade_level_ids ?? []);
  const toggle = (id: number) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  return (
    <>
      <button type="button" className={className} onClick={() => { setPicked(subject?.grade_level_ids ?? []); setOpen(true); }}>{children}</button>
      {open ? (
        <FormModal title={subject ? `Edit ${subject.name}` : 'Add a subject'} onClose={() => setOpen(false)}
          onSubmit={(v) => saveSubjectRequest({ ...v, id: subject?.id ?? '' }, picked)} successTitle="Saved">
          <div className="grid g2">
            <Field name="code" label="Code" required uppercase placeholder="e.g. MATH" defaultValue={subject?.code} />
            <Field name="name" label="Name" required placeholder="e.g. Mathematics" defaultValue={subject?.name} />
          </div>
          <div className="grid g3">
            <Field name="education_level_id" label="Level (optional)" type="select" defaultValue={subject?.education_level_id ?? ''}
              options={[{ value: '', label: 'Any level' }, ...levels.map((l) => ({ value: l.id, label: l.name }))]} />
            <Field name="status" label="Status" type="select" defaultValue={subject?.status ?? 'ACTIVE'} options={['ACTIVE', 'INACTIVE']} />
            <Field name="is_core" label="Core subject" type="checkbox" defaultValue={subject ? (subject.is_core ? 1 : 0) : 1} />
          </div>
          <div className="hint">Offered in</div>
          <div className="inline" style={{ flexWrap: 'wrap', gap: 6 }}>
            {grades.map((g) => (
              <label key={g.id} className={`pill chip ${picked.includes(g.id) ? 'info' : ''}`} style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={picked.includes(g.id)} onChange={() => toggle(g.id)} style={{ marginRight: 4 }} />{g.name}
              </label>
            ))}
          </div>
        </FormModal>
      ) : null}
    </>
  );
}
export const DeleteSubjectButton = ({ id }: { id: number }) => (
  <DeleteButton title="Delete this subject?" message="Refused once marks exist for it — mark it Inactive instead." action={() => deleteSubjectRequest(id)} />
);

/* ---------------------------------------------------------------- grading scales */

interface BandRow { label: string; minScore: string; maxScore: string; colorHex: string }

export function GradingScaleFormButton({ scale, className = 'btn', children }: { scale?: GradingScaleWithBands | null; className?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const initial = (): BandRow[] => (scale ? scale.bands.map((b) => ({ label: b.label, minScore: String(b.min_score), maxScore: String(b.max_score), colorHex: b.color_hex })) : [
    { label: 'Exceeding Expectations', minScore: '80', maxScore: '100', colorHex: '#1a7f37' },
    { label: 'Meeting Expectations', minScore: '60', maxScore: '79.99', colorHex: '#1d6fb8' },
    { label: 'Approaching Expectations', minScore: '40', maxScore: '59.99', colorHex: '#b7791f' },
    { label: 'Below Expectations', minScore: '0', maxScore: '39.99', colorHex: '#c0392b' },
  ]);
  const [bands, setBands] = useState<BandRow[]>(initial());
  const set = (i: number, k: keyof BandRow, v: string) => setBands(bands.map((b, idx) => (idx === i ? { ...b, [k]: v } : b)));
  return (
    <>
      <button type="button" className={className} onClick={() => { setBands(initial()); setOpen(true); }}>{children}</button>
      {open ? (
        <FormModal title={scale ? `Edit ${scale.name}` : 'Add a grading scale'} wide onClose={() => setOpen(false)}
          onSubmit={(v) => saveGradingScaleRequest({ ...v, id: scale?.id ?? '' }, bands.map((b) => ({ label: b.label, minScore: Number(b.minScore), maxScore: Number(b.maxScore), colorHex: b.colorHex })))}
          successTitle="Saved">
          <div className="grid g2">
            <Field name="name" label="Name" required defaultValue={scale?.name} placeholder="e.g. CBC Competency Scale" />
            <Field name="is_default" label="Default scale (labels every mark)" type="checkbox" defaultValue={scale?.is_default ? 1 : 0} />
          </div>
          <table>
            <thead><tr><th>Band</th><th style={{ width: 100 }}>From</th><th style={{ width: 100 }}>To</th><th style={{ width: 80 }}>Colour</th><th style={{ width: 32 }} /></tr></thead>
            <tbody>
              {bands.map((b, i) => (
                <tr key={i}>
                  <td><input type="text" value={b.label} onChange={(e) => set(i, 'label', e.target.value)} required aria-label="Band" style={{ width: '100%' }} /></td>
                  <td><input type="number" step="0.01" value={b.minScore} onChange={(e) => set(i, 'minScore', e.target.value)} required aria-label="From" style={{ width: '100%' }} /></td>
                  <td><input type="number" step="0.01" value={b.maxScore} onChange={(e) => set(i, 'maxScore', e.target.value)} required aria-label="To" style={{ width: '100%' }} /></td>
                  <td><input type="color" value={b.colorHex} onChange={(e) => set(i, 'colorHex', e.target.value)} aria-label="Colour" /></td>
                  <td><button type="button" className="btn sm ghost" aria-label="Remove" onClick={() => setBands(bands.filter((_, idx) => idx !== i))}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setBands([...bands, { label: '', minScore: '', maxScore: '', colorHex: '#64748b' }])}>Add band</button>
        </FormModal>
      ) : null}
    </>
  );
}
export const DeleteGradingScaleButton = ({ id }: { id: number }) => (
  <DeleteButton title="Delete this scale?" message="Make another scale the default first." action={() => deleteGradingScaleRequest(id)} />
);

/* ---------------------------------------------------------------- assessment types */

export function AssessmentTypeFormButton({ type, className = 'btn', children }: { type?: AssessmentType | null; className?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal title={type ? `Edit ${type.name}` : 'Add an assessment type'} onClose={() => setOpen(false)}
          onSubmit={(v) => saveAssessmentTypeRequest({ ...v, id: type?.id ?? '' })} successTitle="Saved">
          <Field name="name" label="Name" required placeholder="e.g. End of Term Exam" defaultValue={type?.name} />
          <div className="grid g3">
            <Field name="weight" label="Weight" type="number" step="0.1" defaultValue={type?.weight ?? 1} hint="Relative weight in the term average" />
            <Field name="sort" label="Order" type="number" defaultValue={type?.sort ?? 1} />
            <Field name="is_exam" label="Is an exam" type="checkbox" defaultValue={type?.is_exam ? 1 : 0} />
          </div>
        </FormModal>
      ) : null}
    </>
  );
}
export const DeleteAssessmentTypeButton = ({ id }: { id: number }) => (
  <DeleteButton title="Delete this assessment type?" message="Refused once marks exist under it." action={() => deleteAssessmentTypeRequest(id)} />
);

/* ---------------------------------------------------------------- fee items */

export function FeeItemFormButton({ item, accounts, className = 'btn', children }: {
  item?: FeeItemView | null; accounts: { id: number; code: string; name: string }[]; className?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState(String(item?.gl_account_id ?? ''));
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal title={item ? `Edit ${item.name}` : 'Add a fee item'} onClose={() => setOpen(false)}
          onSubmit={(v) => saveFeeItemRequest({ ...v, id: item?.id ?? '' })} successTitle="Saved">
          <div className="grid g2">
            <Field name="code" label="Code" required uppercase placeholder="e.g. TUITION" defaultValue={item?.code} />
            <Field name="name" label="Name" required placeholder="e.g. Tuition Fees" defaultValue={item?.name} />
          </div>
          <SearchableSelect id="f_fee_gl" name="gl_account_id" label="Income account" required items={accounts}
            getValue={(a) => String(a.id)} getLabel={(a) => `${a.code} — ${a.name}`} value={accountId} onChange={setAccountId}
            placeholder="Search income accounts…" emptyText="No income accounts" hint="The G/L account each invoice line for this item credits" />
          <div className="grid g2">
            <Field name="status" label="Status" type="select" defaultValue={item?.status ?? 'ACTIVE'} options={['ACTIVE', 'INACTIVE']} />
            <Field name="sort" label="Order on the invoice" type="number" defaultValue={item?.sort ?? 1} />
          </div>
        </FormModal>
      ) : null}
    </>
  );
}
export const DeleteFeeItemButton = ({ id }: { id: number }) => (
  <DeleteButton title="Delete this fee item?" message="Refused while the fee structure uses it — mark it Inactive instead." action={() => deleteFeeItemRequest(id)} />
);
