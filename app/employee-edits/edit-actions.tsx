'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useRunAction } from '@/components/ui/run-action';
import {
  createEmployeeEditRequestAction, submitEmployeeEditRequestAction, deleteEmployeeEditRequestAction,
  cancelEmployeeEditApprovalAction, approveEmployeeEditAction, rejectEmployeeEditAction, processEmployeeEditAction,
} from '@/app/actions/employeeEdits';
import { delegateMyTask } from '@/app/actions/workflows';
import type { County, SubCounty, DimensionValue, EmployeeView, HrJobGrade } from '@/lib/types';
import type { CompanyJobLite } from '@/app/employees/employee-actions';

export interface EditLookups {
  globalDimension1Values: DimensionValue[]; globalDimension2Values: DimensionValue[];
  caption1: string; caption2: string;
  jobGrades: HrJobGrade[]; counties: County[]; subCounties: SubCounty[];
  companyJobs: CompanyJobLite[];
}

type EmployeeLite = Pick<EmployeeView, 'id' | 'employee_no' | 'first_name' | 'last_name'>;

/** Starts a new edit request by snapshotting an active employee's current values. */
export function NewEditRequestButton({ employees, self, initialEmployeeId, autoOpen = false, label }: {
  employees: EmployeeLite[];
  /** Employee Self Service: the request is against this employee's own record — no picker. */
  self?: EmployeeLite | null;
  /** Preselect an employee (the Employee Card's "Request a change" link). */
  initialEmployeeId?: number | null;
  autoOpen?: boolean;
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(autoOpen);
  const [employeeId, setEmployeeId] = useState(self ? String(self.id) : initialEmployeeId ? String(initialEmployeeId) : '');
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>{label ?? 'New edit request'}</button>
      {open ? (
        <FormModal
          title="New employee edit request"
          onClose={() => setOpen(false)}
          onSubmit={async () => {
            const res = await createEmployeeEditRequestAction(Number(employeeId));
            if (res.ok) router.push(`/employee-edits/view/${res.data.no}?edit=1`);
            return res;
          }}
          submitLabel="Start request"
          successTitle="Edit request created"
          successDetail={(d) => `${d.no} is open for editing`} redirectTo={(d) => `/employee-edits/view/${d.no}`}
        >
          {self ? (
            <div className="note">
              A change request snapshots your record as HR holds it today. Edit what should change, send it for
              approval, and once approved and applied the live record is updated.
            </div>
          ) : (
            <SearchableSelect id="f_employeeId" name="employeeId" label="Employee"
              items={employees} getValue={(e) => String(e.id)} getLabel={(e) => `${e.employee_no} — ${e.first_name} ${e.last_name}`}
              value={employeeId} onChange={setEmployeeId} required placeholder="Search employee…" />
          )}
        </FormModal>
      ) : null}
    </>
  );
}

/** Deletes an Open request. From the card it lands on the list the card came from (the card
 *  itself is gone); from a list row it just refreshes. */
export function DeleteEditButton({ no, listHref, className = 'btn sm ghost' }: { no: string; listHref?: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => deleteEmployeeEditRequestAction(no), {
        confirm: { title: 'Delete this edit request?', message: 'The proposed changes are discarded; the employee record is untouched. This cannot be undone.', confirmLabel: 'Delete', danger: true },
        successTitle: 'Edit request deleted', redirectTo: listHref,
      })}>
      {busy ? 'Working…' : 'Delete'}
    </button>
  );
}

export function SubmitEditButton({ no, className = 'btn sm ghost' }: { no: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => submitEmployeeEditRequestAction(no), {
        confirm: { title: 'Send this edit request for approval?', confirmLabel: 'Send for approval' },
        successTitle: (d) => (d.autoApproved ? 'Approved — ready to apply' : 'Sent for approval'),
      })}>
      {busy ? 'Working…' : 'Send for approval'}
    </button>
  );
}

export function CancelEditApprovalButton({ no, className = 'btn sm ghost' }: { no: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => cancelEmployeeEditApprovalAction(no), {
        confirm: { title: 'Recall this request?', message: 'It goes back to Open so you can amend and resubmit it.', confirmLabel: 'Recall' },
        successTitle: 'Recalled — back to Open',
      })}>
      {busy ? 'Working…' : 'Cancel approval request'}
    </button>
  );
}

export function DelegateEditButton({ taskId, className = 'btn sm ghost' }: { taskId: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => delegateMyTask(taskId), {
        confirm: { title: 'Delegate to your substitute?', confirmLabel: 'Delegate' },
        successTitle: 'Delegated to your substitute',
      })}>
      {busy ? 'Working…' : 'Delegate'}
    </button>
  );
}

export function ApproveEditButton({ no, className = 'btn sm' }: { no: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => approveEmployeeEditAction(no), {
        confirm: { title: 'Approve this edit request?', message: 'Nothing changes on the employee until you Apply it.', confirmLabel: 'Approve' },
        successTitle: 'Approved — ready to apply',
      })}>
      {busy ? 'Working…' : 'Approve'}
    </button>
  );
}

export function RejectEditButton({ no, className = 'btn sm ghost' }: { no: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Reject</button>
      {open ? (
        <FormModal
          title="Reject edit request"
          onClose={() => setOpen(false)}
          onSubmit={(values) => rejectEmployeeEditAction(no, String(values.reason || ''))}
          submitLabel="Reject" submitClass="btn danger"
          successTitle="Rejected — back to Open" resultStyle="popup"
        >
          <Field name="reason" label="Reason" type="textarea" required />
        </FormModal>
      ) : null}
    </>
  );
}

export function ApplyEditButton({ no, className = 'btn sm' }: { no: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => processEmployeeEditAction(no), {
        confirm: { title: 'Apply this edit to the employee?', message: 'The employee record and every sub-entity list are updated immediately.', confirmLabel: 'Apply' },
        successTitle: 'Applied to the employee',
      })}>
      {busy ? 'Working…' : 'Apply to employee'}
    </button>
  );
}
