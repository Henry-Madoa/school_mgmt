'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { useRunAction } from '@/components/ui/run-action';
import { saveTerminationReasonRequest, deleteTerminationReasonRequest } from '@/app/actions/hrSetup';
import type { HrTerminationReason } from '@/lib/types';

export function TerminationReasonFormButton({ reason, className = 'btn', children }: {
  reason?: HrTerminationReason | null; className?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const r = reason ?? null;

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          title={r ? `Edit ${r.code}` : 'Add a termination reason'}
          onClose={() => setOpen(false)}
          onSubmit={(values) => saveTerminationReasonRequest({ ...values, id: r?.id ?? '' })}
          submitLabel={r ? 'Save changes' : 'Create'}
          successTitle={r ? 'Termination reason updated' : 'Termination reason created'}
        >
          <Field name="code" label="Code" required placeholder="e.g. RESIGN" defaultValue={r?.code} uppercase />
          <Field name="description" label="Description" required placeholder="e.g. Resignation" defaultValue={r?.description} />
          <Field name="pay_gratuity" label="Pay gratuity on this ground" type="checkbox" defaultValue={r?.pay_gratuity ? '1' : ''} />
        </FormModal>
      ) : null}
    </>
  );
}

export function DeleteTerminationReasonButton({ id, className = 'btn sm ghost' }: { id: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => deleteTerminationReasonRequest(id), {
        confirm: { title: 'Delete this reason?', message: 'Refused if it is used on an employee exit.', confirmLabel: 'Delete' },
        successTitle: 'Deleted',
      })}>
      {busy ? 'Working…' : 'Delete'}
    </button>
  );
}
