'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { LockedEmployee } from '@/components/ui/locked-employee';
import { useRunAction } from '@/components/ui/run-action';
import { today } from '@/lib/format';
import {
  requestLeaveApplication, deleteLeaveApplicationRequest, submitLeaveApplicationRequest,
  cancelLeaveApplicationApprovalRequest, approveLeaveApplicationRequest, rejectLeaveApplicationRequest,
} from '@/app/actions/leaveApplications';
import type { EmployeeView, HrLeaveType, LeaveApplicationNature } from '@/lib/types';

type EmployeeLite = Pick<EmployeeView, 'id' | 'employee_no' | 'first_name' | 'last_name'>;

export function NewLeaveApplicationButton({ employees, leaveTypes, self }: {
  employees: EmployeeLite[]; leaveTypes: HrLeaveType[];
  /** Employee Self Service: the application is this employee's own — no picker. */
  self?: EmployeeLite | null;
}) {
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState(self ? String(self.id) : '');
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [relieverId, setRelieverId] = useState('');
  const [nature, setNature] = useState<LeaveApplicationNature>('APPLICATION');

  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>New leave application</button>
      {open ? (
        <FormModal
          title="New leave application" wide
          onClose={() => setOpen(false)}
          onSubmit={requestLeaveApplication}
          submitLabel="Save"
          successTitle="Leave application created"
          successDetail={(d) => `${d.no} saved — send it for approval when ready`} redirectTo={(d) => `/leave-applications/view/${d.no}`}
        >
          {self ? <LockedEmployee employee={self} hint="Applications raised here are your own." /> : (
            <SearchableSelect id="f_employeeId" name="employeeId" label="Employee" required
              items={employees} getValue={(e) => String(e.id)} getLabel={(e) => `${e.employee_no} — ${e.first_name} ${e.last_name}`}
              value={employeeId} onChange={setEmployeeId} placeholder="Search employee…" />
          )}
          <div className="grid g2">
            <SearchableSelect id="f_leaveTypeId" name="leaveTypeId" label="Leave type" required
              items={leaveTypes} getValue={(t) => String(t.id)} getLabel={(t) => t.name}
              value={leaveTypeId} onChange={setLeaveTypeId} placeholder="Search leave type…" />
            <Field name="nature" label="Nature" type="select"
              options={[{ value: 'APPLICATION', label: 'Application' }, { value: 'REIMBURSEMENT', label: 'Reimbursement / Reinstatement' }]}
              defaultValue={nature} onChange={(e) => setNature(e.target.value as LeaveApplicationNature)} />
          </div>
          <div className="grid g2">
            <Field name="startDate" label="Start date" type="date" required defaultValue={today()} />
            <Field name="endDate" label="End date" type="date" required defaultValue={today()} />
          </div>
          <SearchableSelect id="f_relieverId" name="relieverId" label="Reliever (optional)"
            items={employees} getValue={(e) => String(e.id)} getLabel={(e) => `${e.employee_no} — ${e.first_name} ${e.last_name}`}
            value={relieverId} onChange={setRelieverId} placeholder="Search employee…" />
          <Field name="leaveAllowancePayable" label="Leave allowance payable (Annual leave, Payroll module)" type="checkbox" />

          {nature === 'REIMBURSEMENT' ? (
            <>
              <div className="grid g2">
                <Field name="daysDropped" label="Days dropped at period close" type="number" />
                <Field name="daysToReimburse" label="Days to reimburse" type="number" required />
              </div>
              <Field name="justification" label="Justification" type="textarea" required />
            </>
          ) : null}
        </FormModal>
      ) : null}
    </>
  );
}

export function DeleteButton({ no, className = 'btn sm ghost' }: { no: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => deleteLeaveApplicationRequest(no), {
        confirm: { title: 'Delete this application?', message: 'Only an open application can be deleted.', confirmLabel: 'Delete' },
        successTitle: 'Deleted',
        redirectTo: '/leave-applications',
      })}>
      {busy ? 'Working…' : 'Delete'}
    </button>
  );
}

export function SubmitButton({ no, className = 'btn sm ghost' }: { no: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => submitLeaveApplicationRequest(no), {
        confirm: { title: 'Send this application for approval?', confirmLabel: 'Send for approval' },
        successTitle: (d) => (d.autoApproved ? 'Approved and posted' : 'Sent for approval'),
      })}>
      {busy ? 'Working…' : 'Send for approval'}
    </button>
  );
}

export function CancelApprovalButton({ no, className = 'btn sm ghost' }: { no: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => cancelLeaveApplicationApprovalRequest(no), {
        confirm: { title: 'Recall this application?', message: 'It goes back to Open so you can amend and resubmit it.', confirmLabel: 'Recall' },
        successTitle: 'Recalled — back to Open',
      })}>
      {busy ? 'Working…' : 'Cancel approval request'}
    </button>
  );
}

export { DelegateButton } from '@/components/ui/delegate-button';

export function ApproveButton({ no, className = 'btn sm' }: { no: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => approveLeaveApplicationRequest(no), {
        confirm: { title: 'Approve this application?', message: 'The leave ledger is posted immediately.', confirmLabel: 'Approve' },
        successTitle: 'Approved and posted',
      })}>
      {busy ? 'Working…' : 'Approve'}
    </button>
  );
}

export function RejectButton({ no, className = 'btn sm ghost' }: { no: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Reject</button>
      {open ? (
        <FormModal
          title="Reject leave application"
          onClose={() => setOpen(false)}
          onSubmit={(values) => rejectLeaveApplicationRequest(no, String(values.reason || ''))}
          submitLabel="Reject" submitClass="btn danger"
          successTitle="Rejected — back to Open" resultStyle="popup"
        >
          <Field name="reason" label="Reason" type="textarea" required />
        </FormModal>
      ) : null}
    </>
  );
}
