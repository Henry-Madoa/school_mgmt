import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import { listRequisitions, hasAnyRequisitions, requisitionCounts, type RequisitionListView } from '@/lib/requisitions';
import { requisitionLookups } from '../lookups';
import { formatDate } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { Card, EmptyState, TableWrap, Tabs, Toolbar, Spacer, type TabDefinition } from '@/components/ui/primitives';
import { SearchInput } from '@/components/ui/filters';
import { Money } from '@/components/ui/money';
import { NewRequisitionButton, SubmitRequisitionButton, CancelRequisitionApprovalButton, ConfirmReceiptButton } from '../requisition-actions';
import { RequisitionStatusPill } from '../status-pill';
import type { RequisitionType } from '@/lib/types';

export const dynamic = 'force-dynamic';

const TABS: TabDefinition[] = [
  { key: 'store', label: 'Store Requisitions' },
  { key: 'purchase', label: 'Purchase Requisitions' },
];
const TYPE_OF: Record<string, RequisitionType> = { store: 'Store Requisition', purchase: 'Purchase Requisition' };

const STORE_VIEWS: { key: RequisitionListView; label: string }[] = [
  { key: 'open', label: 'Open' }, { key: 'pending', label: 'Pending Approval' }, { key: 'approved', label: 'Approved — to issue' },
  { key: 'issued', label: 'Issued' }, { key: 'received', label: 'Received' }, { key: 'all', label: 'All' },
];
const PURCHASE_VIEWS: { key: RequisitionListView; label: string }[] = [
  { key: 'open', label: 'Open' }, { key: 'pending', label: 'Pending Approval' }, { key: 'approved', label: 'Approved — under review' },
  { key: 'closed', label: 'Closed' }, { key: 'all', label: 'All' },
];

export default async function RequisitionsPage({ params, searchParams }: {
  params: Promise<{ tab?: string[] }>;
  searchParams: Promise<{ q?: string; view?: string }>;
}) {
  const user = await requireAction('REQUISITIONS_READ');
  const { tab: segments } = await params;
  const sp = await searchParams;
  const requested = segments?.[0];
  if (requested && !TABS.some((t) => t.key === requested)) notFound();
  const tab = requested ?? 'store';
  const type = TYPE_OF[tab];
  const views = tab === 'store' ? STORE_VIEWS : PURCHASE_VIEWS;
  const view: RequisitionListView = views.some((v) => v.key === sp.view) ? (sp.view as RequisitionListView) : 'open';
  const search = sp.q ?? '';
  const [rows, empty, counts, canCreate, lookups] = await Promise.all([
    listRequisitions(type, view, search), hasAnyRequisitions(type, view).then((a) => !a), requisitionCounts(type),
    currentCanAction('REQUISITIONS_CREATE'), currentCanAction('REQUISITIONS_CREATE').then((c) => (c ? requisitionLookups() : null)),
  ]);
  const isStore = type === 'Store Requisition';

  return (
    <Page title="Requisitions" crumb="Store requisitions issue stock out of inventory; purchase requisitions feed Payables" user={user}>
      <Tabs tabs={TABS} active={tab} hrefFor={(k) => `/requisitions/${k === 'store' ? '' : k}`} />
      <Tabs tabs={views.map((v) => ({ key: v.key, label: `${v.label}${counts[v.key] ? ` (${counts[v.key]})` : ''}` }))} active={view} hrefFor={(k) => `/requisitions/${tab}?view=${k}`} />
      <Toolbar>
        <SearchInput placeholder="Search requisition no., title or employee…" disabled={empty} />
        <Spacer />
        {canCreate && lookups ? <NewRequisitionButton type={type} lookups={lookups} /> : null}
      </Toolbar>
      <Card>
        {rows.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th>No.</th><th>Title</th><th>Requested by</th><th>Date</th><th>Needed by</th>
                {isStore ? <><th>Store</th><th className="num">Qty req. / appr. / issued</th></> : <><th>Method</th><th className="num">Est. amount</th><th className="num">Lines</th></>}
                <th>Status</th><th className="num" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.no}>
                  <td className="mono"><Link href={`/requisitions/view/${r.no}`}>{r.no}</Link></td>
                  <td><b>{r.title}</b>{r.description ? <div className="tiny muted-cell">{r.description.slice(0, 80)}</div> : null}</td>
                  <td>{r.first_name} {r.last_name}<div className="tiny mono">{r.employee_no}</div></td>
                  <td>{formatDate(r.requisition_date)}</td>
                  <td>{r.needed_by_date ? formatDate(r.needed_by_date) : '—'}</td>
                  {isStore ? (
                    <><td className="mono">{r.location_code || '—'}</td><td className="num">{r.total_quantity} / {r.total_quantity_approved} / {r.total_quantity_issued}</td></>
                  ) : (
                    <><td>{r.procurement_method || '—'}</td><td className="num"><Money cents={r.total_amount} /></td><td className="num">{r.lines_processed}/{r.lines}</td></>
                  )}
                  <td><RequisitionStatusPill r={r} /></td>
                  <td className="num">
                    <div className="inline" style={{ justifyContent: 'flex-end' }}>
                      {r.status === 'Open' && canCreate && r.created_by === user.username ? <SubmitRequisitionButton no={r.no} /> : null}
                      {r.status === 'Pending Approval' && canCreate && r.created_by === user.username ? <CancelRequisitionApprovalButton no={r.no} /> : null}
                      {isStore && r.issued && r.status === 'Approved' && r.created_by === user.username ? <ConfirmReceiptButton no={r.no} /> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : (
          <EmptyState icon="📋" title={isStore ? 'No store requisitions here' : 'No purchase requisitions here'}
            sub={isStore ? 'An employee asks the store for stock items; once approved the store issues them and the requester confirms receipt.'
              : 'An employee asks procurement to buy; once approved each line is turned into a purchase quote or order.'} />
        )}
      </Card>
    </Page>
  );
}
