/*
 * Students — admission, the student 360, guardians and enrolment history.
 *
 * A student's fee account IS a Receivables customer (customer.id on student.customer_id): admission
 * creates the customer alongside the student, so fee invoices, receipts, aged balances, statements
 * and reminders come from the finance modules unchanged. The customer's contact, phone and e-mail
 * are the primary guardian's, which is who a receipt or reminder reaches.
 */
import { one, all, run, tx, audit, hasAnyRow, nextSequence } from './db.ts';
import { AppError } from './errors.ts';
import { createCustomer, updateCustomer, type CustomerInput } from './customers.ts';
import { buildFilterClause, type FilterCondition, type FilterFieldDef } from './listFilters.ts';
import { buildOrderClause, type SortState } from './listSort.ts';
import { assertContactDetails } from './validate.ts';
import type {
  Actor, Enrollment, EnrollmentView, Guardian, IsoDate, Student, StudentGuardianView, StudentListRow, StudentStatus, StudentView,
} from './types.ts';

const now = (): string => new Date().toISOString();
export const STUDENT_STATUSES: StudentStatus[] = ['ACTIVE', 'GRADUATED', 'TRANSFERRED', 'SUSPENDED', 'INACTIVE'];

const SELECT_LIST = `
  SELECT s.*, g.name AS grade_level_name, st.name AS stream_name,
         pg.full_name AS primary_guardian_name, pg.phone AS primary_guardian_phone,
         COALESCE(c.balance, 0) AS fee_balance
  FROM student s
  LEFT JOIN grade_level g ON g.id = s.current_grade_level_id
  LEFT JOIN stream st ON st.id = s.current_stream_id
  LEFT JOIN customer c ON c.id = s.customer_id
  LEFT JOIN LATERAL (
    SELECT gu.full_name, gu.phone FROM student_guardian sg JOIN guardian gu ON gu.id = sg.guardian_id
    WHERE sg.student_id = s.id ORDER BY sg.is_primary DESC, sg.id LIMIT 1
  ) pg ON true`;

export const STUDENT_FILTER_FIELDS: FilterFieldDef[] = [
  { key: 'admission_no', label: 'Admission No.', type: 'text', column: 's.admission_no' },
  { key: 'status', label: 'Status', type: 'select', column: 's.status', options: STUDENT_STATUSES.map((v) => ({ value: v, label: v })) },
  { key: 'gender', label: 'Gender', type: 'select', column: 's.gender', options: [{ value: 'MALE', label: 'Male' }, { value: 'FEMALE', label: 'Female' }] },
  { key: 'current_grade_level_id', label: 'Grade', type: 'select', column: 's.current_grade_level_id' },
  { key: 'current_stream_id', label: 'Class', type: 'select', column: 's.current_stream_id' },
  { key: 'admission_date', label: 'Admission Date', type: 'date', column: 's.admission_date' },
];

const SORT_COLUMNS: Record<string, string> = {
  admission_no: 's.admission_no', name: 's.last_name', grade: 'g.sort', stream: 'st.name', status: 's.status',
  admission_date: 's.admission_date', fee_balance: 'c.balance',
};

export interface ListStudentsOptions { search?: string; filters?: FilterCondition[]; sort?: SortState | null; limit?: number }

export const listStudents = ({ search = '', filters = [], sort = null, limit = 500 }: ListStudentsOptions = {}): Promise<StudentListRow[]> => {
  const { clause, params } = buildFilterClause(STUDENT_FILTER_FIELDS, filters);
  const orderBy = buildOrderClause(SORT_COLUMNS, sort, 's.admission_no');
  return all<StudentListRow>(
    `${SELECT_LIST}
     WHERE (s.admission_no ILIKE @like OR s.first_name ILIKE @like OR s.last_name ILIKE @like
            OR COALESCE(s.middle_name, '') ILIKE @like OR COALESCE(pg.full_name, '') ILIKE @like OR COALESCE(pg.phone, '') ILIKE @like)
       ${clause}
     ${orderBy} LIMIT ${Math.max(1, Math.min(limit, 2000))}`,
    { like: `%${String(search).trim()}%`, ...params },
  );
};

