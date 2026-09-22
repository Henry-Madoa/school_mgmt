import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import {
  listFinancialReports, listAccScheduleNames, listAccScheduleLines,
  listColumnLayoutNames, listColumnLayoutLines,
} from '@/lib/financialReports';
import { listBudgets } from '@/lib/glBudgets';
import { listGlAccounts } from '@/lib/gl';
import { Page } from '@/components/layout/page';
import {
  Card, CardHead, EmptyState, Pill, Stat, TableWrap, Tabs, Toolbar, Spacer, type TabDefinition,
} from '@/components/ui/primitives';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import {
  FinancialReportButton, DeleteFinancialReportButton,
  AccScheduleNameButton, DeleteAccScheduleNameButton, DuplicateAccScheduleNameButton,
  AccScheduleLineButton, DeleteAccScheduleLineButton,
  ColumnLayoutNameButton, DeleteColumnLayoutNameButton, DuplicateColumnLayoutButton,
  ColumnLayoutLineButton, DeleteColumnLayoutLineButton,
} from '../forms';

const TABS: TabDefinition[] = [
  { key: 'reports', label: 'Reports' },
  { key: 'row-definitions', label: 'Row Definitions' },
  { key: 'column-layouts', label: 'Column Layouts' },
];

export default async function FinancialReportsPage({ params }: { params: Promise<{ tab?: string[] }> }) {
  const user = await requireAction('FINANCIAL_REPORTS_READ');
  const { tab: segments } = await params;
  const tab = segments?.[0] ?? 'reports';
  if (!TABS.some((t) => t.key === tab)) notFound();
  const canManage = await currentCanAction('FINANCIAL_REPORTS_MANAGE');

  return (
    <Page
      title="Financial Reports"
      crumb="Configure and print financial statements from the ledger"
      user={user}
    >
      <Tabs tabs={TABS} active={tab}
        hrefFor={(k) => (k === 'reports' ? '/finance/financial-reports' : `/finance/financial-reports/${k}`)} />
      {tab === 'reports' ? <ReportsTab canManage={canManage} /> : null}
      {tab === 'row-definitions' ? <RowDefinitionsTab canManage={canManage} /> : null}
      {tab === 'column-layouts' ? <ColumnLayoutsTab canManage={canManage} /> : null}
    </Page>
  );
}

