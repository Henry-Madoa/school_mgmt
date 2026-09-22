/*
 * Hostel (boarding) — blocks, rooms and beds, and who sleeps where. A bed holds one boarder at
 * a time; a boarder has one bed; a boys' block takes boys, a girls' block girls. Allocations are
 * kept, not overwritten, so a student's bed history reads like their enrolment history.
 */
import { one, all, run, tx, audit, hasAnyRow } from './db.ts';
import { AppError } from './errors.ts';
import type { Actor, BedAllocationView, BedView, HostelBed, HostelRoom, HostelView, IsoDate } from './types.ts';

const now = () => new Date().toISOString();

export const listHostels = (): Promise<HostelView[]> =>
  all<HostelView>(
    `SELECT h.*, CASE WHEN e.id IS NULL THEN NULL ELSE e.first_name || ' ' || e.last_name END AS warden_name,
            (SELECT COUNT(*)::int FROM hostel_room r WHERE r.hostel_id = h.id) AS rooms,
            (SELECT COUNT(*)::int FROM hostel_bed b JOIN hostel_room r ON r.id = b.room_id WHERE r.hostel_id = h.id AND b.status = 'AVAILABLE') AS beds,
            (SELECT COUNT(*)::int FROM bed_allocation a JOIN hostel_bed b ON b.id = a.bed_id JOIN hostel_room r ON r.id = b.room_id WHERE r.hostel_id = h.id AND a.status = 'ACTIVE') AS occupied
     FROM hostel h LEFT JOIN employee e ON e.id = h.warden_employee_id ORDER BY h.status, h.code`,
  );
export const getHostel = async (id: number): Promise<HostelView | undefined> => (await listHostels()).find((h) => h.id === id);

export interface HostelInput { code: string; name: string; gender?: string | null; wardenEmployeeId?: number | null; status?: string | null; notes?: string | null }

export async function saveHostel(id: number | null, input: HostelInput, user: Actor): Promise<{ id: number }> {
  const code = String(input.code || '').trim().toUpperCase();
  const name = String(input.name || '').trim();
  if (!code || !name) throw new AppError('A hostel needs a code and a name', 'VALIDATION');
  const gender = ['MALE', 'FEMALE', 'MIXED'].includes(String(input.gender)) ? String(input.gender) : 'MIXED';
  if (input.wardenEmployeeId && !(await hasAnyRow('employee', 'id = ?', input.wardenEmployeeId))) throw new AppError('Warden not found', 'NOT_FOUND');
  if (await hasAnyRow('hostel', `code = ? ${id ? 'AND id <> ?' : ''}`, ...(id ? [code, id] : [code]))) throw new AppError(`Hostel ${code} already exists`, 'DUPLICATE');
  const status = input.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
  if (id) {
    await run('UPDATE hostel SET code=?, name=?, gender=?, warden_employee_id=?, status=?, notes=? WHERE id=?', code, name, gender, input.wardenEmployeeId || null, status, input.notes?.trim() || null, id);
    await audit(user, 'HOSTEL_UPDATE', 'hostel', id, { code });
    return { id };
  }
  const info = await run('INSERT INTO hostel (code, name, gender, warden_employee_id, status, notes) VALUES (?,?,?,?,?,?)', code, name, gender, input.wardenEmployeeId || null, status, input.notes?.trim() || null);
  await audit(user, 'HOSTEL_CREATE', 'hostel', info.lastInsertRowid, { code });
  return { id: Number(info.lastInsertRowid) };
}

/* ------------------------------------------------------------- rooms & beds */

export const listRooms = (hostelId: number): Promise<HostelRoom[]> => all<HostelRoom>('SELECT * FROM hostel_room WHERE hostel_id = ? ORDER BY sort, name', hostelId);

/** Every bed in a hostel with its occupant, room by room. */
export const listBeds = (hostelId?: number | null): Promise<BedView[]> =>
  all<BedView>(
    `SELECT b.*, r.name AS room_name, r.hostel_id, h.name AS hostel_name, h.gender AS hostel_gender,
            a.id AS allocation_id, s.id AS student_id, s.admission_no, CASE WHEN s.id IS NULL THEN NULL ELSE s.first_name || ' ' || s.last_name END AS student_name, g.name AS grade_level_name, a.from_date AS since
     FROM hostel_bed b JOIN hostel_room r ON r.id = b.room_id JOIN hostel h ON h.id = r.hostel_id
     LEFT JOIN bed_allocation a ON a.bed_id = b.id AND a.status = 'ACTIVE'
     LEFT JOIN student s ON s.id = a.student_id LEFT JOIN grade_level g ON g.id = s.current_grade_level_id
     WHERE 1=1 ${hostelId ? 'AND r.hostel_id = ?' : ''} ORDER BY h.code, r.sort, r.name, b.label`, ...(hostelId ? [hostelId] : []),
  );

