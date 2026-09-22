'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { useRunAction } from '@/components/ui/run-action';
import {
  makeOrderRequest, submitPurchaseDocumentRequest, cancelPurchaseDocumentApprovalRequest, approvePurchaseDocumentRequest,
  rejectPurchaseDocumentRequest, reopenPurchaseDocumentRequest, postPurchaseDocumentRequest, deletePurchaseDocumentRequest,
} from '@/app/actions/payables';

function A({ label, busyLabel, onClick, className = 'btn sm ghost' }: { label: string; busyLabel?: string; onClick: () => void; className?: string }) {
  const { busy } = useRunAction();
  return <button type="button" className={className} disabled={busy} onClick={onClick}>{busy ? busyLabel ?? 'Working…' : label}</button>;
}

/* ------------------------------------------------------------- purchase documents */

export function MakeOrderButton({ no }: { no: string }) {
  const { run } = useRunAction();
  return <A label="Make order" onClick={() => run(() => makeOrderRequest(no), {
    confirm: { title: 'Convert this quote to an order?', message: 'The quote is replaced by a new purchase order.', confirmLabel: 'Make order' },
    successTitle: (d) => `Order ${d.no} created`,
  })} className="btn sm" />;
}

export function SubmitDocButton({ no }: { no: string }) {
  const { run } = useRunAction();
  return <A label="Send for approval" onClick={() => run(() => submitPurchaseDocumentRequest(no), {
    confirm: { title: 'Send for approval?', message: 'It can no longer be edited while pending.', confirmLabel: 'Send' },
    successTitle: (d) => (d.autoApproved ? 'Released — ready to post' : 'Sent for approval'),
  })} />;
}

export function CancelApprovalButton({ no }: { no: string }) {
  const { run } = useRunAction();
  const fn = cancelPurchaseDocumentApprovalRequest;
  return <A label="Cancel approval" onClick={() => run(() => fn(no), {
    confirm: { title: 'Recall this document?', message: 'It goes back to Open.', confirmLabel: 'Recall' }, successTitle: 'Recalled — back to Open',
  })} />;
}

export function ApproveDocButton({ no }: { no: string }) {
  const { run } = useRunAction();
  return <A label="Release" className="btn sm" onClick={() => run(() => approvePurchaseDocumentRequest(no), {
    confirm: { title: 'Release this document?', message: 'Nothing moves until it is posted.', confirmLabel: 'OK' },
    successTitle: 'Released — ready to post',
  })} />;
}

export function RejectDocButton({ no }: { no: string }) {
  const [open, setOpen] = useState(false);
  const fn = rejectPurchaseDocumentRequest;
  return (
    <>
      <button type="button" className="btn sm ghost" onClick={() => setOpen(true)}>Reject</button>
      {open ? (
        <FormModal title="Reject" onClose={() => setOpen(false)} onSubmit={(v) => fn(no, String(v.reason || ''))}
          submitLabel="Reject" submitClass="btn danger" successTitle="Rejected — back to Open" resultStyle="popup">
          <Field name="reason" label="Reason" type="textarea" required />
        </FormModal>
      ) : null}
    </>
  );
}

export function ReopenDocButton({ no }: { no: string }) {
  const { run } = useRunAction();
  const fn = reopenPurchaseDocumentRequest;
  return <A label="Reopen" onClick={() => run(() => fn(no), {
    confirm: { title: 'Reopen this document?', message: 'It goes back to Open for amendment.', confirmLabel: 'Reopen' }, successTitle: 'Reopened',
  })} />;
}

/** listHref is where a delete from the document card lands — the list that card came from
 *  (quotes, orders, invoices or credit memos), which the card knows and this button does not.
 *  From a list row it is left out and the list simply refreshes. */
export function DeleteDocButton({ no, listHref }: { no: string; listHref?: string }) {
  const { run } = useRunAction();
  const fn = deletePurchaseDocumentRequest;
  return <A label="Delete" onClick={() => run(() => fn(no), {
    confirm: { title: 'Delete this document?', message: 'It is removed permanently.', confirmLabel: 'Delete' }, successTitle: 'Deleted',
    redirectTo: listHref,
  })} />;
}

/** Where a posting lands: the posted document it created, or the Posted list if it made none.
 *  Posting deletes the source purchase_header, so staying on the document page would 404. */
const postedLink = (no: string | null | undefined): string =>
  (no ? `/payables/posted/${encodeURIComponent(no)}` : '/payables/posted-documents');

export function PostPurchaseDocButton({ no, isOrder }: { no: string; isOrder: boolean }) {
  const [open, setOpen] = useState(false);
  const { run } = useRunAction();
  const post = (receive: boolean, invoice: boolean) => run(() => postPurchaseDocumentRequest(no, receive, invoice), {
    successTitle: 'Purchase document posted',
    successDetail: (d) => [d.receiptNo && `Receipt ${d.receiptNo}`, d.invoiceNo && `Invoice ${d.invoiceNo}`, d.journalNo && `Journal ${d.journalNo}`].filter(Boolean).join(' · ') || 'Posted',
    // The invoice is the document the user wants to see; a receive-only run has only the GRN.
    redirectTo: (d) => postedLink(d.invoiceNo ?? d.receiptNo),
  });
  if (!isOrder) {
    return <A label="Post" className="btn sm" onClick={() => run(() => postPurchaseDocumentRequest(no, false, true), {
      confirm: { title: 'Post this document?', message: 'The vendor ledger and the G/L move immediately.', confirmLabel: 'Post' },
      successTitle: 'Posted',
      successDetail: (d) => (d.invoiceNo ? `Invoice ${d.invoiceNo}` : d.journalNo ? `Journal ${d.journalNo}` : 'Posted'),
      redirectTo: (d) => postedLink(d.invoiceNo),
    })} />;
  }
  return (
    <>
      <button type="button" className="btn sm" onClick={() => setOpen(true)}>Post…</button>
      {open ? (
        <FormModal title={`Post order ${no}`} onClose={() => setOpen(false)} onSubmit={async () => ({ ok: true, data: {} })} submitLabel="Close" resultStyle="popup">
          <div className="inline" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn" onClick={() => { post(true, true); setOpen(false); }}>Receive and Invoice</button>
            <button type="button" className="btn ghost" onClick={() => { post(true, false); setOpen(false); }}>Receive only</button>
            <button type="button" className="btn ghost" onClick={() => { post(false, true); setOpen(false); }}>Invoice only</button>
          </div>
          <div className="hint">Only the Qty. to Receive / Qty. to Invoice on each line is posted — partial posting is supported.</div>
        </FormModal>
      ) : null}
    </>
  );
}

export { DelegateButton } from '@/components/ui/delegate-button';
