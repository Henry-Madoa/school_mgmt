import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import { getExit, listFinalDueLines, listClearanceLines } from '@/lib/employeeExits';
import { listTerminationReasons } from '@/lib/hrSetup';
import { findPendingRoutedTask, isEligibleApprover, listWorkflowTasksForDocument } from '@/lib/workflow';
import { formatDateTime } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { EditableCard } from '@/components/ui/editable-card';
import { DefinitionList, EmptyState, Pill, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { Money } from '@/components/ui/money';
import { DocumentActionsMenu } from '@/components/ui/document-actions';
import {
  EditExitForm, AddDueLineButton, RemoveDueLineButton, SubmitButton, CancelApprovalButton, ApproveButton,
  RejectButton, DelegateButton, ClearSectionButton,
} from '../../exit-actions';

const DUE_LABELS: Record<string, string> = {
  LEAVE_ENCASHMENT: 'Leave Encashment', NOTICE_PENALTY: 'Notice Penalty', NOTICE_INCOME: 'Notice Income',
  GRATUITY: 'Gratuity', UNCLEARED_ITEMS: 'Uncleared Items',
};

export default async function EmployeeExitDetailPage({ params }: { params: Promise<{ no: string }> }) {
  const user = await requireAction('EMPLOYEE_EXITS_READ');
  const { no } = await params;

  const exit = await getExit(no);
  if (!exit) notFound();

  const [canCreate, canApprove, canClear, tasks, reasons, dueLines, clearanceLines] = await Promise.all([
    currentCanAction('EMPLOYEE_EXITS_CREATE'),
    currentCanAction('EMPLOYEE_EXITS_APPROVE'),
    currentCanAction('EMPLOYEE_EXITS_CLEAR'),
    listWorkflowTasksForDocument('EMPLOYEE_EXIT', no),
    listTerminationReasons(),
    listFinalDueLines(no),
    listClearanceLines(no),
  ]);

  const isOwn = exit.created_by === user.username;
  const isOpen = exit.status === 'Open';
  const routedTask = exit.status === 'Pending Approval' ? await findPendingRoutedTask('EMPLOYEE_EXIT', no) : null;
  const canDecideThis = routedTask ? await isEligibleApprover(routedTask, user.id) : canApprove;
  const requestedBy = routedTask?.requested_by ?? exit.created_by;
  const canCancelThis = canCreate && requestedBy === user.username;
  const pendingWith = tasks.find((t) => t.status === 'PENDING')?.pending_with;
  const totalDue = dueLines.reduce((s, l) => s + Number(l.amount_cents), 0);

  return (
    <Page
      title={`${exit.no} — ${exit.employee_first_name} ${exit.employee_last_name}`}
      crumb={`${exit.status}${exit.cleared ? ' · Cleared' : ''}${pendingWith ? ` · pending with ${pendingWith}` : ''}`}
      user={user}
    >
      <Toolbar>
        <Link href="/employee-exits" className="btn ghost sm">← All exits</Link>
        <Link href={`/employees/view/${exit.employee_id}`} className="btn ghost sm">View employee</Link>
        <Spacer />
        {isOpen && canCreate && isOwn ? <SubmitButton no={exit.no} className="btn ghost" /> : null}
        {exit.status === 'Pending Approval' && canCancelThis ? <CancelApprovalButton no={exit.no} className="btn ghost" /> : null}
        {exit.status === 'Pending Approval' && canDecideThis ? (
          <>
            {routedTask ? <DelegateButton taskId={routedTask.id} className="btn ghost" /> : null}
            <ApproveButton no={exit.no} />
            <RejectButton no={exit.no} className="btn ghost" />
          </>
        ) : null}
        <DocumentActionsMenu />
      </Toolbar>

      <EditableCard collapsible title="Exit details"
        canEdit={isOpen && canCreate && isOwn} form={<EditExitForm exit={exit} reasons={reasons} />}>
        <div className="grid g2">
          <DefinitionList items={[
            ['No.', <span className="mono" key="no">{exit.no}</span>],
            ['Employee', <>{exit.employee_first_name} {exit.employee_last_name} <span className="mono">({exit.employee_no})</span></>],
            ['Date of notice', exit.date_of_notice || '—'],
            ['Date of exit', exit.date_of_exit || '—'],
            ['Notice period (days)', exit.notice_period_days ?? '—'],
          ]} />
          <DefinitionList items={[
            ['Notice fully served', exit.notice_fully_served == null ? '—' : (exit.notice_fully_served ? 'Yes' : 'No')],
            ['Can be re-employed', exit.can_be_reemployed == null ? '—' : (exit.can_be_reemployed ? 'Yes' : 'No')],
            ['Status', <Pill status={exit.status} key="st" />],
            ['Cleared', exit.cleared ? <Pill tone="ok" key="c">YES</Pill> : 'No'],
            exit.decision_reason ? ['Decision reason', exit.decision_reason] : null,
          ]} />
        </div>
      </EditableCard>

      <CollapsibleCard title="Final dues" sub={`Total ${(totalDue / 100).toLocaleString()}`}>
        {isOpen && canCreate && isOwn ? <div style={{ marginBottom: 10 }}><AddDueLineButton no={exit.no} /></div> : null}
        {dueLines.length ? (
          <TableWrap>
            <thead><tr><th>Type</th><th>Description</th><th className="num">Amount</th>{isOpen && canCreate && isOwn ? <th /> : null}</tr></thead>
            <tbody>
              {dueLines.map((l) => (
                <tr key={l.id}>
                  <td>{DUE_LABELS[l.due_type] || l.due_type}</td>
                  <td>{l.description || '—'}</td>
                  <td className="num"><Money cents={l.amount_cents} /></td>
                  {isOpen && canCreate && isOwn ? <td className="num"><RemoveDueLineButton no={exit.no} lineId={l.id} /></td> : null}
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="💰" title="No final due lines" />}
      </CollapsibleCard>

      <CollapsibleCard title="Clearance checklist" sub="Every section must clear before the employee moves to Pending Final Payment">
        {clearanceLines.length ? (
          <TableWrap>
            <thead><tr><th>Section</th><th>Cleared by</th><th>Cleared on</th><th>Remarks</th><th /></tr></thead>
            <tbody>
              {clearanceLines.map((l) => (
                <tr key={l.id}>
                  <td>{l.section_name}</td>
                  <td>{l.cleared_by || '—'}</td>
                  <td>{l.cleared_at ? formatDateTime(l.cleared_at) : '—'}</td>
                  <td>{l.remarks || '—'}</td>
                  <td className="num">
                    {l.cleared ? <Pill tone="ok">Cleared</Pill>
                      : (exit.status === 'Approved' && canClear ? <ClearSectionButton no={exit.no} sectionId={l.section_id} /> : <Pill tone="warn">Pending</Pill>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="✅" title="No clearance sections configured" sub="Add them under Admin Centre → Setup Pool → HR & Payroll" />}
      </CollapsibleCard>

      <CollapsibleCard title="Document trail">
        <DefinitionList items={[
          ['Created by', exit.created_by || '—'],
          ['Created on', formatDateTime(exit.created_at)],
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