/** Adds a room with N beds labelled 1..N (or grows an existing room to N beds). */
export async function saveRoom(hostelId: number, input: { id?: number | null; name: string; floor?: string | null; beds: number }, user: Actor): Promise<{ id: number }> {
  const name = String(input.name || '').trim();
  if (!name) throw new AppError('The room needs a name, e.g. Room 1', 'VALIDATION');
  const beds = Math.max(0, Math.round(Number(input.beds) || 0));
  if (!(await hasAnyRow('hostel', 'id = ?', hostelId))) throw new AppError('Hostel not found', 'NOT_FOUND');
  return tx(async () => {
    let roomId = input.id ? Number(input.id) : null;
    if (roomId) {
      await run('UPDATE hostel_room SET name=?, floor=? WHERE id=? AND hostel_id=?', name, input.floor?.trim() || null, roomId, hostelId);
    } else {
      if (await hasAnyRow('hostel_room', 'hostel_id = ? AND name = ?', hostelId, name)) throw new AppError('That room already exists', 'DUPLICATE');
      const sort = ((await one<{ m: number }>('SELECT COALESCE(MAX(sort), 0) AS m FROM hostel_room WHERE hostel_id = ?', hostelId))?.m ?? 0) + 1;
      const info = await run('INSERT INTO hostel_room (hostel_id, name, floor, sort) VALUES (?,?,?,?)', hostelId, name, input.floor?.trim() || null, sort);
      roomId = Number(info.lastInsertRowid);
    }
    const existing = (await one<{ c: number }>('SELECT COUNT(*)::int c FROM hostel_bed WHERE room_id = ?', roomId))!.c;
    for (let i = existing + 1; i <= beds; i++) await run('INSERT INTO hostel_bed (room_id, label) VALUES (?, ?)', roomId, String(i));
    await audit(user, 'HOSTEL_ROOM_SAVE', 'hostel', hostelId, { room: name, beds });
    return { id: roomId };
  });
}

export async function deleteRoom(roomId: number, user: Actor): Promise<void> {
  if (await hasAnyRow('bed_allocation a JOIN hostel_bed b ON b.id = a.bed_id', "b.room_id = ? AND a.status = 'ACTIVE'", roomId)) throw new AppError('Students are allocated beds in this room — vacate them first', 'IN_USE');
  await tx(async () => {
    await run('DELETE FROM bed_allocation WHERE bed_id IN (SELECT id FROM hostel_bed WHERE room_id = ?)', roomId);
    await run('DELETE FROM hostel_bed WHERE room_id = ?', roomId);
    await run('DELETE FROM hostel_room WHERE id = ?', roomId);
  });
  await audit(user, 'HOSTEL_ROOM_DELETE', 'hostel_room', roomId, {});
}

export async function setBedStatus(bedId: number, status: 'AVAILABLE' | 'OUT_OF_SERVICE', user: Actor): Promise<void> {
  if (status === 'OUT_OF_SERVICE' && await hasAnyRow('bed_allocation', "bed_id = ? AND status = 'ACTIVE'", bedId)) throw new AppError('The bed is occupied — vacate it first', 'IN_USE');
  await run('UPDATE hostel_bed SET status = ? WHERE id = ?', status, bedId);
  await audit(user, 'HOSTEL_BED_STATUS', 'hostel_bed', bedId, { status });
}

/* --------------------------------------------------------------- allocation */

const ALLOCATION_SELECT = `
  SELECT a.*, b.label AS bed_label, r.name AS room_name, h.name AS hostel_name, s.admission_no, s.first_name || ' ' || s.last_name AS student_name
  FROM bed_allocation a JOIN hostel_bed b ON b.id = a.bed_id JOIN hostel_room r ON r.id = b.room_id JOIN hostel h ON h.id = r.hostel_id JOIN student s ON s.id = a.student_id`;

