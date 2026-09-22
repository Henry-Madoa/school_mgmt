'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { useRunAction } from '@/components/ui/run-action';
import { saveClearanceSectionRequest, deleteClearanceSectionRequest } from '@/app/actions/hrSetup';
import type { HrClearanceSection } from '@/lib/types';

export function ClearanceSectionFormButton({ section, className = 'btn', children }: {
  section?: HrClearanceSection | null; className?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const s = section ?? null;

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          title={s ? `Edit ${s.name}` : 'Add a clearance section'}
          onClose={() => setOpen(false)}
          onSubmit={(values) => saveClearanceSectionRequest({ ...values, id: s?.id ?? '' })}
          submitLabel={s ? 'Save changes' : 'Create'}
          successTitle={s ? 'Clearance section updated' : 'Clearance section created'}
        >
          <Field name="code" label="Code" required placeholder="e.g. IT" defaultValue={s?.code} uppercase />
          <Field name="name" label="Name" required placeholder="e.g. IT Department" defaultValue={s?.name} />
          <Field name="owner_email" label="Owner email" placeholder="Notified when an exit needs clearing" defaultValue={s?.owner_email ?? ''} type="email" />
          <Field name="sort_order" label="Sort order" type="number" defaultValue={s?.sort_order ?? 0} />
        </FormModal>
      ) : null}
    </>
  );
}

export function DeleteClearanceSectionButton({ id, className = 'btn sm ghost' }: { id: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => deleteClearanceSectionRequest(id), {
        confirm: { title: 'Delete this section?', message: 'Refused if it is used on an employee exit.', confirmLabel: 'Delete' },
        successTitle: 'Deleted',
      })}>
      {busy ? 'Working…' : 'Delete'}
    </button>
  );
}
