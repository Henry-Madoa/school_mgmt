/*
 * Codeunit "Channels Integration" — the procedures a parents' mobile app, a USSD gateway, the
 * paybill or a school-portal front end calls: student lookups, fee balances and mini statements,
 * invoices, the term calendar, report cards, attendance and announcements, and the fee payment
 * itself (an STK push to the guardian's handset). Everything reads and posts through the same
 * library functions the office uses, so channel activity carries the same validations, journals
 * and audit trail.
 *
 * Responses are JSON objects; every procedure that can fail throws, and the protocol layer
 * turns that into an OData error or SOAP fault with a proper status. Money is decimal (12.50).
 */
import { one, all } from '../db.ts';
import { AppError } from '../errors.ts';
import { getStudent, getStudentByAdmissionNo, listGuardianStudents } from '../students.ts';
import { feeAccountSummary, feeStatement } from '../fees/statement.ts';
import { listStudentFeeInvoices } from '../fees/invoices.ts';
import { buildReportCard, listPublishedTerms } from '../academics/assessments.ts';
import { listStudentAttendance, studentAttendanceSummary } from '../academics/attendance.ts';
import { listStreamTimetable, DAY_NAMES } from '../academics/timetable.ts';
import { resolveTerm, listTerms } from '../academics/setup.ts';
import { visibleAnnouncements } from '../announcements.ts';
import { requestStkPayment, mpesaConfigured } from '../mpesa/index.ts';
import { normalisePhone } from '../sms.ts';
import { imageSrc } from '../cloudinary.ts';
import type { WsCodeunit, WsProcedure, WsType } from './objects.ts';
import type { Student } from '../types.ts';

const P = (name: string, type: WsType, required = true) => ({ name, type, required });
const m = (cents: unknown) => Number(cents ?? 0) / 100;
const str = (v: unknown): string | null => (v == null || String(v).trim() === '' ? null : String(v).trim());

/* ------------------------------------------------------------------------------ lookups */

async function studentByNo(admissionNo: unknown): Promise<Student> {
  const s = await getStudentByAdmissionNo(String(admissionNo ?? ''));
  if (!s) throw new AppError(`Student ${String(admissionNo ?? '')} not found`, 'NOT_FOUND');
  return s;
}

const studentJson = async (id: number) => {
  const s = await getStudent(id);
  if (!s) throw new AppError('Student not found', 'NOT_FOUND');
  const primary = s.guardians.find((g) => g.is_primary) ?? s.guardians[0];
  return {
    AdmissionNo: s.admission_no, Name: [s.first_name, s.middle_name, s.last_name].filter(Boolean).join(' '), Gender: s.gender,
    DateOfBirth: s.date_of_birth, Grade: s.grade_level_name, Class: s.stream_name, Status: s.status, AdmissionDate: s.admission_date,
    FeeAccountNo: s.customer_no, FeeBalance: m(s.fee_balance), PhotoUrl: imageSrc(s.photo, { width: 240, height: 240, crop: 'fill' }),
    Guardian: primary ? { Name: primary.full_name, Phone: primary.phone, Email: primary.email, Relationship: primary.relationship } : null,
  };
};

