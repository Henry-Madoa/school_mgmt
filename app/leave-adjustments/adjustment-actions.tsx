'use client';

import { useMemo, useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { useRunAction } from '@/components/ui/run-action';
import {
  requestLeaveAdjustment, setAdjustmentEmployeesRequest, deleteLeaveAdjustmentRequest,
  submitLeaveAdjustmentRequest, cancelLeaveAdjustmentApprovalRequest, approveLeaveAdjustmentRequest,
  rejectLeaveAdjustmentRequest,
} from '@/app/actions/leaveAdjustments';
import type { EmployeeView, HrLeaveType } from '@/lib/types';

type EmployeeLite = Pick<EmployeeView, 'id' | 'employee_no' | 'first_name' | 'last_name'>;

export function NewAdjustmentButton({ leaveTypes }: { leaveTypes: HrLeaveType[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>New leave adjustment</button>
      {open ? (
        <FormModal
          title="New leave adjustment"
          onClose={() => setOpen(false)}
          onSubmit={requestLeaveAdjustment}
          submitLabel="Save"
          successTitle="Adjustment created"
          successDetail={(d) => `${d.no} saved — assign employees, then send for approval`} redirectTo={(d) => `/leave-adjustments/view/${d.no}`}
        >
          <Field name="leaveTypeId" label="Leave type" type="select" required
            options={leaveTypes.map((t) => ({ value: t.id, label: t.name }))} />
          <Field name="type" label="Type" type="select"
            options={[{ value: 'POSITIVE', label: 'Positive (credit days)' }, { value: 'NEGATIVE', label: 'Negative (debit days)' }]} />
          <Field name="days" label="Days per employee" type="number" required />
          <Field name="description" label="Description" type="textarea" />
        </FormModal>
      ) : null}
    </>
  );
}

export function AssignEmployeesButton({ no, employees, assignedIds, className = 'btn' }: {
  no: string; employees: EmployeeLite[]; assignedIds: number[]; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set(assignedIds));
  const [search, setSearch] = useState('');
  const filtered = useMemo(
    () => employees.filter((e) => `${e.employee_no} ${e.first_name} ${e.last_name}`.toLowerCase().includes(search.toLowerCase())),
    [employees, search],
  );
  const toggle = (id: number) => setSelected((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Assign employees</button>
      {open ? (
        <FormModal
          title="Assign employees" wide
          onClose={() => setOpen(false)}
          onSubmit={() => setAdjustmentEmployeesRequest(no, [...selected])}
          submitLabel="Save assignment"
          successTitle="Employees assigned"
        >
          <input type="text" placeholder="Search employee…" value={search} onChange={(e) => setSearch(e.target.value)}
            style={{ marginBottom: 10, width: '100%' }} />
          <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
            {filtered.map((e) => (
              <label key={e.id} className="checkline" style={{ display: 'block', padding: '4px 0' }}>
                <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} />
                {' '}{e.employee_no} — {e.first_name} {e.last_name}
              </label>
            ))}
            {!filtered.length ? <div className="tiny">No matching employees</div> : null}
          </div>
          <div className="tiny" style={{ marginTop: 8 }}>{selected.size} employee(s) selected</div>
        </FormModal>
      ) : null}
    </>
  );
}

export function DeleteButton({ no, className = 'btn sm ghost' }: { no: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => deleteLeaveAdjustmentRequest(no), {
        confirm: { title: 'Delete this adjustment?', confirmLabel: 'Delete' }, successTitle: 'Deleted',
        redirectTo: '/leave-adjustments',
      })}>
      {busy ? 'Working…' : 'Delete'}
    </button>
  );
}

export function SubmitButton({ no, className = 'btn sm ghost' }: { no: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => submitLeaveAdjustmentRequest(no), {
        confirm: { title: 'Send this adjustment for approval?', confirmLabel: 'Send for approval' },
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
      onClick={() => run(() => cancelLeaveAdjustmentApprovalRequest(no), {
        confirm: { title: 'Recall this adjustment?', confirmLabel: 'Recall' }, successTitle: 'Recalled — back to Open',
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
      onClick={() => run(() => approveLeaveAdjustmentRequest(no), {
        confirm: { title: 'Approve this adjustment?', message: 'A ledger line is posted for every assigned employee.', confirmLabel: 'Approve' },
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
          title="Reject adjustment"
          onClose={() => setOpen(false)}
          onSubmit={(values) => rejectLeaveAdjustmentRequest(no, String(values.reason || ''))}
          submitLabel="Reject" submitClass="btn danger"
          successTitle="Rejected — back to Open" resultStyle="popup"
        >
          <Field name="reason" label="Reason" type="textarea" required />
        </FormModal>
      ) : null}
    </>
  );
}
