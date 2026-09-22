/*
 * Assessments — marks per student, subject, assessment type and term, labelled with the band
 * they fall in on the default grading scale at entry time (so history does not move when the
 * scale is edited), and the report card built from them: a weighted average per subject across
 * the term's assessment types, the class teacher's and principal's remarks, and the term's
 * attendance summary.
 */
import { one, all, run, tx, audit } from '../db.ts';
import { AppError } from '../errors.ts';
import { bandForScore, getDefaultGradingScale, listAssessmentTypes, listSubjectsForGrade } from './setup.ts';
import { studentAttendanceSummary } from './attendance.ts';
import type { Actor, AssessmentRecordView, ReportCard, ReportCardLine } from '../types.ts';

const VIEW_SELECT = `
  SELECT ar.*, sub.name AS subject_name, sub.code AS subject_code, at.name AS assessment_type_name, at.weight, at.is_exam,
         t.name AS term_name,
         (SELECT b.color_hex FROM assessment_band b JOIN grading_scale gs ON gs.id = b.grading_scale_id
          WHERE gs.is_default AND ar.score >= b.min_score AND ar.score <= b.max_score LIMIT 1) AS band_color
  FROM assessment_record ar
  JOIN subject sub ON sub.id = ar.subject_id
  JOIN assessment_type at ON at.id = ar.assessment_type_id
  JOIN academic_term t ON t.id = ar.term_id`;

/** Every mark of one class for one subject and assessment type in a term — the entry grid. */
export const listClassMarks = (streamId: number, subjectId: number, assessmentTypeId: number, termId: number): Promise<AssessmentRecordView[]> =>
  all<AssessmentRecordView>(
    `${VIEW_SELECT} JOIN student s ON s.id = ar.student_id
     WHERE s.current_stream_id = ? AND ar.subject_id = ? AND ar.assessment_type_id = ? AND ar.term_id = ?`,
    streamId, subjectId, assessmentTypeId, termId,
  );

export const listStudentMarks = (studentId: number, termId: number): Promise<AssessmentRecordView[]> =>
  all<AssessmentRecordView>(`${VIEW_SELECT} WHERE ar.student_id = ? AND ar.term_id = ? ORDER BY sub.name, at.sort`, studentId, termId);

export interface MarkInput { studentId: number; score: number | null; remarks?: string | null }

/** Saves a class's marks for one subject / assessment type / term. A blank score clears the mark. */
export async function enterMarks(
  streamId: number, subjectId: number, assessmentTypeId: number, termId: number, marks: MarkInput[], user: Actor,
): Promise<{ saved: number; cleared: number }> {
  const term = await one<{ academic_year_id: number }>('SELECT academic_year_id FROM academic_term WHERE id = ?', termId);
  if (!term) throw new AppError('Term not found', 'NOT_FOUND');
  const st = await one<{ grade_level_id: number; academic_year_id: number }>('SELECT grade_level_id, academic_year_id FROM stream WHERE id = ?', streamId);
  if (!st) throw new AppError('Class not found', 'NOT_FOUND');
  if (st.academic_year_id !== term.academic_year_id) throw new AppError('That term is not in the class\'s academic year', 'VALIDATION');
  if (!(await listSubjectsForGrade(st.grade_level_id)).some((s) => s.id === subjectId)) throw new AppError('That subject is not offered in this grade', 'VALIDATION');
  if (!(await listAssessmentTypes()).some((t) => t.id === assessmentTypeId)) throw new AppError('Assessment type not found', 'NOT_FOUND');
  const roster = new Set((await all<{ id: number }>("SELECT id FROM student WHERE current_stream_id = ? AND status = 'ACTIVE'", streamId)).map((r) => r.id));
  const scale = await getDefaultGradingScale();
  const at = new Date().toISOString();
  let saved = 0; let cleared = 0;
  await tx(async () => {
    for (const m of marks) {
      if (!roster.has(Number(m.studentId))) continue;
      if (m.score == null || m.score === ('' as unknown)) {
        const r = await run('DELETE FROM assessment_record WHERE student_id = ? AND subject_id = ? AND assessment_type_id = ? AND term_id = ?', m.studentId, subjectId, assessmentTypeId, termId);
        if (r.changes) cleared += 1;
        continue;
      }
      const score = Number(m.score);
      if (!(score >= 0 && score <= 100)) throw new AppError('Scores are 0–100', 'VALIDATION');
      const band = await bandForScore(score, scale);
      await run(
        `INSERT INTO assessment_record (student_id, subject_id, assessment_type_id, term_id, academic_year_id, score, competency_label, remarks, recorded_by, recorded_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT (student_id, subject_id, assessment_type_id, term_id) DO UPDATE SET
           score = EXCLUDED.score, competency_label = EXCLUDED.competency_label, remarks = EXCLUDED.remarks, recorded_by = EXCLUDED.recorded_by, recorded_at = EXCLUDED.recorded_at`,
        m.studentId, subjectId, assessmentTypeId, termId, term.academic_year_id, score, band?.label ?? null, m.remarks?.trim() || null, user.username, at,
      );
      saved += 1;
    }
  });
  await audit(user, 'ASSESSMENT_ENTER', 'stream', streamId, { subjectId, assessmentTypeId, termId, saved, cleared });
  return { saved, cleared };
}

