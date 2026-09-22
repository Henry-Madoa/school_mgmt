'use server';

import { revalidatePath } from 'next/cache';
import { requireAction } from '@/lib/session';
import { actionResult } from '@/lib/errors';
import * as admissions from '@/lib/admissions';
import * as incidents from '@/lib/incidents';
import { setStudentElectives } from '@/lib/academics/setup';
import type { ActionResult, FormValues } from '@/lib/types';

const str = (v: unknown): string => String(v ?? '').trim();

/* ---------------------------------------------------------------- admissions */

export async function saveApplicationRequest(values: FormValues): Promise<ActionResult<{ id: number; no: string }>> {
  return actionResult(async () => {
    const user = await requireAction('ADMISSIONS_MANAGE');
    const r = await admissions.saveApplication(values.id ? Number(values.id) : null, {
      firstName: str(values.first_name), middleName: str(values.middle_name) || null, lastName: str(values.last_name), gender: str(values.gender) || null,
      dateOfBirth: str(values.date_of_birth) || null, previousSchool: str(values.previous_school) || null,
      gradeLevelId: Number(values.grade_level_id), academicYearId: Number(values.academic_year_id), boardingStatus: str(values.boarding_status) || 'DAY',
      guardianName: str(values.guardian_name), guardianPhone: str(values.guardian_phone), guardianEmail: str(values.guardian_email) || null,
      guardianRelationship: str(values.guardian_relationship) || 'Parent', notes: str(values.notes) || null,
      status: (str(values.status) || 'ENQUIRY') as admissions.ApplicationStatus,
    }, user);
    revalidatePath('/admissions', 'layout');
    return r;
  });
}

export async function setApplicationStatusRequest(id: number, status: admissions.ApplicationStatus): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => { const user = await requireAction('ADMISSIONS_MANAGE'); await admissions.setApplicationStatus(id, status, user); revalidatePath('/admissions', 'layout'); return { id }; });
}

export async function admitApplicationRequest(id: number, values: FormValues): Promise<ActionResult<{ studentId: number; admissionNo: string }>> {
  return actionResult(async () => {
    const user = await requireAction('ADMISSIONS_MANAGE');
    const r = await admissions.admitApplication(id, Number(values.stream_id), str(values.admission_date), str(values.admission_no) || null, user);
    revalidatePath('/admissions', 'layout'); revalidatePath('/students', 'layout'); revalidatePath('/classes', 'layout');
    return r;
  });
}

/* ---------------------------------------------------------------- incidents */

export async function saveIncidentRequest(studentId: number, values: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('INCIDENTS_MANAGE');
    const r = await incidents.saveIncident(values.id ? Number(values.id) : null, studentId, {
      kind: str(values.kind), date: str(values.date), title: str(values.title), details: str(values.details) || null,
      actionTaken: str(values.action_taken) || null, followUp: str(values.follow_up) || null, status: str(values.status) || 'OPEN',
    }, user);
    revalidatePath('/incidents'); revalidatePath(`/students/view/${studentId}`);
    return r;
  });
}

export async function deleteIncidentRequest(id: number, studentId: number): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => { const user = await requireAction('INCIDENTS_MANAGE'); await incidents.deleteIncident(id, user); revalidatePath('/incidents'); revalidatePath(`/students/view/${studentId}`); return { deleted: true }; });
}

/* ---------------------------------------------------------------- electives */

export async function setStudentElectivesRequest(studentId: number, subjectIds: number[]): Promise<ActionResult<{ saved: number }>> {
  return actionResult(async () => {
    const user = await requireAction('STUDENTS_SUBJECTS_MANAGE');
    const r = await setStudentElectives(studentId, subjectIds.map(Number), user);
    revalidatePath(`/students/view/${studentId}`); revalidatePath('/assessments'); revalidatePath('/report-cards', 'layout');
    return r;
  });
}
