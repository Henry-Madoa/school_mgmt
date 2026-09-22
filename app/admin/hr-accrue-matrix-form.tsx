'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { useRunAction } from '@/components/ui/run-action';
import { saveAccrueMatrixRowRequest, deleteAccrueMatrixRowRequest } from '@/app/actions/leaveSetup';
import type { HrLeaveDaysToAccrue, HrLeaveType, HrJobGrade } from '@/lib/types';

export function AccrueMatrixFormButton({ row, leaveTypes, grades, className = 'btn', children }: {
  row?: HrLeaveDaysToAccrue | null; leaveTypes: HrLeaveType[]; grades: HrJobGrade[]; className?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const r = row ?? null;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          title={r ? 'Edit accrual rate' : 'Add accrual rate'}
          onClose={() => setOpen(false)}
          onSubmit={(values) => saveAccrueMatrixRowRequest({ ...values, id: r?.id ?? '' })}
          submitLabel={r ? 'Save changes' : 'Create'}
          successTitle={r ? 'Updated' : 'Created'}
        >
          <Field name="leaveTypeId" label="Leave type" type="select" required
            options={leaveTypes.map((t) => ({ value: t.id, label: t.name }))} defaultValue={r?.leave_type_id ?? ''} />
          <Field name="jobGradeId" label="Job grade" type="select" required
            options={grades.map((g) => ({ value: g.id, label: `${g.code} — ${g.name}` }))} defaultValue={r?.job_grade_id ?? ''} />
          <div className="grid g2">
            <Field name="daysToAccrue" label="Days per accrual run" type="number" defaultValue={r?.days_to_accrue ?? 0} />
            <Field name="leaveDayWorthCents" label="Leave day monetary worth" type="currency" defaultValue={r ? r.leave_day_worth_cents / 100 : 0} />
          </div>
        </FormModal>
      ) : null}
    </>
  );
}

export function DeleteAccrueMatrixRowButton({ id, className = 'btn sm ghost' }: { id: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => deleteAccrueMatrixRowRequest(id), {
        confirm: { title: 'Delete this row?', confirmLabel: 'Delete' }, successTitle: 'Deleted',
      })}>
      {busy ? 'Working…' : 'Delete'}
    </button>
  );
}