async function ReportsTab({ canManage }: { canManage: boolean }) {
  const [reports, rowDefs, layouts] = await Promise.all([
    listFinancialReports(), listAccScheduleNames(), listColumnLayoutNames(),
  ]);

  return (
    <>
      <div className="grid g3 stack-2">
        <Stat small label="Financial reports" value={reports.length} />
        <Stat small label="Row definitions" value={rowDefs.length} />
        <Stat small label="Column layouts" value={layouts.length} />
      </div>
      <Toolbar>
        <span className="tiny muted-cell">
          A report pairs a Row Definition (which accounts roll into which line) with a Column Layout
          (which period each column shows).
        </span>
        <Spacer />
        {canManage ? (
          <FinancialReportButton rowDefs={rowDefs} columnLayouts={layouts}>New report</FinancialReportButton>
        ) : null}
      </Toolbar>
      <Card>
        <CardHead title={`${reports.length} financial reports`} sub="Click Run to print one against a date range" />
        {reports.length ? (
          <TableWrap>
            <thead>
              <tr><th>Name</th><th>Description</th><th>Row definition</th><th>Column layout</th><th className="num" /></tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id}>
                  <td className="mono"><b>{r.name}</b></td>
                  <td>{r.description || '—'}</td>
                  <td className="mono muted-cell">{r.row_group}</td>
                  <td className="mono muted-cell">{r.column_group}</td>
                  <td className="num">
                    <span className="inline" style={{ justifyContent: 'flex-end', gap: 4 }}>
                      <Link className="btn sm" href={`/finance/financial-reports/run/${encodeURIComponent(r.name)}`}>Run</Link>
                      {canManage ? (
                        <>
                          <FinancialReportButton report={r} rowDefs={rowDefs} columnLayouts={layouts} className="btn sm ghost">
                            Edit
                          </FinancialReportButton>
                          <DeleteFinancialReportButton name={r.name} />
                        </>
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="📄" title="No financial reports yet" sub="Create a row definition and a column layout, then pair them here" />}
      </Card>
    </>
  );
}

async function RowDefinitionsTab({ canManage }: { canManage: boolean }) {
  const [defs, layouts, accounts] = await Promise.all([
    listAccScheduleNames(), listColumnLayoutNames(), listGlAccounts(),
  ]);
  const acctProps = accounts.map((a) => ({ code: a.code, name: a.name, account_type: a.account_type }));
  const linesByDef = await Promise.all(defs.map((d) => listAccScheduleLines(d.name)));

  return (
    <>
      <Toolbar>
        <span className="tiny muted-cell">The rows of a report and the accounts or formula behind each.</span>
        <Spacer />
        {canManage ? <AccScheduleNameButton columnLayouts={layouts}>New row definition</AccScheduleNameButton> : null}
      </Toolbar>
      {defs.length ? defs.map((d, i) => {
        const lines = linesByDef[i];
        const rowNos = lines.map((l) => l.row_no);
        return (
          <CollapsibleCard
            key={d.name}
            defaultCollapsed={defs.length > 2}
            title={<><span className="pill mono">{d.name}</span> {d.description}</>}
            sub={`${lines.length} line${lines.length === 1 ? '' : 's'}${d.default_column_layout_name ? ` · default layout ${d.default_column_layout_name}` : ''}`}
          >
            <Toolbar>
              <Spacer />
              {canManage ? (
                <>
                  <AccScheduleNameButton row={d} columnLayouts={layouts} className="btn sm ghost">Edit</AccScheduleNameButton>
                  <DuplicateAccScheduleNameButton name={d.name} />
                  <AccScheduleLineButton scheduleName={d.name} rowNos={rowNos} accounts={acctProps} className="btn sm">Add row</AccScheduleLineButton>
                  <DeleteAccScheduleNameButton name={d.name} />
                </>
              ) : null}
            </Toolbar>
            {lines.length ? (
              <TableWrap>
                <thead>
                  <tr>
                    <th>Row No.</th><th>Description</th><th>Type</th><th>Totaling / formula</th>
                    <th>Row type</th><th>Show</th><th className="num" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td className="mono">{l.row_no}</td>
                      <td style={{ paddingLeft: 8 + l.indentation * 14 }}>
                        <span style={{ fontWeight: l.bold ? 700 : undefined, fontStyle: l.italic ? 'italic' : undefined }}>
                          {l.description || <span className="muted-cell">(caption)</span>}
                        </span>
                      </td>
                      <td className="tiny">{l.totaling_type.replace(/_/g, ' ').toLowerCase()}</td>
                      <td className="mono tiny">{l.totaling || '—'}</td>
                      <td className="tiny">{l.row_type === 'NET_CHANGE' ? '—' : l.row_type.replace(/_/g, ' ').toLowerCase()}</td>
                      <td>{l.show === 'YES' ? '' : <Pill tone="info">{l.show.replace(/_/g, ' ')}</Pill>}</td>
                      <td className="num">
                        {canManage ? (
                          <span className="inline" style={{ gap: 4, justifyContent: 'flex-end' }}>
                            <AccScheduleLineButton scheduleName={d.name} line={l} rowNos={rowNos} accounts={acctProps} className="btn sm ghost">Edit</AccScheduleLineButton>
                            <DeleteAccScheduleLineButton id={l.id} />
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            ) : <EmptyState icon="↔" title="No lines yet" sub="Add the report's first row" />}
          </CollapsibleCard>
        );
      }) : (
        <Card><EmptyState icon="↔" title="No row definitions yet" /></Card>
      )}
    </>
  );
}

async function ColumnLayoutsTab({ canManage }: { canManage: boolean }) {
  const layouts = await listColumnLayoutNames();
  const linesByLayout = await Promise.all(layouts.map((l) => listColumnLayoutLines(l.name)));
  const budgets = (await listBudgets()).map((b) => b.name);

  return (
    <>
      <Toolbar>
        <span className="tiny muted-cell">The columns of a report and the period each one measures.</span>
        <Spacer />
        {canManage ? <ColumnLayoutNameButton>New column layout</ColumnLayoutNameButton> : null}
      </Toolbar>
      {layouts.length ? layouts.map((layout, i) => {
        const cols = linesByLayout[i];
        const colNos = cols.map((c) => c.column_no);
        return (
          <CollapsibleCard
            key={layout.name}
            defaultCollapsed={layouts.length > 2}
            title={<><span className="pill mono">{layout.name}</span> {layout.description}</>}
            sub={`${cols.length} column${cols.length === 1 ? '' : 's'}`}
          >
            <Toolbar>
              <Spacer />
              {canManage ? (
                <>
                  <ColumnLayoutNameButton row={layout} className="btn sm ghost">Edit</ColumnLayoutNameButton>
                  <DuplicateColumnLayoutButton name={layout.name} />
                  <ColumnLayoutLineButton layoutName={layout.name} columnNos={colNos} budgets={budgets} className="btn sm">Add column</ColumnLayoutLineButton>
                  <DeleteColumnLayoutNameButton name={layout.name} />
                </>
              ) : null}
            </Toolbar>
            {cols.length ? (
              <TableWrap>
                <thead>
                  <tr>
                    <th>Column No.</th><th>Header</th><th>Type</th><th>Amount</th>
                    <th>Comparison / formula</th><th>Rounding</th><th className="num" />
                  </tr>
                </thead>
                <tbody>
                  {cols.map((c) => (
                    <tr key={c.id}>
                      <td className="mono">{c.column_no}</td>
                      <td>{c.column_header}</td>
                      <td className="tiny">{c.column_type.replace(/_/g, ' ').toLowerCase()}</td>
                      <td className="tiny">{c.amount_type.replace(/_/g, ' ').toLowerCase()}</td>
                      <td className="mono tiny">{c.column_type === 'FORMULA' ? c.formula : (c.comparison_date_formula || '—')}</td>
                      <td className="tiny">{c.rounding_factor === 'NONE' ? '—' : c.rounding_factor}</td>
                      <td className="num">
                        {canManage ? (
                          <span className="inline" style={{ gap: 4, justifyContent: 'flex-end' }}>
                            <ColumnLayoutLineButton layoutName={layout.name} line={c} columnNos={colNos} budgets={budgets} className="btn sm ghost">Edit</ColumnLayoutLineButton>
                            <DeleteColumnLayoutLineButton id={c.id} />
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            ) : <EmptyState icon="⋮" title="No columns yet" />}
          </CollapsibleCard>
        );
      }) : (
        <Card><EmptyState icon="⋮" title="No column layouts yet" /></Card>
      )}
    </>
  );
}
