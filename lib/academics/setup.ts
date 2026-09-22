/*
 * Academic setup — the school's own structure, maintained under Admin Centre → Setup Pool →
 * Academics: academic years and their terms, education levels, grade levels, streams (classes),
 * subjects and the grades they are offered in, grading scales with their competency bands, and
 * assessment types. Nothing here is hard-coded: the seed only pre-fills the Kenyan CBC structure.
 */
import { one, all, run, tx, audit, hasAnyRow } from '../db.ts';
import { AppError } from '../errors.ts';
import type {
  AcademicTerm, AcademicTermWithYear, AcademicYear, AcademicYearWithTerms, Actor, AssessmentBand, AssessmentType,
  EducationLevel, GradeLevel, GradeLevelWithUsage, GradingScale, GradingScaleWithBands, Stream, StreamView, Subject, SubjectView,
} from '../types.ts';

const now = (): string => new Date().toISOString();
const isoDate = (v: unknown): string => {
  const s = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new AppError('Dates must be YYYY-MM-DD', 'VALIDATION');
  return s;
};

/* ------------------------------------------------------------ academic years */

export const listAcademicYears = async (): Promise<AcademicYearWithTerms[]> => {
  const [years, terms, streams] = await Promise.all([
    all<AcademicYear>('SELECT * FROM academic_year ORDER BY start_date DESC'),
    all<AcademicTerm>('SELECT * FROM academic_term ORDER BY academic_year_id, sort'),
    all<{ academic_year_id: number; n: number }>('SELECT academic_year_id, COUNT(*)::int AS n FROM stream GROUP BY academic_year_id'),
  ]);
  const streamsByYear = new Map(streams.map((s) => [Number(s.academic_year_id), Number(s.n)]));
  return years.map((y) => ({ ...y, terms: terms.filter((t) => t.academic_year_id === y.id), streams: streamsByYear.get(y.id) ?? 0 }));
};

export const getCurrentAcademicYear = (): Promise<AcademicYear | undefined> =>
  one<AcademicYear>('SELECT * FROM academic_year WHERE is_current ORDER BY start_date DESC LIMIT 1');

export const getCurrentTerm = (): Promise<AcademicTermWithYear | undefined> =>
  one<AcademicTermWithYear>(
    `SELECT t.*, y.name AS year_name FROM academic_term t JOIN academic_year y ON y.id = t.academic_year_id
     WHERE t.is_current ORDER BY t.start_date DESC LIMIT 1`,
  );

/** The current term, or the one whose dates contain today, or the latest — never nothing once a year exists. */
export async function resolveTerm(termId?: number | null): Promise<AcademicTermWithYear | undefined> {
  if (termId) return getTerm(termId);
  return (await getCurrentTerm())
    ?? one<AcademicTermWithYear>(
      `SELECT t.*, y.name AS year_name FROM academic_term t JOIN academic_year y ON y.id = t.academic_year_id
       WHERE t.start_date <= ? AND t.end_date >= ? ORDER BY t.start_date DESC LIMIT 1`, now().slice(0, 10), now().slice(0, 10),
    )
    ?? one<AcademicTermWithYear>(
      `SELECT t.*, y.name AS year_name FROM academic_term t JOIN academic_year y ON y.id = t.academic_year_id
       ORDER BY t.start_date DESC LIMIT 1`,
    );
}

export const getTerm = (id: number): Promise<AcademicTermWithYear | undefined> =>
  one<AcademicTermWithYear>(
    'SELECT t.*, y.name AS year_name FROM academic_term t JOIN academic_year y ON y.id = t.academic_year_id WHERE t.id = ?', id,
  );

export const listTerms = (academicYearId?: number | null): Promise<AcademicTermWithYear[]> =>
  all<AcademicTermWithYear>(
    `SELECT t.*, y.name AS year_name FROM academic_term t JOIN academic_year y ON y.id = t.academic_year_id
     ${academicYearId ? 'WHERE t.academic_year_id = ?' : ''} ORDER BY y.start_date DESC, t.sort`,
    ...(academicYearId ? [academicYearId] : []),
  );

