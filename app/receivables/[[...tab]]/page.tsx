import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireAction, currentCanAction, requireModuleTab } from '@/lib/session';
import { parseFilters } from '@/lib/listFilters';
import { parseSort } from '@/lib/listSort';
import { listPostableAccounts, listActiveBankAccounts } from '@/lib/gl';
import { listItems } from '@/lib/items';
import { listActiveLocations } from '@/lib/inventorySetup';
import { listFixedAssets } from '@/lib/fixedAssets';
import {
  listCustomers, hasAnyCustomers, CUSTOMER_FILTER_FIELDS, listActiveCustomers, getCustomerLedgerEntries,
} from '@/lib/customers';
import {
  listSalesDocuments, hasAnySalesDocuments, salesDocCounts, SALES_DOC_FILTER_FIELDS,
  SALES_DOC_VIEWS, type SalesDocView,
} from '@/lib/salesDocuments';
import { listReminders, hasAnyReminders } from '@/lib/reminders';
import {
  listCustomerPostingGroups, listPaymentTerms, listPaymentMethods, listActivePaymentTerms, listActivePaymentMethods,
  listReminderTerms, listReminderLevels, listFinanceChargeTerms,
} from '@/lib/receivablesSetup';
import { getAgedAccountsReceivable, AGED_AR_FILTER_FIELDS } from '@/lib/receivablesReports';
import { findPendingRoutedTask, isEligibleApprover } from '@/lib/workflow';
import { SalesReceivablesSetupCard } from '@/components/admin/module-setup-cards';
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
import type { PostedSalesDocumentType, SalesDocumentType } from '@/lib/types';
import {
  NewCustomerButton, CustomerPostingGroupFormButton, PaymentTermsFormButton, PaymentMethodFormButton,
  FinanceChargeTermsFormButton, ReminderTermsFormButton,
} from '../receivables-forms';
import { NewSalesDocumentButton } from '../sales-document-form';
import {
  MakeOrderButton, SubmitDocButton, CancelApprovalButton, ApproveDocButton, RejectDocButton, ReopenDocButton,
  DeleteDocButton, PostSalesDocButton, IssueReminderButton,
} from '../document-actions';
import { ReminderBatchPanel } from '../reminder-batch';
import { ApplyEntriesButton, UnapplyButton } from '../apply-entries';
import { CustomerStatementPanel } from '../statement-panel';

/** Business Central splits a document list by where it stands in approval. "Approved" is BC's
 *  Released, and "Rejected" is the Open documents an approver sent back (see lib/salesDocuments
 *  .ts's VIEW_CLAUSE) — the four buckets are disjoint, so All is their sum. */
const VIEW_LABELS: Record<SalesDocView, string> = {
  all: 'All', open: 'Open', pending: 'Pending Approval', released: 'Approved', rejected: 'Rejected',
};

/** Each tab is a page of its own (lib/permissions.ts PAGES, parent RECEIVABLES), so a permission
 *  set can open this module and still be kept out of particular screens. */
const TAB_PAGE: Record<string, string> = {
  customers: 'RECEIVABLES_CUSTOMERS',
  quotes: 'RECEIVABLES_QUOTES',
  orders: 'RECEIVABLES_ORDERS',
  'sales-invoices': 'RECEIVABLES_SALES_INVOICES',
  'credit-memos': 'RECEIVABLES_CREDIT_MEMOS',
  'posted-documents': 'RECEIVABLES_POSTED',
  reminders: 'RECEIVABLES_REMINDERS',
  'finance-charges': 'RECEIVABLES_FINANCE_CHARGES',
  'ledger-entries': 'RECEIVABLES_LEDGER',
  'aged-ar': 'RECEIVABLES_AGED_AR',
  statement: 'RECEIVABLES_STATEMENT',
  'reminder-terms': 'RECEIVABLES_REMINDER_TERMS',
  setup: 'RECEIVABLES_SETUP',
};

const TABS: TabDefinition[] = [
  { key: 'customers', label: 'Customers' },
  { key: 'quotes', label: 'Quotes' },
  { key: 'orders', label: 'Orders' },
  { key: 'sales-invoices', label: 'Sales Invoices' },
  { key: 'credit-memos', label: 'Credit Memos' },
  { key: 'posted-documents', label: 'Posted' },
  { key: 'reminders', label: 'Reminders' },
  { key: 'finance-charges', label: 'Finance Charges' },
  { key: 'ledger-entries', label: 'Cust. Ledger' },
  { key: 'aged-ar', label: 'Aged AR' },
  { key: 'statement', label: 'Statement' },
  { key: 'reminder-terms', label: 'Reminder Terms' },
  { key: 'setup', label: 'Setup' },
];

