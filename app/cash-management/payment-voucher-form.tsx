'use client';

import { useState, type ReactNode } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field, MoneyInput } from '@/components/ui/field';
import { AppliesToPicker } from '@/components/ui/applies-to-picker';
import { EmployeeImprestPicker, EmployeePicker } from './employee-pickers';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { today } from '@/lib/format';
import { createPvRequest, type PvLineDraft } from '@/app/actions/cashMgmt';
import type { PaymentVoucherDetail, PaymentVoucherType } from '@/lib/types';

/**
 * AL Tab-Ext52204018: the Payment Type chosen on the header is what a line's Account No relates
 * to, so it is chosen once and every line follows it. Kept in step with PAYMENT_VOUCHER_TYPES in
 * lib/paymentVouchers.ts, which is the server-side authority.
 */
const PV_TYPES: { value: PaymentVoucherType; label: string; pays: string; help: string }[] = [
  {
    value: 'Supplier Payment', label: 'Supplier Payment', pays: 'vendor',
    help: 'Settle a vendor invoice, with VAT and withholding tax where they apply.',
  },
  {
    value: 'Customer Refund', label: 'Customer Refund', pays: 'customer',
    help: 'Refund a customer against their open entries.',
  },
  {
    value: 'Bank Transfer', label: 'Bank Transfer', pays: 'bank account',
    help: 'Move money to another of the school’s bank accounts.',
  },
  {
    value: 'Direct Expensing', label: 'Direct Expensing', pays: 'G/L account',
    help: 'Pay an expense straight to a G/L account, with no vendor behind it.',
  },
  {
    value: 'Payroll Settlement', label: 'Payroll Settlement', pays: 'liability account',
    help: 'Settle a payroll liability — net pay, PAYE, NSSF, SHIF or the housing levy.',
  },
  {
    value: 'Remittance', label: 'Remittance', pays: 'liability account',
    help: 'Remit a statutory or third-party liability the school is holding.',
  },
  {
    value: 'Employee Payment', label: 'Employee Payment', pays: 'employee',
    help: 'Pay a member of staff — an imprest, an advance or a claim — through the employee subledger. Apply the line to an approved imprest request to issue it.',
  },
];

const ruleFor = (t: PaymentVoucherType) => PV_TYPES.find((x) => x.value === t) ?? PV_TYPES[3];
/** Only a supplier payment carries a tax split; nothing else has a VAT or WHT base behind it. */
const hasTax = (t: PaymentVoucherType) => t === 'Supplier Payment' || t === 'Direct Expensing';

type Opt = { code: string; name: string };

export interface PvFormProps {
  banks: { id: number; code: string; name: string; currency_code: string }[];
  accounts: Opt[];
  customers: { no: string; name: string }[];
  vendors: { no: string; name: string }[];
  currencies: { code: string }[];
  payMethods: { code: string; description: string }[];
  vatCodes: { code: string; description: string }[];
  whtCodes: { code: string; description: string }[];
  externalBanks: { code: string; name: string }[];
  employees: { id: number; employee_no: string; first_name: string; last_name: string }[];
}

const emptyLine = (): PvLineDraft => ({
  lineType: '', accountNo: '', description: '', amount: '', appliesToDocNo: '',
  vatProdPostingGroupCode: '', whtCodeOne: '', whtCodeTwo: '',
});

