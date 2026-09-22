import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import { getLeaveAdjustment, listAdjustmentLines } from '@/lib/leaveManagement';
import { listActiveEmployees } from '@/lib/employees';
import { findPendingRoutedTask, isEligibleApprover, listWorkflowTasksForDocument } from '@/lib/workflow';
import { formatDateTime } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { DefinitionList, EmptyState, Pill, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { DocumentActionsMenu } from '@/components/ui/document-actions';
import {
  AssignEmployeesButton, SubmitButton, CancelApprovalButton, ApproveButton, RejectButton, DelegateButton, DeleteButton,
} from '../../adjustment-actions';

export default async function LeaveAdjustmentDetailPage({ params }: { params: Promise<{ no: string }> }) {
  const user = await requireAction('LEAVE_ADJUSTMENTS_READ');
  const { no } = await params;

  const adj = await getLeaveAdjustment(no);
  if (!adj) notFound();

  const [canCreate, canApprove, tasks, lines, employees] = await Promise.all([
    currentCanAction('LEAVE_ADJUSTMENTS_CREATE'),
    currentCanAction('LEAVE_ADJUSTMENTS_APPROVE'),
    listWorkflowTasksForDocument('LEAVE_ADJUSTMENT', no),
    listAdjustmentLines(no),
    listActiveEmployees(),
  ]);

  const isOwn = adj.created_by === user.username;
  const isOpen = adj.status === 'Open';
  const routedTask = adj.status === 'Pending Approval' ? await findPendingRoutedTask('LEAVE_ADJUSTMENT', no) : null;
  const canDecideThis = routedTask ? await isEligibleApprover(routedTask, user.id) : canApprove;
  const requestedBy = routedTask?.requested_by ?? adj.created_by;
  const canCancelThis = canCreate && requestedBy === user.username;
  const pendingWith = tasks.find((t) => t.status === 'PENDING')?.pending_with;

  return (
    <Page
      title={`${adj.no} — ${adj.leave_type_name}`}
      crumb={`${adj.status}${pendingWith ? ` · pending with ${pendingWith}` : ''}`}
      user={user}
    >
      <Toolbar>
        <Link href="/leave-adjustments" className="btn ghost sm">← All adjustments</Link>
        <Spacer />
        {isOpen && canCreate && isOwn ? <AssignEmployeesButton no={adj.no} employees={employees} assignedIds={lines.map((l) => l.employee_id)} className="btn ghost" /> : null}
        {isOpen && canCreate && isOwn ? <DeleteButton no={adj.no} className="btn ghost" /> : null}
        {isOpen && canCreate && isOwn ? <SubmitButton no={adj.no} className="btn ghost" /> : null}
        {adj.status === 'Pending Approval' && canCancelThis ? <CancelApprovalButton no={adj.no} className="btn ghost" /> : null}
        {adj.status === 'Pending Approval' && canDecideThis ? (
          <>
            {routedTask ? <DelegateButton taskId={routedTask.id} className="btn ghost" /> : null}
            <ApproveButton no={adj.no} />
            <RejectButton no={adj.no} className="btn ghost" />
          </>
        ) : null}
        <DocumentActionsMenu />
      </Toolbar>

      <CollapsibleCard title="Adjustment details">
        <DefinitionList items={[
          ['No.', <span className="mono" key="no">{adj.no}</span>],
          ['Leave type', adj.leave_type_name],
          ['Type', <Pill tone={adj.type === 'NEGATIVE' ? 'warn' : 'ok'} key="t">{adj.type === 'NEGATIVE' ? 'Negative' : 'Positive'}</Pill>],
          ['Days per employee', adj.days],
          ['Description', adj.description || '—'],
          ['Status', <Pill status={adj.status} key="st" />],
          adj.decision_reason ? ['Decision reason', adj.decision_reason] : null,
        ]} />
      </CollapsibleCard>

      <CollapsibleCard title="Assigned employees" sub={`${lines.length} employee(s)`}>
        {lines.length ? (
          <TableWrap>
            <thead><tr><th>Employee No.</th><th>Name</th><th className="num">Days</th></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="mono">{l.employee_no}</td>
                  <td>{l.employee_first_name} {l.employee_last_name}</td>
                  <td className="num">{l.days}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="👥" title="No employees assigned yet" />}
      </CollapsibleCard>

      <CollapsibleCard title="Approval details" sub={`${tasks.length} approval step${tasks.length === 1 ? '' : 's'} routed`}>
        {tasks.length ? (
          <TableWrap>
            <thead><tr><th>Sent by</th><th>Sent date</th><th>Approver</th><th>Approved on</th><th /></tr></thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id}>
                  <td>{t.requested_by || '—'}</td>
                  <td>{formatDateTime(t.requested_at)}</td>
                  <td className="muted-cell">{t.decided_by || t.pending_with || '—'}</td>
                  <td>{t.decided_at ? formatDateTime(t.decided_at) : '—'}</td>
                  <td><Pill status={t.status} /></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🕓" title="Not yet sent for approval" />}
      </CollapsibleCard>
    </Page>
  );
}
