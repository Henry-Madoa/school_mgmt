import Link from 'next/link';
import { requireAction } from '@/lib/session';
import { all } from '@/lib/db';
import { today } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { Card, CardHead, EmptyState, Pill, TableWrap } from '@/components/ui/primitives';
import { loadTeacherContext, isTeacherContext } from './context';
import { NotLinked } from './not-linked';

export default async function MyClassesPage() {
  const user = await requireAction('TEACHER_PORTAL_VIEW');
  const ctx = await loadTeacherContext(user);
  if (!isTeacherContext(ctx)) return <NotLinked user={user} title="My Classes" error={ctx.error} />;
  const taken = new Set((await all<{ stream_id: number }>('SELECT DISTINCT stream_id FROM attendance_record WHERE date = ?', today())).map((r) => r.stream_id));
  const marks = ctx.term ? await all<{ stream_id: number; subject_id: number; entered: number; expected: number }>(
    `SELECT a.stream_id, a.subject_id,
            (SELECT COUNT(*)::int FROM assessment_record ar JOIN student st ON st.id = ar.student_id WHERE st.current_stream_id = a.stream_id AND ar.subject_id = a.subject_id AND ar.term_id = @term) AS entered,
            (SELECT COUNT(*)::int FROM student st WHERE st.current_stream_id = a.stream_id AND st.status = 'ACTIVE') * (SELECT COUNT(*)::int FROM assessment_type) AS expected
     FROM teacher_subject_assignment a JOIN academic_year y ON y.id = a.academic_year_id WHERE a.teacher_id = @teacher AND y.is_current`,
    { teacher: ctx.teacherId, term: ctx.term.id },
  ) : [];
  const progress = (streamId: number, subjectId: number) => marks.find((m) => m.stream_id === streamId && m.subject_id === subjectId);

  return (
    <Page title="My Classes" crumb={`${ctx.year?.name ?? 'No current year'}${ctx.term ? ` · ${ctx.term.name}` : ''} · ${ctx.streams.length} class${ctx.streams.length === 1 ? '' : 'es'}`} user={user}>
      {ctx.streams.length ? ctx.streams.map((s) => (
        <Card key={s.id}>
          <CardHead title={<Link href={`/my-classes/${s.id}`}>{s.grade_level_name} {s.name}</Link>} sub={`${s.students} students${s.isClassTeacher ? ' · you are the class teacher' : ''}`}>
            {s.isClassTeacher ? (taken.has(s.id) ? <Pill tone="ok">Register marked today</Pill> : <Link href={`/my-classes/attendance?stream=${s.id}`} className="btn sm">Mark today&apos;s register</Link>) : null}
            <Link href={`/my-classes/${s.id}`} className="btn sm ghost">Open</Link>
          </CardHead>
          {s.subjects.length ? (
            <TableWrap>
              <thead><tr><th>Subject</th><th>Marks this term</th><th className="num" /></tr></thead>
              <tbody>
                {s.subjects.map((a) => {
                  const p = progress(s.id, a.subject_id);
                  const pct = p?.expected ? Math.round((p.entered / p.expected) * 100) : 0;
                  return (
                    <tr key={a.id}>
                      <td><b>{a.subject_name}</b></td>
                      <td>{p ? <span className={pct >= 100 ? '' : 'muted-cell'}>{p.entered} of {p.expected} ({pct}%)</span> : '—'}</td>
                      <td className="num"><Link href={`/my-classes/assessments?stream=${s.id}&subject=${a.subject_id}`} className="btn sm ghost">Enter marks</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          ) : <div className="tiny">Class teacher only — no subjects assigned to you in this class.</div>}
        </Card>
      )) : <Card><EmptyState icon="🏫" title="No classes assigned to you this year" sub="The academics office assigns subjects and class teachers under Teaching Staff." /></Card>}
    </Page>
  );
}
