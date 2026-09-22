/*
 * Teaching staff — an employee (HR owns the record; payroll pays them) flagged as a teacher,
 * plus what they teach: subject-stream assignments per academic year, which drive the Teacher
 * Portal's "My Classes", the timetable and who may enter marks for a class.
 */
import { one, all, run, tx, audit, hasAnyRow } from '../db.ts';
import { AppError } from '../errors.ts';
import type { Actor, TeacherAssignmentView, TeacherProfile, TeacherView } from '../types.ts';

const TEACHER_SELECT = `
  SELECT tp.*, e.employee_no, e.first_name, e.last_name, e.email, e.phone, e.photo_image, e.status AS employee_status,
         (SELECT COUNT(*)::int FROM teacher_subject_assignment a JOIN academic_year y ON y.id = a.academic_year_id
          WHERE a.teacher_id = e.id AND y.is_current) AS assignments
  FROM teacher_profile tp JOIN employee e ON e.id = tp.employee_id`;

export const listTeachers = (search = ''): Promise<TeacherView[]> =>
  all<TeacherView>(
    `${TEACHER_SELECT}
     WHERE (e.employee_no ILIKE @like OR e.first_name ILIKE @like OR e.last_name ILIKE @like OR COALESCE(tp.tsc_number, '') ILIKE @like)
     ORDER BY e.status, e.last_name, e.first_name`,
    { like: `%${String(search).trim()}%` },
  );

/** Teachers who may be picked for a class, an assignment or a timetable slot. */
export const listActiveTeachers = (): Promise<TeacherView[]> =>
  all<TeacherView>(`${TEACHER_SELECT} WHERE e.status IN ('ACTIVE', 'ON_LEAVE') ORDER BY e.last_name, e.first_name`);

export const getTeacher = (employeeId: number): Promise<TeacherView | undefined> =>
  one<TeacherView>(`${TEACHER_SELECT} WHERE tp.employee_id = ?`, employeeId);

export const isTeacher = (employeeId: number): Promise<boolean> => hasAnyRow('teacher_profile', 'employee_id = ?', employeeId);

/** Employees not yet flagged as teaching staff — the pick list for "Add teaching staff". */
export const listEmployeesNotTeachers = (): Promise<{ id: number; employee_no: string; first_name: string; last_name: string; job_title: string | null }[]> =>
  all(
    `SELECT e.id, e.employee_no, e.first_name, e.last_name, e.job_title FROM employee e
     WHERE e.status IN ('ACTIVE', 'ON_LEAVE') AND NOT EXISTS (SELECT 1 FROM teacher_profile tp WHERE tp.employee_id = e.id)
     ORDER BY e.last_name, e.first_name`,
  );

export interface TeacherProfileInput { employeeId: number; tscNumber?: string | null; qualification?: string | null; specialisation?: string | null }

export async function saveTeacherProfile(input: TeacherProfileInput, user: Actor): Promise<{ id: number }> {
  const emp = await one<{ id: number; employee_no: string }>('SELECT id, employee_no FROM employee WHERE id = ?', input.employeeId);
  if (!emp) throw new AppError('Employee not found', 'NOT_FOUND');
  const existing = await one<TeacherProfile>('SELECT * FROM teacher_profile WHERE employee_id = ?', input.employeeId);
  if (existing) {
    await run('UPDATE teacher_profile SET tsc_number=?, qualification=?, specialisation=? WHERE id=?',
      input.tscNumber?.trim() || null, input.qualification?.trim() || null, input.specialisation?.trim() || null, existing.id);
    await audit(user, 'TEACHER_PROFILE_UPDATE', 'teacher_profile', existing.id, { employee: emp.employee_no });
    return { id: existing.id };
  }
  const info = await run('INSERT INTO teacher_profile (employee_id, tsc_number, qualification, specialisation) VALUES (?,?,?,?)',
    input.employeeId, input.tscNumber?.trim() || null, input.qualification?.trim() || null, input.specialisation?.trim() || null);
  await audit(user, 'TEACHER_PROFILE_CREATE', 'teacher_profile', info.lastInsertRowid, { employee: emp.employee_no });
  return { id: Number(info.lastInsertRowid) };
}

