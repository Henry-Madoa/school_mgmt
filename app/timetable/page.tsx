import Link from 'next/link';
import { requireAction, currentCanAction } from '@/lib/session';
import { listStreams, listTerms, resolveTerm, getCurrentAcademicYear, listSubjectsForGrade } from '@/lib/academics/setup';
import { listActiveTeachers, listStreamAssignments } from '@/lib/academics/teachers';
import { listStreamTimetable, listTeacherTimetable } from '@/lib/academics/timetable';
import { Page } from '@/components/layout/page';
import { Card, CardHead, EmptyState, Toolbar, Spacer } from '@/components/ui/primitives';
import { SelectFilter } from '@/components/ui/filters';
import { TimetableGrid } from '@/components/school/timetable-grid';
import { SlotFormButton, DeleteSlotButton, CopyTimetableButton } from './timetable-editor';

export default async function TimetablePage({ searchParams }: { searchParams: Promise<{ stream?: string; teacher?: string; term?: string }> }) {
  const user = await requireAction('TIMETABLE_READ');
  const sp = await searchParams;
  const [year, terms, term, teachers, canManage] = await Promise.all([getCurrentAcademicYear(), listTerms(), resolveTerm(sp.term ? Number(sp.term) : null), listActiveTeachers(), currentCanAction('TIMETABLE_MANAGE')]);
  const streams = await listStreams(year?.id ?? null);
  const stream = streams.find((s) => String(s.id) === sp.stream);
  const teacher = !stream ? teachers.find((t) => String(t.employee_id) === sp.teacher) : undefined;
  const yearTerms = terms.filter((t) => t.academic_year_id === (year?.id ?? term?.academic_year_id));
  const [slots, subjects, assignments] = stream && term
    ? await Promise.all([listStreamTimetable(stream.id, term.id), listSubjectsForGrade(stream.grade_level_id), listStreamAssignments(stream.id)])
    : teacher && term ? [await listTeacherTimetable(teacher.employee_id, term.id), [], []] : [[], [], []];
  const editable = !!(stream && term && canManage);
  const teacherPicks = teachers.map((t) => ({ id: t.employee_id, employee_no: t.employee_no, first_name: t.first_name, last_name: t.last_name }));
  const formProps = stream && term ? { streamId: stream.id, termId: term.id, subjects, assignments, teachers: teacherPicks } : null;

  return (
    <Page title="Timetable" crumb="The week's lessons for each class — or where one teacher is, period by period" user={user}>
      <Toolbar>
        <SelectFilter paramName="stream" label="Class" allLabel="Class…" options={streams.map((s) => ({ value: String(s.id), label: `${s.grade_level_name} ${s.name}` }))} />
        <SelectFilter paramName="teacher" label="Teacher" allLabel="…or a teacher" options={teachers.map((t) => ({ value: String(t.employee_id), label: `${t.first_name} ${t.last_name}` }))} />
        <SelectFilter paramName="term" label="Term" allLabel={term ? `${term.name} ${term.year_name} (current)` : 'Term'} options={yearTerms.filter((t) => t.id !== term?.id).map((t) => ({ value: String(t.id), label: `${t.name} ${t.year_name}` }))} />
        <Spacer />
        {editable && !slots.length && yearTerms.length > 1 ? <CopyTimetableButton streamId={stream!.id} toTermId={term!.id} terms={yearTerms} /> : null}
        {formProps && canManage ? <SlotFormButton {...formProps} className="btn">Add a lesson</SlotFormButton> : null}
        {stream ? <Link href={`/classes/${stream.id}`} className="btn ghost sm">Class card</Link> : null}
        {teacher ? <Link href={`/teachers/${teacher.employee_id}`} className="btn ghost sm">Teacher card</Link> : null}
      </Toolbar>
      <Card>
        {stream && term ? (
          <>
            <CardHead title={`${stream.grade_level_name} ${stream.name} — ${term.name} ${term.year_name}`} sub={canManage ? 'Add lessons into empty periods; a teacher already booked elsewhere at that time is refused' : `${slots.length} lessons a week`} />
            {slots.length || editable ? (
              <TimetableGrid slots={slots} focus="stream"
                cell={editable && formProps ? (s) => (
                  <span className="inline" style={{ gap: 2, marginTop: 2 }}>
                    <SlotFormButton {...formProps} slot={s}>Edit</SlotFormButton>
                    <DeleteSlotButton id={s.id} />
                  </span>
                ) : undefined}
                emptyCell={editable && formProps ? (day, start, end) => <SlotFormButton {...formProps} preset={{ day, start, end }} className="btn sm ghost" >+</SlotFormButton> : undefined} />
            ) : <EmptyState icon="🗓" title="Nothing timetabled" />}
            {editable && !slots.length ? <div className="note" style={{ marginTop: 8 }}>Start with &ldquo;Add a lesson&rdquo; — once the first period exists, every empty period in the grid gets a + to fill.</div> : null}
          </>
        ) : teacher && term ? (
          <>
            <CardHead title={`${teacher.first_name} ${teacher.last_name} — ${term.name} ${term.year_name}`} sub={`${slots.length} lessons a week`} />
            {slots.length ? <TimetableGrid slots={slots} focus="teacher" /> : <EmptyState icon="🗓" title="Nothing timetabled for this teacher" />}
          </>
        ) : <EmptyState icon="🗓" title="Pick a class or a teacher" />}
      </Card>
    </Page>
  );
}
