import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import { listStreamTimetable } from '@/lib/academics/timetable';
import { streamAttendanceSummary } from '@/lib/academics/attendance';
import { classStandings } from '@/lib/academics/assessments';
import { listStreamAssignments } from '@/lib/academics/teachers';
import { listStreamRoster } from '@/lib/students';
import { visibleAnnouncements } from '@/lib/announcements';
import { today } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { Card, CardHead, EmptyState, Stat, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { TimetableGrid } from '@/components/school/timetable-grid';
import { AnnouncementList } from '@/components/school/announcement-list';
import { AnnouncementFormButton } from '@/app/announcements/announcement-form';
import { loadTeacherContext, isTeacherContext } from '../context';
import { NotLinked } from '../not-linked';

export default async function MyClassPage({ params }: { params: Promise<{ streamId: string }> }) {
  const user = await requireAction('TEACHER_PORTAL_VIEW');
  const ctx = await loadTeacherContext(user);
  if (!isTeacherContext(ctx)) return <NotLinked user={user} title="My Class" error={ctx.error} />;
  const { streamId } = await params;
  const stream = ctx.streams.find((s) => String(s.id) === streamId);
  if (!stream) notFound();
  const term = ctx.term;
  const from = term?.start_date ?? `${new Date().getFullYear()}-01-01`;
  const [roster, teachers, slots, attendance, standings, notices, canAnnounce] = await Promise.all([
    listStreamRoster(stream.id), listStreamAssignments(stream.id), term ? listStreamTimetable(stream.id, term.id) : Promise.resolve([]),
    streamAttendanceSummary(stream.id, from, today()), term ? classStandings(stream.id, term.id) : Promise.resolve([]),
    visibleAnnouncements({ audiences: [], streamIds: [stream.id], gradeLevelIds: [stream.grade_level_id] }, 10), currentCanAction('TEACHER_PORTAL_ANNOUNCE'),
  ]);
  const rank = new Map(standings.map((s, i) => [s.student_id, { pos: i + 1, avg: s.average }]));

  return (
    <Page title={`${stream.grade_level_name} ${stream.name}`} crumb={`${stream.students} students${stream.isClassTeacher ? ' · you are the class teacher' : ''} · ${stream.subjects.map((a) => a.subject_name).join(', ') || 'no subjects'}`} user={user}>
      <Toolbar>
        <Link href="/my-classes" className="btn ghost sm">← My classes</Link>
        <Spacer />
        <Link href={`/my-classes/attendance?stream=${stream.id}`} className="btn ghost">Mark register</Link>
        {stream.subjects.length ? <Link href={`/my-classes/assessments?stream=${stream.id}`} className="btn ghost">Enter marks</Link> : null}
        {canAnnounce ? <AnnouncementFormButton grades={[]} streams={[stream]} viaPortal>Notice to the class</AnnouncementFormButton> : null}
      </Toolbar>
      <div className="grid g3">
        <Stat label="Students" value={String(roster.length)} accent={false} />
        <Stat label="Attendance this term" value={`${attendance.rate}%`} foot={`${attendance.absent} absences`} />
        <Stat label="Class average" value={standings.length ? (standings.reduce((s, x) => s + x.average, 0) / standings.length).toFixed(1) : '—'} accent={false} foot={`${standings.length} with marks`} />
      </div>
      <Card>
        <CardHead title="Roster" sub="Active students in the class, with this term's standing" />
        {roster.length ? (
          <TableWrap>
            <thead><tr><th>Adm. No.</th><th>Student</th><th>Guardian</th><th className="num">Average</th><th className="num">Position</th></tr></thead>
            <tbody>
              {roster.map((s) => {
                const r = rank.get(s.id);
                return (
                  <tr key={s.id}>
                    <td className="mono">{s.admission_no}</td>
                    <td><b>{s.first_name} {s.last_name}</b></td>
                    <td>{s.primary_guardian_name ?? '—'}<div className="tiny">{s.primary_guardian_phone}</div></td>
                    <td className="num">{r ? r.avg.toFixed(1) : '—'}</td>
                    <td className="num">{r ? `${r.pos} / ${standings.length}` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🎒" title="No students placed yet" />}
      </Card>
      <div className="grid g2">
        <Card>
          <CardHead title="Subject teachers" />
          {teachers.length ? (
            <TableWrap>
              <thead><tr><th>Subject</th><th>Teacher</th></tr></thead>
              <tbody>{teachers.map((a) => <tr key={a.id}><td><b>{a.subject_name}</b></td><td>{a.teacher_id === ctx.teacherId ? <b>You</b> : a.teacher_name}</td></tr>)}</tbody>
            </TableWrap>
          ) : <EmptyState icon="🧑‍🏫" title="No subject teachers assigned" />}
        </Card>
        <Card>
          <CardHead title="Notices to this class" />
          <AnnouncementList rows={notices} empty="No notices for this class" />
        </Card>
      </div>
      <CollapsibleCard title={`Class timetable${term ? ` — ${term.name}` : ''}`} defaultCollapsed={!slots.length}>
        {slots.length ? <TimetableGrid slots={slots} focus="stream" /> : <EmptyState icon="🗓" title="Nothing timetabled this term" />}
      </CollapsibleCard>
    </Page>
  );
}
