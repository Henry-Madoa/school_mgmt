'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { useRunAction } from '@/components/ui/run-action';
import { saveJobGradeRequest, deleteJobGradeRequest } from '@/app/actions/hrSetup';
import type { HrJobGrade } from '@/lib/types';

export function JobGradeFormButton({ grade, className = 'btn', children }: {
  grade?: HrJobGrade | null; className?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const g = grade ?? null;

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          title={g ? `Edit ${g.name}` : 'Add a job grade'}
          onClose={() => setOpen(false)}
          onSubmit={(values) => saveJobGradeRequest({ ...values, id: g?.id ?? '' })}
          submitLabel={g ? 'Save changes' : 'Create'}
          successTitle={g ? 'Job grade updated' : 'Job grade created'}
        >
          <Field name="code" label="Code" required placeholder="e.g. JG5" defaultValue={g?.code} uppercase />
          <Field name="name" label="Name" required placeholder="e.g. Officer" defaultValue={g?.name} />
          <div className="grid g2">
            <Field name="notice_period_days" label="Notice period (days)" type="number" defaultValue={g?.notice_period_days ?? 30} />
            <Field name="probation_notice_period_days" label="Probation notice (days)" type="number" defaultValue={g?.probation_notice_period_days ?? 7} />
          </div>
          <div className="grid g3">
            <Field name="leave_allowance_amount" label="Leave allowance" type="currency" defaultValue={g?.leave_allowance_amount ?? 0} />
            <Field name="training_allowance_amount" label="Training allowance" type="currency" defaultValue={g?.training_allowance_amount ?? 0} />
            <Field name="overtime_allowance_amount" label="Overtime allowance" type="currency" defaultValue={g?.overtime_allowance_amount ?? 0} />
          </div>
        </FormModal>
      ) : null}
    </>
  );
}

export function DeleteJobGradeButton({ id, className = 'btn sm ghost' }: { id: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => deleteJobGradeRequest(id), {
        confirm: { title: 'Delete this job grade?', message: 'Refused if any employee is on it.', confirmLabel: 'Delete' },
        successTitle: 'Deleted',
      })}>
      {busy ? 'Working…' : 'Delete'}
    </button>
  );
}