export interface AcademicYearInput { name: string; startDate: string; endDate: string; isCurrent?: boolean }
export interface TermDraft { id?: number | string | null; name: string; startDate: string; endDate: string; isCurrent?: boolean }

async function assertYearInput(i: AcademicYearInput): Promise<void> {
  if (!i.name?.trim()) throw new AppError('The academic year needs a name, e.g. 2026', 'VALIDATION');
  if (isoDate(i.startDate) > isoDate(i.endDate)) throw new AppError('The year cannot end before it starts', 'VALIDATION');
}

/** Replaces the year's terms with the submitted grid — rows are matched by id so a term already
 *  carrying assessments or fees keeps its identity; one can only be dropped while nothing uses it. */
async function replaceTerms(yearId: number, year: AcademicYearInput, rows: TermDraft[]): Promise<void> {
  const existing = await all<AcademicTerm>('SELECT * FROM academic_term WHERE academic_year_id = ?', yearId);
  const submitted = new Set(rows.filter((r) => r.id).map((r) => Number(r.id)));
  for (const old of existing) {
    if (submitted.has(old.id)) continue;
    for (const [table, what] of [['assessment_record', 'assessments'], ['fee_structure', 'fee structures'], ['fee_invoice', 'fee invoices'], ['timetable_slot', 'timetable slots']] as const) {
      if (await hasAnyRow(table, 'term_id = ?', old.id)) throw new AppError(`Cannot remove ${old.name} — ${what} already refer to it`, 'IN_USE');
    }
    await run('DELETE FROM academic_term WHERE id = ?', old.id);
  }
  const names = new Set<string>();
  let sort = 0;
  for (const r of rows) {
    const name = String(r.name || '').trim();
    if (!name) continue;
    sort += 1;
    const key = name.toLowerCase();
    if (names.has(key)) throw new AppError(`Duplicate term name "${name}"`, 'VALIDATION');
    names.add(key);
    const start = isoDate(r.startDate);
    const end = isoDate(r.endDate);
    if (start > end) throw new AppError(`${name} cannot end before it starts`, 'VALIDATION');
    if (start < isoDate(year.startDate) || end > isoDate(year.endDate)) throw new AppError(`${name} falls outside the academic year`, 'VALIDATION');
    const id = r.id ? Number(r.id) : null;
    if (id) {
      await run('UPDATE academic_term SET name=?, sort=?, start_date=?, end_date=?, is_current=? WHERE id=? AND academic_year_id=?',
        name, sort, start, end, !!r.isCurrent, id, yearId);
    } else {
      await run('INSERT INTO academic_term (academic_year_id, name, sort, start_date, end_date, is_current) VALUES (?,?,?,?,?,?)',
        yearId, name, sort, start, end, !!r.isCurrent);
    }
  }
  // At most one current term, and only inside the current year.
  const current = await all<{ id: number }>('SELECT id FROM academic_term WHERE academic_year_id = ? AND is_current ORDER BY sort', yearId);
  if (current.length > 1) {
    await run('UPDATE academic_term SET is_current = false WHERE academic_year_id = ? AND id <> ?', yearId, current[0].id);
  }
  if (current.length && year.isCurrent) {
    await run('UPDATE academic_term SET is_current = false WHERE academic_year_id <> ?', yearId);
  }
}

export async function createAcademicYear(input: AcademicYearInput, terms: TermDraft[], user: Actor): Promise<{ id: number }> {
  await assertYearInput(input);
  return tx(async () => {
    if (await hasAnyRow('academic_year', 'name = ?', input.name.trim())) throw new AppError('That academic year already exists', 'DUPLICATE');
    if (input.isCurrent) await run('UPDATE academic_year SET is_current = false');
    const info = await run(
      'INSERT INTO academic_year (name, start_date, end_date, is_current, created_at, created_by) VALUES (?,?,?,?,?,?)',
      input.name.trim(), isoDate(input.startDate), isoDate(input.endDate), !!input.isCurrent, now(), user.username,
    );
    const id = Number(info.lastInsertRowid);
    await replaceTerms(id, input, terms);
    await audit(user, 'ACADEMIC_YEAR_CREATE', 'academic_year', id, { name: input.name, terms: terms.length });
    return { id };
  });
}

