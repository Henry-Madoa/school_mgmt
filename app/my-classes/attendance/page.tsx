import Link from 'next/link';
import { requireAction, currentCanAction } from '@/lib/session';
import { listRegister, listRegisterDays } from '@/lib/academics/attendance';
import { listStreamRoster } from '@/lib/students';
import { formatDate, today } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { Card, CardHead, EmptyState, Toolbar, Spacer } from '@/components/ui/primitives';
import { SelectFilter, DateFilterInput } from '@/components/ui/filters';
import { RegisterEditor } from '@/components/school/register-editor';
import { loadTeacherContext, isTeacherContext } from '../context';
import { NotLinked } from '../not-linked';

export default async function MyRegisterPage({ searchParams }: { searchParams: Promise<{ stream?: string; date?: string }> }) {
  const user = await requireAction('TEACHER_PORTAL_VIEW');
  const ctx = await loadTeacherContext(user);
  if (!isTeacherContext(ctx)) return <NotLinked user={user} title="Mark Register" error={ctx.error} />;
  const sp = await searchParams;
  const canMark = await currentCanAction('TEACHER_PORTAL_ATTENDANCE');
  // Class teachers first — the register is theirs; a subject teacher may still take it for a lesson.
  const streams = [...ctx.streams].sort((a, b) => Number(b.isClassTeacher) - Number(a.isClassTeacher));
  const stream = streams.find((s) => String(s.id) === sp.stream) ?? (streams.length === 1 ? streams[0] : undefined);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') ? sp.date! : today();
  const from = ctx.term?.start_date ?? `${date.slice(0, 4)}-01-01`;
  const [roster, existing, days] = stream ? await Promise.all([listStreamRoster(stream.id), listRegister(stream.id, date), listRegisterDays(stream.id, from, today())]) : [[], [], []];

  return (
    <Page title="Mark Register" crumb="Everyone starts Present — change the exceptions and save" user={user}>
      <Toolbar>
        <SelectFilter paramName="stream" label="Class" allLabel={stream ? `${stream.grade_level_name} ${stream.name}` : 'Pick a class…'} options={streams.filter((s) => s.id !== stream?.id).map((s) => ({ value: String(s.id), label: `${s.grade_level_name} ${s.name}${s.isClassTeacher ? ' (class teacher)' : ''}` }))} />
        <DateFilterInput paramName="date" label="Date" />
        <Spacer />
      </Toolbar>
      <Card>
        {stream ? (
          <>
            <CardHead title={`${stream.grade_level_name} ${stream.name} — ${formatDate(date)}`} sub={existing.length ? `Already marked by ${existing[0].recorded_by ?? '—'} — change any student and save again` : 'Not yet marked'} />
            {roster.length
              ? <RegisterEditor key={`${stream.id}-${date}`} streamId={stream.id} date={date} roster={roster} existing={existing} viaPortal readOnly={!canMark} />
              : <EmptyState icon="🎒" title="No students in this class" />}
          </>
        ) : <EmptyState icon="✅" title={streams.length ? 'Pick a class' : 'No classes assigned to you'} />}
      </Card>
      {stream && days.length ? (
        <Card>
          <CardHead title="Registers this term" />
          <div className="inline" style={{ gap: 6 }}>
            {days.map((d) => <Link key={d.date} href={`/my-classes/attendance?stream=${stream.id}&date=${d.date}`} className={`btn sm ${d.date === date ? '' : 'ghost'}`}>{formatDate(d.date)}{d.absent ? <span className="tiny" style={{ marginLeft: 4 }}>({d.absent} abs)</span> : null}</Link>)}
          </div>
        </Card>
      ) : null}
    </Page>
  );
}
