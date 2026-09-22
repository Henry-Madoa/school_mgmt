'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { useEditableCard } from '@/components/ui/editable-card';
import { Field, MoneyInput, toTwoDp } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { LockedEmployee } from '@/components/ui/locked-employee';
import { GlAccountSelect, type GlAccountSelectOption } from '@/components/ui/gl-account-select';
import { useRunAction } from '@/components/ui/run-action';
import { useFormat } from '@/components/ui/format-provider';
import { formatDate, today } from '@/lib/format';
import {
  requestImprest, saveImprest, deleteImprestRequestAction, submitImprestAction, cancelImprestApprovalAction,
  approveImprestAction, rejectImprestAction, reopenImprestAction, issueImprestAction,
  saveSurrenderAction, submitSurrenderAction, cancelSurrenderApprovalAction, approveSurrenderAction, rejectSurrenderAction,
  reopenSurrenderAction, postSurrenderAction, transferImprestToPayrollAction,
  requestPettyCash, savePettyCash, deletePettyCashAction, submitPettyCashAction, cancelPettyCashApprovalAction,
  approvePettyCashAction, rejectPettyCashAction, reopenPettyCashAction, postPettyCashAction, markPettyCashPaidAction,
  saveImprestPurposeRequest, deleteImprestPurposeRequest,
  type ImprestLineDraft, type SurrenderLineDraft, type PettyCashLineDraft,
} from '@/app/actions/imprest';
import type {
  ImprestPurpose, ImprestRequestDetail, ImprestRequestLineView, ImprestSettlement, PettyCashDetail,
} from '@/lib/types';

type EmployeeOption = { id: number; employee_no: string; first_name: string; last_name: string };
type BankOption = { id: number; code: string; name: string; account_type?: string };

export interface ImprestLookups {
  employees: EmployeeOption[];
  /** Employee Self Service: every document is this employee's own — the picker is replaced by a locked field. */
  self?: EmployeeOption | null;
  purposes: ImprestPurpose[];
  accounts: GlAccountSelectOption[];
  banks: BankOption[];
  payMethods: { code: string; description: string }[];
  floats: BankOption[];
}

const employeeLabel = (e: EmployeeOption) => `${e.employee_no} — ${e.first_name} ${e.last_name}`;

/* ============================================================ imprest request */

const emptyImprestLine = (): ImprestLineDraft => ({ glAccountCode: '', narration: '', quantity: '1', unitCost: '', requestAmount: '' });

