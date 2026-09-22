import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAnyAction, currentCanAction, currentCanAnyAction } from '@/lib/session';
import { assertCanViewEmployeeDocument } from '@/lib/selfService';
import { getLeaveApplication } from '@/lib/leaveManagement';
import { findPendingRoutedTask, isEligibleApprover, listWorkflowTasksForDocument } from '@/lib/workflow';
import { formatDateTime } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { DefinitionList, EmptyState, Pill, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { DocumentActionsMenu } from '@/components/ui/document-actions';
import {
  SubmitButton, CancelApprovalButton, ApproveButton, RejectButton, DelegateButton, DeleteButton,
} from '../../leave-application-actions';

export default async function LeaveApplicationDetailPage({ params }: { params: Promise<{ no: string }> }) {
  const user = await requireAnyAction('LEAVE_APPLICATIONS_READ', 'SELF_SERVICE_LEAVE_READ');
  const { no } = await params;

  const app = await getLeaveApplication(no);
  if (!app) notFound();
  // Employee Self Service: an employee reaches only their own applications.
  const { selfService } = await assertCanViewEmployeeDocument(user, 'LEAVE_APPLICATIONS_READ', 'SELF_SERVICE_LEAVE_READ', app.employee_id);

  const [canCreate, canApprove, tasks] = await Promise.all([
    currentCanAnyAction('LEAVE_APPLICATIONS_CREATE', 'SELF_SERVICE_LEAVE_CREATE'),
    currentCanAction('LEAVE_APPLICATIONS_APPROVE'),
    listWorkflowTasksForDocument('LEAVE_APPLICATION', no),
  ]);

  const isOwn = app.created_by === user.username;
  const isOpen = app.status === 'Open';
  const routedTask = app.status === 'Pending Approval' ? await findPendingRoutedTask('LEAVE_APPLICATION', no) : null;
  const canDecideThis = routedTask ? await isEligibleApprover(routedTask, user.id) : canApprove;
  const requestedBy = routedTask?.requested_by ?? app.created_by;
  const canCancelThis = canCreate && requestedBy === user.username;
  const pendingWith = tasks.find((t) => t.status === 'PENDING')?.pending_with;

  return (
    <Page
      title={`${app.no} — ${app.leave_type_name}`}
      crumb={`${app.status} · ${app.employee_first_name} ${app.employee_last_name} (${app.employee_no})${pendingWith ? ` · pending with ${pendingWith}` : ''}`}
      user={user}
    >
      <Toolbar>
        <Link href={selfService ? '/self-service/leave' : '/leave-applications'} className="btn ghost sm">← {selfService ? 'My leave applications' : 'All applications'}</Link>
        {!selfService ? <Link href={`/employees/view/${app.employee_id}`} className="btn ghost sm">View employee</Link> : null}
        <Spacer />
        {isOpen && canCreate && isOwn ? <DeleteButton no={app.no} className="btn ghost" /> : null}
        {isOpen && canCreate && isOwn ? <SubmitButton no={app.no} className="btn ghost" /> : null}
        {app.status === 'Pending Approval' && canCancelThis ? <CancelApprovalButton no={app.no} className="btn ghost" /> : null}
        {app.status === 'Pending Approval' && canDecideThis ? (
          <>
            {routedTask ? <DelegateButton taskId={routedTask.id} className="btn ghost" /> : null}
            <ApproveButton no={app.no} />
            <RejectButton no={app.no} className="btn ghost" />
          </>
        ) : null}
        <DocumentActionsMenu />
      </Toolbar>

      <CollapsibleCard title="Application details">
        <div className="grid g2">
          <DefinitionList items={[
            ['No.', <span className="mono" key="no">{app.no}</span>],
            ['Employee', <>{app.employee_first_name} {app.employee_last_name} <span className="mono">({app.employee_no})</span></>],
            ['Leave type', app.leave_type_name],
            ['Nature', app.nature === 'REIMBURSEMENT' ? 'Reimbursement / Reinstatement' : 'Application'],
            ['Start date', app.start_date],
            ['End date', app.end_date],
          ]} />
          <DefinitionList items={[
            ['Days applied', app.days_applied],
            ['Weekend days', app.weekend_days],
            ['Holiday days', app.holiday_days],
            ['Reliever', app.reliever_first_name ? `${app.reliever_first_name} ${app.reliever_last_name}` : '—'],
            ['Balance (current)', app.balance],
            ['Status', <Pill status={app.status} key="st" />],
            app.decision_reason ? ['Decision reason', app.decision_reason] : null,
            app.posted ? ['Posted', <Pill tone="ok" key="p">YES ({app.posting_date})</Pill>] : null,
          ]} />
        </div>
        {app.nature === 'REIMBURSEMENT' ? (
          <div className="grid g2" style={{ marginTop: 10 }}>
            <DefinitionList items={[
              ['Days dropped', app.days_dropped ?? '—'],
              ['Days to reimburse', app.days_to_reimburse ?? '—'],
            ]} />
            <DefinitionList items={[['Justification', app.justification || '—']]} />
          </div>
        ) : null}
      </CollapsibleCard>

      <CollapsibleCard title="Document trail">
        <DefinitionList items={[
          ['Created by', app.created_by || '—'],
          ['Created on', formatDateTime(app.created_at)],
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
