import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireAction, currentCanAction, requireModuleTab } from '@/lib/session';
import { parseFilters } from '@/lib/listFilters';
import { parseSort } from '@/lib/listSort';
import { listPostableAccounts, listActiveBankAccounts } from '@/lib/gl';
import { listItems } from '@/lib/items';
import { listActiveLocations } from '@/lib/inventorySetup';
import { listFixedAssets } from '@/lib/fixedAssets';
import { listActivePaymentTerms, listActivePaymentMethods } from '@/lib/receivablesSetup';
import {
  listVendors, hasAnyVendors, VENDOR_FILTER_FIELDS, listActiveVendors, getVendorLedgerEntries,
} from '@/lib/vendors';
import {
  listPurchaseDocuments, hasAnyPurchaseDocuments, purchaseDocCounts, PURCHASE_DOC_FILTER_FIELDS,
  PURCHASE_DOC_VIEWS, type PurchaseDocView,
} from '@/lib/purchaseDocuments';
import { listVendorPostingGroups, getPurchasesPayablesSetup } from '@/lib/payablesSetup';
import { vatRateMatrix } from '@/lib/vatSetup';
import { getAgedAccountsPayable, AGED_AP_FILTER_FIELDS } from '@/lib/payablesReports';
import { findPendingRoutedTask, isEligibleApprover } from '@/lib/workflow';
import { PurchasesPayablesSetupCard } from '@/components/admin/module-setup-cards';
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
import type { PostedPurchaseDocumentType, PurchaseDocumentType } from '@/lib/types';
import {
  NewVendorButton, VendorPostingGroupFormButton,
} from '../payables-forms';
import { NewPurchaseDocumentButton } from '../purchase-document-form';
import {
  MakeOrderButton, SubmitDocButton, CancelApprovalButton, ApproveDocButton, RejectDocButton, ReopenDocButton,
  DeleteDocButton, PostPurchaseDocButton,
} from '../document-actions';
import { ApplyEntriesButton, UnapplyButton } from '../apply-entries';
import { VendorStatementPanel } from '../statement-panel';

/** Business Central splits a document list by where it stands in approval. "Approved" is BC's
 *  Released, and "Rejected" is the Open documents an approver sent back (see lib/purchaseDocuments
 *  .ts's VIEW_CLAUSE) — the four buckets are disjoint, so All is their sum. */
const VIEW_LABELS: Record<PurchaseDocView, string> = {
  all: 'All', open: 'Open', pending: 'Pending Approval', released: 'Approved', rejected: 'Rejected',
};

/** Each tab is a page of its own (lib/permissions.ts PAGES, parent PAYABLES), so a permission
 *  set can open this module and still be kept out of particular screens. */
const TAB_PAGE: Record<string, string> = {
  vendors: 'PAYABLES_VENDORS',
  quotes: 'PAYABLES_QUOTES',
  orders: 'PAYABLES_ORDERS',
  'purchase-invoices': 'PAYABLES_PURCHASE_INVOICES',
  'credit-memos': 'PAYABLES_CREDIT_MEMOS',
  'posted-documents': 'PAYABLES_POSTED',
  'ledger-entries': 'PAYABLES_LEDGER',
  'aged-ap': 'PAYABLES_AGED_AP',
  statement: 'PAYABLES_STATEMENT',
  setup: 'PAYABLES_SETUP',
};

const TABS: TabDefinition[] = [
  { key: 'vendors', label: 'Vendors' },
  { key: 'quotes', label: 'Quotes' },
  { key: 'orders', label: 'Orders' },
  { key: 'purchase-invoices', label: 'Purchase Invoices' },
  { key: 'credit-memos', label: 'Credit Memos' },
  { key: 'posted-documents', label: 'Posted' },
  { key: 'ledger-entries', label: 'Vendor Ledger' },
  { key: 'aged-ap', label: 'Aged AP' },
  { key: 'statement', label: 'Statement' },
  { key: 'setup', label: 'Setup' },
];

/** Vendor Posting Groups is Setup Pool master data now; the old tab link still lands on it. */
const MOVED_TO_POOL: Record<string, string> = {
  'posting-groups': '/admin/pool/finance/vendor-posting-groups',
};