/* ---------------------------------------------------------------- report cards */

export interface ReportCardView {
  card: ReportCard | null;
  student: { id: number; admission_no: string; name: string; grade_level_name: string | null; stream_name: string | null; photo: string | null };
  term: { id: number; name: string; year_name: string; start_date: string; end_date: string };
  lines: ReportCardLine[];
  /** Mean of the subject averages — the overall standing. */
  overall: { average: number | null; competency_label: string | null; band_color: string | null };
  attendance: { present: number; absent: number; late: number; excused: number; total: number; rate: number };
  /** Position in the class by overall average, of how many with marks. */
  position: { rank: number; of: number } | null;
}

/** Builds a student's report card for a term from the marks on file. */
export async function buildReportCard(studentId: number, termId: number): Promise<ReportCardView | undefined> {
  const student = await one<{ id: number; admission_no: string; first_name: string; middle_name: string | null; last_name: string; photo: string | null; current_grade_level_id: number | null; current_stream_id: number | null; grade_level_name: string | null; stream_name: string | null }>(
    `SELECT s.id, s.admission_no, s.first_name, s.middle_name, s.last_name, s.photo, s.current_grade_level_id, s.current_stream_id,
            g.name AS grade_level_name, st.name AS stream_name
     FROM student s LEFT JOIN grade_level g ON g.id = s.current_grade_level_id LEFT JOIN stream st ON st.id = s.current_stream_id WHERE s.id = ?`, studentId,
  );
  const term = await one<{ id: number; name: string; year_name: string; start_date: string; end_date: string }>(
    'SELECT t.id, t.name, y.name AS year_name, t.start_date, t.end_date FROM academic_term t JOIN academic_year y ON y.id = t.academic_year_id WHERE t.id = ?', termId,
  );
  if (!student || !term) return undefined;
  const [marks, types, scale, card, attendance] = await Promise.all([
    listStudentMarks(studentId, termId), listAssessmentTypes(), getDefaultGradingScale(),
    one<ReportCard>('SELECT * FROM report_card WHERE student_id = ? AND term_id = ?', studentId, termId),
    studentAttendanceSummary(studentId, term.start_date, term.end_date),
  ]);
  const subjects = student.current_grade_level_id ? await listSubjectsForGrade(student.current_grade_level_id) : [];
  const bySubject = new Map<number, AssessmentRecordView[]>();
  for (const m of marks) bySubject.set(m.subject_id, [...(bySubject.get(m.subject_id) ?? []), m]);
  const labelFor = (avg: number | null) => {
    if (avg == null) return { competency_label: null, band_color: null };
    const b = scale?.bands.find((x) => avg >= x.min_score && avg <= x.max_score);
    return { competency_label: b?.label ?? null, band_color: b?.color_hex ?? null };
  };
  const subjectIds = new Set([...subjects.map((s) => s.id), ...bySubject.keys()]);
  const lines: ReportCardLine[] = [...subjectIds].map((sid) => {
    const rows = bySubject.get(sid) ?? [];
    const sub = subjects.find((s) => s.id === sid) ?? { id: sid, code: rows[0]?.subject_code ?? '', name: rows[0]?.subject_name ?? '' };
    const weighted = rows.reduce((a, r) => a + r.score * r.weight, 0);
    const weights = rows.reduce((a, r) => a + r.weight, 0);
    const average = weights ? Number((weighted / weights).toFixed(1)) : null;
    return {
      subject_id: sid, subject_code: sub.code, subject_name: sub.name,
      scores: types.map((t) => {
        const r = rows.find((x) => x.assessment_type_id === t.id);
        return { assessment_type_id: t.id, assessment_type_name: t.name, score: r?.score ?? NaN, competency_label: r?.competency_label ?? null };
      }).filter((s) => !Number.isNaN(s.score)),
      average, ...labelFor(average),
    };
  }).sort((a, b) => a.subject_name.localeCompare(b.subject_name));
  const withMarks = lines.filter((l) => l.average != null);
  const overallAvg = withMarks.length ? Number((withMarks.reduce((a, l) => a + (l.average ?? 0), 0) / withMarks.length).toFixed(1)) : null;
  const position = student.current_stream_id && overallAvg != null ? await classPosition(student.current_stream_id, termId, studentId) : null;
  return {
    card: card ?? null,
    student: { id: student.id, admission_no: student.admission_no, name: [student.first_name, student.middle_name, student.last_name].filter(Boolean).join(' '), grade_level_name: student.grade_level_name, stream_name: student.stream_name, photo: student.photo },
    term, lines, overall: { average: overallAvg, ...labelFor(overallAvg) }, attendance, position,
  };
}

