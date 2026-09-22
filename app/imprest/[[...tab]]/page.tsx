import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import {
  listImprestRequests, hasAnyImprestRequests, listPettyCash, hasAnyPettyCash, listEmployeeLedger, listEmployeeBalances,
  IMPREST_FILTER_FIELDS, type ImprestListView, type PettyCashListView,
} from '@/lib/imprest';
import { imprestLookups } from '../lookups';
import { listStaffClaims, hasAnyStaffClaims, type StaffClaimListView } from '@/lib/staffClaims';
import { NewStaffClaimButton, SubmitClaimButton, CancelClaimApprovalButton, PostClaimButton } from '../staff-claim-actions';
import { getOrg } from '@/lib/org';
import { parseFilters } from '@/lib/listFilters';
import { parseSort } from '@/lib/listSort';
import { formatDate } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { Card, CardHead, EmptyState, Pill, TableWrap, Tabs, Toolbar, Spacer, type TabDefinition } from '@/components/ui/primitives';
import { SearchInput } from '@/components/ui/filters';
import { DynamicFilterBar } from '@/components/ui/dynamic-filter';
import { SortLink } from '@/components/ui/sort-link';
import { Money } from '@/components/ui/money';
import {
  NewImprestButton, NewPettyCashButton, SubmitButton, CancelApprovalButton, IssueButton, SubmitPettyCashButton,
  CancelPettyCashApprovalButton, PostPettyCashButton, TransferToPayrollButton,
} from '../imprest-actions';

export const dynamic = 'force-dynamic';

const TABS: TabDefinition[] = [
  { key: 'requests', label: 'Imprest Requests', tone: 'info' },
  { key: 'issued', label: 'Issued', tone: 'accent' },
  { key: 'overdue', label: 'Overdue', tone: 'warn' },
  { key: 'surrenders', label: 'Surrenders' },
  { key: 'closed', label: 'Closed', tone: 'ok' },
  { key: 'petty-cash', label: 'Petty Cash' },
  { key: 'staff-claims', label: 'Staff Claims' },
  { key: 'ledger', label: 'Employee Ledger' },
];

const REQUEST_VIEWS: { key: ImprestListView; label: string }[] = [
  { key: 'open', label: 'Open' }, { key: 'pending', label: 'Pending Approval' }, { key: 'approved', label: 'Approved' }, { key: 'all', label: 'All' },
];
const SURRENDER_VIEWS: { key: ImprestListView; label: string }[] = [
  { key: 'surrender-pending', label: 'Pending Approval' }, { key: 'surrender-approved', label: 'Approved — to post' },
];
const CLAIM_VIEWS: { key: StaffClaimListView; label: string }[] = [
  { key: 'open', label: 'Open' }, { key: 'pending', label: 'Pending Approval' }, { key: 'approved', label: 'Approved — to pay' },
  { key: 'stopped', label: 'Payment stopped' }, { key: 'posted', label: 'Paid' }, { key: 'all', label: 'All' },
];
const PC_VIEWS: { key: PettyCashListView; label: string }[] = [
  { key: 'open', label: 'Open' }, { key: 'pending', label: 'Pending Approval' }, { key: 'approved', label: 'Approved' },
  { key: 'posted', label: 'Posted' }, { key: 'paid', label: 'Paid' }, { key: 'all', label: 'All' },
];


export default async function ImprestPage({ params, searchParams }: {
  params: Promise<{ tab?: string[] }>;
  searchParams: Promise<{ q?: string; filters?: string; sort?: string; view?: string }>;
}) {
  const user = await requireAction('IMPREST_READ');
  const { tab: segments } = await params;
  const sp = await searchParams;
  const requested = segments?.[0];
  if (requested && !TABS.some((t) => t.key === requested)) notFound();
  const tab = requested ?? 'requests';

  return (
    <Page title="Staff Cash Desk" crumb="Every shilling advanced to, spent by or owed to staff — imprests, surrenders, petty cash, claims and the employee subledger" user={user}>
      <Tabs tabs={TABS} active={tab} hrefFor={(k) => `/imprest/${k === 'requests' ? '' : k}`} />
      {tab === 'petty-cash' ? <PettyCashTab view={sp.view} search={sp.q ?? ''} username={user.username} />
        : tab === 'staff-claims' ? <StaffClaimsTab view={sp.view} search={sp.q ?? ''} username={user.username} />
        : tab === 'ledger' ? <LedgerTab />
          : <ImprestTab tab={tab} view={sp.view} search={sp.q ?? ''} filtersRaw={sp.filters} sortRaw={sp.sort} username={user.username} />}
    </Page>
  );
}