export const studentBed = (studentId: number): Promise<BedAllocationView | undefined> => one<BedAllocationView>(`${ALLOCATION_SELECT} WHERE a.student_id = ? AND a.status = 'ACTIVE'`, studentId);
export const studentBedHistory = (studentId: number): Promise<BedAllocationView[]> => all<BedAllocationView>(`${ALLOCATION_SELECT} WHERE a.student_id = ? ORDER BY a.from_date DESC`, studentId);

/** Boarders without a bed — the allocation screen's queue. */
export const unallocatedBoarders = (): Promise<{ id: number; admission_no: string; name: string; gender: string | null; grade_level_name: string | null }[]> =>
  all(`SELECT s.id, s.admission_no, s.first_name || ' ' || s.last_name AS name, s.gender, g.name AS grade_level_name
       FROM student s LEFT JOIN grade_level g ON g.id = s.current_grade_level_id
       WHERE s.status = 'ACTIVE' AND s.boarding_status = 'BOARDER' AND NOT EXISTS (SELECT 1 FROM bed_allocation a WHERE a.student_id = s.id AND a.status = 'ACTIVE')
       ORDER BY g.sort, s.last_name`);

/** Puts a boarder in a bed; any bed they had is vacated the same day. */
export async function allocateBed(bedId: number, studentId: number, fromDate: IsoDate, user: Actor): Promise<{ id: number }> {
  const bed = await one<HostelBed & { hostel_id: number; gender: string; hostel_name: string }>(
    'SELECT b.*, r.hostel_id, h.gender, h.name AS hostel_name FROM hostel_bed b JOIN hostel_room r ON r.id = b.room_id JOIN hostel h ON h.id = r.hostel_id WHERE b.id = ?', bedId,
  );
  if (!bed) throw new AppError('Bed not found', 'NOT_FOUND');
  if (bed.status !== 'AVAILABLE') throw new AppError('That bed is out of service', 'VALIDATION');
  if (await hasAnyRow('bed_allocation', "bed_id = ? AND status = 'ACTIVE'", bedId)) throw new AppError('That bed is taken', 'VALIDATION');
  const s = await one<{ id: number; status: string; boarding_status: string; gender: string | null; current_stream_id: number | null }>('SELECT id, status, boarding_status, gender, current_stream_id FROM student WHERE id = ?', studentId);
  if (!s || s.status !== 'ACTIVE') throw new AppError('Only an active student can be allocated a bed', 'VALIDATION');
  if (s.boarding_status !== 'BOARDER') throw new AppError('The student is a day scholar — set them to Boarder on their card first', 'VALIDATION');
  if (bed.gender !== 'MIXED' && s.gender && s.gender !== bed.gender) throw new AppError(`${bed.hostel_name} is a ${bed.gender === 'MALE' ? 'boys’' : 'girls’'} hostel`, 'VALIDATION');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) throw new AppError('A from date is required', 'VALIDATION');
  const year = s.current_stream_id ? await one<{ academic_year_id: number }>('SELECT academic_year_id FROM stream WHERE id = ?', s.current_stream_id) : null;
  const yearId = year?.academic_year_id ?? (await one<{ id: number }>('SELECT id FROM academic_year WHERE is_current'))?.id;
  if (!yearId) throw new AppError('No academic year to allocate in', 'VALIDATION');
  return tx(async () => {
    await run("UPDATE bed_allocation SET status = 'VACATED', to_date = ? WHERE student_id = ? AND status = 'ACTIVE'", fromDate, studentId);
    const info = await run('INSERT INTO bed_allocation (bed_id, student_id, academic_year_id, from_date, status, created_by, created_at) VALUES (?,?,?,?,?,?,?)', bedId, studentId, yearId, fromDate, 'ACTIVE', user.username, now());
    await audit(user, 'BED_ALLOCATE', 'student', studentId, { bed: bedId });
    return { id: Number(info.lastInsertRowid) };
  });
}

export async function vacateBed(allocationId: number, toDate: IsoDate, user: Actor): Promise<void> {
  const a = await one<{ id: number; student_id: number; status: string }>('SELECT id, student_id, status FROM bed_allocation WHERE id = ?', allocationId);
  if (!a) throw new AppError('Allocation not found', 'NOT_FOUND');
  if (a.status !== 'ACTIVE') throw new AppError('Already vacated', 'VALIDATION');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(toDate)) throw new AppError('A date is required', 'VALIDATION');
  await run("UPDATE bed_allocation SET status = 'VACATED', to_date = ? WHERE id = ?", toDate, allocationId);
  await audit(user, 'BED_VACATE', 'student', a.student_id, { allocation: allocationId });
}
