import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import {
  getBudget, listBudgets, budgetMatrix, budgetVsActual, listBudgetEntries, defaultBudgetWindow,
  type ViewBy, type ViewAs, type LinesBy, type AccountScope,
} from '@/lib/glBudgets';
import { listPostableAccounts } from '@/lib/gl';
import { listActiveDimensionValues } from '@/lib/pool';
import { getDimensionCaptions } from '@/lib/org';
import { formatDate, today } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { DefinitionList, EmptyState, Pill, TableWrap, Tabs, Toolbar, Spacer, type TabDefinition } from '@/components/ui/primitives';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { EditableCard } from '@/components/ui/editable-card';
import { Money } from '@/components/ui/money';
import { ExportButton } from '@/components/ui/export-button';
import { DocumentActionsMenu } from '@/components/ui/document-actions';
import {
  EditBudgetForm, DeleteBudgetButton, CopyBudgetButton, DeleteEntriesButton, ImportBudgetButton, BudgetOptionsBar, BudgetGrid, NewEntryButton, EntryRow, type BudgetView,
} from '../budget-actions';

const TABS: TabDefinition[] = [{ key: 'budget', label: 'Budget' }, { key: 'entries', label: 'Budget entries' }, { key: 'balance', label: 'G/L Balance / Budget' }];
const oneOf = <T extends string>(v: string | undefined, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);