export const hasAnyStudents = (): Promise<boolean> => hasAnyRow('student');

/** The active roster of one class. */
export const listStreamRoster = (streamId: number): Promise<StudentListRow[]> =>
  all<StudentListRow>(`${SELECT_LIST} WHERE s.current_stream_id = ? AND s.status = 'ACTIVE' ORDER BY s.last_name, s.first_name`, streamId);

export const listActiveStudentsPick = (): Promise<Pick<Student, 'id' | 'admission_no' | 'first_name' | 'last_name'>[]> =>
  all("SELECT id, admission_no, first_name, last_name FROM student WHERE status = 'ACTIVE' ORDER BY admission_no");

export async function getStudent(id: number): Promise<StudentView | undefined> {
  const row = await one<StudentView>(
    `${SELECT_LIST.replace('COALESCE(c.balance, 0) AS fee_balance', 'COALESCE(c.balance, 0) AS fee_balance, c.no AS customer_no, co.name AS county_name, sc.name AS sub_county_name')}
     LEFT JOIN county co ON co.id = s.county_id
     LEFT JOIN sub_county sc ON sc.id = s.sub_county_id
     WHERE s.id = ?`, id,
  );
  if (!row) return undefined;
  const [guardians, enrollments] = await Promise.all([listStudentGuardians(id), listEnrollments(id)]);
  return { ...row, guardians, enrollments };
}

export const getStudentByAdmissionNo = (admissionNo: string): Promise<Student | undefined> =>
  one<Student>('SELECT * FROM student WHERE admission_no = ?', admissionNo.trim());

export const listStudentGuardians = (studentId: number): Promise<StudentGuardianView[]> =>
  all<StudentGuardianView>(
    `SELECT g.*, sg.is_primary FROM student_guardian sg JOIN guardian g ON g.id = sg.guardian_id
     WHERE sg.student_id = ? ORDER BY sg.is_primary DESC, g.full_name`, studentId,
  );

export const listEnrollments = (studentId: number): Promise<EnrollmentView[]> =>
  all<EnrollmentView>(
    `SELECT e.*, y.name AS year_name, g.name AS grade_level_name, st.name AS stream_name
     FROM enrollment e JOIN academic_year y ON y.id = e.academic_year_id JOIN grade_level g ON g.id = e.grade_level_id
     LEFT JOIN stream st ON st.id = e.stream_id
     WHERE e.student_id = ? ORDER BY y.start_date DESC`, studentId,
  );

/* ------------------------------------------------------------------ admission */

export interface GuardianDraft {
  id?: number | string | null;
  fullName: string;
  phone: string;
  email?: string | null;
  nationalId?: string | null;
  relationship?: string | null;
  occupation?: string | null;
  address?: string | null;
  isPrimary?: boolean;
}

export interface StudentInput {
  firstName: string;
  middleName?: string | null;
  lastName: string;
  gender?: string | null;
  dateOfBirth?: IsoDate | null;
  birthCertificateNo?: string | null;
  nemisUpi?: string | null;
  address?: string | null;
  countyId?: number | null;
  subCountyId?: number | null;
  admissionDate: IsoDate;
  religion?: string | null;
  medicalNotes?: string | null;
  /** Blank = the next Admission No. from the STUDENT No. Series. */
  admissionNo?: string | null;
  /** Where the student is placed now — the stream fixes the grade and the year. */
  streamId: number;
}

function assertStudent(i: StudentInput): void {
  if (!i.firstName?.trim() || !i.lastName?.trim()) throw new AppError('First and last names are required', 'VALIDATION');
  if (!i.admissionDate || !/^\d{4}-\d{2}-\d{2}$/.test(i.admissionDate)) throw new AppError('An admission date is required', 'VALIDATION');
  if (i.dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(i.dateOfBirth)) throw new AppError('Date of birth must be YYYY-MM-DD', 'VALIDATION');
  if (i.gender && !['MALE', 'FEMALE'].includes(i.gender)) throw new AppError('Gender must be MALE or FEMALE', 'VALIDATION');
}

