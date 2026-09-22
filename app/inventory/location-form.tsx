'use client';

import { useState, type ReactNode } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { createLocationRequest, updateLocationRequest } from '@/app/actions/inventory';
import type { Location } from '@/lib/types';

const STATUSES = [{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }];

export function LocationFormButton({ location, className = 'btn', children }: {
  location?: Location | null; className?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const l = location ?? null;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          title={l ? `Edit ${l.code} — ${l.name}` : 'Add a location'}
          onClose={() => setOpen(false)}
          onSubmit={(values) => (l ? updateLocationRequest(l.id, values) : createLocationRequest(values))}
          submitLabel={l ? 'Save changes' : 'Create'}
          successTitle={l ? 'Location updated' : 'Location created'}
        >
          <Field name="code" label="Code" required placeholder="e.g. MAIN" defaultValue={l?.code} disabled={!!l} />
          <Field name="name" label="Name" required defaultValue={l?.name} />
          <Field name="address" label="Address" type="textarea" defaultValue={l?.address ?? ''} placeholder="Optional" />
          {l ? <Field name="status" label="Status" type="select" options={STATUSES} defaultValue={l.status} /> : null}
        </FormModal>
      ) : null}
    </>
  );
}
