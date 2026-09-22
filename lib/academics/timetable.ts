/*
 * Timetable — one slot per (stream, day, start time) in a term. A teacher cannot be in two rooms
 * at once and a stream cannot have two lessons at once; both are checked on save.
 */
import { one, all, run, audit, hasAnyRow } from '../db.ts';
import { AppError } from '../errors.ts';
import type { Actor, TimetableSlotView } from '../types.ts';

export { DAY_NAMES } from '../constants.ts';

const SLOT_SELECT = `
  SELECT ts.*, sub.name AS subject_name, sub.code AS subject_code, e.first_name || ' ' || e.last_name AS teacher_name,
         st.name AS stream_name, g.name AS grade_level_name
  FROM timetable_slot ts
  JOIN subject sub ON sub.id = ts.subject_id
  JOIN employee e ON e.id = ts.teacher_id
  JOIN stream st ON st.id = ts.stream_id
  JOIN grade_level g ON g.id = st.grade_level_id`;

export const listStreamTimetable = (streamId: number, termId: number): Promise<TimetableSlotView[]> =>
  all<TimetableSlotView>(`${SLOT_SELECT} WHERE ts.stream_id = ? AND ts.term_id = ? ORDER BY ts.day_of_week, ts.start_time`, streamId, termId);

export const listTeacherTimetable = (teacherId: number, termId: number): Promise<TimetableSlotView[]> =>
  all<TimetableSlotView>(`${SLOT_SELECT} WHERE ts.teacher_id = ? AND ts.term_id = ? ORDER BY ts.day_of_week, ts.start_time`, teacherId, termId);

export interface SlotInput {
  streamId: number; subjectId: number; teacherId: number; termId: number;
  dayOfWeek: number; startTime: string; endTime: string; room?: string | null;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

async function assertSlot(i: SlotInput, excludeId: number | null): Promise<{ academic_year_id: number }> {
  if (!(i.dayOfWeek >= 1 && i.dayOfWeek <= 7)) throw new AppError('Pick a day of the week', 'VALIDATION');
  if (!TIME.test(i.startTime) || !TIME.test(i.endTime)) throw new AppError('Times must be HH:mm', 'VALIDATION');
  if (i.startTime >= i.endTime) throw new AppError('The lesson must end after it starts', 'VALIDATION');
  const term = await one<{ academic_year_id: number }>('SELECT academic_year_id FROM academic_term WHERE id = ?', i.termId);
  if (!term) throw new AppError('Term not found', 'NOT_FOUND');
  const st = await one<{ academic_year_id: number; grade_level_id: number }>('SELECT academic_year_id, grade_level_id FROM stream WHERE id = ?', i.streamId);
  if (!st) throw new AppError('Class not found', 'NOT_FOUND');
  if (st.academic_year_id !== term.academic_year_id) throw new AppError('The class and the term belong to different academic years', 'VALIDATION');
  if (!(await hasAnyRow('teacher_profile', 'employee_id = ?', i.teacherId))) throw new AppError('Pick a member of teaching staff', 'VALIDATION');
  if (!(await hasAnyRow('subject_offering', 'subject_id = ? AND grade_level_id = ?', i.subjectId, st.grade_level_id))) {
    throw new AppError('That subject is not offered in this grade', 'VALIDATION');
  }
  const overlap = `term_id = ? AND day_of_week = ? AND start_time < ? AND end_time > ? ${excludeId ? 'AND id <> ?' : ''}`;
  const extra = excludeId ? [excludeId] : [];
  if (await hasAnyRow('timetable_slot', `stream_id = ? AND ${overlap}`, i.streamId, i.termId, i.dayOfWeek, i.endTime, i.startTime, ...extra)) {
    throw new AppError('The class already has a lesson in that slot', 'VALIDATION');
  }
  const clash = await one<{ stream_name: string; subject_name: string }>(
    `SELECT st.name AS stream_name, sub.name AS subject_name FROM timetable_slot ts
     JOIN stream st ON st.id = ts.stream_id JOIN subject sub ON sub.id = ts.subject_id
     WHERE ts.teacher_id = ? AND ts.${overlap} LIMIT 1`, i.teacherId, i.termId, i.dayOfWeek, i.endTime, i.startTime, ...extra,
  );
  if (clash) throw new AppError(`The teacher is already timetabled for ${clash.subject_name} with ${clash.stream_name} at that time`, 'VALIDATION');
  return term;
}

export async function saveSlot(id: number | null, input: SlotInput, user: Actor): Promise<{ id: number }> {
  const term = await assertSlot(input, id);
  if (id) {
    await run('UPDATE timetable_slot SET stream_id=?, subject_id=?, teacher_id=?, academic_year_id=?, term_id=?, day_of_week=?, start_time=?, end_time=?, room=? WHERE id=?',
      input.streamId, input.subjectId, input.teacherId, term.academic_year_id, input.termId, input.dayOfWeek, input.startTime, input.endTime, input.room?.trim() || null, id);
    await audit(user, 'TIMETABLE_SLOT_UPDATE', 'timetable_slot', id, {});
    return { id };
  }
  const info = await run(
    'INSERT INTO timetable_slot (stream_id, subject_id, teacher_id, academic_year_id, term_id, day_of_week, start_time, end_time, room) VALUES (?,?,?,?,?,?,?,?,?)',
    input.streamId, input.subjectId, input.teacherId, term.academic_year_id, input.termId, input.dayOfWeek, input.startTime, input.endTime, input.room?.trim() || null,
  );
  await audit(user, 'TIMETABLE_SLOT_CREATE', 'timetable_slot', info.lastInsertRowid, { stream: input.streamId, day: input.dayOfWeek });
  return { id: Number(info.lastInsertRowid) };
}

export async function deleteSlot(id: number, user: Actor): Promise<void> {
  await run('DELETE FROM timetable_slot WHERE id = ?', id);
  await audit(user, 'TIMETABLE_SLOT_DELETE', 'timetable_slot', id, {});
}

/** Copies one term's timetable for a stream into another term of the same year (nothing is overwritten). */
export async function copyTimetable(streamId: number, fromTermId: number, toTermId: number, user: Actor): Promise<{ copied: number }> {
  if (fromTermId === toTermId) throw new AppError('Pick a different term to copy into', 'VALIDATION');
  const slots = await all<{ subject_id: number; teacher_id: number; academic_year_id: number; day_of_week: number; start_time: string; end_time: string; room: string | null }>(
    'SELECT subject_id, teacher_id, academic_year_id, day_of_week, start_time, end_time, room FROM timetable_slot WHERE stream_id = ? AND term_id = ?', streamId, fromTermId,
  );
  let copied = 0;
  for (const s of slots) {
    try {
      await saveSlot(null, { streamId, subjectId: s.subject_id, teacherId: s.teacher_id, termId: toTermId, dayOfWeek: s.day_of_week, startTime: s.start_time, endTime: s.end_time, room: s.room }, user);
      copied += 1;
    } catch {
      // A slot that clashes in the target term is skipped; the rest still copy.
    }
  }
  return { copied };
}