function ImprestFields({ lookups, initial, lines, setLines }: {
  lookups: ImprestLookups; initial?: ImprestRequestDetail | null; lines: ImprestLineDraft[]; setLines: (l: ImprestLineDraft[]) => void;
}) {
  const { cur } = useFormat();
  const [employeeId, setEmployeeId] = useState(String(initial?.employee_id ?? ''));
  const [purposeCode, setPurposeCode] = useState(initial?.purpose_code ?? '');
  const [payingBank, setPayingBank] = useState(String(initial?.paying_bank_account_id ?? ''));
  const set = (i: number, k: keyof ImprestLineDraft, v: string) => setLines(lines.map((l, idx) => {
    if (idx !== i) return l;
    const next = { ...l, [k]: v };
    // Quantity × unit cost fills the amount; a typed amount stands on its own.
    if (k === 'quantity' || k === 'unitCost') {
      const q = Number(next.quantity) || 0; const u = Number(next.unitCost) || 0;
      if (q && u) next.requestAmount = toTwoDp(String(q * u));
    }
    return next;
  }));
  const total = lines.reduce((s, l) => s + Math.round((Number(l.requestAmount) || 0) * 100), 0);
  return (
    <>
      <div className="grid g3">
        {/* The employee is fixed once the request exists (a disabled picker would drop it from the
            submit) and always the signed-in employee under Self Service. */}
        {lookups.self ? <LockedEmployee employee={lookups.self} />
          : initial ? <LockedEmployee employee={{ id: initial.employee_id, employee_no: initial.employee_no, first_name: initial.first_name, last_name: initial.last_name }} />
            : <SearchableSelect id="f_employeeId" name="employeeId" label="Employee" required items={lookups.employees}
                getValue={(e) => String(e.id)} getLabel={employeeLabel} value={employeeId} onChange={setEmployeeId}
                placeholder="Search employee…" emptyText="No matching employees" />}
        <Field name="requestDate" label="Request date" type="date" required defaultValue={initial?.request_date ?? today()} />
        <Field name="requestFor" label="Request for" type="select" defaultValue={initial?.request_for ?? 'Self'}
          options={[{ value: 'Self', label: 'Self' }, { value: 'Other', label: 'Other (on behalf of)' }]} />
      </div>
      <div className="grid g2">
        <SearchableSelect id="f_purposeCode" name="purposeCode" label="Purpose code" items={lookups.purposes}
          getValue={(p) => p.code} getLabel={(p) => `${p.code} — ${p.description}`} value={purposeCode}
          onChange={(v) => setPurposeCode(v)} placeholder="Search purpose…" emptyText="No purposes set up" />
        <Field name="purpose" label="Purpose" required defaultValue={initial?.purpose ?? lookups.purposes.find((p) => p.code === purposeCode)?.description ?? ''} />
      </div>
      <Field name="description" label="Description" type="textarea" defaultValue={initial?.description ?? ''} />
      <div className="grid g3">
        <Field name="departureLocation" label="Destination / location" defaultValue={initial?.departure_location ?? ''} />
        <Field name="departureDate" label="Departure date" type="date" defaultValue={initial?.departure_date ?? ''} />
        <Field name="returnDate" label="Return date" type="date" defaultValue={initial?.return_date ?? ''} />
      </div>
      <div className="grid g2">
        <Field name="justification" label="Justification" type="textarea" defaultValue={initial?.justification ?? ''} />
        <Field name="phoneNo" label="Phone no. in the field" defaultValue={initial?.phone_no ?? ''} />
      </div>

      <div className="hint" style={{ marginTop: 'var(--sp)' }}>How the money is paid out — can be set later, before issue</div>
      <div className="grid g4">
        <SearchableSelect id="f_payingBankAccountId" name="payingBankAccountId" label="Paying bank / cash account" items={lookups.banks}
          getValue={(b) => String(b.id)} getLabel={(b) => `${b.code} — ${b.name}`} value={payingBank} onChange={setPayingBank}
          placeholder="Search account…" emptyText="No bank accounts" />
        <Field name="payModeCode" label="Pay mode" type="select" defaultValue={initial?.pay_mode_code ?? ''}
          options={[{ value: '', label: '(none)' }, ...lookups.payMethods.map((m) => ({ value: m.code, label: `${m.code} — ${m.description}` }))]} />
        <Field name="paymentTxNo" label="Cheque / EFT no." defaultValue={initial?.payment_tx_no ?? ''} />
        <Field name="chequeDate" label="Cheque date" type="date" defaultValue={initial?.cheque_date ?? ''} />
      </div>

      <div className="hint" style={{ marginTop: 'var(--sp)' }}>Lines — what the money is for</div>
      <table>
        <thead>
          <tr>
            <th style={{ width: '26%' }}>Expense account <span className="req">*</span></th>
            <th>Narration</th>
            <th style={{ width: 70 }}>Qty</th>
            <th style={{ width: 120 }}>Unit cost</th>
            <th className="num" style={{ width: 140 }}>Amount <span className="req">*</span></th>
            <th style={{ width: 32 }} />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td><GlAccountSelect name={`_line${i}`} ariaLabel="Expense account" valueField="code" accounts={lookups.accounts}
                value={l.glAccountCode} onChange={(v) => set(i, 'glAccountCode', v)} /></td>
              <td><input type="text" value={l.narration} onChange={(e) => set(i, 'narration', e.target.value)} aria-label="Narration" style={{ width: '100%' }} placeholder="What this is for" /></td>
              <td><input type="number" min={1} value={l.quantity} onChange={(e) => set(i, 'quantity', e.target.value)} aria-label="Quantity" style={{ width: '100%' }} /></td>
              <td><MoneyInput value={l.unitCost} onChange={(v) => set(i, 'unitCost', v)} ariaLabel="Unit cost" min={0} style={{ width: '100%', textAlign: 'right' }} /></td>
              <td className="num"><MoneyInput value={l.requestAmount} onChange={(v) => set(i, 'requestAmount', v)} ariaLabel="Amount" required min={0} style={{ width: '100%', textAlign: 'right' }} /></td>
              <td><button type="button" className="btn sm ghost" onClick={() => setLines(lines.filter((_, idx) => idx !== i))} aria-label="Remove">×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="inline" style={{ marginTop: 8, justifyContent: 'space-between' }}>
        <button type="button" className="btn ghost sm" onClick={() => setLines([...lines, emptyImprestLine()])}>Add line</button>
        <span className="tiny muted-cell">Requested {cur(total)}</span>
      </div>
    </>
  );
}

