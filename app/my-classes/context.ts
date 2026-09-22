import 'server-only';
import { all } from '@/lib/db';
import { getPortalLinks } from '@/lib/portal';
import { getCurrentAcademicYear, getCurrentTerm, listStreams } from '@/lib/academics/setup';
import { listTeacherAssignments } from '@/lib/academics/teachers';
import type { AcademicTermWithYear, AcademicYear, SessionUser, StreamView, TeacherAssignmentView } from '@/lib/types';

export interface TeacherContext {
  teacherId: number;
  year: AcademicYear | undefined;
  term: AcademicTermWithYear | undefined;
  /** Every class this teacher touches this year — as class teacher or subject teacher. */
  streams: (StreamView & { isClassTeacher: boolean; subjects: TeacherAssignmentView[] })[];
  assignments: TeacherAssignmentView[];
}

/**
 * Who the signed-in teacher is and what they teach — resolved from User Setup, never from the
 * URL. Returns the reason instead when the login is not matched to teaching staff, so each
 * portal page can show the same "ask the office" note.
 */
export async function loadTeacherContext(user: SessionUser): Promise<TeacherContext | { error: string }> {
  const links = await getPortalLinks(user.id);
  if (!links.employee_id) return { error: 'Your login is not matched to a member of staff — ask an administrator to set your Employee No. under Admin Centre → System Security → User Setup.' };
  if (!links.is_teacher) return { error: 'Your login is not marked as a teacher — ask an administrator to tick Teacher under Admin Centre → User Setup.' };
  const teacherId = links.employee_id;
  const [year, term] = await Promise.all([getCurrentAcademicYear(), getCurrentTerm()]);
  const [assignments, all_streams, classTeacherOf] = await Promise.all([
    listTeacherAssignments(teacherId, year?.id), listStreams(year?.id ?? null),
    all<{ id: number }>('SELECT s.id FROM stream s JOIN academic_year y ON y.id = s.academic_year_id WHERE y.is_current AND s.class_teacher_id = ?', teacherId),
  ]);
  const mine = new Set([...assignments.map((a) => a.stream_id), ...classTeacherOf.map((c) => c.id)]);
  const ct = new Set(classTeacherOf.map((c) => c.id));
  const streams = all_streams.filter((s) => mine.has(s.id)).map((s) => ({ ...s, isClassTeacher: ct.has(s.id), subjects: assignments.filter((a) => a.stream_id === s.id) }));
  return { teacherId, year, term, streams, assignments };
}

export const isTeacherContext = (c: TeacherContext | { error: string }): c is TeacherContext => !('error' in c);
