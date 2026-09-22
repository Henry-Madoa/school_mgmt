'use client';

import { useState, type ReactNode } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field, MoneyInput } from '@/components/ui/field';
import { AppliesToPicker } from '@/components/ui/applies-to-picker';
import { EmployeeImprestPicker, EmployeePicker } from './employee-pickers';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useFormat } from '@/components/ui/format-provider';
import { today } from '@/lib/format';
import { createReceiptRequest, type ReceiptLineDraft } from '@/app/actions/cashMgmt';
import type { ReceiptDetail, ReceiptLineType } from '@/lib/types';

/**
 * AL Enum-Ext52204000: the header's Receipt Type is what a line's Account No relates to, so the
 * type is chosen once and every line follows it. There is no per-line type. Customer is first:
 * a student's fee account is a customer, so fee receipts are the everyday case.
 */
const RECEIPT_TYPES: ReceiptLineType[] = ['Customer', 'G/L Account', 'Employee', 'Vendor', 'Bank Account'];

type Opt = { code: string; name: string };

export interface ReceiptFormProps {
  banks: { id: number; code: string; name: string; currency_code: string }[];
  accounts: Opt[];
  customers: { no: string; name: string }[];
  vendors: { no: string; name: string }[];
  currencies: { code: string }[];
  payMethods: { code: string; description: string }[];
  employees: { id: number; employee_no: string; first_name: string; last_name: string }[];
}

const emptyLine = (): ReceiptLineDraft => ({
  lineType: '', accountNo: '', description: '', amount: '', appliesToDocNo: '',
});

const sumLines = (lines: ReceiptLineDraft[]): number =>
  lines.reduce((s, l) => s + Math.round((Number(l.amount) || 0) * 100), 0);