export const imprestLinesOf = (r: ImprestRequestDetail): ImprestLineDraft[] =>
  r.line_items.length
    ? r.line_items.map((l) => ({ glAccountCode: l.gl_account_code, narration: l.narration ?? '', quantity: String(l.quantity), unitCost: l.unit_cost ? toTwoDp(String(l.unit_cost / 100)) : '', requestAmount: toTwoDp(String(l.request_amount / 100)) }))
    : [emptyImprestLine()];

export function NewImprestButton({ lookups }: { lookups: ImprestLookups }) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<ImprestLineDraft[]>([emptyImprestLine()]);
  return (
    <>
      <button type="button" className="btn" onClick={() => { setLines([emptyImprestLine()]); setOpen(true); }}>New imprest request</button>
      {open ? (
        <FormModal title="New imprest request" wide onClose={() => setOpen(false)} onSubmit={(v) => requestImprest(v, lines)}
          submitLabel="Save" successTitle="Imprest request captured" successDetail={(d) => `${d.no} saved — send it for approval when ready`} redirectTo={(d) => `/imprest/view/${d.no}`}>
          <ImprestFields lookups={lookups} lines={lines} setLines={setLines} />
        </FormModal>
      ) : null}
    </>
  );
}

export function ImprestEditForm({ request, lookups }: { request: ImprestRequestDetail; lookups: ImprestLookups }) {
  const { close } = useEditableCard();
  const [lines, setLines] = useState<ImprestLineDraft[]>(() => imprestLinesOf(request));
  return (
    <FormModal inline title={`Edit ${request.no}`} wide onClose={close} onSubmit={(v) => saveImprest(request.no, v, lines)}
      submitLabel="Save changes" successTitle="Imprest request updated">
      <ImprestFields lookups={lookups} initial={request} lines={lines} setLines={setLines} />
    </FormModal>
  );
}

/* ---- a small factory for the one-click buttons */
const simple = (
  label: string, action: (no: string) => Promise<{ ok: boolean; error?: string; data?: unknown }>,
  confirm: { title: string; message: string; confirmLabel: string; danger?: boolean } | null,
  successTitle: string | ((d: never) => string), defaultClass = 'btn sm ghost',
  /** Where to land afterwards — a delete leaves the card with nothing to show, so it goes to the list. */
  redirectTo?: string,
) => function Button({ no, className = defaultClass }: { no: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => action(no) as never, { ...(confirm ? { confirm } : {}), successTitle: successTitle as never, redirectTo })}>
      {busy ? 'Working…' : label}
    </button>
  );
};

export const SubmitButton = simple('Send for approval', submitImprestAction,
  { title: 'Send this imprest request for approval?', message: 'It can no longer be edited while pending.', confirmLabel: 'Send for approval' },
  ((d: { autoApproved: boolean }) => (d.autoApproved ? 'Approved — ready to issue' : 'Sent for approval')) as never);
export const CancelApprovalButton = simple('Cancel approval request', cancelImprestApprovalAction,
  { title: 'Recall this request?', message: 'It goes back to Open so you can amend and resubmit it.', confirmLabel: 'Recall' }, 'Recalled — back to Open');
export const ApproveButton = simple('Approve', approveImprestAction,
  { title: 'Approve this imprest request?', message: 'It becomes ready to issue. Nothing is paid until it is issued.', confirmLabel: 'Approve' }, 'Approved — ready to issue', 'btn sm');
export const ReopenButton = simple('Reopen', reopenImprestAction,
  { title: 'Reopen this request?', message: 'It goes back to Open for amendment and must be approved again.', confirmLabel: 'Reopen' }, 'Reopened — back to Open');
