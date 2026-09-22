import Link from 'next/link';
import { getOrgBrand } from '@/lib/org';
import { getDashboard } from '@/lib/reports';
import { formatDate, today } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { Card, CardHead, EmptyState, Pill, Stat, TableWrap } from '@/components/ui/primitives';
import { Money } from '@/components/ui/money';
import { MonthlyCollectionsChart, EnrolmentByGradeChart, AttendanceTodayChart } from '../charts';
import type { SessionUser } from '@/lib/types';

/** The all-round dashboard — the Super Role Centre: the school and its money at a glance. */
export async function SuperRoleCentre({ user }: { user: SessionUser }) {
  const [org, d] = await Promise.all([getOrgBrand(), getDashboard(user.id, user.username)]);
  const collectionRate = d.fees.invoiced ? (d.fees.collected / d.fees.invoiced) * 100 : 0;

  return (
    <Page title="Dashboard" crumb={`${org!.name} · as at ${formatDate(today())}`} user={user}>
      <div className="grid g4 stack-2">
        <Stat label="Students enrolled" value={d.students.active.toLocaleString()}
          foot={`${d.students.boys} boys · ${d.students.girls} girls · ${d.streams} classes`} />
        <Stat label="Fees outstanding" value={<Money cents={d.fees.outstanding} short />}
          foot={d.fees.overdue ? <><Money cents={d.fees.overdue} short /> past due</> : 'Nothing past due'} />
        <Stat label="Fees collected" value={<Money cents={d.fees.collected} short />}
          foot={`${collectionRate.toFixed(1)}% of ${d.fees.invoiced ? 'invoiced' : 'nothing invoiced yet'}`} />
        <Stat label="Cash & bank" value={<Money cents={d.cash} short />}
          foot="Bank, cashbook and paybill accounts" />
      </div>

      <div className="grid g4 stack-2">
        <Stat accent={false} label="Current term"
          value={d.currentTerm ? `${d.currentTerm.term} ${d.currentTerm.year}` : '—'}
          foot={d.currentTerm
            ? `${formatDate(d.currentTerm.start_date)} – ${formatDate(d.currentTerm.end_date)}`
            : <Link href="/academics/setup/academic-years">Set the current term</Link>} />
        <Stat accent={false} label="Attendance today"
          value={d.attendanceToday ? `${d.attendanceToday.rate}%` : '—'}
          foot={d.attendanceToday
            ? `${d.attendanceToday.present + d.attendanceToday.late} of ${d.attendanceToday.total} marked present`
            : 'No register taken yet today'} />
        <Stat accent={false} label="Surplus to date" value={<Money cents={d.surplus} short />}
          foot={<>Income <Money cents={d.income} short /> · Costs <Money cents={d.expense} short /></>} />
        <Stat accent={false} label="Awaiting approval" value={String(d.pendingApprovals)}
          foot={d.pendingApprovals
            ? <Link href="/approvals">Open the approvals queue</Link>
            : 'Queue is clear'} />
      </div>

      <div className="grid split-wide">
        <Card>
          <CardHead title="Fee collections by month"
            sub="Fees invoiced to students against payments received" />
          {d.monthlyCollections.length
            ? <MonthlyCollectionsChart monthly={d.monthlyCollections} />
            : <EmptyState icon="📊" title="No fee activity yet" sub="Run a fee invoice for the term to start" />}
        </Card>

        <Card>
          <CardHead title="Enrolment by grade" sub={`${d.teachers} teaching staff on the payroll`} />
          {d.enrolmentByGrade.some((g) => g.students > 0)
            ? <EnrolmentByGradeChart rows={d.enrolmentByGrade} />
            : <EmptyState icon="🎒" title="No students admitted yet" />}
        </Card>
      </div>

      <div className="grid split-narrow">
        <Card>
          <CardHead title="Today's attendance" sub="Across every register taken today" />
          {d.attendanceToday
            ? <AttendanceTodayChart summary={d.attendanceToday} />
            : <EmptyState icon="🗓" title="No register yet" sub="Class teachers mark attendance under Academics → Attendance" />}
        </Card>

        <Card>
          <CardHead title="Latest receipts" sub="Most recent money in, across every receipt type" />
          {d.recentReceipts.length ? (
            <TableWrap>
              <thead>
                <tr><th>Receipt</th><th>Date</th><th>Type</th><th>From</th><th className="num">Amount</th></tr>
              </thead>
              <tbody>
                {d.recentReceipts.map((r) => (
                  <tr key={r.no}>
                    <td className="mono"><Link href={`/cash-management/receipts/${encodeURIComponent(r.no)}`}>{r.no}</Link></td>
                    <td>{formatDate(r.posting_date)}</td>
                    <td><Pill>{r.receipt_type}</Pill></td>
                    <td>{r.description ?? '—'}</td>
                    <td className="num"><Money cents={r.amount} /></td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          ) : <EmptyState icon="🧾" title="Nothing receipted yet" />}
        </Card>
      </div>
    </Page>
  );
}
