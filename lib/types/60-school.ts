/* school — split out of lib/types.ts; import from '@/lib/types', never from here directly. */
import type { Cents, IsoDate, IsoDateTime } from '../types.ts';

/* -------------------------------------------------------------- academic setup */

export interface AcademicYear {
  id: number;
  name: string;
  start_date: IsoDate;
  end_date: IsoDate;
  is_current: boolean;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface AcademicYearWithTerms extends AcademicYear {
  terms: AcademicTerm[];
  /** Streams opened for this year — a year with classes cannot be deleted. */
  streams: number;
}

export interface AcademicTerm {
  id: number;
  academic_year_id: number;
  name: string;
  sort: number;
  start_date: IsoDate;
  end_date: IsoDate;
  is_current: boolean;
}

export interface AcademicTermWithYear extends AcademicTerm {
  year_name: string;
}

export interface EducationLevel {
  id: number;
  name: string;
  sort: number;
}

export interface GradeLevel {
  id: number;
  education_level_id: number;
  name: string;
  sort: number;
}

export interface GradeLevelWithUsage extends GradeLevel {
  education_level_name: string;
  streams: number;
  students: number;
}

export interface Stream {
  id: number;
  grade_level_id: number;
  academic_year_id: number;
  name: string;
  class_teacher_id: number | null;
}

export interface StreamView extends Stream {
  grade_level_name: string;
  education_level_name: string;
  year_name: string;
  class_teacher_name: string | null;
  students: number;
}

export interface Subject {
  id: number;
  education_level_id: number | null;
  code: string;
  name: string;
  is_core: boolean;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface SubjectView extends Subject {
  education_level_name: string | null;
  /** Grade levels the subject is offered in, as ids. */
  grade_level_ids: number[];
}

export interface GradingScale {
  id: number;
  name: string;
  is_default: boolean;
}

export interface AssessmentBand {
  id: number;
  grading_scale_id: number;
  label: string;
  min_score: number;
  max_score: number;
  sort: number;
  color_hex: string;
}

export interface GradingScaleWithBands extends GradingScale {
  bands: AssessmentBand[];
}

export interface AssessmentType {
  id: number;
  name: string;
  weight: number;
  is_exam: boolean;
  sort: number;
}

/* --------------------------------------------------------------------- people */

export interface TeacherProfile {
  id: number;
  employee_id: number;
  tsc_number: string | null;
  qualification: string | null;
  specialisation: string | null;
}

/** A teacher as listed — the employee plus the teaching profile. */
export interface TeacherView extends TeacherProfile {
  employee_no: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  photo_image: string | null;
  employee_status: string;
  /** Classes this teacher teaches this year — subject-stream pairs. */
  assignments: number;
}

export interface TeacherSubjectAssignment {
  id: number;
  teacher_id: number;
  subject_id: number;
  stream_id: number;
  academic_year_id: number;
}

export interface TeacherAssignmentView extends TeacherSubjectAssignment {
  subject_code: string;
  subject_name: string;
  stream_name: string;
  grade_level_name: string;
  teacher_name: string;
  employee_no: string;
  students: number;
}

export interface Guardian {
  id: number;
  full_name: string;
  phone: string;
  email: string | null;
  national_id: string | null;
  relationship: string;
  occupation: string | null;
  address: string | null;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface StudentGuardianView extends Guardian {
  is_primary: boolean;
}

export type StudentStatus = 'ACTIVE' | 'GRADUATED' | 'TRANSFERRED' | 'SUSPENDED' | 'INACTIVE';

export interface Student {
  id: number;
  admission_no: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  gender: string | null;
  date_of_birth: IsoDate | null;
  birth_certificate_no: string | null;
  nemis_upi: string | null;
  photo: string | null;
  address: string | null;
  county_id: number | null;
  sub_county_id: number | null;
  admission_date: IsoDate;
  status: StudentStatus;
  current_grade_level_id: number | null;
  current_stream_id: number | null;
  customer_id: number | null;
  medical_notes: string | null;
  religion: string | null;
  created_at: IsoDateTime | null;
  created_by: string | null;
  updated_at: IsoDateTime | null;
  updated_by: string | null;
}

export interface StudentListRow extends Student {
  grade_level_name: string | null;
  stream_name: string | null;
  primary_guardian_name: string | null;
  primary_guardian_phone: string | null;
  /** The fee account balance — the customer's, positive = owing. */
  fee_balance: Cents;
}

export interface StudentView extends StudentListRow {
  county_name: string | null;
  sub_county_name: string | null;
  customer_no: string | null;
  guardians: StudentGuardianView[];
  enrollments: EnrollmentView[];
}

export interface Enrollment {
  id: number;
  student_id: number;
  academic_year_id: number;
  grade_level_id: number;
  stream_id: number | null;
  status: 'ACTIVE' | 'PROMOTED' | 'REPEATED' | 'TRANSFERRED_OUT' | 'GRADUATED';
  created_at: IsoDateTime | null;
}

export interface EnrollmentView extends Enrollment {
  year_name: string;
  grade_level_name: string;
  stream_name: string | null;
}

/* ------------------------------------------------------- timetable / attendance */

export interface TimetableSlot {
  id: number;
  stream_id: number;
  subject_id: number;
  teacher_id: number;
  academic_year_id: number;
  term_id: number;
  day_of_week: number;
  start_time: string;
  end_time: string;
  room: string | null;
}

export interface TimetableSlotView extends TimetableSlot {
  subject_name: string;
  subject_code: string;
  teacher_name: string;
  stream_name: string;
  grade_level_name: string;
}

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';

export interface AttendanceRecord {
  id: number;
  student_id: number;
  stream_id: number;
  date: IsoDate;
  status: AttendanceStatus;
  remarks: string | null;
  recorded_by: string | null;
  recorded_at: IsoDateTime | null;
}

export interface AttendanceSummary {
  present: number;
  absent: number;
  late: number;
  excused: number;
  total: number;
  rate: number;
}

/* ---------------------------------------------------------------- assessment */

export interface AssessmentRecord {
  id: number;
  student_id: number;
  subject_id: number;
  assessment_type_id: number;
  term_id: number;
  academic_year_id: number;
  score: number;
  competency_label: string | null;
  remarks: string | null;
  recorded_by: string | null;
  recorded_at: IsoDateTime | null;
}

export interface AssessmentRecordView extends AssessmentRecord {
  subject_name: string;
  subject_code: string;
  assessment_type_name: string;
  weight: number;
  is_exam: boolean;
  term_name: string;
  band_color: string | null;
}

export interface ReportCard {
  id: number;
  student_id: number;
  term_id: number;
  academic_year_id: number;
  class_teacher_remarks: string | null;
  principal_remarks: string | null;
  attendance_summary: string | null;
  is_published: boolean;
  published_at: IsoDateTime | null;
  published_by: string | null;
}

/** One subject's line on a report card — the weighted average across the term's assessments. */
export interface ReportCardLine {
  subject_id: number;
  subject_code: string;
  subject_name: string;
  scores: { assessment_type_id: number; assessment_type_name: string; score: number; competency_label: string | null }[];
  average: number | null;
  competency_label: string | null;
  band_color: string | null;
}

/* ---------------------------------------------------------------------- fees */

export interface FeeItem {
  id: number;
  code: string;
  name: string;
  gl_account_id: number;
  status: 'ACTIVE' | 'INACTIVE';
  sort: number;
}

export interface FeeItemView extends FeeItem {
  gl_account_code: string;
  gl_account_name: string;
}

export interface FeeStructure {
  id: number;
  grade_level_id: number;
  term_id: number;
  fee_item_id: number;
  amount: Cents;
  applies_to: string;
}

export interface FeeStructureView extends FeeStructure {
  grade_level_name: string;
  term_name: string;
  year_name: string;
  fee_item_code: string;
  fee_item_name: string;
}

export interface FeeInvoiceRun {
  id: number;
  no: string;
  term_id: number;
  academic_year_id: number;
  grade_level_id: number | null;
  posting_date: IsoDate;
  due_date: IsoDate;
  status: 'Open' | 'Posted';
  students_billed: number;
  total_amount: Cents;
  created_at: IsoDateTime | null;
  created_by: string | null;
  posted_at: IsoDateTime | null;
  posted_by: string | null;
}

export interface FeeInvoiceRunView extends FeeInvoiceRun {
  term_name: string;
  year_name: string;
  grade_level_name: string | null;
}

export interface FeeInvoice {
  id: number;
  run_id: number;
  student_id: number;
  customer_id: number;
  term_id: number;
  posted_invoice_no: string;
  amount: Cents;
  created_at: IsoDateTime | null;
}

export interface FeeInvoiceView extends FeeInvoice {
  admission_no: string;
  student_name: string;
  grade_level_name: string | null;
  stream_name: string | null;
  /** What is still open on the invoice's customer ledger entry. */
  remaining_amount: Cents;
  due_date: IsoDate | null;
  posting_date: IsoDate | null;
  run_no: string;
  term_name: string;
  year_name: string;
}

/** A student's fee statement line — every open and closed customer ledger entry. */
export interface FeeStatementLine {
  id: number;
  posting_date: IsoDate;
  document_type: string;
  document_no: string;
  description: string | null;
  amount: Cents;
  remaining_amount: Cents;
  due_date: IsoDate | null;
  running_balance: Cents;
}

/* ------------------------------------------------------------- communication */

export type AnnouncementAudience = 'ALL' | 'STAFF' | 'TEACHERS' | 'STUDENTS' | 'GUARDIANS' | 'GRADE_LEVEL' | 'STREAM';

export interface Announcement {
  id: number;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  grade_level_id: number | null;
  stream_id: number | null;
  published_at: IsoDateTime;
  expires_at: IsoDateTime | null;
  created_by: string | null;
  created_at: IsoDateTime | null;
}

export interface AnnouncementView extends Announcement {
  grade_level_name: string | null;
  stream_name: string | null;
}

/* ------------------------------------------------------------------ dashboard */

/** The Super Role Centre's tiles — school and finance at a glance. */
export interface DashboardData {
  students: { total: number; active: number; boys: number; girls: number };
  teachers: number;
  streams: number;
  currentTerm: { year: string; term: string; start_date: IsoDate; end_date: IsoDate } | null;
  attendanceToday: AttendanceSummary | null;
  fees: { invoiced: Cents; collected: Cents; outstanding: Cents; overdue: Cents };
  cash: Cents;
  income: Cents;
  expense: Cents;
  surplus: Cents;
  pendingApprovals: number;
  /** Fee receipts by month (posted Customer receipts), oldest first. */
  monthlyCollections: { month: string; collected: Cents; invoiced: Cents }[];
  /** Enrolment per grade level. */
  enrolmentByGrade: { grade: string; students: number }[];
  recentReceipts: { no: string; posting_date: IsoDate; description: string | null; amount: Cents; receipt_type: string }[];
}
