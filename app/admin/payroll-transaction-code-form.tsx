'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useRunAction } from '@/components/ui/run-action';
import { saveTransactionCodeRequest, deleteTransactionCodeRequest } from '@/app/actions/payrollSetup';
import { PERIOD_CODES } from '@/lib/payrollCodes';
import type { GlAccount, PayrollTransactionCode } from '@/lib/types';

const AMOUNT_PREFERENCES = [
  { value: 'FORMULA', label: 'Formula result' },
  { value: 'HIGHER', label: 'Higher of formula and the line amount' },
  { value: 'LOWER', label: 'Lower of formula and the line amount' },
];

const TYPE_OPTIONS = [
  { value: 'INCOME', label: 'Income' }, { value: 'DEDUCTION', label: 'Deduction' }, { value: 'COMPANY_DEDUCTION', label: 'Company Deduction' },
];
const BALANCE_OPTIONS = [
  { value: 'NONE', label: 'None' }, { value: 'INCREASING', label: 'Increasing' }, { value: 'REDUCING', label: 'Reducing (loan-style)' },
];
const SPECIAL_OPTIONS = [
  { value: 'NONE', label: '—' }, { value: 'BASIC_SALARY', label: 'Basic Salary' }, { value: 'HOUSE_ALLOWANCE', label: 'House Allowance' },
  { value: 'TRANSPORT_ALLOWANCE', label: 'Transport Allowance' }, { value: 'OVERTIME', label: 'Overtime' },
  { value: 'ACTING_ALLOWANCE', label: 'Acting Allowance' }, { value: 'LEAVE_ALLOWANCE', label: 'Leave Allowance' },
  { value: 'GRATUITY', label: 'Gratuity' }, { value: 'PENSION', label: 'Pension (pre-tax)' },
  { value: 'MORTGAGE', label: 'Owner-occupier interest (P9 col. F)' }, { value: 'INSURANCE', label: 'Insurance premium (relief)' },
  { value: 'PRMF', label: 'Post-retirement medical fund (P9 col. J)' },
  { value: 'NON_CASH_BENEFIT', label: 'Non-cash benefit (P9 col. B — taxed, not paid)' },
  { value: 'VALUE_OF_QUARTERS', label: 'Value of quarters (P9 col. C — taxed, not paid)' },
  { value: 'LOAN', label: 'Loan' }, { value: 'SALARY_ARREARS', label: 'Salary Arrears' }, { value: 'DIRECTORS_FEE', label: "Director's Fee" },
];

