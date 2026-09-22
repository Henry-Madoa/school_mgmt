'use client';

import { useState, type ReactNode } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { createUnitOfMeasureRequest, updateUnitOfMeasureRequest } from '@/app/actions/inventory';
import type { UnitOfMeasure } from '@/lib/types';

export function UnitOfMeasureFormButton({ unitOfMeasure, className = 'btn', children }: {
  unitOfMeasure?: UnitOfMeasure | null; className?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const u = unitOfMeasure ?? null;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          title={u ? `Edit ${u.code}` : 'Add a unit of measure'}
          onClose={() => setOpen(false)}
          onSubmit={(values) => (u ? updateUnitOfMeasureRequest(u.id, values) : createUnitOfMeasureRequest(values))}
          submitLabel={u ? 'Save changes' : 'Create'}
          successTitle={u ? 'Unit of measure updated' : 'Unit of measure created'}
        >
          <Field name="code" label="Code" required placeholder="e.g. BOX" uppercase defaultValue={u?.code} />
          <Field name="description" label="Description" required placeholder="e.g. Box of 12" defaultValue={u?.description} />
          <Field name="symbol" label="Symbol" defaultValue={u?.symbol ?? ''} placeholder="Optional, e.g. bx" />
        </FormModal>
      ) : null}
    </>
  );
}