async function ImprestTab({ tab, view, search, filtersRaw, sortRaw, username }: {
  tab: string; view?: string; search: string; filtersRaw?: string; sortRaw?: string; username: string;
}) {
  const listView: ImprestListView = tab === 'requests' ? (REQUEST_VIEWS.some((v) => v.key === view) ? (view as ImprestListView) : 'open')
    : tab === 'surrenders' ? (SURRENDER_VIEWS.some((v) => v.key === view) ? (view as ImprestListView) : 'surrender-pending')
      : tab as ImprestListView;
  const filters = parseFilters(filtersRaw);
  const sort = parseSort(sortRaw);
  const [rows, empty, canCreate, canIssue, canRecover, lookups] = await Promise.all([
    listImprestRequests({ view: listView, search, filters, sort }),
    hasAnyImprestRequests(listView).then((a) => !a),
    currentCanAction('IMPREST_CREATE'), currentCanAction('IMPREST_ISSUE'), currentCanAction('IMPREST_PAYROLL_RECOVER'),
    imprestLookups(),
  ]);
  const fields = IMPREST_FILTER_FIELDS.map((f) => (
    f.key === 'employee_id' ? { ...f, options: lookups.employees.map((e) => ({ value: e.id, label: `${e.employee_no} — ${e.first_name} ${e.last_name}` })) }
      : f.key === 'purpose_code' ? { ...f, options: lookups.purposes.map((p) => ({ value: p.code, label: `${p.code} — ${p.description}` })) }
        : f));
  const subTabs = tab === 'requests' ? REQUEST_VIEWS : tab === 'surrenders' ? SURRENDER_VIEWS : null;
  const base = `/imprest/${tab === 'requests' ? '' : tab}`;

  return (
    <>
      {subTabs ? <Tabs tabs={subTabs.map((v) => ({ key: v.key, label: v.label }))} active={listView} hrefFor={(k) => `${base}?view=${k}`} /> : null}
      <Toolbar>
        <SearchInput placeholder="Search imprest no., employee or purpose…" disabled={empty} />
        <DynamicFilterBar fields={fields} disabled={empty} />
        <Spacer />
        {canCreate && tab === 'requests' ? <NewImprestButton lookups={lookups} /> : null}
      </Toolbar>
      <Card>
        {rows.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th><SortLink sortKey="no">No.</SortLink></th>
                <th><SortLink sortKey="employee">Employee</SortLink></th>
                <th>Purpose</th>
                <th className="num">Requested</th>
                {tab === 'surrenders' || tab === 'closed' ? <th className="num">Spent</th> : null}
                {tab === 'surrenders' || tab === 'closed' ? <th className="num">Difference</th> : null}
                <th><SortLink sortKey="request_date">Date</SortLink></th>
                {tab === 'issued' || tab === 'overdue' ? <th><SortLink sortKey="due_date">Surrender due</SortLink></th> : null}
                <th>Stage</th>
                <th>Status</th>
                <th className="num" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isOwn = r.created_by === username;
                return (
                  <tr key={r.no}>
                    <td className="mono"><Link href={`/imprest/view/${r.no}?view=${listView}`}>{r.no}</Link></td>
                    <td><b>{r.first_name} {r.last_name}</b><div className="tiny mono">{r.employee_no}</div></td>
                    <td>{r.purpose}{r.purpose_code ? <div className="tiny muted-cell">{r.purpose_code}</div> : null}</td>
                    <td className="num"><Money cents={r.request_amount} /></td>
                    {tab === 'surrenders' || tab === 'closed' ? <td className="num"><Money cents={r.surrender_amount} /></td> : null}
                    {tab === 'surrenders' || tab === 'closed' ? (
                      <td className="num">{r.net_refund > 0 ? <span className="ok-text">refund <Money cents={r.net_refund} /></span> : r.net_refund < 0 ? <span className="danger-text">claim <Money cents={-r.net_refund} /></span> : '—'}</td>
                    ) : null}
                    <td>{formatDate(r.request_date)}</td>
                    {tab === 'issued' || tab === 'overdue' ? (
                      <td>{r.due_date ? formatDate(r.due_date) : '—'}{r.overdue_days > 0 ? <div className="tiny danger-text">{r.overdue_days} days overdue</div> : null}</td>
                    ) : null}
                    <td><Pill tone={r.stage === 'Closed' ? 'ok' : r.stage === 'Issued' ? 'accent' : r.stage === 'Surrender' ? 'warn' : 'info'}>{r.stage}</Pill>
                      {r.transferred_to_payroll ? <div className="tiny muted-cell">payroll</div> : null}</td>
                    <td><Pill status={r.posted ? r.surrender_status : r.status} /></td>
                    <td className="num">
                      <div className="inline" style={{ justifyContent: 'flex-end' }}>
                        {!r.posted && r.status === 'Open' && canCreate && isOwn ? <SubmitButton no={r.no} /> : null}
                        {!r.posted && r.status === 'Pending Approval' && canCreate && isOwn ? <CancelApprovalButton no={r.no} /> : null}
                        {!r.posted && r.status === 'Approved' && canIssue ? <IssueButton no={r.no} /> : null}
                        {tab === 'overdue' && canRecover && !r.transferred_to_payroll && r.surrender_status === 'Open' ? <TransferToPayrollButton no={r.no} /> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        ) : (
          <EmptyState icon="🧾" title="Nothing here"
            sub={tab === 'overdue' ? 'No issued imprest is past its surrender due date.' : 'An employee requests an imprest for a purpose; once approved and issued it must be surrendered with receipts, and any difference refunded, claimed or taken through payroll.'} />
        )}
      </Card>
    </>
  );
}

async function PettyCashTab({ view, search, username }: { view?: string; search: string; username: string }) {
  const pcView: PettyCashListView = PC_VIEWS.some((v) => v.key === view) ? (view as PettyCashListView) : 'open';
  const [rows, empty, canCreate, canPost, lookups, org] = await Promise.all([
    listPettyCash(pcView, search), hasAnyPettyCash(pcView).then((a) => !a),
    currentCanAction('IMPREST_CREATE'), currentCanAction('IMPREST_POST'), imprestLookups(), getOrg(),
  ]);
  const limit = Number(org?.petty_cash_limit ?? 0);
  return (
    <>
      <Tabs tabs={PC_VIEWS.map((v) => ({ key: v.key, label: v.label }))} active={pcView} hrefFor={(k) => `/imprest/petty-cash?view=${k}`} />
      <Toolbar>
        <SearchInput placeholder="Search petty cash no., employee or narration…" disabled={empty} />
        <Spacer />
        {canCreate ? <NewPettyCashButton lookups={lookups} limit={limit} /> : null}
      </Toolbar>
      <Card>
        {rows.length ? (
          <TableWrap>
            <thead><tr><th>No.</th><th>Employee</th><th>Narration</th><th>Paid to</th><th className="num">Amount</th><th>Date</th><th>Float</th><th>Status</th><th className="num" /></tr></thead>
            <tbody>
              {rows.map((p) => {
                const isOwn = p.created_by === username;
                return (
                  <tr key={p.no}>
                    <td className="mono"><Link href={`/imprest/petty-cash/${p.no}?view=${pcView}`}>{p.no}</Link></td>
                    <td><b>{p.first_name} {p.last_name}</b><div className="tiny mono">{p.employee_no}</div></td>
                    <td>{p.payment_narration}</td>
                    <td>{p.payment_to || '—'}{p.on_behalf_of ? <div className="tiny muted-cell">o/b/o {p.on_behalf_of}</div> : null}</td>
                    <td className="num"><Money cents={p.total_amount} /></td>
                    <td>{formatDate(p.request_date)}</td>
                    <td className="mono">{p.paying_bank_code || '—'}</td>
                    <td>{p.paid ? <Pill status="ok">Paid</Pill> : p.posted ? <Pill tone="accent">Posted</Pill> : <Pill status={p.status} />}</td>
                    <td className="num">
                      <div className="inline" style={{ justifyContent: 'flex-end' }}>
                        {p.status === 'Open' && canCreate && isOwn ? <SubmitPettyCashButton no={p.no} /> : null}
                        {p.status === 'Pending Approval' && canCreate && isOwn ? <CancelPettyCashApprovalButton no={p.no} /> : null}
                        {p.status === 'Approved' && !p.posted && canPost ? <PostPettyCashButton no={p.no} /> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="💵" title="No petty cash here" sub={`Small expenses paid from a petty cash float${limit ? ` — up to ${(limit / 100).toLocaleString()} each` : ''}; above the limit, an imprest is raised instead.`} />}
      </Card>
    </>
  );
}

async function StaffClaimsTab({ view, search, username }: { view?: string; search: string; username: string }) {
  const cv: StaffClaimListView = CLAIM_VIEWS.some((v) => v.key === view) ? (view as StaffClaimListView) : 'open';
  const [rows, empty, canCreate, canPost, lookups] = await Promise.all([
    listStaffClaims(cv, search), hasAnyStaffClaims(cv).then((a) => !a), currentCanAction('IMPREST_CREATE'), currentCanAction('IMPREST_POST'), imprestLookups(),
  ]);
  return (
    <>
      <Tabs tabs={CLAIM_VIEWS.map((v) => ({ key: v.key, label: v.label }))} active={cv} hrefFor={(k) => `/imprest/staff-claims?view=${k}`} />
      <Toolbar>
        <SearchInput placeholder="Search claim no., employee or description…" disabled={empty} />
        <Spacer />
        {canCreate ? <NewStaffClaimButton lookups={lookups} /> : null}
      </Toolbar>
      <Card>
        {rows.length ? (
          <TableWrap>
            <thead><tr><th>No.</th><th>Employee</th><th>Description</th><th className="num">Claimed</th><th>Date</th><th>Paid</th><th>Status</th><th className="num" /></tr></thead>
            <tbody>
              {rows.map((c) => {
                const isOwn = c.created_by === username;
                return (
                  <tr key={c.no}>
                    <td className="mono"><Link href={`/imprest/staff-claims/${c.no}?view=${cv}`}>{c.no}</Link></td>
                    <td><b>{c.first_name} {c.last_name}</b><div className="tiny mono">{c.employee_no}</div></td>
                    <td>{c.description}</td>
                    <td className="num"><Money cents={c.total_amount} /></td>
                    <td>{formatDate(c.claim_date)}</td>
                    <td>{c.settlement === 'Pay from Payroll' ? 'Payroll' : c.paying_bank_code || '—'}</td>
                    <td>{c.posted ? <Pill status="ok">Paid</Pill> : c.payment_stopped ? <Pill tone="bad">Stopped</Pill> : <Pill status={c.status} />}</td>
                    <td className="num">
                      <div className="inline" style={{ justifyContent: 'flex-end' }}>
                        {c.status === 'Open' && canCreate && isOwn ? <SubmitClaimButton no={c.no} /> : null}
                        {c.status === 'Pending Approval' && canCreate && isOwn ? <CancelClaimApprovalButton no={c.no} /> : null}
                        {c.status === 'Approved' && !c.posted && !c.payment_stopped && canPost ? <PostClaimButton no={c.no} /> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🧾" title="No staff claims here" sub="An employee claims back money spent on the school's business; once approved it is paid from a bank account or through payroll." />}
      </Card>
    </>
  );
}

async function LedgerTab() {
  const [balances, entries] = await Promise.all([listEmployeeBalances(), listEmployeeLedger(undefined, 200)]);
  return (
    <>
      <Card>
        <CardHead title="Employee balances" sub="What each member of staff owes the school on imprests and advances (negative: what the school owes them)" />
        {balances.length ? (
          <TableWrap>
            <thead><tr><th>Employee</th><th className="num">Balance</th><th className="num">Open imprests</th></tr></thead>
            <tbody>
              {balances.map((b) => (
                <tr key={b.employee_id}>
                  <td><b>{b.first_name} {b.last_name}</b> <span className="tiny mono">{b.employee_no}</span></td>
                  <td className="num"><b><Money cents={b.balance} /></b></td>
                  <td className="num">{b.open_imprests}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="👥" title="No employee ledger entries yet" />}
      </Card>
      <Card>
        <CardHead title="Employee ledger entries" sub="The employee subledger — every issue, surrender, refund, claim and payroll recovery, newest first" />
        {entries.length ? (
          <TableWrap>
            <thead><tr><th>Date</th><th>Employee</th><th>Type</th><th>Document</th><th>Description</th><th className="num">Amount</th><th>Journal</th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{formatDate(e.posting_date)}</td>
                  <td>{e.first_name} {e.last_name} <span className="tiny mono">{e.employee_no}</span></td>
                  <td><Pill>{e.entry_type.replace(/_/g, ' ')}</Pill></td>
                  <td className="mono">{e.document_no}</td>
                  <td>{e.description || '—'}</td>
                  <td className="num"><Money cents={e.amount} /></td>
                  <td className="mono">{e.journal_no || '—'}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🧾" title="No entries yet" />}
      </Card>
    </>
  );
}
