import { notFound } from 'next/navigation';
import { requireAction } from '@/lib/session';
import { getOrgBrand, getDimensionCaptions } from '@/lib/org';
import { getBalanceSheet, getIncomeStatement } from '@/lib/reports';
import { TRIAL_BALANCE_FILTER_FIELDS, TRIAL_BALANCE_DIMENSION_FILTER_FIELDS } from '@/lib/gl';
import { formatDate, today, startOfYear } from '@/lib/format';
import { parseFilters, type FilterFieldDef } from '@/lib/listFilters';
import { Page } from '@/components/layout/page';
import {
  Card, CardHead, EmptyState, Pill, Stat, TableWrap, Tabs, Toolbar, type TabDefinition,
} from '@/components/ui/primitives';
import { DateFilterExpressionInput } from '@/components/ui/filters';
import { DynamicFilterBar } from '@/components/ui/dynamic-filter';
import { Money } from '@/components/ui/money';
import { DocumentActionsMenu } from '@/components/ui/document-actions';
import { CompositionBars } from '../composition-charts';
import type { ReportLine } from '@/lib/types';

const TABS: TabDefinition[] = [
  { key: 'balance-sheet', label: 'Statement of financial position' },
  { key: 'income', label: 'Statement of comprehensive income' },
];

export default async function ReportsPage({ params, searchParams }: {
  params: Promise<{ tab?: string[] }>;
  searchParams: Promise<{ filters?: string; asOf?: string; from?: string; to?: string }>;
}) {
  const user = await requireAction('REPORTS_VIEW');
  const { tab: segments } = await params;
  const { filters: filtersRaw, asOf, from, to } = await searchParams;
  const tab = segments?.[0] ?? 'balance-sheet';
  if (!TABS.some((t) => t.key === tab)) notFound();

  return (
    <Page
      title="Reports"
      crumb="Financial statements from controlled ledger data"
      user={user}
    >
      <Tabs tabs={TABS} active={tab} hrefFor={(k) => `/reports/${k}`} />
      {tab === 'balance-sheet' ? <BalanceSheetTab filtersRaw={filtersRaw} asOf={asOf} from={from} /> : null}
      {tab === 'income' ? <IncomeTab filtersRaw={filtersRaw} from={from} to={to} /> : null}
    </Page>
  );
}

/** Both statements' own filter bar — Code/Name/Type plus the Dimensional filter, same registry
 *  Trial Balance uses, labelled with the org's actual dimension captions. */
const dimensionedFields = (caption1: string, caption2: string): FilterFieldDef[] => [
  ...TRIAL_BALANCE_FILTER_FIELDS,
  ...TRIAL_BALANCE_DIMENSION_FILTER_FIELDS.map((f) => (
    f.key === 'gd1_filter' ? { ...f, label: caption1 } : f.key === 'gd2_filter' ? { ...f, label: caption2 } : f
  )),
];

/** A labelled block of report lines with its own subtotal. */
function Section({ label, lines, total }: { label: string; lines: ReportLine[]; total: number }) {
  return (
    <>
      <tr className="section"><td colSpan={2}><b>{label}</b></td></tr>
      {lines.filter((r) => r.amount !== 0).map((r) => (
        <tr className="indent" key={r.code}>
          <td><span className="mono muted-cell">{r.code}</span> {r.name}</td>
          <td className="num"><Money cents={r.amount} symbol={false} /></td>
        </tr>
      ))}
      <tr className="indent subtotal">
        <td><b>Total {label.toLowerCase()}</b></td>
        <td className="num"><b><Money cents={total} symbol={false} /></b></td>
      </tr>
    </>
  );
}

