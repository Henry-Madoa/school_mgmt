'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { useEditableCard } from '@/components/ui/editable-card';
import { Field, MoneyInput, toTwoDp } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { GlAccountSelect } from '@/components/ui/gl-account-select';
import { useRunAction } from '@/components/ui/run-action';
import { useFormat } from '@/components/ui/format-provider';
import { today } from '@/lib/format';
import {
  requestStaffClaim, saveStaffClaim, setStaffClaimPaymentAction, deleteStaffClaimAction, submitStaffClaimAction, cancelStaffClaimApprovalAction,
  approveStaffClaimAction, rejectStaffClaimAction, reopenStaffClaimAction, stopStaffClaimAction, releaseStaffClaimAction, postStaffClaimAction,
  type StaffClaimLineDraft,
} from '@/app/actions/staffClaims';
import type { ImprestLookups } from './imprest-actions';
import type { StaffClaimDetail } from '@/lib/types';

const emptyLine = (): StaffClaimLineDraft => ({ glAccountCode: '', narration: '', expenseDate: '', receiptRef: '', quantity: '1', unitCost: '', amount: '' });

function PaymentFields({ lookups, initial }: { lookups: ImprestLookups; initial?: StaffClaimDetail | null }) {
  const [settlement, setSettlement] = useState<string>(initial?.settlement ?? 'Pay Now');
  const [bank, setBank] = useState(String(initial?.paying_bank_account_id ?? ''));
  return (
    <div className="grid g4">
      <div className="field">
        <label htmlFor="f_settlement">Paid</label>
        <select id="f_settlement" name="settlement" value={settlement} onChange={(e) => setSettlement(e.target.value)}>
          <option value="Pay Now">Now — from a bank / cash account</option>
          <option value="Pay from Payroll">Through the next payroll</option>
        </select>
      </div>
      {settlement === 'Pay Now' ? (
        <>
          <SearchableSelect id="f_payingBankAccountId" name="payingBankAccountId" label="Paid from" items={lookups.banks}
            getValue={(b) => String(b.id)} getLabel={(b) => `${b.code} — ${b.name}`} value={bank} onChange={setBank} placeholder="Search account…" emptyText="No bank accounts" />
          <Field name="payModeCode" label="Pay mode" type="select" defaultValue={initial?.pay_mode_code ?? ''}
            options={[{ value: '', label: '(none)' }, ...lookups.payMethods.map((m) => ({ value: m.code, label: `${m.code} — ${m.description}` }))]} />
          <Field name="paymentTxNo" label="Cheque / EFT no." defaultValue={initial?.payment_tx_no ?? ''} />
        </>
      ) : <input type="hidden" name="payingBankAccountId" value="" />}
    </div>
  );
}

