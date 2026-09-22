'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useRunAction } from '@/components/ui/run-action';
import { saveSlotRequest, deleteSlotRequest, copyTimetableRequest } from '@/app/actions/academics';
import { DAY_NAMES } from '@/lib/constants';
import type { AcademicTermWithYear, Subject, TeacherAssignmentView, TimetableSlotView } from '@/lib/types';

const DAYS = [1, 2, 3, 4, 5, 6].map((d) => ({ value: d, label: DAY_NAMES[d] }));

/**
 * Add or edit one lesson. The subject list is what the grade offers; the teacher defaults to
 * whoever is assigned that subject for the class (and the list leads with them), but any
 * teacher can be picked — a stand-in is still a real lesson.
 */
export function SlotFormButton({ streamId, termId, slot, subjects, assignments, teachers, preset, className = 'btn sm ghost', children }: {
  streamId: number; termId: number; slot?: TimetableSlotView | null; subjects: Subject[]; assignments: TeacherAssignmentView[];
  teachers: { id: number; employee_no: string; first_name: string; last_name: string }[];
  preset?: { day: number; start: string; end: string }; className?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [subjectId, setSubjectId] = useState(String(slot?.subject_id ?? ''));
  const [teacherId, setTeacherId] = useState(String(slot?.teacher_id ?? ''));
  const pickSubject = (v: string) => {
    setSubjectId(v);
    const a = assignments.find((x) => String(x.subject_id) === v);
    if (a && !slot) setTeacherId(String(a.teacher_id));
  };
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal title={slot ? 'Edit lesson' : 'Add a lesson'} onClose={() => setOpen(false)} onSubmit={(v) => saveSlotRequest({ ...v, id: slot?.id ?? '', stream_id: streamId, term_id: termId })}
          successTitle={slot ? 'Lesson updated' : 'Lesson added'}>
          <div className="grid g3">
            <Field name="day_of_week" label="Day" type="select" required defaultValue={slot?.day_of_week ?? preset?.day ?? 1} options={DAYS} />
            <Field name="start_time" label="Starts" type="time" required defaultValue={slot?.start_time.slice(0, 5) ?? preset?.start.slice(0, 5) ?? '08:00'} />
            <Field name="end_time" label="Ends" type="time" required defaultValue={slot?.end_time.slice(0, 5) ?? preset?.end.slice(0, 5) ?? '08:40'} />
          </div>
          <SearchableSelect id="f_slot_subject" name="subject_id" label="Subject" required items={subjects} getValue={(s) => String(s.id)} getLabel={(s) => `${s.code} — ${s.name}`}
            value={subjectId} onChange={pickSubject} placeholder="Search subject…" />
          <SearchableSelect id="f_slot_teacher" name="teacher_id" label="Teacher" required items={teachers} getValue={(t) => String(t.id)} getLabel={(t) => `${t.employee_no} — ${t.first_name} ${t.last_name}`}
            value={teacherId} onChange={setTeacherId} placeholder="Search teaching staff…" hint="Fills in from the subject's assigned teacher" />
          <Field name="room" label="Room" defaultValue={slot?.room} placeholder="Optional" />
        </FormModal>
      ) : null}
    </>
  );
}

export function DeleteSlotButton({ id }: { id: number }) {
  const { run, busy } = useRunAction();
  return <button type="button" className="btn sm ghost" disabled={busy} aria-label="Remove lesson" title="Remove" onClick={() => run(() => deleteSlotRequest(id), { successTitle: 'Lesson removed' })}>{busy ? '…' : '×'}</button>;
}

export function CopyTimetableButton({ streamId, toTermId, terms, className = 'btn ghost' }: { streamId: number; toTermId: number; terms: AcademicTermWithYear[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const sources = terms.filter((t) => t.id !== toTermId);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Copy from another term</button>
      {open ? (
        <FormModal title="Copy the timetable" onClose={() => setOpen(false)} onSubmit={(v) => copyTimetableRequest(streamId, Number(v.from_term_id), toTermId)}
          submitLabel="Copy" successTitle="Timetable copied" successDetail={(d) => `${d.copied} lesson${d.copied === 1 ? '' : 's'} copied`}>
          <Field name="from_term_id" label="Copy from" type="select" required defaultValue={sources[0]?.id ?? ''} options={sources.map((t) => ({ value: t.id, label: `${t.name} ${t.year_name}` }))} />
          <div className="note">Lessons that would clash with what this term already has are skipped.</div>
        </FormModal>
      ) : null}
    </>
  );
}