/** Screens that used to be tabs here and are now Setup Pool master data. */
const MOVED_TO_POOL: Record<string, string> = {
  'posting-groups': '/admin/pool/finance/customer-posting-groups',
  'payment-terms': '/admin/pool/finance/payment-terms',
  'payment-methods': '/admin/pool/finance/payment-methods',
};

export default async function ReceivablesPage({ params, searchParams }: {
  params: Promise<{ tab?: string[] }>;
  searchParams: Promise<{ q?: string; filters?: string; sort?: string; view?: string; customer?: string; asOf?: string; from?: string; to?: string }>;
}) {
  const user = await requireAction('RECEIVABLES_READ');
  const { tab: segments } = await params;
  const sp = await searchParams;
  const tab = segments?.[0] ?? 'customers';
  // Payment Terms, Payment Methods and Customer Posting Groups are admin master data now, kept
  // in Admin Centre → Setup Pool → Finance. Old links still work; they land where it lives.
  const moved = MOVED_TO_POOL[tab];
  if (moved) redirect(moved);
  if (!TABS.some((t) => t.key === tab)) notFound();
  const hrefFor = (k: string) => `/receivables/${k === 'customers' ? '' : k}`;
  const tabs = requireModuleTab(user, TABS, TAB_PAGE, tab, !segments?.[0], hrefFor);

  return (
    <Page title="Receivables" crumb="Customers, sales invoices, cash receipts, reminders and aging" user={user}>
      <Tabs tabs={tabs} active={tab} hrefFor={hrefFor} />
      {tab === 'customers' ? <CustomersTab search={sp.q ?? ''} filtersRaw={sp.filters} sortRaw={sp.sort} /> : null}
      {tab === 'quotes' ? <SalesDocTab documentType="Quote" tab={tab} view={sp.view} search={sp.q ?? ''} filtersRaw={sp.filters} sortRaw={sp.sort} username={user.username} userId={user.id} /> : null}
      {tab === 'orders' ? <SalesDocTab documentType="Order" tab={tab} view={sp.view} search={sp.q ?? ''} filtersRaw={sp.filters} sortRaw={sp.sort} username={user.username} userId={user.id} /> : null}
      {tab === 'sales-invoices' ? <SalesDocTab documentType="Invoice" tab={tab} view={sp.view} search={sp.q ?? ''} filtersRaw={sp.filters} sortRaw={sp.sort} username={user.username} userId={user.id} /> : null}
      {tab === 'credit-memos' ? <SalesDocTab documentType="Credit Memo" tab={tab} view={sp.view} search={sp.q ?? ''} filtersRaw={sp.filters} sortRaw={sp.sort} username={user.username} userId={user.id} /> : null}
      {tab === 'posted-documents' ? <PostedDocsTab search={sp.q ?? ''} view={sp.view} /> : null}
      {tab === 'reminders' ? <RemindersTab kind="Reminder" search={sp.q ?? ''} /> : null}
      {tab === 'finance-charges' ? <RemindersTab kind="Finance Charge Memo" search={sp.q ?? ''} /> : null}
      {tab === 'ledger-entries' ? <LedgerTab /> : null}
      {tab === 'aged-ar' ? <AgedArTab asOf={sp.asOf} filtersRaw={sp.filters} /> : null}
      {tab === 'statement' ? <StatementTab customerNo={sp.customer} from={sp.from} to={sp.to} /> : null}
      {tab === 'reminder-terms' ? <ReminderTermsTab /> : null}
      {tab === 'setup' ? <SetupTab /> : null}
    </Page>
  );
}

async function customerFormProps() {
  const [postingGroups, paymentTerms, paymentMethods, reminderTerms, finChargeTerms] = await Promise.all([
    listCustomerPostingGroups(), listPaymentTerms(), listPaymentMethods(), listReminderTerms(), listFinanceChargeTerms(),
  ]);
  return { postingGroups, paymentTerms, paymentMethods, reminderTerms, finChargeTerms };
}

/* ------------------------------------------------------------------ Customers */

