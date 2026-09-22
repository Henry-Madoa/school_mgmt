'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { useRunAction } from '@/components/ui/run-action';
import { saveNssfTierRequest, deleteNssfTierRequest } from '@/app/actions/payrollSetup';
import type { PayrollNssfTier } from '@/lib/types';

export function NssfTierFormButton({ tier, className = 'btn', children }: {
  tier?: PayrollNssfTier | null; className?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const t = tier ?? null;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          title={t ? `Edit Tier ${t.tier_no}` : 'Add an NSSF tier'}
          onClose={() => setOpen(false)}
          onSubmit={(values) => saveNssfTierRequest({ ...values, id: t?.id ?? '' })}
          submitLabel={t ? 'Save changes' : 'Create'}
          successTitle={t ? 'Tier updated' : 'Tier created'}
        >
          <Field name="tierNo" label="Tier number" type="number" required defaultValue={t?.tier_no ?? ''} />
          <div className="grid g2">
            <Field name="lowerLimitCents" label="Lower limit" type="currency" required defaultValue={t ? t.lower_limit_cents / 100 : ''} />
            <Field name="upperLimitCents" label="Upper limit" type="currency" required defaultValue={t ? t.upper_limit_cents / 100 : ''} />
          </div>
          <div className="grid g2">
            <Field name="employeeRatePct" label="Employee rate %" type="number" step="0.01" required defaultValue={t?.employee_rate_pct ?? ''} />
            <Field name="employerRatePct" label="Employer rate %" type="number" step="0.01" required defaultValue={t?.employer_rate_pct ?? ''} />
          </div>
        </FormModal>
      ) : null}
    </>
  );
}

export function DeleteNssfTierButton({ id, className = 'btn sm ghost' }: { id: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => deleteNssfTierRequest(id), {
        confirm: { title: 'Delete this tier?', confirmLabel: 'Delete' }, successTitle: 'Deleted',
      })}>
      {busy ? 'Working…' : 'Delete'}
    </button>
  );
}
