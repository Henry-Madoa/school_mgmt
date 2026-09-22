import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import { getStaffClaimDetail } from '@/lib/staffClaims';
import { listEmployeeLedger } from '@/lib/imprest';
import { findPendingRoutedTask, isEligibleApprover, listWorkflowTasksForDocument } from '@/lib/workflow';
import { formatDate, formatDateTime } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { DefinitionList, EmptyState, Pill, Stat, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { EditableCard } from '@/components/ui/editable-card';
import { Money } from '@/components/ui/money';
import { DocumentActionsMenu } from '@/components/ui/document-actions';
import { imprestLookups } from '../../lookups';
import {
  StaffClaimEditForm, StaffClaimPaymentForm, SubmitClaimButton, CancelClaimApprovalButton, ApproveClaimButton, RejectClaimButton, DelegateButton,
  ReopenClaimButton, DeleteClaimButton, PostClaimButton, StopClaimButton, ReleaseClaimButton,
} from '../../staff-claim-actions';

export const dynamic = 'force-dynamic';

export default async function StaffClaimPage({ params }: { params: Promise<{ no: string }> }) {
  const user = await requireAction('IMPREST_READ');
  const { no } = await params;
  const c = await getStaffClaimDetail(no);
  if (!c) notFound();
  const [canCreate, canApprove, canPost, tasks, ledger] = await Promise.all([
    currentCanAction('IMPREST_CREATE'), currentCanAction('IMPREST_APPROVE'), currentCanAction('IMPREST_POST'),
    listWorkflowTasksForDocument('STAFF_CLAIM', no), listEmployeeLedger(c.employee_id, 50),
  ]);
  const isOwn = c.created_by === user.username;
  const isOpen = c.status === 'Open' && !c.posted;
  const approvedUnpaid = c.status === 'Approved' && !c.posted;
  const routed = c.status === 'Pending Approval' ? await findPendingRoutedTask('STAFF_CLAIM', no) : null;
  const canDecide = routed ? await isEligibleApprover(routed, user.id) : canApprove;
  const canCancel = canCreate && (routed?.requested_by ?? c.created_by) === user.username;
  const lookups = (isOpen && canCreate && isOwn) || (approvedUnpaid && canPost) ? await imprestLookups() : null;
  const docEntries = ledger.filter((e) => e.document_no === no);

  return (
    <Page title={`${c.no} — Staff Claim`} crumb={`${c.posted ? 'Paid' : c.payment_stopped ? 'Payment stopped' : c.status} · ${c.first_name} ${c.last_name} · ${c.description}`} user={user}>
      <Toolbar>
        <Link href="/imprest/staff-claims" className="btn ghost sm">← All staff claims</Link>
        <Link href={`/employees/${c.employee_id}`} className="btn ghost sm">Employee</Link>
        <a className="btn ghost sm" href={`/print/staff-claim/${encodeURIComponent(c.no)}`} target="_blank" rel="noreferrer">Print claim form</a>
        <Spacer />
        {isOpen && canCreate && isOwn ? <DeleteClaimButton no={c.no} className="btn ghost" /> : null}
        {isOpen && canCreate && isOwn ? <SubmitClaimButton no={c.no} className="btn ghost" /> : null}
        {c.status === 'Pending Approval' && canCancel ? <CancelClaimApprovalButton no={c.no} className="btn ghost" /> : null}
        {c.status === 'Pending Approval' && canDecide ? (
          <>{routed ? <DelegateButton taskId={routed.id} className="btn ghost" /> : null}<ApproveClaimButton no={c.no} /><RejectClaimButton no={c.no} className="btn ghost" /></>
        ) : null}
        {approvedUnpaid && canApprove ? <ReopenClaimButton no={c.no} className="btn ghost" /> : null}
        {approvedUnpaid && canPost && !c.payment_stopped ? <StopClaimButton no={c.no} className="btn ghost" /> : null}
        {approvedUnpaid && canPost && c.payment_stopped ? <ReleaseClaimButton no={c.no} className="btn ghost" /> : null}
        {approvedUnpaid && canPost && !c.payment_stopped ? <PostClaimButton no={c.no} /> : null}
        <DocumentActionsMenu />
      </Toolbar>

      <div className="grid g3 stack-2">
        <Stat label="Claimed" value={<Money cents={c.total_amount} decimals={0} />} foot={`${c.lines} line${c.lines === 1 ? '' : 's'}`} />
        <Stat label="Paid" value={c.settlement === 'Pay from Payroll' ? 'Through payroll' : c.paying_bank_code || '—'} foot={c.settlement === 'Pay from Payroll' ? (c.transferred_to_payroll ? 'on the open payroll' : 'when posted') : c.paying_bank_name || 'account not set'} />
        <Stat label="Status" value={c.posted ? <Pill status="ok">Paid</Pill> : c.payment_stopped ? <Pill tone="bad">Stopped</Pill> : <Pill status={c.status} />}
          foot={c.posted ? `posted ${formatDateTime(c.posted_at)}` : c.payment_stopped ? `stopped by ${c.stopped_by} — ${c.stop_reason}` : 'not paid'} />
      </div>

      <EditableCard collapsible title="Staff claim" sub={c.description} canEdit={isOpen && canCreate && isOwn && !!lookups}
        form={lookups ? <StaffClaimEditForm claim={c} lookups={lookups} /> : null}>
        <div className="grid g2">
          <DefinitionList items={[
            ['Claim no.', <span className="mono" key="no">{c.no}</span>],
            ['Claimant', <>{c.first_name} {c.last_name} <span className="mono">({c.employee_no})</span>{c.job_title ? <span className="muted-cell"> · {c.job_title}</span> : null}</>],
            ['Claim date', formatDate(c.claim_date)],
            ['Description', c.description],
            ['Justification', c.justification || '—'],
            ['Currency', c.currency_code],
          ]} />
          <DefinitionList items={[
            ['Status', <Pill status={c.status} key="s" />],
            c.decision_reason ? ['Decision reason', c.decision_reason] : null,
            ['Posted', c.posted ? `${formatDateTime(c.posted_at)} by ${c.posted_by}` : 'Not yet'],
            c.journal_no ? ['Journal', <span className="mono" key="j">{c.journal_no}</span>] : null,
            c.payment_stopped ? ['Payment stopped', `${formatDateTime(c.stopped_at)} by ${c.stopped_by} — ${c.stop_reason}`] : null,
          ]} />
        </div>
        <TableWrap>
          <thead><tr><th>Expense account</th><th>Narration</th><th>Date</th><th>Receipt ref.</th><th className="num">Qty</th><th className="num">Unit cost</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {c.line_items.map((l) => (
              <tr key={l.id}>
                <td><span className="mono">{l.gl_account_code}</span> <span className="tiny muted-cell">{l.gl_account_name}</span></td>
                <td>{l.narration || '—'}</td><td>{l.expense_date ? formatDate(l.expense_date) : '—'}</td><td className="mono">{l.receipt_ref || '—'}</td>
                <td className="num">{l.quantity}</td><td className="num">{l.unit_cost ? <Money cents={l.unit_cost} /> : '—'}</td><td className="num"><Money cents={l.amount} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={6}>Total claimed</td><td className="num"><b><Money cents={c.total_amount} /></b></td></tr></tfoot>
        </TableWrap>
      </EditableCard>

      <EditableCard collapsible title="Payment" sub={c.settlement === 'Pay from Payroll' ? 'Paid through the next payroll as an allowance' : 'Paid now from a bank or cash account'}
        canEdit={approvedUnpaid && canPost && !!lookups} form={lookups ? <StaffClaimPaymentForm claim={c} lookups={lookups} /> : null}>
        <DefinitionList items={[
          ['Settlement', c.settlement],
          ['Paid from', c.paying_bank_code ? `${c.paying_bank_code} — ${c.paying_bank_name}` : '—'],
          ['Pay mode / ref.', `${c.pay_mode_code || '—'} / ${c.payment_tx_no || '—'}`],
          ['Payroll', c.transferred_to_payroll ? 'Allowance placed on the open payroll period' : '—'],
        ]} />
      </EditableCard>

      <CollapsibleCard title="Employee subledger — this claim" sub={`${docEntries.length} entr${docEntries.length === 1 ? 'y' : 'ies'}`}>
        {docEntries.length ? (
          <TableWrap>
            <thead><tr><th>Date</th><th>Type</th><th>Description</th><th className="num">Amount</th><th>Journal</th></tr></thead>
            <tbody>{docEntries.map((e) => <tr key={e.id}><td>{formatDate(e.posting_date)}</td><td><Pill>{e.entry_type.replace(/_/g, ' ')}</Pill></td><td>{e.description || '—'}</td><td className="num"><Money cents={e.amount} /></td><td className="mono">{e.journal_no || '—'}</td></tr>)}</tbody>
          </TableWrap>
        ) : <EmptyState icon="🧾" title="Nothing posted yet" />}
      </CollapsibleCard>

      <CollapsibleCard title="Approval details" sub={`${tasks.length} approval step${tasks.length === 1 ? '' : 's'} routed`}>
        {tasks.length ? (
          <TableWrap>
            <thead><tr><th>Sent by</th><th>Sent date</th><th>Approver</th><th>Approved on</th><th /></tr></thead>
            <tbody>{tasks.map((t) => <tr key={t.id}><td>{t.requested_by || '—'}</td><td>{formatDateTime(t.requested_at)}</td><td className="muted-cell">{t.decided_by || t.pending_with || '—'}</td><td>{t.decided_at ? formatDateTime(t.decided_at) : '—'}</td><td><Pill status={t.status} /></td></tr>)}</tbody>
          </TableWrap>
        ) : <EmptyState icon="🕓" title="Not yet sent for approval" />}
      </CollapsibleCard>

      <CollapsibleCard title="Document trail" sub="Who raised this, and when">
        <DefinitionList items={[['Created by', c.created_by || '—'], ['Created on', formatDateTime(c.created_at)]]} />
      </CollapsibleCard>
    </Page>
  );
}
