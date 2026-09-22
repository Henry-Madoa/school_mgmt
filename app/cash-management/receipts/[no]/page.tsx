import { notFound } from 'next/navigation';
import { requireAction, currentCanAction, requirePage } from '@/lib/session';
import { getReceipt } from '@/lib/receipts';
import { Page } from '@/components/layout/page';
import { Toolbar, Spacer } from '@/components/ui/primitives';
import {
  SubmitButton, CancelApprovalButton, ApproveButton, RejectButton, ReopenButton, DeleteButton, PostReceiptButton,
} from '../../document-actions';
import { ReceiptCard } from '../../receipt-card';
import { docFormProps } from '../../doc-form-props';

export const dynamic = 'force-dynamic';

export default async function ReceiptDetailPage({ params }: { params: Promise<{ no: string }> }) {
  const user = await requireAction('CASH_MGMT_READ');
  await requirePage('CASH_MGMT_RECEIPTS');
  const { no } = await params;
  const r = await getReceipt(no);
  if (!r) notFound();
  const [canCreate, canApprove, canPost] = await Promise.all([
    currentCanAction('CASH_MGMT_RECEIPT_CREATE'), currentCanAction('CASH_MGMT_RECEIPT_APPROVE'), currentCanAction('CASH_MGMT_RECEIPT_POST'),
  ]);
  const isOwn = r.created_by === user.username;
  // An Open receipt is still the creator's draft, so it is edited here on its own card rather
  // than only from the list — the lookups the line editor needs are loaded only when it can be.
  const editable = !r.posted && r.status === 'Open' && canCreate && isOwn;
  // General Ledger Setup's Receipt Approval Limit, as it stood when this receipt was raised.
  // At or above it the receipt must be approved before it can post; below it the creator posts
  // it themselves and approval never enters into it — so only one of the two buttons is ever
  // offered, instead of both and a refusal afterwards.
  const needsApproval = r.amount >= r.approval_limit;
  const formProps = editable ? await docFormProps() : null;

  return (
    <Page title={`Receipt ${r.no}`} crumb="Cash Management → Receipts" user={user}>
      {/* The actions sit above the document, where they are reachable without scrolling past it. */}
      <Toolbar>
        <a href="/cash-management/receipts" className="btn ghost sm">← All receipts</a>
        {r.posted ? (
          <a className="btn ghost sm" href={`/print/receipt/${encodeURIComponent(r.no)}`} target="_blank" rel="noreferrer">
            Print official receipt
          </a>
        ) : null}
        <Spacer />
        {editable ? <DeleteButton no={r.no} kind="receipt" /> : null}
        {editable && needsApproval ? <SubmitButton no={r.no} kind="receipt" /> : null}
        {r.status === 'Pending Approval' && canCreate && isOwn ? <CancelApprovalButton no={r.no} kind="receipt" /> : null}
        {r.status === 'Pending Approval' && canApprove ? (<><ApproveButton no={r.no} kind="receipt" /><RejectButton no={r.no} kind="receipt" /></>) : null}
        {!r.posted && r.status === 'Approved' && canApprove ? <ReopenButton no={r.no} kind="receipt" /> : null}
        {/* Post appears once there is nothing left to wait for: approved when approval was
            needed, or straight away when it was not. */}
        {!r.posted && canPost && (needsApproval ? r.status === 'Approved' : r.status === 'Open')
          ? <PostReceiptButton no={r.no} />
          : null}
      </Toolbar>

      <ReceiptCard receipt={r} lookups={formProps} canEdit={editable} />
    </Page>
  );
}
