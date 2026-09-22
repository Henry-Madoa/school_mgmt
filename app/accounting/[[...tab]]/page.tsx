import { notFound } from 'next/navigation';
import { requireAction, currentCanAction, getCurrentUser, requireModuleTab } from '@/lib/session';
import { getWorkDate } from '@/lib/postingDates';
import Link from 'next/link';
import {
  getTrialBalance, listJournals, hasAnyJournals, listGlAccounts, hasAnyGlAccounts, listPeriods, hasAnyPeriods,
  listPostableAccounts, totalingBalance,
  JOURNAL_FILTER_FIELDS, GL_ACCOUNT_FILTER_FIELDS, TRIAL_BALANCE_FILTER_FIELDS, TRIAL_BALANCE_DIMENSION_FILTER_FIELDS,
  PERIOD_FILTER_FIELDS,
} from '@/lib/gl';
import { GL_ACCOUNT_STRUCTURE_TYPES } from '@/lib/constants';
import { listActiveDimensionValues } from '@/lib/pool';
import { getDimensionCaptions } from '@/lib/org';
import { formatDate, today } from '@/lib/format';
import { parseFilters } from '@/lib/listFilters';
import { parseSort } from '@/lib/listSort';
import { Page } from '@/components/layout/page';
import {
  Card, CardHead, EmptyState, Pill, TableWrap, Tabs, Toolbar, Spacer, type TabDefinition,
} from '@/components/ui/primitives';
import { SearchInput, DateFilterInput, DateFilterExpressionInput } from '@/components/ui/filters';
import { DynamicFilterBar } from '@/components/ui/dynamic-filter';
import { SortLink } from '@/components/ui/sort-link';
import { Money } from '@/components/ui/money';
import { ExportButton } from '@/components/ui/export-button';
import { LedgerLink, JournalLink } from '../drill-downs';
import { NewJournalButton } from '../journal-form';
import { GlAccountFormButton } from '../gl-account-form';
import { IndentAccountsButton } from '../indent-accounts-button';
import { PeriodToggle } from '../period-toggle';
import { CloseYearButton, CreateFiscalYearButton } from '../fiscal-year-actions';
import { CloseIncomeStatementScreen } from '../close-income-statement';
import { listFiscalYears } from '@/lib/gl';
import { getCloseIncomeStatementContext } from '@/lib/closeIncomeStatement';

/** Each tab is a page of its own (lib/permissions.ts PAGES, parent GL), so a permission
 *  set can open this module and still be kept out of particular screens. */
const TAB_PAGE: Record<string, string> = {
  'trial-balance': 'GL_TRIAL_BALANCE',
  journals: 'GL_JOURNALS',
  accounts: 'GL_ACCOUNTS',
  periods: 'GL_PERIODS',
  'close-income-statement': 'GL_CLOSE_INCOME_STATEMENT',
};

const TABS: TabDefinition[] = [
  { key: 'trial-balance', label: 'Trial balance' },
  { key: 'journals', label: 'Journals' },
  { key: 'accounts', label: 'Chart of accounts' },
  { key: 'periods', label: 'Accounting periods' },
  { key: 'close-income-statement', label: 'Close Income Statement' },
];

export default async function AccountingPage({ params, searchParams }: {
  params: Promise<{ tab?: string[] }>;
  searchParams: Promise<{
    q?: string; filters?: string; sort?: string; asOf?: string; from?: string; to?: string;
  }>;
}) {
  const user = await requireAction('GL_READ');
  const { tab: segments } = await params;
  const { q = '', filters: filtersRaw, sort: sortRaw, asOf, from, to } = await searchParams;
  const tab = segments?.[0] ?? 'trial-balance';
  if (!TABS.some((t) => t.key === tab)) notFound();
  const hrefFor = (k: string) => `/accounting/${k}`;
  const tabs = requireModuleTab(user, TABS, TAB_PAGE, tab, !segments?.[0], hrefFor);

  return (
    <Page
      title="General Ledger"
      crumb="Financial system of record — every module posts here"
      user={user}
    >
      <Tabs tabs={tabs} active={tab} hrefFor={hrefFor} />
      {tab === 'trial-balance' ? <TrialBalanceTab filtersRaw={filtersRaw} asOf={asOf} from={from} /> : null}
      {tab === 'journals' ? <JournalsTab search={q} filtersRaw={filtersRaw} sortRaw={sortRaw} /> : null}
      {tab === 'accounts' ? <AccountsTab search={q} filtersRaw={filtersRaw} sortRaw={sortRaw} asOf={asOf} from={from} /> : null}
      {tab === 'periods' ? <PeriodsTab search={q} filtersRaw={filtersRaw} sortRaw={sortRaw} /> : null}
      {tab === 'close-income-statement' ? <CloseIncomeStatementTab /> : null}
    </Page>
  );
}

