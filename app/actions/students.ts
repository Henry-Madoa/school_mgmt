'use server';

import { revalidatePath } from 'next/cache';
import { requireAction } from '@/lib/session';
import { actionResult } from '@/lib/errors';
import * as students from '@/lib/students';
import type { ActionResult, FormValues, StudentStatus } from '@/lib/types';

const str = (v: unknown): string => String(v ?? '').trim();
const num = (v: unknown): number | null => (v === undefined || v === '' || v === null ? null : Number(v));
const revalidate = (id?: number) => {
  revalidatePath('/students', 'layout'); revalidatePath('/guardians', 'layout'); revalidatePath('/classes', 'layout'); revalidatePath('/fees', 'layout');
  if (id) revalidatePath(`/students/view/${id}`);
};

const studentInput = (v: FormValues) => ({
  firstName: str(v.first_name), middleName: str(v.middle_name) || null, lastName: str(v.last_name), gender: str(v.gender) || null,
  dateOfBirth: str(v.date_of_birth) || null, birthCertificateNo: str(v.birth_certificate_no) || null, nemisUpi: str(v.nemis_upi) || null,
  address: str(v.address) || null, countyId: num(v.county_id), subCountyId: num(v.sub_county_id), admissionDate: str(v.admission_date),
  religion: str(v.religion) || null, medicalNotes: str(v.medical_notes) || null,
});

export async function admitStudentRequest(values: FormValues, guardians: students.GuardianDraft[]): Promise<ActionResult<{ id: number; admissionNo: string }>> {
  return actionResult(async () => {
    const user = await requireAction('STUDENTS_CREATE');
    const r = await students.admitStudent({ ...studentInput(values), admissionNo: str(values.admission_no) || null, streamId: Number(values.stream_id) }, guardians, user);
    revalidate(r.id);
    return r;
  });
}

export async function updateStudentRequest(id: number, values: FormValues, guardians: students.GuardianDraft[]): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('STUDENTS_UPDATE');
    await students.updateStudent(id, studentInput(values), guardians, user);
    revalidate(id);
    return { id };
  });
}

export async function setStudentStatusRequest(id: number, status: StudentStatus, reason: string | null): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('STUDENTS_UPDATE');
    await students.setStudentStatus(id, status, reason, user);
    revalidate(id);
    return { id };
  });
}

export async function placeStudentRequest(id: number, streamId: number): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('CLASSES_MANAGE');
    await students.placeStudent(id, streamId, user);
    revalidate(id);
    return { id };
  });
}

export async function updateGuardianRequest(id: number, values: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('GUARDIANS_MANAGE');
    await students.updateGuardian(id, {
      fullName: str(values.full_name), phone: str(values.phone), email: str(values.email) || null, nationalId: str(values.national_id) || null,
      relationship: str(values.relationship) || null, occupation: str(values.occupation) || null, address: str(values.address) || null,
    }, user);
    revalidate();
    return { id };
  });
}

export async function deleteGuardianRequest(id: number): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => { const user = await requireAction('GUARDIANS_MANAGE'); await students.deleteGuardian(id, user); revalidate(); return { deleted: true }; });
}
