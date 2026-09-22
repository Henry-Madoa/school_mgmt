import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAnyAction, currentCanAction, currentCanAnyAction } from '@/lib/session';
import { assertCanViewEmployeeDocument } from '@/lib/selfService';
import { getRequisitionDetail, WORKFLOW_TYPE } from '@/lib/requisitions';
import { findPendingRoutedTask, isEligibleApprover, listWorkflowTasksForDocument } from '@/lib/workflow';
import { formatDate, formatDateTime } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { DefinitionList, EmptyState, Pill, Stat, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { EditableCard } from '@/components/ui/editable-card';
import { Money } from '@/components/ui/money';
import { DocumentActionsMenu } from '@/components/ui/document-actions';
import { requisitionLookups } from '../../lookups';
import { RequisitionStatusPill } from '../../status-pill';
import {
  RequisitionEditForm, QuantityApprovedCell, IssueStoreForm, ReviewLineRow, SubmitRequisitionButton, CancelRequisitionApprovalButton,
  ApproveRequisitionButton, RejectRequisitionButton, DelegateButton, ReopenRequisitionButton, DeleteRequisitionButton, ConfirmReceiptButton,
  ExecuteReviewButton, ClosePrButton,
} from '../../requisition-actions';

export const dynamic = 'force-dynamic';

export default async function RequisitionPage({ params }: { params: Promise<{ no: string }> }) {
  const user = await requireAnyAction('REQUISITIONS_READ', 'SELF_SERVICE_REQUISITIONS_READ');
  const { no } = await params;
  const r = await getRequisitionDetail(no);
  if (!r) notFound();
  // Employee Self Service: an employee reaches only their own requisitions.
  const { selfService } = await assertCanViewEmployeeDocument(user, 'REQUISITIONS_READ', 'SELF_SERVICE_REQUISITIONS_READ', r.employee_id);
  const isStore = r.requisition_type === 'Store Requisition';
  const wfType = WORKFLOW_TYPE[r.requisition_type];
  const [canCreate, canApprove, canIssue, canProcess, tasks] = await Promise.all([
    currentCanAnyAction('REQUISITIONS_CREATE', 'SELF_SERVICE_REQUISITIONS_CREATE'), currentCanAction('REQUISITIONS_APPROVE'), currentCanAction('REQUISITIONS_ISSUE'), currentCanAction('REQUISITIONS_PROCESS'),
    listWorkflowTasksForDocument(wfType, no),
  ]);
  const isOwn = r.created_by === user.username;
  const isOpen = r.status === 'Open';
  const approvedActive = r.status === 'Approved' && !r.issued && !r.pr_closed;
  const routed = r.status === 'Pending Approval' ? await findPendingRoutedTask(wfType, no) : null;
  const canDecide = routed ? await isEligibleApprover(routed, user.id) : canApprove;
  const canCancel = canCreate && (routed?.requested_by ?? r.created_by) === user.username;
  const canTrim = canApprove && (r.status === 'Pending Approval' || approvedActive) && (r.status !== 'Pending Approval' || canDecide);
  const needsLookups = (isOpen && canCreate && isOwn) || (!isStore && approvedActive && canProcess);
  const lookups = needsLookups ? await requisitionLookups() : null;
  const printKind = isStore ? 'store-requisition' : 'purchase-requisition';
  const leftToIssue = r.total_quantity_approved - r.total_quantity_issued;

  return (
    <Page title={`${r.no} — ${r.requisition_type}`} crumb={`${r.title} · ${r.first_name} ${r.last_name}`} user={user}>
      <Toolbar>
        <Link href={selfService ? '/self-service/requisitions' : `/requisitions/${isStore ? '' : 'purchase'}`} className="btn ghost sm">← {selfService ? 'My requisitions' : `All ${isStore ? 'store' : 'purchase'} requisitions`}</Link>
        <Link href={`/employees/${r.employee_id}`} className="btn ghost sm">Employee</Link>
        <a className="btn ghost sm" href={`/print/${printKind}/${encodeURIComponent(r.no)}`} target="_blank" rel="noreferrer">Print {isStore ? 'store requisition' : 'purchase requisition'}</a>
        <Spacer />
        {isOpen && canCreate && isOwn ? <DeleteRequisitionButton no={r.no} listHref={selfService ? '/self-service/requisitions' : `/requisitions/${isStore ? '' : 'purchase'}`} className="btn ghost" /> : null}
        {isOpen && canCreate && isOwn ? <SubmitRequisitionButton no={r.no} className="btn ghost" /> : null}
        {r.status === 'Pending Approval' && canCancel ? <CancelRequisitionApprovalButton no={r.no} className="btn ghost" /> : null}
        {r.status === 'Pending Approval' && canDecide ? (
          <>{routed ? <DelegateButton taskId={routed.id} className="btn ghost" /> : null}<ApproveRequisitionButton no={r.no} type={r.requisition_type} /><RejectRequisitionButton no={r.no} type={r.requisition_type} className="btn ghost" /></>
        ) : null}
        {approvedActive && canApprove && r.total_quantity_issued === 0 && r.lines_processed === 0 ? <ReopenRequisitionButton no={r.no} className="btn ghost" /> : null}
        {!isStore && approvedActive && canProcess ? <ClosePrButton no={r.no} className="btn ghost" /> : null}
        {!isStore && approvedActive && canProcess && r.line_items.some((l) => !l.processed && l.decision && l.target_no) ? <ExecuteReviewButton no={r.no} /> : null}
        {isStore && r.issued && r.status === 'Approved' && isOwn ? <ConfirmReceiptButton no={r.no} /> : null}
        <DocumentActionsMenu />
      </Toolbar>

      <div className="grid g3 stack-2">
        {isStore ? (
          <>
            <Stat label="Requested / approved" value={`${r.total_quantity} / ${r.total_quantity_approved}`} foot={`${r.lines} line${r.lines === 1 ? '' : 's'} · ${r.location_code || 'store not set'}`} />
            <Stat label="Issued" value={String(r.total_quantity_issued)} foot={r.issued ? `issued in full by ${r.issued_by} on ${formatDate(r.issued_at)}` : leftToIssue > 0 && r.status === 'Approved' ? `${leftToIssue} still to issue` : 'nothing issued yet'} />
          </>
        ) : (
          <>
            <Stat label="Estimated amount" value={<Money cents={r.total_amount} decimals={0} />} foot={`${r.lines} line${r.lines === 1 ? '' : 's'} · ${r.procurement_method || 'method not set'}`} />
            <Stat label="Documents raised" value={String(r.documents.length)} foot={r.documents.length ? r.documents.map((d) => `${d.document_type} ${d.no}`).join(', ') : `${r.lines_processed}/${r.lines} lines processed`} />
          </>
        )}
        <Stat label="Status" value={<RequisitionStatusPill r={r} />}
          foot={r.pr_closed ? `closed by ${r.pr_closed_by_user} on ${formatDate(r.pr_closed_at)}` : r.status === 'Received' ? `received by ${r.received_by} on ${formatDate(r.received_at)}` : r.decision_reason ? `sent back: ${r.decision_reason}` : `raised ${formatDate(r.created_at)}`} />
      </div>

      <EditableCard collapsible title={r.requisition_type} sub={r.title} canEdit={isOpen && canCreate && isOwn && !!lookups}
        form={lookups ? <RequisitionEditForm requisition={r} lookups={lookups} /> : null}>
        <div className="grid g2">
          <DefinitionList items={[
            ['Requisition no.', <span className="mono" key="no">{r.no}</span>],
            ['Requested by', <>{r.first_name} {r.last_name} <span className="mono">({r.employee_no})</span>{r.job_title ? <span className="muted-cell"> · {r.job_title}</span> : null}</>],
            ['Requisition date', formatDate(r.requisition_date)],
            ['Needed by', r.needed_by_date ? formatDate(r.needed_by_date) : '—'],
            isStore ? null : ['Expires on', r.expiration_date ? formatDate(r.expiration_date) : '—'],
            ['Requested delivery', r.requested_delivery_date ? formatDate(r.requested_delivery_date) : '—'],
            [isStore ? 'Purpose' : 'Justification', r.description || '—'],
          ]} />
          <DefinitionList items={[
            ['Status', <Pill status={r.status} key="s" />],
            r.decision_reason ? ['Decision reason', r.decision_reason] : null,
            [isStore ? 'Store location' : 'Deliver to', r.location_code ? `${r.location_code} — ${r.location_name}` : '—'],
            isStore ? null : ['Procurement method', r.procurement_method || '—'],
            isStore ? null : ['Suggested supplier', r.supplier_no ? `${r.supplier_no} — ${r.supplier_name}` : '—'],
            isStore ? ['Issued', r.issued ? `${formatDateTime(r.issued_at)} by ${r.issued_by}` : 'Not yet'] : ['PR closed', r.pr_closed ? `${r.pr_closed_by} — ${formatDateTime(r.pr_closed_at)} by ${r.pr_closed_by_user}${r.pr_close_reason ? ` · ${r.pr_close_reason}` : ''}` : 'Open'],
            isStore ? ['Received', r.received ? `${formatDateTime(r.received_at)} by ${r.received_by}` : 'Not yet'] : ['PO generated', r.po_generated_directly ? `${r.po_number} — ${formatDateTime(r.po_generated_at)} by ${r.po_generated_by}` : 'Not yet'],
            ['Currency', r.currency_code],
          ]} />
        </div>
        <TableWrap>
          <thead>
            <tr>
              {isStore ? null : <th>Type</th>}
              <th>No.</th><th>Description</th>
              {isStore ? <><th>Unit</th><th>Location</th></> : null}
              <th className="num">Requested</th><th className="num">Approved</th>
              {isStore ? <><th className="num">Issued</th><th className="num">In store</th></> : <><th className="num">Unit price</th><th className="num">Amount</th><th>Decision</th></>}
            </tr>
          </thead>
          <tbody>
            {r.line_items.map((l) => (
              <tr key={l.id}>
                {isStore ? null : <td>{l.type}</td>}
                <td className="mono">{l.no}</td><td>{l.description}</td>
                {isStore ? <><td>{l.unit_of_measure_code || '—'}</td><td className="mono">{l.location_code || '—'}</td></> : null}
                <td className="num">{l.quantity}</td>
                <td className="num">{canTrim && !l.processed && l.quantity_issued < l.quantity_approved + 1 && !(isStore && r.issued) ? <QuantityApprovedCell no={r.no} line={l} /> : l.quantity_approved}</td>
                {isStore ? (
                  <><td className="num">{l.quantity_issued}{l.issued_by ? <div className="tiny muted-cell">{l.issued_by}</div> : null}</td><td className="num">{l.quantity_in_store}</td></>
                ) : (
                  <>
                    <td className="num"><Money cents={l.unit_price} /></td><td className="num"><Money cents={l.amount} /></td>
                    <td>{approvedActive && canProcess && lookups ? <ReviewLineRow no={r.no} line={l} lookups={lookups} /> : l.processed ? <span className="tiny">{l.decision} → <span className="mono">{l.order_no}</span></span> : l.decision ? `${l.decision} · ${l.target_name || l.target_no}` : '—'}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
          {isStore ? null : <tfoot><tr><td colSpan={6}>Estimated total</td><td className="num"><b><Money cents={r.total_amount} /></b></td><td /></tr></tfoot>}
        </TableWrap>
        {!isStore && approvedActive && canProcess ? <div className="hint" style={{ marginTop: 8 }}>Decide each line — RFQ raises a purchase quote, Order a purchase order (one per vendor), Append adds the line to an open order — then Execute.</div> : null}
      </EditableCard>

      {isStore && approvedActive && canIssue && leftToIssue > 0 ? (
        <CollapsibleCard title="Issue items" sub="Store admin — what leaves the store now; each line posts a Negative Adjmt. item journal line">
          <IssueStoreForm requisition={r} />
        </CollapsibleCard>
      ) : null}

      {isStore ? (
        <CollapsibleCard title="Issues posted" sub={`${r.issues.length} item journal line${r.issues.length === 1 ? '' : 's'}`}>
          {r.issues.length ? (
            <TableWrap>
              <thead><tr><th>Journal line</th><th>Line</th><th>Item</th><th>Location</th><th className="num">Qty (base)</th><th>Posting date</th><th>Issued by</th></tr></thead>
              <tbody>{r.issues.map((i) => <tr key={i.no}><td className="mono"><Link href="/inventory/item-journal?view=processed">{i.no}</Link></td><td>{i.line_no / 10000}</td><td><span className="mono">{i.item_no}</span> {i.description}</td><td className="mono">{i.location_code}</td><td className="num">{i.quantity}</td><td>{formatDate(i.posting_date)}</td><td>{i.posted_by || '—'}</td></tr>)}</tbody>
            </TableWrap>
          ) : <EmptyState icon="📦" title="Nothing issued yet" />}
        </CollapsibleCard>
      ) : (
        <CollapsibleCard title="Purchase documents raised" sub={`${r.documents.length} document${r.documents.length === 1 ? '' : 's'} carry this requisition number`}>
          {r.documents.length ? (
            <TableWrap>
              <thead><tr><th>Document</th><th>Type</th><th>Vendor</th><th>Status</th><th className="num">Amount</th></tr></thead>
              <tbody>{r.documents.map((d) => <tr key={d.no}><td className="mono"><Link href={`/payables/documents/${d.no}`}>{d.no}</Link></td><td>{d.document_type}</td><td><span className="mono">{d.vendor_no}</span> {d.vendor_name}</td><td><Pill status={d.status} /></td><td className="num"><Money cents={d.amount} /></td></tr>)}</tbody>
            </TableWrap>
          ) : <EmptyState icon="🧾" title="No purchase documents yet" sub="Decide the lines and execute to raise quotes or orders." />}
        </CollapsibleCard>
      )}

      <CollapsibleCard title="Approval details" sub={`${tasks.length} approval step${tasks.length === 1 ? '' : 's'} routed`}>
        {tasks.length ? (
          <TableWrap>
            <thead><tr><th>Sent by</th><th>Sent date</th><th>Approver</th><th>Approved on</th><th /></tr></thead>
            <tbody>{tasks.map((t) => <tr key={t.id}><td>{t.requested_by || '—'}</td><td>{formatDateTime(t.requested_at)}</td><td className="muted-cell">{t.decided_by || t.pending_with || '—'}</td><td>{t.decided_at ? formatDateTime(t.decided_at) : '—'}</td><td><Pill status={t.status} /></td></tr>)}</tbody>
          </TableWrap>
        ) : <EmptyState icon="🕓" title="Not yet sent for approval" />}
      </CollapsibleCard>

      <CollapsibleCard title="Document trail" sub="Who raised this, and when">
        <DefinitionList items={[['Created by', r.created_by || '—'], ['Created on', formatDateTime(r.created_at)]]} />
      </CollapsibleCard>
    </Page>
  );
}
