import Link from 'next/link';
import { getOrgBrand } from '@/lib/org';
import { portalStudents } from '@/lib/portal';
import { feeAccountSummary } from '@/lib/fees/statement';
import { resolveTerm } from '@/lib/academics/setup';
import { studentAttendanceSummary } from '@/lib/academics/attendance';
import { listPublishedTerms } from '@/lib/academics/assessments';
import { visibleAnnouncements } from '@/lib/announcements';
import { imageSrc } from '@/lib/cloudinary';
import { formatDate, today } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { Card, CardHead, EmptyState, Pill } from '@/components/ui/primitives';
import { Money } from '@/components/ui/money';
import { KpiTile } from './shared';
import type { SessionUser } from '@/lib/types';

/** The Student / Parent Portal's landing page — one card per child: fees, attendance, report cards, notices. */
export async function StudentParentRoleCentre({ user }: { user: SessionUser }) {
  const org = await getOrgBrand();
  let scope: Awaited<ReturnType<typeof portalStudents>>;
  try {
    scope = await portalStudents(user);
  } catch (e) {
    return (
      <Page title="Student / Parent Portal" crumb={org!.name} user={user}>
        <Card><EmptyState icon="🎒" title="Your login is not linked yet" sub={(e as Error).message} /></Card>
      </Page>
    );
  }
  const term = await resolveTerm();
  const cards = await Promise.all(scope.students.map(async (s) => {
    const [fees, att, published, notices] = await Promise.all([
      feeAccountSummary(s.id),
      term ? studentAttendanceSummary(s.id, term.start_date, term.end_date) : Promise.resolve(null),
      listPublishedTerms(s.id),
      visibleAnnouncements({ audiences: scope.kind === 'STUDENT' ? ['STUDENTS'] : ['GUARDIANS'], gradeLevelIds: s.current_grade_level_id ? [s.current_grade_level_id] : [], streamIds: s.current_stream_id ? [s.current_stream_id] : [] }, 3),
    ]);
    return { s, fees, att, published, notices };
  }));
  const totalOwing = cards.reduce((a, c) => a + Number(c.fees?.balance ?? 0), 0);

  return (
    <Page title={scope.kind === 'STUDENT' ? 'My Portal' : 'Parent Portal'} crumb={`${org!.name} · ${formatDate(today())}${term ? ` · ${term.name} ${term.year_name}` : ''}`} user={user}>
      <div className="grid g4 stack-2">
        <KpiTile label={scope.kind === 'STUDENT' ? 'Student' : 'Children on the roll'} value={scope.students.length} accent={false} />
        <KpiTile label="Fees owing" value={<Money cents={totalOwing} short />} foot={totalOwing > 0 ? <Link href="/portal/fees">Pay or view statement</Link> : 'Fully paid'} accent={totalOwing > 0} />
        <KpiTile label="Current term" value={term ? term.name : '—'} foot={term ? `${formatDate(term.start_date)} – ${formatDate(term.end_date)}` : ''} accent={false} />
        <KpiTile label="Paybill" value={org!.short_name ?? org!.name} foot="Use the admission number as the account" accent={false} />
      </div>

      {cards.map(({ s, fees, att, published, notices }) => (
        <Card key={s.id}>
          <CardHead
            title={<span className="inline" style={{ gap: 10 }}>
              {s.photo ? <img src={imageSrc(s.photo, { width: 40, height: 40, crop: 'fill' }) ?? ''} alt="" width={40} height={40} style={{ borderRadius: '50%' }} /> : null}
              {s.first_name} {s.last_name} <span className="mono tiny">{s.admission_no}</span>
            </span>}
            sub={`${s.grade_level_name ?? ''}${s.stream_name ? ` ${s.stream_name}` : ''} · ${s.status.toLowerCase()}`}
          >
            <Link href={`/portal/timetable?student=${s.id}`} className="btn sm ghost">Timetable</Link>
            <Link href={`/portal/grades?student=${s.id}`} className="btn sm ghost">Grades</Link>
            <Link href={`/portal/attendance?student=${s.id}`} className="btn sm ghost">Attendance</Link>
            <Link href={`/portal/fees?student=${s.id}`} className="btn sm">Fees</Link>
          </CardHead>
          <div className="grid g3">
            <div>
              <div className="tiny muted-cell">Fee balance</div>
              <div className="dl-emphasis"><Money cents={fees?.balance ?? 0} /></div>
              {fees?.overdue ? <Pill tone="bad"><Money cents={fees.overdue} /> overdue</Pill> : fees ? <Pill tone="ok">Nothing overdue</Pill> : <span className="tiny muted-cell">No fee account yet</span>}
              {fees?.next_due_date ? <div className="tiny muted-cell">Next due {formatDate(fees.next_due_date)}</div> : null}
            </div>
            <div>
              <div className="tiny muted-cell">Attendance this term</div>
              <div className="dl-emphasis">{att?.total ? `${att.rate}%` : '—'}</div>
              {att?.total ? <div className="tiny muted-cell">{att.present + att.late} of {att.total} days · {att.absent} absent</div> : <div className="tiny muted-cell">No registers yet</div>}
            </div>
            <div>
              <div className="tiny muted-cell">Report cards</div>
              {published.length ? published.slice(0, 3).map((p) => (
                <div key={p.term_id}><Link href={`/portal/grades?student=${s.id}&term=${p.term_id}`}>{p.term_name} {p.year_name}</Link></div>
              )) : <div className="tiny muted-cell">None published yet</div>}
            </div>
          </div>
          {notices.length ? (
            <div style={{ marginTop: 12 }}>
              <div className="tiny muted-cell">Notices</div>
              {notices.map((n) => <div key={n.id}><b>{n.title}</b> <span className="tiny muted-cell">{formatDate(n.published_at.slice(0, 10))}</span></div>)}
              <Link href="/portal/announcements" className="tiny">All announcements →</Link>
            </div>
          ) : null}
        </Card>
      ))}
      {!cards.length ? <Card><EmptyState icon="🎒" title="No students on this account" /></Card> : null}
    </Page>
  );
}