export const DeleteButton = simple('Delete', deleteImprestRequestAction,
  { title: 'Delete this imprest request?', message: 'It is removed permanently.', confirmLabel: 'Delete', danger: true }, 'Deleted', undefined, '/imprest');
export { DelegateButton } from '@/components/ui/delegate-button';

function RejectWithReason({ no, className, title, action }: { no: string; className: string; title: string; action: (no: string, reason: string) => Promise<{ ok: boolean; error?: string; data?: unknown }> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Reject</button>
      {open ? (
        <FormModal title={title} onClose={() => setOpen(false)} onSubmit={(v) => action(no, String(v.reason || '')) as never}
          submitLabel="Reject" submitClass="btn danger" successTitle="Rejected — back to Open" resultStyle="popup">
          <Field name="reason" label="Reason" type="textarea" required />
        </FormModal>
      ) : null}
    </>
  );
}
export const RejectButton = ({ no, className = 'btn sm ghost' }: { no: string; className?: string }) =>
  <RejectWithReason no={no} className={className} title="Reject imprest request" action={rejectImprestAction} />;

export function IssueButton({ no, className = 'btn sm' }: { no: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => issueImprestAction(no), {
        confirm: { title: 'Issue this imprest?', message: 'The money leaves the paying account and goes onto the employee’s subledger, to be surrendered by the due date.', confirmLabel: 'Issue' },
        successTitle: 'Imprest issued', successDetail: (d) => `Journal ${d.journalNo} · surrender due ${formatDate(d.dueDate)}`,
      })}>
      {busy ? 'Working…' : 'Issue imprest'}
    </button>
  );
}

/* ================================================================= surrender */