/** The receipt's own fields, shared by the New modal and the card's in-place editor. */
export function ReceiptFields({ p, initial, lines, setLines }: {
  p: ReceiptFormProps; initial?: ReceiptDetail | null;
  lines: ReceiptLineDraft[]; setLines: (l: ReceiptLineDraft[]) => void;
}) {
  const { cur } = useFormat();
  const [receiptType, setReceiptType] = useState<ReceiptLineType>(initial?.receipt_type ?? 'Customer');
  const [employeeId, setEmployeeId] = useState(String(initial?.employee_id ?? ''));
  const isEmployee = receiptType === 'Employee';
  const [received, setReceived] = useState(initial?.received_amount ? String(initial.received_amount / 100) : '');
  const [narration, setNarration] = useState(initial?.description ?? '');

  const set = (i: number, k: keyof ReceiptLineDraft, v: string) =>
    setLines(lines.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));

  /** The line description follows the header unless the user has typed one. */
  const defaultDescription = (): string => narration.trim();

  const accountPicker = (l: ReceiptLineDraft, i: number): ReactNode => {
    if (isEmployee) {
      const e = p.employees.find((x) => String(x.id) === employeeId);
      return <span className="muted-cell">{e ? `${e.employee_no} — ${e.first_name} ${e.last_name}` : 'Pick the employee above'}</span>;
    }
    const rows = receiptType === 'Customer' ? p.customers.map((c) => ({ v: c.no, t: `${c.no} — ${c.name}` }))
      : receiptType === 'Vendor' ? p.vendors.map((c) => ({ v: c.no, t: `${c.no} — ${c.name}` }))
        : receiptType === 'Bank Account' ? p.banks.map((c) => ({ v: c.code, t: `${c.code} — ${c.name}` }))
          : p.accounts.map((c) => ({ v: c.code, t: `${c.code} — ${c.name}` }));
    // Searchable: a chart of accounts or a customer list is too long to scroll by eye. The hidden
    // input's name is per-row scratch — the lines travel as state, not form fields.
    return (
      <SearchableSelect name={`_lineAccount${i}`} ariaLabel="Account" items={rows} value={l.accountNo}
        getValue={(r) => r.v} getLabel={(r) => r.t} placeholder={`Search ${receiptType.toLowerCase()}…`}
        emptyText="No matches"
        onChange={(v) => setLines(lines.map((x, idx) => (idx === i
          ? { ...x, accountNo: v, description: x.description || defaultDescription() }
          : x)))} />
    );
  };

  const lineTotal = sumLines(lines);
  const receivedCents = Math.round((Number(received) || 0) * 100);
  const outOfBalance = receivedCents > 0 && receivedCents !== lineTotal;

  return (
    <>
      <div className="grid g3">
        <div className="field">
          <label htmlFor="f_receiptType">Receipt type <span className="req">*</span></label>
          <select id="f_receiptType" name="receiptType" value={receiptType}
            onChange={(e) => {
              // Changing the type invalidates every account already picked, so the lines reset.
              setReceiptType(e.target.value as ReceiptLineType);
              setLines([emptyLine()]);
            }}>
            {RECEIPT_TYPES.map((t) => <option key={t} value={t}>{t === 'Customer' ? 'Customer / Student fee account' : t}</option>)}
          </select>
          <div className="hint">Every line on this receipt is posted to a {receiptType}.</div>
        </div>
        <Field name="bankAccountId" label="Bank account (money in)" type="select" required defaultValue={String(initial?.bank_account_id ?? '')}
          options={[{ value: '', label: '…' }, ...p.banks.map((b) => ({ value: String(b.id), label: `${b.code} — ${b.name} (${b.currency_code})` }))]} />
        <Field name="postingDate" label="Posting date" type="date" required defaultValue={initial?.posting_date ?? today()} />
      </div>

      {isEmployee ? (
        <div className="grid g2">
          <EmployeePicker id="f_employeeId" name="employeeId" label="Employee (received from)" employees={p.employees}
            value={employeeId} onChange={(id) => { setEmployeeId(id); setLines([emptyLine()]); }} required />
          <div className="note">Money in from a member of staff — an imprest refund, a claim recovery or any other due — is credited to their subledger. Apply a line to an imprest to settle it.</div>
        </div>
      ) : (
        <input type="hidden" name="employeeId" value="" />
      )}

      <div className="grid g3">
        <Field name="currencyCode" label="Currency" type="select" defaultValue={initial?.currency_code ?? ''} options={[{ value: '', label: '(bank currency)' }, ...p.currencies.map((c) => ({ value: c.code, label: c.code }))]} />
        <Field name="payModeCode" label="Payment mode" type="select" defaultValue={initial?.pay_mode_code ?? ''} options={[{ value: '', label: '(none)' }, ...p.payMethods.map((m) => ({ value: m.code, label: `${m.code} — ${m.description}` }))]} />
        <Field name="externalDocumentNo" label="Cheque / M-Pesa ref." defaultValue={initial?.external_document_no ?? ''} />
      </div>
      <div className="grid g2">
        <Field name="manualReceiptNo" label="Manual receipt no." defaultValue={initial?.manual_receipt_no ?? ''} placeholder="Optional" />
        <Field name="description" label="Received from / narration" required
          defaultValue={narration} onChange={(e) => setNarration(e.target.value)} />
      </div>
      <div className="grid g2">
        <Field name="receivedAmount" label="Amount received" type="currency"
          defaultValue={received} onChange={(e) => setReceived(e.target.value)}
          hint="Optional control total — if set, the lines must add up to it" />
      </div>

      <div className="hint" style={{ marginTop: 8 }}>Lines</div>
      <table>
        <thead>
          <tr>
            <th style={{ width: '22%' }}>{receiptType === 'Customer' ? 'Customer / Student' : receiptType}</th>
            <th>Description <span className="req">*</span></th>
            <th style={{ width: '20%' }}>Applies to Doc. No.</th>
            <th className="num" style={{ width: 130 }}>Amount</th>
            <th style={{ width: 32 }} />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>{accountPicker(l, i)}</td>
              <td>
                <input type="text" value={l.description} onChange={(e) => set(i, 'description', e.target.value)}
                  aria-label="Description" required style={{ width: '100%' }}
                  placeholder={defaultDescription() || 'What this line is for'} />
              </td>
              {isEmployee ? (
                <td>
                  <EmployeeImprestPicker employeeId={employeeId} mode="settle" value={l.appliesToDocNo ?? ''}
                    onChange={(v) => set(i, 'appliesToDocNo', v)} onPickAmount={(amt) => set(i, 'amount', amt)} />
                </td>
              ) : (
                <td>
                  <AppliesToPicker
                    partyType={receiptType === 'Customer' ? 'Customer' : receiptType === 'Vendor' ? 'Vendor' : null}
                    partyNo={l.accountNo} value={l.appliesToDocNo ?? ''}
                    onChange={(v) => set(i, 'appliesToDocNo', v)}
                    onPickAmount={(amt) => set(i, 'amount', amt)}
                  />
                </td>
              )}
              <td className="num">
                <MoneyInput value={l.amount} onChange={(v) => set(i, 'amount', v)}
                  ariaLabel="Amount" required min={0} style={{ width: '100%', textAlign: 'right' }} />
              </td>
              <td><button type="button" className="btn sm ghost" onClick={() => setLines(lines.filter((_, idx) => idx !== i))} aria-label="Remove">×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="inline" style={{ marginTop: 8, justifyContent: 'space-between' }}>
        <button type="button" className="btn ghost sm" onClick={() => setLines([...lines, emptyLine()])}>Add line</button>
        <span className={outOfBalance ? 'tiny danger-text' : 'tiny muted-cell'}>
          Lines total {cur(lineTotal)}
          {receivedCents > 0 ? ` · received ${cur(receivedCents)}` : ''}
          {outOfBalance ? ` · out by ${cur(Math.abs(receivedCents - lineTotal))}` : ''}
        </span>
      </div>
      {receiptType === 'Customer' ? (
        <div className="note">
          A line against a student's fee account is applied to their oldest open invoice unless an
          Applies-to Doc. No. names a specific one. The guardian on the account is told by SMS and
          e-mail once the receipt posts.
        </div>
      ) : null}
    </>
  );
}