/** Overall averages of everyone in a class for a term, best first — the class list and positions. */
export async function classStandings(streamId: number, termId: number): Promise<{ student_id: number; admission_no: string; name: string; average: number; subjects: number }[]> {
  const rows = await all<{ student_id: number; admission_no: string; name: string; subject_id: number; weighted: number; weights: number }>(
    `SELECT s.id AS student_id, s.admission_no, s.first_name || ' ' || s.last_name AS name, ar.subject_id,
            SUM(ar.score * at.weight) AS weighted, SUM(at.weight) AS weights
     FROM student s JOIN assessment_record ar ON ar.student_id = s.id AND ar.term_id = ?
     JOIN assessment_type at ON at.id = ar.assessment_type_id
     WHERE s.current_stream_id = ? AND s.status = 'ACTIVE'
     GROUP BY s.id, s.admission_no, s.first_name, s.last_name, ar.subject_id`, termId, streamId,
  );
  const byStudent = new Map<number, { admission_no: string; name: string; avgs: number[] }>();
  for (const r of rows) {
    const e = byStudent.get(r.student_id) ?? { admission_no: r.admission_no, name: r.name, avgs: [] };
    e.avgs.push(Number(r.weighted) / Number(r.weights));
    byStudent.set(r.student_id, e);
  }
  return [...byStudent.entries()]
    .map(([student_id, e]) => ({ student_id, admission_no: e.admission_no, name: e.name, average: Number((e.avgs.reduce((a, b) => a + b, 0) / e.avgs.length).toFixed(1)), subjects: e.avgs.length }))
    .sort((a, b) => b.average - a.average || a.name.localeCompare(b.name));
}

async function classPosition(streamId: number, termId: number, studentId: number): Promise<{ rank: number; of: number } | null> {
  const standings = await classStandings(streamId, termId);
  const idx = standings.findIndex((s) => s.student_id === studentId);
  return idx < 0 ? null : { rank: idx + 1, of: standings.length };
}

export interface ReportCardRemarks { classTeacherRemarks?: string | null; principalRemarks?: string | null }

/** Saves the remarks and (optionally) publishes the card to the student/parent portal. */
export async function saveReportCard(studentId: number, termId: number, remarks: ReportCardRemarks, publish: boolean, user: Actor): Promise<void> {
  const term = await one<{ academic_year_id: number; start_date: string; end_date: string }>('SELECT academic_year_id, start_date, end_date FROM academic_term WHERE id = ?', termId);
  if (!term) throw new AppError('Term not found', 'NOT_FOUND');
  const att = await studentAttendanceSummary(studentId, term.start_date, term.end_date);
  const summary = att.total ? `Present ${att.present + att.late} of ${att.total} days (${att.rate}%)` : null;
  const at = new Date().toISOString();
  await run(
    `INSERT INTO report_card (student_id, term_id, academic_year_id, class_teacher_remarks, principal_remarks, attendance_summary, is_published, published_at, published_by)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT (student_id, term_id) DO UPDATE SET class_teacher_remarks = EXCLUDED.class_teacher_remarks, principal_remarks = EXCLUDED.principal_remarks,
       attendance_summary = EXCLUDED.attendance_summary,
       is_published = report_card.is_published OR EXCLUDED.is_published,
       published_at = COALESCE(report_card.published_at, EXCLUDED.published_at), published_by = COALESCE(report_card.published_by, EXCLUDED.published_by)`,
    studentId, termId, term.academic_year_id, remarks.classTeacherRemarks?.trim() || null, remarks.principalRemarks?.trim() || null, summary,
    publish, publish ? at : null, publish ? user.username : null,
  );
  await audit(user, publish ? 'REPORT_CARD_PUBLISH' : 'REPORT_CARD_SAVE', 'student', studentId, { termId });
}

/** Publishes every report card of a class for a term in one go. */
export async function publishClassReportCards(streamId: number, termId: number, user: Actor): Promise<{ published: number }> {
  const students = await all<{ id: number }>("SELECT id FROM student WHERE current_stream_id = ? AND status = 'ACTIVE'", streamId);
  let published = 0;
  for (const s of students) {
    const existing = await one<ReportCard>('SELECT * FROM report_card WHERE student_id = ? AND term_id = ?', s.id, termId);
    await saveReportCard(s.id, termId, { classTeacherRemarks: existing?.class_teacher_remarks, principalRemarks: existing?.principal_remarks }, true, user);
    published += 1;
  }
  return { published };
}

export const listPublishedTerms = (studentId: number): Promise<{ term_id: number; term_name: string; year_name: string; published_at: string | null }[]> =>
  all(
    `SELECT rc.term_id, t.name AS term_name, y.name AS year_name, rc.published_at
     FROM report_card rc JOIN academic_term t ON t.id = rc.term_id JOIN academic_year y ON y.id = t.academic_year_id
     WHERE rc.student_id = ? AND rc.is_published ORDER BY t.start_date DESC`, studentId,
  );