function assertGuardians(rows: GuardianDraft[]): GuardianDraft[] {
  const kept = rows.filter((g) => String(g.fullName || '').trim());
  if (!kept.length) throw new AppError('At least one guardian is required — they are who fee notices reach', 'VALIDATION');
  for (const g of kept) {
    if (!String(g.phone || '').trim()) throw new AppError(`${g.fullName}: a phone number is required`, 'VALIDATION');
    assertContactDetails({ phone: g.phone, email: g.email });
  }
  if (!kept.some((g) => g.isPrimary)) kept[0].isPrimary = true;
  return kept;
}

const fullName = (s: { first_name: string; middle_name?: string | null; last_name: string }): string =>
  [s.first_name, s.middle_name, s.last_name].filter(Boolean).join(' ');

async function streamPlacement(streamId: number): Promise<{ id: number; grade_level_id: number; academic_year_id: number }> {
  const st = await one<{ id: number; grade_level_id: number; academic_year_id: number }>('SELECT id, grade_level_id, academic_year_id FROM stream WHERE id = ?', streamId);
  if (!st) throw new AppError('Pick the class the student joins', 'VALIDATION');
  return st;
}

/** Writes or matches the guardians of a student and links them — reused by admission and editing. */
async function saveGuardians(studentId: number, rows: GuardianDraft[], user: Actor): Promise<void> {
  const kept = assertGuardians(rows);
  const existing = await all<{ guardian_id: number }>('SELECT guardian_id FROM student_guardian WHERE student_id = ?', studentId);
  const keepIds = new Set<number>();
  for (const g of kept) {
    let guardianId = g.id ? Number(g.id) : null;
    // A guardian already on file (same phone) is linked, not duplicated — siblings share a parent.
    if (!guardianId) {
      const match = await one<{ id: number }>('SELECT id FROM guardian WHERE phone = ? AND lower(full_name) = lower(?) LIMIT 1', String(g.phone).trim(), String(g.fullName).trim());
      guardianId = match?.id ?? null;
    }
    if (guardianId) {
      await run(
        'UPDATE guardian SET full_name=?, phone=?, email=?, national_id=?, relationship=?, occupation=?, address=? WHERE id=?',
        String(g.fullName).trim(), String(g.phone).trim(), g.email?.trim() || null, g.nationalId?.trim() || null,
        g.relationship?.trim() || 'Parent', g.occupation?.trim() || null, g.address?.trim() || null, guardianId,
      );
    } else {
      const info = await run(
        'INSERT INTO guardian (full_name, phone, email, national_id, relationship, occupation, address, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?)',
        String(g.fullName).trim(), String(g.phone).trim(), g.email?.trim() || null, g.nationalId?.trim() || null,
        g.relationship?.trim() || 'Parent', g.occupation?.trim() || null, g.address?.trim() || null, now(), user.username,
      );
      guardianId = Number(info.lastInsertRowid);
    }
    keepIds.add(guardianId);
    await run(
      `INSERT INTO student_guardian (student_id, guardian_id, is_primary) VALUES (?,?,?)
       ON CONFLICT (student_id, guardian_id) DO UPDATE SET is_primary = EXCLUDED.is_primary`,
      studentId, guardianId, !!g.isPrimary,
    );
  }
  for (const e of existing) {
    if (!keepIds.has(e.guardian_id)) await run('DELETE FROM student_guardian WHERE student_id = ? AND guardian_id = ?', studentId, e.guardian_id);
  }
  // Exactly one primary.
  const primaries = await all<{ guardian_id: number }>('SELECT guardian_id FROM student_guardian WHERE student_id = ? AND is_primary ORDER BY id', studentId);
  if (primaries.length > 1) await run('UPDATE student_guardian SET is_primary = false WHERE student_id = ? AND guardian_id <> ?', studentId, primaries[0].guardian_id);
}

