/*
 * Attendance — the daily register per class. One row per student per day; marking the register
 * again for the same day updates it (a late arrival marked absent at 8am is corrected at 9).
 */
import { one, all, run, tx, audit } from '../db.ts';
import { AppError } from '../errors.ts';
import type { Actor, AttendanceRecord, AttendanceStatus, AttendanceSummary, IsoDate } from '../types.ts';

export const ATTENDANCE_STATUSES: AttendanceStatus[] = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'];

export const listRegister = (streamId: number, date: IsoDate): Promise<AttendanceRecord[]> =>
  all<AttendanceRecord>('SELECT * FROM attendance_record WHERE stream_id = ? AND date = ? ORDER BY student_id', streamId, date);

export interface RegisterMark { studentId: number; status: AttendanceStatus; remarks?: string | null }

export async function markRegister(streamId: number, date: IsoDate, marks: RegisterMark[], user: Actor): Promise<{ marked: number }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError('The register date must be YYYY-MM-DD', 'VALIDATION');
  if (date > new Date().toISOString().slice(0, 10)) throw new AppError('A register cannot be taken for a future date', 'VALIDATION');
  const roster = new Set((await all<{ id: number }>("SELECT id FROM student WHERE current_stream_id = ? AND status = 'ACTIVE'", streamId)).map((r) => r.id));
  const at = new Date().toISOString();
  let marked = 0;
  await tx(async () => {
    for (const m of marks) {
      if (!roster.has(Number(m.studentId))) continue;
      if (!ATTENDANCE_STATUSES.includes(m.status)) throw new AppError(`Invalid attendance status ${m.status}`, 'VALIDATION');
      await run(
        `INSERT INTO attendance_record (student_id, stream_id, date, status, remarks, recorded_by, recorded_at) VALUES (?,?,?,?,?,?,?)
         ON CONFLICT (student_id, date) DO UPDATE SET stream_id = EXCLUDED.stream_id, status = EXCLUDED.status, remarks = EXCLUDED.remarks,
           recorded_by = EXCLUDED.recorded_by, recorded_at = EXCLUDED.recorded_at`,
        m.studentId, streamId, date, m.status, m.remarks?.trim() || null, user.username, at,
      );
      marked += 1;
    }
  });
  await audit(user, 'ATTENDANCE_MARK', 'stream', streamId, { date, marked });
  return { marked };
}

const summarise = (r: { present: number; absent: number; late: number; excused: number } | undefined): AttendanceSummary => {
  const present = Number(r?.present ?? 0); const absent = Number(r?.absent ?? 0); const late = Number(r?.late ?? 0); const excused = Number(r?.excused ?? 0);
  const total = present + absent + late + excused;
  return { present, absent, late, excused, total, rate: total ? Number((((present + late) / total) * 100).toFixed(1)) : 0 };
};

const SUMMARY_SQL = `
  SELECT COALESCE(SUM(CASE WHEN status = 'PRESENT' THEN 1 ELSE 0 END), 0)::int AS present,
         COALESCE(SUM(CASE WHEN status = 'ABSENT' THEN 1 ELSE 0 END), 0)::int AS absent,
         COALESCE(SUM(CASE WHEN status = 'LATE' THEN 1 ELSE 0 END), 0)::int AS late,
         COALESCE(SUM(CASE WHEN status = 'EXCUSED' THEN 1 ELSE 0 END), 0)::int AS excused
  FROM attendance_record`;

/** A student's attendance over a date range (a term). */
export async function studentAttendanceSummary(studentId: number, from: IsoDate, to: IsoDate): Promise<AttendanceSummary> {
  return summarise(await one(`${SUMMARY_SQL} WHERE student_id = ? AND date BETWEEN ? AND ?`, studentId, from, to));
}

export async function streamAttendanceSummary(streamId: number, from: IsoDate, to: IsoDate): Promise<AttendanceSummary> {
  return summarise(await one(`${SUMMARY_SQL} WHERE stream_id = ? AND date BETWEEN ? AND ?`, streamId, from, to));
}

export const listStudentAttendance = (studentId: number, from: IsoDate, to: IsoDate): Promise<AttendanceRecord[]> =>
  all<AttendanceRecord>('SELECT * FROM attendance_record WHERE student_id = ? AND date BETWEEN ? AND ? ORDER BY date DESC', studentId, from, to);

/** Which days a class has a register taken — the calendar strip on the attendance page. */
export const listRegisterDays = (streamId: number, from: IsoDate, to: IsoDate): Promise<{ date: IsoDate; marked: number; absent: number }[]> =>
  all(
    `SELECT date, COUNT(*)::int AS marked, COALESCE(SUM(CASE WHEN status = 'ABSENT' THEN 1 ELSE 0 END), 0)::int AS absent
     FROM attendance_record WHERE stream_id = ? AND date BETWEEN ? AND ? GROUP BY date ORDER BY date DESC`, streamId, from, to,
  );