export function SurrenderEditForm({ request, lookups }: { request: ImprestRequestDetail; lookups: ImprestLookups }) {
  const { close } = useEditableCard();
  const { cur } = useFormat();
  const [lines, setLines] = useState<SurrenderLineDraft[]>(() => request.line_items.map((l) => ({
    id: l.id, actualSpent: l.actual_spent ? toTwoDp(String(l.actual_spent / 100)) : '', surrenderNote: l.surrender_note ?? '',
  })));
  const [settlement, setSettlement] = useState<string>(request.settlement ?? '');
  const [receivingBank, setReceivingBank] = useState(String(request.receiving_bank_account_id ?? ''));
  const [claimBank, setClaimBank] = useState(String(request.claim_paying_bank_account_id ?? ''));
  const spent = lines.reduce((s, l) => s + Math.round((Number(l.actualSpent) || 0) * 100), 0);
  const net = request.request_amount - spent;
  const options: { value: ImprestSettlement | ''; label: string }[] = net > 0
    ? [{ value: 'Receive Now', label: 'Receive the refund now' }, { value: 'Deduct from Payroll', label: 'Deduct the refund from payroll' }]
    : net < 0
      ? [{ value: 'Pay Now', label: 'Pay the claim now' }, { value: 'Pay from Payroll', label: 'Pay the claim through payroll' }]
      : [{ value: '', label: 'Nothing to settle — spent exactly what was issued' }];
  return (
    <FormModal inline title="Surrender" wide onClose={close} onSubmit={(v) => saveSurrenderAction(request.no, v, lines)}
      submitLabel="Save surrender" successTitle="Surrender saved">
      <div className="grid g3">
        <Field name="surrenderDate" label="Surrender date" type="date" required defaultValue={request.surrender_date ?? today()} />
        <div className="field"><label>Issued</label><div className="mono" style={{ paddingTop: 8 }}>{cur(request.request_amount)}</div></div>
        <div className="field"><label>Spent / difference</label>
          <div className="mono" style={{ paddingTop: 8 }}>{cur(spent)} · {net > 0 ? <>refund due <b>{cur(net)}</b></> : net < 0 ? <>claim <b>{cur(-net)}</b></> : 'exact'}</div>
        </div>
      </div>
      <table>
        <thead><tr><th>Expense account</th><th>Narration</th><th className="num" style={{ width: 130 }}>Requested</th><th className="num" style={{ width: 140 }}>Actual spent</th><th style={{ width: '22%' }}>Note / receipt ref.</th></tr></thead>
        <tbody>
          {request.line_items.map((l: ImprestRequestLineView, i) => (
            <tr key={l.id}>
              <td><span className="mono">{l.gl_account_code}</span> <span className="tiny muted-cell">{l.gl_account_name}</span></td>
              <td>{l.narration || '—'}</td>
              <td className="num">{cur(l.request_amount)}</td>
              <td className="num"><MoneyInput value={lines[i].actualSpent} onChange={(v) => setLines(lines.map((x, idx) => (idx === i ? { ...x, actualSpent: v } : x)))} ariaLabel="Actual spent" min={0} style={{ width: '100%', textAlign: 'right' }} /></td>
              <td><input type="text" value={lines[i].surrenderNote} onChange={(e) => setLines(lines.map((x, idx) => (idx === i ? { ...x, surrenderNote: e.target.value } : x)))} aria-label="Note" style={{ width: '100%' }} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid g3" style={{ marginTop: 'var(--sp)' }}>
        <div className="field">
          <label htmlFor="f_settlement">Settle the difference</label>
          <select id="f_settlement" name="settlement" value={settlement} onChange={(e) => setSettlement(e.target.value)}>
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        {settlement === 'Receive Now' ? (
          <>
            <SearchableSelect id="f_receivingBankAccountId" name="receivingBankAccountId" label="Receiving bank / cash account" required items={lookups.banks}
              getValue={(b) => String(b.id)} getLabel={(b) => `${b.code} — ${b.name}`} value={receivingBank} onChange={setReceivingBank} placeholder="Search account…" emptyText="No bank accounts" />
            <Field name="receiptTxNo" label="Receipt / cheque no." defaultValue={request.receipt_tx_no ?? ''} />
            <Field name="receiptModeCode" label="Receipt mode" type="select" defaultValue={request.receipt_mode_code ?? ''}
              options={[{ value: '', label: '(none)' }, ...lookups.payMethods.map((m) => ({ value: m.code, label: `${m.code} — ${m.description}` }))]} />
          </>
        ) : null}
        {settlement === 'Pay Now' ? (
          <>
            <SearchableSelect id="f_claimPayingBankAccountId" name="claimPayingBankAccountId" label="Claim paid from" required items={lookups.banks}
              getValue={(b) => String(b.id)} getLabel={(b) => `${b.code} — ${b.name}`} value={claimBank} onChange={setClaimBank} placeholder="Search account…" emptyText="No bank accounts" />
            <Field name="claimPaymentTxNo" label="Payment / cheque no." defaultValue={request.claim_payment_tx_no ?? ''} />
            <Field name="claimPayModeCode" label="Claim pay mode" type="select" defaultValue={request.claim_pay_mode_code ?? ''}
              options={[{ value: '', label: '(none)' }, ...lookups.payMethods.map((m) => ({ value: m.code, label: `${m.code} — ${m.description}` }))]} />
          </>
        ) : null}
      </div>
      <div className="note">
        On posting, what was spent goes to the expense accounts and comes off the employee’s subledger. A refund is received into
        the account chosen, or deducted from the next payroll; a claim is paid from the account chosen, or paid with the next payroll.
      </div>
    </FormModal>
  );
}

export const SubmitSurrenderButton = simple('Submit surrender', submitSurrenderAction,
  { title: 'Submit this surrender?', message: 'Ensure the receipts for what was spent are attached. The surrender can no longer be edited once submitted.', confirmLabel: 'Submit' },
  ((d: { autoApproved: boolean }) => (d.autoApproved ? 'Surrender approved — ready to post' : 'Surrender sent for approval')) as never, 'btn sm');
export const CancelSurrenderApprovalButton = simple('Cancel approval request', cancelSurrenderApprovalAction,
  { title: 'Recall this surrender?', message: 'It goes back to Open so you can amend it.', confirmLabel: 'Recall' }, 'Recalled — surrender open');
export const ApproveSurrenderButton = simple('Approve surrender', approveSurrenderAction,
  { title: 'Approve this surrender?', message: 'It becomes ready to post.', confirmLabel: 'Approve' }, 'Surrender approved', 'btn sm');
export const ReopenSurrenderButton = simple('Reopen surrender', reopenSurrenderAction,
  { title: 'Reopen this surrender?', message: 'It goes back to Open for amendment.', confirmLabel: 'Reopen' }, 'Surrender reopened');
export const RejectSurrenderButton = ({ no, className = 'btn sm ghost' }: { no: string; className?: string }) =>
  <RejectWithReason no={no} className={className} title="Reject surrender" action={rejectSurrenderAction} />;

export function PostSurrenderButton({ no, className = 'btn sm' }: { no: string; className?: string }) {
  const { run, busy } = useRunAction();
  const { cur } = useFormat();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => postSurrenderAction(no), {
        confirm: { title: 'Post this surrender?', message: 'The expenses go to the G/L, the employee’s subledger is cleared, and the difference is settled as chosen. This cannot be undone from here.', confirmLabel: 'Post surrender' },
        successTitle: 'Surrender posted',
        successDetail: (d) => `Journal ${d.journalNo}${d.refund ? ` · refund ${cur(d.refund)}` : ''}${d.claim ? ` · claim ${cur(d.claim)}` : ''}${d.toPayroll ? ' · sent to payroll' : ''}`,
      })}>
      {busy ? 'Working…' : 'Post surrender'}
    </button>
  );
}

