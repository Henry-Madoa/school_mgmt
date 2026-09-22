import Link from 'next/link';
import { requireAction, currentCanAction } from '@/lib/session';
import { listStreams, getCurrentAcademicYear, getCurrentTerm } from '@/lib/academics/setup';
import { listRegister, listRegisterDays, streamAttendanceSummary } from '@/lib/academics/attendance';
import { listStreamRoster } from '@/lib/students';
import { formatDate, today } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { Card, CardHead, EmptyState, Stat, Toolbar, Spacer } from '@/components/ui/primitives';
import { SelectFilter, DateFilterInput } from '@/components/ui/filters';
import { RegisterEditor } from '@/components/school/register-editor';

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ stream?: string; date?: string }> }) {
  const user = await requireAction('ATTENDANCE_READ');
  const sp = await searchParams;
  const [year, term, canMark] = await Promise.all([getCurrentAcademicYear(), getCurrentTerm(), currentCanAction('ATTENDANCE_MARK')]);
  const streams = await listStreams(year?.id ?? null);
  const stream = streams.find((s) => String(s.id) === sp.stream);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') ? sp.date! : today();
  const from = term?.start_date ?? `${date.slice(0, 4)}-01-01`;
  const to = term ? (term.end_date < today() ? term.end_date : today()) : today();
  const [roster, existing, days, summary] = stream ? await Promise.all([
    listStreamRoster(stream.id), listRegister(stream.id, date), listRegisterDays(stream.id, from, to), streamAttendanceSummary(stream.id, from, to),
  ]) : [[], [], [], null];

  return (
    <Page title="Attendance" crumb="The daily register, class by class" user={user}>
      <Toolbar>
        <SelectFilter paramName="stream" label="Class" allLabel="Pick a class…" options={streams.map((s) => ({ value: String(s.id), label: `${s.grade_level_name} ${s.name}` }))} />
        <DateFilterInput paramName="date" label="Date" />
        <Spacer />
        {stream ? <Link href={`/classes/${stream.id}`} className="btn ghost sm">Class card</Link> : null}
      </Toolbar>
      {stream && summary ? (
        <div className="grid g4">
          <Stat label="Students" value={String(roster.length)} accent={false} />
          <Stat label={`Attendance — ${term?.name ?? 'this year'}`} value={`${summary.rate}%`} />
          <Stat label="Days marked" value={String(days.length)} accent={false} foot={days[0] ? `Last: ${formatDate(days[0].date)}` : undefined} />
          <Stat label={`Absences on ${formatDate(date)}`} value={String(existing.filter((r) => r.status === 'ABSENT').length)} accent={existing.some((r) => r.status === 'ABSENT')} foot={existing.length ? `${existing.length} marked` : 'Not yet marked'} />
        </div>
      ) : null}
      <Card>
        {stream ? (
          <>
            <CardHead title={`${stream.grade_level_name} ${stream.name} — ${formatDate(date)}`} sub={existing.length ? `Marked by ${existing[0].recorded_by ?? '—'} · change any student and save again` : 'Not yet marked — everyone starts Present; change the exceptions and save'} />
            {roster.length
              ? <RegisterEditor key={`${stream.id}-${date}`} streamId={stream.id} date={date} roster={roster} existing={existing} readOnly={!canMark} />
              : <EmptyState icon="🎒" title="No students in this class" />}
          </>
        ) : <EmptyState icon="✅" title="Pick a class" sub="Choose a class and a date to mark or review its register." />}
      </Card>
      {stream && days.length ? (
        <Card>
          <CardHead title="Registers this term" sub="Open a day to review or correct it" />
          <div className="inline" style={{ gap: 6 }}>
            {days.map((d) => (
              <Link key={d.date} href={`/attendance?stream=${stream.id}&date=${d.date}`} className={`btn sm ${d.date === date ? '' : 'ghost'}`} title={`${d.marked} marked, ${d.absent} absent`}>
                {formatDate(d.date)}{d.absent ? <span className="tiny" style={{ marginLeft: 4 }}>({d.absent} abs)</span> : null}
              </Link>
            ))}
          </div>
        </Card>
      ) : null}
    </Page>
  );
}
