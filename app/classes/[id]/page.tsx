import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import { getStream, listAcademicYears, listGradeLevels, listSubjectsForGrade, getCurrentTerm } from '@/lib/academics/setup';
import { listActiveTeachers, listStreamAssignments } from '@/lib/academics/teachers';
import { listStreamTimetable } from '@/lib/academics/timetable';
import { streamAttendanceSummary } from '@/lib/academics/attendance';
import { classStandings } from '@/lib/academics/assessments';
import { listStreamRoster } from '@/lib/students';
import { formatDate, today } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { Card, CardHead, EmptyState, Stat, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { Money } from '@/components/ui/money';
import { TimetableGrid } from '@/components/school/timetable-grid';
import { StreamFormButton } from '@/app/admin/academics-forms';
import { AssignTeacherButton, UnassignButton } from '@/app/teachers/teacher-forms';
import { SendReminderButton } from '@/app/fees/fee-actions';
import { PublishClassButton } from '@/app/report-cards/report-card-actions';

export default async function ClassPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAction('CLASSES_READ');
  const { id: idParam } = await params;
  const id = Number(idParam);
  const stream = await getStream(id);
  if (!stream) notFound();
  const [term, canManage, canTeachers, canRemind, canPublish] = await Promise.all([
    getCurrentTerm(), currentCanAction('CLASSES_MANAGE'), currentCanAction('TEACHERS_MANAGE'), currentCanAction('FEES_REMIND'), currentCanAction('REPORT_CARDS_PUBLISH'),
  ]);
  const from = term?.start_date ?? `${new Date().getFullYear()}-01-01`;
  const to = term ? (term.end_date < today() ? term.end_date : today()) : today();
  const [roster, assignments, slots, attendance, standings, grades, years, teachers, subjects] = await Promise.all([
    listStreamRoster(id), listStreamAssignments(id), term ? listStreamTimetable(id, term.id) : Promise.resolve([]),
    streamAttendanceSummary(id, from, to), term ? classStandings(id, term.id) : Promise.resolve([]),
    listGradeLevels(), listAcademicYears(), canManage || canTeachers ? listActiveTeachers() : Promise.resolve([]), listSubjectsForGrade(stream.grade_level_id),
  ]);
  const owing = roster.filter((s) => s.fee_balance > 0);
  const rank = new Map(standings.map((s, i) => [s.student_id, { pos: i + 1, avg: s.average }]));
  const title = `${stream.grade_level_name} ${stream.name}`;

  return (
    <Page title={title} crumb={`${stream.year_name} · ${stream.education_level_name} · class teacher ${stream.class_teacher_name ?? 'unassigned'}`} user={user}>
      <Toolbar>
        <Link href="/classes" className="btn ghost sm">← All classes</Link>
        <Spacer />
        <Link href={`/attendance?stream=${id}`} className="btn ghost">Mark register</Link>
        <Link href={`/assessments?stream=${id}`} className="btn ghost">Enter marks</Link>
        <Link href={`/timetable?stream=${id}`} className="btn ghost">Timetable</Link>
        {canRemind && owing.length ? <SendReminderButton streamId={id} label={`Remind ${owing.length} on fees`} className="btn ghost" /> : null}
        {canPublish && term && standings.length ? <PublishClassButton streamId={id} termId={term.id} className="btn ghost" /> : null}
        {canManage ? <StreamFormButton stream={stream} grades={grades} years={years.map((y) => ({ id: y.id, name: y.name }))} teachers={teachers} className="btn">Edit class</StreamFormButton> : null}
      </Toolbar>

      <div className="grid g4">
        <Stat label="Students" value={String(roster.length)} accent={false} foot={`${roster.filter((s) => s.gender === 'MALE').length} boys · ${roster.filter((s) => s.gender === 'FEMALE').length} girls`} />
        <Stat label="Attendance this term" value={`${attendance.rate}%`} foot={`${attendance.absent} absences over ${attendance.total ? Math.round(attendance.total / Math.max(roster.length, 1)) : 0} days`} />
        <Stat label="Class average" value={standings.length ? (standings.reduce((s, x) => s + x.average, 0) / standings.length).toFixed(1) : '—'} accent={false} foot={term ? `${term.name} · ${standings.length} with marks` : undefined} />
        <Stat label="Fees owing" value={<Money cents={owing.reduce((s, x) => s + Number(x.fee_balance), 0)} />} accent={owing.length > 0} foot={`${owing.length} student${owing.length === 1 ? '' : 's'}`} />
      </div>

      <Card>
        <CardHead title="Roster" sub="Active students placed in this class" />
        {roster.length ? (
          <TableWrap>
            <thead><tr><th>Adm. No.</th><th>Student</th><th>Gender</th><th>Guardian</th><th>Admitted</th><th className="num">Term average</th><th className="num">Position</th><th className="num">Fee balance</th></tr></thead>
            <tbody>
              {roster.map((s) => {
                const r = rank.get(s.id);
                return (
                  <tr key={s.id}>
                    <td className="mono"><Link href={`/students/view/${s.id}`}>{s.admission_no}</Link></td>
                    <td><b>{s.first_name} {s.last_name}</b></td>
                    <td>{s.gender ? s.gender[0] : '—'}</td>
                    <td>{s.primary_guardian_name ?? '—'}<div className="tiny">{s.primary_guardian_phone}</div></td>
                    <td>{formatDate(s.admission_date)}</td>
                    <td className="num">{r ? r.avg.toFixed(1) : '—'}</td>
                    <td className="num">{r ? `${r.pos} / ${standings.length}` : '—'}</td>
                    <td className="num"><Money cents={s.fee_balance} /></td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🎒" title="No students placed yet" sub="Admit students into this class, or move them here from their student card." />}
      </Card>

      <Card>
        <CardHead title="Subject teachers" sub="Who teaches what to this class this year">
          {canTeachers ? <AssignTeacherButton streamId={id} teachers={teachers} streams={[stream]} subjects={subjects} className="btn sm">Assign a subject</AssignTeacherButton> : null}
        </CardHead>
        {assignments.length ? (
          <TableWrap>
            <thead><tr><th>Subject</th><th>Teacher</th><th className="num" /></tr></thead>
            <tbody>
              {assignments.map((a) => (
                <tr key={a.id}>
                  <td><b>{a.subject_name}</b> <span className="tiny mono">{a.subject_code}</span></td>
                  <td><Link href={`/teachers/${a.teacher_id}`}>{a.teacher_name}</Link> <span className="tiny mono">{a.employee_no}</span></td>
                  <td className="num">{canTeachers ? <UnassignButton id={a.id} /> : null}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🧑‍🏫" title="No subject teachers assigned" sub={subjects.length ? undefined : 'No subjects are offered in this grade yet — set them up under Administration › Academics › Subjects.'} />}
      </Card>

      <CollapsibleCard title={`Timetable — ${term ? `${term.name} ${term.year_name}` : 'no current term'}`} sub="The week as the class sees it" defaultCollapsed={!slots.length}>
        {slots.length ? <TimetableGrid slots={slots} focus="stream" /> : <EmptyState icon="🗓" title="Nothing timetabled this term" sub={<Link href={`/timetable?stream=${id}`}>Build the timetable</Link>} />}
      </CollapsibleCard>
    </Page>
  );
}