export function TransferToPayrollButton({ no, className = 'btn sm ghost' }: { no: string; className?: string }) {
  const { run, busy } = useRunAction();
  const { cur } = useFormat();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => transferImprestToPayrollAction(no), {
        confirm: { title: 'Recover this imprest from payroll?', message: 'The outstanding amount is added as a deduction on the open payroll period. The imprest closes once that payroll posts.', confirmLabel: 'Send to payroll', danger: true },
        successTitle: 'Sent to payroll', successDetail: (d) => `${cur(d.amount)} deducted in ${d.periodName}`,
      })}>
      {busy ? 'Working…' : 'Recover from payroll'}
    </button>
  );
}

/* ================================================================= petty cash */

const emptyPcLine = (): PettyCashLineDraft => ({ glAccountCode: '', description: '', amount: '' });

function PettyCashFields({ lookups, initial, lines, setLines, limit }: {
  lookups: ImprestLookups; initial?: PettyCashDetail | null; lines: PettyCashLineDraft[]; setLines: (l: PettyCashLineDraft[]) => void; limit: number;
}) {
  const { cur } = useFormat();
  const [employeeId, setEmployeeId] = useState(String(initial?.employee_id ?? ''));
  const [float, setFloat] = useState(String(initial?.paying_bank_account_id ?? ''));
  const set = (i: number, k: keyof PettyCashLineDraft, v: string) => setLines(lines.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));
  const total = lines.reduce((s, l) => s + Math.round((Number(l.amount) || 0) * 100), 0);
  const over = limit > 0 && total > limit;
  return (
    <>
      <div className="grid g3">
        {lookups.self ? <LockedEmployee employee={lookups.self} label="Requested by (employee)" />
          : <SearchableSelect id="f_employeeId" name="employeeId" label="Requested by (employee)" required items={lookups.employees}
              getValue={(e) => String(e.id)} getLabel={employeeLabel} value={employeeId} onChange={setEmployeeId}
              placeholder="Search employee…" emptyText="No matching employees" />}
        <Field name="requestDate" label="Date" type="date" required defaultValue={initial?.request_date ?? today()} />
        <SearchableSelect id="f_payingBankAccountId" name="payingBankAccountId" label="Petty cash float" items={lookups.floats}
          getValue={(b) => String(b.id)} getLabel={(b) => `${b.code} — ${b.name}`} value={float} onChange={setFloat}
          placeholder={lookups.floats.length ? 'Search float…' : 'No petty cash float set up'} emptyText="No petty cash floats"
          hint="A bank account of type Petty cash float (or the cash office till)" />
      </div>
      <Field name="paymentNarration" label="Payment narration" required defaultValue={initial?.payment_narration ?? ''} />
      <div className="grid g4">
        <Field name="paymentTo" label="Payment to" defaultValue={initial?.payment_to ?? ''} />
        <Field name="onBehalfOf" label="On behalf of" defaultValue={initial?.on_behalf_of ?? ''} />
        <Field name="payModeCode" label="Pay mode" type="select" defaultValue={initial?.pay_mode_code ?? ''}
          options={[{ value: '', label: '(none)' }, ...lookups.payMethods.map((m) => ({ value: m.code, label: `${m.code} — ${m.description}` }))]} />
        <Field name="paymentTxNo" label="Reference no." defaultValue={initial?.payment_tx_no ?? ''} />
      </div>
      <div className="hint" style={{ marginTop: 'var(--sp)' }}>Expense lines{limit > 0 ? ` — the petty cash limit is ${cur(limit)}; above it, raise an imprest` : ''}</div>
      <table>
        <thead><tr><th style={{ width: '30%' }}>Expense account <span className="req">*</span></th><th>Description</th><th className="num" style={{ width: 140 }}>Amount <span className="req">*</span></th><th style={{ width: 32 }} /></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td><GlAccountSelect name={`_pcline${i}`} ariaLabel="Expense account" valueField="code" accounts={lookups.accounts} value={l.glAccountCode} onChange={(v) => set(i, 'glAccountCode', v)} /></td>
              <td><input type="text" value={l.description} onChange={(e) => set(i, 'description', e.target.value)} aria-label="Description" style={{ width: '100%' }} /></td>
              <td className="num"><MoneyInput value={l.amount} onChange={(v) => set(i, 'amount', v)} ariaLabel="Amount" required min={0} style={{ width: '100%', textAlign: 'right' }} /></td>
              <td><button type="button" className="btn sm ghost" onClick={() => setLines(lines.filter((_, idx) => idx !== i))} aria-label="Remove">×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="inline" style={{ marginTop: 8, justifyContent: 'space-between' }}>
        <button type="button" className="btn ghost sm" onClick={() => setLines([...lines, emptyPcLine()])}>Add line</button>
        <span className={over ? 'tiny danger-text' : 'tiny muted-cell'}>Total {cur(total)}{over ? ' — above the petty cash limit' : ''}</span>
      </div>
    </>
  );
}