export function TransactionCodeFormButton({ code, accounts, className = 'btn', children }: {
  code?: PayrollTransactionCode | null; accounts: GlAccount[]; className?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const c = code ?? null;
  // A chart of accounts runs too long to scroll a native dropdown by eye — searchable, like the
  // journal's account picker.
  const [glAccountId, setGlAccountId] = useState(String(c?.gl_account_id ?? ''));
  const [employerGlAccountId, setEmployerGlAccountId] = useState(String(c?.employer_gl_account_id ?? ''));
  const [isFormula, setIsFormula] = useState(!!c?.is_formula);
  const [type, setType] = useState<PayrollTransactionCode['type']>(c?.type ?? 'INCOME');
  const accountLabel = (a: GlAccount) => `${a.code} — ${a.name}`;

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          title={c ? `Edit ${c.name}` : 'Add a payroll transaction code'} wide
          onClose={() => setOpen(false)}
          onSubmit={(values) => saveTransactionCodeRequest({ ...values, id: c?.id ?? '' })}
          submitLabel={c ? 'Save changes' : 'Create'}
          successTitle={c ? 'Transaction code updated' : 'Transaction code created'}
        >
          <div className="grid g2">
            <Field name="code" label="Code" required defaultValue={c?.code} uppercase />
            <Field name="name" label="Name" required defaultValue={c?.name} />
          </div>
          <div className="grid g3">
            <Field name="type" label="Type" type="select" options={TYPE_OPTIONS} defaultValue={c?.type ?? 'INCOME'}
              onChange={(e) => setType((e.target as HTMLSelectElement).value as PayrollTransactionCode['type'])} />
            <Field name="balanceType" label="Balance behaviour" type="select" options={BALANCE_OPTIONS} defaultValue={c?.balance_type ?? 'NONE'} />
            <Field name="specialType" label="Special type" type="select" options={SPECIAL_OPTIONS} defaultValue={c?.special_type ?? 'NONE'} />
          </div>
          <div className="grid g2">
            <SearchableSelect id="f_glAccountId" name="glAccountId" label="G/L account" items={accounts}
              getValue={(a) => String(a.id)} getLabel={accountLabel} value={glAccountId} onChange={setGlAccountId}
              placeholder="Search account code or name…" emptyText="No matching accounts" />
            <SearchableSelect id="f_employerGlAccountId" name="employerGlAccountId" label="Employer expense account (company deduction / employer contribution)" items={accounts}
              getValue={(a) => String(a.id)} getLabel={accountLabel} value={employerGlAccountId} onChange={setEmployerGlAccountId}
              placeholder="Search account code or name…" emptyText="No matching accounts" />
          </div>
          <div className="grid g2">
            <Field name="fixedAmountCents" label="Default/fixed amount" type="currency" defaultValue={c ? c.fixed_amount_cents / 100 : 0} />
            <Field name="upperLimitCents" label="Upper limit (optional cap)" type="currency" defaultValue={c?.upper_limit_cents != null ? c.upper_limit_cents / 100 : ''} />
          </div>
          <div className="grid g3">
            <Field name="taxable" label="Taxable" type="checkbox" defaultValue={c?.taxable !== false ? '1' : ''} />
            <Field name="forEveryEmployee" label="Blanket — applies to every employee" type="checkbox" defaultValue={c?.for_every_employee ? '1' : ''} />
            <Field name="isFormula" label="Is formula — the run computes the amount" type="checkbox" defaultValue={c?.is_formula ? '1' : ''}
              onChange={(e) => setIsFormula((e.target as HTMLInputElement).checked)} />
          </div>
          {type === 'DEDUCTION' ? (
            <div className="card inset" style={{ marginBottom: 12 }}>
              <div className="note" style={{ marginBottom: 6 }}>Employer contribution — the employer&apos;s share alongside this deduction (a pension the employer matches or doubles). Costed to the employer expense account, credited to this code&apos;s payable; never deducted from the employee.</div>
              <div className="grid g2">
                <Field name="employerFactor" label="Employer factor (× employee amount)" type="number" step="0.01" min={0} defaultValue={c?.employer_factor ? String(c.employer_factor) : ''}
                  placeholder="e.g. 2 — employer pays double" hint="Blank or 0 — no employer contribution; 1 — matches; 2 — double" />
                <Field name="employerFormula" label="Employer formula (optional, overrides the factor)" defaultValue={c?.employer_formula ?? ''} placeholder={`[${c?.code || 'CODE'}]*2`}
                  hint="Same syntax as a code formula; this code's own line is available to it" />
              </div>
            </div>
          ) : null}
          {isFormula ? (
            <div className="card inset" style={{ marginBottom: 12 }}>
              <div className="grid g2">
                <Field name="formula" label="Formula" required defaultValue={c?.formula ?? ''} placeholder="[BPAY]*0.15"
                  hint="Codes in square brackets, then + − * / ^ ( ) and %. e.g. ([BPAY]+[HALLOW])*5%" />
                <Field name="amountPreference" label="Amount preference" type="select" options={AMOUNT_PREFERENCES}
                  defaultValue={c?.amount_preference ?? 'FORMULA'} hint="How the formula result and the amount typed on the employee's line combine" />
              </div>
              <div className="tiny" style={{ marginTop: 4 }}>
                The run's own codes: {Object.entries(PERIOD_CODES).map(([k, v]) => <span key={k} title={v} className="mono" style={{ marginRight: 8 }}>[{k}]</span>)}
                — plus any other earnings/deductions code. An earning's formula sees basic pay and the earnings computed before it;
                a deduction's formula also sees [GPAY].
              </div>
            </div>
          ) : null}
        </FormModal>
      ) : null}
    </>
  );
}

export function DeleteTransactionCodeButton({ id, className = 'btn sm ghost' }: { id: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => deleteTransactionCodeRequest(id), {
        confirm: { title: 'Delete this transaction code?', message: 'Refused if it has been used on a payroll transaction.', confirmLabel: 'Delete' },
        successTitle: 'Deleted',
      })}>
      {busy ? 'Working…' : 'Delete'}
    </button>
  );
}
