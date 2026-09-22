import Link from 'next/link';
import { currentCanAction } from '@/lib/session';
import { getOrgBrand } from '@/lib/org';
import { getSchoolAdminRoleCenter } from '@/lib/roleCenters';
import { formatDate, today } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { Card, CardHead, EmptyState, Pill, TableWrap } from '@/components/ui/primitives';
import { KpiTile, LockedCard } from './shared';
import { MonthTrend, MagnitudeBars } from '../role-center-charts';
import { AttendanceTodayChart } from '../charts';
import type { SessionUser } from '@/lib/types';

/** The School Administration Role Centre — admissions, classes, registers and marks in progress. */
export async function SchoolAdminRoleCentre({ user }: { user: SessionUser }) {
  const canStudents = await currentCanAction('STUDENTS_READ');
  const [org, d] = await Promise.all([getOrgBrand(), getSchoolAdminRoleCenter()]);

  if (!canStudents) {
    return (
      <Page title="School Administration" crumb={org!.name} user={user}>
        <LockedCard title="Students" />
      </Page>
    );
  }
  const trendMonths = d.attendanceTrend.map((t) => t.date);

  return (
    <Page title="School Administration" crumb={`${org!.name} · as at ${formatDate(today())}`} user={user}>
      <div className="grid g4 stack-2">
        <KpiTile label="Students on the roll" value={d.kpi.students.toLocaleString()}
          foot={<><Link href="/students">All students</Link> · {d.kpi.boys} boys, {d.kpi.girls} girls</>} />
        <KpiTile label="Classes this year" value={d.kpi.classes}
          foot={<><Link href="/classes">Classes</Link> · {d.kpi.teachers} teaching staff</>} accent={false} />
        <KpiTile label="Current term" value={d.term ? `${d.term.name} ${d.term.year}` : '—'}
          foot={d.term ? `${d.term.daysLeft} days to ${formatDate(d.term.end_date)}` : <Link href="/admin/pool/academics/academic-years">Set up the year</Link>} accent={false} />
        <KpiTile label="Attendance today" value={d.attendanceToday ? `${d.attendanceToday.rate}%` : '—'}
          foot={d.attendanceToday ? `${d.attendanceToday.absent} absent · ${d.attendanceToday.late} late` : 'No register taken yet'}
          accent={!!d.attendanceToday && d.attendanceToday.rate < 90} />
      </div>

      <div className="grid split-wide">
        <Card>
          <CardHead title="Attendance rate, last 30 days" sub="Share of students marked present or late, across every register" />
          {d.attendanceTrend.length
            ? <MonthTrend months={trendMonths} series={[{ name: 'Present %', values: d.attendanceTrend.map((t) => t.rate) }]} money={false} area height={220} />
            : <EmptyState icon="🗓" title="No registers yet" />}
        </Card>
        <Card>
          <CardHead title="Today's registers" sub={d.classesWithoutRegister.length ? `${d.classesWithoutRegister.length} class(es) not yet marked` : 'Every class marked'}>
            <Link href="/attendance" className="btn sm ghost">Attendance</Link>
          </CardHead>
          {d.attendanceToday ? <AttendanceTodayChart summary={d.attendanceToday} /> : null}
          {d.classesWithoutRegister.length ? (
            <TableWrap>
              <thead><tr><th>Class</th><th className="num">Students</th><th /></tr></thead>
              <tbody>
                {d.classesWithoutRegister.slice(0, 8).map((c) => (
                  <tr key={c.stream_id}><td>{c.name}</td><td className="num">{c.students}</td><td className="num"><Link href={`/attendance?stream=${c.stream_id}`} className="btn sm ghost">Mark</Link></td></tr>
                ))}
              </tbody>
            </TableWrap>
          ) : null}
        </Card>
      </div>

      <div className="grid split-narrow">
        <Card>
          <CardHead title="Enrolment by grade" sub={d.kpi.unplaced ? <><Pill tone="warn">{d.kpi.unplaced} active student(s) not placed in a class</Pill></> : 'Every active student is in a class'} />
          {d.enrolmentByGrade.some((g) => g.students) ? <MagnitudeBars money={false} rows={d.enrolmentByGrade.map((g) => ({ label: g.grade, value: g.students }))} /> : <EmptyState icon="🎒" title="No students yet" />}
        </Card>
        <Card>
          <CardHead title="Marks entered this term" sub="Per subject — entered against every student × assessment type expected">
            <Link href="/assessments" className="btn sm ghost">Assessments</Link>
          </CardHead>
          {d.marksProgress.length ? (
            <TableWrap>
              <thead><tr><th>Subject</th><th className="num">Entered</th><th className="num">Expected</th><th style={{ width: 120 }}>Progress</th></tr></thead>
              <tbody>
                {d.marksProgress.map((m) => {
                  const pct = Math.min(100, Math.round((m.entered / m.expected) * 100));
                  return (
                    <tr key={m.subject}>
                      <td>{m.subject}</td><td className="num">{m.entered}</td><td className="num">{m.expected}</td>
                      <td><div className="bar-track"><div className="bar-fill" style={{ width: `${pct}%`, background: pct >= 100 ? 'var(--ok)' : 'var(--series-1)' }} /></div></td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          ) : <EmptyState icon="📝" title="No term in progress" />}
        </Card>
      </div>

      <Card>
        <CardHead title="Admissions by month" sub="New students admitted in the last twelve months">
          <Link href="/students/new" className="btn sm">Admit a student</Link>
        </CardHead>
        <MonthTrend months={d.admissionsByMonth.map((m) => m.month)} series={[{ name: 'Admitted', values: d.admissionsByMonth.map((m) => m.admitted) }]} money={false} height={180} />
      </Card>
    </Page>
  );
}
