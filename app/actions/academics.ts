'use server';

import { revalidatePath } from 'next/cache';
import { requireAction, requireAnyAction } from '@/lib/session';
import { actionResult } from '@/lib/errors';
import * as setup from '@/lib/academics/setup';
import * as teachers from '@/lib/academics/teachers';
import * as timetable from '@/lib/academics/timetable';
import * as attendance from '@/lib/academics/attendance';
import * as assessments from '@/lib/academics/assessments';
import * as announcements from '@/lib/announcements';
import { requireTeacher, assertTeacherOnStream } from '@/lib/portal';
import type { ActionResult, AnnouncementAudience, AttendanceStatus, FormValues } from '@/lib/types';

const str = (v: unknown): string => String(v ?? '').trim();
const num = (v: unknown): number | null => (v === undefined || v === '' || v === null ? null : Number(v));
const bool = (v: unknown): boolean => v === 1 || v === '1' || v === 'true' || v === true || v === 'on';
const revalidateSetup = () => { revalidatePath('/admin/pool/academics', 'layout'); revalidatePath('/classes'); revalidatePath('/students', 'layout'); };

/* ---------------------------------------------------------------- academic years */

export async function saveAcademicYearRequest(values: FormValues, terms: setup.TermDraft[]): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_ACADEMIC_YEARS_MANAGE');
    const input: setup.AcademicYearInput = { name: str(values.name), startDate: str(values.start_date), endDate: str(values.end_date), isCurrent: bool(values.is_current) };
    const id = values.id ? Number(values.id) : null;
    const rows = terms.map((t) => ({ ...t, isCurrent: bool(t.isCurrent) }));
    const result = id ? (await setup.updateAcademicYear(id, input, rows, user), { id }) : await setup.createAcademicYear(input, rows, user);
    revalidateSetup();
    return result;
  });
}

export async function setCurrentTermRequest(termId: number): Promise<ActionResult<{ done: true }>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_ACADEMIC_YEARS_MANAGE');
    await setup.setCurrentTerm(termId, user);
    revalidateSetup(); revalidatePath('/', 'layout');
    return { done: true };
  });
}

export async function deleteAcademicYearRequest(id: number): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_ACADEMIC_YEARS_MANAGE');
    await setup.deleteAcademicYear(id, user);
    revalidateSetup();
    return { deleted: true };
  });
}

/* ---------------------------------------------------------------- structure */

export async function saveEducationLevelRequest(values: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_ACADEMIC_STRUCTURE_MANAGE');
    const r = await setup.saveEducationLevel(values.id ? Number(values.id) : null, { name: str(values.name), sort: Number(values.sort) || 1 }, user);
    revalidateSetup();
    return r;
  });
}
export async function deleteEducationLevelRequest(id: number): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => { const user = await requireAction('ADMIN_ACADEMIC_STRUCTURE_MANAGE'); await setup.deleteEducationLevel(id, user); revalidateSetup(); return { deleted: true }; });
}
export async function saveGradeLevelRequest(values: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_ACADEMIC_STRUCTURE_MANAGE');
    const r = await setup.saveGradeLevel(values.id ? Number(values.id) : null, { educationLevelId: Number(values.education_level_id), name: str(values.name), sort: Number(values.sort) || 1 }, user);
    revalidateSetup();
    return r;
  });
}
export async function deleteGradeLevelRequest(id: number): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => { const user = await requireAction('ADMIN_ACADEMIC_STRUCTURE_MANAGE'); await setup.deleteGradeLevel(id, user); revalidateSetup(); return { deleted: true }; });
}
export async function saveStreamRequest(values: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAnyAction('ADMIN_ACADEMIC_STRUCTURE_MANAGE', 'CLASSES_MANAGE');
    const r = await setup.saveStream(values.id ? Number(values.id) : null, {
      gradeLevelId: Number(values.grade_level_id), academicYearId: Number(values.academic_year_id), name: str(values.name), classTeacherId: num(values.class_teacher_id),
    }, user);
    revalidateSetup(); revalidatePath('/classes', 'layout');
    return r;
  });
}
export async function deleteStreamRequest(id: number): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => { const user = await requireAnyAction('ADMIN_ACADEMIC_STRUCTURE_MANAGE', 'CLASSES_MANAGE'); await setup.deleteStream(id, user); revalidateSetup(); revalidatePath('/classes', 'layout'); return { deleted: true }; });
}