export async function updateAcademicYear(id: number, input: AcademicYearInput, terms: TermDraft[], user: Actor): Promise<void> {
  await assertYearInput(input);
  await tx(async () => {
    const before = await one<AcademicYear>('SELECT * FROM academic_year WHERE id = ?', id);
    if (!before) throw new AppError('Academic year not found', 'NOT_FOUND');
    if (await hasAnyRow('academic_year', 'name = ? AND id <> ?', input.name.trim(), id)) throw new AppError('That academic year already exists', 'DUPLICATE');
    if (input.isCurrent) await run('UPDATE academic_year SET is_current = false WHERE id <> ?', id);
    await run('UPDATE academic_year SET name=?, start_date=?, end_date=?, is_current=? WHERE id=?',
      input.name.trim(), isoDate(input.startDate), isoDate(input.endDate), !!input.isCurrent, id);
    await replaceTerms(id, input, terms);
    await audit(user, 'ACADEMIC_YEAR_UPDATE', 'academic_year', id, { name: input.name, terms: terms.length });
  });
}

/** Makes one term (and its year) the current one — what registers, marks and fees default to. */
export async function setCurrentTerm(termId: number, user: Actor): Promise<void> {
  const term = await one<AcademicTerm>('SELECT * FROM academic_term WHERE id = ?', termId);
  if (!term) throw new AppError('Term not found', 'NOT_FOUND');
  await tx(async () => {
    await run('UPDATE academic_year SET is_current = (id = ?)', term.academic_year_id);
    await run('UPDATE academic_term SET is_current = (id = ?)', termId);
  });
  await audit(user, 'ACADEMIC_TERM_SET_CURRENT', 'academic_term', termId, {});
}

export async function deleteAcademicYear(id: number, user: Actor): Promise<void> {
  if (await hasAnyRow('stream', 'academic_year_id = ?', id)) throw new AppError('Classes have been opened for this year — it cannot be deleted', 'IN_USE');
  if (await hasAnyRow('enrollment', 'academic_year_id = ?', id)) throw new AppError('Students are enrolled in this year — it cannot be deleted', 'IN_USE');
  await run('DELETE FROM academic_year WHERE id = ?', id);
  await audit(user, 'ACADEMIC_YEAR_DELETE', 'academic_year', id, {});
}

/* ------------------------------------------------------ levels, grades, streams */

export const listEducationLevels = (): Promise<EducationLevel[]> => all<EducationLevel>('SELECT * FROM education_level ORDER BY sort, name');

export const listGradeLevels = (): Promise<GradeLevelWithUsage[]> =>
  all<GradeLevelWithUsage>(
    `SELECT g.*, el.name AS education_level_name,
            (SELECT COUNT(*)::int FROM stream s JOIN academic_year y ON y.id = s.academic_year_id WHERE s.grade_level_id = g.id AND y.is_current) AS streams,
            (SELECT COUNT(*)::int FROM student st WHERE st.current_grade_level_id = g.id AND st.status = 'ACTIVE') AS students
     FROM grade_level g JOIN education_level el ON el.id = g.education_level_id
     ORDER BY el.sort, g.sort, g.name`,
  );

export const getGradeLevel = (id: number): Promise<GradeLevel | undefined> => one<GradeLevel>('SELECT * FROM grade_level WHERE id = ?', id);

export interface EducationLevelInput { name: string; sort?: number }
export interface GradeLevelInput { educationLevelId: number; name: string; sort?: number }

export async function saveEducationLevel(id: number | null, input: EducationLevelInput, user: Actor): Promise<{ id: number }> {
  const name = String(input.name || '').trim();
  if (!name) throw new AppError('The level needs a name', 'VALIDATION');
  if (await hasAnyRow('education_level', `name = ? ${id ? 'AND id <> ?' : ''}`, ...(id ? [name, id] : [name]))) throw new AppError('That level already exists', 'DUPLICATE');
  if (id) {
    await run('UPDATE education_level SET name=?, sort=? WHERE id=?', name, Number(input.sort) || 1, id);
    await audit(user, 'EDUCATION_LEVEL_UPDATE', 'education_level', id, { name });
    return { id };
  }
  const info = await run('INSERT INTO education_level (name, sort) VALUES (?,?)', name, Number(input.sort) || 1);
  await audit(user, 'EDUCATION_LEVEL_CREATE', 'education_level', info.lastInsertRowid, { name });
  return { id: Number(info.lastInsertRowid) };
}