export default async function PayablesPage({ params, searchParams }: {
  params: Promise<{ tab?: string[] }>;
  searchParams: Promise<{ q?: string; filters?: string; sort?: string; view?: string; vendor?: string; asOf?: string; from?: string; to?: string }>;
}) {
  const user = await requireAction('PAYABLES_READ');
  const { tab: segments } = await params;
  const sp = await searchParams;
  const tab = segments?.[0] ?? 'vendors';
  const moved = MOVED_TO_POOL[tab];
  if (moved) redirect(moved);
  if (!TABS.some((t) => t.key === tab)) notFound();
  const hrefFor = (k: string) => `/payables/${k === 'vendors' ? '' : k}`;
  const tabs = requireModuleTab(user, TABS, TAB_PAGE, tab, !segments?.[0], hrefFor);

  return (
    <Page title="Payables" crumb="Vendors, purchase invoices, payments and aging" user={user}>
      <Tabs tabs={tabs} active={tab} hrefFor={hrefFor} />
      {tab === 'vendors' ? <VendorsTab search={sp.q ?? ''} filtersRaw={sp.filters} sortRaw={sp.sort} /> : null}
      {tab === 'quotes' ? <PurchaseDocTab documentType="Quote" tab={tab} view={sp.view} search={sp.q ?? ''} filtersRaw={sp.filters} sortRaw={sp.sort} username={user.username} userId={user.id} /> : null}
      {tab === 'orders' ? <PurchaseDocTab documentType="Order" tab={tab} view={sp.view} search={sp.q ?? ''} filtersRaw={sp.filters} sortRaw={sp.sort} username={user.username} userId={user.id} /> : null}
      {tab === 'purchase-invoices' ? <PurchaseDocTab documentType="Invoice" tab={tab} view={sp.view} search={sp.q ?? ''} filtersRaw={sp.filters} sortRaw={sp.sort} username={user.username} userId={user.id} /> : null}
      {tab === 'credit-memos' ? <PurchaseDocTab documentType="Credit Memo" tab={tab} view={sp.view} search={sp.q ?? ''} filtersRaw={sp.filters} sortRaw={sp.sort} username={user.username} userId={user.id} /> : null}
      {tab === 'posted-documents' ? <PostedDocsTab search={sp.q ?? ''} view={sp.view} /> : null}
      {tab === 'ledger-entries' ? <LedgerTab /> : null}
      {tab === 'aged-ap' ? <AgedApTab asOf={sp.asOf} filtersRaw={sp.filters} /> : null}
      {tab === 'statement' ? <StatementTab vendorNo={sp.vendor} from={sp.from} to={sp.to} /> : null}
      {tab === 'setup' ? <SetupTab /> : null}
    </Page>
  );
}

async function vendorFormProps() {
  const [postingGroups, paymentTerms, paymentMethods] = await Promise.all([
    listVendorPostingGroups(), listActivePaymentTerms(), listActivePaymentMethods(),
  ]);
  return { postingGroups, paymentTerms, paymentMethods };
}

/* ------------------------------------------------------------------ Vendors */

