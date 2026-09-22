import 'server-only';
import { portalStudents } from '@/lib/portal';
import { resolveTerm } from '@/lib/academics/setup';
import type { AcademicTermWithYear, SessionUser, StudentListRow } from '@/lib/types';

export interface PortalScope {
  kind: 'STUDENT' | 'GUARDIAN';
  students: StudentListRow[];
  /** The child the page is about — `?student=` when it is one of ours, else the first. */
  student: StudentListRow;
  term: AcademicTermWithYear | undefined;
}

/** Who the portal login is and which child the page shows — never trusting the URL beyond picking among their own. */
export async function loadPortalScope(user: SessionUser, studentParam?: string, termParam?: string): Promise<PortalScope | { error: string }> {
  let scope: Awaited<ReturnType<typeof portalStudents>>;
  try { scope = await portalStudents(user); } catch (e) { return { error: (e as Error).message }; }
  if (!scope.students.length) return { error: 'No student is linked to this login yet — ask the school office.' };
  const student = scope.students.find((s) => String(s.id) === studentParam) ?? scope.students[0];
  const term = await resolveTerm(termParam ? Number(termParam) : null);
  return { ...scope, student, term };
}

export const isPortalScope = (s: PortalScope | { error: string }): s is PortalScope => !('error' in s);
