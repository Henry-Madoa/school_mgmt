'use client';

import { useState, type ReactNode } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { createGlAccount, updateGlAccount } from '@/app/actions/gl';
import { GL_ACCOUNT_TYPES, GL_ACCOUNT_STRUCTURE_TYPES, PRODUCT_STATUSES } from '@/lib/constants';
import type { GlAccount, GlAccountStructureType } from '@/lib/types';

export function GlAccountFormButton({ account, className = 'btn', children }: {
  account?: GlAccount | null;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const a = account ?? null;
  const [accountType, setAccountType] = useState<GlAccountStructureType>(a?.account_type ?? 'POSTING');
  const needsTotaling = accountType === 'TOTAL' || accountType === 'END_TOTAL';

  return (
    <>
      <button
        type="button" className={className}
        onClick={() => { setAccountType(a?.account_type ?? 'POSTING'); setOpen(true); }}
      >
        {children}
      </button>
      {open ? (
        <FormModal
          title={a ? `Edit ${a.code} — ${a.name}` : 'Add a GL account'}
          onClose={() => setOpen(false)}
          onSubmit={(values) => (a ? updateGlAccount(a.code, values) : createGlAccount(values))}
          submitLabel={a ? 'Save changes' : 'Create'}
          successTitle={a ? 'Account updated' : 'Account created'}
        >
          <Field name="code" label="Account code" required placeholder="e.g. 4060"
            defaultValue={a?.code} disabled={!!a} />
          <Field name="name" label="Account name" required defaultValue={a?.name} />
          <Field name="type" label="Type" type="select" required options={GL_ACCOUNT_TYPES} defaultValue={a?.type} />
          <Field
            name="account_type" label="Account Type" type="select" required
            options={GL_ACCOUNT_STRUCTURE_TYPES}
            defaultValue={a?.account_type ?? 'POSTING'}
            onChange={(e) => setAccountType(e.target.value as GlAccountStructureType)}
            hint="Posting carries ledger entries; Heading/Total/Begin-Total/End-Total only structure the list"
          />
          {needsTotaling ? (
            <Field
              name="totaling" label="Totaling" required
              defaultValue={a?.totaling ?? ''}
              placeholder="e.g. 1010..1099|1200"
              hint="Posting accounts (or code ranges, joined with |) this row sums"
            />
          ) : null}
          <Field name="parent_code" label="Parent code" placeholder="Optional" defaultValue={a?.parent_code ?? ''} />
          {a ? (
            <Field name="status" label="Status" type="select" options={PRODUCT_STATUSES} defaultValue={a.status} />
          ) : null}
        </FormModal>
      ) : null}
    </>
  );
}
