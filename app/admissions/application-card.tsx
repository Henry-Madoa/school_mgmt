'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useEditableCard } from '@/components/ui/editable-card';
import { saveApplicationRequest, admitApplicationRequest } from '@/app/actions/admissions';
import { GENDERS } from '@/lib/constants';
import { today } from '@/lib/format';
import type { AdmissionApplicationView, ApplicationStatus } from '@/lib/admissions';
import type { AcademicYear, GradeLevel, StreamView } from '@/lib/types';

export const STATUS_LABEL: Record<ApplicationStatus, string> = { ENQUIRY: 'Enquiry', APPLIED: 'Applied', OFFERED: 'Offered a place', ADMITTED: 'Admitted', DECLINED: 'Declined' };

/** The application's fields — the inline editor on its card (EditableCard) and the "New" form share them. */
export function ApplicationFields({ a, grades, years }: { a?: AdmissionApplicationView | null; grades: GradeLevel[]; years: AcademicYear[] }) {
  return (
    <>
      <div className="hint">Applicant</div>
      <div className="grid g3">
        <Field name="first_name" label="First name" required defaultValue={a?.first_name} />
        <Field name="middle_name" label="Middle name" defaultValue={a?.middle_name} />
        <Field name="last_name" label="Last name" required defaultValue={a?.last_name} />
      </div>
      <div className="grid g3">
        <Field name="gender" label="Gender" type="select" defaultValue={a?.gender ?? ''} options={GENDERS.map((g) => ({ value: g, label: g ? g[0] + g.slice(1).toLowerCase() : '—' }))} />
        <Field name="date_of_birth" label="Date of birth" type="date" defaultValue={a?.date_of_birth} />
        <Field name="previous_school" label="Previous school" defaultValue={a?.previous_school} />
      </div>
      <div className="grid g3">
        <Field name="grade_level_id" label="Grade applied for" type="select" required defaultValue={a?.grade_level_id ?? grades[0]?.id ?? ''} options={grades.map((g) => ({ value: g.id, label: g.name }))} />
        <Field name="academic_year_id" label="For the year" type="select" required defaultValue={a?.academic_year_id ?? years.find((y) => y.is_current)?.id ?? years[0]?.id ?? ''} options={years.map((y) => ({ value: y.id, label: y.name }))} />
        <Field name="boarding_status" label="Boarding" type="select" defaultValue={a?.boarding_status ?? 'DAY'} options={[{ value: 'DAY', label: 'Day scholar' }, { value: 'BOARDER', label: 'Boarder' }]} />
      </div>
      <div className="hint">Guardian</div>
      <div className="grid g2">
        <Field name="guardian_name" label="Guardian name" required defaultValue={a?.guardian_name} />
        <Field name="guardian_relationship" label="Relationship" defaultValue={a?.guardian_relationship ?? 'Parent'} />
      </div>
      <div className="grid g2">
        <Field name="guardian_phone" label="Phone" type="phone" required defaultValue={a?.guardian_phone} />
        <Field name="guardian_email" label="Email" type="email" defaultValue={a?.guardian_email} />
      </div>
      <div className="grid g2">
        <Field name="status" label="Stage" type="select" defaultValue={a?.status ?? 'ENQUIRY'} options={(['ENQUIRY', 'APPLIED', 'OFFERED', 'DECLINED'] as ApplicationStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
        <div />
      </div>
      <Field name="notes" label="Notes" type="textarea" rows={3} defaultValue={a?.notes} placeholder="Interview notes, documents received, follow-ups…" />
    </>
  );
}

/** Inline editor on the application card. */
export function ApplicationEditForm({ application, grades, years }: { application: AdmissionApplicationView; grades: GradeLevel[]; years: AcademicYear[] }) {
  const { close } = useEditableCard();
  return (
    <FormModal inline title="" onClose={close} onSubmit={(v) => saveApplicationRequest({ ...v, id: application.id })} submitLabel="Save changes" successTitle="Application updated">
      <ApplicationFields a={application} grades={grades} years={years} />
    </FormModal>
  );
}

/** "New enquiry / application" — an inline card form at the top of the list, opening the new card on save. */
export function NewApplicationCard({ grades, years }: { grades: GradeLevel[]; years: AcademicYear[] }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" className="btn" onClick={() => setOpen(true)}>New enquiry / application</button>;
  return (
    <div className="card" style={{ width: '100%' }}>
      <div className="card-head"><div><h3>New enquiry / application</h3></div></div>
      <FormModal inline title="" onClose={() => setOpen(false)} onSubmit={saveApplicationRequest} submitLabel="Record" successTitle="Application recorded"
        successDetail={(d) => `${d.no} — follow up with the guardian, then offer and admit`} redirectTo={(d) => `/admissions/${d.id}`}>
        <ApplicationFields grades={grades} years={years} />
      </FormModal>
    </div>
  );
}

/** Admit: place the applicant in a class — inline on the card; the student, guardian and fee account are created. */
export function AdmitApplicationPanel({ application, streams }: { application: AdmissionApplicationView; streams: StreamView[] }) {
  const [open, setOpen] = useState(false);
  const [streamId, setStreamId] = useState(String(streams.find((s) => s.grade_level_id === application.grade_level_id)?.id ?? ''));
  if (!open) return <button type="button" className="btn" onClick={() => setOpen(true)}>Admit into a class…</button>;
  return (
    <div style={{ width: '100%' }}>
      <FormModal inline title="" onClose={() => setOpen(false)} onSubmit={(v) => admitApplicationRequest(application.id, v)}
        submitLabel="Admit student" resultStyle="popup" successTitle="Student admitted" successDetail={(d) => `Admission No. ${d.admissionNo} — the fee account is open`}
        redirectTo={(d) => `/students/view/${d.studentId}`}>
        <div className="grid g3">
          <SearchableSelect id="f_admit_stream" name="stream_id" label="Place in class" required items={streams}
            getValue={(s) => String(s.id)} getLabel={(s) => `${s.grade_level_name} ${s.name} (${s.year_name})`} value={streamId} onChange={setStreamId} placeholder="Search class…" />
          <Field name="admission_date" label="Admission date" type="date" required defaultValue={today()} />
          <Field name="admission_no" label="Admission no." placeholder="Leave blank to auto-number" uppercase />
        </div>
        <div className="note">Creates the student with {application.guardian_name} as primary guardian, opens the fee account, and closes this application as Admitted.</div>
      </FormModal>
    </div>
  );
}