const procedures: WsProcedure[] = [
  {
    name: 'FindStudent', caption: 'Look a student up by admission number, or every student of a guardian by phone',
    params: [P('admissionNo', 'Code', false), P('phone', 'Text', false)], returns: 'Json', action: 'STUDENTS_READ',
    run: async ({ admissionNo, phone }) => {
      if (str(admissionNo)) return [await studentJson((await studentByNo(admissionNo)).id)];
      const number = str(phone) ? normalisePhone(String(phone)) : null;
      if (!number) throw new AppError('Give an admission number or a phone number', 'VALIDATION');
      const guardian = await one<{ id: number }>(
        "SELECT id FROM guardian WHERE regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') LIKE '%' || ? ORDER BY id LIMIT 1", number.replace(/\D/g, '').slice(-9),
      );
      if (!guardian) return [];
      const kids = await listGuardianStudents(guardian.id);
      return Promise.all(kids.map((k) => studentJson(k.id)));
    },
  },
  {
    name: 'GetFeeBalance', caption: 'Fee balance, what is overdue and when the next instalment is due', params: [P('admissionNo', 'Code')], returns: 'Json', action: 'FEES_READ',
    run: async ({ admissionNo }) => {
      const s = await studentByNo(admissionNo);
      const f = await feeAccountSummary(s.id);
      if (!f) throw new AppError('This student has no fee account yet', 'NOT_FOUND');
      return { AdmissionNo: s.admission_no, FeeAccountNo: f.customer_no, Balance: m(f.balance), Overdue: m(f.overdue), Invoiced: m(f.invoiced), Paid: m(f.paid), LastPaymentDate: f.last_payment_date, NextDueDate: f.next_due_date };
    },
  },
  {
    name: 'GetFeeStatement', caption: 'Fee statement lines between two dates (default: this year)', params: [P('admissionNo', 'Code'), P('from', 'Date', false), P('to', 'Date', false)], returns: 'Json', action: 'FEES_READ',
    run: async ({ admissionNo, from, to }) => {
      const s = await studentByNo(admissionNo);
      const st = await feeStatement(s.id, str(from) ?? `${new Date().getFullYear()}-01-01`, str(to));
      return {
        AdmissionNo: s.admission_no, OpeningBalance: m(st.opening), ClosingBalance: m(st.closing),
        Lines: st.lines.map((l) => ({ PostingDate: l.posting_date, DocumentType: l.document_type, DocumentNo: l.document_no, Description: l.description, Amount: m(l.amount), Remaining: m(l.remaining_amount), DueDate: l.due_date, RunningBalance: m(l.running_balance) })),
      };
    },
  },
  {
    name: 'GetFeeInvoices', caption: 'Every fee invoice raised on the student, with what is still open', params: [P('admissionNo', 'Code')], returns: 'Json', action: 'FEES_READ',
    run: async ({ admissionNo }) => {
      const s = await studentByNo(admissionNo);
      return (await listStudentFeeInvoices(s.id)).map((i) => ({ InvoiceNo: i.posted_invoice_no, Term: i.term_id, Amount: m(i.amount), Remaining: m(i.remaining_amount), DueDate: i.due_date }));
    },
  },
  {
    name: 'PayFees', caption: 'Ask the guardian’s handset to pay fees (M-Pesa STK push)', params: [P('admissionNo', 'Code'), P('phone', 'Text'), P('amount', 'Decimal')], returns: 'Json', action: 'MPESA_INITIATE',
    run: async ({ admissionNo, phone, amount }, ctx) => {
      if (!mpesaConfigured()) throw new AppError('M-Pesa is not configured on this server', 'VALIDATION');
      const s = await studentByNo(admissionNo);
      const r = await requestStkPayment({ phone: String(phone ?? ''), amount: Math.round(Number(amount) * 100), studentId: s.id, description: 'School fees' }, ctx.actor);
      return { RequestId: r.id, Message: r.customerMessage };
    },
  },
  {
    name: 'GetTerms', caption: 'The academic calendar — every term and which is current', params: [], returns: 'Json', action: 'STUDENT_PORTAL_VIEW',
    run: async () => (await listTerms()).map((t) => ({ TermId: t.id, Year: t.year_name, Name: t.name, StartDate: t.start_date, EndDate: t.end_date, IsCurrent: t.is_current })),
  },
  {
    name: 'GetTimetable', caption: 'The student’s class timetable for a term (default: the current one)', params: [P('admissionNo', 'Code'), P('termId', 'Integer', false)], returns: 'Json', action: 'TIMETABLE_READ',
    run: async ({ admissionNo, termId }) => {
      const s = await studentByNo(admissionNo);
      if (!s.current_stream_id) return [];
      const term = await resolveTerm(termId ? Number(termId) : null);
      if (!term) return [];
      return (await listStreamTimetable(s.current_stream_id, term.id)).map((x) => ({ Day: DAY_NAMES[x.day_of_week], DayOfWeek: x.day_of_week, StartTime: x.start_time, EndTime: x.end_time, Subject: x.subject_name, Teacher: x.teacher_name, Room: x.room }));
    },
  },
  {
    name: 'GetAttendance', caption: 'Attendance summary and daily records for a term', params: [P('admissionNo', 'Code'), P('termId', 'Integer', false)], returns: 'Json', action: 'ATTENDANCE_READ',
    run: async ({ admissionNo, termId }) => {
      const s = await studentByNo(admissionNo);
      const term = await resolveTerm(termId ? Number(termId) : null);
      if (!term) return { Summary: null, Records: [] };
      const [summary, records] = await Promise.all([studentAttendanceSummary(s.id, term.start_date, term.end_date), listStudentAttendance(s.id, term.start_date, term.end_date)]);
      return { Term: term.name, Summary: summary, Records: records.map((r) => ({ Date: r.date, Status: r.status, Remarks: r.remarks })) };
    },
  },
  {
    name: 'GetReportCard', caption: 'A published report card for a term', params: [P('admissionNo', 'Code'), P('termId', 'Integer')], returns: 'Json', action: 'REPORT_CARDS_READ',
    run: async ({ admissionNo, termId }) => {
      const s = await studentByNo(admissionNo);
      const published = (await listPublishedTerms(s.id)).some((t) => t.term_id === Number(termId));
      if (!published) throw new AppError('That report card has not been published', 'NOT_FOUND');
      const rc = await buildReportCard(s.id, Number(termId));
      if (!rc) throw new AppError('Report card not found', 'NOT_FOUND');
      return {
        Student: rc.student, Term: rc.term, Overall: rc.overall, Attendance: rc.attendance, Position: rc.position,
        Subjects: rc.lines.map((l) => ({ Subject: l.subject_name, Average: l.average, Competency: l.competency_label, Scores: l.scores.map((x) => ({ Assessment: x.assessment_type_name, Score: x.score, Competency: x.competency_label })) })),
        ClassTeacherRemarks: rc.card?.class_teacher_remarks ?? null, PrincipalRemarks: rc.card?.principal_remarks ?? null,
      };
    },
  },
  {
    name: 'GetAnnouncements', caption: 'Announcements addressed to a student and their guardians', params: [P('admissionNo', 'Code')], returns: 'Json', action: 'ANNOUNCEMENTS_READ',
    run: async ({ admissionNo }) => {
      const s = await studentByNo(admissionNo);
      const rows = await visibleAnnouncements({ audiences: ['STUDENTS', 'GUARDIANS'], gradeLevelIds: s.current_grade_level_id ? [s.current_grade_level_id] : [], streamIds: s.current_stream_id ? [s.current_stream_id] : [] });
      return rows.map((a) => ({ Id: a.id, Title: a.title, Body: a.body, PublishedAt: a.published_at, Audience: a.audience }));
    },
  },
  {
    name: 'GetClassRoster', caption: 'The students in one class', params: [P('streamId', 'Integer')], returns: 'Json', action: 'CLASSES_READ',
    run: async ({ streamId }) => all<{ admission_no: string; name: string; gender: string | null }>(
      "SELECT admission_no, first_name || ' ' || last_name AS name, gender FROM student WHERE current_stream_id = ? AND status = 'ACTIVE' ORDER BY last_name, first_name", Number(streamId),
    ).then((rows) => rows.map((r) => ({ AdmissionNo: r.admission_no, Name: r.name, Gender: r.gender }))),
  },
];

export const CHANNELS_INTEGRATION: WsCodeunit = {
  kind: 'CODEUNIT', id: 50302, name: 'Channels Integration', caption: 'Channels Integration', procedures,
};
