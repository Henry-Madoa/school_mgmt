'use client';

import { useState, type ReactNode } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { saveDimensionValue } from '@/app/actions/pool';
import { PRODUCT_STATUSES } from '@/lib/constants';
import type { DimensionSlot } from '@/lib/pool';
import type { DimensionValue } from '@/lib/types';

export function DimensionValueFormButton({ slot, caption, value, className = 'btn', children }: {
  slot: DimensionSlot;
  caption: string;
  value?: DimensionValue | null;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const v = value ?? null;

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          title={v ? `Edit ${v.name}` : `Add a ${caption.toLowerCase()} value`}
          onClose={() => setOpen(false)}
          onSubmit={(values) => saveDimensionValue(slot, v ? v.id : null, values)}
          submitLabel="Save"
          successTitle="Value saved"
        >
          <Field name="code" label="Code" defaultValue={v?.code} required disabled={!!v} maxLength={20} uppercase />
          <Field name="name" label="Name" defaultValue={v?.name} required maxLength={60} />
          {v ? (
            <Field name="status" label="Status" type="select" defaultValue={v.status} options={PRODUCT_STATUSES} />
          ) : null}
        </FormModal>
      ) : null}
    </>
  );
}