export default async function BudgetCardPage({ params, searchParams }: {
  params: Promise<{ name: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireAction('GL_BUDGETS_READ');
  const { name: raw } = await params;
  const name = decodeURIComponent(raw);
  const q = await searchParams;
  const budget = await getBudget(name);
  if (!budget) notFound();
  const tab = oneOf(q.tab, ['budget', 'entries', 'balance'] as const, 'budget');
  const win = await defaultBudgetWindow();
  const view: BudgetView = {
    from: /^\d{4}-\d{2}-\d{2}$/.test(q.from ?? '') ? q.from! : win.from,
    to: /^\d{4}-\d{2}-\d{2}$/.test(q.to ?? '') ? q.to! : win.to,
    viewBy: oneOf(q.viewBy, ['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR', 'PERIOD'] as const, 'MONTH'),
    viewAs: oneOf(q.viewAs, ['NET_CHANGE', 'BALANCE_AT_DATE'] as const, 'NET_CHANGE'),
    linesBy: oneOf(q.linesBy, ['ACCOUNT', 'DIM1', 'DIM2'] as const, 'ACCOUNT'),
    scope: oneOf(q.scope, ['INCOME_STATEMENT', 'BALANCE_SHEET', 'ALL'] as const, 'INCOME_STATEMENT'),
    accountFilter: q.accountFilter ?? '',
    dim1: q.dim1 ?? '', dim2: q.dim2 ?? '',
    rounding: oneOf(q.rounding, ['NONE', '1', '1000', '1000000'] as const, 'NONE'),
    showAll: q.showAll === '0' ? '0' : '1',
  };
  const dim1Id = view.dim1 ? Number(view.dim1) : null; const dim2Id = view.dim2 ? Number(view.dim2) : null;
  const [canManage, budgets, captions, dim1, dim2, accounts] = await Promise.all([
    currentCanAction('GL_BUDGETS_MANAGE'), listBudgets(), getDimensionCaptions(), listActiveDimensionValues(1), listActiveDimensionValues(2), listPostableAccounts(),
  ]);
  const dims = { caption1: captions.caption1, caption2: captions.caption2, dim1, dim2 };
  const editable = canManage && !budget.blocked;
  let matrixError: string | null = null;
  const matrix = tab === 'budget' ? await budgetMatrix({
    name, from: view.from, to: view.to, viewBy: view.viewBy as ViewBy, viewAs: view.viewAs as ViewAs, linesBy: view.linesBy as LinesBy,
    scope: view.scope as AccountScope, accountFilter: view.accountFilter, dim1Id, dim2Id, showAll: view.showAll === '1',
  }).catch((e: Error) => { matrixError = e.message; return null; }) : null;
  const entries = tab === 'entries' ? await listBudgetEntries({
    name, from: view.from, to: view.to, accountFilter: view.accountFilter, accountId: q.account ? Number(q.account) : null,
    dim1Id: q.dim1 ? Number(q.dim1) : null, dim2Id: q.dim2 ? Number(q.dim2) : null,
  }) : null;
  const bva = tab === 'balance' ? await budgetVsActual(name, view.from, view.to < today() ? view.to : today(), view.scope as AccountScope, view.accountFilter) : null;
  const keep = new URLSearchParams(Object.entries(q).filter(([k, v]) => v && k !== 'tab' && k !== 'account') as [string, string][]);
  const hrefFor = (k: string) => `/budgets/${encodeURIComponent(name)}?${new URLSearchParams({ ...Object.fromEntries(keep), tab: k })}`;
  const exportParams = { name, from: view.from, to: view.to, viewBy: view.viewBy, scope: view.scope, accountFilter: view.accountFilter || undefined, dim1: view.dim1 || undefined, dim2: view.dim2 || undefined };

  return (
    <Page title={`${budget.name} — G/L Budget`} crumb={budget.description ?? 'A figure per account per period; Financial Reports compare it with the actuals'} user={user}>
      <Toolbar>
        <Link href="/budgets" className="btn ghost sm">← All budgets</Link>
        <Spacer />
        {editable ? <CopyBudgetButton target={name} budgets={budgets.map((b) => b.name)} view={view} dims={dims} /> : null}
        {editable ? <ImportBudgetButton name={name} dims={dims} /> : null}
        <ExportButton href="/api/export/gl-budget" params={exportParams}>Export to Excel</ExportButton>
        {editable ? <DeleteEntriesButton name={name} view={view} dims={dims} /> : null}
        {canManage ? <DeleteBudgetButton name={name} className="btn ghost" /> : null}
        <DocumentActionsMenu />
      </Toolbar>

      <EditableCard collapsible title="Budget" sub="Name, description and whether figures may still change" canEdit={canManage} form={<EditBudgetForm budget={budget} />}
        badge={budget.blocked ? <Pill tone="warn">Blocked</Pill> : <Pill tone="ok">Open</Pill>} defaultCollapsed>
        <DefinitionList items={[
          ['Name', <span className="mono" key="n">{budget.name}</span>],
          ['Description', budget.description ?? '—'],
          ['Covers', budget.first_date ? `${formatDate(budget.first_date)} – ${formatDate(budget.last_date!)}` : 'nothing yet'],
          ['Entries on file', String(budget.entries)],
          ['Financial Reports', 'A column with Ledger Entry Type “Budget entries” naming this budget reads these figures'],
        ]} />
      </EditableCard>

      <CollapsibleCard title="Options & filters" sub="What the matrix shows: the period columns, the lines, and which accounts and dimensions count">
        <BudgetOptionsBar view={view} dims={dims} />
      </CollapsibleCard>

      <Tabs tabs={TABS} active={tab} hrefFor={hrefFor} />

      {tab === 'budget' ? (
        <CollapsibleCard title={`${formatDate(view.from)} – ${formatDate(view.to)} · by ${view.viewBy.toLowerCase().replace('period', 'accounting period')}`}
          sub={matrix?.editable && editable ? 'Type a figure and leave the cell to save it — the period’s entries for that account are replaced by one. Income and expenses are entered as positive amounts.'
            : matrix && !matrix.editable ? 'Read only in this view — lines by dimension and balance-at-date show the figures; edit them with lines by G/L account and net change, or on the Budget entries tab.' : budget.blocked ? 'Blocked — read only' : 'Read only'}>
          {matrixError ? <EmptyState icon="⚠" title="The view cannot be built" sub={matrixError} />
            : matrix && matrix.rows.length ? <BudgetGrid key={`${name}|${JSON.stringify(view)}`} matrix={matrix} editable={!!(matrix.editable && editable)} rounding={view.rounding} dims={{ dim1Id, dim2Id }} />
              : <EmptyState icon="📄" title="No lines" sub="No accounts match the filters, or nothing is budgeted and “Only lines with figures” is on." />}
        </CollapsibleCard>
      ) : null}

      {entries ? (
        <CollapsibleCard title={`Budget entries — ${entries.length}${entries.length >= 2000 ? '+' : ''}`} sub={`${formatDate(view.from)} – ${formatDate(view.to)}${q.account ? ' · one account' : ''}${view.accountFilter ? ` · accounts ${view.accountFilter}` : ''}`}
          actions={editable ? <NewEntryButton name={name} accounts={accounts} dims={dims} dateDefault={view.from} /> : undefined}>
          {entries.length ? (
            <TableWrap>
              <thead><tr><th>Date</th><th>G/L account</th><th>Description</th><th>{captions.caption1}</th><th>{captions.caption2}</th><th className="num">Amount</th><th>By</th><th className="num" /></tr></thead>
              <tbody>{entries.map((e) => <EntryRow key={e.id} name={name} entry={e} accounts={accounts} dims={dims} canEdit={editable} />)}</tbody>
              <tfoot><tr><th colSpan={5}>Total</th><th className="num"><Money cents={entries.reduce((s, e) => s + Number(e.amount), 0)} /></th><th colSpan={2} /></tr></tfoot>
            </TableWrap>
          ) : <EmptyState icon="📄" title="No budget entries in this window" sub="Type figures on the Budget tab, add an entry, copy another budget or import from Excel." />}
        </CollapsibleCard>
      ) : null}

      {bva ? (
        <CollapsibleCard title={`G/L Balance / Budget — ${formatDate(bva.from)} to ${formatDate(bva.to)}`} sub="Actual net change against the budget; variance is favourable when positive (income above, expenses below)">
          <div className="grid g3 stack-2">
            <DefinitionList items={[['Income — budget', <Money cents={bva.totals.income.budget} key="ib" />], ['Income — actual', <Money cents={bva.totals.income.actual} key="ia" />]]} />
            <DefinitionList items={[['Expenses — budget', <Money cents={bva.totals.expense.budget} key="eb" />], ['Expenses — actual', <Money cents={bva.totals.expense.actual} key="ea" />]]} />
            <DefinitionList items={[['Surplus — budget', <Money cents={bva.totals.surplus.budget} key="sb" />], ['Surplus — actual', <b key="sa" className={bva.totals.surplus.actual < bva.totals.surplus.budget ? 'neg' : undefined}><Money cents={bva.totals.surplus.actual} /></b>]]} />
          </div>
          {bva.rows.length ? (
            <TableWrap>
              <thead><tr><th>Account</th><th>Type</th><th className="num">Budget</th><th className="num">Actual</th><th className="num">Variance</th><th className="num">%</th><th className="num">Budget used</th></tr></thead>
              <tbody>
                {bva.rows.map((r) => (
                  <tr key={r.code}>
                    <td><span className="mono">{r.code}</span> {r.name}</td><td>{r.type.charAt(0) + r.type.slice(1).toLowerCase()}</td>
                    <td className="num"><Money cents={r.budget} /></td><td className="num"><Money cents={r.actual} /></td>
                    <td className={`num ${r.variance < 0 ? 'neg' : ''}`}><Money cents={r.variance} /></td>
                    <td className="num">{r.variance_pct == null ? '—' : `${r.variance_pct.toFixed(1)}%`}</td>
                    <td className="num">{r.budget ? `${((r.actual / r.budget) * 100).toFixed(0)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          ) : <EmptyState icon="📄" title="Nothing budgeted or posted in this window" />}
        </CollapsibleCard>
      ) : null}
    </Page>
  );
}
