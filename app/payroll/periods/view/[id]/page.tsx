import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import { getPayrollPeriod, listPeriodTransactions, nextPayrollPeriod } from '@/lib/payroll';
import { findPendingRoutedTask, isEligibleApprover, listWorkflowTasksForDocument } from '@/lib/workflow';
import { formatDateTime } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { DefinitionList, EmptyState, Pill, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { Money } from '@/components/ui/money';
import { DocumentActionsMenu } from '@/components/ui/document-actions';
import {
  SubmitButton, CancelApprovalButton, ApproveButton, RejectButton, DelegateButton, CloseButton, ReopenButton,
} from '../../period-actions';

export default async function PayrollPeriodDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAction('PAYROLL_PERIODS_READ');
  const { id: idParam } = await params;
  const id = Number(idParam);

  const period = await getPayrollPeriod(id);
  if (!period) notFound();

  const [canCreate, canApprove, canClose, tasks, lines] = await Promise.all([
    currentCanAction('PAYROLL_PERIODS_CREATE'),
    currentCanAction('PAYROLL_PERIODS_APPROVE'),
    currentCanAction('PAYROLL_PERIODS_CLOSE'),
    listWorkflowTasksForDocument('PAYROLL_PERIOD', String(id)),
    listPeriodTransactions(id),
  ]);

  const byEmployee = new Map<number, { employee_no: string; name: string; netPay: number }>();
  let grossPay = 0; let totalPaye = 0; let totalNssf = 0; let totalNetPay = 0;
  for (const l of lines) {
    const amt = Number(l.amount_cents);
    if (l.transaction_code === 'GPAY') grossPay += amt;
    if (l.transaction_code === 'PAYE') totalPaye += amt;
    if (l.transaction_code === 'NSSF') totalNssf += amt;
    if (l.transaction_code === 'NPAY') {
      totalNetPay += amt;
      const cur = byEmployee.get(l.employee_id) ?? { employee_no: l.employee_no, name: `${l.employee_first_name} ${l.employee_last_name}`, netPay: 0 };
      cur.netPay += amt;
      byEmployee.set(l.employee_id, cur);
    }
  }

  const routedTask = period.status === 'PENDING_APPROVAL' ? await findPendingRoutedTask('PAYROLL_PERIOD', String(id)) : null;
  const canDecideThis = routedTask ? await isEligibleApprover(routedTask, user.id) : canApprove;
  const requestedBy = routedTask?.requested_by ?? period.created_by;
  const canCancelThis = canCreate && requestedBy === user.username;
  const pendingWith = tasks.find((t) => t.status === 'PENDING')?.pending_with;

  return (
    <Page
      title={period.period_name}
      crumb={`${period.status.replace('_', ' ')}${pendingWith ? ` · pending with ${pendingWith}` : ''}`}
      user={user}
    >
      <Toolbar>
        <Link href="/payroll/periods" className="btn ghost sm">← All periods</Link>
        <Link href={`/payroll/periods/view/${period.id}/reports`} className="btn ghost sm">Reports</Link>
        <Spacer />
        {period.status === 'OPEN' && canCreate ? <SubmitButton id={period.id} className="btn ghost" /> : null}
        {period.status === 'PENDING_APPROVAL' && canCancelThis ? <CancelApprovalButton id={period.id} className="btn ghost" /> : null}
        {period.status === 'PENDING_APPROVAL' && canDecideThis ? (
          <>
            {routedTask ? <DelegateButton taskId={routedTask.id} className="btn ghost" /> : null}
            <ApproveButton id={period.id} />
            <RejectButton id={period.id} className="btn ghost" />
          </>
        ) : null}
        {period.status === 'APPROVED' && canApprove ? <ReopenButton id={period.id} className="btn ghost" /> : null}
        {period.status === 'APPROVED' && canClose ? <CloseButton id={period.id} next={nextPayrollPeriod(period)} /> : null}
        <DocumentActionsMenu />
      </Toolbar>

      <CollapsibleCard title="Period details">
        <div className="grid g2">
          <DefinitionList items={[
            ['Period name', period.period_name],
            ['Start date', period.start_date],
            ['End date', period.end_date],
            ['Status', <Pill status={period.status.replace('_', ' ')} key="st" />],
            period.decision_reason ? ['Decision reason', period.decision_reason] : null,
          ]} />
          <DefinitionList items={[
            ['Gross pay', <Money cents={grossPay} key="g" />],
            ['Total PAYE', <Money cents={totalPaye} key="p" />],
            ['Total NSSF (employee)', <Money cents={totalNssf} key="n" />],
            ['Total net pay', <Money cents={totalNetPay} key="np" />],
            ['Employees processed', byEmployee.size],
          ]} />
        </div>
      </CollapsibleCard>

      <CollapsibleCard title="Employees processed" sub={`${byEmployee.size} employee(s)`}>
        {byEmployee.size ? (
          <TableWrap>
            <thead><tr><th>Employee No.</th><th>Name</th><th className="num">Net pay</th></tr></thead>
            <tbody>
              {[...byEmployee.entries()].map(([empId, v]) => (
                <tr key={empId}>
                  <td className="mono"><Link href={`/payroll/view/${empId}`}>{v.employee_no}</Link></td>
                  <td>{v.name}</td>
                  <td className="num"><Money cents={v.netPay} /></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🧑‍💼" title="No employees processed yet" />}
      </CollapsibleCard>

      <CollapsibleCard title="Document trail">
        <DefinitionList items={[
          ['Created by', period.created_by || '—'],
          ['Created on', formatDateTime(period.created_at)],
          ['Closed by', period.closed_by || '—'],
          ['Closed on', period.closed_at ? formatDateTime(period.closed_at) : '—'],
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
