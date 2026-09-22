'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { GlAccountField } from '@/components/ui/gl-account-select';
import { useRunAction } from '@/components/ui/run-action';
import { savePostingGroupRequest, deletePostingGroupRequest } from '@/app/actions/payrollSetup';
import type { GlAccount, PayrollPostingGroup } from '@/lib/types';

export function PostingGroupFormButton({ group, accounts, className = 'btn', children }: {
  group?: PayrollPostingGroup | null; accounts: GlAccount[]; className?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const g = group ?? null;
  const opts = accounts.map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` }));

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          title={g ? `Edit ${g.name}` : 'Add a payroll posting group'} wide
          onClose={() => setOpen(false)}
          onSubmit={(values) => savePostingGroupRequest({ ...values, id: g?.id ?? '' })}
          submitLabel={g ? 'Save changes' : 'Create'}
          successTitle={g ? 'Posting group updated' : 'Posting group created'}
        >
          <div className="grid g2">
            <Field name="code" label="Code" required defaultValue={g?.code} uppercase />
            <Field name="name" label="Name" required defaultValue={g?.name} />
          </div>
          <div className="grid g2">
            <GlAccountField name="salaryExpenseAccountId" label="Salary expense account" required accounts={accounts} defaultValue={g?.salary_expense_account_id ?? ''} />
            <GlAccountField name="netPayPayableAccountId" label="Net pay payable account" required accounts={accounts} defaultValue={g?.net_pay_payable_account_id ?? ''} />
          </div>
          <GlAccountField name="payePayableAccountId" label="PAYE payable account" required accounts={accounts} defaultValue={g?.paye_payable_account_id ?? ''} />
          <div className="grid g3">
            <GlAccountField name="nssfEmployeePayableAccountId" label="NSSF employee payable" required accounts={accounts} defaultValue={g?.nssf_employee_payable_account_id ?? ''} />
            <GlAccountField name="nssfEmployerExpenseAccountId" label="NSSF employer expense" required accounts={accounts} defaultValue={g?.nssf_employer_expense_account_id ?? ''} />
            <GlAccountField name="nssfEmployerPayableAccountId" label="NSSF employer payable" required accounts={accounts} defaultValue={g?.nssf_employer_payable_account_id ?? ''} />
          </div>
          <GlAccountField name="shifPayableAccountId" label="SHIF payable account" required accounts={accounts} defaultValue={g?.shif_payable_account_id ?? ''} />
          <div className="grid g3">
            <GlAccountField name="housingLevyEmployeePayableAccountId" label="Housing Levy employee payable" required accounts={accounts} defaultValue={g?.housing_levy_employee_payable_account_id ?? ''} />
            <GlAccountField name="housingLevyEmployerExpenseAccountId" label="Housing Levy employer expense" required accounts={accounts} defaultValue={g?.housing_levy_employer_expense_account_id ?? ''} />
            <GlAccountField name="housingLevyEmployerPayableAccountId" label="Housing Levy employer payable" required accounts={accounts} defaultValue={g?.housing_levy_employer_payable_account_id ?? ''} />
          </div>
        </FormModal>
      ) : null}
    </>
  );
}

export function DeletePostingGroupButton({ id, className = 'btn sm ghost' }: { id: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => deletePostingGroupRequest(id), {
        confirm: { title: 'Delete this posting group?', message: 'Refused if any employee is assigned to it.', confirmLabel: 'Delete' },
        successTitle: 'Deleted',
      })}>
      {busy ? 'Working…' : 'Delete'}
    </button>
  );
}
