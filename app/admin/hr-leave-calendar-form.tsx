'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { createLeaveCalendarRequest } from '@/app/actions/leaveSetup';

export function NewLeaveCalendarButton({ hasCurrent }: { hasCurrent: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>New leave calendar</button>
      {open ? (
        <FormModal
          title="New leave calendar"
          onClose={() => setOpen(false)}
          onSubmit={createLeaveCalendarRequest}
          submitLabel="Create"
          successTitle="Leave calendar created"
        >
          <Field name="code" label="Code / year" required placeholder="e.g. 2026" />
          <div className="grid g2">
            <Field name="startDate" label="Start date" type="date" required />
            <Field name="endDate" label="End date" type="date" required />
          </div>
          <Field name="makeCurrent" label="Make this the current calendar" type="checkbox" defaultValue={hasCurrent ? '' : '1'} />
        </FormModal>
      ) : null}
    </>
  );
}
