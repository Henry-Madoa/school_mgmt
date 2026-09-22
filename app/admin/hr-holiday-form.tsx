'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { useRunAction } from '@/components/ui/run-action';
import { saveHolidayRequest, deleteHolidayRequest } from '@/app/actions/leaveSetup';
import type { HrHoliday } from '@/lib/types';

export function HolidayFormButton({ holiday, className = 'btn', children }: {
  holiday?: HrHoliday | null; className?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const h = holiday ?? null;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          title={h ? `Edit ${h.date}` : 'Add a holiday'}
          onClose={() => setOpen(false)}
          onSubmit={(values) => saveHolidayRequest({ ...values, id: h?.id ?? '' })}
          submitLabel={h ? 'Save changes' : 'Create'}
          successTitle={h ? 'Holiday updated' : 'Holiday created'}
        >
          <Field name="date" label="Date" type="date" required defaultValue={h?.date} />
          <Field name="reason" label="Reason" required placeholder="e.g. Labour Day" defaultValue={h?.reason} />
          <Field name="recurring" label="Recurs every year" type="checkbox" defaultValue={h?.recurring ? '1' : ''} />
        </FormModal>
      ) : null}
    </>
  );
}

export function DeleteHolidayButton({ id, className = 'btn sm ghost' }: { id: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => deleteHolidayRequest(id), {
        confirm: { title: 'Delete this holiday?', confirmLabel: 'Delete' }, successTitle: 'Deleted',
      })}>
      {busy ? 'Working…' : 'Delete'}
    </button>
  );
}
