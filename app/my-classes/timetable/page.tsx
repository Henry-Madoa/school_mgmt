import { requireAction } from '@/lib/session';
import { listTeacherTimetable } from '@/lib/academics/timetable';
import { Page } from '@/components/layout/page';
import { Card, CardHead, EmptyState } from '@/components/ui/primitives';
import { TimetableGrid } from '@/components/school/timetable-grid';
import { loadTeacherContext, isTeacherContext } from '../context';
import { NotLinked } from '../not-linked';

export default async function MyTimetablePage() {
  const user = await requireAction('TEACHER_PORTAL_VIEW');
  const ctx = await loadTeacherContext(user);
  if (!isTeacherContext(ctx)) return <NotLinked user={user} title="My Timetable" error={ctx.error} />;
  const slots = ctx.term ? await listTeacherTimetable(ctx.teacherId, ctx.term.id) : [];
  return (
    <Page title="My Timetable" crumb={ctx.term ? `${ctx.term.name} ${ctx.term.year_name} · ${slots.length} lessons a week` : 'No current term'} user={user}>
      <Card>
        <CardHead title="The week" sub="Where you are, period by period" />
        {slots.length ? <TimetableGrid slots={slots} focus="teacher" /> : <EmptyState icon="🗓" title="Nothing timetabled for you this term" />}
      </Card>
    </Page>
  );
}