/** The voucher's own fields, shared by the New modal and the card's in-place editor. */
export function PvFields({ p, initial, lines, setLines }: {
  p: PvFormProps; initial?: PaymentVoucherDetail | null;
  lines: PvLineDraft[]; setLines: (l: PvLineDraft[]) => void;
}) {
  const [pvType, setPvType] = useState<PaymentVoucherType>(initial?.pv_type ?? 'Supplier Payment');
  const [employeeId, setEmployeeId] = useState(String(initial?.employee_id ?? ''));
  const employee = pvType === 'Employee Payment';
  const [narration, setNarration] = useState(initial?.description ?? '');

  const rule = ruleFor(pvType);
  const taxed = hasTax(pvType);

  const set = (i: number, k: keyof PvLineDraft, v: string) =>
    setLines(lines.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));

  /** Picking the account fills the line description from the header, unless one was typed. */
  const pickAccount = (i: number, key: 'accountNo', value: string) =>
    setLines(lines.map((l, idx) => (idx === i
      ? { ...l, [key]: value, description: l.description || narration.trim() }
      : l)));

  const picker = (l: PvLineDraft, i: number): ReactNode => {
    if (employee) {
      const e = p.employees.find((x) => String(x.id) === employeeId);
      return <span className="muted-cell">{e ? `${e.employee_no} — ${e.first_name} ${e.last_name}` : 'Pick the employee above'}</span>;
    }
    const rows = pvType === 'Customer Refund' ? p.customers.map((c) => ({ v: c.no, t: `${c.no} — ${c.name}` }))
      : pvType === 'Supplier Payment' ? p.vendors.map((c) => ({ v: c.no, t: `${c.no} — ${c.name}` }))
        : pvType === 'Bank Transfer' ? p.banks.map((c) => ({ v: c.code, t: `${c.code} — ${c.name}` }))
          : p.accounts.map((c) => ({ v: c.code, t: `${c.code} — ${c.name}` }));
    // Searchable, as on the receipt: a chart of accounts or a vendor list is too long to scroll
    // by eye. The hidden input's name is per-row scratch — the lines travel as state.
    return (
      <SearchableSelect name={`_lineAccount${i}`} ariaLabel="Account" items={rows} value={l.accountNo}
        getValue={(r) => r.v} getLabel={(r) => r.t} placeholder="Search…" emptyText="No matches"
        onChange={(v) => pickAccount(i, 'accountNo', v)} />
    );
  };

  return (
    <>
      <div className="grid g3">
        <div className="field">
          <label htmlFor="f_pvType">Payment type <span className="req">*</span></label>
          <select id="f_pvType" name="pvType" value={pvType}
            onChange={(e) => {
              // Changing the type invalidates every account already picked, so the lines reset.
              setPvType(e.target.value as PaymentVoucherType);
              setLines([emptyLine()]);
            }}>
            {PV_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <div className="hint">{rule.help}</div>
        </div>
        <Field name="payingBankAccountId" label="Paying bank" type="select" required defaultValue={String(initial?.paying_bank_account_id ?? '')}
          options={[{ value: '', label: '…' }, ...p.banks.map((b) => ({ value: String(b.id), label: `${b.code} — ${b.name} (${b.currency_code})` }))]} />
        <Field name="date" label="Voucher date" type="date" required defaultValue={initial?.date ?? today()} />
      </div>

      {employee ? (
        <div className="grid g2">
          <EmployeePicker id="f_employeeId" name="employeeId" label="Employee (paid to)" employees={p.employees}
            value={employeeId} onChange={(id) => { setEmployeeId(id); setLines([emptyLine()]); }} required />
          <Field name="payeeName" label="Payee name" defaultValue={initial?.payee_name ?? ''} hint="Defaults to the employee; set it only when someone else collects" />
        </div>
      ) : (
        <input type="hidden" name="employeeId" value="" />
      )}

      <div className="grid g3">
        <Field name="currencyCode" label="Currency" type="select" defaultValue={initial?.currency_code ?? ''} options={[{ value: '', label: '(bank currency)' }, ...p.currencies.map((c) => ({ value: c.code, label: c.code }))]} />
        <Field name="payModeCode" label="Payment mode" type="select" defaultValue={initial?.pay_mode_code ?? ''} options={[{ value: '', label: '(none)' }, ...p.payMethods.map((m) => ({ value: m.code, label: `${m.code} — ${m.description}` }))]} />
        <Field name="chequeNo" label="Cheque / EFT no." defaultValue={initial?.cheque_no ?? ''} />
      </div>
      <div className="grid g3">
        <Field name="chequeDate" label="Cheque date" type="date" defaultValue={initial?.cheque_date ?? ''} />
        {employee ? null : <Field name="payeeName" label="Payee name" defaultValue={initial?.payee_name ?? ''} />}
        <Field name="payeeAccountNo" label="Payee account no." defaultValue={initial?.payee_account_no ?? ''} />
      </div>
      <div className="grid g2">
        <Field name="payeeExternalBankCode" label="Payee bank" type="select" defaultValue={initial?.payee_external_bank_code ?? ''} options={[{ value: '', label: '(none)' }, ...p.externalBanks.map((b) => ({ value: b.code, label: b.name }))]} />
        <Field name="description" label="Narration" required
          defaultValue={narration} onChange={(e) => setNarration(e.target.value)} />
      </div>

      <div className="hint" style={{ marginTop: 8 }}>
        {taxed
          ? 'Lines — enter the gross (VAT-inclusive) amount; WHT is withheld from the payee'
          : `Lines — every line on this voucher pays a ${rule.pays}`}
      </div>
      <table>
        <thead>
          <tr>
            <th style={{ width: '22%' }}>{rule.pays.replace(/^\w/, (c) => c.toUpperCase())}</th>
            <th>Description <span className="req">*</span></th>
            <th style={{ width: '18%' }}>Applies to Doc. No.</th>
            <th className="num" style={{ width: 120 }}>{taxed ? 'Gross amt' : 'Amount'}</th>
            {taxed ? <th style={{ width: 90 }}>VAT</th> : null}
            {taxed ? <th style={{ width: 100 }}>WHT 1</th> : null}
            {taxed ? <th style={{ width: 100 }}>WHT 2</th> : null}
            <th style={{ width: 32 }} />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
              <tr key={i}>
                <td>{picker(l, i)}</td>
                <td>
                  <input type="text" value={l.description} onChange={(e) => set(i, 'description', e.target.value)}
                    aria-label="Description" required style={{ width: '100%' }}
                    placeholder={narration.trim() || 'What this line is for'} />
                </td>
                {employee ? (
                  <td>
                    <EmployeeImprestPicker employeeId={employeeId} mode="issue" value={l.appliesToDocNo ?? ''}
                      onChange={(v) => set(i, 'appliesToDocNo', v)} onPickAmount={(amt) => set(i, 'amount', amt)} />
                  </td>
                ) : (
                  <td>
                    <AppliesToPicker
                      partyType={pvType === 'Supplier Payment' ? 'Vendor' : pvType === 'Customer Refund' ? 'Customer' : null}
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
                {taxed ? (
                  <td><select value={l.vatProdPostingGroupCode} onChange={(e) => set(i, 'vatProdPostingGroupCode', e.target.value)} aria-label="VAT code" style={{ width: '100%' }} disabled={!!l.appliesToDocNo}><option value="">—</option>{p.vatCodes.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}</select></td>
                ) : null}
                {taxed ? (
                  <td><select value={l.whtCodeOne} onChange={(e) => set(i, 'whtCodeOne', e.target.value)} aria-label="WHT one" style={{ width: '100%' }}><option value="">—</option>{p.whtCodes.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}</select></td>
                ) : null}
                {taxed ? (
                  <td><select value={l.whtCodeTwo} onChange={(e) => set(i, 'whtCodeTwo', e.target.value)} aria-label="WHT two" style={{ width: '100%' }}><option value="">—</option>{p.whtCodes.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}</select></td>
                ) : null}
                <td><button type="button" className="btn sm ghost" onClick={() => setLines(lines.filter((_, idx) => idx !== i))} aria-label="Remove">×</button></td>
              </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setLines([...lines, emptyLine()])}>Add line</button>
    </>
  );
}

export function NewPvButton(p: PvFormProps) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<PvLineDraft[]>([emptyLine()]);
  return (
    <>
      <button type="button" className="btn" onClick={() => { setLines([emptyLine()]); setOpen(true); }}>New payment voucher</button>
      {open ? (
        <FormModal title="New payment voucher" wide onClose={() => setOpen(false)} onSubmit={(v) => createPvRequest(v, lines)}
          submitLabel="Create" successTitle="Payment voucher created" successDetail={(d) => `${d.no} created — submit it for approval`} redirectTo={(d) => `/cash-management/payment-vouchers/${d.no}`}>
          <PvFields p={p} lines={lines} setLines={setLines} />
        </FormModal>
      ) : null}
    </>
  );
}

/** The saved lines as editable drafts — used by the card when Edit is pressed. */
export const pvLinesOf = (pv: PaymentVoucherDetail): PvLineDraft[] => (pv.lines.length
  ? pv.lines.map((l) => ({
    lineType: l.line_type,
    accountNo: l.account_no ?? '',
    description: l.description ?? '',
    amount: String(l.amount / 100),
    appliesToDocNo: l.applies_to_doc_no ?? '',
    vatProdPostingGroupCode: l.vat_prod_posting_group_code ?? '',
    whtCodeOne: l.wht_code_one ?? '',
    whtCodeTwo: l.wht_code_two ?? '',
  }))
  : [emptyLine()]);

