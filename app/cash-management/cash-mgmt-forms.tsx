'use client';

import { useState, type ReactNode } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { GlAccountField } from '@/components/ui/gl-account-select';
import { useRunAction } from '@/components/ui/run-action';
import { today } from '@/lib/format';
import {
  createBankAccountRequest, updateBankAccountRequest, createCurrencyRequest, updateCurrencyRequest,
  saveExchangeRateRequest, deleteExchangeRateRequest, saveCashMgmtSetupRequest, adjustExchangeRatesRequest,
  saveBankAccPostingGroupRequest,
} from '@/app/actions/cashMgmt';
import type { BankAccPostingGroupView, CashManagementSetup, CurrencyView, GlAccount } from '@/lib/types';

type BankRow = {
  id: number; code: string; name: string; currency_code: string; bank_acc_posting_group_code: string | null;
  bank_name: string | null; account_no: string | null; iban: string | null; swift_code: string | null;
  min_balance: number; blocked: number; status: string; external_bank_code: string | null; bank_branch_no: string | null;
  account_type?: string | null;
};
const acctOpts = (accounts: GlAccount[], none = '(none)') =>
  [{ value: '', label: none }, ...accounts.map((a) => ({ value: String(a.id), label: `${a.code} — ${a.name}` }))];

/* ---------------------------------------------------------------- Bank Account */

