'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { GlAccountField } from '@/components/ui/gl-account-select';
import { useRunAction } from '@/components/ui/run-action';
import { today } from '@/lib/format';
import {
  startReconciliationRequest, suggestRecLinesRequest, matchRecLineRequest, addRecAdjustmentRequest,
  deleteRecLineRequest, postReconciliationRequest,
} from '@/app/actions/cashMgmt';
import type { GlAccount } from '@/lib/types';

export function StartReconciliationButton({ banks }: { banks: { id: number; code: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>Start reconciliation</button>
      {open ? (
        <FormModal title="Start bank reconciliation" onClose={() => setOpen(false)} onSubmit={(v) => startReconciliationRequest(v)}
          submitLabel="Start" successTitle="Reconciliation started" successDetail={(d: { id: number }) => `Open it to match statement lines (#${d.id})`}>
          <Field name="bankAccountId" label="Bank account" type="select" required options={[{ value: '', label: '…' }, ...banks.map((b) => ({ value: String(b.id), label: `${b.code} — ${b.name}` }))]} />
          <div className="grid g2">
            <Field name="statementDate" label="Statement date" type="date" required defaultValue={today()} />
            <Field name="statementEndingBalance" label="Statement ending balance" type="currency" required />
          </div>
        </FormModal>
      ) : null}
    </>
  );
}

export function SuggestLinesButton({ id }: { id: number }) {
  const { run, busy } = useRunAction();
  return <button type="button" className="btn sm" disabled={busy}
    onClick={() => run(() => suggestRecLinesRequest(id), { successTitle: (d: { added: number }) => `${d.added} lines suggested` })}>Suggest lines</button>;
}

export function MatchLineButton({ lineId, applied }: { lineId: number; applied: boolean }) {
  const { run, busy } = useRunAction();
  return <button type="button" className={applied ? 'btn sm' : 'btn sm ghost'} disabled={busy}
    onClick={() => run(() => matchRecLineRequest(lineId, !applied), { successTitle: applied ? 'Unmatched' : 'Matched' })}>{applied ? '✔ matched' : 'match'}</button>;
}

export function DeleteRecLineButton({ lineId }: { lineId: number }) {
  const { run, busy } = useRunAction();
  return <button type="button" className="btn sm ghost danger" disabled={busy}
    onClick={() => run(() => deleteRecLineRequest(lineId), { successTitle: 'Line removed' })}>×</button>;
}

export function AddAdjustmentButton({ id, accounts }: { id: number; accounts: GlAccount[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn sm ghost" onClick={() => setOpen(true)}>Add G/L adjustment</button>
      {open ? (
        <FormModal title="Statement-only adjustment" onClose={() => setOpen(false)} onSubmit={(v) => addRecAdjustmentRequest(id, v)}
          submitLabel="Add" successTitle="Adjustment added" resultStyle="popup">
          <GlAccountField name="glAccountId" label="G/L account" required accounts={accounts} />
          <Field name="amount" label="Amount (negative for a charge, positive for interest)" type="currency" required />
          <Field name="description" label="Description" required />
        </FormModal>
      ) : null}
    </>
  );
}

export function PostReconciliationButton({ id, difference }: { id: number; difference: number }) {
  const { run, busy } = useRunAction();
  return <button type="button" className="btn" disabled={busy || difference !== 0}
    onClick={() => run(() => postReconciliationRequest(id), {
      confirm: { title: 'Post this reconciliation?', message: 'Matched entries are locked and adjustments post to the G/L.', confirmLabel: 'Post' },
      successTitle: 'Reconciliation posted',
    })}>{difference === 0 ? 'Post' : `Difference ${difference / 100}`}</button>;
}