/* ---------------------------------------------------------------- subjects, grading, assessment types */

export async function saveSubjectRequest(values: FormValues, gradeLevelIds: number[]): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_SUBJECTS_MANAGE');
    const r = await setup.saveSubject(values.id ? Number(values.id) : null, {
      code: str(values.code), name: str(values.name), educationLevelId: num(values.education_level_id), isCore: bool(values.is_core), status: str(values.status) || 'ACTIVE', gradeLevelIds,
    }, user);
    revalidateSetup();
    return r;
  });
}
export async function deleteSubjectRequest(id: number): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => { const user = await requireAction('ADMIN_SUBJECTS_MANAGE'); await setup.deleteSubject(id, user); revalidateSetup(); return { deleted: true }; });
}
export async function saveGradingScaleRequest(values: FormValues, bands: setup.BandDraft[]): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_GRADING_MANAGE');
    const r = await setup.saveGradingScale(values.id ? Number(values.id) : null, { name: str(values.name), isDefault: bool(values.is_default) },
      bands.map((b) => ({ ...b, minScore: Number(b.minScore), maxScore: Number(b.maxScore) })), user);
    revalidateSetup();
    return r;
  });
}
export async function deleteGradingScaleRequest(id: number): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => { const user = await requireAction('ADMIN_GRADING_MANAGE'); await setup.deleteGradingScale(id, user); revalidateSetup(); return { deleted: true }; });
}
export async function saveAssessmentTypeRequest(values: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_ASSESSMENT_TYPES_MANAGE');
    const r = await setup.saveAssessmentType(values.id ? Number(values.id) : null, { name: str(values.name), weight: Number(values.weight) || 1, isExam: bool(values.is_exam), sort: Number(values.sort) || 1 }, user);
    revalidateSetup();
    return r;
  });
}
export async function deleteAssessmentTypeRequest(id: number): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => { const user = await requireAction('ADMIN_ASSESSMENT_TYPES_MANAGE'); await setup.deleteAssessmentType(id, user); revalidateSetup(); return { deleted: true }; });
}

/* ---------------------------------------------------------------- teaching staff */

export async function saveTeacherProfileRequest(values: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('TEACHERS_MANAGE');
    const r = await teachers.saveTeacherProfile({ employeeId: Number(values.employee_id), tscNumber: str(values.tsc_number) || null, qualification: str(values.qualification) || null, specialisation: str(values.specialisation) || null }, user);
    revalidatePath('/teachers', 'layout');
    return r;
  });
}
export async function removeTeacherProfileRequest(employeeId: number): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => { const user = await requireAction('TEACHERS_MANAGE'); await teachers.removeTeacherProfile(employeeId, user); revalidatePath('/teachers', 'layout'); return { deleted: true }; });
}
export async function assignTeacherRequest(values: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('TEACHERS_MANAGE');
    const r = await teachers.assignTeacher(Number(values.teacher_id), Number(values.subject_id), Number(values.stream_id), user);
    revalidatePath('/teachers', 'layout'); revalidatePath('/classes', 'layout');
    return r;
  });
}
export async function unassignTeacherRequest(assignmentId: number): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => { const user = await requireAction('TEACHERS_MANAGE'); await teachers.unassignTeacher(assignmentId, user); revalidatePath('/teachers', 'layout'); revalidatePath('/classes', 'layout'); return { deleted: true }; });
}

/* ---------------------------------------------------------------- timetable */

export async function saveSlotRequest(values: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('TIMETABLE_MANAGE');
    const r = await timetable.saveSlot(values.id ? Number(values.id) : null, {
      streamId: Number(values.stream_id), subjectId: Number(values.subject_id), teacherId: Number(values.teacher_id), termId: Number(values.term_id),
      dayOfWeek: Number(values.day_of_week), startTime: str(values.start_time), endTime: str(values.end_time), room: str(values.room) || null,
    }, user);
    revalidatePath('/timetable', 'layout'); revalidatePath('/my-classes', 'layout'); revalidatePath('/portal', 'layout');
    return r;
  });
}
export async function deleteSlotRequest(id: number): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => { const user = await requireAction('TIMETABLE_MANAGE'); await timetable.deleteSlot(id, user); revalidatePath('/timetable', 'layout'); return { deleted: true }; });
}
export async function copyTimetableRequest(streamId: number, fromTermId: number, toTermId: number): Promise<ActionResult<{ copied: number }>> {
  return actionResult(async () => { const user = await requireAction('TIMETABLE_MANAGE'); const r = await timetable.copyTimetable(streamId, fromTermId, toTermId, user); revalidatePath('/timetable', 'layout'); return r; });
}

