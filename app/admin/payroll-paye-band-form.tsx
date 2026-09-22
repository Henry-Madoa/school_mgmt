'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { useRunAction } from '@/components/ui/run-action';
import { savePayeBandRequest, deletePayeBandRequest } from '@/app/actions/payrollSetup';
import type { PayrollPayeBand } from '@/lib/types';

export function PayeBandFormButton({ band, className = 'btn', children }: {
  band?: PayrollPayeBand | null; className?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const b = band ?? null;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          title={b ? `Edit band ${b.sort_order}` : 'Add a PAYE band'}
          onClose={() => setOpen(false)}
          onSubmit={(values) => savePayeBandRequest({ ...values, id: b?.id ?? '' })}
          submitLabel={b ? 'Save changes' : 'Create'}
          successTitle={b ? 'Band updated' : 'Band created'}
        >
          <Field name="sortOrder" label="Order (1 = first/lowest band)" type="number" required defaultValue={b?.sort_order ?? ''} />
          <Field name="upperBoundCents" label="Band width (leave blank for the final, unbounded band)" type="currency" defaultValue={b?.upper_bound_cents != null ? b.upper_bound_cents / 100 : ''} />
          <Field name="ratePct" label="Rate %" type="number" step="0.01" required defaultValue={b?.rate_pct ?? ''} />
        </FormModal>
      ) : null}
    </>
  );
}

export function DeletePayeBandButton({ id, className = 'btn sm ghost' }: { id: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => deletePayeBandRequest(id), {
        confirm: { title: 'Delete this band?', confirmLabel: 'Delete' }, successTitle: 'Deleted',
      })}>
      {busy ? 'Working…' : 'Delete'}
    </button>
  );
}
