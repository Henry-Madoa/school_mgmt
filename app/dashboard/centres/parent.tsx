import Link from 'next/link';
import { getOrgBrand } from '@/lib/org';
import { portalStudents } from '@/lib/portal';
import { feeAccountSummary } from '@/lib/fees/statement';
import { resolveTerm } from '@/lib/academics/setup';
import { studentAttendanceSummary } from '@/lib/academics/attendance';
import { listPublishedTerms } from '@/lib/academics/assessments';
import { visibleAnnouncements } from '@/lib/announcements';
import { getStudentTransport } from '@/lib/transport';
import { studentBed } from '@/lib/hostel';
import { imageSrc } from '@/lib/cloudinary';
import { formatDate, today } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { Card, CardHead, EmptyState, Pill } from '@/components/ui/primitives';
import { Money } from '@/components/ui/money';
import { KpiTile } from './shared';
import type { SessionUser } from '@/lib/types';

/**
 * The Parent Role Centre — written for the person who pays the fees and answers the phone.
 *
 * A parent opens this to answer four questions: what do I owe and by when, is my child in school,
 * how are they doing, and what has the school told me lately. One card per child, because a family
 * with three here should see three lines, not three logins.
 */
export async function ParentRoleCentre({ user }: { user: SessionUser }) {
  const org = await getOrgBrand();
  let scope: Awaited<ReturnType<typeof portalStudents>>;
  try {
    scope = await portalStudents(user);
  } catch (e) {
    return (
      <Page title="Parent Portal" crumb={org!.name} user={user}>
        <Card><EmptyState icon="👪" title="Your login is not linked to a child yet" sub={(e as Error).message} /></Card>
      </Page>
    );
  }

  const term = await resolveTerm();
  const [notices, ...cards] = await Promise.all([
    visibleAnnouncements({ audiences: ['GUARDIANS'], gradeLevelIds: scope.students.map((s) => s.current_grade_level_id).filter((x): x is number => !!x), streamIds: scope.students.map((s) => s.current_stream_id).filter((x): x is number => !!x) }, 5),
    ...scope.students.map(async (s) => {
      const [fees, att, published, ride, bed] = await Promise.all([
        feeAccountSummary(s.id),
        term ? studentAttendanceSummary(s.id, term.start_date, term.end_date) : Promise.resolve(null),
        listPublishedTerms(s.id),
        getStudentTransport(s.id).catch(() => undefined),
        studentBed(s.id).catch(() => undefined),
      ]);
      return { s, fees, att, published, ride, bed };
    }),
  ]);

  const owing = cards.reduce((a, c) => a + Number(c.fees?.balance ?? 0), 0);
  const overdue = cards.reduce((a, c) => a + Number(c.fees?.overdue ?? 0), 0);
  const nextDue = cards.map((c) => c.fees?.next_due_date).filter((d): d is string => !!d).sort()[0];
  const concerns = cards.filter((c) => c.att?.total && c.att.rate < 90);

  return (
    <Page title="Parent Portal" crumb={`${org!.name} · ${formatDate(today())}${term ? ` · ${term.name} ${term.year_name}` : ''}`} user={user}>
      <div className="grid g4 stack-2">
        <KpiTile label="Children on the roll" value={cards.length} foot={cards.map((c) => c.s.first_name).join(', ')} accent={false} />
        <KpiTile label="Fees owing" value={<Money cents={owing} short />} foot={overdue > 0 ? <><Money cents={overdue} /> overdue</> : owing > 0 ? `Next due ${nextDue ? formatDate(nextDue) : 'this term'}` : 'Fully paid — thank you'} accent={overdue > 0} />
        <KpiTile label="Attendance" value={cards.length ? `${Math.round(cards.reduce((a, c) => a + (c.att?.rate ?? 0), 0) / cards.length)}%` : '—'} foot={concerns.length ? `${concerns.map((c) => c.s.first_name).join(', ')} below 90%` : 'No concerns this term'} accent={concerns.length > 0} />
        <KpiTile label="Pay by M-Pesa" value={org!.short_name ?? org!.name} foot="Paybill — account is the admission number" accent={false} />
      </div>

      {owing > 0 ? (
        <div className="note" style={overdue > 0 ? { borderLeftColor: 'var(--danger)' } : undefined}>
          You owe <strong><Money cents={owing} /></strong> across {cards.length === 1 ? 'one child' : `${cards.length} children`}
          {overdue > 0 ? <>, of which <strong><Money cents={overdue} /></strong> is overdue</> : nextDue ? <>, due {formatDate(nextDue)}</> : null}.
          {' '}<Link href="/portal/fees">Pay with M-Pesa or view the statement →</Link>
        </div>
      ) : null}

      {cards.map(({ s, fees, att, published, ride, bed }) => (
        <Card key={s.id}>
          <CardHead
            title={<span className="inline" style={{ gap: 10 }}>
              {s.photo ? <img src={imageSrc(s.photo, { width: 40, height: 40, crop: 'fill' }) ?? ''} alt="" width={40} height={40} style={{ borderRadius: '50%' }} /> : null}
              {s.first_name} {s.last_name} <span className="mono tiny">{s.admission_no}</span>
            </span>}
            sub={`${s.grade_level_name ?? 'Not placed'}${s.stream_name ? ` ${s.stream_name}` : ''} · ${s.status.toLowerCase()}`}
          >
            <Link href={`/portal/timetable?student=${s.id}`} className="btn sm ghost">Timetable</Link>
            <Link href={`/portal/grades?student=${s.id}`} className="btn sm ghost">Grades</Link>
            <Link href={`/portal/attendance?student=${s.id}`} className="btn sm ghost">Attendance</Link>
            <Link href={`/portal/fees?student=${s.id}`} className="btn sm">Fees</Link>
          </CardHead>
          <div className="grid g4">
            <div>
              <div className="tiny muted-cell">Fee balance</div>
              <div className="dl-emphasis"><Money cents={fees?.balance ?? 0} /></div>
              {fees?.overdue ? <Pill tone="bad"><Money cents={fees.overdue} /> overdue</Pill> : fees ? <Pill tone="ok">Nothing overdue</Pill> : <span className="tiny muted-cell">No fee account yet</span>}
              {fees?.next_due_date ? <div className="tiny muted-cell">Next due {formatDate(fees.next_due_date)}</div> : null}
            </div>
            <div>
              <div className="tiny muted-cell">Attendance this term</div>
              <div className="dl-emphasis">{att?.total ? `${att.rate}%` : '—'}</div>
              {att?.total
                ? <div className="tiny muted-cell">{att.present + att.late} of {att.total} days · {att.absent} absent{att.late ? `, ${att.late} late` : ''}</div>
                : <div className="tiny muted-cell">No registers yet</div>}
            </div>
            <div>
              <div className="tiny muted-cell">Report cards</div>
              {published.length ? published.slice(0, 3).map((p) => (
                <div key={p.term_id}><Link href={`/portal/grades?student=${s.id}&term=${p.term_id}`}>{p.term_name} {p.year_name}</Link></div>
              )) : <div className="tiny muted-cell">None published yet</div>}
            </div>
            <div>
              <div className="tiny muted-cell">Bus &amp; boarding</div>
              <div className="tiny">{ride ? <>{ride.route_name}{ride.stop_name ? ` · ${ride.stop_name}` : ''}</> : 'Not on the school bus'}</div>
              <div className="tiny">{bed ? `${bed.hostel_name} · ${bed.room_name}, bed ${bed.bed_label}` : 'Day scholar'}</div>
              <Link href={`/portal/services?student=${s.id}`} className="tiny">Details →</Link>
            </div>
          </div>
        </Card>
      ))}

      {!cards.length ? <Card><EmptyState icon="👪" title="No children linked to this account" sub="Ask the school office to link your phone number to your child's record." /></Card> : null}

      <Card>
        <CardHead title="From the school" sub="Notices addressed to parents and to your children's classes">
          <Link href="/portal/announcements" className="btn sm ghost">All notices</Link>
        </CardHead>
        {notices.length ? notices.map((n) => (
          <div key={n.id} style={{ marginBottom: 10 }}>
            <b>{n.title}</b> <span className="tiny muted-cell">{formatDate(n.published_at.slice(0, 10))}</span>
            <div className="tiny">{n.body.length > 180 ? `${n.body.slice(0, 180)}…` : n.body}</div>
          </div>
        )) : <EmptyState icon="📣" title="Nothing new from the school" />}
      </Card>
    </Page>
  );
}