/** Un-flags an employee as teaching staff. Their HR record is untouched. */
export async function removeTeacherProfile(employeeId: number, user: Actor): Promise<void> {
  if (await hasAnyRow('stream s JOIN academic_year y ON y.id = s.academic_year_id', 's.class_teacher_id = ? AND y.is_current', employeeId)) {
    throw new AppError('This teacher is a class teacher this year — reassign the class first', 'IN_USE');
  }
  await tx(async () => {
    await run('DELETE FROM teacher_subject_assignment WHERE teacher_id = ?', employeeId);
    await run('DELETE FROM timetable_slot WHERE teacher_id = ?', employeeId);
    await run('DELETE FROM teacher_profile WHERE employee_id = ?', employeeId);
  });
  await audit(user, 'TEACHER_PROFILE_DELETE', 'teacher_profile', employeeId, {});
}

/* ---------------------------------------------------------------- assignments */

const ASSIGNMENT_SELECT = `
  SELECT a.*, sub.code AS subject_code, sub.name AS subject_name, st.name AS stream_name, g.name AS grade_level_name,
         e.first_name || ' ' || e.last_name AS teacher_name, e.employee_no,
         (SELECT COUNT(*)::int FROM student s WHERE s.current_stream_id = st.id AND s.status = 'ACTIVE') AS students
  FROM teacher_subject_assignment a
  JOIN subject sub ON sub.id = a.subject_id
  JOIN stream st ON st.id = a.stream_id
  JOIN grade_level g ON g.id = st.grade_level_id
  JOIN employee e ON e.id = a.teacher_id`;

export const listTeacherAssignments = (teacherId: number, academicYearId?: number | null): Promise<TeacherAssignmentView[]> =>
  all<TeacherAssignmentView>(
    `${ASSIGNMENT_SELECT} JOIN academic_year y ON y.id = a.academic_year_id
     WHERE a.teacher_id = ? AND ${academicYearId ? 'a.academic_year_id = ?' : 'y.is_current'}
     ORDER BY g.sort, st.name, sub.name`,
    ...(academicYearId ? [teacherId, academicYearId] : [teacherId]),
  );

export const listStreamAssignments = (streamId: number): Promise<TeacherAssignmentView[]> =>
  all<TeacherAssignmentView>(`${ASSIGNMENT_SELECT} WHERE a.stream_id = ? ORDER BY sub.name`, streamId);

/** Whether this teacher teaches this subject to this stream (or is its class teacher) this year. */
export async function teacherTeaches(teacherId: number, streamId: number, subjectId?: number | null): Promise<boolean> {
  if (await hasAnyRow('stream', 'id = ? AND class_teacher_id = ?', streamId, teacherId)) return true;
  return hasAnyRow('teacher_subject_assignment a JOIN academic_year y ON y.id = a.academic_year_id',
    `a.teacher_id = ? AND a.stream_id = ? AND y.is_current ${subjectId ? 'AND a.subject_id = ?' : ''}`,
    ...(subjectId ? [teacherId, streamId, subjectId] : [teacherId, streamId]));
}

export async function assignTeacher(teacherId: number, subjectId: number, streamId: number, user: Actor): Promise<{ id: number }> {
  if (!(await isTeacher(teacherId))) throw new AppError('Only teaching staff can be assigned a class', 'VALIDATION');
  const st = await one<{ academic_year_id: number; grade_level_id: number }>('SELECT academic_year_id, grade_level_id FROM stream WHERE id = ?', streamId);
  if (!st) throw new AppError('Class not found', 'NOT_FOUND');
  if (!(await hasAnyRow('subject_offering', 'subject_id = ? AND grade_level_id = ?', subjectId, st.grade_level_id))) {
    throw new AppError('That subject is not offered in this grade — add it under Subjects first', 'VALIDATION');
  }
  const existing = await one<{ id: number }>(
    'SELECT id FROM teacher_subject_assignment WHERE teacher_id = ? AND subject_id = ? AND stream_id = ? AND academic_year_id = ?',
    teacherId, subjectId, streamId, st.academic_year_id,
  );
  if (existing) return { id: existing.id };
  const info = await run('INSERT INTO teacher_subject_assignment (teacher_id, subject_id, stream_id, academic_year_id) VALUES (?,?,?,?)',
    teacherId, subjectId, streamId, st.academic_year_id);
  await audit(user, 'TEACHER_ASSIGN', 'teacher_subject_assignment', info.lastInsertRowid, { teacherId, subjectId, streamId });
  return { id: Number(info.lastInsertRowid) };
}

export async function unassignTeacher(assignmentId: number, user: Actor): Promise<void> {
  await run('DELETE FROM teacher_subject_assignment WHERE id = ?', assignmentId);
  await audit(user, 'TEACHER_UNASSIGN', 'teacher_subject_assignment', assignmentId, {});
}
