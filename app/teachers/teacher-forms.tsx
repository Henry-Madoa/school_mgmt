'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useRunAction } from '@/components/ui/run-action';
import { saveTeacherProfileRequest, removeTeacherProfileRequest, assignTeacherRequest, unassignTeacherRequest } from '@/app/actions/academics';
import type { StreamView, Subject, TeacherView } from '@/lib/types';

type EmployeePick = { id: number; employee_no: string; first_name: string; last_name: string; job_title?: string | null };

/** Flag an employee as teaching staff (or edit the profile of one already flagged). */
export function TeacherProfileFormButton({ teacher, employees, className = 'btn', children }: {
  teacher?: TeacherView | null; employees?: EmployeePick[]; className?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState(String(teacher?.employee_id ?? ''));
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal title={teacher ? `${teacher.first_name} ${teacher.last_name} — teaching profile` : 'Add teaching staff'} onClose={() => setOpen(false)}
          onSubmit={saveTeacherProfileRequest} successTitle={teacher ? 'Profile updated' : 'Added to teaching staff'}>
          {teacher ? <input type="hidden" name="employee_id" value={teacher.employee_id} /> : (
            <SearchableSelect id="f_teacher_employee" name="employee_id" label="Employee" required items={employees ?? []}
              getValue={(e) => String(e.id)} getLabel={(e) => `${e.employee_no} — ${e.first_name} ${e.last_name}${e.job_title ? ` (${e.job_title})` : ''}`}
              value={employeeId} onChange={setEmployeeId} placeholder="Search staff not yet flagged as teachers…" emptyText="Every active employee is already teaching staff"
              hint="Staff are onboarded under HR › Employees first; this flags one as a teacher." />
          )}
          <div className="grid g3">
            <Field name="tsc_number" label="TSC number" defaultValue={teacher?.tsc_number} uppercase />
            <Field name="qualification" label="Qualification" defaultValue={teacher?.qualification} placeholder="e.g. B.Ed (Arts)" />
            <Field name="specialisation" label="Specialisation" defaultValue={teacher?.specialisation} placeholder="e.g. Mathematics / Physics" />
          </div>
        </FormModal>
      ) : null}
    </>
  );
}

export function RemoveTeacherButton({ employeeId, className = 'btn ghost' }: { employeeId: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy} onClick={() => run(() => removeTeacherProfileRequest(employeeId), {
      confirm: { title: 'Remove from teaching staff?', message: 'The HR record is untouched; only the teaching profile and this year’s class assignments go. Refused while they are a class teacher.', confirmLabel: 'Remove', danger: true },
      successTitle: 'Removed from teaching staff', redirectTo: '/teachers',
    })}>{busy ? 'Removing…' : 'Remove from teaching staff'}</button>
  );
}

/** Assign a subject in a class to a teacher — from the teacher's card (teacher fixed) or a class's card (stream fixed). */
export function AssignTeacherButton({ teacherId, streamId, teachers, streams, subjects, className = 'btn', children }: {
  teacherId?: number; streamId?: number; teachers?: TeacherView[]; streams: StreamView[]; subjects: Subject[]; className?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [tId, setTId] = useState(String(teacherId ?? ''));
  const [sId, setSId] = useState(String(streamId ?? ''));
  const [subId, setSubId] = useState('');
  return (
    <>
      <button type="button" className={className} onClick={() => { setSubId(''); setOpen(true); }}>{children}</button>
      {open ? (
        <FormModal title="Assign a subject" onClose={() => setOpen(false)} onSubmit={assignTeacherRequest} submitLabel="Assign" successTitle="Subject assigned">
          {teacherId ? <input type="hidden" name="teacher_id" value={teacherId} /> : (
            <SearchableSelect id="f_assign_teacher" name="teacher_id" label="Teacher" required items={teachers ?? []}
              getValue={(t) => String(t.id)} getLabel={(t) => `${t.employee_no} — ${t.first_name} ${t.last_name}`} value={tId} onChange={setTId} placeholder="Search teaching staff…" />
          )}
          {streamId ? <input type="hidden" name="stream_id" value={streamId} /> : (
            <SearchableSelect id="f_assign_stream" name="stream_id" label="Class" required items={streams}
              getValue={(s) => String(s.id)} getLabel={(s) => `${s.grade_level_name} ${s.name}`} value={sId} onChange={setSId} placeholder="Search class…" />
          )}
          <SearchableSelect id="f_assign_subject" name="subject_id" label="Subject" required items={subjects}
            getValue={(s) => String(s.id)} getLabel={(s) => `${s.code} — ${s.name}`} value={subId} onChange={setSubId} placeholder="Search subject…" />
          <div className="note">The assignment is for the current academic year. It lets the teacher enter marks and mark the register for this class, and puts the class on their timetable.</div>
        </FormModal>
      ) : null}
    </>
  );
}

export function UnassignButton({ id }: { id: number }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className="btn sm ghost" disabled={busy} onClick={() => run(() => unassignTeacherRequest(id), {
      confirm: { title: 'Remove this assignment?', message: 'Timetable slots for this teacher-subject-class are removed too.', confirmLabel: 'Remove' }, successTitle: 'Assignment removed',
    })}>{busy ? '…' : 'Remove'}</button>
  );
}
