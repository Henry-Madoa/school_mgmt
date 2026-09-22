import Link from 'next/link';
import { getDimensionCaptions } from '@/lib/org';
import { getSelfServiceRoleCenter, type SelfEmployee } from '@/lib/selfService';
import { formatDate } from '@/lib/format';
import { Card, CardHead, DefinitionList, EmptyState, Pill, TableWrap } from '@/components/ui/primitives';
import { Money } from '@/components/ui/money';
import { KpiTile } from '../dashboard/centres/shared';
import { imageSrc } from '@/lib/cloudinary';
import { initials } from '@/lib/format';
import type { SessionUser } from '@/lib/types';

/**
 * The Employee Self Service dashboard — what the employee sees: who the system thinks they are
 * (User Setup → Employee No., with their dimensions), leave balances for the current calendar,
 * the documents they have in flight, their latest payslip, and one-click ways into raising each
 * self-service document. Rendered by the Self Service Role Centre at /dashboard and by the
 * module's own Dashboard tab at /self-service, so an employee whose active profile is a
 * different role centre still has it one click away.
 */
export async function SelfServiceDashboard({ user, me }: { user: SessionUser; me: SelfEmployee }) {
  const [captions, d] = await Promise.all([getDimensionCaptions(), getSelfServiceRoleCenter(me.id)]);
  const inFlight = d.counts.leavePending + d.counts.imprestsPending + d.counts.requisitionsPending;
  const drafts = d.counts.leaveOpen + d.counts.plansOpen + d.counts.imprestsOpen + d.counts.pettyCashOpen + d.counts.requisitionsOpen;

  return (
    <>
      <div className="grid g4 stack-2">
        <KpiTile label="Awaiting approval" value={inFlight} foot={<Link href="/self-service/leave">My requests</Link>} accent={inFlight > 0} />
        <KpiTile label="Drafts not yet sent" value={drafts} foot={<span className="tiny">Open a draft to send it for approval</span>} accent={drafts > 0} />
        <KpiTile label="Imprests to surrender" value={d.counts.imprestsOutstanding}
          foot={<Link href="/self-service/imprest">My imprests</Link>} accent={d.counts.imprestsOutstanding > 0} />
        <KpiTile label="Last net pay" value={d.latestPayslip ? <Money cents={d.latestPayslip.net_pay} /> : '—'}
          foot={d.latestPayslip ? <Link href={`/self-service/payslips?period=${d.latestPayslip.period_id}`}>{d.latestPayslip.period_name} payslip</Link> : <Link href="/self-service/payslips">My payslips</Link>}
          accent={false} />
      </div>

      <div className="grid split-wide">
        <div>
          <Card>
            <CardHead title="Quick actions" sub="Each one raises a document that is yours — your employee number and dimensions are filled in for you" />
            <div className="inline" style={{ flexWrap: 'wrap', gap: 8 }}>
              <Link href="/self-service/leave" className="btn sm">🏖 Apply for leave</Link>
              <Link href="/self-service/leave-plans" className="btn sm ghost">🗓 Plan my leave</Link>
              <Link href="/self-service/imprest" className="btn sm ghost">💼 Request an imprest</Link>
              <Link href="/self-service/petty-cash" className="btn sm ghost">💵 Petty cash</Link>
              <Link href="/self-service/requisitions" className="btn sm ghost">📦 Store requisition</Link>
              <Link href="/self-service/purchase-requisitions" className="btn sm ghost">🛒 Purchase requisition</Link>
              <Link href="/self-service/p9" className="btn sm ghost">📄 My P9</Link>
            </div>
          </Card>

          <Card>
            <CardHead title="My leave balances" sub="Current leave calendar" />
            {d.leaveBalances.length ? (
              <TableWrap>
                <thead><tr><th>Leave type</th><th className="num">Days available</th></tr></thead>
                <tbody>
                  {d.leaveBalances.map((b) => (
                    <tr key={b.leave_type}><td>{b.leave_type}</td><td className="num">{b.balance}</td></tr>
                  ))}
                </tbody>
              </TableWrap>
            ) : <EmptyState icon="🏖" title="No leave entitlements posted yet" sub="Balances appear once HR posts this calendar's accruals." />}
          </Card>

          <Card>
            <CardHead title="Upcoming approved leave" />
            {d.upcomingLeave.length ? (
              <TableWrap>
                <thead><tr><th>No.</th><th>Type</th><th>From</th><th>To</th><th className="num">Days</th></tr></thead>
                <tbody>
                  {d.upcomingLeave.map((l) => (
                    <tr key={l.no}>
                      <td className="mono"><Link href={`/leave-applications/view/${l.no}`}>{l.no}</Link></td>
                      <td>{l.leave_type}</td><td>{formatDate(l.start_date)}</td><td>{formatDate(l.end_date)}</td>
                      <td className="num">{l.days}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            ) : <div className="note">No approved leave ahead.</div>}
          </Card>
        </div>

        <div>
          <Card>
            <CardHead title="My record" sub="As HR holds it — request a change under My Record">
              <Link href="/self-service/record" className="btn sm ghost">My record</Link>
            </CardHead>
            <div className="member-photo" style={{ marginBottom: 'var(--sp)' }}>
              {imageSrc(me.photo_image, { width: 104, height: 104, crop: 'fill' })
                ? <img src={imageSrc(me.photo_image, { width: 104, height: 104, crop: 'fill' })!} alt={`${me.first_name} ${me.last_name}`} className="photo" />
                : <div className="avatar" aria-hidden="true">{initials(`${me.first_name} ${me.last_name}`)}</div>}
            </div>
            <DefinitionList items={[
              ['Employee No.', <span className="mono" key="no">{me.employee_no}</span>],
              ['Name', `${me.first_name} ${me.last_name}`],
              ['Job title', me.job_title || '—'],
              ['Status', <Pill status={me.status} key="st" />],
              [captions.caption1, me.global_dimension_1_code ? `${me.global_dimension_1_code} — ${me.global_dimension_1_name ?? ''}` : '—'],
              [captions.caption2, me.global_dimension_2_code ? `${me.global_dimension_2_code} — ${me.global_dimension_2_name ?? ''}` : '—'],
              ['Login', user.username],
            ]} />
          </Card>

          <Card>
            <CardHead title="My documents" sub="Where each of your requests stands" />
            <TableWrap>
              <tbody>
                <tr><td>Leave applications</td><td className="num">{d.counts.leaveOpen} open · {d.counts.leavePending} pending · {d.counts.leaveApproved} approved</td></tr>
                <tr><td>Leave plans</td><td className="num">{d.counts.plansOpen} open</td></tr>
                <tr><td>Imprests</td><td className="num">{d.counts.imprestsOpen} open · {d.counts.imprestsPending} pending · {d.counts.imprestsOutstanding} to surrender</td></tr>
                <tr><td>Imprest balance owed</td><td className="num"><Money cents={d.imprestOutstanding} /></td></tr>
                <tr><td>Petty cash</td><td className="num">{d.counts.pettyCashOpen} open</td></tr>
                <tr><td>Requisitions</td><td className="num">{d.counts.requisitionsOpen} open · {d.counts.requisitionsPending} pending</td></tr>
              </tbody>
            </TableWrap>
          </Card>
        </div>
      </div>
    </>
  );
}
