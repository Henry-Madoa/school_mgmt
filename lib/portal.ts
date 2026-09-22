/*
 * Portal scoping — who a login IS in the school, per User Setup (approval_user_setup): the
 * employee behind a teacher, the student behind a student login, the guardian behind a parent
 * login. Every Teacher / Student / Parent portal page and action resolves its subject through
 * here rather than trusting an id from the browser — the same row-level rule Employee Self
 * Service applies (lib/selfService.ts).
 */
import { one, all } from './db.ts';
import { AppError, ForbiddenError } from './errors.ts';
import { listGuardianStudents } from './students.ts';
import { teacherTeaches } from './academics/teachers.ts';
import type { SessionUser, StudentListRow } from './types.ts';

export interface PortalLinks {
  employee_id: number | null;
  student_id: number | null;
  guardian_id: number | null;
}

export const getPortalLinks = async (userId: number): Promise<PortalLinks> =>
  (await one<PortalLinks>('SELECT employee_id, student_id, guardian_id FROM approval_user_setup WHERE user_id = ?', userId))
    ?? { employee_id: null, student_id: null, guardian_id: null };

/** The teacher (employee id) this login is — refused when the login is not matched to teaching staff. */
export async function requireTeacher(user: Pick<SessionUser, 'id'>): Promise<number> {
  const links = await getPortalLinks(user.id);
  if (!links.employee_id) {
    throw new AppError('Your login is not matched to a member of staff — ask an administrator to set your Employee No. under Admin Centre → User Setup', 'NO_EMPLOYEE');
  }
  const isTeacher = await one('SELECT 1 FROM teacher_profile WHERE employee_id = ?', links.employee_id);
  if (!isTeacher) throw new AppError('Your staff record is not flagged as teaching staff — ask the academics office to add you under Teaching Staff', 'NO_EMPLOYEE');
  return links.employee_id;
}

/** Refuses a teacher reaching for a class (and subject) they do not teach. */
export async function assertTeacherOnStream(teacherId: number, streamId: number, subjectId?: number | null): Promise<void> {
  if (!(await teacherTeaches(teacherId, streamId, subjectId))) throw new ForbiddenError('You are not assigned to that class');
}

/**
 * The students a Student/Parent portal login may see: the student themselves, or every child of
 * the guardian. A login matched to neither is refused with a message that says who fixes it.
 */
export async function portalStudents(user: Pick<SessionUser, 'id'>): Promise<{ kind: 'STUDENT' | 'GUARDIAN'; students: StudentListRow[] }> {
  const links = await getPortalLinks(user.id);
  if (links.student_id) {
    const rows = await all<StudentListRow>(
      `SELECT s.*, g.name AS grade_level_name, st.name AS stream_name, NULL::text AS primary_guardian_name, NULL::text AS primary_guardian_phone,
              COALESCE(c.balance, 0) AS fee_balance
       FROM student s LEFT JOIN grade_level g ON g.id = s.current_grade_level_id LEFT JOIN stream st ON st.id = s.current_stream_id
       LEFT JOIN customer c ON c.id = s.customer_id WHERE s.id = ?`, links.student_id,
    );
    return { kind: 'STUDENT', students: rows };
  }
  if (links.guardian_id) return { kind: 'GUARDIAN', students: await listGuardianStudents(links.guardian_id) };
  throw new AppError('Your login is not matched to a student or guardian — ask the school office to link it under Admin Centre → User Setup', 'NO_EMPLOYEE');
}

/** One of the portal login's students, by id — refused when it is somebody else's child. */
export async function requirePortalStudent(user: Pick<SessionUser, 'id'>, studentId: number): Promise<StudentListRow> {
  const { students } = await portalStudents(user);
  const s = students.find((x) => x.id === studentId) ?? (studentId ? undefined : students[0]);
  if (!s) throw new ForbiddenError('That student is not on your account');
  return s;
}

/** The logins linked to a guardian or a student — shown on their cards so the office can see who has portal access. */
export const listPortalLogins = (subject: { guardianId?: number; studentId?: number; employeeId?: number }): Promise<{ user_id: number; username: string; full_name: string }[]> =>
  all(
    `SELECT u.id AS user_id, u.username, u.full_name FROM approval_user_setup s JOIN app_user u ON u.id = s.user_id
     WHERE ${subject.guardianId ? 's.guardian_id = ?' : subject.employeeId ? 's.employee_id = ?' : 's.student_id = ?'} ORDER BY u.username`,
    subject.guardianId ?? subject.employeeId ?? subject.studentId,
  );
