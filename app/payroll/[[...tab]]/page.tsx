import Link from 'next/link';
import { requireAction, currentCanAction } from '@/lib/session';
import { getOpenPayrollPeriod, listPeriodTransactions } from '@/lib/payroll';
import { listEmployees } from '@/lib/employees';
import { getDimensionCaptions } from '@/lib/org';
import { Page } from '@/components/layout/page';
import { Card, CardHead, EmptyState, Pill, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { Money } from '@/components/ui/money';
import { RunForPeriodButton } from '../payroll-actions';

export default async function PayrollPage() {
  const user = await requireAction('PAYROLL_READ');
  const [period, employees, canRun, { caption2 }] = await Promise.all([
    getOpenPayrollPeriod(), listEmployees({ view: 'active' }), currentCanAction('PAYROLL_PERIODS_RUN'),
    getDimensionCaptions(),
  ]);
  const netPayByEmployee = new Map<number, number>();
  if (period) {
    const lines = await listPeriodTransactions(period.id);
    for (const l of lines) {
      if (l.transaction_code !== 'NPAY') continue;
      netPayByEmployee.set(l.employee_id, (netPayByEmployee.get(l.employee_id) ?? 0) + Number(l.amount_cents));
    }
  }

  return (
    <Page title="Payroll" crumb={period ? `Open period: ${period.period_name}` : 'No open payroll period'} user={user}>
      {!period ? (
        <Card>
          <EmptyState icon="💰" title="No open payroll period"
            sub={<>Start one under <Link href="/payroll/periods">Payroll Periods</Link> before running payroll.</>} />
        </Card>
      ) : (
        <>
          <Toolbar>
            <Spacer />
            {canRun ? <RunForPeriodButton periodId={period.id} /> : null}
          </Toolbar>
          <Card>
            <CardHead title={`Employees — ${period.period_name}`} sub="Every Active / On Leave employee with a payroll posting group" />
            {employees.length ? (
              <TableWrap>
                <thead><tr><th>Employee No.</th><th>Name</th><th>{caption2}</th><th className="num">Net pay (this run)</th></tr></thead>
                <tbody>
                  {employees.map((e) => (
                    <tr key={e.id}>
                      <td className="mono"><Link href={`/payroll/view/${e.id}`}>{e.employee_no}</Link></td>
                      <td><b>{e.first_name} {e.last_name}</b></td>
                      <td>{e.global_dimension_2_name || '—'}</td>
                      <td className="num">{netPayByEmployee.has(e.id) ? <Money cents={netPayByEmployee.get(e.id)!} /> : <Pill tone="warn">Not run</Pill>}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            ) : <EmptyState icon="🧑‍💼" title="No active employees with a posting group set" />}
          </Card>
        </>
      )}
    </Page>
  );
}
