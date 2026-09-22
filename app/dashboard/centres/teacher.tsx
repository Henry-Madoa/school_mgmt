import Link from 'next/link';
import { getOrgBrand } from '@/lib/org';
import { getTeacherRoleCenter } from '@/lib/roleCenters';
import { getPortalLinks } from '@/lib/portal';
import { formatDate, today } from '@/lib/format';
import { visibleAnnouncements } from '@/lib/announcements';
import { Page } from '@/components/layout/page';
import { Card, CardHead, EmptyState, Pill, TableWrap } from '@/components/ui/primitives';
import { KpiTile } from './shared';
import type { SessionUser } from '@/lib/types';

/** The Teacher Portal's landing page — today's lessons, my classes, registers and marks. */
export async function TeacherRoleCentre({ user }: { user: SessionUser }) {
  const org = await getOrgBrand();
  const links = await getPortalLinks(user.id);
  if (!links.employee_id) {
    return (
      <Page title="Teacher Portal" crumb={org!.name} user={user}>
        <Card>
          <EmptyState icon="🧑‍🏫" title="Your login is not matched to a member of staff"
            sub="Ask an administrator to set your Employee No. under Admin Centre → System Security → User Setup, and the academics office to add you under Teaching Staff." />
        </Card>
      </Page>
    );
  }
  const [d, notices] = await Promise.all([
    getTeacherRoleCenter(links.employee_id),
    visibleAnnouncements({ audiences: ['STAFF', 'TEACHERS'] }, 5),
  ]);
  const totalStudents = new Set(d.classes.map((c) => c.stream_id)).size ? d.classTeacherOf.reduce((a, c) => a + c.students, 0) : 0;
  const marksPct = d.classes.reduce((a, c) => a + c.marksExpected, 0)
    ? Math.round((d.classes.reduce((a, c) => a + c.marksEntered, 0) / d.classes.reduce((a, c) => a + c.marksExpected, 0)) * 100) : 0;

  return (
    <Page title="Teacher Portal" crumb={`${org!.name} · ${formatDate(today())}${d.term ? ` · ${d.term.name} ${d.term.year}` : ''}`} user={user}>
      <div className="grid g4 stack-2">
        <KpiTile label="Lessons today" value={d.today.length} foot={<Link href="/my-classes/timetable">My timetable</Link>} accent={false} />
        <KpiTile label="Classes I teach" value={d.classes.length} foot={<Link href="/my-classes">My classes</Link>} />
        <KpiTile label="Class teacher of" value={d.classTeacherOf.length} foot={totalStudents ? `${totalStudents} students` : 'No class assigned'} accent={false} />
        <KpiTile label="Marks entered this term" value={`${marksPct}%`} foot={<Link href="/my-classes/assessments">Enter marks</Link>} accent={marksPct < 100} />
      </div>

      <div className="grid split-wide">
        <Card>
          <CardHead title="Today's lessons" sub={d.today.length ? 'From the class timetables' : 'Nothing timetabled for today'} />
          {d.today.length ? (
            <TableWrap>
              <thead><tr><th>Time</th><th>Subject</th><th>Class</th><th>Room</th></tr></thead>
              <tbody>
                {d.today.map((s, i) => (
                  <tr key={i}><td className="mono">{s.start_time}–{s.end_time}</td><td>{s.subject}</td><td>{s.stream}</td><td>{s.room ?? '—'}</td></tr>
                ))}
              </tbody>
            </TableWrap>
          ) : <EmptyState icon="🗓" title="Free day" />}
        </Card>
        <Card>
          <CardHead title="My registers" sub="Classes I am class teacher of — mark the register daily">
            <Link href="/my-classes/attendance" className="btn sm">Mark register</Link>
          </CardHead>
          {d.classTeacherOf.length ? (
            <TableWrap>
              <thead><tr><th>Class</th><th className="num">Students</th><th>Today</th></tr></thead>
              <tbody>
                {d.classTeacherOf.map((c) => (
                  <tr key={c.stream_id}>
                    <td>{c.name}</td><td className="num">{c.students}</td>
                    <td>{c.registerTakenToday ? <Pill tone="ok">Marked</Pill> : <Link href={`/my-classes/attendance?stream=${c.stream_id}`}><Pill tone="warn">Not yet</Pill></Link>}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          ) : <EmptyState icon="📋" title="Not a class teacher this year" />}
          {d.attendanceThisWeek ? <div className="tiny muted-cell" style={{ marginTop: 8 }}>This week: {d.attendanceThisWeek.rate}% present across my classes ({d.attendanceThisWeek.absent} absences)</div> : null}
        </Card>
      </div>

      <div className="grid split-narrow">
        <Card>
          <CardHead title="My classes" sub="What I teach, and how far this term's marks are in">
            <Link href="/my-classes" className="btn sm ghost">All classes</Link>
          </CardHead>
          {d.classes.length ? (
            <TableWrap>
              <thead><tr><th>Class</th><th>Subject</th><th className="num">Students</th><th style={{ width: 130 }}>Marks</th></tr></thead>
              <tbody>
                {d.classes.map((c) => {
                  const pct = c.marksExpected ? Math.min(100, Math.round((c.marksEntered / c.marksExpected) * 100)) : 0;
                  return (
                    <tr key={`${c.stream_id}-${c.subject_id}`}>
                      <td><Link href={`/my-classes/${c.stream_id}`}>{c.name}</Link></td><td>{c.subject}</td><td className="num">{c.students}</td>
                      <td><div className="bar-track"><div className="bar-fill" style={{ width: `${pct}%`, background: pct >= 100 ? 'var(--ok)' : 'var(--series-1)' }} /></div><span className="tiny muted-cell">{pct}%</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          ) : <EmptyState icon="🏫" title="No classes assigned yet" sub="The academics office assigns subjects and classes under Teaching Staff." />}
        </Card>
        <Card>
          <CardHead title="Staff notices">
            <Link href="/announcements" className="btn sm ghost">All announcements</Link>
          </CardHead>
          {notices.length ? notices.map((n) => (
            <div key={n.id} style={{ marginBottom: 10 }}>
              <b>{n.title}</b> <span className="tiny muted-cell">{formatDate(n.published_at.slice(0, 10))}</span>
              <div className="tiny">{n.body.length > 160 ? `${n.body.slice(0, 160)}…` : n.body}</div>
            </div>
          )) : <EmptyState icon="📣" title="No notices" />}
        </Card>
      </div>
    </Page>
  );
}
