'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { useEditableCard } from '@/components/ui/editable-card';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useRunAction } from '@/components/ui/run-action';
import { today } from '@/lib/format';
import {
  requestExit, updateExitRequest, addFinalDueLineRequest, removeFinalDueLineRequest, submitExitRequest,
  cancelExitApprovalRequest, approveExitRequest, rejectExitRequest, clearExitSectionRequest,
} from '@/app/actions/employeeExits';
import type { EmployeeExitFinalDueLine, EmployeeExitView, EmployeeView, HrTerminationReason } from '@/lib/types';

type EmployeeLite = Pick<EmployeeView, 'id' | 'employee_no' | 'first_name' | 'last_name'>;

const DUE_TYPES = [
  { value: 'LEAVE_ENCASHMENT', label: 'Leave Encashment' }, { value: 'NOTICE_PENALTY', label: 'Notice Penalty' },
  { value: 'NOTICE_INCOME', label: 'Notice Income (pay in lieu)' }, { value: 'GRATUITY', label: 'Gratuity' },
  { value: 'UNCLEARED_ITEMS', label: 'Uncleared Items' },
];

function ExitFields({ reasons, initial }: { reasons: HrTerminationReason[]; initial?: EmployeeExitView | null }) {
  const [reasonId, setReasonId] = useState(String(initial?.termination_reason_id ?? ''));
  return (
    <>
      <SearchableSelect id="f_terminationReasonId" name="terminationReasonId" label="Reason for exit" required
        items={reasons} getValue={(r) => String(r.id)} getLabel={(r) => r.description}
        value={reasonId} onChange={setReasonId} placeholder="Search reason…" />
      <div className="grid g2">
        <Field name="dateOfNotice" label="Date of notice" type="date" required defaultValue={initial?.date_of_notice ?? today()} />
        <Field name="dateOfExit" label="Date of exit" type="date" required defaultValue={initial?.date_of_exit ?? ''} />
      </div>
      <div className="grid g2">
        <Field name="noticePeriodDays" label="Notice period (days)" type="number" defaultValue={initial?.notice_period_days ?? ''} />
        <Field name="canBeReemployed" label="Can be re-employed" type="checkbox" defaultValue={initial?.can_be_reemployed ? '1' : ''} />
      </div>
      <Field name="reasonsForNotServingNotice" label="Reasons for not serving full notice (if applicable)" type="textarea"
        defaultValue={initial?.reasons_for_not_serving_notice ?? ''} />
    </>
  );
}

export function NewExitButton({ employees, reasons }: { employees: EmployeeLite[]; reasons: HrTerminationReason[] }) {
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>New exit</button>
      {open ? (
        <FormModal
          title="New employee exit" wide
          onClose={() => setOpen(false)}
          onSubmit={(values) => requestExit({ ...values, employeeId })}
          submitLabel="Save"
          successTitle="Exit request created"
          successDetail={(d) => `${d.no} saved — send it for approval when ready`} redirectTo={(d) => `/employee-exits/view/${d.no}`}
        >
          <SearchableSelect id="f_employeeId2" name="employeeIdDisplay" label="Employee" required
            items={employees} getValue={(e) => String(e.id)} getLabel={(e) => `${e.employee_no} — ${e.first_name} ${e.last_name}`}
            value={employeeId} onChange={setEmployeeId} placeholder="Search employee…" />
          <ExitFields reasons={reasons} />
        </FormModal>
      ) : null}
    </>
  );
}

export function EditExitForm({ exit, reasons }: {
  exit: EmployeeExitView; reasons: HrTerminationReason[];
}) {
  const { close } = useEditableCard();
  return (
    <>
        <FormModal inline
          title={`Edit ${exit.no}`} wide
          onClose={close}
          onSubmit={(values) => updateExitRequest(exit.no, values)}
          submitLabel="Save changes"
          successTitle="Updated"
        >
          <ExitFields reasons={reasons} initial={exit} />
        </FormModal>
    </>
  );
}

export function AddDueLineButton({ no, className = 'btn sm ghost' }: { no: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Add due line</button>
      {open ? (
        <FormModal
          title="Add final due line"
          onClose={() => setOpen(false)}
          onSubmit={(values) => addFinalDueLineRequest(no, {
            dueType: String(values.dueType || 'UNCLEARED_ITEMS') as EmployeeExitFinalDueLine['due_type'],
            description: values.description ? String(values.description) : undefined,
            amountCents: Math.round(Number(values.amountCents || 0) * 100),
          })}
          submitLabel="Add"
          successTitle="Added"
        >
          <Field name="dueType" label="Type" type="select" options={DUE_TYPES} />
          <Field name="amountCents" label="Amount" type="currency" required />
          <Field name="description" label="Description" />
        </FormModal>
      ) : null}
    </>
  );
}

export function RemoveDueLineButton({ no, lineId, className = 'btn sm ghost' }: { no: string; lineId: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => removeFinalDueLineRequest(no, lineId), {
        confirm: { title: 'Remove this due line?', confirmLabel: 'Remove' }, successTitle: 'Removed',
      })}>
      {busy ? '…' : 'Remove'}
    </button>
  );
}

export function SubmitButton({ no, className = 'btn sm ghost' }: { no: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => submitExitRequest(no), {
        confirm: { title: 'Send this exit for approval?', message: 'Reason, date of notice and date of exit are required.', confirmLabel: 'Send for approval' },
        successTitle: (d) => (d.autoApproved ? 'Approved' : 'Sent for approval'),
      })}>
      {busy ? 'Working…' : 'Send for approval'}
    </button>
  );
}

export function CancelApprovalButton({ no, className = 'btn sm ghost' }: { no: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => cancelExitApprovalRequest(no), {
        confirm: { title: 'Recall this exit?', message: 'It goes back to Open so you can amend and resubmit it.', confirmLabel: 'Recall' },
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
      onClick={() => run(() => approveExitRequest(no), {
        confirm: { title: 'Approve this exit?', message: 'Every clearance section owner is emailed to clear the employee.', confirmLabel: 'Approve' },
        successTitle: 'Approved — clearance emails sent',
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
          title="Reject exit"
          onClose={() => setOpen(false)}
          onSubmit={(values) => rejectExitRequest(no, String(values.reason || ''))}
          submitLabel="Reject" submitClass="btn danger"
          successTitle="Rejected — back to Open" resultStyle="popup"
        >
          <Field name="reason" label="Reason" type="textarea" required />
        </FormModal>
      ) : null}
    </>
  );
}

export function ClearSectionButton({ no, sectionId, className = 'btn sm' }: { no: string; sectionId: number; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Clear</button>
      {open ? (
        <FormModal
          title="Clear this section"
          onClose={() => setOpen(false)}
          onSubmit={(values) => clearExitSectionRequest(no, sectionId, String(values.remarks || ''))}
          submitLabel="Clear"
          successTitle="Section cleared"
          successDetail={(d) => (d.fullyCleared ? 'Every section is now clear — the employee moves to Pending Final Payment' : 'Other sections are still pending')}
        >
          <Field name="remarks" label="Remarks" type="textarea" />
        </FormModal>
      ) : null}
    </>
  );
}
