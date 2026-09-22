import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAnyAction, currentCanAction, currentCanAnyAction } from '@/lib/session';
import { assertCanViewEmployeeDocument } from '@/lib/selfService';
import { getLeavePlan, listPlanLines } from '@/lib/leaveManagement';
import { findPendingRoutedTask, isEligibleApprover, listWorkflowTasksForDocument } from '@/lib/workflow';
import { formatDateTime } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { DefinitionList, EmptyState, Pill, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { DocumentActionsMenu } from '@/components/ui/document-actions';
import {
  PlanLinesPanel, SubmitButton, CancelApprovalButton, ApproveButton, RejectButton, DelegateButton, DeleteButton,
} from '../../plan-actions';

export default async function LeavePlanDetailPage({ params }: { params: Promise<{ no: string }> }) {
  const user = await requireAnyAction('LEAVE_PLANS_READ', 'SELF_SERVICE_LEAVE_PLANS_READ');
  const { no } = await params;

  const plan = await getLeavePlan(no);
  if (!plan) notFound();
  // Employee Self Service: an employee reaches only their own plans.
  const { selfService } = await assertCanViewEmployeeDocument(user, 'LEAVE_PLANS_READ', 'SELF_SERVICE_LEAVE_PLANS_READ', plan.employee_id);

  const [canCreate, canApprove, tasks, lines] = await Promise.all([
    currentCanAnyAction('LEAVE_PLANS_CREATE', 'SELF_SERVICE_LEAVE_PLANS_CREATE'),
    currentCanAction('LEAVE_PLANS_APPROVE'),
    listWorkflowTasksForDocument('LEAVE_PLAN', no),
    listPlanLines(no),
  ]);

  const isOwn = plan.created_by === user.username;
  const isOpen = plan.status === 'Open';
  const canManage = isOpen && canCreate && isOwn;
  const routedTask = plan.status === 'Pending Approval' ? await findPendingRoutedTask('LEAVE_PLAN', no) : null;
  const canDecideThis = routedTask ? await isEligibleApprover(routedTask, user.id) : canApprove;
  const requestedBy = routedTask?.requested_by ?? plan.created_by;
  const canCancelThis = canCreate && requestedBy === user.username;
  const pendingWith = tasks.find((t) => t.status === 'PENDING')?.pending_with;

  return (
    <Page
      title={plan.no}
      crumb={`${plan.status} · ${plan.employee_first_name} ${plan.employee_last_name} (${plan.employee_no})${pendingWith ? ` · pending with ${pendingWith}` : ''}`}
      user={user}
    >
      <Toolbar>
        <Link href={selfService ? '/self-service/leave-plans' : '/leave-plans'} className="btn ghost sm">← {selfService ? 'My leave plans' : 'All plans'}</Link>
        {!selfService ? <Link href={`/employees/view/${plan.employee_id}`} className="btn ghost sm">View employee</Link> : null}
        <Spacer />
        {isOpen && canCreate && isOwn ? <DeleteButton no={plan.no} className="btn ghost" /> : null}
        {isOpen && canCreate && isOwn ? <SubmitButton no={plan.no} className="btn ghost" /> : null}
        {plan.status === 'Pending Approval' && canCancelThis ? <CancelApprovalButton no={plan.no} className="btn ghost" /> : null}
        {plan.status === 'Pending Approval' && canDecideThis ? (
          <>
            {routedTask ? <DelegateButton taskId={routedTask.id} className="btn ghost" /> : null}
            <ApproveButton no={plan.no} />
            <RejectButton no={plan.no} className="btn ghost" />
          </>
        ) : null}
        <DocumentActionsMenu />
      </Toolbar>

      <CollapsibleCard title="Plan details">
        <DefinitionList items={[
          ['No.', <span className="mono" key="no">{plan.no}</span>],
          ['Employee', <>{plan.employee_first_name} {plan.employee_last_name} <span className="mono">({plan.employee_no})</span></>],
          ['Status', <Pill status={plan.status} key="st" />],
          plan.decision_reason ? ['Decision reason', plan.decision_reason] : null,
        ]} />
      </CollapsibleCard>

      <PlanLinesPanel no={no} lines={lines} canManage={canManage} />

      <CollapsibleCard title="Document trail">
        <DefinitionList items={[
          ['Created by', plan.created_by || '—'],
          ['Created on', formatDateTime(plan.created_at)],
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