export const pettyCashLinesOf = (p: PettyCashDetail): PettyCashLineDraft[] =>
  p.line_items.length ? p.line_items.map((l) => ({ glAccountCode: l.gl_account_code, description: l.description ?? '', amount: toTwoDp(String(l.amount / 100)) })) : [emptyPcLine()];

export function NewPettyCashButton({ lookups, limit }: { lookups: ImprestLookups; limit: number }) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<PettyCashLineDraft[]>([emptyPcLine()]);
  return (
    <>
      <button type="button" className="btn" onClick={() => { setLines([emptyPcLine()]); setOpen(true); }}>New petty cash</button>
      {open ? (
        <FormModal title="New petty cash request" wide onClose={() => setOpen(false)} onSubmit={(v) => requestPettyCash(v, lines)}
          submitLabel="Save" successTitle="Petty cash captured" successDetail={(d) => `${d.no} saved — send it for approval when ready`} redirectTo={(d) => `/imprest/petty-cash/${d.no}`}>
          <PettyCashFields lookups={lookups} lines={lines} setLines={setLines} limit={limit} />
        </FormModal>
      ) : null}
    </>
  );
}

export function PettyCashEditForm({ pettyCash, lookups, limit }: { pettyCash: PettyCashDetail; lookups: ImprestLookups; limit: number }) {
  const { close } = useEditableCard();
  const [lines, setLines] = useState<PettyCashLineDraft[]>(() => pettyCashLinesOf(pettyCash));
  return (
    <FormModal inline title={`Edit ${pettyCash.no}`} wide onClose={close} onSubmit={(v) => savePettyCash(pettyCash.no, v, lines)}
      submitLabel="Save changes" successTitle="Petty cash updated">
      <PettyCashFields lookups={lookups} initial={pettyCash} lines={lines} setLines={setLines} limit={limit} />
    </FormModal>
  );
}

export const SubmitPettyCashButton = simple('Send for approval', submitPettyCashAction,
  { title: 'Send this petty cash for approval?', message: 'It can no longer be edited while pending.', confirmLabel: 'Send for approval' },
  ((d: { autoApproved: boolean }) => (d.autoApproved ? 'Approved — ready to post' : 'Sent for approval')) as never);
export const CancelPettyCashApprovalButton = simple('Cancel approval request', cancelPettyCashApprovalAction,
  { title: 'Recall this petty cash?', message: 'It goes back to Open.', confirmLabel: 'Recall' }, 'Recalled — back to Open');