/** Dimensional filter fields — a Business-Central "FIN|NBI" combination/range expression per
 *  dimension (see TRIAL_BALANCE_DIMENSION_FILTER_FIELDS), labelled with the org's own captions.
 *  Shared by every screen that offers it: Trial Balance and Chart of Accounts. */
const dimensionalFields = (caption1: string, caption2: string) => TRIAL_BALANCE_DIMENSION_FILTER_FIELDS.map((f) => (
  f.key === 'gd1_filter' ? { ...f, label: caption1 } : f.key === 'gd2_filter' ? { ...f, label: caption2 } : f
));

async function TrialBalanceTab({ filtersRaw, asOf, from }: { filtersRaw?: string; asOf?: string; from?: string }) {
  const filters = parseFilters(filtersRaw);
  const [{ rows, totals, balanced }, empty, { caption1, caption2 }] = await Promise.all([
    getTrialBalance({ from: from || null, asOf: asOf || null, filters }),
    hasAnyGlAccounts().then((any) => !any),
    getDimensionCaptions(),
  ]);
  const tbFields = [...TRIAL_BALANCE_FILTER_FIELDS, ...dimensionalFields(caption1, caption2)];
  const dimensioned = filters.some((f) => (f.field === 'gd1_filter' || f.field === 'gd2_filter') && f.value !== '');

  return (
    <>
      <Toolbar>
        <DynamicFilterBar fields={tbFields} disabled={empty} />
        <DateFilterExpressionInput placeholder="Date filter — e.g. 01/01/26..31/12/26 or ..T" disabled={empty} />
        <Spacer />
        <ExportButton
          href="/api/export/trial-balance" params={{ filters: filtersRaw, asOf, from }} disabled={!rows.length}
        />
      </Toolbar>
      <Card>
      <CardHead
        title="Trial balance"
        sub={`Derived from posted journal lines, not from stored balances — click a balance to drill into its entries${
          from ? `. Net change ${formatDate(from)} to ${asOf ? formatDate(asOf) : 'date'}` : ''}`}
      >
        {dimensioned ? <Pill tone="info">DIMENSIONAL</Pill> : null}
        <Pill tone={balanced ? 'ok' : 'bad'}>{balanced ? 'IN BALANCE' : 'OUT OF BALANCE'}</Pill>
      </CardHead>
      {rows.length ? (
        <TableWrap>
          <thead>
            <tr>
              <th>Code</th><th>Account</th><th>Type</th>
              <th className="num">Debits</th><th className="num">Credits</th>
              <th className="num">Debit balance</th><th className="num">Credit balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.code}</td>
                <td>{r.name}</td>
                <td className="tiny">{r.type}</td>
                <td className="num"><Money cents={r.debit} symbol={false} decimals={0} /></td>
                <td className="num"><Money cents={r.credit} symbol={false} decimals={0} /></td>
                <td className="num">
                  <b>{r.debit_balance ? (
                    <LedgerLink code={r.code} caption1={caption1} caption2={caption2}>
                      <Money cents={r.debit_balance} symbol={false} />
                    </LedgerLink>
                  ) : ''}</b>
                </td>
                <td className="num">
                  <b>{r.credit_balance ? (
                    <LedgerLink code={r.code} caption1={caption1} caption2={caption2}>
                      <Money cents={r.credit_balance} symbol={false} />
                    </LedgerLink>
                  ) : ''}</b>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5}>Totals</td>
              <td className="num"><Money cents={totals.debit} symbol={false} /></td>
              <td className="num"><Money cents={totals.credit} symbol={false} /></td>
            </tr>
          </tfoot>
        </TableWrap>
      ) : <EmptyState icon="⚖" title="No accounts match" sub="Try a different filter or as-of date" />}
    </Card>
    </>
  );
}

