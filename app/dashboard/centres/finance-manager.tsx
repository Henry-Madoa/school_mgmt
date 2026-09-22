import Link from 'next/link';
import { currentCanAction } from '@/lib/session';
import { getOrgBrand } from '@/lib/org';
import { getFinanceManagerRoleCenter } from '@/lib/roleCenters';
import { formatDate, today } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { Card, CardHead, EmptyState, Pill, TableWrap } from '@/components/ui/primitives';
import { Money } from '@/components/ui/money';
import { KpiTile, LockedCard } from './shared';
import { MonthTrend, MixDonut, BalanceSheetBar, RatioGauges } from '../role-center-charts';
import type { SessionUser } from '@/lib/types';

export async function FinanceManagerRoleCentre({ user }: { user: SessionUser }) {
  const canGl = await currentCanAction('GL_READ');
  const canReports = await currentCanAction('REPORTS_VIEW');
  const [org, d] = await Promise.all([getOrgBrand(), getFinanceManagerRoleCenter()]);
  const months = d.pl.map((p) => p.month);

  if (!canGl && !canReports) {
    return (
      <Page title="Finance Manager Role Centre" crumb={org!.name} user={user}>
        <LockedCard title="Financial performance" />
      </Page>
    );
  }

  return (
    <Page title="Finance Manager Role Centre" crumb={`${org!.name} · as at ${formatDate(today())}`} user={user}>
      <div className="grid g4 stack-2">
        <KpiTile label="Surplus (YTD)" value={<Money cents={d.kpi.surplus} short />}
          spark={d.pl.map((p) => p.surplus)} />
        <KpiTile label="Income (YTD)" value={<Money cents={d.kpi.income} short />}
          foot={<>Expenditure <Money cents={d.kpi.expense} decimals={0} /></>}
          spark={d.pl.map((p) => p.income)} sparkColor="var(--series-3)" />
        <KpiTile accent={false} label="Cash & bank" value={<Money cents={d.kpi.cash} short />} />
        <KpiTile accent={false} label="Fees outstanding" value={<Money cents={d.kpi.feesOutstanding} short />}
          foot={<>Past due <Money cents={d.kpi.feesOverdue} decimals={0} /></>} />
      </div>

      <div className="grid split-wide">
        <Card>
          <CardHead title="Income vs expenditure" sub="Monthly, with the resulting surplus" />
          <MonthTrend months={months} series={[
            { name: 'Income', values: d.pl.map((p) => p.income) },
            { name: 'Expenditure', values: d.pl.map((p) => p.expense) },
            { name: 'Surplus', values: d.pl.map((p) => p.surplus) },
          ]} />
        </Card>
        <Card>
          <CardHead title="Balance sheet" sub={d.balanceSheet.balanced ? 'In balance' : 'Out of balance'}>
            <Link href="/reports/balance-sheet" className="btn sm ghost">Statement</Link>
          </CardHead>
          <BalanceSheetBar assets={d.balanceSheet.assets} liabilities={d.balanceSheet.liabilities}
            equity={d.balanceSheet.equity} surplus={d.balanceSheet.surplus} />
        </Card>
      </div>

      <Card>
        <CardHead title="Financial health" sub="Fee collection, arrears and cost cover against the school's own targets" />
        <RatioGauges ratios={d.ratios} />
      </Card>

      <div className="grid split-narrow">
        <Card>
          <CardHead title="Income & expenditure composition" />
          {d.incomeMix.length || d.expenseMix.length ? (
            <div className="grid g2 stack-2">
              <div>
                <h4 className="metric-label" style={{ marginBottom: 8 }}>Income</h4>
                <MixDonut centerLabel="income" total={d.kpi.income} rows={d.incomeMix} />
              </div>
              <div>
                <h4 className="metric-label" style={{ marginBottom: 8 }}>Expenditure</h4>
                <MixDonut centerLabel="costs" total={d.kpi.expense} rows={d.expenseMix} />
              </div>
            </div>
          ) : <EmptyState icon="📊" title="No income or expenditure this year" />}
        </Card>
        <Card>
          <CardHead title="Approvals queue" sub="Everything pending a decision, by document type">
            <Link href="/approvals" className="btn sm ghost">Open</Link>
          </CardHead>
          {d.approvals.length ? (
            <TableWrap>
              <thead><tr><th>Document type</th><th className="num">Pending</th></tr></thead>
              <tbody>
                {d.approvals.map((a) => (
                  <tr key={a.type}><td>{a.type}</td><td className="num">{a.count}</td></tr>
                ))}
              </tbody>
            </TableWrap>
          ) : <EmptyState icon="✔" title="Approvals queue is clear" />}
        </Card>
      </div>
    </Page>
  );
}
