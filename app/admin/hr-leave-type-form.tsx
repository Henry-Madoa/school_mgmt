'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { useRunAction } from '@/components/ui/run-action';
import { saveLeaveTypeRequest, deleteLeaveTypeRequest } from '@/app/actions/leaveSetup';
import type { HrLeaveType } from '@/lib/types';

const GENDER_OPTIONS = [{ value: 'ANY', label: 'Any' }, { value: 'MALE', label: 'Male only' }, { value: 'FEMALE', label: 'Female only' }];
const BALANCE_OPTIONS = [
  { value: 'IGNORE', label: 'Ignore (forfeit unused balance)' },
  { value: 'CARRY_FORWARD', label: 'Carry forward (capped)' },
  { value: 'CONVERT_CASH', label: 'Convert to cash' },
];

export function LeaveTypeFormButton({ leaveType, className = 'btn', children }: {
  leaveType?: HrLeaveType | null; className?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const t = leaveType ?? null;

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          title={t ? `Edit ${t.name}` : 'Add a leave type'} wide
          onClose={() => setOpen(false)}
          onSubmit={(values) => saveLeaveTypeRequest({ ...values, id: t?.id ?? '' })}
          submitLabel={t ? 'Save changes' : 'Create'}
          successTitle={t ? 'Leave type updated' : 'Leave type created'}
        >
          <div className="grid g2">
            <Field name="code" label="Code" required placeholder="e.g. ANNUAL" defaultValue={t?.code} uppercase />
            <Field name="name" label="Name" required placeholder="e.g. Annual Leave" defaultValue={t?.name} />
          </div>
          <div className="grid g3">
            <Field name="standardDays" label="Standard days / allotment" type="number" defaultValue={t?.standard_days ?? 0} />
            <Field name="maxCarryForwardDays" label="Max carry-forward days" type="number" defaultValue={t?.max_carry_forward_days ?? 0} />
            <Field name="maxApplicableDays" label="Max days per application" type="number" defaultValue={t?.max_applicable_days ?? ''} />
          </div>
          <div className="grid g2">
            <Field name="gender" label="Gender restriction" type="select" options={GENDER_OPTIONS} defaultValue={t?.gender ?? 'ANY'} />
            <Field name="balanceTreatment" label="Balance at period close" type="select" options={BALANCE_OPTIONS} defaultValue={t?.balance_treatment ?? 'IGNORE'} />
          </div>
          <div className="grid g3">
            <Field name="accrues" label="Accrues periodically" type="checkbox" defaultValue={t?.accrues ? '1' : ''} />
            <Field name="daysToAccrue" label="Days per accrual run" type="number" defaultValue={t?.days_to_accrue ?? 0} />
            <Field name="unlimitedDays" label="Unlimited days" type="checkbox" defaultValue={t?.unlimited_days ? '1' : ''} />
          </div>
          <div className="grid g3">
            <Field name="inclusiveOfSaturday" label="Saturdays count against balance" type="checkbox" defaultValue={t?.inclusive_of_saturday ? '1' : ''} />
            <Field name="inclusiveOfSunday" label="Sundays count against balance" type="checkbox" defaultValue={t?.inclusive_of_sunday ? '1' : ''} />
            <Field name="inclusiveOfHolidays" label="Holidays count against balance" type="checkbox" defaultValue={t?.inclusive_of_holidays ? '1' : ''} />
          </div>
          <div className="grid g3">
            <Field name="fixedDays" label="Fixed duration (no day-counting)" type="checkbox" defaultValue={t?.fixed_days ? '1' : ''} />
            <Field name="isAnnual" label="Is the annual leave type" type="checkbox" defaultValue={t?.is_annual ? '1' : ''} />
            <Field name="checkBalance" label="Check balance on application" type="checkbox" defaultValue={t?.check_balance !== false ? '1' : ''} />
          </div>
          <div className="grid g3">
            <Field name="isSickLeave" label="Sick leave (admin-entry only)" type="checkbox" defaultValue={t?.is_sick_leave ? '1' : ''} />
            <Field name="requiresAdminApproval" label="Requires HR admin approval" type="checkbox" defaultValue={t?.requires_admin_approval ? '1' : ''} />
            <Field name="leaveBalanceNotificationThreshold" label="Notify above balance" type="number" defaultValue={t?.leave_balance_notification_threshold ?? ''} />
          </div>
          {t ? <Field name="disabled" label="Disabled" type="checkbox" defaultValue={t.disabled ? '1' : ''} /> : null}
        </FormModal>
      ) : null}
    </>
  );
}

export function DeleteLeaveTypeButton({ id, className = 'btn sm ghost' }: { id: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => deleteLeaveTypeRequest(id), {
        confirm: { title: 'Delete this leave type?', message: 'Refused if it has ledger history.', confirmLabel: 'Delete' },
        successTitle: 'Deleted',
      })}>
      {busy ? 'Working…' : 'Delete'}
    </button>
  );
}