export async function deleteEducationLevel(id: number, user: Actor): Promise<void> {
  if (await hasAnyRow('grade_level', 'education_level_id = ?', id)) throw new AppError('Remove its grade levels first', 'IN_USE');
  await run('DELETE FROM education_level WHERE id = ?', id);
  await audit(user, 'EDUCATION_LEVEL_DELETE', 'education_level', id, {});
}

export async function saveGradeLevel(id: number | null, input: GradeLevelInput, user: Actor): Promise<{ id: number }> {
  const name = String(input.name || '').trim();
  if (!name) throw new AppError('The grade needs a name', 'VALIDATION');
  if (!(await hasAnyRow('education_level', 'id = ?', input.educationLevelId))) throw new AppError('Pick the education level', 'VALIDATION');
  if (await hasAnyRow('grade_level', `education_level_id = ? AND name = ? ${id ? 'AND id <> ?' : ''}`, ...(id ? [input.educationLevelId, name, id] : [input.educationLevelId, name]))) {
    throw new AppError('That grade already exists in this level', 'DUPLICATE');
  }
  if (id) {
    await run('UPDATE grade_level SET education_level_id=?, name=?, sort=? WHERE id=?', input.educationLevelId, name, Number(input.sort) || 1, id);
    await audit(user, 'GRADE_LEVEL_UPDATE', 'grade_level', id, { name });
    return { id };
  }
  const info = await run('INSERT INTO grade_level (education_level_id, name, sort) VALUES (?,?,?)', input.educationLevelId, name, Number(input.sort) || 1);
  await audit(user, 'GRADE_LEVEL_CREATE', 'grade_level', info.lastInsertRowid, { name });
  return { id: Number(info.lastInsertRowid) };
}

export async function deleteGradeLevel(id: number, user: Actor): Promise<void> {
  if (await hasAnyRow('student', 'current_grade_level_id = ?', id)) throw new AppError('Students are in this grade — it cannot be deleted', 'IN_USE');
  if (await hasAnyRow('stream', 'grade_level_id = ?', id)) throw new AppError('Classes exist for this grade — remove them first', 'IN_USE');
  await run('DELETE FROM grade_level WHERE id = ?', id);
  await audit(user, 'GRADE_LEVEL_DELETE', 'grade_level', id, {});
}

const STREAM_SELECT = `
  SELECT s.*, g.name AS grade_level_name, el.name AS education_level_name, y.name AS year_name,
         CASE WHEN e.id IS NULL THEN NULL ELSE e.first_name || ' ' || e.last_name END AS class_teacher_name,
         (SELECT COUNT(*)::int FROM student st WHERE st.current_stream_id = s.id AND st.status = 'ACTIVE') AS students
  FROM stream s
  JOIN grade_level g ON g.id = s.grade_level_id
  JOIN education_level el ON el.id = g.education_level_id
  JOIN academic_year y ON y.id = s.academic_year_id
  LEFT JOIN employee e ON e.id = s.class_teacher_id`;

export const listStreams = (academicYearId?: number | null): Promise<StreamView[]> =>
  all<StreamView>(
    `${STREAM_SELECT} ${academicYearId ? 'WHERE s.academic_year_id = ?' : 'WHERE y.is_current'} ORDER BY el.sort, g.sort, s.name`,
    ...(academicYearId ? [academicYearId] : []),
  );

export const getStream = (id: number): Promise<StreamView | undefined> => one<StreamView>(`${STREAM_SELECT} WHERE s.id = ?`, id);

export interface StreamInput { gradeLevelId: number; academicYearId: number; name: string; classTeacherId?: number | null }

