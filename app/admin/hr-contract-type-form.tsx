'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { useRunAction } from '@/components/ui/run-action';
import { saveContractTypeRequest, deleteContractTypeRequest } from '@/app/actions/hrSetup';
import type { HrEmploymentContractType } from '@/lib/types';

export function ContractTypeFormButton({ contractType, className = 'btn', children }: {
  contractType?: HrEmploymentContractType | null; className?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const c = contractType ?? null;

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          title={c ? `Edit ${c.name}` : 'Add an employment contract type'}
          onClose={() => setOpen(false)}
          onSubmit={(values) => saveContractTypeRequest({ ...values, id: c?.id ?? '' })}
          submitLabel={c ? 'Save changes' : 'Create'}
          successTitle={c ? 'Contract type updated' : 'Contract type created'}
        >
          <Field name="code" label="Code" required placeholder="e.g. PERM" defaultValue={c?.code} uppercase />
          <Field name="name" label="Name" required placeholder="e.g. Permanent & Pensionable" defaultValue={c?.name} />
          <Field name="default_notice_period_days" label="Default notice period (days)" type="number" defaultValue={c?.default_notice_period_days ?? 30} />
        </FormModal>
      ) : null}
    </>
  );
}

export function DeleteContractTypeButton({ id, className = 'btn sm ghost' }: { id: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => deleteContractTypeRequest(id), {
        confirm: { title: 'Delete this contract type?', message: 'Refused if any employee uses it.', confirmLabel: 'Delete' },
        successTitle: 'Deleted',
      })}>
      {busy ? 'Working…' : 'Delete'}
    </button>
  );
}
