'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { useRunAction } from '@/components/ui/run-action';
import {
  submitReceiptRequest, cancelReceiptApprovalRequest, decideReceiptRequest, reopenReceiptRequest,
  postReceiptRequest, deleteReceiptRequest,
  submitPvRequest, cancelPvApprovalRequest, decidePvRequest, reopenPvRequest, postPvRequest, deletePvRequest,
} from '@/app/actions/cashMgmt';

type Kind = 'receipt' | 'pv';

function A({ label, busyLabel, onClick, className = 'btn sm ghost' }: { label: string; busyLabel?: string; onClick: () => void; className?: string }) {
  const { busy } = useRunAction();
  return <button type="button" className={className} disabled={busy} onClick={onClick}>{busy ? busyLabel ?? 'Working…' : label}</button>;
}

const map = {
  receipt: { submit: submitReceiptRequest, cancel: cancelReceiptApprovalRequest, decide: decideReceiptRequest, reopen: reopenReceiptRequest, post: postReceiptRequest, del: deleteReceiptRequest },
  pv: { submit: submitPvRequest, cancel: cancelPvApprovalRequest, decide: decidePvRequest, reopen: reopenPvRequest, post: postPvRequest, del: deletePvRequest },
} as const;

export function SubmitButton({ no, kind }: { no: string; kind: Kind }) {
  const { run } = useRunAction();
  return <A label="Send for approval" onClick={() => run(() => map[kind].submit(no), {
    confirm: { title: 'Send for approval?', message: 'It can no longer be edited while pending.', confirmLabel: 'Send' },
    successTitle: (d: { autoApproved: boolean }) => (d.autoApproved ? 'Approved — ready to post' : 'Sent for approval'),
  })} />;
}

export function CancelApprovalButton({ no, kind }: { no: string; kind: Kind }) {
  const { run } = useRunAction();
  return <A label="Recall" onClick={() => run(() => map[kind].cancel(no), {
    confirm: { title: 'Recall this document?', message: 'It goes back to Open.', confirmLabel: 'Recall' }, successTitle: 'Recalled — back to Open',
  })} />;
}

export function ApproveButton({ no, kind }: { no: string; kind: Kind }) {
  const { run } = useRunAction();
  return <A label="Approve" className="btn sm" onClick={() => run(() => map[kind].decide(no, true, null), {
    confirm: { title: 'Approve this document?', message: 'Nothing moves until it is posted.', confirmLabel: 'Approve' }, successTitle: 'Approved — ready to post',
  })} />;
}

export function RejectButton({ no, kind }: { no: string; kind: Kind }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn sm ghost" onClick={() => setOpen(true)}>Reject</button>
      {open ? (
        <FormModal title="Reject" onClose={() => setOpen(false)} onSubmit={(v) => map[kind].decide(no, false, String(v.reason || ''))}
          submitLabel="Reject" submitClass="btn danger" successTitle="Rejected — back to Open" resultStyle="popup">
          <Field name="reason" label="Reason" type="textarea" required />
        </FormModal>
      ) : null}
    </>
  );
}

export function ReopenButton({ no, kind }: { no: string; kind: Kind }) {
  const { run } = useRunAction();
  return <A label="Reopen" onClick={() => run(() => map[kind].reopen(no), {
    confirm: { title: 'Reopen this document?', message: 'It goes back to Open for amendment.', confirmLabel: 'Reopen' }, successTitle: 'Reopened',
  })} />;
}

/** The list each document kind is deleted back to — its card is gone once the row is. */
const LIST_FOR: Record<Kind, string> = { receipt: '/cash-management/receipts', pv: '/cash-management/payment-vouchers' };

export function DeleteButton({ no, kind }: { no: string; kind: Kind }) {
  const { run } = useRunAction();
  return <A label="Delete" className="btn sm ghost danger" onClick={() => run(() => map[kind].del(no), {
    confirm: { title: 'Delete this document?', message: 'This cannot be undone.', confirmLabel: 'Delete' }, successTitle: 'Deleted',
    redirectTo: LIST_FOR[kind],
  })} />;
}

export function PostReceiptButton({ no }: { no: string }) {
  const { run } = useRunAction();
  return <A label="Post" className="btn sm" onClick={() => run(() => postReceiptRequest(no), {
    confirm: { title: 'Post this receipt?', message: 'It writes a journal and cannot be reversed here.', confirmLabel: 'Post' },
    successTitle: (d: { postedReceiptNo: string }) => `Posted as ${d.postedReceiptNo}`,
  })} />;
}

export function PostPvButton({ no }: { no: string }) {
  const { run } = useRunAction();
  return <A label="Post" className="btn sm" onClick={() => run(() => postPvRequest(no), {
    confirm: { title: 'Post this payment voucher?', message: 'It pays the bank, withholds tax and cannot be reversed here.', confirmLabel: 'Post' },
    successTitle: (d: { postedVoucherNo: string; whtCertificateNos: string[] }) =>
      `Posted as ${d.postedVoucherNo}${d.whtCertificateNos.length ? ` — WHT certificate ${d.whtCertificateNos.join(', ')}` : ''}`,
  })} />;
}