async function VendorsTab({ search, filtersRaw, sortRaw }: { search: string; filtersRaw?: string; sortRaw?: string }) {
  const filters = parseFilters(filtersRaw);
  const sort = parseSort(sortRaw);
  const [rows, empty, canManage, fp] = await Promise.all([
    listVendors({ search, filters, sort }),
    hasAnyVendors().then((a) => !a),
    currentCanAction('PAYABLES_VENDOR_MANAGE'),
    vendorFormProps(),
  ]);
  const fields = VENDOR_FILTER_FIELDS.map((f) =>
    (f.key === 'vendor_posting_group_code' ? { ...f, options: fp.postingGroups.map((g) => ({ value: g.code, label: g.code })) } : f));

  return (
    <>
      <Toolbar>
        <SearchInput placeholder="Search vendor no., name, city…" disabled={empty} />
        <DynamicFilterBar fields={fields} disabled={empty} />
        <Spacer />
        {canManage ? <NewVendorButton {...fp}>New vendor</NewVendorButton> : null}
      </Toolbar>
      <Card>
        {rows.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th><SortLink sortKey="no">No.</SortLink></th>
                <th><SortLink sortKey="name">Name</SortLink></th>
                <th><SortLink sortKey="city">City</SortLink></th>
                <th>Posting group</th>
                <th>Terms</th>
                <th className="num"><SortLink sortKey="balance">Balance</SortLink></th>
                <th className="num"><SortLink sortKey="balance_due">Overdue</SortLink></th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <td className="mono"><Link href={`/payables/vendors/${encodeURIComponent(v.no)}`}>{v.no}</Link></td>
                  <td>{v.name}</td>
                  <td className="muted-cell">{v.city ?? '—'}</td>
                  <td className="mono muted-cell">{v.vendor_posting_group_code ?? '—'}</td>
                  <td className="mono muted-cell">{v.payment_terms_code ?? '—'}</td>
                  <td className="num"><Money cents={v.balance} /></td>
                  <td className="num">{v.balance_due > 0 ? <span className="bad"><Money cents={v.balance_due} /></span> : <Money cents={0} />}</td>
                  <td>{v.blocked ? <Pill tone="bad">Blocked: {v.blocked}</Pill> : <Pill status="ok">Active</Pill>}</td>
                  <td className="num">
                    <Link href={`/payables/vendors/${encodeURIComponent(v.no)}`} className="btn sm ghost">View card</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🏭" title={empty ? 'No vendors yet' : 'No vendors match'} />}
      </Card>
    </>
  );
}

/* ----------------------------------------------------------- Purchase Documents */

async function PurchaseDocTab({ documentType, tab, view: viewRaw, search, filtersRaw, sortRaw, username, userId }: {
  documentType: PurchaseDocumentType; tab: string; view?: string;
  search: string; filtersRaw?: string; sortRaw?: string; username: string; userId: number;
}) {
  const filters = parseFilters(filtersRaw);
  const sort = parseSort(sortRaw);
  const view: PurchaseDocView = PURCHASE_DOC_VIEWS.includes(viewRaw as PurchaseDocView)
    ? (viewRaw as PurchaseDocView) : 'all';
  const [rows, empty, canCreate, canApprove, canPost, vendors, accounts, items, fixedAssets, locations, paymentTerms, paymentMethods, vatRates, setup, counts] = await Promise.all([
    listPurchaseDocuments({ documentType, view, search, filters, sort }),
    hasAnyPurchaseDocuments(documentType).then((a) => !a),
    currentCanAction('PAYABLES_PURCHASE_CREATE'),
    currentCanAction('PAYABLES_PURCHASE_APPROVE'),
    currentCanAction('PAYABLES_PURCHASE_POST'),
    listActiveVendors(),
    listPostableAccounts(),
    listItems(),
    listFixedAssets(),
    listActiveLocations(),
    listActivePaymentTerms(),
    listActivePaymentMethods(),
    vatRateMatrix(),
    getPurchasesPayablesSetup(),
    purchaseDocCounts(documentType),
  ]);
  // Release / Reject belong to whoever each document is sitting with: the approver its workflow
  // routed it to, or — when no workflow matched — anyone holding the approve permission.
  const routedTasks = new Map(await Promise.all(
    rows.filter((r) => r.status === 'Pending Approval')
      .map((r) => findPendingRoutedTask('PURCHASE_DOCUMENT', r.no).then((t) => [r.no, t] as const)),
  ));
  const canDecide = new Map(await Promise.all(
    [...routedTasks].map(async ([no, task]) =>
      [no, task ? await isEligibleApprover(task, userId) : canApprove] as const),
  ));
  const fields = PURCHASE_DOC_FILTER_FIELDS.map((f) =>
    (f.key === 'vendor_id' ? { ...f, options: vendors.map((v) => ({ value: v.id, label: `${v.no} — ${v.name}` })) } : f));
  const formProps = {
    vendors, paymentTerms, paymentMethods,
    accounts: accounts.map((a) => ({ code: a.code, name: a.name })),
    items: items.map((i) => ({ no: i.no, description: i.description })),
    fixedAssets: fixedAssets.filter((a) => !a.disposed && !a.acquisition_cost).map((a) => ({ no: a.no, description: a.description })),
    locations: locations.map((l) => ({ code: l.code, name: l.name })),
    vatPreview: {
      rates: vatRates,
      accountVatProd: Object.fromEntries(accounts.map((a) => [a.code, a.vat_prod_posting_group_code ?? null])),
      defaultVatBus: setup.default_vat_bus_posting_group_code ?? null,
      pricesInclVat: !!setup.prices_incl_vat,
    },
  };

  const viewHref = (key: string) => {
    const params = new URLSearchParams();
    if (key !== 'all') params.set('view', key);
    if (search) params.set('q', search);
    if (filtersRaw) params.set('filters', filtersRaw);
    if (sortRaw) params.set('sort', sortRaw);
    const qs = params.toString();
    return `/payables/${tab}${qs ? `?${qs}` : ''}`;
  };

  return (
    <>
      <Tabs
        tabs={PURCHASE_DOC_VIEWS.map((v) => ({ key: v, label: `${VIEW_LABELS[v]} (${counts[v]})` }))}
        active={view} hrefFor={viewHref}
      />
      <Toolbar>
        <SearchInput placeholder="Search no., vendor, invoice no.…" disabled={empty} />
        <DynamicFilterBar fields={fields} disabled={empty} />
        <Spacer />
        {canCreate && documentType !== 'Order' ? <NewPurchaseDocumentButton documentType={documentType} {...formProps} /> : null}
      </Toolbar>
      <Card>
        {rows.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th><SortLink sortKey="no">No.</SortLink></th>
                <th><SortLink sortKey="vendor">Vendor</SortLink></th>
                <th>Vendor Inv.</th>
                <th className="num"><SortLink sortKey="amount">Amount</SortLink></th>
                <th><SortLink sortKey="posting_date">Posting date</SortLink></th>
                <th><SortLink sortKey="due_date">Due date</SortLink></th>
                <th><SortLink sortKey="status">Status</SortLink></th>
                <th className="num" />
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const isOwn = d.created_by === username;
                return (
                  <tr key={d.no}>
                    <td className="mono"><Link href={`/payables/documents/${encodeURIComponent(d.no)}`}>{d.no}</Link></td>
                    <td>{d.vendor_no} <span className="tiny muted-cell">{d.vendor_name}</span></td>
                    <td className="mono muted-cell">{d.vendor_invoice_no ?? '—'}</td>
                    <td className="num"><Money cents={d.amount} /></td>
                    <td>{formatDate(d.posting_date)}</td>
                    <td>{d.due_date ? formatDate(d.due_date) : '—'}</td>
                    <td>
                      {d.status === 'Open' && d.decision_reason
                        ? <Pill tone="bad">Rejected</Pill>
                        : <Pill status={d.status} />}
                    </td>
                    <td className="num">
                      <div className="inline" style={{ justifyContent: 'flex-end' }}>
                        {documentType === 'Quote' && d.status === 'Open' && canCreate ? <MakeOrderButton no={d.no} /> : null}
                        {d.status === 'Pending Approval' && canCreate && isOwn && !routedTasks.get(d.no) ? <CancelApprovalButton no={d.no} /> : null}
                        {d.status === 'Pending Approval' && canDecide.get(d.no) ? (<><ApproveDocButton no={d.no} /><RejectDocButton no={d.no} /></>) : null}
                        {d.status === 'Released' && canApprove ? <ReopenDocButton no={d.no} /> : null}
                        {d.status === 'Released' && canPost ? <PostPurchaseDocButton no={d.no} isOrder={documentType === 'Order'} /> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        ) : (
          <EmptyState
            icon="📄"
            title={empty ? `No purchase ${documentType.toLowerCase()}s yet`
              : view === 'all' ? 'No documents match'
                : `No ${VIEW_LABELS[view].toLowerCase()} ${documentType.toLowerCase()}s`}
          />
        )}
      </Card>
    </>
  );
}

/** One posted table, three lists: a goods receipt, an invoice and a credit memo are looked up
 *  for different reasons, so each gets its own sub-tab, as in BC. */
const POSTED_PURCHASE_VIEWS: { key: string; type: PostedPurchaseDocumentType; label: string; sub: string }[] = [
  { key: 'invoices', type: 'Invoice', label: 'Posted Purchase Invoices', sub: 'Invoices posted to the vendor ledger' },
  { key: 'receipts', type: 'Receipt', label: 'Posted Purchase Receipts', sub: 'Goods received — the receipt record behind each order' },
  { key: 'credit-memos', type: 'Credit Memo', label: 'Posted Purchase Credit Memos', sub: 'Credit memos posted against the vendor ledger' },
];

async function PostedDocsTab({ search, view }: { search: string; view?: string }) {
  const { all } = await import('@/lib/db');
  const current = POSTED_PURCHASE_VIEWS.find((v) => v.key === view) ?? POSTED_PURCHASE_VIEWS[0];
  const [rows, countRows] = await Promise.all([
    all<{
      id: number; no: string; posting_date: string; amount: number;
      vendor_no: string; vendor_name: string; order_no: string | null; vendor_invoice_no: string | null;
    }>(
      `SELECT d.id, d.no, d.posting_date, d.amount, d.order_no, d.vendor_invoice_no,
              v.no AS vendor_no, v.name AS vendor_name
       FROM posted_purchase_document d JOIN vendor v ON v.id = d.vendor_id
       WHERE d.document_type = @type AND (d.no ILIKE @like OR v.no ILIKE @like OR v.name ILIKE @like)
       ORDER BY d.id DESC LIMIT 500`,
      { type: current.type, like: `%${String(search).trim()}%` },
    ),
    all<{ document_type: string; n: number }>(
      'SELECT document_type, COUNT(*)::int AS n FROM posted_purchase_document GROUP BY document_type',
    ),
  ]);
  const counts = new Map(countRows.map((r) => [r.document_type, r.n]));
  return (
    <>
      <Tabs
        tabs={POSTED_PURCHASE_VIEWS.map((v) => ({ key: v.key, label: `${v.label.replace('Posted Purchase ', '')} (${counts.get(v.type) ?? 0})` }))}
        active={current.key} hrefFor={(k) => `/payables/posted-documents?view=${k}`}
      />
      <Toolbar><SearchInput placeholder="Search posted document no. or vendor…" /><Spacer /></Toolbar>
      <Card>
        <CardHead title={current.label} sub={current.sub} />
        {rows.length ? (
          <TableWrap>
            <thead><tr><th>No.</th><th>Vendor</th><th>Vendor Inv.</th><th>Order</th><th>Date</th><th className="num">Amount</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="mono"><Link href={`/payables/posted/${encodeURIComponent(r.no)}`}>{r.no}</Link></td>
                  <td>{r.vendor_no} <span className="tiny muted-cell">{r.vendor_name}</span></td>
                  <td className="mono muted-cell">{r.vendor_invoice_no ?? '—'}</td>
                  <td className="mono muted-cell">{r.order_no ?? '—'}</td>
                  <td>{formatDate(r.posting_date)}</td>
                  <td className="num"><Money cents={r.amount} /></td>
                  <td className="num">
                    <a className="btn sm ghost" href={`/print/posted-purchase/${encodeURIComponent(r.no)}`} target="_blank" rel="noreferrer">Print</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="📄" title={search ? `No ${current.label.toLowerCase()} match` : `No ${current.label.toLowerCase()} yet`} />}
      </Card>
    </>
  );
}

/* -------------------------------------------------------------- Payment Journal */

/* -------------------------------------------------------------- Vendor Ledger */

async function LedgerTab() {
  const [rows, canApply] = await Promise.all([
    getVendorLedgerEntries(),
    currentCanAction('PAYABLES_APPLY_ENTRIES'),
  ]);
  return (
    <Card>
      <CardHead title="Vendor Ledger Entries" sub="Every invoice, credit memo and payment posted against a vendor" />
      {rows.length ? (
        <TableWrap>
          <thead><tr><th>Date</th><th>Vendor</th><th>Type</th><th>Document</th><th>Due</th><th className="num">Amount</th><th className="num">Remaining</th><th>Open</th><th className="num" /></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className={e.open ? undefined : 'muted'}>
                <td>{formatDate(e.posting_date)}</td>
                <td>{e.vendor_no} <span className="tiny muted-cell">{e.vendor_name}</span></td>
                <td>{e.document_type}</td>
                <td className="mono">{e.document_no}</td>
                <td>{e.due_date ? formatDate(e.due_date) : '—'}</td>
                <td className="num"><Money cents={e.amount} /></td>
                <td className="num"><Money cents={e.remaining_amount} /></td>
                <td>{e.open ? <Pill tone="warn">Open</Pill> : <Pill status="ok">Closed</Pill>}</td>
                <td className="num">
                  <div className="inline" style={{ justifyContent: 'flex-end' }}>
                    {e.open && canApply ? <ApplyEntriesButton entry={e} /> : null}
                    {!e.open && canApply ? <UnapplyButton entryId={e.id} /> : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : <EmptyState icon="📄" title="No vendor ledger entries yet" />}
    </Card>
  );
}

/* ---------------------------------------------------------------- Aged AP */

async function AgedApTab({ asOf, filtersRaw }: { asOf?: string; filtersRaw?: string }) {
  const filters = parseFilters(filtersRaw);
  const [report, postingGroups] = await Promise.all([
    getAgedAccountsPayable({ asOf, filters }),
    listVendorPostingGroups(),
  ]);
  const fields = AGED_AP_FILTER_FIELDS.map((f) =>
    (f.key === 'vendor_posting_group_code' ? { ...f, options: postingGroups.map((g) => ({ value: g.code, label: g.code })) } : f));
  return (
    <>
      <Toolbar>
        <form className="inline" style={{ gap: 8 }}>
          <input type="date" name="asOf" defaultValue={report.as_of} aria-label="As of date" />
          <button type="submit" className="btn sm">Refresh</button>
        </form>
        <DynamicFilterBar fields={fields} />
        <Spacer />
        <ExportButton href="/api/export/aged-ap" params={{ asOf: report.as_of, filters: filtersRaw }} disabled={!report.rows.length} />
      </Toolbar>
      <Card>
        <CardHead title="Aged Accounts Payable" sub={`As of ${formatDate(report.as_of)}, aged by ${report.aging_by.toLowerCase()}`} />
        {report.rows.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th>Vendor</th><th className="num">Balance</th>
                {report.bucket_labels.map((l) => <th key={l} className="num">{l}</th>)}
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.vendor_id}>
                  <td>{r.vendor_no} <span className="tiny muted-cell">{r.vendor_name}</span></td>
                  <td className="num"><Money cents={r.balance} /></td>
                  <td className="num"><Money cents={r.not_due} /></td>
                  <td className="num"><Money cents={r.bucket_1} /></td>
                  <td className="num"><Money cents={r.bucket_2} /></td>
                  <td className="num"><Money cents={r.bucket_3} /></td>
                  <td className="num"><Money cents={r.bucket_over} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Totals</td>
                <td className="num"><Money cents={report.totals.balance} /></td>
                <td className="num"><Money cents={report.totals.not_due} /></td>
                <td className="num"><Money cents={report.totals.bucket_1} /></td>
                <td className="num"><Money cents={report.totals.bucket_2} /></td>
                <td className="num"><Money cents={report.totals.bucket_3} /></td>
                <td className="num"><Money cents={report.totals.bucket_over} /></td>
              </tr>
            </tfoot>
          </TableWrap>
        ) : <EmptyState icon="📊" title="No open payables" />}
      </Card>
    </>
  );
}

async function StatementTab({ vendorNo, from, to }: { vendorNo?: string; from?: string; to?: string }) {
  const vendors = await listActiveVendors();
  return (
    <Card>
      <CardHead title="Vendor Statement" sub="Opening balance, movements and closing balance for a date range" />
      <VendorStatementPanel vendors={vendors} vendorNo={vendorNo} from={from} to={to} />
    </Card>
  );
}

/* ----------------------------------------------------------------- Setup tabs */

async function SetupTab() {
  return <PurchasesPayablesSetupCard />;
}
