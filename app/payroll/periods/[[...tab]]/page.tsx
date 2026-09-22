import Link from 'next/link';
import { requireAction, currentCanAction } from '@/lib/session';
import { listPayrollPeriods } from '@/lib/payroll';
import { Page } from '@/components/layout/page';
import { Card, EmptyState, Pill, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { NewPeriodButton } from '../period-actions';

export default async function PayrollPeriodsPage() {
  const user = await requireAction('PAYROLL_PERIODS_READ');
  const [rows, canCreate] = await Promise.all([listPayrollPeriods(), currentCanAction('PAYROLL_PERIODS_CREATE')]);
  const hasOpenOrPending = rows.some((r) => r.status === 'OPEN' || r.status === 'PENDING_APPROVAL');

  return (
    <Page title="Payroll Periods" crumb="Run, approve and close payroll" user={user}>
      <Toolbar>
        <Spacer />
        {canCreate && !hasOpenOrPending ? <NewPeriodButton /> : null}
      </Toolbar>
      <Card>
        {rows.length ? (
          <TableWrap>
            <thead><tr><th>Period</th><th>Start</th><th>End</th><th>Status</th><th className="num" /></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="mono"><Link href={`/payroll/periods/view/${p.id}`}>{p.period_name}</Link></td>
                  <td>{p.start_date}</td>
                  <td>{p.end_date}</td>
                  <td><Pill status={p.status.replace('_', ' ')} /></td>
                  <td className="num" />
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🗓" title="No payroll periods yet" />}
      </Card>
    </Page>
  );
}
