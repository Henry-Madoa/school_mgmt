import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction } from '@/lib/session';
import {
  listMyWorkflowTasks, listMyDecidedWorkflowTasks, listMySubmittedWorkflowTasks,
  myPendingWorkflowTaskCount, hasAnyDecidedWorkflowTasks, hasAnySubmittedWorkflowTasks,
  WORKFLOW_TASK_FILTER_FIELDS,
} from '@/lib/workflow';
import { parseFilters } from '@/lib/listFilters';
import { parseSort } from '@/lib/listSort';
import { formatDateTime } from '@/lib/format';
import { Page } from '@/components/layout/page';
import {
  Card, EmptyState, Pill, TableWrap, Tabs, Toolbar, Spacer, type TabDefinition,
} from '@/components/ui/primitives';
import { SearchInput } from '@/components/ui/filters';
import { DynamicFilterBar } from '@/components/ui/dynamic-filter';
import { SortLink } from '@/components/ui/sort-link';
import { Money } from '@/components/ui/money';
import { ExportButton } from '@/components/ui/export-button';
import { TaskActions } from '../task-actions';

type ApprovalsTab = 'open' | 'history' | 'sent';

const TABS: TabDefinition[] = [
  { key: 'open', label: 'Open Approval Requests', tone: 'warn' },
  { key: 'history', label: 'History' },
  { key: 'sent', label: 'Sent for Approval' },
];

const EMPTY_TEXT: Record<ApprovalsTab, string> = {
  open: 'Nothing routed to you right now',
  history: "You haven't decided on anything yet",
  sent: "You haven't sent anything for approval yet",
};

export default async function ApprovalsPage({ params, searchParams }: {
  params: Promise<{ tab?: string[] }>;
  searchParams: Promise<{ q?: string; filters?: string; sort?: string }>;
}) {
  const user = await requireAction('APPROVALS_VIEW');
  const { tab: segments } = await params;
  const { q = '', filters: filtersRaw, sort: sortRaw } = await searchParams;
  const filters = parseFilters(filtersRaw);
  const sort = parseSort(sortRaw);

  const requested = segments?.[0];
  if (requested && !TABS.some((t) => t.key === requested)) notFound();
  const tab = (requested ?? 'open') as ApprovalsTab;

  const options = { search: q, filters, sort };
  const [rows, empty] = tab === 'history'
    ? await Promise.all([
      listMyDecidedWorkflowTasks(user.username, options),
      hasAnyDecidedWorkflowTasks(user.username).then((any) => !any),
    ])
    : tab === 'sent'
      ? await Promise.all([
        listMySubmittedWorkflowTasks(user.username, options),
        hasAnySubmittedWorkflowTasks(user.username).then((any) => !any),
      ])
      : await Promise.all([
        listMyWorkflowTasks(user.id, user.username, options),
        myPendingWorkflowTaskCount(user.id, user.username).then((c) => c === 0),
      ]);

  const showDecision = tab !== 'open';

  return (
    <Page
      title="Approvals"
      crumb="Workflow-routed requests — what's waiting on you, what you've decided, and what you've sent"
      user={user}
    >
      <Tabs tabs={TABS} active={tab} hrefFor={(k) => (k === 'open' ? '/approvals' : `/approvals/${k}`)} />
      <Toolbar>
        <SearchInput placeholder="Search document no., requested by, decided by…" disabled={empty} />
        <DynamicFilterBar fields={WORKFLOW_TASK_FILTER_FIELDS} disabled={empty} />
        <Spacer />
        <ExportButton href="/api/export/approvals" params={{ q, tab, filters: filtersRaw, sort: sortRaw }} disabled={!rows.length} />
      </Toolbar>

      <Card>
        {rows.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th><SortLink sortKey="document_type">Document</SortLink></th>
                <th>Workflow</th>
                <th className="num"><SortLink sortKey="amount">Amount</SortLink></th>
                <th><SortLink sortKey="requested_by">Requested by</SortLink></th>
                <th><SortLink sortKey="requested_at">Requested</SortLink></th>
                {showDecision ? (
                  <>
                    <th><SortLink sortKey="status">Status</SortLink></th>
                    <th><SortLink sortKey="decided_by">Decided by</SortLink></th>
                    <th>Comment</th>
                  </>
                ) : null}
                {tab === 'open' ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><Link href={r.link}>{r.document_label}</Link></td>
                  <td>{r.workflow_name || <span className="tiny">No workflow (permission-based)</span>}</td>
                  <td className="num"><Money cents={r.amount} decimals={0} /></td>
                  <td>{r.requested_by}</td>
                  <td>{formatDateTime(r.requested_at)}</td>
                  {showDecision ? (
                    <>
                      <td><Pill status={r.status} /></td>
                      <td>{r.decided_by || '—'}</td>
                      <td className="muted-cell">{r.comment || ''}</td>
                    </>
                  ) : null}
                  {tab === 'open' ? <td className="num"><TaskActions taskId={r.id} /></td> : null}
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="✔" title={EMPTY_TEXT[tab]} />}
      </Card>
    </Page>
  );
}