async function BalanceSheetTab({ filtersRaw, asOf, from }: { filtersRaw?: string; asOf?: string; from?: string }) {
  const filters = parseFilters(filtersRaw);
  const [brand, d, { caption1, caption2 }] = await Promise.all([
    getOrgBrand(),
    getBalanceSheet({ from: from || null, asOf: asOf || null, filters }),
    getDimensionCaptions(),
  ]);
  const org = brand!;
  const dimensioned = filters.some((f) => (f.field === 'gd1_filter' || f.field === 'gd2_filter') && f.value !== '');

  return (
    <>
      <Toolbar>
        <DynamicFilterBar fields={dimensionedFields(caption1, caption2)} />
        <DateFilterExpressionInput fromParam="from" toParam="asOf" placeholder="Date filter — e.g. 01/01/26..31/12/26 or ..T" />
      </Toolbar>
      <Card>
      <CardHead
        title="Statement of financial position"
        sub={`${org.name} · ${from ? `net change ${formatDate(from)} to ${asOf ? formatDate(asOf) : 'date'}` : `as at ${formatDate(asOf || today())}`} · amounts in ${org.currency_code}`}
      >
        {dimensioned ? <Pill tone="info">DIMENSIONAL</Pill> : null}
        <DocumentActionsMenu
          className="btn ghost sm"
          excel={{ href: '/api/export/balance-sheet', params: { asOf, from, filters: filtersRaw } }}
        />
      </CardHead>
      <div className="report-body">
        <table>
          <tbody>
            <Section label="Assets" lines={d.assets} total={d.totals.assets} />
            <Section label="Liabilities" lines={d.liabilities} total={d.totals.liabilities} />
            <Section label="Capital and reserves" lines={d.equity} total={d.totals.equity} />
            <tr className="indent">
              <td>Surplus for the period</td>
              <td className="num"><Money cents={d.surplus} symbol={false} /></td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td><b>Total equity and liabilities</b></td>
              <td className="num"><b><Money cents={d.totals.equityAndLiabilities} symbol={false} /></b></td>
            </tr>
          </tfoot>
        </table>
        <div style={{ marginTop: 14 }}>
          <Pill tone={d.balanced ? 'ok' : 'bad'}>
            {d.balanced
              ? 'Assets equal equity and liabilities'
              : <>Out of balance by <Money cents={d.totals.assets - d.totals.equityAndLiabilities} /></>}
          </Pill>
        </div>
      </div>
    </Card>
    </>
  );
}

async function IncomeTab({ filtersRaw, from: fromParam, to: toParam }: {
  filtersRaw?: string; from?: string; to?: string;
}) {
  const from = fromParam || startOfYear();
  const to = toParam || today();
  const filters = parseFilters(filtersRaw);
  const [brand, d, { caption1, caption2 }] = await Promise.all([
    getOrgBrand(), getIncomeStatement({ from, to, filters }), getDimensionCaptions(),
  ]);
  const org = brand!;
  const dimensioned = filters.some((f) => (f.field === 'gd1_filter' || f.field === 'gd2_filter') && f.value !== '');

  return (
    <>
      <Toolbar>
        <DynamicFilterBar fields={dimensionedFields(caption1, caption2)} />
        <DateFilterExpressionInput placeholder="Date filter — e.g. 01/01/26..31/12/26 or ..T" />
      </Toolbar>
      <Card>
      <CardHead
        title="Statement of comprehensive income"
        sub={`${org.name} · ${formatDate(from)} to ${formatDate(to)}`}
      >
        {dimensioned ? <Pill tone="info">DIMENSIONAL</Pill> : null}
        <DocumentActionsMenu
          className="btn ghost sm"
          excel={{ href: '/api/export/income', params: { from, to, filters: filtersRaw } }}
        />
      </CardHead>
      <div className="grid g2">
        <div style={{ maxWidth: 560 }}>
          <table>
            <tbody>
              <Section label="Income" lines={d.income} total={d.totalIncome} />
              <Section label="Expenditure" lines={d.expense} total={d.totalExpense} />
            </tbody>
            <tfoot>
              <tr>
                <td><b>Surplus for the period</b></td>
                <td className="num"><b><Money cents={d.surplus} symbol={false} /></b></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div>
          <h4 className="metric-label" style={{ marginBottom: 10 }}>Income composition</h4>
          {d.income.some((r) => r.amount > 0)
            ? <CompositionBars lines={d.income} total={d.totalIncome} />
            : <EmptyState icon="📊" title="No income recorded in this period" />}

          <h4 className="metric-label" style={{ margin: '20px 0 10px' }}>Expenditure composition</h4>
          {d.expense.some((r) => r.amount > 0)
            ? <CompositionBars lines={d.expense} total={d.totalExpense} color="var(--series-2)" />
            : <EmptyState icon="📊" title="No expenditure recorded" />}
        </div>
      </div>
    </Card>
    </>
  );
}