/* ---------------------------------------------------------------- attendance & marks (office and teacher portal) */

export interface RegisterDraft { studentId: number; status: AttendanceStatus; remarks?: string }

export async function markRegisterRequest(streamId: number, date: string, marks: RegisterDraft[], viaPortal = false): Promise<ActionResult<{ marked: number }>> {
  return actionResult(async () => {
    const user = viaPortal ? await requireAction('TEACHER_PORTAL_ATTENDANCE') : await requireAction('ATTENDANCE_MARK');
    if (viaPortal) await assertTeacherOnStream(await requireTeacher(user), streamId);
    const r = await attendance.markRegister(streamId, date, marks, user);
    revalidatePath('/attendance', 'layout'); revalidatePath('/my-classes', 'layout'); revalidatePath('/dashboard');
    return r;
  });
}

export interface MarkDraft { studentId: number; score: string | number | null; remarks?: string }

export async function enterMarksRequest(streamId: number, subjectId: number, assessmentTypeId: number, termId: number, marks: MarkDraft[], viaPortal = false): Promise<ActionResult<{ saved: number; cleared: number }>> {
  return actionResult(async () => {
    const user = viaPortal ? await requireAction('TEACHER_PORTAL_ASSESSMENTS') : await requireAction('ASSESSMENTS_ENTER');
    if (viaPortal) await assertTeacherOnStream(await requireTeacher(user), streamId, subjectId);
    const r = await assessments.enterMarks(streamId, subjectId, assessmentTypeId, termId, marks.map((m) => ({ studentId: m.studentId, score: m.score === '' || m.score == null ? null : Number(m.score), remarks: m.remarks })), user);
    revalidatePath('/assessments', 'layout'); revalidatePath('/report-cards', 'layout'); revalidatePath('/my-classes', 'layout');
    return r;
  });
}

export async function saveReportCardRequest(studentId: number, termId: number, values: FormValues, publish: boolean): Promise<ActionResult<{ saved: true }>> {
  return actionResult(async () => {
    const user = await requireAction('REPORT_CARDS_PUBLISH');
    await assessments.saveReportCard(studentId, termId, { classTeacherRemarks: str(values.class_teacher_remarks), principalRemarks: str(values.principal_remarks) }, publish, user);
    revalidatePath('/report-cards', 'layout'); revalidatePath('/portal', 'layout');
    return { saved: true };
  });
}
export async function publishClassReportCardsRequest(streamId: number, termId: number): Promise<ActionResult<{ published: number }>> {
  return actionResult(async () => { const user = await requireAction('REPORT_CARDS_PUBLISH'); const r = await assessments.publishClassReportCards(streamId, termId, user); revalidatePath('/report-cards', 'layout'); revalidatePath('/portal', 'layout'); return r; });
}

/* ---------------------------------------------------------------- announcements */

export async function saveAnnouncementRequest(values: FormValues, viaPortal = false): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = viaPortal ? await requireAction('TEACHER_PORTAL_ANNOUNCE') : await requireAction('ANNOUNCEMENTS_MANAGE');
    const input: announcements.AnnouncementInput = {
      title: str(values.title), body: str(values.body), audience: str(values.audience) as AnnouncementAudience,
      gradeLevelId: num(values.grade_level_id), streamId: num(values.stream_id), publishedAt: str(values.published_at) || null, expiresAt: str(values.expires_at) || null,
    };
    // A teacher may only address their own classes.
    if (viaPortal) {
      if (input.audience !== 'STREAM' || !input.streamId) throw new Error('Pick one of your classes');
      await assertTeacherOnStream(await requireTeacher(user), input.streamId);
    }
    const id = values.id ? Number(values.id) : null;
    const r = id ? (await announcements.updateAnnouncement(id, input, user), { id }) : await announcements.createAnnouncement(input, user);
    revalidatePath('/announcements', 'layout'); revalidatePath('/portal', 'layout'); revalidatePath('/my-classes', 'layout'); revalidatePath('/dashboard');
    return r;
  });
}
export async function deleteAnnouncementRequest(id: number): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => { const user = await requireAction('ANNOUNCEMENTS_MANAGE'); await announcements.deleteAnnouncement(id, user); revalidatePath('/announcements', 'layout'); return { deleted: true }; });
}