/** `preset` opens the modal with the lines already keyed — the Student 360's "Record a fee
 *  payment" starts on the student's own fee account. */
export function NewReceiptButton({ preset, label = 'New receipt', className = 'btn', ...p }: ReceiptFormProps & {
  preset?: ReceiptLineDraft[]; label?: string; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const fresh = () => (preset?.length ? preset.map((l) => ({ ...l })) : [emptyLine()]);
  const [lines, setLines] = useState<ReceiptLineDraft[]>(fresh);
  return (
    <>
      <button type="button" className={className} onClick={() => { setLines(fresh()); setOpen(true); }}>{label}</button>
      {open ? (
        <FormModal title="New receipt" wide onClose={() => setOpen(false)} onSubmit={(v) => createReceiptRequest(v, lines)}
          submitLabel="Create" successTitle="Receipt created" successDetail={(d) => `${d.no} created — submit it for approval`} redirectTo={(d) => `/cash-management/receipts/${d.no}`}>
          <ReceiptFields p={p} lines={lines} setLines={setLines} />
        </FormModal>
      ) : null}
    </>
  );
}

/** The saved lines as editable drafts — used by the card when Edit is pressed. */
export const receiptLinesOf = (receipt: ReceiptDetail): ReceiptLineDraft[] => (receipt.lines.length
  ? receipt.lines.map((l) => ({
    lineType: l.line_type,
    accountNo: l.account_no ?? '',
    description: l.description ?? '',
    amount: String(l.amount / 100),
    appliesToDocNo: l.applies_to_doc_no ?? '',
  }))
  : [emptyLine()]);
