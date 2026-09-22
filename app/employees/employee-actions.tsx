'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { useRunAction } from '@/components/ui/run-action';
import {
  deleteEmployeeRequest, submitEmployeeRequest, cancelEmployeeApprovalRequest,
  approveEmployeeRequest, rejectEmployeeRequest,
} from '@/app/actions/employees';
import type {
  County, SubCounty, DimensionValue, EmployeeView, HrJobGrade, HrEmploymentContractType, HrCompanyJobView,
} from '@/lib/types';

/** An approved position on the establishment, as the Employment card offers it. */
export type CompanyJobLite = Pick<HrCompanyJobView, 'id' | 'job_id' | 'name' | 'no_of_posts' | 'occupied' | 'vacant'>;

type EmployeeLite = Pick<EmployeeView, 'id' | 'employee_no' | 'first_name' | 'last_name'>;

/** Shared by the employee list (filter options) and the employee card's inline-editable
 *  sections (app/employees/employee-info-cards.tsx) — creation and further edits both happen
 *  directly on the card, mirroring Member Application, rather than a form modal. Department is
 *  the existing Global Dimension 1/2 infrastructure (same as Members), not a bespoke master. */
export interface EmployeeLookups {
  globalDimension1Values: DimensionValue[]; globalDimension2Values: DimensionValue[];
  caption1: string; caption2: string;
  jobGrades: HrJobGrade[]; contractTypes: HrEmploymentContractType[];
  counties: County[]; subCounties: SubCounty[]; managers: EmployeeLite[];
  /** Approved company jobs (AL Employee."Job Code") the employee may be placed on. */
  companyJobs: CompanyJobLite[];
}

export function DeleteButton({ id, className = 'btn sm ghost' }: { id: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => deleteEmployeeRequest(id), {
        confirm: { title: 'Delete this employee record?', message: 'Only a new, not-yet-submitted record can be deleted.', confirmLabel: 'Delete' },
        successTitle: 'Deleted',
        redirectTo: '/employees',
      })}>
      {busy ? 'Working…' : 'Delete'}
    </button>
  );
}

export function SubmitButton({ id, className = 'btn sm ghost' }: { id: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => submitEmployeeRequest(id), {
        confirm: { title: 'Send this employee for approval?', message: 'A national ID is required. It can no longer be edited directly while pending.', confirmLabel: 'Send for approval' },
        successTitle: (d) => (d.autoApproved ? 'Approved — now Active' : 'Sent for approval'),
      })}>
      {busy ? 'Working…' : 'Send for approval'}
    </button>
  );
}

export function CancelApprovalButton({ id, className = 'btn sm ghost' }: { id: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => cancelEmployeeApprovalRequest(id), {
        confirm: { title: 'Recall this record?', message: 'It goes back to New so you can amend and resubmit it.', confirmLabel: 'Recall' },
        successTitle: 'Recalled — back to New',
      })}>
      {busy ? 'Working…' : 'Cancel approval request'}
    </button>
  );
}

export { DelegateButton } from '@/components/ui/delegate-button';

export function ApproveButton({ id, className = 'btn sm' }: { id: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => approveEmployeeRequest(id), {
        confirm: { title: 'Approve this employee?', message: 'The record becomes Active and their first contract row is opened.', confirmLabel: 'Approve' },
        successTitle: 'Approved — now Active',
      })}>
      {busy ? 'Working…' : 'Approve'}
    </button>
  );
}

export function RejectButton({ id, className = 'btn sm ghost' }: { id: number; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Reject</button>
      {open ? (
        <FormModal
          title="Reject employee record"
          onClose={() => setOpen(false)}
          onSubmit={(values) => rejectEmployeeRequest(id, String(values.reason || ''))}
          submitLabel="Reject" submitClass="btn danger"
          successTitle="Rejected — back to New" resultStyle="popup"
        >
          <Field name="reason" label="Reason" type="textarea" required />
        </FormModal>
      ) : null}
    </>
  );
}
