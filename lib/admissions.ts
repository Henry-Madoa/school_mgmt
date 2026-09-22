/*
 * The admissions pipeline — an enquiry becomes an application, an offer, then a student. Admitting
 * hands the application to lib/students.ts admitStudent(), so an admitted applicant is a normal
 * student with a fee account and a guardian; the application keeps the student id it became.
 */
import { one, all, run, audit, nextSequence, hasAnyRow } from './db.ts';
import { AppError } from './errors.ts';
import { assertContactDetails } from './validate.ts';
import { admitStudent } from './students.ts';
import type { Actor, IsoDate, IsoDateTime } from './types.ts';

export type ApplicationStatus = 'ENQUIRY' | 'APPLIED' | 'OFFERED' | 'ADMITTED' | 'DECLINED';
export const APPLICATION_STATUSES: ApplicationStatus[] = ['ENQUIRY', 'APPLIED', 'OFFERED', 'ADMITTED', 'DECLINED'];

export interface AdmissionApplication {
  id: number;
  no: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  gender: string | null;
  date_of_birth: IsoDate | null;
  previous_school: string | null;
  grade_level_id: number;
  academic_year_id: number;
  boarding_status: string;
  guardian_name: string;
  guardian_phone: string;
  guardian_email: string | null;
  guardian_relationship: string;
  notes: string | null;
  status: ApplicationStatus;
  student_id: number | null;
  applied_at: IsoDateTime;
  decided_at: IsoDateTime | null;
  created_by: string | null;
}

export interface AdmissionApplicationView extends AdmissionApplication {
  grade_level_name: string;
  year_name: string;
  admission_no: string | null;
}

const SELECT = `
  SELECT a.*, g.name AS grade_level_name, y.name AS year_name, s.admission_no
  FROM admission_application a
  JOIN grade_level g ON g.id = a.grade_level_id
  JOIN academic_year y ON y.id = a.academic_year_id
  LEFT JOIN student s ON s.id = a.student_id`;

export const listApplications = (status?: ApplicationStatus | 'OPEN' | null, search = ''): Promise<AdmissionApplicationView[]> =>
  all<AdmissionApplicationView>(
    `${SELECT}
     WHERE (a.first_name ILIKE @like OR a.last_name ILIKE @like OR a.no ILIKE @like OR a.guardian_name ILIKE @like OR a.guardian_phone ILIKE @like)
       ${status === 'OPEN' ? "AND a.status IN ('ENQUIRY','APPLIED','OFFERED')" : status ? 'AND a.status = @status' : ''}
     ORDER BY a.applied_at DESC LIMIT 500`,
    { like: `%${search.trim()}%`, status: status ?? null },
  );

export const getApplication = (id: number): Promise<AdmissionApplicationView | undefined> => one<AdmissionApplicationView>(`${SELECT} WHERE a.id = ?`, id);

export const applicationCounts = (): Promise<{ status: ApplicationStatus; n: number }[]> =>
  all('SELECT status, COUNT(*)::int AS n FROM admission_application GROUP BY status');

export interface ApplicationInput {
  firstName: string; middleName?: string | null; lastName: string; gender?: string | null; dateOfBirth?: string | null; previousSchool?: string | null;
  gradeLevelId: number; academicYearId: number; boardingStatus?: string | null;
  guardianName: string; guardianPhone: string; guardianEmail?: string | null; guardianRelationship?: string | null; notes?: string | null;
  status?: ApplicationStatus | null;
}

function assertInput(i: ApplicationInput): void {
  if (!i.firstName?.trim() || !i.lastName?.trim()) throw new AppError('The applicant needs a first and last name', 'VALIDATION');
  if (!i.guardianName?.trim() || !i.guardianPhone?.trim()) throw new AppError('A guardian name and phone are required — that is who the school follows up with', 'VALIDATION');
  assertContactDetails({ phone: i.guardianPhone, email: i.guardianEmail });
  if (i.dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(i.dateOfBirth)) throw new AppError('Date of birth must be YYYY-MM-DD', 'VALIDATION');
  if (i.status && !APPLICATION_STATUSES.includes(i.status)) throw new AppError('Invalid status', 'VALIDATION');
}

