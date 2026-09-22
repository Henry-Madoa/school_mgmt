import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import { getLeaveRecall } from '@/lib/leaveManagement';
import { findPendingRoutedTask, isEligibleApprover, listWorkflowTasksForDocument } from '@/lib/workflow';
import { formatDateTime } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { DefinitionList, EmptyState, Pill, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { DocumentActionsMenu } from '@/components/ui/document-actions';
import {
  SubmitButton, CancelApprovalButton, ApproveButton, RejectButton, DelegateButton, DeleteButton,
} from '../../recall-actions';

export default async function LeaveRecallDetailPage({ params }: { params: Promise<{ no: string }> }) {
  const user = await requireAction('LEAVE_RECALLS_READ');
  const { no } = await params;

  const recall = await getLeaveRecall(no);
  if (!recall) notFound();

  const [canCreate, canApprove, tasks] = await Promise.all([
    currentCanAction('LEAVE_RECALLS_CREATE'),
    currentCanAction('LEAVE_RECALLS_APPROVE'),
    listWorkflowTasksForDocument('LEAVE_RECALL', no),
  ]);

  const isOwn = recall.created_by === user.username;
  const isOpen = recall.status === 'Open';
  const routedTask = recall.status === 'Pending Approval' ? await findPendingRoutedTask('LEAVE_RECALL', no) : null;
  const canDecideThis = routedTask ? await isEligibleApprover(routedTask, user.id) : canApprove;
  const requestedBy = routedTask?.requested_by ?? recall.created_by;
  const canCancelThis = canCreate && requestedBy === user.username;
  const pendingWith = tasks.find((t) => t.status === 'PENDING')?.pending_with;

  return (
    <Page
      title={recall.no}
      crumb={`${recall.status} · ${recall.employee_first_name} ${recall.employee_last_name} (${recall.employee_no})${pendingWith ? ` · pending with ${pendingWith}` : ''}`}
      user={user}
    >
      <Toolbar>
        <Link href="/leave-recalls" className="btn ghost sm">← All recalls</Link>
        <Link href={`/leave-applications/view/${recall.application_no}`} className="btn ghost sm">View source application</Link>
        <Spacer />
        {isOpen && canCreate && isOwn ? <DeleteButton no={recall.no} className="btn ghost" /> : null}
        {isOpen && canCreate && isOwn ? <SubmitButton no={recall.no} className="btn ghost" /> : null}
        {recall.status === 'Pending Approval' && canCancelThis ? <CancelApprovalButton no={recall.no} className="btn ghost" /> : null}
        {recall.status === 'Pending Approval' && canDecideThis ? (
          <>
            {routedTask ? <DelegateButton taskId={routedTask.id} className="btn ghost" /> : null}
            <ApproveButton no={recall.no} />
            <RejectButton no={recall.no} className="btn ghost" />
          </>
        ) : null}
        <DocumentActionsMenu />
      </Toolbar>

      <CollapsibleCard title="Recall details">
        <DefinitionList items={[
          ['No.', <span className="mono" key="no">{recall.no}</span>],
          ['Employee', <>{recall.employee_first_name} {recall.employee_last_name} <span className="mono">({recall.employee_no})</span></>],
          ['Source application', recall.application_no],
          ['Original days applied', recall.application_days_applied],
          ['Application window', `${recall.application_start_date} to ${recall.application_end_date}`],
          ['Days to recall', recall.days_to_recall],
          ['Status', <Pill status={recall.status} key="st" />],
          recall.decision_reason ? ['Decision reason', recall.decision_reason] : null,
        ]} />
      </CollapsibleCard>

      <CollapsibleCard title="Document trail">
        <DefinitionList items={[
          ['Created by', recall.created_by || '—'],
          ['Created on', formatDateTime(recall.created_at)],
        ]} />
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
