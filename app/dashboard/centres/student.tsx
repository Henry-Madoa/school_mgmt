import Link from 'next/link';
import { getOrgBrand } from '@/lib/org';
import { portalStudents } from '@/lib/portal';
import { feeAccountSummary } from '@/lib/fees/statement';
import { resolveTerm } from '@/lib/academics/setup';
import { studentAttendanceSummary } from '@/lib/academics/attendance';
import { listPublishedTerms } from '@/lib/academics/assessments';
import { listStreamTimetable } from '@/lib/academics/timetable';
import { visibleAnnouncements } from '@/lib/announcements';
import { studentLoans } from '@/lib/library';
import { getStudentTransport } from '@/lib/transport';
import { studentBed } from '@/lib/hostel';
import { imageSrc } from '@/lib/cloudinary';
import { formatDate, today } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { Card, CardHead, EmptyState, Pill } from '@/components/ui/primitives';
import { Money } from '@/components/ui/money';
import { KpiTile } from './shared';
import { DAY_NAMES } from '@/lib/constants';
import type { SessionUser } from '@/lib/types';

/**
 * The Student Role Centre — written for the child, not the bill-payer.
 *
 * A pupil opening this wants three things: what lesson is next, how they are doing, and whether
 * anything is due back — a library book, a report card, the bus. Fees appear as a single line for
 * awareness; the paying is their parent's screen, not theirs.
 */
