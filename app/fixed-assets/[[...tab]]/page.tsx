import { notFound } from 'next/navigation';
import { requireAction, currentCanAction, requireModuleTab } from '@/lib/session';
import { parseFilters } from '@/lib/listFilters';
import { parseSort } from '@/lib/listSort';
import { listPostableAccounts } from '@/lib/gl';
import {
  listFixedAssets, hasAnyFixedAssets, FA_FILTER_FIELDS, listFaLedgerEntries, hasAnyFaLedgerEntries,
} from '@/lib/fixedAssets';
import {
  listFaJournalLines, hasAnyFaJournalLines, FA_JOURNAL_FILTER_FIELDS,
} from '@/lib/faJournal';
import {
  listFaClasses, listActiveFaClasses, listFaSubclasses, listActiveFaSubclasses, listFaLocations,
  listActiveFaLocations, listMaintenanceCodes, listActiveMaintenanceCodes, listDepreciationBooks,
  listFaPostingGroups, getFaSetup,
} from '@/lib/fixedAssetsSetup';
import { getFaBookValueReport, FA_BOOK_VALUE_FILTER_FIELDS } from '@/lib/fixedAssetReports';
import { findPendingRoutedTask } from '@/lib/workflow';
import { Page } from '@/components/layout/page';
import {
  Card, CardHead, EmptyState, Pill, TableWrap, Tabs, Toolbar, Spacer, type TabDefinition,
} from '@/components/ui/primitives';
import { SearchInput } from '@/components/ui/filters';
import { DynamicFilterBar } from '@/components/ui/dynamic-filter';
import { SortLink } from '@/components/ui/sort-link';
import { Money } from '@/components/ui/money';
import { ExportButton } from '@/components/ui/export-button';
import { formatDate } from '@/lib/format';
import { NewAssetButton, EditAssetButton, DepreciationBookButton, AssetLedgerButton } from '../asset-form';
import {
  NewFaJournalLineButton, EditFaJournalLineButton, SubmitFaButton, CancelFaApprovalButton, ApproveFaButton,
  RejectFaButton, ReopenFaButton, PostFaButton, DeleteFaButton,
} from '../fa-journal-actions';
import { CalculateDepreciationPanel } from '../calculate-depreciation';
import {
  FaClassFormButton, FaSubclassFormButton, FaLocationFormButton, MaintenanceFormButton,
  DepreciationBookFormButton, FaPostingGroupFormButton, FaSetupFormButton,
} from '../fa-setup-forms';

/** Each tab is a page of its own (lib/permissions.ts PAGES, parent FIXED_ASSETS), so a permission
 *  set can open this module and still be kept out of particular screens. */
const TAB_PAGE: Record<string, string> = {
  assets: 'FA_ASSETS',
  journal: 'FA_JOURNAL',
  depreciation: 'FA_DEPRECIATION',
  'ledger-entries': 'FA_LEDGER',
  'book-value': 'FA_BOOK_VALUE',
  maintenance: 'FA_MAINTENANCE',
  classes: 'FA_CLASSES',
  locations: 'FA_LOCATIONS',
  'posting-groups': 'FA_POSTING_GROUPS',
  'depreciation-books': 'FA_BOOKS',
};

const TABS: TabDefinition[] = [
  { key: 'assets', label: 'Assets' },
  { key: 'journal', label: 'FA Journal' },
  { key: 'depreciation', label: 'Calculate Depreciation' },
  { key: 'ledger-entries', label: 'Ledger Entries' },
  { key: 'book-value', label: 'Book Value' },
  { key: 'maintenance', label: 'Maintenance' },
  { key: 'classes', label: 'Classes' },
  { key: 'locations', label: 'Locations' },
  { key: 'posting-groups', label: 'Posting Groups' },
  { key: 'depreciation-books', label: 'Books & Setup' },
];