export function BankAccountFormButton({ account, postingGroups, externalBanks, currencies, accounts, className = 'btn', children }: {
  account?: BankRow | null; postingGroups: BankAccPostingGroupView[]; externalBanks: { code: string; name: string }[];
  currencies: { code: string }[]; accounts: GlAccount[]; className?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const a = account ?? null;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal title={a ? `Edit ${a.code}` : 'New bank account'} wide onClose={() => setOpen(false)}
          onSubmit={(v) => (a ? updateBankAccountRequest(a.id, v) : createBankAccountRequest(v))}
          submitLabel={a ? 'Save changes' : 'Create'} successTitle={a ? 'Bank account updated' : 'Bank account created'}>
          <div className="grid g3">
            <Field name="code" label="Code" required defaultValue={a?.code} disabled={!!a} />
            <Field name="name" label="Name" required defaultValue={a?.name} />
            <Field name="currencyCode" label="Currency" type="select" defaultValue={a?.currency_code ?? 'KES'} options={currencies.map((c) => ({ value: c.code, label: c.code }))} />
          </div>
          <div className="grid g2">
            <Field name="bankAccPostingGroupCode" label="Bank Acc. Posting Group" type="select" defaultValue={a?.bank_acc_posting_group_code ?? ''}
              options={[{ value: '', label: '(pick an explicit G/L account)' }, ...postingGroups.map((g) => ({ value: g.code, label: `${g.code} → ${g.gl_account_code}` }))]} />
            <GlAccountField name="glAccountId" label="G/L control account (if no posting group)" accounts={accounts} defaultValue="" placeholder="Search account… (blank = from posting group)" />
          </div>
          <div className="grid g3">
            <Field name="externalBankCode" label="External bank" type="select" defaultValue={a?.external_bank_code ?? ''} options={[{ value: '', label: '(none)' }, ...externalBanks.map((b) => ({ value: b.code, label: b.name }))]} />
            <Field name="bankName" label="Bank name (free text)" defaultValue={a?.bank_name ?? ''} />
            <Field name="accountNo" label="Account no." defaultValue={a?.account_no ?? ''} />
          </div>
          <div className="grid g3">
            <Field name="bankBranchNo" label="Branch no." defaultValue={a?.bank_branch_no ?? ''} />
            <Field name="iban" label="IBAN" defaultValue={a?.iban ?? ''} />
            <Field name="swiftCode" label="SWIFT" defaultValue={a?.swift_code ?? ''} />
          </div>
          <div className="grid g3">
            <Field name="minBalance" label="Minimum balance" type="currency" defaultValue={a ? String(a.min_balance / 100) : '0'} />
            <Field name="accountType" label="Account type" type="select" defaultValue={a?.account_type ?? 'OTHER'}
              options={[{ value: 'MAIN', label: 'Main bank account' }, { value: 'TREASURY', label: 'Treasury / vault' }, { value: 'TILL', label: 'Teller till' }, { value: 'PETTY_CASH', label: 'Petty cash float' }, { value: 'OTHER', label: 'Other' }]} />
            <Field name="blocked" label="Blocked" type="checkbox" defaultValue={a?.blocked ? '1' : '0'} />
            <Field name="inactive" label="Inactive" type="checkbox" defaultValue={a?.status === 'INACTIVE' ? '1' : '0'} />
          </div>
        </FormModal>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ Currency */

const CCY_ACCTS: { name: string; key: keyof CurrencyView; label: string }[] = [
  { name: 'realizedGainsAccountId', key: 'realized_gains_account_id', label: 'Realized Gains' },
  { name: 'realizedLossesAccountId', key: 'realized_losses_account_id', label: 'Realized Losses' },
  { name: 'unrealizedGainsAccountId', key: 'unrealized_gains_account_id', label: 'Unrealized Gains' },
  { name: 'unrealizedLossesAccountId', key: 'unrealized_losses_account_id', label: 'Unrealized Losses' },
  { name: 'residualGainsAccountId', key: 'residual_gains_account_id', label: 'Residual Gains' },
  { name: 'residualLossesAccountId', key: 'residual_losses_account_id', label: 'Residual Losses' },
];

export function CurrencyFormButton({ currency, accounts, className = 'btn', children }: {
  currency?: CurrencyView | null; accounts: GlAccount[]; className?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const c = currency ?? null;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal title={c ? `Edit ${c.code}` : 'New currency'} wide onClose={() => setOpen(false)}
          onSubmit={(v) => (c ? updateCurrencyRequest(c.id, v) : createCurrencyRequest(v))}
          submitLabel={c ? 'Save changes' : 'Create'} successTitle={c ? 'Currency updated' : 'Currency created'}>
          <div className="grid g3">
            <Field name="code" label="Code" required defaultValue={c?.code} disabled={!!c} />
            <Field name="description" label="Description" required defaultValue={c?.description} />
            <Field name="symbol" label="Symbol" defaultValue={c?.symbol ?? ''} />
          </div>
          <div className="grid g3">
            <Field name="isoNumericCode" label="ISO numeric" defaultValue={c?.iso_numeric_code ?? ''} />
            <Field name="amountRoundingPrecision" label="Rounding precision (cents)" type="number" defaultValue={String(c?.amount_rounding_precision ?? 1)} />
            <Field name="blocked" label="Blocked" type="checkbox" defaultValue={c?.blocked ? '1' : '0'} />
          </div>
          <div className="hint" style={{ marginTop: 8 }}>Exchange gain / loss accounts (required for a non-base currency)</div>
          <div className="grid g3">
            {CCY_ACCTS.map((f) => (
              <GlAccountField key={f.name} name={f.name} label={f.label} accounts={accounts} defaultValue={c ? String((c[f.key] as number | null) ?? '') : ''} />
            ))}
          </div>
        </FormModal>
      ) : null}
    </>
  );
}

export function ExchangeRateFormButton({ currencies, className = 'btn', children }: { currencies: { code: string }[]; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal title="Add / update exchange rate" onClose={() => setOpen(false)} onSubmit={(v) => saveExchangeRateRequest(v)}
          submitLabel="Save" successTitle="Exchange rate saved" resultStyle="popup">
          <div className="grid g2">
            <Field name="currencyCode" label="Currency" type="select" required options={currencies.map((c) => ({ value: c.code, label: c.code }))} />
            <Field name="startingDate" label="Starting date" type="date" required defaultValue={today()} />
          </div>
          <div className="grid g2">
            <Field name="exchangeRateAmount" label="Exchange rate amount" type="number" defaultValue="1" />
            <Field name="relationalExchRateAmount" label="Relational (LCY per that many units)" type="number" required placeholder="e.g. 130" />
          </div>
        </FormModal>
      ) : null}
    </>
  );
}

export function DeleteRateButton({ id }: { id: number }) {
  const { run, busy } = useRunAction();
  return <button type="button" className="btn sm ghost danger" disabled={busy}
    onClick={() => run(() => deleteExchangeRateRequest(id), { confirm: { title: 'Delete this rate?', message: 'It will no longer be used for conversions.', confirmLabel: 'Delete' }, successTitle: 'Rate deleted' })}>×</button>;
}