export async function saveApplication(id: number | null, input: ApplicationInput, user: Actor): Promise<{ id: number; no: string }> {
  assertInput(input);
  if (!(await hasAnyRow('grade_level', 'id = ?', input.gradeLevelId))) throw new AppError('Pick the grade applied for', 'VALIDATION');
  if (!(await hasAnyRow('academic_year', 'id = ?', input.academicYearId))) throw new AppError('Pick the academic year', 'VALIDATION');
  const status = input.status ?? 'ENQUIRY';
  if (id) {
    const before = await one<AdmissionApplication>('SELECT * FROM admission_application WHERE id = ?', id);
    if (!before) throw new AppError('Application not found', 'NOT_FOUND');
    if (before.status === 'ADMITTED') throw new AppError('An admitted application is closed — edit the student instead', 'VALIDATION');
    if (status === 'ADMITTED') throw new AppError('Use Admit to admit an applicant', 'VALIDATION');
    await run(
      `UPDATE admission_application SET first_name=?, middle_name=?, last_name=?, gender=?, date_of_birth=?, previous_school=?, grade_level_id=?, academic_year_id=?, boarding_status=?,
         guardian_name=?, guardian_phone=?, guardian_email=?, guardian_relationship=?, notes=?, status=?, decided_at=? WHERE id=?`,
      input.firstName.trim(), input.middleName?.trim() || null, input.lastName.trim(), input.gender || null, input.dateOfBirth || null, input.previousSchool?.trim() || null,
      input.gradeLevelId, input.academicYearId, input.boardingStatus === 'BOARDER' ? 'BOARDER' : 'DAY',
      input.guardianName.trim(), input.guardianPhone.trim(), input.guardianEmail?.trim() || null, input.guardianRelationship?.trim() || 'Parent', input.notes?.trim() || null,
      status, status === 'DECLINED' ? new Date().toISOString() : null, id,
    );
    await audit(user, 'ADMISSION_APPLICATION_UPDATE', 'admission_application', before.no, { status });
    return { id, no: before.no };
  }
  const no = await nextSequence('ADMISSION_APPLICATION');
  const info = await run(
    `INSERT INTO admission_application (no, first_name, middle_name, last_name, gender, date_of_birth, previous_school, grade_level_id, academic_year_id, boarding_status,
       guardian_name, guardian_phone, guardian_email, guardian_relationship, notes, status, applied_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    no, input.firstName.trim(), input.middleName?.trim() || null, input.lastName.trim(), input.gender || null, input.dateOfBirth || null, input.previousSchool?.trim() || null,
    input.gradeLevelId, input.academicYearId, input.boardingStatus === 'BOARDER' ? 'BOARDER' : 'DAY',
    input.guardianName.trim(), input.guardianPhone.trim(), input.guardianEmail?.trim() || null, input.guardianRelationship?.trim() || 'Parent', input.notes?.trim() || null,
    status === 'ADMITTED' ? 'ENQUIRY' : status, new Date().toISOString(), user.username,
  );
  await audit(user, 'ADMISSION_APPLICATION_CREATE', 'admission_application', no, { status });
  return { id: Number(info.lastInsertRowid), no };
}

/** Moves an application along the pipeline (enquiry → applied → offered → declined). */
export async function setApplicationStatus(id: number, status: ApplicationStatus, user: Actor): Promise<void> {
  if (!APPLICATION_STATUSES.includes(status) || status === 'ADMITTED') throw new AppError('Use Admit to admit an applicant', 'VALIDATION');
  const a = await one<AdmissionApplication>('SELECT * FROM admission_application WHERE id = ?', id);
  if (!a) throw new AppError('Application not found', 'NOT_FOUND');
  if (a.status === 'ADMITTED') throw new AppError('This applicant has already been admitted', 'VALIDATION');
  await run('UPDATE admission_application SET status = ?, decided_at = ? WHERE id = ?', status, status === 'DECLINED' ? new Date().toISOString() : null, id);
  await audit(user, 'ADMISSION_APPLICATION_STATUS', 'admission_application', a.no, { from: a.status, to: status });
}

/** Admits the applicant into a class: creates the student (with the guardian and fee account) and closes the application. */
export async function admitApplication(id: number, streamId: number, admissionDate: IsoDate, admissionNo: string | null, user: Actor): Promise<{ studentId: number; admissionNo: string }> {
  const a = await one<AdmissionApplication>('SELECT * FROM admission_application WHERE id = ?', id);
  if (!a) throw new AppError('Application not found', 'NOT_FOUND');
  if (a.status === 'ADMITTED') throw new AppError('This applicant has already been admitted', 'VALIDATION');
  if (a.status === 'DECLINED') throw new AppError('A declined application cannot be admitted — reopen it first', 'VALIDATION');
  const r = await admitStudent({
    firstName: a.first_name, middleName: a.middle_name, lastName: a.last_name, gender: a.gender, dateOfBirth: a.date_of_birth,
    admissionDate, admissionNo, streamId, boardingStatus: a.boarding_status, medicalNotes: null,
  }, [{ fullName: a.guardian_name, phone: a.guardian_phone, email: a.guardian_email, relationship: a.guardian_relationship, isPrimary: true }], user);
  await run("UPDATE admission_application SET status = 'ADMITTED', student_id = ?, decided_at = ? WHERE id = ?", r.id, new Date().toISOString(), id);
  await audit(user, 'ADMISSION_APPLICATION_ADMIT', 'admission_application', a.no, { studentId: r.id, admissionNo: r.admissionNo });
  return { studentId: r.id, admissionNo: r.admissionNo };
}
