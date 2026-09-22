import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction } from '@/lib/session';
import { getOrgBrand, getDimensionCaptions } from '@/lib/org';
import { getFinancialReport, listColumnLayoutNames, runFinancialReport } from '@/lib/financialReports';
import { TRIAL_BALANCE_DIMENSION_FILTER_FIELDS } from '@/lib/gl';
import { parseFilters } from '@/lib/listFilters';
import { formatDate, today } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { Card, CardHead, EmptyState, Pill, Stat, Toolbar, Spacer } from '@/components/ui/primitives';
import { DateFilterExpressionInput } from '@/components/ui/filters';
import { DynamicFilterBar } from '@/components/ui/dynamic-filter';
import { Money } from '@/components/ui/money';
import { ExportButton } from '@/components/ui/export-button';
import { QuerySelect } from '../../forms';

export default async function RunFinancialReportPage({ params, searchParams }: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ from?: string; to?: string; columnGroup?: string; filters?: string }>;
}) {
  const user = await requireAction('FINANCIAL_REPORTS_READ');
  const { name: rawName } = await params;
  const name = decodeURIComponent(rawName);
  const { from, to, columnGroup, filters: filtersRaw } = await searchParams;

  const report = await getFinancialReport(name);
  if (!report) notFound();

  const filters = parseFilters(filtersRaw);
  const [brand, { caption1, caption2 }, layouts, result] = await Promise.all([
    getOrgBrand(),
    getDimensionCaptions(),
    listColumnLayoutNames(),
    runFinancialReport({
      reportName: name,
      columnGroup: columnGroup || undefined,
      from: from || null,
      to: to || null,
      filters,
    }),
  ]);
  const org = brand!;
  const visibleRows = result.rows.filter((r) => !r.hidden);
  const dimensioned = filters.some((f) => (f.field === 'gd1_filter' || f.field === 'gd2_filter') && f.value !== '');

  const dimensionFields = TRIAL_BALANCE_DIMENSION_FILTER_FIELDS.map((f) => (
    f.key === 'gd1_filter' ? { ...f, label: caption1 } : f.key === 'gd2_filter' ? { ...f, label: caption2 } : f
  ));

  // A single-column report with formula/ratio total rows reads best as a KPI strip.
  const kpiRows = result.columns.length === 1
    ? visibleRows.filter((r) => (r.isRatio || r.bold) && r.cells[0]?.value != null)
    : [];

  return (
    <Page
      title={report.name}
      crumb={report.description || 'Financial report'}
      user={user}
    >
      <Toolbar>
        <Link href="/finance/financial-reports" className="btn sm ghost">← All reports</Link>
        <DateFilterExpressionInput fromParam="from" toParam="to"
          placeholder="Date filter — e.g. 01/01/26..31/12/26 or ..T" />
        <QuerySelect
          param="columnGroup"
          value={columnGroup || report.column_group}
          ariaLabel="Column layout"
          options={layouts.map((l) => ({ value: l.name, label: `Columns: ${l.name}` }))}
        />
        <DynamicFilterBar fields={dimensionFields} />
        <Spacer />
        <ExportButton
          href="/api/export/financial-report"
          params={{ report: name, columnGroup, from, to, filters: filtersRaw }}
        />
      </Toolbar>

      {kpiRows.length ? (
        <div className="grid g3 stack-2">
          {kpiRows.slice(0, 6).map((r) => (
            <Stat
              key={r.rowNo}
              small
              label={r.description}
              value={r.isRatio
                ? `${(r.cells[0].value ?? 0).toFixed(2)}%`
                : <Money cents={Math.round(r.cells[0].value ?? 0)} decimals={0} />}
            />
          ))}
        </div>
      ) : null}

      <Card>
        <CardHead
          title={report.description || report.name}
          sub={`${org.name} · ${result.from ? `${formatDate(result.from)} – ${formatDate(result.to)}` : `as at ${formatDate(result.to || today())}`} · row def ${result.rowGroup} · columns ${result.columnGroup} · amounts in ${org.currency_code}`}
        >
          {dimensioned ? <Pill tone="info">DIMENSIONAL</Pill> : null}
        </CardHead>

        {visibleRows.length ? (
          <div className="report-body" style={{ maxWidth: result.columns.length > 1 ? '100%' : 760 }}>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th />
                    {result.columns.map((c) => (
                      <th key={c.columnNo} className="num" title={c.windowLabel}>{c.header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((r) => {
                    const style: React.CSSProperties = {
                      fontWeight: r.bold ? 700 : undefined,
                      fontStyle: r.italic ? 'italic' : undefined,
                      borderBottom: r.doubleUnderline ? '3px double currentColor' : r.underline ? '1px solid currentColor' : undefined,
                    };
                    return (
                      <tr key={r.rowNo}>
                        <td style={{ ...style, paddingLeft: 4 + r.indentation * 16 }}>
                          {r.totaling ? (
                            <Link
                              href={`/accounting/trial-balance?filters=${encodeURIComponent(JSON.stringify([{ field: 'code', operator: 'BETWEEN', value: firstOf(r.totaling), value2: lastOf(r.totaling) }]))}${result.from ? `&from=${result.from}` : ''}&asOf=${result.to}`}
                              title="Open the matching accounts in the Trial Balance"
                            >
                              {r.description}
                            </Link>
                          ) : r.description}
                        </td>
                        {r.cells.map((cell, i) => (
                          <td key={i} className="num" style={style}>
                            {cell.value == null
                              ? ''
                              : cell.isRatio
                                ? `${cell.value.toFixed(2)}%`
                                : <Money cents={Math.round(cell.value)} symbol={false} />}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="note" style={{ marginTop: 14 }}>
              Confirm the account mapping, ratio thresholds and return format against the regulator&apos;s
              current published requirements before filing. Edit the row definition and column layout under
              the Row Definitions / Column Layouts tabs.
            </p>
          </div>
        ) : <EmptyState icon="📄" title="Every row is hidden or zero for this period" />}
      </Card>
    </Page>
  );
}

/** First / last account code of an "A..B|C" totaling filter, for the drill-down date+code link. */
function firstOf(totaling: string): string {
  const term = totaling.split('|')[0].trim();
  return term.split('..')[0].trim();
}
function lastOf(totaling: string): string {
  const terms = totaling.split('|').map((t) => t.trim());
  const last = terms[terms.length - 1];
  const parts = last.split('..');
  return (parts[1] ?? parts[0]).trim();
}