function ClaimFields({ lookups, initial, lines, setLines }: {
  lookups: ImprestLookups; initial?: StaffClaimDetail | null; lines: StaffClaimLineDraft[]; setLines: (l: StaffClaimLineDraft[]) => void;
}) {
  const { cur } = useFormat();
  const [employeeId, setEmployeeId] = useState(String(initial?.employee_id ?? ''));
  const set = (i: number, k: keyof StaffClaimLineDraft, v: string) => setLines(lines.map((l, idx) => {
    if (idx !== i) return l;
    const next = { ...l, [k]: v };
    if (k === 'quantity' || k === 'unitCost') { const q = Number(next.quantity) || 0; const u = Number(next.unitCost) || 0; if (q && u) next.amount = toTwoDp(String(q * u)); }
    return next;
  }));
  const total = lines.reduce((s, l) => s + Math.round((Number(l.amount) || 0) * 100), 0);
  return (
    <>
      <div className="grid g3">
        <SearchableSelect id="f_employeeId" name="employeeId" label="Claimant (employee)" required items={lookups.employees}
          getValue={(e) => String(e.id)} getLabel={(e) => `${e.employee_no} — ${e.first_name} ${e.last_name}`} value={employeeId} onChange={setEmployeeId}
          placeholder="Search employee…" emptyText="No matching employees" disabled={!!initial} />
        <Field name="claimDate" label="Claim date" type="date" required defaultValue={initial?.claim_date ?? today()} />
        <Field name="description" label="Description" required defaultValue={initial?.description ?? ''} placeholder="What the money was spent on" />
      </div>
      <Field name="justification" label="Justification" type="textarea" defaultValue={initial?.justification ?? ''} />
      <div className="hint" style={{ marginTop: 'var(--sp)' }}>Payment — may also be set later, before posting</div>
      <PaymentFields lookups={lookups} initial={initial} />
      <div className="hint" style={{ marginTop: 'var(--sp)' }}>Lines — what was spent, with the receipt reference</div>
      <table>
        <thead>
          <tr>
            <th style={{ width: '22%' }}>Expense account <span className="req">*</span></th><th>Narration</th><th style={{ width: 120 }}>Date</th>
            <th style={{ width: 110 }}>Receipt ref.</th><th style={{ width: 60 }}>Qty</th><th style={{ width: 110 }}>Unit cost</th>
            <th className="num" style={{ width: 130 }}>Amount <span className="req">*</span></th><th style={{ width: 32 }} />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td><GlAccountSelect name={`_scl${i}`} ariaLabel="Expense account" valueField="code" accounts={lookups.accounts} value={l.glAccountCode} onChange={(v) => set(i, 'glAccountCode', v)} /></td>
              <td><input type="text" value={l.narration} onChange={(e) => set(i, 'narration', e.target.value)} aria-label="Narration" style={{ width: '100%' }} /></td>
              <td><input type="date" value={l.expenseDate} onChange={(e) => set(i, 'expenseDate', e.target.value)} aria-label="Expense date" style={{ width: '100%' }} /></td>
              <td><input type="text" value={l.receiptRef} onChange={(e) => set(i, 'receiptRef', e.target.value)} aria-label="Receipt reference" style={{ width: '100%' }} /></td>
              <td><input type="number" min={1} value={l.quantity} onChange={(e) => set(i, 'quantity', e.target.value)} aria-label="Quantity" style={{ width: '100%' }} /></td>
              <td><MoneyInput value={l.unitCost} onChange={(v) => set(i, 'unitCost', v)} ariaLabel="Unit cost" min={0} style={{ width: '100%', textAlign: 'right' }} /></td>
              <td className="num"><MoneyInput value={l.amount} onChange={(v) => set(i, 'amount', v)} ariaLabel="Amount" required min={0} style={{ width: '100%', textAlign: 'right' }} /></td>
              <td><button type="button" className="btn sm ghost" onClick={() => setLines(lines.filter((_, idx) => idx !== i))} aria-label="Remove">×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="inline" style={{ marginTop: 8, justifyContent: 'space-between' }}>
        <button type="button" className="btn ghost sm" onClick={() => setLines([...lines, emptyLine()])}>Add line</button>
        <span className="tiny muted-cell">Total claimed {cur(total)}</span>
      </div>
    </>
  );
}

export const claimLinesOf = (c: StaffClaimDetail): StaffClaimLineDraft[] =>
  c.line_items.length ? c.line_items.map((l) => ({
    glAccountCode: l.gl_account_code, narration: l.narration ?? '', expenseDate: l.expense_date ?? '', receiptRef: l.receipt_ref ?? '',
    quantity: String(l.quantity), unitCost: l.unit_cost ? toTwoDp(String(l.unit_cost / 100)) : '', amount: toTwoDp(String(l.amount / 100)),
  })) : [emptyLine()];

export function NewStaffClaimButton({ lookups }: { lookups: ImprestLookups }) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<StaffClaimLineDraft[]>([emptyLine()]);
  return (
    <>
      <button type="button" className="btn" onClick={() => { setLines([emptyLine()]); setOpen(true); }}>New staff claim</button>
      {open ? (
        <FormModal title="New staff claim" wide onClose={() => setOpen(false)} onSubmit={(v) => requestStaffClaim(v, lines)}
          submitLabel="Save" successTitle="Staff claim captured" successDetail={(d) => `${d.no} saved — send it for approval when ready`} redirectTo={(d) => `/imprest/staff-claims/${d.no}`}>
          <ClaimFields lookups={lookups} lines={lines} setLines={setLines} />
        </FormModal>
      ) : null}
    </>
  );
}

export function StaffClaimEditForm({ claim, lookups }: { claim: StaffClaimDetail; lookups: ImprestLookups }) {
  const { close } = useEditableCard();
  const [lines, setLines] = useState<StaffClaimLineDraft[]>(() => claimLinesOf(claim));
  return (
    <FormModal inline title={`Edit ${claim.no}`} wide onClose={close} onSubmit={(v) => saveStaffClaim(claim.no, v, lines)} submitLabel="Save changes" successTitle="Staff claim updated">
      <ClaimFields lookups={lookups} initial={claim} lines={lines} setLines={setLines} />
    </FormModal>
  );
}

