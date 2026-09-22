import Link from 'next/link';
import { currentCanAction } from '@/lib/session';
import { getOrgBrand } from '@/lib/org';
import { getHrPayrollRoleCenter } from '@/lib/roleCenters';
import { formatDate, today } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { Card, CardHead, EmptyState, Pill, TableWrap } from '@/components/ui/primitives';
import { Money } from '@/components/ui/money';
import { KpiTile, LockedCard } from './shared';
import type { SessionUser } from '@/lib/types';

export async function HrPayrollRoleCentre({ user }: { user: SessionUser }) {
  const canEmployees = await currentCanAction('EMPLOYEES_READ');
  const [org, d] = await Promise.all([getOrgBrand(), getHrPayrollRoleCenter()]);

  if (!canEmployees) {
    return (
      <Page title="HR &amp; Payroll Role Centre" crumb={org!.name} user={user}>
        <LockedCard title="Employee Management" />
      </Page>
    );
  }

  return (
    <Page title="HR &amp; Payroll Role Centre" crumb={`${org!.name} · as at ${formatDate(today())}`} user={user}>
      <div className="grid g4 stack-2">
        <KpiTile label="Active headcount" value={d.kpi.headcountActive}
          foot={<Link href="/employees">All employees</Link>} />
        <KpiTile label="New / pending onboarding" value={d.kpi.headcountNew + d.kpi.headcountPendingApproval}
          foot={<Link href="/employees/new">New records</Link>} accent={d.kpi.headcountPendingApproval > 0} />
        <KpiTile label="Pending approvals" value={d.kpi.pendingApprovals}
          foot={<Link href="/approvals">Open approvals</Link>} accent={d.kpi.pendingApprovals > 0} />
        <KpiTile label="Leave applications pending" value={d.kpi.leaveApplicationsPending}
          foot={<Link href="/leave-applications/pending">Review</Link>} accent={d.kpi.leaveApplicationsPending > 0} />
      </div>

      <div className="grid split-wide">
        <Card>
          <CardHead title="Payroll" sub="Current period status and last computed net pay">
            <Link href="/payroll/periods" className="btn sm ghost">Payroll periods</Link>
          </CardHead>
          <TableWrap>
            <tbody>
              <tr><td>Current period status</td><td className="num">{d.kpi.payrollPeriodStatus ? <Pill status={d.kpi.payrollPeriodStatus.replace('_', ' ')} /> : <Pill tone="warn">No open period</Pill>}</td></tr>
              <tr><td>Last period net pay</td><td className="num"><Money cents={d.kpi.lastNetPay} /></td></tr>
            </tbody>
          </TableWrap>
        </Card>
        <Card>
          <CardHead title="Headcount by department" />
          {d.headcountByDepartment.length ? (
            <TableWrap>
              <thead><tr><th>Department</th><th className="num">Employees</th></tr></thead>
              <tbody>
                {d.headcountByDepartment.map((r) => (
                  <tr key={r.name}><td>{r.name}</td><td className="num">{r.count}</td></tr>
                ))}
              </tbody>
            </TableWrap>
          ) : <EmptyState icon="🧑‍💼" title="No active employees yet" />}
        </Card>
      </div>

      <div className="grid split-narrow">
        <Card>
          <CardHead title="Upcoming approved leave" sub="Next 30 days" />
          {d.upcomingLeave.length ? (
            <TableWrap>
              <thead><tr><th>Employee</th><th>Leave type</th><th>Start date</th></tr></thead>
              <tbody>
                {d.upcomingLeave.map((r, i) => (
                  <tr key={i}><td>{r.employeeName}</td><td>{r.leaveType}</td><td>{r.startDate}</td></tr>
                ))}
              </tbody>
            </TableWrap>
          ) : <EmptyState icon="🏖" title="No approved leave starting soon" />}
        </Card>
        <Card>
          <CardHead title="Probation ending soon" sub="Next 30 days" />
          {d.probationEnding.length ? (
            <TableWrap>
              <thead><tr><th>Employee</th><th>Probation end</th></tr></thead>
              <tbody>
                {d.probationEnding.map((r, i) => (
                  <tr key={i}><td>{r.employeeName}</td><td>{r.endDate}</td></tr>
                ))}
              </tbody>
            </TableWrap>
          ) : <EmptyState icon="🎓" title="No probation periods ending soon" />}
        </Card>
      </div>

      <Card>
        <CardHead title="Contracts expiring soon" sub="Next 30 days" />
        {d.contractsExpiring.length ? (
          <TableWrap>
            <thead><tr><th>Employee</th><th>Contract end</th></tr></thead>
            <tbody>
              {d.contractsExpiring.map((r, i) => (
                <tr key={i}><td>{r.employeeName}</td><td>{r.endDate}</td></tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="📄" title="No contracts expiring soon" />}
      </Card>
    </Page>
  );
}