export async function saveStream(id: number | null, input: StreamInput, user: Actor): Promise<{ id: number }> {
  const name = String(input.name || '').trim();
  if (!name) throw new AppError('The class needs a name, e.g. East', 'VALIDATION');
  if (!(await hasAnyRow('grade_level', 'id = ?', input.gradeLevelId))) throw new AppError('Pick the grade', 'VALIDATION');
  if (!(await hasAnyRow('academic_year', 'id = ?', input.academicYearId))) throw new AppError('Pick the academic year', 'VALIDATION');
  if (input.classTeacherId && !(await hasAnyRow('teacher_profile', 'employee_id = ?', input.classTeacherId))) {
    throw new AppError('The class teacher must be a member of teaching staff', 'VALIDATION');
  }
  const dup = await hasAnyRow('stream', `grade_level_id = ? AND academic_year_id = ? AND name = ? ${id ? 'AND id <> ?' : ''}`,
    ...(id ? [input.gradeLevelId, input.academicYearId, name, id] : [input.gradeLevelId, input.academicYearId, name]));
  if (dup) throw new AppError('That class already exists for the year', 'DUPLICATE');
  if (id) {
    await run('UPDATE stream SET grade_level_id=?, academic_year_id=?, name=?, class_teacher_id=? WHERE id=?',
      input.gradeLevelId, input.academicYearId, name, input.classTeacherId || null, id);
    await audit(user, 'STREAM_UPDATE', 'stream', id, { name });
    return { id };
  }
  const info = await run('INSERT INTO stream (grade_level_id, academic_year_id, name, class_teacher_id) VALUES (?,?,?,?)',
    input.gradeLevelId, input.academicYearId, name, input.classTeacherId || null);
  await audit(user, 'STREAM_CREATE', 'stream', info.lastInsertRowid, { name });
  return { id: Number(info.lastInsertRowid) };
}

export async function deleteStream(id: number, user: Actor): Promise<void> {
  if (await hasAnyRow('student', 'current_stream_id = ?', id)) throw new AppError('Students are in this class — move them first', 'IN_USE');
  await run('DELETE FROM timetable_slot WHERE stream_id = ?', id);
  await run('DELETE FROM teacher_subject_assignment WHERE stream_id = ?', id);
  await run('DELETE FROM stream WHERE id = ?', id);
  await audit(user, 'STREAM_DELETE', 'stream', id, {});
}

/* -------------------------------------------------------------------- subjects */

export const listSubjects = async (): Promise<SubjectView[]> => {
  const [subjects, offerings] = await Promise.all([
    all<SubjectView>(
      `SELECT s.*, el.name AS education_level_name FROM subject s LEFT JOIN education_level el ON el.id = s.education_level_id
       ORDER BY s.status, el.sort NULLS LAST, s.name`,
    ),
    all<{ subject_id: number; grade_level_id: number }>('SELECT subject_id, grade_level_id FROM subject_offering'),
  ]);
  return subjects.map((s) => ({ ...s, grade_level_ids: offerings.filter((o) => o.subject_id === s.id).map((o) => o.grade_level_id) }));
};

export const listActiveSubjects = (): Promise<Subject[]> => all<Subject>("SELECT * FROM subject WHERE status = 'ACTIVE' ORDER BY name");

/** The subjects offered in a grade — what a stream's timetable, assignments and marks are drawn from. */
export const listSubjectsForGrade = (gradeLevelId: number): Promise<Subject[]> =>
  all<Subject>(
    `SELECT s.* FROM subject s JOIN subject_offering o ON o.subject_id = s.id
     WHERE o.grade_level_id = ? AND s.status = 'ACTIVE' ORDER BY s.is_core DESC, s.name`, gradeLevelId,
  );

export interface SubjectInput { code: string; name: string; educationLevelId?: number | null; isCore?: boolean; status?: string; gradeLevelIds: number[] }