export async function StudentRoleCentre({ user }: { user: SessionUser }) {
  const org = await getOrgBrand();
  let scope: Awaited<ReturnType<typeof portalStudents>>;
  try {
    scope = await portalStudents(user);
  } catch (e) {
    return (
      <Page title="My Portal" crumb={org!.name} user={user}>
        <Card><EmptyState icon="🎒" title="Your login is not linked to a student yet" sub={(e as Error).message} /></Card>
      </Page>
    );
  }
  const me = scope.students[0];
  if (!me) {
    return (
      <Page title="My Portal" crumb={org!.name} user={user}>
        <Card><EmptyState icon="🎒" title="No student record on this login" sub="Ask the school office to link your login to your admission number." /></Card>
      </Page>
    );
  }

  const term = await resolveTerm();
  const weekday = new Date().getDay();
  const [fees, att, published, notices, slots, loans, ride, bed] = await Promise.all([
    feeAccountSummary(me.id),
    term ? studentAttendanceSummary(me.id, term.start_date, term.end_date) : Promise.resolve(null),
    listPublishedTerms(me.id),
    visibleAnnouncements({ audiences: ['STUDENTS'], gradeLevelIds: me.current_grade_level_id ? [me.current_grade_level_id] : [], streamIds: me.current_stream_id ? [me.current_stream_id] : [] }, 4),
    term && me.current_stream_id ? listStreamTimetable(me.current_stream_id, term.id).catch(() => []) : Promise.resolve([]),
    studentLoans(me.id).catch(() => []),
    getStudentTransport(me.id).catch(() => undefined),
    studentBed(me.id).catch(() => undefined),
  ]);
  const todaysLessons = slots.filter((s) => s.day_of_week === weekday);
  const out = loans.filter((l) => l.status === 'ON_LOAN');
  const overdue = out.filter((l) => l.days_overdue > 0);

  return (
    <Page title={`Hello, ${me.first_name}`} crumb={`${org!.name} · ${me.grade_level_name ?? ''} ${me.stream_name ?? ''} · ${formatDate(today())}${term ? ` · ${term.name} ${term.year_name}` : ''}`} user={user}>
      <div className="grid g4 stack-2">
        <KpiTile label="Lessons today" value={todaysLessons.length || '—'} foot={todaysLessons.length ? DAY_NAMES[weekday] : 'No timetable for today'} accent={false} />
        <KpiTile label="My attendance" value={att?.total ? `${att.rate}%` : '—'} foot={att?.total ? `${att.absent} day${att.absent === 1 ? '' : 's'} absent this term` : 'No registers yet'} accent={!!att && att.rate < 90} />
        <KpiTile label="Books out" value={out.length} foot={overdue.length ? `${overdue.length} overdue — return today` : out.length ? 'All within the loan period' : 'Nothing borrowed'} accent={overdue.length > 0} />
        <KpiTile label="Report cards" value={published.length} foot={published[0] ? `Latest: ${published[0].term_name}` : 'None published yet'} accent={false} />
      </div>

      <div className="grid g2">
        <Card>
          <CardHead title="Today's lessons" sub={term ? `${DAY_NAMES[weekday]} · ${term.name} ${term.year_name}` : undefined}>
            <Link href="/portal/timetable" className="btn sm ghost">Full timetable</Link>
          </CardHead>
          {todaysLessons.length ? (
            <table>
              <thead><tr><th>Period</th><th>Subject</th><th>Teacher</th><th>Room</th></tr></thead>
              <tbody>
                {todaysLessons.map((s) => (
                  <tr key={s.id}>
                    <td className="mono">{s.start_time}–{s.end_time}</td>
                    <td><b>{s.subject_name}</b></td>
                    <td>{s.teacher_name ?? '—'}</td>
                    <td>{s.room ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <EmptyState icon="🗓" title="Nothing timetabled today" sub="Check the full timetable for the rest of the week." />}
        </Card>

        <Card>
          <CardHead title="My school" sub="Where you are and what you have">
            <Link href="/portal/services" className="btn sm ghost">Bus, boarding &amp; library</Link>
          </CardHead>
          <div className="grid g2">
            <div>
              <div className="tiny muted-cell">My photo &amp; admission no.</div>
              <div className="inline" style={{ gap: 10, alignItems: 'center' }}>
                {me.photo ? <img src={imageSrc(me.photo, { width: 44, height: 44, crop: 'fill' }) ?? ''} alt="" width={44} height={44} style={{ borderRadius: '50%' }} /> : null}
                <span className="mono">{me.admission_no}</span>
              </div>
              <div className="tiny muted-cell" style={{ marginTop: 10 }}>Class</div>
              <div>{me.grade_level_name ?? '—'} {me.stream_name ?? ''}</div>
            </div>
            <div>
              <div className="tiny muted-cell">School bus</div>
              <div>{ride ? <>{ride.route_name}{ride.stop_name ? <div className="tiny">Stop: {ride.stop_name}</div> : null}</> : <span className="tiny muted-cell">Not on the bus</span>}</div>
              <div className="tiny muted-cell" style={{ marginTop: 10 }}>Boarding</div>
              <div>{bed ? <>{bed.hostel_name}<div className="tiny">{bed.room_name} · Bed {bed.bed_label}</div></> : <span className="tiny muted-cell">Day scholar</span>}</div>
            </div>
          </div>
          {out.length ? (
            <div style={{ marginTop: 12 }}>
              <div className="tiny muted-cell">Library books out</div>
              {out.slice(0, 3).map((l) => (
                <div key={l.id} className="tiny">
                  <b>{l.title}</b> — due {formatDate(l.due_on)}
                  {l.days_overdue > 0 ? <Pill tone="bad">{l.days_overdue} day{l.days_overdue === 1 ? '' : 's'} overdue</Pill> : null}
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      </div>

      <div className="grid g2">
        <Card>
          <CardHead title="My results" sub="Report cards your teachers have published">
            <Link href="/portal/grades" className="btn sm ghost">Grades</Link>
          </CardHead>
          {published.length ? published.slice(0, 5).map((p) => (
            <div key={p.term_id} style={{ marginBottom: 6 }}>
              <Link href={`/portal/grades?term=${p.term_id}`}>{p.term_name} {p.year_name}</Link>
            </div>
          )) : <EmptyState icon="📄" title="No report cards yet" sub="They appear here as soon as your teachers publish them." />}
          <div className="note tiny" style={{ marginTop: 10 }}>
            Fee balance <Money cents={fees?.balance ?? 0} />{fees?.overdue ? ' — some of it is overdue' : ''}. Your parent or guardian settles this from their own portal.
          </div>
        </Card>

        <Card>
          <CardHead title="Notices for my class" sub="From the school and from your teachers">
            <Link href="/portal/announcements" className="btn sm ghost">All notices</Link>
          </CardHead>
          {notices.length ? notices.map((n) => (
            <div key={n.id} style={{ marginBottom: 10 }}>
              <b>{n.title}</b> <span className="tiny muted-cell">{formatDate(n.published_at.slice(0, 10))}</span>
              <div className="tiny">{n.body.length > 140 ? `${n.body.slice(0, 140)}…` : n.body}</div>
            </div>
          )) : <EmptyState icon="📣" title="Nothing new" />}
        </Card>
      </div>
    </Page>
  );
}