export default async function FixedAssetsPage({ params, searchParams }: {
  params: Promise<{ tab?: string[] }>;
  searchParams: Promise<{ q?: string; filters?: string; sort?: string; book?: string; asOf?: string }>;
}) {
  const user = await requireAction('FIXED_ASSETS_READ');
  const { tab: segments } = await params;
  const sp = await searchParams;
  const tab = segments?.[0] ?? 'assets';
  if (!TABS.some((t) => t.key === tab)) notFound();
  const hrefFor = (k: string) => `/fixed-assets/${k === 'assets' ? '' : k}`;
  const tabs = requireModuleTab(user, TABS, TAB_PAGE, tab, !segments?.[0], hrefFor);

  return (
    <Page title="Fixed Assets" crumb="Asset register, depreciation and disposal" user={user}>
      <Tabs tabs={tabs} active={tab} hrefFor={hrefFor} />
      {tab === 'assets' ? <AssetsTab search={sp.q ?? ''} filtersRaw={sp.filters} sortRaw={sp.sort} /> : null}
      {tab === 'journal' ? <JournalTab search={sp.q ?? ''} filtersRaw={sp.filters} sortRaw={sp.sort} username={user.username} /> : null}
      {tab === 'depreciation' ? <DepreciationTab /> : null}
      {tab === 'ledger-entries' ? <LedgerEntriesTab /> : null}
      {tab === 'book-value' ? <BookValueTab bookCode={sp.book} asOf={sp.asOf} filtersRaw={sp.filters} /> : null}
      {tab === 'maintenance' ? <MaintenanceTab /> : null}
      {tab === 'classes' ? <ClassesTab /> : null}
      {tab === 'locations' ? <LocationsTab /> : null}
      {tab === 'posting-groups' ? <PostingGroupsTab /> : null}
      {tab === 'depreciation-books' ? <BooksAndSetupTab /> : null}
    </Page>
  );
}

async function loadMasters() {
  const [classes, subclasses, locations, books, postingGroups, setup] = await Promise.all([
    listActiveFaClasses(), listActiveFaSubclasses(), listActiveFaLocations(),
    listDepreciationBooks(), listFaPostingGroups(), getFaSetup(),
  ]);
  return {
    classes, subclasses, locations, books, postingGroups,
    defaultBookCode: setup.default_depreciation_book_code ?? books[0]?.code ?? null,
    defaultPostingGroupCode: setup.default_fa_posting_group_code ?? postingGroups[0]?.code ?? null,
  };
}

/* ------------------------------------------------------------------------ Assets */

