import Link from 'next/link';
import { currentCanAction } from '@/lib/session';
import { getOrgBrand } from '@/lib/org';
import { getAccountantRoleCenter } from '@/lib/roleCenters';
import { formatDate, today } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { Card, CardHead, EmptyState, Pill, TableWrap } from '@/components/ui/primitives';
import { Money } from '@/components/ui/money';
import { KpiTile, LockedCard } from './shared';
import { MonthTrend, MagnitudeBars } from '../role-center-charts';
import type { SessionUser } from '@/lib/types';

export async function AccountantRoleCentre({ user }: { user: SessionUser }) {
  const canGl = await currentCanAction('GL_READ');
  const [org, d] = await Promise.all([getOrgBrand(), getAccountantRoleCenter()]);
  const months = d.journalsByMonth.map((m) => m.month);

  if (!canGl) {
    return (
      <Page title="Accountant Role Centre" crumb={org!.name} user={user}>
        <LockedCard title="General ledger" />
      </Page>
    );
  }

  return (
    <Page title="Accountant Role Centre" crumb={`${org!.name} · as at ${formatDate(today())}`} user={user}>
      <div className="grid g4 stack-2">
        <KpiTile label="Trial balance"
          value={d.kpi.balanced
            ? <span className="pos">In balance</span>
            : <span className="neg">Out by <Money cents={d.kpi.outOfBalanceBy} decimals={0} /></span>}
          foot={<Link href="/accounting/trial-balance">Open trial balance</Link>} accent={!d.kpi.balanced} />
        <KpiTile label="Journals this month" value={d.kpi.journalsThisMonth}
          foot={`${d.kpi.draftJournals} draft`}
          spark={d.journalsByMonth.map((m) => m.journals)} />
        <KpiTile accent={false} label="Aged receivables" value={<Money cents={d.kpi.agedArTotal} short />} />
        <KpiTile accent={false} label="Aged payables" value={<Money cents={d.kpi.agedApTotal} short />} />
      </div>

      <div className="grid split-wide">
        <Card>
          <CardHead title="Journal activity" sub="Journals posted and their value, per month">
            <Link href="/accounting/journals" className="btn sm ghost">Journals</Link>
          </CardHead>
          <MonthTrend months={months} money={false}
            series={[{ name: 'Journals', values: d.journalsByMonth.map((m) => m.journals) }]} area />
        </Card>
        <Card>
          <CardHead title="Postings by source" sub="Which module the ledger entries came from (YTD)" />
          {d.bySource.length ? (
            <MagnitudeBars rows={d.bySource.map((s) => ({ label: s.name, value: s.amount, note: `${s.entries} jnls` }))} />
          ) : <EmptyState icon="📒" title="No journals posted this year" />}
        </Card>
      </div>

      <div className="grid split-narrow">
        <Card>
          <CardHead title="Bank reconciliation status" />
          {d.bankRec.length ? (
            <TableWrap>
              <thead><tr><th>Bank account</th><th className="num">G/L balance</th><th>Last reconciled</th><th>Status</th></tr></thead>
              <tbody>
                {d.bankRec.map((b) => (
                  <tr key={b.name}>
                    <td>{b.name}</td>
                    <td className="num"><Money cents={b.glBalance} decimals={0} /></td>
                    <td>{b.lastReconciled ? formatDate(b.lastReconciled) : '—'}</td>
                    <td><Pill tone={b.status === 'Current' ? 'ok' : b.status === 'Never' ? 'bad' : 'warn'}>{b.status}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          ) : <EmptyState icon="🏦" title="No bank accounts" />}
        </Card>
        <Card>
          <CardHead title="Tax to account for (YTD)" />
          <TableWrap>
            <tbody>
              <tr><td>Recoverable input VAT</td><td className="num"><Money cents={d.tax.vatInput} decimals={0} /></td></tr>
              <tr><td>Withholding tax withheld</td><td className="num"><Money cents={d.tax.whtWithheld} decimals={0} /></td></tr>
            </tbody>
          </TableWrap>
          <p className="note" style={{ marginTop: 12 }}>
            Confirm figures against the KRA returns in Finance → VAT &amp; Withholding Tax before filing.
          </p>
        </Card>
      </div>
    </Page>
  );
}
