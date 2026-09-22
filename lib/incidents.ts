/*
 * Student incidents — discipline cases, medical visits, exeats (leave-outs) and general notes.
 * One log per student, visible on the student card and to the class teacher; exeats and medical
 * visits carry a follow-up date (expected back / review).
 */
import { one, all, run, audit, hasAnyRow } from './db.ts';
import { AppError } from './errors.ts';
import type { Actor, IsoDate, IsoDateTime } from './types.ts';

export type IncidentKind = 'DISCIPLINE' | 'MEDICAL' | 'EXEAT' | 'NOTE';
export const INCIDENT_KINDS: { value: IncidentKind; label: string }[] = [
  { value: 'DISCIPLINE', label: 'Discipline' }, { value: 'MEDICAL', label: 'Medical / sick bay' }, { value: 'EXEAT', label: 'Exeat / leave-out' }, { value: 'NOTE', label: 'Note' },
];

export interface StudentIncident {
  id: number;
  student_id: number;
  kind: IncidentKind;
  date: IsoDate;
  title: string;
  details: string | null;
  action_taken: string | null;
  follow_up: IsoDate | null;
  status: 'OPEN' | 'CLOSED';
  recorded_by: string | null;
  recorded_at: IsoDateTime | null;
}

export interface StudentIncidentView extends StudentIncident { admission_no: string; student_name: string; grade_level_name: string | null; stream_name: string | null }

const SELECT = `
  SELECT i.*, s.admission_no, s.first_name || ' ' || s.last_name AS student_name, g.name AS grade_level_name, st.name AS stream_name
  FROM student_incident i JOIN student s ON s.id = i.student_id
  LEFT JOIN grade_level g ON g.id = s.current_grade_level_id LEFT JOIN stream st ON st.id = s.current_stream_id`;

export const listStudentIncidents = (studentId: number): Promise<StudentIncidentView[]> =>
  all<StudentIncidentView>(`${SELECT} WHERE i.student_id = ? ORDER BY i.date DESC, i.id DESC`, studentId);

/** The school-wide log — open items first; optionally one kind or one class. */
export const listIncidents = (opts: { kind?: IncidentKind | null; streamId?: number | null; openOnly?: boolean } = {}): Promise<StudentIncidentView[]> =>
  all<StudentIncidentView>(
    `${SELECT} WHERE 1=1 ${opts.kind ? 'AND i.kind = @kind' : ''} ${opts.streamId ? 'AND s.current_stream_id = @stream' : ''} ${opts.openOnly ? "AND i.status = 'OPEN'" : ''}
     ORDER BY i.status DESC, i.date DESC, i.id DESC LIMIT 500`, { kind: opts.kind ?? null, stream: opts.streamId ?? null },
  );

export interface IncidentInput { kind: IncidentKind | string; date: IsoDate; title: string; details?: string | null; actionTaken?: string | null; followUp?: IsoDate | null; status?: string | null }

export async function saveIncident(id: number | null, studentId: number, input: IncidentInput, user: Actor): Promise<{ id: number }> {
  if (!(await hasAnyRow('student', 'id = ?', studentId))) throw new AppError('Student not found', 'NOT_FOUND');
  if (!INCIDENT_KINDS.some((k) => k.value === input.kind)) throw new AppError('Pick the kind of record', 'VALIDATION');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new AppError('A date is required', 'VALIDATION');
  if (!input.title?.trim()) throw new AppError('A short title is required', 'VALIDATION');
  if (input.followUp && !/^\d{4}-\d{2}-\d{2}$/.test(input.followUp)) throw new AppError('The follow-up date must be YYYY-MM-DD', 'VALIDATION');
  const status = input.status === 'CLOSED' ? 'CLOSED' : 'OPEN';
  if (id) {
    await run('UPDATE student_incident SET kind=?, date=?, title=?, details=?, action_taken=?, follow_up=?, status=? WHERE id=? AND student_id=?',
      input.kind, input.date, input.title.trim(), input.details?.trim() || null, input.actionTaken?.trim() || null, input.followUp || null, status, id, studentId);
    await audit(user, 'STUDENT_INCIDENT_UPDATE', 'student', studentId, { id, kind: input.kind });
    return { id };
  }
  const info = await run(
    'INSERT INTO student_incident (student_id, kind, date, title, details, action_taken, follow_up, status, recorded_by, recorded_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    studentId, input.kind, input.date, input.title.trim(), input.details?.trim() || null, input.actionTaken?.trim() || null, input.followUp || null, status, user.username, new Date().toISOString(),
  );
  await audit(user, 'STUDENT_INCIDENT_CREATE', 'student', studentId, { kind: input.kind, title: input.title });
  return { id: Number(info.lastInsertRowid) };
}

export async function deleteIncident(id: number, user: Actor): Promise<void> {
  const i = await one<{ student_id: number }>('SELECT student_id FROM student_incident WHERE id = ?', id);
  if (!i) throw new AppError('Record not found', 'NOT_FOUND');
  await run('DELETE FROM student_incident WHERE id = ?', id);
  await audit(user, 'STUDENT_INCIDENT_DELETE', 'student', i.student_id, { id });
}
