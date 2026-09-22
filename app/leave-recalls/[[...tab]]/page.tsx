import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import { listLeaveRecalls, type RecallView } from '@/lib/leaveManagement';
import { listActiveEmployees } from '@/lib/employees';
import { Page } from '@/components/layout/page';
import { Card, EmptyState, Pill, TableWrap, Tabs, Toolbar, Spacer, type TabDefinition } from '@/components/ui/primitives';
import { NewRecallButton, SubmitButton, CancelApprovalButton, DeleteButton } from '../recall-actions';

const TABS: TabDefinition[] = [
  { key: 'open', label: 'Open', tone: 'info' },
  { key: 'pending', label: 'Pending Approval', tone: 'warn' },
  { key: 'approved', label: 'Approved', tone: 'ok' },
];

export default async function LeaveRecallsPage({ params }: { params: Promise<{ tab?: string[] }> }) {
  const user = await requireAction('LEAVE_RECALLS_READ');
  const { tab: segments } = await params;
  const requested = segments?.[0];
  if (requested && !TABS.some((t) => t.key === requested)) notFound();
  const tab = (requested ?? 'open') as RecallView;

  const [rows, canCreate, employees] = await Promise.all([
    listLeaveRecalls(tab), currentCanAction('LEAVE_RECALLS_CREATE'), listActiveEmployees(),
  ]);

  return (
    <Page title="Leave Recalls" crumb="Call an employee back early from approved leave" user={user}>
      <Tabs tabs={TABS} active={tab} hrefFor={(k) => `/leave-recalls/${k}`} />
      <Toolbar>
        <Spacer />
        {canCreate ? <NewRecallButton employees={employees} /> : null}
      </Toolbar>

      <Card>
        {rows.length ? (
          <TableWrap>
            <thead>
              <tr><th>No.</th><th>Employee</th><th>Source Application</th><th className="num">Days to Recall</th><th>Status</th><th className="num" /></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isOwn = r.created_by === user.username;
                return (
                  <tr key={r.no}>
                    <td className="mono"><Link href={`/leave-recalls/view/${r.no}`}>{r.no}</Link></td>
                    <td><b>{r.employee_first_name} {r.employee_last_name}</b><div className="tiny mono">{r.employee_no}</div></td>
                    <td className="mono">{r.application_no}</td>
                    <td className="num">{r.days_to_recall}</td>
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
        ) : <EmptyState icon="↩" title="No leave recalls here" />}
      </Card>
    </Page>
  );
}