/* -------------------------------------------------------------------- Setup */

export function CashMgmtSetupButton({ setup, banks, accounts, className = 'btn', children }: {
  setup: CashManagementSetup; banks: { id: number; code: string }[]; accounts: GlAccount[];
  className?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal title="Cash Management Setup" onClose={() => setOpen(false)} onSubmit={(v) => saveCashMgmtSetupRequest(v)}
          submitLabel="Save" successTitle="Setup saved">
          <div className="grid g2">
            <Field name="pvApprovalLimit" label="Payment voucher approval limit" type="currency" defaultValue={String(setup.pv_approval_limit / 100)} />
            {/* One editable copy only: the receipt limit lives on General Ledger Setup, so it is
                shown here for reference and submitted unchanged. */}
            <div className="field">
              <label htmlFor="f_receiptLimitRef">Receipt approval limit</label>
              <input id="f_receiptLimitRef" type="text" value={(setup.receipt_approval_limit / 100).toFixed(2)} readOnly disabled />
              <div className="hint">Set on Admin Centre → Setup Pool → General Ledger Setup</div>
            </div>
          </div>
          <div className="grid g2">
            <GlAccountField name="bankChargesAccountId" label="Bank charges account" accounts={accounts} defaultValue={setup.bank_charges_account_id ?? ''} />
            <GlAccountField name="bankInterestIncomeAccountId" label="Bank interest income account" accounts={accounts} defaultValue={setup.bank_interest_income_account_id ?? ''} />
          </div>
          <div className="grid g3">
            <Field name="defaultReceiptBankAccountId" label="Default receipt bank" type="select" defaultValue={String(setup.default_receipt_bank_account_id ?? '')} options={[{ value: '', label: '(none)' }, ...banks.map((b) => ({ value: String(b.id), label: b.code }))]} />
            <Field name="allowCmPostingFrom" label="Allow posting from" type="date" defaultValue={setup.allow_cm_posting_from ?? ''} />
            <Field name="allowCmPostingTo" label="Allow posting to" type="date" defaultValue={setup.allow_cm_posting_to ?? ''} />
          </div>
        </FormModal>
      ) : null}
    </>
  );
}

export function BankAccPostingGroupButton({ row, accounts, className = 'btn', children }: {
  row?: BankAccPostingGroupView | null; accounts: GlAccount[]; className?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const r = row ?? null;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal title={r ? `Edit ${r.code}` : 'New bank posting group'} onClose={() => setOpen(false)}
          onSubmit={(v) => saveBankAccPostingGroupRequest(r?.id ?? null, v)}
          submitLabel={r ? 'Save' : 'Create'} successTitle="Bank posting group saved">
          <Field name="code" label="Code" required defaultValue={r?.code} disabled={!!r} />
          <Field name="description" label="Description" required defaultValue={r?.description} />
          <GlAccountField name="glAccountId" label="G/L control account" required accounts={accounts} defaultValue={r?.gl_account_id ?? ''} />
        </FormModal>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------ Adjust FX panel */

export function AdjustFxPanel({ currencies }: { currencies: { code: string }[] }) {
  const { run, busy } = useRunAction();
  const [code, setCode] = useState(currencies[0]?.code ?? '');
  const [end, setEnd] = useState(today());
  return (
    <div className="inline" style={{ gap: 8, flexWrap: 'wrap' }}>
      <select value={code} onChange={(e) => setCode(e.target.value)} aria-label="Currency">{currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}</select>
      <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="End date" />
      <button type="button" className="btn" disabled={busy || !code}
        onClick={() => run(() => adjustExchangeRatesRequest({ currencyCode: code, endDate: end }), {
          confirm: { title: `Revalue open ${code} entries?`, message: 'Posts unrealized gain / loss to the currency’s FX accounts at the end-date rate.', confirmLabel: 'Run' },
          successTitle: (d: { adjustedEntries: number; gainLoss: number }) => `${d.adjustedEntries} entries revalued`,
        })}>Run adjustment</button>
    </div>
  );
}