async function CustomersTab({ search, filtersRaw, sortRaw }: { search: string; filtersRaw?: string; sortRaw?: string }) {
  const filters = parseFilters(filtersRaw);
  const sort = parseSort(sortRaw);
  const [rows, empty, canManage, fp] = await Promise.all([
    listCustomers({ search, filters, sort }),
    hasAnyCustomers().then((a) => !a),
    currentCanAction('RECEIVABLES_CUSTOMER_MANAGE'),
    customerFormProps(),
  ]);
  const fields = CUSTOMER_FILTER_FIELDS.map((f) =>
    (f.key === 'customer_posting_group_code' ? { ...f, options: fp.postingGroups.map((g) => ({ value: g.code, label: g.code })) } : f));

  return (
    <>
      <Toolbar>
        <SearchInput placeholder="Search customer no., name, city…" disabled={empty} />
        <DynamicFilterBar fields={fields} disabled={empty} />
        <Spacer />
        {canManage ? <NewCustomerButton {...fp}>New customer</NewCustomerButton> : null}
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
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="mono"><Link href={`/receivables/customers/${encodeURIComponent(c.no)}`}>{c.no}</Link></td>
                  <td>{c.name}</td>
                  <td className="muted-cell">{c.city ?? '—'}</td>
                  <td className="mono muted-cell">{c.customer_posting_group_code ?? '—'}</td>
                  <td className="mono muted-cell">{c.payment_terms_code ?? '—'}</td>
                  <td className="num"><Money cents={c.balance} /></td>
                  <td className="num">{c.balance_due > 0 ? <span className="bad"><Money cents={c.balance_due} /></span> : <Money cents={0} />}</td>
                  <td>
                    {c.blocked ? <Pill tone="bad">Blocked: {c.blocked}</Pill>
                      : c.credit_limit_exceeded ? <Pill tone="warn">Over limit</Pill>
                        : <Pill status="ok">Active</Pill>}
                  </td>
                  <td className="num">
                    <Link href={`/receivables/customers/${encodeURIComponent(c.no)}`} className="btn sm ghost">View card</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="👤" title={empty ? 'No customers yet' : 'No customers match'} />}
      </Card>
    </>
  );
}

/* ------------------------------------------------------------ Sales Documents */

async function SalesDocTab({ documentType, tab, view: viewRaw, search, filtersRaw, sortRaw, username, userId }: {
  documentType: SalesDocumentType; tab: string; view?: string;
  search: string; filtersRaw?: string; sortRaw?: string; username: string; userId: number;
}) {
  const filters = parseFilters(filtersRaw);
  const sort = parseSort(sortRaw);
  const view: SalesDocView = SALES_DOC_VIEWS.includes(viewRaw as SalesDocView)
    ? (viewRaw as SalesDocView) : 'all';
  const [rows, empty, canCreate, canApprove, canPost, customers, accounts, items, fixedAssets, locations, paymentTerms, paymentMethods, counts] = await Promise.all([
    listSalesDocuments({ documentType, view, search, filters, sort }),
    hasAnySalesDocuments(documentType).then((a) => !a),
    currentCanAction('RECEIVABLES_SALES_CREATE'),
    currentCanAction('RECEIVABLES_SALES_APPROVE'),
    currentCanAction('RECEIVABLES_SALES_POST'),
    listActiveCustomers(),
    listPostableAccounts(),
    listItems(),
    listFixedAssets(),
    listActiveLocations(),
    listActivePaymentTerms(),
    listActivePaymentMethods(),
    salesDocCounts(documentType),
  ]);
  // Release / Reject belong to whoever each document is sitting with: the approver its workflow
  // routed it to, or — when no workflow matched — anyone holding the approve permission.
  const routedTasks = new Map(await Promise.all(
    rows.filter((r) => r.status === 'Pending Approval')
      .map((r) => findPendingRoutedTask('SALES_DOCUMENT', r.no).then((t) => [r.no, t] as const)),
  ));
  const canDecide = new Map(await Promise.all(
    [...routedTasks].map(async ([no, task]) =>
      [no, task ? await isEligibleApprover(task, userId) : canApprove] as const),
  ));
  const fields = SALES_DOC_FILTER_FIELDS.map((f) =>
    (f.key === 'customer_id' ? { ...f, options: customers.map((c) => ({ value: c.id, label: `${c.no} — ${c.name}` })) } : f));
  const formProps = {
    customers, paymentTerms, paymentMethods,
    accounts: accounts.map((a) => ({ code: a.code, name: a.name })),
    items: items.map((i) => ({ no: i.no, description: i.description })),
    fixedAssets: fixedAssets.filter((a) => !a.disposed).map((a) => ({ no: a.no, description: a.description })),
    locations: locations.map((l) => ({ code: l.code, name: l.name })),
  };

  const viewHref = (key: string) => {
    const params = new URLSearchParams();
    if (key !== 'all') params.set('view', key);
    if (search) params.set('q', search);
    if (filtersRaw) params.set('filters', filtersRaw);
    if (sortRaw) params.set('sort', sortRaw);
    const qs = params.toString();
    return `/receivables/${tab}${qs ? `?${qs}` : ''}`;
  };

  return (
    <>
      <Tabs
        tabs={SALES_DOC_VIEWS.map((v) => ({ key: v, label: `${VIEW_LABELS[v]} (${counts[v]})` }))}
        active={view} hrefFor={viewHref}
      />
      <Toolbar>
        <SearchInput placeholder="Search no., customer, reference…" disabled={empty} />
        <DynamicFilterBar fields={fields} disabled={empty} />
        <Spacer />
        {canCreate && documentType !== 'Order' ? <NewSalesDocumentButton documentType={documentType} {...formProps} /> : null}
      </Toolbar>
      <Card>
        {rows.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th><SortLink sortKey="no">No.</SortLink></th>
                <th><SortLink sortKey="customer">Customer</SortLink></th>
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
                    <td className="mono"><Link href={`/receivables/documents/${encodeURIComponent(d.no)}`}>{d.no}</Link></td>
                    <td>{d.customer_no} <span className="tiny muted-cell">{d.customer_name}</span></td>
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
                        {d.status === 'Released' && canPost ? <PostSalesDocButton no={d.no} isOrder={documentType === 'Order'} /> : null}
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
            title={empty ? `No sales ${documentType.toLowerCase()}s yet`
              : view === 'all' ? 'No documents match'
                : `No ${VIEW_LABELS[view].toLowerCase()} ${documentType.toLowerCase()}s`}
          />
        )}
      </Card>
    </>
  );
}

