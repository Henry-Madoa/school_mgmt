import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import { getContractChange } from '@/lib/employeeContractChanges';
import { findPendingRoutedTask, isEligibleApprover, listWorkflowTasksForDocument } from '@/lib/workflow';
import { formatDateTime } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { DefinitionList, EmptyState, Pill, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { Money } from '@/components/ui/money';
import { DocumentActionsMenu } from '@/components/ui/document-actions';
import {
  SubmitButton, CancelApprovalButton, ApproveButton, RejectButton, DelegateButton, DeleteButton,
} from '../../contract-change-actions';

const NATURE_LABELS: Record<string, string> = { NEW_CONTRACT: 'New Contract', RENEWAL: 'Renewal', SALARY_INCREMENT: 'Salary Increment' };

export default async function ContractChangeDetailPage({ params }: { params: Promise<{ no: string }> }) {
  const user = await requireAction('EMPLOYEE_CONTRACT_CHANGES_READ');
  const { no } = await params;

  const req = await getContractChange(no);
  if (!req) notFound();

  const [canCreate, canApprove, tasks] = await Promise.all([
    currentCanAction('EMPLOYEE_CONTRACT_CHANGES_CREATE'),
    currentCanAction('EMPLOYEE_CONTRACT_CHANGES_APPROVE'),
    listWorkflowTasksForDocument('EMPLOYEE_CONTRACT_CHANGE', no),
  ]);

  const isOwn = req.created_by === user.username;
  const isOpen = req.status === 'Open';
  const routedTask = req.status === 'Pending Approval' ? await findPendingRoutedTask('EMPLOYEE_CONTRACT_CHANGE', no) : null;
  const canDecideThis = routedTask ? await isEligibleApprover(routedTask, user.id) : canApprove;
  const requestedBy = routedTask?.requested_by ?? req.created_by;
  const canCancelThis = canCreate && requestedBy === user.username;
  const pendingWith = tasks.find((t) => t.status === 'PENDING')?.pending_with;

  return (
    <Page
      title={`${req.no} — ${NATURE_LABELS[req.nature] || req.nature}`}
      crumb={`${req.status} · ${req.employee_first_name} ${req.employee_last_name} (${req.employee_no})${pendingWith ? ` · pending with ${pendingWith}` : ''}`}
      user={user}
    >
      <Toolbar>
        <Link href="/employee-contract-changes" className="btn ghost sm">← All requests</Link>
        <Link href={`/employees/view/${req.employee_id}`} className="btn ghost sm">View employee</Link>
        <Spacer />
        {isOpen && canCreate && isOwn ? <DeleteButton no={req.no} className="btn ghost" /> : null}
        {isOpen && canCreate && isOwn ? <SubmitButton no={req.no} className="btn ghost" /> : null}
        {req.status === 'Pending Approval' && canCancelThis ? <CancelApprovalButton no={req.no} className="btn ghost" /> : null}
        {req.status === 'Pending Approval' && canDecideThis ? (
          <>
            {routedTask ? <DelegateButton taskId={routedTask.id} className="btn ghost" /> : null}
            <ApproveButton no={req.no} />
            <RejectButton no={req.no} className="btn ghost" />
          </>
        ) : null}
        <DocumentActionsMenu />
      </Toolbar>

      <CollapsibleCard title="Request details">
        <div className="grid g2">
          <DefinitionList items={[
            ['No.', <span className="mono" key="no">{req.no}</span>],
            ['Employee', <>{req.employee_first_name} {req.employee_last_name} <span className="mono">({req.employee_no})</span></>],
            ['Nature', NATURE_LABELS[req.nature] || req.nature],
            ['Reason', req.reason || '—'],
          ]} />
          <DefinitionList items={[
            ['Proposed start date', req.proposed_start_date || '—'],
            ['Proposed end date', req.proposed_end_date || '—'],
            ['Proposed salary', req.proposed_salary_cents != null ? <Money cents={req.proposed_salary_cents} key="s" /> : '—'],
            ['Status', <Pill status={req.status} key="st" />],
            req.decision_reason ? ['Decision reason', req.decision_reason] : null,
          ]} />
        </div>
      </CollapsibleCard>

      <CollapsibleCard title="Document trail">
        <DefinitionList items={[
          ['Created by', req.created_by || '—'],
          ['Created on', formatDateTime(req.created_at)],
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