async function AssetsTab({ search, filtersRaw, sortRaw }: { search: string; filtersRaw?: string; sortRaw?: string }) {
  const filters = parseFilters(filtersRaw);
  const sort = parseSort(sortRaw);
  const [rows, empty, canManage, masters] = await Promise.all([
    listFixedAssets({ search, filters, sort }),
    hasAnyFixedAssets().then((any) => !any),
    currentCanAction('FIXED_ASSETS_ASSET_MANAGE'),
    loadMasters(),
  ]);
  const fields = FA_FILTER_FIELDS.map((f) => {
    if (f.key === 'fa_class_code') return { ...f, options: masters.classes.map((c) => ({ value: c.code, label: c.code })) };
    if (f.key === 'fa_location_code') return { ...f, options: masters.locations.map((l) => ({ value: l.code, label: l.code })) };
    return f;
  });

  return (
    <>
      <Toolbar>
        <SearchInput placeholder="Search asset no., description or tag…" disabled={empty} />
        <DynamicFilterBar fields={fields} disabled={empty} />
        <Spacer />
        {canManage ? <NewAssetButton masters={masters} /> : null}
      </Toolbar>
      <Card>
        {rows.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th><SortLink sortKey="no">No.</SortLink></th>
                <th><SortLink sortKey="description">Description</SortLink></th>
                <th><SortLink sortKey="class">Class</SortLink></th>
                <th><SortLink sortKey="location">Location</SortLink></th>
                <th className="num">Acquisition cost</th>
                <th className="num">Accum. depr.</th>
                <th className="num"><SortLink sortKey="book_value">Book value</SortLink></th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className={a.disposed ? 'muted' : undefined}>
                  <td className="mono">{a.no}</td>
                  <td>{a.description}</td>
                  <td className="mono muted-cell">{a.fa_class_code ?? '—'}</td>
                  <td className="mono muted-cell">{a.fa_location_code ?? '—'}</td>
                  <td className="num"><Money cents={a.acquisition_cost} /></td>
                  <td className="num"><Money cents={a.accumulated_depreciation} /></td>
                  <td className="num"><Money cents={a.book_value} /></td>
                  <td>
                    {a.disposed ? <Pill tone="warn">Disposed</Pill>
                      : a.blocked ? <Pill tone="warn">Blocked</Pill>
                        : a.inactive ? <Pill tone="info">Inactive</Pill>
                          : a.depreciation_book_code ? <Pill status="ok">Active</Pill>
                            : <Pill tone="info">No book</Pill>}
                  </td>
                  <td className="num">
                    <div className="inline" style={{ justifyContent: 'flex-end' }}>
                      <AssetLedgerButton asset={a} />
                      {canManage ? (
                        <>
                          <DepreciationBookButton asset={a} masters={masters} />
                          <EditAssetButton asset={a} masters={masters} />
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🏛" title={empty ? 'No fixed assets yet' : 'No assets match'} sub="Add an asset, set up its Depreciation Book, then post an Acquisition Cost from the FA Journal." />}
      </Card>
    </>
  );
}

/* ----------------------------------------------------------------------- FA Journal */

async function JournalTab({ search, filtersRaw, sortRaw, username }: {
  search: string; filtersRaw?: string; sortRaw?: string; username: string;
}) {
  const filters = parseFilters(filtersRaw);
  const sort = parseSort(sortRaw);
  const [rows, empty, canCreate, canApprove, canPost, assets, accounts, maintenance, setup] = await Promise.all([
    listFaJournalLines({ search, filters, sort }),
    hasAnyFaJournalLines().then((any) => !any),
    currentCanAction('FIXED_ASSETS_JOURNAL_CREATE'),
    currentCanAction('FIXED_ASSETS_JOURNAL_APPROVE'),
    currentCanAction('FIXED_ASSETS_JOURNAL_POST'),
    listFixedAssets(),
    listPostableAccounts(),
    listActiveMaintenanceCodes(),
    getFaSetup(),
  ]);
  const eligibleAssets = assets
    .filter((a) => !a.blocked && !a.disposed)
    .map((a) => ({ id: a.id, no: a.no, description: a.description, depreciation_book_code: a.depreciation_book_code, disposed: a.disposed }));
  const routed = await Promise.all(
    rows.filter((r) => r.status === 'Pending Approval').map((r) => findPendingRoutedTask('FA_JOURNAL', r.no).then((t) => [r.no, !!t] as const)),
  );
  const routedMap = new Map(routed);
  const fields = FA_JOURNAL_FILTER_FIELDS.map((f) =>
    (f.key === 'fixed_asset_id' ? { ...f, options: assets.map((a) => ({ value: a.id, label: `${a.no} — ${a.description}` })) } : f));

  return (
    <>
      <Toolbar>
        <SearchInput placeholder="Search line no. or asset…" disabled={empty} />
        <DynamicFilterBar fields={fields} disabled={empty} />
        <Spacer />
        {canCreate ? (
          <NewFaJournalLineButton
            assets={eligibleAssets} accounts={accounts} maintenance={maintenance}
            defaultBookCode={setup.default_depreciation_book_code ?? null}
          />
        ) : null}
      </Toolbar>
      <Card>
        {rows.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th><SortLink sortKey="no">No.</SortLink></th>
                <th>FA posting type</th>
                <th><SortLink sortKey="asset">Asset</SortLink></th>
                <th className="num"><SortLink sortKey="amount">Amount</SortLink></th>
                <th><SortLink sortKey="posting_date">Posting date</SortLink></th>
                <th><SortLink sortKey="status">Status</SortLink></th>
                <th className="num" />
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => {
                const isOwn = l.created_by === username;
                return (
                  <tr key={l.no} className={l.status === 'Processed' ? 'muted' : undefined}>
                    <td className="mono">{l.no}</td>
                    <td>{l.fa_posting_type}{l.source === 'CALCULATE_DEPRECIATION' ? <span className="tiny muted-cell"> · batch</span> : null}</td>
                    <td>{l.fixed_asset_no} <span className="tiny muted-cell">{l.fixed_asset_description}</span></td>
                    <td className="num"><Money cents={l.amount} /></td>
                    <td>{formatDate(l.posting_date)}</td>
                    <td><Pill status={l.status} /></td>
                    <td className="num">
                      <div className="inline" style={{ justifyContent: 'flex-end' }}>
                        {l.status === 'Open' && canCreate && isOwn ? (
                          <>
                            <EditFaJournalLineButton
                              line={l} assets={eligibleAssets} accounts={accounts} maintenance={maintenance}
                              defaultBookCode={setup.default_depreciation_book_code ?? null}
                            />
                            <SubmitFaButton no={l.no} />
                            <DeleteFaButton no={l.no} />
                          </>
                        ) : null}
                        {l.status === 'Pending Approval' && canCreate && isOwn && !routedMap.get(l.no) ? <CancelFaApprovalButton no={l.no} /> : null}
                        {l.status === 'Pending Approval' && (canApprove || routedMap.get(l.no)) ? (
                          <>
                            <ApproveFaButton no={l.no} />
                            <RejectFaButton no={l.no} />
                          </>
                        ) : null}
                        {l.status === 'Approved' && !l.posted && canApprove ? <ReopenFaButton no={l.no} /> : null}
                        {l.status === 'Approved' && canPost ? <PostFaButton no={l.no} /> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="📓" title={empty ? 'No FA journal lines yet' : 'No lines match'} sub="Post Acquisition Cost, Depreciation, Write-Down, Appreciation, Maintenance or Disposal against an asset." />}
      </Card>
    </>
  );
}

/* -------------------------------------------------------------- Calculate Depreciation */

async function DepreciationTab() {
  const [books, setup, canRun] = await Promise.all([
    listDepreciationBooks(), getFaSetup(), currentCanAction('FIXED_ASSETS_DEPRECIATION_RUN'),
  ]);
  return (
    <Card>
      <CardHead
        title="Calculate Depreciation"
        sub="Drafts Open Depreciation FA Journal lines for a whole book up to a date"
      />
      {!books.length ? (
        <EmptyState icon="📉" title="No depreciation book" sub="Add one on the Books & Setup tab first." />
      ) : !canRun ? (
        <EmptyState icon="🔒" title="You cannot run the depreciation batch" />
      ) : (
        <CalculateDepreciationPanel books={books} defaultBookCode={setup.default_depreciation_book_code ?? null} />
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------- Ledger Entries */

async function LedgerEntriesTab() {
  const [rows, empty] = await Promise.all([
    listFaLedgerEntries(),
    hasAnyFaLedgerEntries().then((any) => !any),
  ]);
  return (
    <Card>
      <CardHead title="FA Ledger Entries" sub="The posted, immutable FA movement history behind every asset's book value" />
      {rows.length ? (
        <TableWrap>
          <thead>
            <tr>
              <th>Date</th><th>Asset</th><th>Book</th><th>Type</th><th>Document</th>
              <th className="num">Amount</th><th className="num">Days</th><th>Book value?</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td>{formatDate(e.fa_posting_date)}</td>
                <td>{e.fixed_asset_no} <span className="tiny muted-cell">{e.fixed_asset_description}</span></td>
                <td className="mono muted-cell">{e.depreciation_book_code}</td>
                <td>{e.fa_posting_type}</td>
                <td className="mono">{e.document_no}</td>
                <td className="num"><Money cents={e.amount} /></td>
                <td className="num">{e.no_of_depreciation_days ?? '—'}</td>
                <td>{e.part_of_book_value ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : <EmptyState icon="📄" title={empty ? 'No FA ledger entries yet' : 'No entries'} />}
    </Card>
  );
}

/* --------------------------------------------------------------------- Book Value */

async function BookValueTab({ bookCode, asOf, filtersRaw }: { bookCode?: string; asOf?: string; filtersRaw?: string }) {
  const filters = parseFilters(filtersRaw);
  const [books, classes, locations] = await Promise.all([listDepreciationBooks(), listFaClasses(), listFaLocations()]);
  const report = await getFaBookValueReport({ bookCode, asOf, filters });
  const fields = FA_BOOK_VALUE_FILTER_FIELDS.map((f) => {
    if (f.key === 'fa_class_code') return { ...f, options: classes.map((c) => ({ value: c.code, label: c.code })) };
    if (f.key === 'fa_location_code') return { ...f, options: locations.map((l) => ({ value: l.code, label: l.code })) };
    return f;
  });

  return (
    <>
      <Toolbar>
        <form className="inline" style={{ gap: 8 }}>
          <select name="book" defaultValue={report.book_code} aria-label="Depreciation book">
            {books.map((b) => <option key={b.code} value={b.code}>{b.code} — {b.description}</option>)}
          </select>
          <input type="date" name="asOf" defaultValue={report.as_of} aria-label="As of date" />
          <button type="submit" className="btn sm">Refresh</button>
        </form>
        <DynamicFilterBar fields={fields} />
        <Spacer />
        <ExportButton href="/api/export/fa-book-value" params={{ book: report.book_code, asOf: report.as_of, filters: filtersRaw }} disabled={!report.rows.length} />
      </Toolbar>
      <Card>
        <CardHead title={`FA Book Value — ${report.book_code}`} sub={`As of ${formatDate(report.as_of)}`} />
        {report.rows.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th>Asset</th><th>Class</th>
                <th className="num">Acquisition cost</th><th className="num">Depreciation</th>
                <th className="num">Write-down</th><th className="num">Appreciation</th><th className="num">Book value</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.fixed_asset_id} className={r.disposed ? 'muted' : undefined}>
                  <td>{r.fixed_asset_no} <span className="tiny muted-cell">{r.fixed_asset_description}</span>{r.disposed ? <Pill tone="warn">Disposed</Pill> : null}</td>
                  <td className="mono muted-cell">{r.fa_class_code ?? '—'}</td>
                  <td className="num"><Money cents={r.acquisition_cost} /></td>
                  <td className="num"><Money cents={r.depreciation} /></td>
                  <td className="num"><Money cents={r.write_down} /></td>
                  <td className="num"><Money cents={r.appreciation} /></td>
                  <td className="num"><Money cents={r.book_value} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Totals</td>
                <td className="num"><Money cents={report.totals.acquisition_cost} /></td>
                <td className="num"><Money cents={report.totals.depreciation} /></td>
                <td className="num"><Money cents={report.totals.write_down} /></td>
                <td className="num"><Money cents={report.totals.appreciation} /></td>
                <td className="num"><Money cents={report.totals.book_value} /></td>
              </tr>
            </tfoot>
          </TableWrap>
        ) : <EmptyState icon="📊" title="Nothing to report" sub="Post an Acquisition Cost for an asset on this book." />}
      </Card>
    </>
  );
}

/* -------------------------------------------------------------------- Maintenance */

async function MaintenanceTab() {
  const [codes, entries, canManage] = await Promise.all([
    listMaintenanceCodes(),
    listFaLedgerEntries({ postingType: 'Maintenance' }),
    currentCanAction('FIXED_ASSETS_SETUP_MANAGE'),
  ]);
  return (
    <>
      <Card>
        <CardHead title="Maintenance register" sub="Every posted Maintenance FA journal line — expensed, never part of book value">
          {null}
        </CardHead>
        {entries.length ? (
          <TableWrap>
            <thead>
              <tr><th>Date</th><th>Asset</th><th>Code</th><th>Document</th><th className="num">Amount</th></tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{formatDate(e.fa_posting_date)}</td>
                  <td>{e.fixed_asset_no} <span className="tiny muted-cell">{e.fixed_asset_description}</span></td>
                  <td className="mono muted-cell">{e.maintenance_code ?? '—'}</td>
                  <td className="mono">{e.document_no}</td>
                  <td className="num"><Money cents={e.amount} /></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🔧" title="No maintenance posted yet" />}
      </Card>

      <Card>
        <CardHead title="Maintenance codes" sub="The master list a Maintenance FA journal line picks from">
          {canManage ? <MaintenanceFormButton>Add code</MaintenanceFormButton> : null}
        </CardHead>
        {codes.length ? (
          <TableWrap>
            <thead><tr><th>Code</th><th>Description</th><th>Status</th><th /></tr></thead>
            <tbody>
              {codes.map((c) => (
                <tr key={c.id}>
                  <td className="mono">{c.code}</td>
                  <td>{c.description}</td>
                  <td><Pill status={c.status} /></td>
                  <td>{canManage ? <MaintenanceFormButton row={c} className="btn sm ghost">Edit</MaintenanceFormButton> : null}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🔧" title="No maintenance codes yet" />}
      </Card>
    </>
  );
}

/* ----------------------------------------------------------------------- Classes */

async function ClassesTab() {
  const [classes, subclasses, canManage] = await Promise.all([
    listFaClasses(), listFaSubclasses(), currentCanAction('FIXED_ASSETS_SETUP_MANAGE'),
  ]);
  return (
    <>
      <Card>
        <CardHead title="FA Classes" sub="The broad categories fixed assets are grouped into">
          {canManage ? <FaClassFormButton>Add class</FaClassFormButton> : null}
        </CardHead>
        {classes.length ? (
          <TableWrap>
            <thead><tr><th>Code</th><th>Description</th><th>Status</th><th /></tr></thead>
            <tbody>
              {classes.map((c) => (
                <tr key={c.id}>
                  <td className="mono">{c.code}</td><td>{c.description}</td><td><Pill status={c.status} /></td>
                  <td>{canManage ? <FaClassFormButton row={c} className="btn sm ghost">Edit</FaClassFormButton> : null}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🗂" title="No FA classes yet" />}
      </Card>

      <Card>
        <CardHead title="FA Subclasses" sub="Finer groupings within an FA class">
          {canManage ? <FaSubclassFormButton classes={classes}>Add subclass</FaSubclassFormButton> : null}
        </CardHead>
        {subclasses.length ? (
          <TableWrap>
            <thead><tr><th>Code</th><th>Description</th><th>Class</th><th>Status</th><th /></tr></thead>
            <tbody>
              {subclasses.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{s.code}</td><td>{s.description}</td>
                  <td className="mono muted-cell">{s.fa_class_code ?? '—'}</td><td><Pill status={s.status} /></td>
                  <td>{canManage ? <FaSubclassFormButton row={s} classes={classes} className="btn sm ghost">Edit</FaSubclassFormButton> : null}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🗂" title="No FA subclasses yet" />}
      </Card>
    </>
  );
}

/* --------------------------------------------------------------------- Locations */

async function LocationsTab() {
  const [rows, canManage] = await Promise.all([listFaLocations(), currentCanAction('FIXED_ASSETS_SETUP_MANAGE')]);
  return (
    <>
      <Toolbar>
        <Spacer />
        {canManage ? <FaLocationFormButton>Add location</FaLocationFormButton> : null}
      </Toolbar>
      <Card>
        {rows.length ? (
          <TableWrap>
            <thead><tr><th>Code</th><th>Description</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <td className="mono">{l.code}</td><td>{l.description}</td><td><Pill status={l.status} /></td>
                  <td>{canManage ? <FaLocationFormButton row={l} className="btn sm ghost">Edit</FaLocationFormButton> : null}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🏬" title="No FA locations yet" />}
      </Card>
    </>
  );
}

/* ---------------------------------------------------------------- Posting Groups */

async function PostingGroupsTab() {
  const [groups, canManage, accounts] = await Promise.all([
    listFaPostingGroups(), currentCanAction('FIXED_ASSETS_SETUP_MANAGE'), listPostableAccounts(),
  ]);
  return (
    <Card>
      <CardHead title="FA Posting Groups" sub="The G/L accounts every FA posting resolves its debit and credit from">
        {canManage ? <FaPostingGroupFormButton accounts={accounts}>Add group</FaPostingGroupFormButton> : null}
      </CardHead>
      {groups.length ? (
        <TableWrap>
          <thead>
            <tr>
              <th>Code</th><th>Description</th><th>Acquisition</th><th>Accum. depr.</th>
              <th>Depr. expense</th><th>Maintenance</th><th>Gain / Loss</th><th className="num">Assets</th><th />
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.id}>
                <td className="mono">{g.code}</td>
                <td>{g.description}</td>
                <td className="mono muted-cell">{g.acquisition_cost_account_code}</td>
                <td className="mono muted-cell">{g.accum_depreciation_account_code}</td>
                <td className="mono muted-cell">{g.depreciation_expense_account_code}</td>
                <td className="mono muted-cell">{g.maintenance_expense_account_code}</td>
                <td className="mono muted-cell">{g.gains_acc_on_disposal_code} / {g.losses_acc_on_disposal_code}</td>
                <td className="num">{g.assets_using}</td>
                <td>{canManage ? <FaPostingGroupFormButton row={g} accounts={accounts} className="btn sm ghost">Edit</FaPostingGroupFormButton> : null}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : <EmptyState icon="⚖" title="No FA posting groups yet" />}
    </Card>
  );
}

/* ------------------------------------------------------------------ Books & Setup */

async function BooksAndSetupTab() {
  const [books, groups, setup, canManage] = await Promise.all([
    listDepreciationBooks(), listFaPostingGroups(), getFaSetup(), currentCanAction('FIXED_ASSETS_SETUP_MANAGE'),
  ]);
  return (
    <>
      <Card>
        <CardHead title="FA Setup" sub="Module-wide defaults and the FA posting-date window">
          {canManage ? <FaSetupFormButton setup={setup} books={books} groups={groups}>Edit setup</FaSetupFormButton> : null}
        </CardHead>
        <TableWrap>
          <tbody>
            <tr><td>Default depreciation book</td><td className="mono">{setup.default_depreciation_book_code ?? '—'}</td></tr>
            <tr><td>Default FA posting group</td><td className="mono">{setup.default_fa_posting_group_code ?? '—'}</td></tr>
            <tr><td>Allow FA posting from</td><td>{setup.allow_fa_posting_from ? formatDate(setup.allow_fa_posting_from) : '—'}</td></tr>
            <tr><td>Allow FA posting to</td><td>{setup.allow_fa_posting_to ? formatDate(setup.allow_fa_posting_to) : '—'}</td></tr>
          </tbody>
        </TableWrap>
      </Card>

      <Card>
        <CardHead title="Depreciation Books" sub="Depreciation books always integrate to the G/L">
          {canManage ? <DepreciationBookFormButton>Add book</DepreciationBookFormButton> : null}
        </CardHead>
        {books.length ? (
          <TableWrap>
            <thead><tr><th>Code</th><th>Description</th><th className="num">Final rounding</th><th /></tr></thead>
            <tbody>
              {books.map((b) => (
                <tr key={b.id}>
                  <td className="mono">{b.code}</td>
                  <td>{b.description}</td>
                  <td className="num"><Money cents={b.default_final_rounding_amount} /></td>
                  <td>{canManage ? <DepreciationBookFormButton row={b} className="btn sm ghost">Edit</DepreciationBookFormButton> : null}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="📗" title="No depreciation books yet" />}
      </Card>
    </>
  );
}