/** Payment details on an approved claim — the AL's "Payment" group, editable once approved. */
export function StaffClaimPaymentForm({ claim, lookups }: { claim: StaffClaimDetail; lookups: ImprestLookups }) {
  const { close } = useEditableCard();
  return (
    <FormModal inline title="Payment" onClose={close} onSubmit={(v) => setStaffClaimPaymentAction(claim.no, v)} submitLabel="Save payment details" successTitle="Payment details saved">
      <PaymentFields lookups={lookups} initial={claim} />
    </FormModal>
  );
}

const simple = (label: string, action: (no: string) => Promise<{ ok: boolean; error?: string; data?: unknown }>,
  confirm: { title: string; message: string; confirmLabel: string; danger?: boolean }, successTitle: string | ((d: never) => string), defaultClass = 'btn sm ghost',
  /** Where to land afterwards — a delete leaves the card with nothing to show, so it goes to the list. */
  redirectTo?: string) =>
  function Button({ no, className = defaultClass }: { no: string; className?: string }) {
    const { run, busy } = useRunAction();
    return <button type="button" className={className} disabled={busy} onClick={() => run(() => action(no) as never, { confirm, successTitle: successTitle as never, redirectTo })}>{busy ? 'Working…' : label}</button>;
  };

export const SubmitClaimButton = simple('Send for approval', submitStaffClaimAction, { title: 'Send this claim for approval?', message: 'It can no longer be edited while pending.', confirmLabel: 'Send for approval' },
  ((d: { autoApproved: boolean }) => (d.autoApproved ? 'Approved — ready to pay' : 'Sent for approval')) as never);
export const CancelClaimApprovalButton = simple('Cancel approval request', cancelStaffClaimApprovalAction, { title: 'Recall this claim?', message: 'It goes back to Open.', confirmLabel: 'Recall' }, 'Recalled — back to Open');
export const ApproveClaimButton = simple('Approve', approveStaffClaimAction, { title: 'Approve this staff claim?', message: 'It becomes ready to pay.', confirmLabel: 'Approve' }, 'Approved — ready to pay', 'btn sm');
export const ReopenClaimButton = simple('Reopen', reopenStaffClaimAction, { title: 'Reopen this claim?', message: 'It goes back to Open for amendment.', confirmLabel: 'Reopen' }, 'Reopened');
export const DeleteClaimButton = simple('Delete', deleteStaffClaimAction, { title: 'Delete this staff claim?', message: 'It is removed permanently.', confirmLabel: 'Delete', danger: true }, 'Deleted', undefined, '/imprest/staff-claims');
export const ReleaseClaimButton = simple('Release payment', releaseStaffClaimAction, { title: 'Release this payment?', message: 'The stop is lifted and the claim may be posted.', confirmLabel: 'Release' }, 'Payment released');
export const PostClaimButton = simple('Post payment', postStaffClaimAction, { title: 'Post this staff claim?', message: 'The expenses go to the G/L and the employee is paid from the account chosen — or through the next payroll.', confirmLabel: 'Post' },
  ((d: { journalNo: string; toPayroll: boolean }) => `Posted — journal ${d.journalNo}${d.toPayroll ? ' · paid through payroll' : ''}`) as never, 'btn sm');
export { DelegateButton } from '@/components/ui/delegate-button';

export function RejectClaimButton({ no, className = 'btn sm ghost' }: { no: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Reject</button>
      {open ? (
        <FormModal title="Reject staff claim" onClose={() => setOpen(false)} onSubmit={(v) => rejectStaffClaimAction(no, String(v.reason || ''))} submitLabel="Reject" submitClass="btn danger" successTitle="Rejected — back to Open" resultStyle="popup">
          <Field name="reason" label="Reason" type="textarea" required />
        </FormModal>
      ) : null}
    </>
  );
}

export function StopClaimButton({ no, className = 'btn sm ghost' }: { no: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Stop payment</button>
      {open ? (
        <FormModal title="Stop payment" onClose={() => setOpen(false)} onSubmit={(v) => stopStaffClaimAction(no, String(v.reason || ''))} submitLabel="Stop payment" submitClass="btn danger" successTitle="Payment stopped">
          <Field name="reason" label="Reason" type="textarea" required />
        </FormModal>
      ) : null}
    </>
  );
}