export async function saveSubject(id: number | null, input: SubjectInput, user: Actor): Promise<{ id: number }> {
  const code = String(input.code || '').trim().toUpperCase();
  const name = String(input.name || '').trim();
  if (!code || !name) throw new AppError('A subject needs a code and a name', 'VALIDATION');
  if (await hasAnyRow('subject', `code = ? ${id ? 'AND id <> ?' : ''}`, ...(id ? [code, id] : [code]))) throw new AppError(`Subject code ${code} is already used`, 'DUPLICATE');
  return tx(async () => {
    let subjectId = id;
    if (subjectId) {
      await run('UPDATE subject SET code=?, name=?, education_level_id=?, is_core=?, status=? WHERE id=?',
        code, name, input.educationLevelId || null, input.isCore ?? true, input.status || 'ACTIVE', subjectId);
    } else {
      const info = await run('INSERT INTO subject (code, name, education_level_id, is_core, status) VALUES (?,?,?,?,?)',
        code, name, input.educationLevelId || null, input.isCore ?? true, input.status || 'ACTIVE');
      subjectId = Number(info.lastInsertRowid);
    }
    await run('DELETE FROM subject_offering WHERE subject_id = ?', subjectId);
    for (const g of new Set(input.gradeLevelIds.map(Number).filter((n) => n > 0))) {
      await run('INSERT INTO subject_offering (subject_id, grade_level_id) VALUES (?,?)', subjectId, g);
    }
    await audit(user, id ? 'SUBJECT_UPDATE' : 'SUBJECT_CREATE', 'subject', subjectId, { code, grades: input.gradeLevelIds.length });
    return { id: subjectId };
  });
}

export async function deleteSubject(id: number, user: Actor): Promise<void> {
  if (await hasAnyRow('assessment_record', 'subject_id = ?', id)) throw new AppError('Marks have been entered for this subject — mark it Inactive instead', 'IN_USE');
  await tx(async () => {
    await run('DELETE FROM timetable_slot WHERE subject_id = ?', id);
    await run('DELETE FROM teacher_subject_assignment WHERE subject_id = ?', id);
    await run('DELETE FROM subject WHERE id = ?', id);
  });
  await audit(user, 'SUBJECT_DELETE', 'subject', id, {});
}

/* ---------------------------------------------------------- grading & assessment */

export const listGradingScales = async (): Promise<GradingScaleWithBands[]> => {
  const [scales, bands] = await Promise.all([
    all<GradingScale>('SELECT * FROM grading_scale ORDER BY is_default DESC, name'),
    all<AssessmentBand>('SELECT * FROM assessment_band ORDER BY grading_scale_id, sort'),
  ]);
  return scales.map((s) => ({ ...s, bands: bands.filter((b) => b.grading_scale_id === s.id) }));
};

export const getDefaultGradingScale = async (): Promise<GradingScaleWithBands | undefined> =>
  (await listGradingScales()).find((s) => s.is_default) ?? (await listGradingScales())[0];

export interface BandDraft { id?: number | string | null; label: string; minScore: number; maxScore: number; colorHex?: string }
export interface GradingScaleInput { name: string; isDefault?: boolean }

export async function saveGradingScale(id: number | null, input: GradingScaleInput, bands: BandDraft[], user: Actor): Promise<{ id: number }> {
  const name = String(input.name || '').trim();
  if (!name) throw new AppError('The scale needs a name', 'VALIDATION');
  const rows = bands.filter((b) => String(b.label || '').trim());
  if (!rows.length) throw new AppError('A grading scale needs at least one band', 'VALIDATION');
  const sorted = [...rows].sort((a, b) => Number(b.minScore) - Number(a.minScore));
  for (const b of sorted) {
    if (Number(b.minScore) > Number(b.maxScore)) throw new AppError(`${b.label}: the minimum score is above the maximum`, 'VALIDATION');
  }
  for (let i = 1; i < sorted.length; i++) {
    if (Number(sorted[i].maxScore) >= Number(sorted[i - 1].minScore)) throw new AppError(`${sorted[i].label} overlaps ${sorted[i - 1].label}`, 'VALIDATION');
  }
  return tx(async () => {
    if (await hasAnyRow('grading_scale', `name = ? ${id ? 'AND id <> ?' : ''}`, ...(id ? [name, id] : [name]))) throw new AppError('That scale already exists', 'DUPLICATE');
    if (input.isDefault) await run('UPDATE grading_scale SET is_default = false');
    let scaleId = id;
    if (scaleId) await run('UPDATE grading_scale SET name=?, is_default=? WHERE id=?', name, !!input.isDefault, scaleId);
    else {
      const info = await run('INSERT INTO grading_scale (name, is_default) VALUES (?,?)', name, !!input.isDefault);
      scaleId = Number(info.lastInsertRowid);
    }
    await run('DELETE FROM assessment_band WHERE grading_scale_id = ?', scaleId);
    let sort = 0;
    for (const b of sorted) {
      sort += 1;
      await run('INSERT INTO assessment_band (grading_scale_id, label, min_score, max_score, sort, color_hex) VALUES (?,?,?,?,?,?)',
        scaleId, String(b.label).trim(), Number(b.minScore), Number(b.maxScore), sort, b.colorHex || '#64748b');
    }
    // The school must always have a default scale to label marks with.
    if (!(await hasAnyRow('grading_scale', 'is_default'))) await run('UPDATE grading_scale SET is_default = true WHERE id = ?', scaleId);
    await audit(user, id ? 'GRADING_SCALE_UPDATE' : 'GRADING_SCALE_CREATE', 'grading_scale', scaleId, { name, bands: sorted.length });
    return { id: scaleId };
  });
}

