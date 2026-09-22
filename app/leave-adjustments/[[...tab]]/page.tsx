import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import { listLeaveAdjustments, listLeaveTypes, type AdjustmentView } from '@/lib/leaveManagement';
import { Page } from '@/components/layout/page';
import { Card, EmptyState, Pill, TableWrap, Tabs, Toolbar, Spacer, type TabDefinition } from '@/components/ui/primitives';
import { NewAdjustmentButton, SubmitButton, CancelApprovalButton, DeleteButton } from '../adjustment-actions';

const TABS: TabDefinition[] = [
  { key: 'open', label: 'Open', tone: 'info' },
  { key: 'pending', label: 'Pending Approval', tone: 'warn' },
  { key: 'approved', label: 'Approved', tone: 'ok' },
];

export default async function LeaveAdjustmentsPage({ params }: { params: Promise<{ tab?: string[] }> }) {
  const user = await requireAction('LEAVE_ADJUSTMENTS_READ');
  const { tab: segments } = await params;
  const requested = segments?.[0];
  if (requested && !TABS.some((t) => t.key === requested)) notFound();
  const tab = (requested ?? 'open') as AdjustmentView;

  const [rows, canCreate, leaveTypes] = await Promise.all([
    listLeaveAdjustments(tab),
    currentCanAction('LEAVE_ADJUSTMENTS_CREATE'),
    listLeaveTypes(),
  ]);

  return (
    <Page title="Leave Adjustments" crumb="Bulk manual balance corrections" user={user}>
      <Tabs tabs={TABS} active={tab} hrefFor={(k) => `/leave-adjustments/${k}`} />
      <Toolbar>
        <Spacer />
        {canCreate ? <NewAdjustmentButton leaveTypes={leaveTypes} /> : null}
      </Toolbar>

      <Card>
        {rows.length ? (
          <TableWrap>
            <thead>
              <tr><th>No.</th><th>Leave Type</th><th>Type</th><th className="num">Days</th><th className="num">Employees</th><th>Status</th><th className="num" /></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isOwn = r.created_by === user.username;
                return (
                  <tr key={r.no}>
                    <td className="mono"><Link href={`/leave-adjustments/view/${r.no}`}>{r.no}</Link></td>
                    <td>{r.leave_type_name}</td>
                    <td><Pill tone={r.type === 'NEGATIVE' ? 'warn' : 'ok'}>{r.type === 'NEGATIVE' ? 'Negative' : 'Positive'}</Pill></td>
                    <td className="num">{r.days}</td>
                    <td className="num">{r.line_count}</td>
                    <td><Pill status={r.status} /></td>
                    <td className="num">
                      {r.status === 'Open' && canCreate && isOwn ? <>
                        <DeleteButton no={r.no} />{' '}<SubmitButton no={r.no} />
                      </> : null}
                      {r.status === 'Pending Approval' && canCreate && isOwn ? <CancelApprovalButton no={r.no} /> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="⚖" title="No leave adjustments here" />}
      </Card>
    </Page>
  );
}