export const ApprovePettyCashButton = simple('Approve', approvePettyCashAction,
  { title: 'Approve this petty cash?', message: 'It becomes ready to post.', confirmLabel: 'Approve' }, 'Approved — ready to post', 'btn sm');
export const ReopenPettyCashButton = simple('Reopen', reopenPettyCashAction,
  { title: 'Reopen this petty cash?', message: 'It goes back to Open for amendment.', confirmLabel: 'Reopen' }, 'Reopened');
export const DeletePettyCashButton = simple('Delete', deletePettyCashAction,
  { title: 'Delete this petty cash?', message: 'It is removed permanently.', confirmLabel: 'Delete', danger: true }, 'Deleted', undefined, '/imprest/petty-cash');
export const RejectPettyCashButton = ({ no, className = 'btn sm ghost' }: { no: string; className?: string }) =>
  <RejectWithReason no={no} className={className} title="Reject petty cash" action={rejectPettyCashAction} />;
export const PostPettyCashButton = simple('Post', postPettyCashAction,
  { title: 'Post this petty cash?', message: 'The expenses go to the G/L and the cash comes off the float.', confirmLabel: 'Post' },
  ((d: { journalNo: string }) => `Posted — journal ${d.journalNo}`) as never, 'btn sm');
export const MarkPaidButton = simple('Mark as paid', markPettyCashPaidAction,
  { title: 'Mark this petty cash as paid?', message: 'Confirm the cash has been handed over.', confirmLabel: 'Paid' }, 'Marked as paid', 'btn sm');

/* ================================================================== purposes */

/** Creation only — an existing purpose is edited in place on its row (ImprestPurposeRow). */
export function ImprestPurposeFormButton({ className = 'btn', children }: { className?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal title="New imprest purpose" onClose={() => setOpen(false)} onSubmit={(v) => saveImprestPurposeRequest(v, true)} submitLabel="Create" successTitle="Purpose created">
          <Field name="code" label="Code" required />
          <Field name="description" label="Description" required />
          <Field name="inactive" label="Inactive" type="checkbox" defaultValue="0" />
        </FormModal>
      ) : null}
    </>
  );
}

/** One master row that turns into its own editor on Edit — no modal, the same card-not-modal
 *  rule the document cards follow. */
export function ImprestPurposeRow({ row, canManage }: { row: ImprestPurpose; canManage: boolean }) {
  const { run, busy } = useRunAction();
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState(row.description);
  const [inactive, setInactive] = useState(row.status === 'INACTIVE');
  if (!editing) {
    return (
      <tr>
        <td className="mono">{row.code}</td><td>{row.description}</td><td><span className={`pill ${row.status === 'ACTIVE' ? 'ok' : 'warn'}`}>{row.status === 'ACTIVE' ? 'Active' : 'Inactive'}</span></td>
        <td className="num">{canManage ? (<div className="inline" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn sm ghost" onClick={() => { setDescription(row.description); setInactive(row.status === 'INACTIVE'); setEditing(true); }}>Edit</button>
          <DeleteImprestPurposeButton code={row.code} />
        </div>) : null}</td>
      </tr>
    );
  }
  return (
    <tr>
      <td className="mono">{row.code}</td>
      <td><input type="text" value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Description" required style={{ width: '100%' }} /></td>
      <td><label className="inline" style={{ gap: 6 }}><input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} /> Inactive</label></td>
      <td className="num"><div className="inline" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn sm" disabled={busy || !description.trim()}
          onClick={() => run(() => saveImprestPurposeRequest({ code: row.code, description, inactive: inactive ? '1' : '0' }, false), 'Purpose updated').then(() => setEditing(false))}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="btn sm ghost" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
      </div></td>
    </tr>
  );
}

export function DeleteImprestPurposeButton({ code, className = 'btn sm ghost' }: { code: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => deleteImprestPurposeRequest(code), { confirm: { title: `Delete purpose ${code}?`, message: 'Only a purpose not in use can be deleted.', confirmLabel: 'Delete', danger: true }, successTitle: 'Deleted' })}>
      {busy ? 'Working…' : 'Delete'}
    </button>
  );
}
