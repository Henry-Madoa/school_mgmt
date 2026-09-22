'use client';

import { useEffect, useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useRunAction } from '@/components/ui/run-action';
import {
  requestLeaveRecall, deleteLeaveRecallRequest, submitLeaveRecallRequest, cancelLeaveRecallApprovalRequest,
  approveLeaveRecallRequest, rejectLeaveRecallRequest, recallableApplicationsFor,
} from '@/app/actions/leaveRecalls';
import type { EmployeeView, HrLeaveApplicationView } from '@/lib/types';

type EmployeeLite = Pick<EmployeeView, 'id' | 'employee_no' | 'first_name' | 'last_name'>;

export function NewRecallButton({ employees }: { employees: EmployeeLite[] }) {
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  const [applicationNo, setApplicationNo] = useState('');
  const [applications, setApplications] = useState<HrLeaveApplicationView[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!employeeId) { setApplications([]); return; }
    recallableApplicationsFor(Number(employeeId)).then((res) => {
      if (!cancelled && res.ok) setApplications(res.data);
    });
    return () => { cancelled = true; };
  }, [employeeId]);

  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>New recall</button>
      {open ? (
        <FormModal
          title="New leave recall" wide
          onClose={() => setOpen(false)}
          onSubmit={requestLeaveRecall}
          submitLabel="Save"
          successTitle="Recall created"
          successDetail={(d) => `${d.no} saved — send it for approval when ready`} redirectTo={(d) => `/leave-recalls/view/${d.no}`}
        >
          <SearchableSelect id="f_employeeId" name="employeeId" label="Employee" required
            items={employees} getValue={(e) => String(e.id)} getLabel={(e) => `${e.employee_no} — ${e.first_name} ${e.last_name}`}
            value={employeeId} onChange={(v) => { setEmployeeId(v); setApplicationNo(''); }} placeholder="Search employee…" />
          <SearchableSelect id="f_applicationNo" name="applicationNo" label="Approved leave to recall from" required
            items={applications} getValue={(a) => a.no} getLabel={(a) => `${a.no} — ${a.leave_type_name} (${a.start_date} to ${a.end_date}, ${a.days_applied}d)`}
            value={applicationNo} onChange={setApplicationNo} disabled={!employeeId}
            placeholder={employeeId ? 'Search application…' : 'Pick an employee first'} />
          <Field name="daysToRecall" label="Days to recall" type="number" required />
        </FormModal>
      ) : null}
    </>
  );
}

export function DeleteButton({ no, className = 'btn sm ghost' }: { no: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => deleteLeaveRecallRequest(no), {
        confirm: { title: 'Delete this recall?', confirmLabel: 'Delete' }, successTitle: 'Deleted',
        redirectTo: '/leave-recalls',
      })}>
      {busy ? 'Working…' : 'Delete'}
    </button>
  );
}

export function SubmitButton({ no, className = 'btn sm ghost' }: { no: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => submitLeaveRecallRequest(no), {
        confirm: { title: 'Send this recall for approval?', confirmLabel: 'Send for approval' },
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
      onClick={() => run(() => cancelLeaveRecallApprovalRequest(no), {
        confirm: { title: 'Recall this request?', confirmLabel: 'Recall' }, successTitle: 'Recalled — back to Open',
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
      onClick={() => run(() => approveLeaveRecallRequest(no), {
        confirm: { title: 'Approve this recall?', message: 'The recalled days are credited back immediately.', confirmLabel: 'Approve' },
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
          title="Reject recall"
          onClose={() => setOpen(false)}
          onSubmit={(values) => rejectLeaveRecallRequest(no, String(values.reason || ''))}
          submitLabel="Reject" submitClass="btn danger"
          successTitle="Rejected — back to Open" resultStyle="popup"
        >
          <Field name="reason" label="Reason" type="textarea" required />
        </FormModal>
      ) : null}
    </>
  );
}