async function JournalsTab({ search, filtersRaw, sortRaw }: { search: string; filtersRaw?: string; sortRaw?: string }) {
  const filters = parseFilters(filtersRaw);
  const sort = parseSort(sortRaw);
  const [rows, empty, canCreate, canReverse, postableAccounts, gd1Values, gd2Values, { caption1, caption2 }, workDate] =
    await Promise.all([
      listJournals({ search, filters, sort }),
      hasAnyJournals().then((any) => !any),
      currentCanAction('GL_JOURNAL_CREATE'), currentCanAction('GL_JOURNAL_REVERSE'),
      listPostableAccounts(),
      listActiveDimensionValues(1), listActiveDimensionValues(2), getDimensionCaptions(),
      getCurrentUser().then((u) => (u ? getWorkDate(u.id) : today())),
    ]);
  const journalFields = JOURNAL_FILTER_FIELDS.map((f) => (
    f.key === 'global_dimension_1_id' ? { ...f, label: caption1, options: gd1Values.map((d) => ({ value: d.id, label: `${d.code} — ${d.name}` })) }
      : f.key === 'global_dimension_2_id' ? { ...f, label: caption2, options: gd2Values.map((d) => ({ value: d.id, label: `${d.code} — ${d.name}` })) }
        : f
  ));

  return (
    <>
      <Toolbar>
        <SearchInput placeholder="Search journal number, description or reference…" disabled={empty} />
        <DynamicFilterBar fields={journalFields} disabled={empty} />
        <Spacer />
        <ExportButton href="/api/export/journal" params={{ q: search, filters: filtersRaw, sort: sortRaw }} disabled={!rows.length} />
        {canCreate ? (
          <NewJournalButton
            accounts={postableAccounts}
            globalDimension1Values={gd1Values}
            globalDimension2Values={gd2Values}
            caption1={caption1}
            caption2={caption2}
            workDate={workDate}
          />
        ) : null}
      </Toolbar>
      <Card>
        {rows.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th><SortLink sortKey="journal_no">Journal</SortLink></th>
                <th><SortLink sortKey="reference">Document No.</SortLink></th>
                <th><SortLink sortKey="value_date">Value date</SortLink></th>
                <th><SortLink sortKey="source_module">Source</SortLink></th>
                <th><SortLink sortKey="event_type">Event</SortLink></th>
                <th><SortLink sortKey="description">Description</SortLink></th>
                <th><SortLink sortKey="gd1">{caption1}</SortLink></th>
                <th><SortLink sortKey="gd2">{caption2}</SortLink></th>
                <th className="num"><SortLink sortKey="amount">Amount</SortLink></th>
                <th><SortLink sortKey="posted_by">Posted by</SortLink></th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((j) => (
                <tr key={j.id} className={j.reversed_by_id ? 'muted' : undefined}>
                  <td className="mono">
                    <JournalLink id={j.id} canReverse={canReverse} caption1={caption1} caption2={caption2}>
                      {j.journal_no}
                    </JournalLink>
                  </td>
                  <td className="mono muted-cell">{j.reference || '—'}</td>
                  <td title={j.closing_entry ? 'Closing date — posted by Close Income Statement, after the last day of the fiscal year' : undefined}>
                    {j.closing_entry ? 'C' : ''}{formatDate(j.value_date)}
                  </td>
                  <td>{j.source_module}</td>
                  <td><Pill status={j.event_type} /></td>
                  <td>{j.description || ''}</td>
                  <td>{j.global_dimension_1_code || '—'}</td>
                  <td>{j.global_dimension_2_code || '—'}</td>
                  <td className="num"><Money cents={j.amount} /></td>
                  <td className="muted-cell">{j.posted_by || ''}</td>
                  <td>
                    {j.reversed_by_id ? <Pill tone="bad">REVERSED</Pill>
                      : j.reverses_id ? <Pill>REVERSAL</Pill> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="📚" title="No journals found" />}
      </Card>
    </>
  );
}

async function AccountsTab({ search, filtersRaw, sortRaw, asOf, from }: {
  search: string; filtersRaw?: string; sortRaw?: string; asOf?: string; from?: string;
}) {
  const filters = parseFilters(filtersRaw);
  const sort = parseSort(sortRaw);
  // The stored gl_account.balance is a lifetime running total, unaware of the date filter and
  // Dimensional filter below — so the trial balance's own per-account aggregation is reused
  // here to get a balance that actually respects them (empty filters reproduce the stored
  // figure exactly, since that's how it's maintained on every posting).
  const [rows, empty, canManage, { rows: tbRows }, { caption1, caption2 }] = await Promise.all([
    listGlAccounts({ search, filters, sort }),
    hasAnyGlAccounts().then((any) => !any),
    currentCanAction('GL_ACCOUNT_MANAGE'),
    getTrialBalance({ from: from || null, asOf: asOf || null, filters }),
    getDimensionCaptions(),
  ]);
  const balanceByCode = new Map(tbRows.map((r) => [r.code, r.net]));
  // The Dimensional filter — a Business-Central "FIN|NBI" combination/range expression against
  // each dimension's code, resolved by getTrialBalance() above the same way Trial Balance's own
  // filter bar does — replaces GL_DIMENSION_FILTER_FIELDS' single-exact-value select here, so
  // Chart of Accounts gets the same add/remove Dimensional filter Trial Balance has.
  const accountFields = [...GL_ACCOUNT_FILTER_FIELDS, ...dimensionalFields(caption1, caption2)];
  const dimensioned = filters.some((f) => (f.field === 'gd1_filter' || f.field === 'gd2_filter') && f.value !== '');
  const structureLabel = (t: string): string => GL_ACCOUNT_STRUCTURE_TYPES.find((s) => s.value === t)?.label ?? t;

  // Indentation follows Business Central's Begin-Total/End-Total bracketing, which only means
  // anything in code order — so depth is always resolved against the chart's natural order,
  // independent of whatever column the list itself is currently sorted by.
  const indented = rows.some((r) => r.indentation > 0);
  const codeOrder = [...rows].sort((x, y) => x.code.localeCompare(y.code));
  const depthByCode = new Map<string, number>();
  let depth = 0;
  for (const r of codeOrder) {
    if (r.account_type === 'END_TOTAL') depth = Math.max(0, depth - 1);
    // Indent Chart of Accounts stores the depth on the account; until it has been run the
    // bracketing is read live, so a chart that has never been indented still reads correctly.
    depthByCode.set(r.code, indented ? r.indentation : depth);
    if (r.account_type === 'BEGIN_TOTAL') depth += 1;
  }

  return (
    <>
      <Toolbar>
        <SearchInput placeholder="Search code or name…" disabled={empty} />
        <DynamicFilterBar fields={accountFields} disabled={empty} />
        <DateFilterExpressionInput placeholder="Date filter — e.g. 01/01/26..31/12/26 or ..T" disabled={empty} />
        <Spacer />
        <ExportButton
          href="/api/export/gl-accounts" params={{ q: search, filters: filtersRaw, sort: sortRaw, asOf, from }}
          disabled={!rows.length}
        />
        {canManage ? <IndentAccountsButton /> : null}
        {canManage ? <GlAccountFormButton className="btn">Add account</GlAccountFormButton> : null}
      </Toolbar>
      <Card>
        <CardHead
          title="Chart of accounts"
          sub={`Only Posting accounts carry ledger entries — Total/End-Total roll one up from their Totaling range. Click a balance to drill into its entries${
            from ? `. Net change ${formatDate(from)} to ${asOf ? formatDate(asOf) : 'date'}` : ''}`}
        >
          {dimensioned ? <Pill tone="info">DIMENSIONAL</Pill> : null}
        </CardHead>
        {rows.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th><SortLink sortKey="code">Code</SortLink></th>
                <th><SortLink sortKey="name">Account</SortLink></th>
                <th><SortLink sortKey="type">Type</SortLink></th>
                <th><SortLink sortKey="account_type">Account Type</SortLink></th>
                <th><SortLink sortKey="parent_code">Parent</SortLink></th>
                <th><SortLink sortKey="status">Status</SortLink></th>
                <th className="num"><SortLink sortKey="balance">Balance</SortLink></th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const posting = a.account_type === 'POSTING';
                const rowDepth = depthByCode.get(a.code) ?? 0;
                const balance = posting
                  ? balanceByCode.get(a.code) ?? 0
                  : (a.account_type === 'TOTAL' || a.account_type === 'END_TOTAL')
                    ? totalingBalance(rows, balanceByCode, a.totaling)
                    : null;
                return (
                  <tr key={a.id} className={posting ? undefined : 'header-row'}>
                    <td className="mono" style={rowDepth ? { paddingLeft: 12 + rowDepth * 16 } : undefined}>
                      {a.code}
                    </td>
                    <td>{a.name}</td>
                    <td className="tiny">{a.type}</td>
                    <td className="tiny">{structureLabel(a.account_type)}</td>
                    <td className="mono muted-cell">{a.parent_code || ''}</td>
                    <td><Pill status={a.status} /></td>
                    <td className="num">
                      {posting ? (
                        <LedgerLink code={a.code} caption1={caption1} caption2={caption2}>
                          <Money cents={balance ?? 0} />
                        </LedgerLink>
                      ) : balance !== null ? <Money cents={balance} /> : ''}
                    </td>
                    <td>
                      {canManage ? (
                        <GlAccountFormButton account={a} className="btn sm ghost">Edit</GlAccountFormButton>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="⚖" title="No accounts match" sub="Try a different search or clear the filters" />}
      </Card>
    </>
  );
}

/** Shared table for Vendor (Savings) and Customer (Loans) Ledger Entries — same underlying
 *  `txn` data, filtered by module in lib/gl.ts's listSubledgerEntries(). */
async function PeriodsTab({ search, filtersRaw, sortRaw }: { search: string; filtersRaw?: string; sortRaw?: string }) {
  const filters = parseFilters(filtersRaw);
  const sort = parseSort(sortRaw);
  const [rows, empty, canClose, canCreate, fiscalYears] = await Promise.all([
    listPeriods({ search, filters, sort }),
    hasAnyPeriods().then((any) => !any),
    currentCanAction('GL_PERIOD_CLOSE'),
    currentCanAction('GL_PERIOD_CREATE'),
    listFiscalYears(),
  ]);
  // BC's Close Year always takes the earliest fiscal year still open.
  const nextToClose = fiscalYears.find((y) => !y.closed) ?? null;
  const lastPeriod = fiscalYears.length ? fiscalYears[fiscalYears.length - 1].periods.slice(-1)[0]?.code ?? null : null;

  return (
    <>
      <Toolbar>
        <SearchInput placeholder="Search period…" disabled={empty} />
        <DynamicFilterBar fields={PERIOD_FILTER_FIELDS} disabled={empty} />
        <Spacer />
        {canCreate ? <CreateFiscalYearButton after={lastPeriod} /> : null}
        {canClose && nextToClose ? <CloseYearButton year={nextToClose} /> : null}
        <ExportButton href="/api/export/periods" params={{ q: search, filters: filtersRaw, sort: sortRaw }} disabled={!rows.length} />
      </Toolbar>
      <Card>
      <CardHead
        title="Accounting periods"
        sub="A closed period rejects every posting, including automated ones. Close Year marks a whole fiscal year closed (the fiscal year close, needed before Close Income Statement) and cannot be undone."
      />
      {rows.length ? (
      <TableWrap>
        <thead>
          <tr>
            <th><SortLink sortKey="code">Period</SortLink></th>
            <th><SortLink sortKey="start_date">From</SortLink></th>
            <th><SortLink sortKey="end_date">To</SortLink></th>
            <th><SortLink sortKey="status">Status</SortLink></th>
            <th>Fiscal year</th>
            <th className="num" />
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td className="mono">{p.code}</td>
              <td>{formatDate(p.start_date)}</td>
              <td>{formatDate(p.end_date)}</td>
              <td><Pill status={p.status} /></td>
              <td>
                {p.new_fiscal_year ? <Pill tone="info">New fiscal year</Pill> : null}
                {p.fiscally_closed ? <> <Pill tone="">Year closed{p.date_locked ? ' · date locked' : ''}</Pill></> : null}
              </td>
              <td className="num">{canClose ? <PeriodToggle period={p} /> : null}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      ) : <EmptyState icon="🗓" title="No periods match" sub="Try a different search or clear the filters" />}
      </Card>
    </>
  );
}

async function CloseIncomeStatementTab() {
  const [context, canPost] = await Promise.all([
    getCloseIncomeStatementContext(),
    currentCanAction('GL_CLOSE_INCOME_STATEMENT'),
  ]);
  return <CloseIncomeStatementScreen context={context} canPost={canPost} />;
}
