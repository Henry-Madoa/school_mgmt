import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAnyAction, currentCanAction, currentCanAnyAction } from '@/lib/session';
import { assertCanViewEmployeeDocument } from '@/lib/selfService';
import { getImprestRequestDetail, getAdjacentImprestNos, listImprestJournals, listEmployeeLedger, type ImprestListView } from '@/lib/imprest';
import { findPendingRoutedTask, isEligibleApprover, listWorkflowTasksForDocument } from '@/lib/workflow';
import { formatDate, formatDateTime } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { DefinitionList, EmptyState, Pill, Stat, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { EditableCard } from '@/components/ui/editable-card';
import { Money } from '@/components/ui/money';
import { DocumentActionsMenu } from '@/components/ui/document-actions';
import { CardNav } from '@/components/ui/card-nav';
import { imprestLookups } from '../../lookups';
import {
  ImprestEditForm, SubmitButton, CancelApprovalButton, ApproveButton, RejectButton, DelegateButton, ReopenButton, DeleteButton, IssueButton,
  SurrenderEditForm, SubmitSurrenderButton, CancelSurrenderApprovalButton, ApproveSurrenderButton, RejectSurrenderButton,
  ReopenSurrenderButton, PostSurrenderButton, TransferToPayrollButton,
} from '../../imprest-actions';

export const dynamic = 'force-dynamic';

const VIEWS: ImprestListView[] = ['open', 'pending', 'approved', 'issued', 'overdue', 'surrender-pending', 'surrender-approved', 'closed', 'all'];

export default async function ImprestRequestPage({ params, searchParams }: {
  params: Promise<{ no: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const user = await requireAnyAction('IMPREST_READ', 'SELF_SERVICE_IMPREST_READ');
  const { no } = await params;
  const { view: viewRaw } = await searchParams;
  const view = VIEWS.includes(viewRaw as ImprestListView) ? (viewRaw as ImprestListView) : undefined;

  const r = await getImprestRequestDetail(no);
  if (!r) notFound();
  // Employee Self Service: an employee reaches only their own imprests.
  const { selfService } = await assertCanViewEmployeeDocument(user, 'IMPREST_READ', 'SELF_SERVICE_IMPREST_READ', r.employee_id);

  const [canCreate, canApprove, canIssue, canPost, canRecover, reqTasks, surTasks, { prevNo, nextNo }, journals, ledger] = await Promise.all([
    currentCanAnyAction('IMPREST_CREATE', 'SELF_SERVICE_IMPREST_CREATE'), currentCanAction('IMPREST_APPROVE'), currentCanAction('IMPREST_ISSUE'),
    currentCanAction('IMPREST_POST'), currentCanAction('IMPREST_PAYROLL_RECOVER'),
    listWorkflowTasksForDocument('IMPREST_REQUEST', no), listWorkflowTasksForDocument('IMPREST_SURRENDER', no),
    getAdjacentImprestNos(no, view), listImprestJournals(no), listEmployeeLedger(r.employee_id, 50),
  ]);
  const tasks = [...reqTasks, ...surTasks];
  const isOwn = r.created_by === user.username;
  const isOpen = !r.posted && r.status === 'Open';
  const issued = r.posted && !r.surrendered;
  const surrenderOpen = issued && r.surrender_status === 'Open' && !r.transferred_to_payroll;

  const routedReq = !r.posted && r.status === 'Pending Approval' ? await findPendingRoutedTask('IMPREST_REQUEST', no) : null;
  const routedSur = issued && r.surrender_status === 'Pending Approval' ? await findPendingRoutedTask('IMPREST_SURRENDER', no) : null;
  const canDecideReq = routedReq ? await isEligibleApprover(routedReq, user.id) : canApprove;
  const canDecideSur = routedSur ? await isEligibleApprover(routedSur, user.id) : canApprove;
  const canCancelReq = canCreate && (routedReq?.requested_by ?? r.created_by) === user.username;
  const canCancelSur = canCreate && (routedSur?.requested_by ?? r.created_by) === user.username;
  const pendingWith = tasks.find((t) => t.status === 'PENDING')?.pending_with;
  const q = view ? `?view=${view}` : '';
  const lookups = (isOpen && canCreate && isOwn) || surrenderOpen ? await imprestLookups() : null;
  const docEntries = ledger.filter((e) => e.document_no === no);

  return (
    <>
      <CardNav prevHref={prevNo ? `/imprest/view/${prevNo}${q}` : null} nextHref={nextNo ? `/imprest/view/${nextNo}${q}` : null} />
      <Page title={`${r.no} — Imprest ${r.stage === 'Request' ? 'Request' : r.stage === 'Closed' ? '(Closed)' : r.stage}`}
        crumb={`${r.first_name} ${r.last_name} · ${r.purpose}${pendingWith ? ` · pending with ${pendingWith}` : ''}`} user={user}>
        <Toolbar>
          <Link href={selfService ? '/self-service/imprest' : '/imprest'} className="btn ghost sm">← {selfService ? 'My imprests' : 'All imprests'}</Link>
          <Link href={`/employees/${r.employee_id}`} className="btn ghost sm">Employee</Link>
          <a className="btn ghost sm" href={`/print/imprest-request/${encodeURIComponent(r.no)}`} target="_blank" rel="noreferrer">Print request form</a>
          {r.posted ? <a className="btn ghost sm" href={`/print/imprest-surrender/${encodeURIComponent(r.no)}`} target="_blank" rel="noreferrer">Print surrender form</a> : null}
          <Spacer />
          {isOpen && canCreate && isOwn ? <DeleteButton no={r.no} className="btn ghost" /> : null}
          {isOpen && canCreate && isOwn ? <SubmitButton no={r.no} className="btn ghost" /> : null}
          {!r.posted && r.status === 'Pending Approval' && canCancelReq ? <CancelApprovalButton no={r.no} className="btn ghost" /> : null}
          {!r.posted && r.status === 'Pending Approval' && canDecideReq ? (
            <>{routedReq ? <DelegateButton taskId={routedReq.id} className="btn ghost" /> : null}<ApproveButton no={r.no} /><RejectButton no={r.no} className="btn ghost" /></>
          ) : null}
          {!r.posted && r.status === 'Approved' && canApprove ? <ReopenButton no={r.no} className="btn ghost" /> : null}
          {!r.posted && r.status === 'Approved' && canIssue ? <IssueButton no={r.no} /> : null}
          {surrenderOpen && canCreate ? <SubmitSurrenderButton no={r.no} /> : null}
          {issued && r.surrender_status === 'Pending Approval' && canCancelSur ? <CancelSurrenderApprovalButton no={r.no} className="btn ghost" /> : null}
          {issued && r.surrender_status === 'Pending Approval' && canDecideSur ? (
            <>{routedSur ? <DelegateButton taskId={routedSur.id} className="btn ghost" /> : null}<ApproveSurrenderButton no={r.no} /><RejectSurrenderButton no={r.no} className="btn ghost" /></>
          ) : null}
          {issued && r.surrender_status === 'Approved' && canApprove ? <ReopenSurrenderButton no={r.no} className="btn ghost" /> : null}
          {issued && r.surrender_status === 'Approved' && canPost ? <PostSurrenderButton no={r.no} /> : null}
          {surrenderOpen && canRecover && r.overdue_days > 0 ? <TransferToPayrollButton no={r.no} className="btn ghost" /> : null}
          <DocumentActionsMenu />
        </Toolbar>

        <div className="grid g4 stack-2">
          <Stat label="Requested" value={<Money cents={r.request_amount} decimals={0} />} foot={`${r.lines} line${r.lines === 1 ? '' : 's'}`} />
          <Stat label={r.posted ? 'Spent (surrender)' : 'Status'} value={r.posted ? <Money cents={r.surrender_amount} decimals={0} /> : r.status}
            foot={r.posted ? (r.net_refund > 0 ? <>refund due <Money cents={r.net_refund} /></> : r.net_refund < 0 ? <>claim <Money cents={-r.net_refund} /></> : 'spent exactly what was issued') : 'request'} />
          <Stat label={r.posted ? 'Surrender due' : 'Employee balance'} value={r.posted ? (r.due_date ? formatDate(r.due_date) : '—') : <Money cents={r.employee_balance} decimals={0} />}
            foot={r.posted ? (r.overdue_days > 0 ? `${r.overdue_days} days overdue` : r.surrendered ? 'surrendered' : 'awaiting surrender') : 'on the subledger before this'} />
          <Stat label="Stage" value={<Pill tone={r.stage === 'Closed' ? 'ok' : r.stage === 'Issued' ? 'accent' : r.stage === 'Surrender' ? 'warn' : 'info'}>{r.stage}</Pill>}
            foot={r.transferred_to_payroll ? 'recovering through payroll' : r.pv_no ? `issued by voucher ${r.pv_no}` : r.settlement ?? '—'} />
        </div>

        <EditableCard collapsible title="Imprest request" sub={`${r.request_for === 'Other' ? 'On behalf of another · ' : ''}${r.purpose_description ?? r.purpose}`}
          canEdit={isOpen && canCreate && isOwn && !!lookups} form={lookups ? <ImprestEditForm request={r} lookups={lookups} /> : null}>
          <div className="grid g2">
            <DefinitionList items={[
              ['Imprest no.', <span className="mono" key="no">{r.no}</span>],
              ['Employee', <>{r.first_name} {r.last_name} <span className="mono">({r.employee_no})</span>{r.job_title ? <span className="muted-cell"> · {r.job_title}</span> : null}</>],
              ['Request date', formatDate(r.request_date)],
              ['Purpose', `${r.purpose_code ? `${r.purpose_code} — ` : ''}${r.purpose}`],
              ['Description', r.description || '—'],
              ['Justification', r.justification || '—'],
              ['Trip', r.departure_location || r.departure_date ? `${r.departure_location || '—'} · ${r.departure_date ? formatDate(r.departure_date) : '—'} → ${r.return_date ? formatDate(r.return_date) : '—'} (${r.total_days} day${r.total_days === 1 ? '' : 's'})` : '—'],
              ['Phone in the field', r.phone_no || '—'],
            ]} />
            <DefinitionList items={[
              ['Request status', <Pill status={r.status} key="s" />],
              r.decision_reason ? ['Decision reason', r.decision_reason] : null,
              ['Paying account', r.paying_bank_code ? `${r.paying_bank_code} — ${r.paying_bank_name}` : '—'],
              ['Pay mode / ref.', `${r.pay_mode_code || '—'} / ${r.payment_tx_no || '—'}`],
              ['Issued', r.posted ? `${formatDateTime(r.posted_at)} by ${r.posted_by}` : 'Not yet'],
              ['Surrender due', r.due_date ? formatDate(r.due_date) : '—'],
              ['Currency', r.currency_code],
              r.posted_journal_no ? ['Issue journal', <span className="mono" key="j">{r.posted_journal_no}</span>] : null,
            ]} />
          </div>
          <TableWrap>
            <thead><tr><th>Expense account</th><th>Narration</th><th className="num">Qty</th><th className="num">Unit cost</th><th className="num">Requested</th>{r.posted ? <><th className="num">Actual spent</th><th className="num">Difference</th></> : null}</tr></thead>
            <tbody>
              {r.line_items.map((l) => (
                <tr key={l.id}>
                  <td><span className="mono">{l.gl_account_code}</span> <span className="tiny muted-cell">{l.gl_account_name}</span></td>
                  <td>{l.narration || '—'}{l.surrender_note ? <div className="tiny muted-cell">{l.surrender_note}</div> : null}</td>
                  <td className="num">{l.quantity}</td>
                  <td className="num">{l.unit_cost ? <Money cents={l.unit_cost} /> : '—'}</td>
                  <td className="num"><Money cents={l.request_amount} /></td>
                  {r.posted ? <><td className="num"><Money cents={l.actual_spent} /></td><td className="num">{l.difference ? <Money cents={l.difference} /> : '—'}</td></> : null}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={4}>Total</td><td className="num"><b><Money cents={r.request_amount} /></b></td>{r.posted ? <><td className="num"><b><Money cents={r.surrender_amount} /></b></td><td className="num"><b><Money cents={r.surrender_amount - r.request_amount} /></b></td></> : null}</tr>
            </tfoot>
          </TableWrap>
        </EditableCard>

        {r.posted ? (
          <EditableCard collapsible title="Surrender" sub={r.surrendered ? `Posted ${formatDateTime(r.surrender_posted_at)} by ${r.surrender_posted_by}` : r.transferred_to_payroll ? 'Being recovered through payroll' : 'What was actually spent, and how the difference is settled'}
            canEdit={surrenderOpen && canCreate && !!lookups} form={lookups ? <SurrenderEditForm request={r} lookups={lookups} /> : null}>
            <div className="grid g2">
              <DefinitionList items={[
                ['Surrender status', <Pill status={r.surrender_status} key="ss" />],
                r.surrender_decision_reason ? ['Decision reason', r.surrender_decision_reason] : null,
                ['Surrender date', r.surrender_date ? formatDate(r.surrender_date) : '—'],
                ['Issued / spent', <><Money cents={r.request_amount} /> / <Money cents={r.surrender_amount} /></>],
                ['Difference', r.net_refund > 0 ? <>Refund due <b><Money cents={r.net_refund} /></b></> : r.net_refund < 0 ? <>Claim <b><Money cents={-r.net_refund} /></b></> : 'Spent exactly what was issued'],
                ['Settlement', r.settlement || '—'],
              ]} />
              <DefinitionList items={[
                ['Refund received into', r.receiving_bank_code ? `${r.receiving_bank_code} · ${r.receipt_mode_code || ''} ${r.receipt_tx_no || ''}` : '—'],
                ['Claim paid from', r.claim_bank_code ? `${r.claim_bank_code} · ${r.claim_pay_mode_code || ''} ${r.claim_payment_tx_no || ''}` : '—'],
                ['Payroll', r.transferred_to_payroll ? `Sent ${formatDateTime(r.payroll_transferred_at)} by ${r.payroll_transferred_by}` : '—'],
                r.surrender_journal_no ? ['Surrender journal', <span className="mono" key="sj">{r.surrender_journal_no}</span>] : null,
                ['Outstanding on this imprest', <Money cents={docEntries.reduce((s, e) => s + Number(e.amount), 0)} key="o" />],
              ]} />
            </div>
          </EditableCard>
        ) : null}

        <CollapsibleCard title="Employee subledger — this imprest" sub={<>{docEntries.length} entr{docEntries.length === 1 ? 'y' : 'ies'} · employee balance overall <Money cents={r.employee_balance} /></>}>
          {docEntries.length ? (
            <TableWrap>
              <thead><tr><th>Date</th><th>Type</th><th>Description</th><th className="num">Amount</th><th>Journal</th></tr></thead>
              <tbody>
                {docEntries.map((e) => (
                  <tr key={e.id}><td>{formatDate(e.posting_date)}</td><td><Pill>{e.entry_type.replace(/_/g, ' ')}</Pill></td><td>{e.description || '—'}</td><td className="num"><Money cents={e.amount} /></td><td className="mono">{e.journal_no || '—'}</td></tr>
                ))}
              </tbody>
            </TableWrap>
          ) : <EmptyState icon="🧾" title="Nothing posted yet" />}
        </CollapsibleCard>

        <CollapsibleCard title="Journal postings" sub={`${journals.length} G/L journal${journals.length === 1 ? '' : 's'} for ${r.no}`}>
          {journals.length ? (
            <TableWrap>
              <thead><tr><th>Journal</th><th>Value date</th><th>Description</th><th className="num">Amount</th></tr></thead>
              <tbody>{journals.map((h) => <tr key={h.journal_no}><td className="mono">{h.journal_no}</td><td>{formatDate(h.value_date)}</td><td>{h.description || '—'}</td><td className="num"><Money cents={h.amount} /></td></tr>)}</tbody>
            </TableWrap>
          ) : <EmptyState icon="🧾" title="Nothing posted yet" />}
        </CollapsibleCard>

        <CollapsibleCard title="Approval details" sub={`${tasks.length} approval step${tasks.length === 1 ? '' : 's'} routed (request and surrender)`}>
          {tasks.length ? (
            <TableWrap>
              <thead><tr><th>Document</th><th>Sent by</th><th>Sent date</th><th>Approver</th><th>Approved on</th><th /></tr></thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id}><td>{t.document_type === 'IMPREST_SURRENDER' ? 'Surrender' : 'Request'}</td><td>{t.requested_by || '—'}</td><td>{formatDateTime(t.requested_at)}</td>
                    <td className="muted-cell">{t.decided_by || t.pending_with || '—'}</td><td>{t.decided_at ? formatDateTime(t.decided_at) : '—'}</td><td><Pill status={t.status} /></td></tr>
                ))}
              </tbody>
            </TableWrap>
          ) : <EmptyState icon="🕓" title="Not yet sent for approval" />}
        </CollapsibleCard>

        <CollapsibleCard title="Document trail" sub="Who raised this, and when">
          <DefinitionList items={[['Created by', r.created_by || '—'], ['Created on', formatDateTime(r.created_at)]]} />
        </CollapsibleCard>
      </Page>
    </>
  );
}
