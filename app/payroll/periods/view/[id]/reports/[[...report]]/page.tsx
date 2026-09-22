import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction } from '@/lib/session';
import { getPayrollPeriod } from '@/lib/payroll';
import { buildPayrollReport, getReportFilterOptions, parseReportFilters, reportFilterQuery, PAYROLL_REPORT_KEYS, PAYROLL_REPORT_LABELS, PAYROLL_REPORT_SIGNATORIES, type PayrollReportKey, type ReportColumn } from '@/lib/payrollReports';
import { ReportFilterBar } from '@/app/payroll/periods/report-filters';
import { Page } from '@/components/layout/page';
import { Card, CardHead, EmptyState, TableWrap, Tabs, Toolbar, Spacer, Pill, type TabDefinition } from '@/components/ui/primitives';
import { Money } from '@/components/ui/money';
import { ExportButton } from '@/components/ui/export-button';

const TABS: TabDefinition[] = PAYROLL_REPORT_KEYS.map((key) => ({ key, label: PAYROLL_REPORT_LABELS[key] }));

/** The Excel exports that predate the AL report set, kept where a report still matches one. */
const EXPORTS: Partial<Record<PayrollReportKey, { href: string; params: Record<string, string> }>> = {
  summary: { href: '/api/export/payroll-register', params: {} },
  company: { href: '/api/export/payroll-company-summary', params: {} },
  'net-pay': { href: '/api/export/payroll-net-pay', params: {} },
  deductions: { href: '/api/export/payroll-deductions', params: {} },
  paye: { href: '/api/export/payroll-statutory', params: { kind: 'paye' } },
  nssf: { href: '/api/export/payroll-statutory', params: { kind: 'nssf' } },
  shif: { href: '/api/export/payroll-statutory', params: { kind: 'shif' } },
  'housing-levy': { href: '/api/export/payroll-statutory', params: { kind: 'housing-levy' } },
};

/** Reports read off the period transactions, where a single transaction code is a meaningful filter. */
const LINE_REPORTS: PayrollReportKey[] = ['allowances', 'deductions', 'company-deductions', 'company', 'costing'];

export default async function PayrollReportsPage({ params, searchParams }: { params: Promise<{ id: string; report?: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireAction('PAYROLL_PERIODS_READ');
  const { id: idParam, report: segments } = await params;
  const filters = parseReportFilters(await searchParams);
  const query = reportFilterQuery(filters);
  const periodId = Number(idParam);

  const period = await getPayrollPeriod(periodId);
  if (!period) notFound();

  const requested = segments?.[0];
  if (requested && !PAYROLL_REPORT_KEYS.includes(requested as PayrollReportKey)) notFound();
  const key = (requested ?? 'summary') as PayrollReportKey;
  const [report, options] = await Promise.all([buildPayrollReport(periodId, key, filters), getReportFilterOptions(periodId)]);
  const exp = EXPORTS[key];

  const cell = (c: ReportColumn, v: string | number | null) => {
    if (v == null || v === '') return '';
    if (c.kind === 'money') return <Money cents={Number(v)} />;
    return String(v);
  };
  const hasTotals = Object.keys(report.totals).length > 0;
  const firstTextCol = report.columns.find((c) => !c.sum)?.key ?? report.columns[0].key;

  return (
    <Page title={`${period.period_name} — Reports`} crumb="Payroll reports — the standard payroll report set, each printable" user={user}>
      <Toolbar>
        <Link href={`/payroll/periods/view/${periodId}`} className="btn ghost sm">← Back to period</Link>
        <Spacer />
        <a className="btn sm" href={`/print/payroll-report/${periodId}-${key}${query}`} target="_blank" rel="noreferrer">Print / Save as PDF</a>
        {exp ? <ExportButton href={exp.href} params={{ period: String(periodId), ...exp.params }} disabled={!report.rows.length}>Export to Excel</ExportButton> : null}
      </Toolbar>
      <Tabs tabs={TABS} active={key} hrefFor={(k) => `/payroll/periods/view/${periodId}/reports/${k}${query}`} />
      <ReportFilterBar baseHref={`/payroll/periods/view/${periodId}/reports/${key}`} filters={filters} options={options} showCode={LINE_REPORTS.includes(key)} />

      <Card>
        <CardHead title={<>{report.title} <Pill status={period.status} /></>} sub={`${report.forLabel} : ${period.period_name} · ${report.employees} employee${report.employees === 1 ? '' : 's'} processed`} />
        {report.appliedFilters || report.meta.length ? (
          <div className="inline" style={{ flexWrap: 'wrap', gap: '6px 22px', marginBottom: 10 }}>
            {report.appliedFilters ? <span className="tiny"><b>Applied Filters:</b> {report.appliedFilters}</span> : null}
            {report.meta.map((m) => <span key={m.label} className="tiny"><b>{m.label}:</b> {m.value}</span>)}
          </div>
        ) : null}
        {report.rows.length ? (
          <TableWrap sortable={!report.grouped}>
            <thead>
              <tr>
                {report.columns.map((c) => <th key={c.key} className={c.kind === 'money' || c.kind === 'int' ? 'num' : undefined} style={c.width ? { width: c.width } : undefined}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r, i) => r.kind === 'group' ? (
                <tr key={i} className="muted-row" data-nosort>
                  <td colSpan={report.columns.length}><b>{report.columns.map((c) => r.cells[c.key]).filter((v) => v != null && v !== '').join(' — ')}</b></td>
                </tr>
              ) : (
                <tr key={i} className={r.kind === 'subtotal' ? 'subtotal-row' : undefined} data-nosort={r.kind === 'subtotal' ? '' : undefined}>
                  {report.columns.map((c) => (
                    <td key={c.key} className={[c.kind === 'money' || c.kind === 'int' ? 'num' : '', c.key === 'emp_no' ? 'mono' : ''].filter(Boolean).join(' ') || undefined}>
                      {r.kind === 'subtotal' ? <b>{cell(c, r.cells[c.key] ?? null)}</b> : cell(c, r.cells[c.key] ?? null)}
                    </td>
                  ))}
                </tr>
              ))}
              {hasTotals ? (
                <tr className="total-row" data-nosort>
                  {report.columns.map((c) => (
                    <td key={c.key} className={c.kind === 'money' || c.kind === 'int' ? 'num' : undefined}>
                      {c.key === firstTextCol ? <b>Totals</b> : report.totals[c.key] != null ? <b><Money cents={report.totals[c.key]} /></b> : ''}
                    </td>
                  ))}
                </tr>
              ) : null}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🧾" title="Nothing to report" sub={report.appliedFilters ? 'Nothing matches the filters — clear them to see the whole period.' : 'No employees were processed in this period yet — run payroll first.'} />}
        <div className="tiny" style={{ marginTop: 10 }}>
          Printout signatories: {PAYROLL_REPORT_SIGNATORIES.map((s) => `${s.label} (${s.position})`).join(' · ')}
        </div>
      </Card>
    </Page>
  );
}
