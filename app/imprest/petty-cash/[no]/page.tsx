import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAnyAction, currentCanAction, currentCanAnyAction } from '@/lib/session';
import { assertCanViewEmployeeDocument } from '@/lib/selfService';
import { getPettyCashDetail } from '@/lib/imprest';
import { getOrg } from '@/lib/org';
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
  PettyCashEditForm, SubmitPettyCashButton, CancelPettyCashApprovalButton, ApprovePettyCashButton, RejectPettyCashButton, DelegateButton,
  ReopenPettyCashButton, DeletePettyCashButton, PostPettyCashButton, MarkPaidButton,
} from '../../imprest-actions';

export const dynamic = 'force-dynamic';

export default async function PettyCashPage({ params }: { params: Promise<{ no: string }> }) {
  const user = await requireAnyAction('IMPREST_READ', 'SELF_SERVICE_PETTY_CASH_READ');
  const { no } = await params;
  const p = await getPettyCashDetail(no);
  if (!p) notFound();
  // Employee Self Service: an employee reaches only their own petty cash.
  const { selfService } = await assertCanViewEmployeeDocument(user, 'IMPREST_READ', 'SELF_SERVICE_PETTY_CASH_READ', p.employee_id);
  const [canCreate, canApprove, canPost, tasks, org] = await Promise.all([
    currentCanAnyAction('IMPREST_CREATE', 'SELF_SERVICE_PETTY_CASH_CREATE'), currentCanAction('IMPREST_APPROVE'), currentCanAction('IMPREST_POST'),
    listWorkflowTasksForDocument('PETTY_CASH', no), getOrg(),
  ]);
  const isOwn = p.created_by === user.username;
  const isOpen = p.status === 'Open' && !p.posted;
  const routed = p.status === 'Pending Approval' ? await findPendingRoutedTask('PETTY_CASH', no) : null;
  const canDecide = routed ? await isEligibleApprover(routed, user.id) : canApprove;
  const canCancel = canCreate && (routed?.requested_by ?? p.created_by) === user.username;
  const lookups = isOpen && canCreate && isOwn ? await imprestLookups() : null;
  const limit = Number(org?.petty_cash_limit ?? 0);

  return (
    <Page title={`${p.no} — Petty Cash`} crumb={`${p.paid ? 'Paid' : p.posted ? 'Posted' : p.status} · ${p.first_name} ${p.last_name} · ${p.payment_narration}`} user={user}>
      <Toolbar>
        <Link href={selfService ? '/self-service/petty-cash' : '/imprest/petty-cash'} className="btn ghost sm">← {selfService ? 'My petty cash' : 'All petty cash'}</Link>
        <a className="btn ghost sm" href={`/print/petty-cash/${encodeURIComponent(p.no)}`} target="_blank" rel="noreferrer">Print voucher</a>
        <Spacer />
        {isOpen && canCreate && isOwn ? <DeletePettyCashButton no={p.no} className="btn ghost" /> : null}
        {isOpen && canCreate && isOwn ? <SubmitPettyCashButton no={p.no} className="btn ghost" /> : null}
        {p.status === 'Pending Approval' && canCancel ? <CancelPettyCashApprovalButton no={p.no} className="btn ghost" /> : null}
        {p.status === 'Pending Approval' && canDecide ? (
          <>{routed ? <DelegateButton taskId={routed.id} className="btn ghost" /> : null}<ApprovePettyCashButton no={p.no} /><RejectPettyCashButton no={p.no} className="btn ghost" /></>
        ) : null}
        {p.status === 'Approved' && !p.posted && canApprove ? <ReopenPettyCashButton no={p.no} className="btn ghost" /> : null}
        {p.status === 'Approved' && !p.posted && canPost ? <PostPettyCashButton no={p.no} /> : null}
        {p.posted && !p.paid && canPost ? <MarkPaidButton no={p.no} /> : null}
        <DocumentActionsMenu />
      </Toolbar>

      <div className="grid g3 stack-2">
        <Stat label="Amount" value={<Money cents={p.total_amount} decimals={0} />} foot={`${p.lines} line${p.lines === 1 ? '' : 's'}${limit ? ` · limit ${(limit / 100).toLocaleString()}` : ''}`} />
        <Stat label="Float" value={p.paying_bank_code || '—'} foot={p.paying_bank_name || 'not set'} />
        <Stat label="Status" value={p.paid ? <Pill status="ok">Paid</Pill> : p.posted ? <Pill tone="accent">Posted</Pill> : <Pill status={p.status} />}
          foot={p.paid ? `paid ${formatDateTime(p.paid_at)}` : p.posted ? `posted ${formatDateTime(p.posted_at)}` : 'not posted'} />
      </div>

      <EditableCard collapsible title="Petty cash" sub={p.payment_narration} canEdit={!!lookups} form={lookups ? <PettyCashEditForm pettyCash={p} lookups={lookups} limit={limit} /> : null}>
        <div className="grid g2">
          <DefinitionList items={[
            ['Petty cash no.', <span className="mono" key="no">{p.no}</span>],
            ['Requested by', <>{p.first_name} {p.last_name} <span className="mono">({p.employee_no})</span></>],
            ['Date', formatDate(p.request_date)],
            ['Payment to', p.payment_to || '—'],
            ['On behalf of', p.on_behalf_of || '—'],
            ['Narration', p.payment_narration],
          ]} />
          <DefinitionList items={[
            ['Float', p.paying_bank_code ? `${p.paying_bank_code} — ${p.paying_bank_name}` : '—'],
            ['Pay mode / ref.', `${p.pay_mode_code || '—'} / ${p.payment_tx_no || '—'}`],
            ['Status', <Pill status={p.status} key="s" />],
            p.decision_reason ? ['Decision reason', p.decision_reason] : null,
            ['Posted', p.posted ? `${formatDateTime(p.posted_at)} by ${p.posted_by}` : 'Not yet'],
            ['Paid out', p.paid ? `${formatDateTime(p.paid_at)} by ${p.paid_by}` : 'Not yet'],
            p.journal_no ? ['Journal', <span className="mono" key="j">{p.journal_no}</span>] : null,
          ]} />
        </div>
        <TableWrap>
          <thead><tr><th>Expense account</th><th>Description</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {p.line_items.map((l) => (
              <tr key={l.id}><td><span className="mono">{l.gl_account_code}</span> <span className="tiny muted-cell">{l.gl_account_name}</span></td><td>{l.description || '—'}</td><td className="num"><Money cents={l.amount} /></td></tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={2}>Total</td><td className="num"><b><Money cents={p.total_amount} /></b></td></tr></tfoot>
        </TableWrap>
      </EditableCard>

      <CollapsibleCard title="Approval details" sub={`${tasks.length} approval step${tasks.length === 1 ? '' : 's'} routed`}>
        {tasks.length ? (
          <TableWrap>
            <thead><tr><th>Sent by</th><th>Sent date</th><th>Approver</th><th>Approved on</th><th /></tr></thead>
            <tbody>{tasks.map((t) => <tr key={t.id}><td>{t.requested_by || '—'}</td><td>{formatDateTime(t.requested_at)}</td><td className="muted-cell">{t.decided_by || t.pending_with || '—'}</td><td>{t.decided_at ? formatDateTime(t.decided_at) : '—'}</td><td><Pill status={t.status} /></td></tr>)}</tbody>
          </TableWrap>
        ) : <EmptyState icon="🕓" title="Not yet sent for approval" />}
      </CollapsibleCard>

      <CollapsibleCard title="Document trail" sub="Who raised this, and when">
        <DefinitionList items={[['Created by', p.created_by || '—'], ['Created on', formatDateTime(p.created_at)]]} />
      </CollapsibleCard>
    </Page>
  );
}