/** The posted record is one table, but nobody browses it as one list: shipments, invoices and
 *  credit memos are looked up for different reasons, so each gets its own sub-tab, as in BC. */
const POSTED_SALES_VIEWS: { key: string; type: PostedSalesDocumentType; label: string; sub: string }[] = [
  { key: 'invoices', type: 'Invoice', label: 'Posted Sales Invoices', sub: 'Invoices posted to the customer ledger' },
  { key: 'shipments', type: 'Shipment', label: 'Posted Sales Shipments', sub: 'Goods shipped — the delivery record behind each order' },
  { key: 'credit-memos', type: 'Credit Memo', label: 'Posted Sales Credit Memos', sub: 'Credit memos posted against the customer ledger' },
];

async function PostedDocsTab({ search, view }: { search: string; view?: string }) {
  const { all } = await import('@/lib/db');
  const current = POSTED_SALES_VIEWS.find((v) => v.key === view) ?? POSTED_SALES_VIEWS[0];
  const [rows, countRows] = await Promise.all([
    all<{
      id: number; no: string; posting_date: string; amount: number;
      customer_no: string; customer_name: string; order_no: string | null;
    }>(
      `SELECT d.id, d.no, d.posting_date, d.amount, d.order_no, c.no AS customer_no, c.name AS customer_name
       FROM posted_sales_document d JOIN customer c ON c.id = d.customer_id
       WHERE d.document_type = @type AND (d.no ILIKE @like OR c.no ILIKE @like OR c.name ILIKE @like)
       ORDER BY d.id DESC LIMIT 500`,
      { type: current.type, like: `%${String(search).trim()}%` },
    ),
    all<{ document_type: string; n: number }>(
      'SELECT document_type, COUNT(*)::int AS n FROM posted_sales_document GROUP BY document_type',
    ),
  ]);
  const counts = new Map(countRows.map((r) => [r.document_type, r.n]));
  return (
    <>
      <Tabs
        tabs={POSTED_SALES_VIEWS.map((v) => ({ key: v.key, label: `${v.label.replace('Posted Sales ', '')} (${counts.get(v.type) ?? 0})` }))}
        active={current.key} hrefFor={(k) => `/receivables/posted-documents?view=${k}`}
      />
      <Toolbar><SearchInput placeholder="Search posted document no. or customer…" /><Spacer /></Toolbar>
      <Card>
        <CardHead title={current.label} sub={current.sub} />
        {rows.length ? (
          <TableWrap>
            <thead><tr><th>No.</th><th>Customer</th><th>Order</th><th>Date</th><th className="num">Amount</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="mono"><Link href={`/receivables/posted/${encodeURIComponent(r.no)}`}>{r.no}</Link></td>
                  <td>{r.customer_no} <span className="tiny muted-cell">{r.customer_name}</span></td>
                  <td className="mono muted-cell">{r.order_no ?? '—'}</td>
                  <td>{formatDate(r.posting_date)}</td>
                  <td className="num"><Money cents={r.amount} /></td>
                  <td className="num">
                    <a className="btn sm ghost" href={`/print/posted-sales/${encodeURIComponent(r.no)}`} target="_blank" rel="noreferrer">Print</a>
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

/* ------------------------------------------------------------- Cash Receipts */

/* -------------------------------------------------------------- Reminders */

async function RemindersTab({ kind, search }: { kind: 'Reminder' | 'Finance Charge Memo'; search: string }) {
  const [rows, empty, canManage, customers] = await Promise.all([
    listReminders({ documentType: kind, search }),
    hasAnyReminders(kind).then((a) => !a),
    currentCanAction('RECEIVABLES_REMINDER_MANAGE'),
    listActiveCustomers(),
  ]);
  return (
    <>
      {canManage ? (
        <Card>
          <CardHead title={kind === 'Reminder' ? 'Create Reminders' : 'Create Finance Charge Memos'} sub="Drafts one document per customer with overdue open entries" />
          <ReminderBatchPanel customers={customers} kind={kind === 'Reminder' ? 'reminder' : 'finance-charge'} />
        </Card>
      ) : null}
      <Toolbar><SearchInput placeholder="Search no. or customer…" disabled={empty} /><Spacer /></Toolbar>
      <Card>
        {rows.length ? (
          <TableWrap>
            <thead><tr><th>No.</th><th>Customer</th><th>Level</th><th className="num">Overdue</th><th className="num">Interest</th><th className="num">Fee</th><th>Status</th><th className="num" /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.no} className={r.status === 'Issued' ? 'muted' : undefined}>
                  <td className="mono">{r.no}</td>
                  <td>{r.customer_no} <span className="tiny muted-cell">{r.customer_name}</span></td>
                  <td>{kind === 'Reminder' ? r.reminder_level : '—'}</td>
                  <td className="num"><Money cents={r.remaining_amount} /></td>
                  <td className="num"><Money cents={r.interest_amount} /></td>
                  <td className="num"><Money cents={r.additional_fee} /></td>
                  <td><Pill status={r.status === 'Issued' ? 'ok' : ''}>{r.status}</Pill></td>
                  <td className="num">
                    <div className="inline" style={{ justifyContent: 'flex-end' }}>
                      {r.status === 'Open' && canManage ? (<><IssueReminderButton no={r.no} /><DeleteDocButton no={r.no} kind="reminder" /></>) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="⏰" title={empty ? `No ${kind.toLowerCase()}s yet` : 'Nothing matches'} />}
      </Card>
    </>
  );
}

/* -------------------------------------------------------------- Cust. Ledger */

async function LedgerTab() {
  const [rows, canApply] = await Promise.all([
    getCustomerLedgerEntries(),
    currentCanAction('RECEIVABLES_APPLY_ENTRIES'),
  ]);
  return (
    <Card>
      <CardHead title="Cust. Ledger Entries" sub="Every invoice, credit memo, payment, reminder and finance charge posted against a customer" />
      {rows.length ? (
        <TableWrap>
          <thead><tr><th>Date</th><th>Customer</th><th>Type</th><th>Document</th><th>Due</th><th className="num">Amount</th><th className="num">Remaining</th><th>Open</th><th className="num" /></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className={e.open ? undefined : 'muted'}>
                <td>{formatDate(e.posting_date)}</td>
                <td>{e.customer_no} <span className="tiny muted-cell">{e.customer_name}</span></td>
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
      ) : <EmptyState icon="📄" title="No customer ledger entries yet" />}
    </Card>
  );
}

/* ---------------------------------------------------------------- Aged AR */

async function AgedArTab({ asOf, filtersRaw }: { asOf?: string; filtersRaw?: string }) {
  const filters = parseFilters(filtersRaw);
  const [report, postingGroups] = await Promise.all([
    getAgedAccountsReceivable({ asOf, filters }),
    listCustomerPostingGroups(),
  ]);
  const fields = AGED_AR_FILTER_FIELDS.map((f) =>
    (f.key === 'customer_posting_group_code' ? { ...f, options: postingGroups.map((g) => ({ value: g.code, label: g.code })) } : f));
  return (
    <>
      <Toolbar>
        <form className="inline" style={{ gap: 8 }}>
          <input type="date" name="asOf" defaultValue={report.as_of} aria-label="As of date" />
          <button type="submit" className="btn sm">Refresh</button>
        </form>
        <DynamicFilterBar fields={fields} />
        <Spacer />
        <ExportButton href="/api/export/aged-ar" params={{ asOf: report.as_of, filters: filtersRaw }} disabled={!report.rows.length} />
      </Toolbar>
      <Card>
        <CardHead title="Aged Accounts Receivable" sub={`As of ${formatDate(report.as_of)}, aged by ${report.aging_by.toLowerCase()}`} />
        {report.rows.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th>Customer</th><th className="num">Balance</th>
                {report.bucket_labels.map((l) => <th key={l} className="num">{l}</th>)}
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.customer_id}>
                  <td>{r.customer_no} <span className="tiny muted-cell">{r.customer_name}</span></td>
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
        ) : <EmptyState icon="📊" title="No open receivables" />}
      </Card>
    </>
  );
}

async function StatementTab({ customerNo, from, to }: { customerNo?: string; from?: string; to?: string }) {
  const customers = await listActiveCustomers();
  return (
    <Card>
      <CardHead title="Customer Statement" sub="Opening balance, movements and closing balance for a date range" />
      <CustomerStatementPanel customers={customers} customerNo={customerNo} from={from} to={to} />
    </Card>
  );
}

/* ----------------------------------------------------------------- Setup tabs */

async function ReminderTermsTab() {
  const [terms, fcTerms, canManage] = await Promise.all([
    listReminderTerms(), listFinanceChargeTerms(), currentCanAction('RECEIVABLES_SETUP_MANAGE'),
  ]);
  const levelsByTerms = new Map(await Promise.all(terms.map((t) => listReminderLevels(t.code).then((l) => [t.code, l] as const))));
  return (
    <>
      <Card>
        <CardHead title="Reminder Terms" sub="Reminder levels with grace period, interest and fee">
          {canManage ? <ReminderTermsFormButton>New terms</ReminderTermsFormButton> : null}
        </CardHead>
        {terms.length ? (
          <TableWrap>
            <thead><tr><th>Code</th><th>Description</th><th className="num">Max</th><th>Levels</th><th>Post Interest</th><th>Post Fee</th><th /></tr></thead>
            <tbody>
              {terms.map((t) => (
                <tr key={t.id}>
                  <td className="mono">{t.code}</td><td>{t.description}</td><td className="num">{t.max_no_of_reminders}</td>
                  <td>{(levelsByTerms.get(t.code) ?? []).length}</td>
                  <td>{t.post_interest ? 'Yes' : 'No'}</td><td>{t.post_additional_fee ? 'Yes' : 'No'}</td>
                  <td>{canManage ? <ReminderTermsFormButton row={t} initialLevels={levelsByTerms.get(t.code)} className="btn sm ghost">Edit</ReminderTermsFormButton> : null}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="⏰" title="No reminder terms yet" />}
      </Card>
      <Card>
        <CardHead title="Finance Charge Terms" sub="Interest and fees charged on overdue balances">
          {canManage ? <FinanceChargeTermsFormButton>New terms</FinanceChargeTermsFormButton> : null}
        </CardHead>
        {fcTerms.length ? (
          <TableWrap>
            <thead><tr><th>Code</th><th>Description</th><th className="num">Rate % p.a.</th><th className="num">Min Amount</th><th>Post Interest</th><th /></tr></thead>
            <tbody>
              {fcTerms.map((f) => (
                <tr key={f.id}>
                  <td className="mono">{f.code}</td><td>{f.description}</td><td className="num">{f.interest_rate}</td>
                  <td className="num"><Money cents={f.min_amount} /></td><td>{f.post_interest ? 'Yes' : 'No'}</td>
                  <td>{canManage ? <FinanceChargeTermsFormButton row={f} className="btn sm ghost">Edit</FinanceChargeTermsFormButton> : null}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="📈" title="No finance charge terms yet" />}
      </Card>
    </>
  );
}

async function SetupTab() {
  return <SalesReceivablesSetupCard />;
}