/** The Receivables customer that is the student's fee account, kept in step with the primary guardian. */
async function syncFeeCustomer(studentId: number, user: Actor): Promise<void> {
  const s = await one<Student>('SELECT * FROM student WHERE id = ?', studentId);
  if (!s) return;
  const primary = await one<Guardian>(
    `SELECT g.* FROM student_guardian sg JOIN guardian g ON g.id = sg.guardian_id WHERE sg.student_id = ? ORDER BY sg.is_primary DESC, sg.id LIMIT 1`, studentId,
  );
  const input: CustomerInput = {
    name: `${fullName(s)} (${s.admission_no})`,
    name2: primary ? `c/o ${primary.full_name}` : null,
    address: primary?.address ?? s.address ?? null,
    contact: primary?.full_name ?? null,
    phone: primary?.phone ?? null,
    email: primary?.email ?? null,
    creditLimit: 0,
    blocked: s.status === 'ACTIVE' ? '' : 'Ship',
  };
  if (s.customer_id) {
    // Only the contact details are ours to refresh — the posting group, terms, dimensions and
    // credit limit the bursar set on the fee account stay as they are.
    const c = await one<{ no: string; customer_posting_group_code: string | null; payment_terms_code: string | null; payment_method_code: string | null; reminder_terms_code: string | null; fin_charge_terms_code: string | null; salesperson: string | null; currency_code: string | null; credit_limit: number; global_dimension_1_id: number | null; global_dimension_2_id: number | null; address_2: string | null; city: string | null; post_code: string | null; country: string | null }>(
      'SELECT no, customer_posting_group_code, payment_terms_code, payment_method_code, reminder_terms_code, fin_charge_terms_code, salesperson, currency_code, credit_limit, global_dimension_1_id, global_dimension_2_id, address_2, city, post_code, country FROM customer WHERE id = ?', s.customer_id,
    );
    if (c) {
      await updateCustomer(c.no, {
        ...input, creditLimit: Number(c.credit_limit),
        customerPostingGroupCode: c.customer_posting_group_code, paymentTermsCode: c.payment_terms_code, paymentMethodCode: c.payment_method_code,
        reminderTermsCode: c.reminder_terms_code, finChargeTermsCode: c.fin_charge_terms_code, salesperson: c.salesperson, currencyCode: c.currency_code,
        globalDimension1Id: c.global_dimension_1_id, globalDimension2Id: c.global_dimension_2_id,
        address2: c.address_2, city: c.city, postCode: c.post_code, country: c.country,
      }, user);
      return;
    }
  }
  const { no } = await createCustomer(input, user);
  const c = await one<{ id: number }>('SELECT id FROM customer WHERE no = ?', no);
  await run('UPDATE student SET customer_id = ? WHERE id = ?', c!.id, studentId);
}

