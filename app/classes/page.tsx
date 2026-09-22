import Link from 'next/link';
import { requireAction, currentCanAction } from '@/lib/session';
import { listStreams, listAcademicYears, listGradeLevels } from '@/lib/academics/setup';
import { listActiveTeachers } from '@/lib/academics/teachers';
import { Page } from '@/components/layout/page';
import { Card, EmptyState, Stat, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { SelectFilter } from '@/components/ui/filters';
import { StreamFormButton } from '@/app/admin/academics-forms';

export default async function ClassesPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const user = await requireAction('CLASSES_READ');
  const { year: yearParam } = await searchParams;
  const [years, grades, canManage] = await Promise.all([listAcademicYears(), listGradeLevels(), currentCanAction('CLASSES_MANAGE')]);
  const year = years.find((y) => String(y.id) === yearParam) ?? years.find((y) => y.is_current) ?? years[0];
  const [streams, teachers] = await Promise.all([year ? listStreams(year.id) : Promise.resolve([]), canManage ? listActiveTeachers() : Promise.resolve([])]);
  const students = streams.reduce((s, x) => s + x.students, 0);
  const yearOpts = years.map((y) => ({ id: y.id, name: y.name }));
  return (
    <Page title="Classes" crumb={`${year ? `${year.name} — ` : ''}each grade's streams, their class teachers and rosters`} user={user}>
      <div className="grid g3">
        <Stat label="Classes" value={String(streams.length)} accent={false} />
        <Stat label="Students placed" value={String(students)} />
        <Stat label="Without a class teacher" value={String(streams.filter((s) => !s.class_teacher_id).length)} accent={streams.some((s) => !s.class_teacher_id)} />
      </div>
      <Toolbar>
        <SelectFilter paramName="year" label="Academic year" allLabel={year ? `${year.name}${year.is_current ? ' (current)' : ''}` : 'Year'} options={years.filter((y) => y.id !== year?.id).map((y) => ({ value: String(y.id), label: y.name }))} />
        <Spacer />
        {canManage && year ? <StreamFormButton grades={grades} years={yearOpts} teachers={teachers} defaultYearId={year.id}>Open a class</StreamFormButton> : null}
      </Toolbar>
      <Card>
        {streams.length ? (
          <TableWrap>
            <thead><tr><th>Class</th><th>Level</th><th>Class teacher</th><th className="num">Students</th><th className="num" /></tr></thead>
            <tbody>
              {streams.map((s) => (
                <tr key={s.id}>
                  <td><Link href={`/classes/${s.id}`}><b>{s.grade_level_name} {s.name}</b></Link></td>
                  <td>{s.education_level_name}</td>
                  <td>{s.class_teacher_name ?? <span className="muted-cell">Unassigned</span>}</td>
                  <td className="num">{s.students}</td>
                  <td className="num">
                    <Link href={`/attendance?stream=${s.id}`} className="btn sm ghost">Register</Link>{' '}
                    <Link href={`/timetable?stream=${s.id}`} className="btn sm ghost">Timetable</Link>
                    {canManage ? <> <StreamFormButton stream={s} grades={grades} years={yearOpts} teachers={teachers} className="btn sm ghost">Edit</StreamFormButton></> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🏫" title={year ? `No classes opened for ${year.name}` : 'No academic year yet'} sub={canManage ? 'Open a class for each grade to start placing students.' : undefined} />}
      </Card>
    </Page>
  );
}