export async function deleteGradingScale(id: number, user: Actor): Promise<void> {
  const scale = await one<GradingScale>('SELECT * FROM grading_scale WHERE id = ?', id);
  if (!scale) throw new AppError('Scale not found', 'NOT_FOUND');
  if (scale.is_default) throw new AppError('Make another scale the default first', 'VALIDATION');
  await run('DELETE FROM grading_scale WHERE id = ?', id);
  await audit(user, 'GRADING_SCALE_DELETE', 'grading_scale', id, {});
}

/** The band a score falls in, on the default scale — copied onto the mark as its competency label. */
export async function bandForScore(score: number, scale?: GradingScaleWithBands): Promise<AssessmentBand | undefined> {
  const s = scale ?? await getDefaultGradingScale();
  return s?.bands.find((b) => score >= b.min_score && score <= b.max_score);
}

export const listAssessmentTypes = (): Promise<AssessmentType[]> => all<AssessmentType>('SELECT * FROM assessment_type ORDER BY sort, name');

export interface AssessmentTypeInput { name: string; weight?: number; isExam?: boolean; sort?: number }

export async function saveAssessmentType(id: number | null, input: AssessmentTypeInput, user: Actor): Promise<{ id: number }> {
  const name = String(input.name || '').trim();
  if (!name) throw new AppError('The assessment type needs a name', 'VALIDATION');
  const weight = Number(input.weight ?? 1);
  if (!(weight > 0)) throw new AppError('The weight must be greater than zero', 'VALIDATION');
  if (await hasAnyRow('assessment_type', `name = ? ${id ? 'AND id <> ?' : ''}`, ...(id ? [name, id] : [name]))) throw new AppError('That assessment type already exists', 'DUPLICATE');
  if (id) {
    await run('UPDATE assessment_type SET name=?, weight=?, is_exam=?, sort=? WHERE id=?', name, weight, !!input.isExam, Number(input.sort) || 1, id);
    await audit(user, 'ASSESSMENT_TYPE_UPDATE', 'assessment_type', id, { name });
    return { id };
  }
  const info = await run('INSERT INTO assessment_type (name, weight, is_exam, sort) VALUES (?,?,?,?)', name, weight, !!input.isExam, Number(input.sort) || 1);
  await audit(user, 'ASSESSMENT_TYPE_CREATE', 'assessment_type', info.lastInsertRowid, { name });
  return { id: Number(info.lastInsertRowid) };
}

export async function deleteAssessmentType(id: number, user: Actor): Promise<void> {
  if (await hasAnyRow('assessment_record', 'assessment_type_id = ?', id)) throw new AppError('Marks have been entered under this type — it cannot be deleted', 'IN_USE');
  await run('DELETE FROM assessment_type WHERE id = ?', id);
  await audit(user, 'ASSESSMENT_TYPE_DELETE', 'assessment_type', id, {});
}