export async function admitStudent(input: StudentInput, guardians: GuardianDraft[], user: Actor): Promise<{ id: number; admissionNo: string }> {
  assertStudent(input);
  const placement = await streamPlacement(input.streamId);
  return tx(async () => {
    const admissionNo = input.admissionNo?.trim() || await nextSequence('STUDENT');
    if (await hasAnyRow('student', 'admission_no = ?', admissionNo)) throw new AppError(`Admission No. ${admissionNo} is already used`, 'DUPLICATE');
    const info = await run(
      `INSERT INTO student
         (admission_no, first_name, middle_name, last_name, gender, date_of_birth, birth_certificate_no, nemis_upi, address,
          county_id, sub_county_id, admission_date, status, current_grade_level_id, current_stream_id, religion, medical_notes,
          created_at, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      admissionNo, input.firstName.trim(), input.middleName?.trim() || null, input.lastName.trim(), input.gender || null,
      input.dateOfBirth || null, input.birthCertificateNo?.trim() || null, input.nemisUpi?.trim() || null, input.address?.trim() || null,
      input.countyId || null, input.subCountyId || null, input.admissionDate, 'ACTIVE', placement.grade_level_id, placement.id,
      input.religion?.trim() || null, input.medicalNotes?.trim() || null, now(), user.username,
    );
    const id = Number(info.lastInsertRowid);
    await run(
      'INSERT INTO enrollment (student_id, academic_year_id, grade_level_id, stream_id, status, created_at) VALUES (?,?,?,?,?,?)',
      id, placement.academic_year_id, placement.grade_level_id, placement.id, 'ACTIVE', now(),
    );
    await saveGuardians(id, guardians, user);
    await syncFeeCustomer(id, user);
    await audit(user, 'STUDENT_ADMIT', 'student', id, { admissionNo, stream: placement.id });
    return { id, admissionNo };
  });
}

export async function updateStudent(id: number, input: Omit<StudentInput, 'streamId' | 'admissionNo'>, guardians: GuardianDraft[], user: Actor): Promise<void> {
  assertStudent({ ...input, streamId: 0 });
  await tx(async () => {
    const before = await one<Student>('SELECT * FROM student WHERE id = ?', id);
    if (!before) throw new AppError('Student not found', 'NOT_FOUND');
    await run(
      `UPDATE student SET first_name=?, middle_name=?, last_name=?, gender=?, date_of_birth=?, birth_certificate_no=?, nemis_upi=?,
         address=?, county_id=?, sub_county_id=?, admission_date=?, religion=?, medical_notes=?, updated_at=?, updated_by=? WHERE id=?`,
      input.firstName.trim(), input.middleName?.trim() || null, input.lastName.trim(), input.gender || null, input.dateOfBirth || null,
      input.birthCertificateNo?.trim() || null, input.nemisUpi?.trim() || null, input.address?.trim() || null,
      input.countyId || null, input.subCountyId || null, input.admissionDate, input.religion?.trim() || null, input.medicalNotes?.trim() || null,
      now(), user.username, id,
    );
    await saveGuardians(id, guardians, user);
    await syncFeeCustomer(id, user);
    await audit(user, 'STUDENT_UPDATE', 'student', id, {});
  });
}

/** Active → Suspended / Transferred / Graduated / Inactive, and back to Active. A leaver's fee
 *  account is blocked for new invoices but stays open for the balance to be settled. */
export async function setStudentStatus(id: number, status: StudentStatus, reason: string | null, user: Actor): Promise<void> {
  if (!STUDENT_STATUSES.includes(status)) throw new AppError('Invalid status', 'VALIDATION');
  const s = await one<Student>('SELECT * FROM student WHERE id = ?', id);
  if (!s) throw new AppError('Student not found', 'NOT_FOUND');
  await tx(async () => {
    await run('UPDATE student SET status=?, updated_at=?, updated_by=? WHERE id=?', status, now(), user.username, id);
    if (status === 'TRANSFERRED' || status === 'GRADUATED') {
      await run(`UPDATE enrollment SET status = ? WHERE student_id = ? AND status = 'ACTIVE'`, status === 'GRADUATED' ? 'GRADUATED' : 'TRANSFERRED_OUT', id);
    }
    await syncFeeCustomer(id, user);
  });
  await audit(user, 'STUDENT_STATUS', 'student', id, { from: s.status, to: status, reason });
}

/** Moves a student to another class — within the same year it is a transfer; into a stream of a
 *  later year it is a promotion (or a repeat, when the grade is the same). */
export async function placeStudent(id: number, streamId: number, user: Actor): Promise<void> {
  const s = await one<Student>('SELECT * FROM student WHERE id = ?', id);
  if (!s) throw new AppError('Student not found', 'NOT_FOUND');
  if (s.status !== 'ACTIVE') throw new AppError('Only an active student can be placed in a class', 'VALIDATION');
  const target = await streamPlacement(streamId);
  await tx(async () => {
    const current = await one<Enrollment>(`SELECT * FROM enrollment WHERE student_id = ? AND status = 'ACTIVE' ORDER BY id DESC LIMIT 1`, id);
    if (current && current.academic_year_id === target.academic_year_id) {
      await run('UPDATE enrollment SET grade_level_id = ?, stream_id = ? WHERE id = ?', target.grade_level_id, target.id, current.id);
    } else {
      if (current) {
        const repeated = current.grade_level_id === target.grade_level_id;
        await run('UPDATE enrollment SET status = ? WHERE id = ?', repeated ? 'REPEATED' : 'PROMOTED', current.id);
      }
      await run(
        `INSERT INTO enrollment (student_id, academic_year_id, grade_level_id, stream_id, status, created_at) VALUES (?,?,?,?,?,?)
         ON CONFLICT (student_id, academic_year_id) DO UPDATE SET grade_level_id = EXCLUDED.grade_level_id, stream_id = EXCLUDED.stream_id, status = 'ACTIVE'`,
        id, target.academic_year_id, target.grade_level_id, target.id, 'ACTIVE', now(),
      );
    }
    await run('UPDATE student SET current_grade_level_id = ?, current_stream_id = ?, updated_at = ?, updated_by = ? WHERE id = ?',
      target.grade_level_id, target.id, now(), user.username, id);
  });
  await audit(user, 'STUDENT_PLACE', 'student', id, { stream: streamId });
}

/** Cloudinary public_id of the student's photo — returns the previous one so the caller can destroy it. */
export async function setStudentPhoto(studentId: number, value: string | null, user: Actor): Promise<string | null> {
  const s = await one<{ photo: string | null }>('SELECT photo FROM student WHERE id = ?', studentId);
  if (!s) throw new AppError('Student not found', 'NOT_FOUND');
  await run('UPDATE student SET photo = ?, updated_at = ?, updated_by = ? WHERE id = ?', value, now(), user.username, studentId);
  await audit(user, 'STUDENT_PHOTO', 'student', studentId, { set: !!value });
  return s.photo;
}

/* ------------------------------------------------------------------ guardians */

export interface GuardianListRow extends Guardian { students: number; student_names: string | null }

export const listGuardians = (search = ''): Promise<GuardianListRow[]> =>
  all<GuardianListRow>(
    `SELECT g.*, COUNT(sg.id)::int AS students,
            string_agg(s.first_name || ' ' || s.last_name || ' (' || s.admission_no || ')', ', ' ORDER BY s.admission_no) AS student_names
     FROM guardian g
     LEFT JOIN student_guardian sg ON sg.guardian_id = g.id
     LEFT JOIN student s ON s.id = sg.student_id
     WHERE (g.full_name ILIKE @like OR g.phone ILIKE @like OR COALESCE(g.email, '') ILIKE @like OR COALESCE(g.national_id, '') ILIKE @like)
     GROUP BY g.id ORDER BY g.full_name LIMIT 500`,
    { like: `%${String(search).trim()}%` },
  );

export const getGuardian = (id: number): Promise<Guardian | undefined> => one<Guardian>('SELECT * FROM guardian WHERE id = ?', id);

/** The students a guardian is responsible for — the Parent portal's scope. */
export const listGuardianStudents = (guardianId: number): Promise<StudentListRow[]> =>
  all<StudentListRow>(
    `${SELECT_LIST} JOIN student_guardian mine ON mine.student_id = s.id AND mine.guardian_id = ?
     ORDER BY s.first_name`, guardianId,
  );

export async function updateGuardian(id: number, g: Omit<GuardianDraft, 'id' | 'isPrimary'>, user: Actor): Promise<void> {
  if (!String(g.fullName || '').trim() || !String(g.phone || '').trim()) throw new AppError('A name and phone number are required', 'VALIDATION');
  assertContactDetails({ phone: g.phone, email: g.email });
  await run(
    'UPDATE guardian SET full_name=?, phone=?, email=?, national_id=?, relationship=?, occupation=?, address=? WHERE id=?',
    g.fullName.trim(), g.phone.trim(), g.email?.trim() || null, g.nationalId?.trim() || null, g.relationship?.trim() || 'Parent',
    g.occupation?.trim() || null, g.address?.trim() || null, id,
  );
  // Every child's fee account carries this guardian's details where they are the primary contact.
  const kids = await all<{ student_id: number }>('SELECT student_id FROM student_guardian WHERE guardian_id = ? AND is_primary', id);
  for (const k of kids) await syncFeeCustomer(k.student_id, user);
  await audit(user, 'GUARDIAN_UPDATE', 'guardian', id, {});
}

export async function deleteGuardian(id: number, user: Actor): Promise<void> {
  if (await hasAnyRow('student_guardian', 'guardian_id = ?', id)) throw new AppError('This guardian is linked to a student — remove the link on the student first', 'IN_USE');
  await run('DELETE FROM guardian WHERE id = ?', id);
  await audit(user, 'GUARDIAN_DELETE', 'guardian', id, {});
}
