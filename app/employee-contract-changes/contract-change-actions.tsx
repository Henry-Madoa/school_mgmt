'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useRunAction } from '@/components/ui/run-action';
import { today } from '@/lib/format';
import {
  requestContractChange, deleteContractChangeRequest, submitContractChangeRequest,
  cancelContractChangeApprovalRequest, approveContractChangeRequest, rejectContractChangeRequest,
} from '@/app/actions/employeeContractChanges';
import type { EmployeeContractChangeNature, EmployeeView, HrEmploymentContractType, HrJobGrade } from '@/lib/types';

type EmployeeLite = Pick<EmployeeView, 'id' | 'employee_no' | 'first_name' | 'last_name'>;

const NATURE_OPTIONS = [
  { value: 'NEW_CONTRACT', label: 'New Contract' },
  { value: 'RENEWAL', label: 'Contract Renewal' },
  { value: 'SALARY_INCREMENT', label: 'Salary Increment' },
];

export function NewContractChangeButton({ employees, contractTypes, grades }: {
  employees: EmployeeLite[]; contractTypes: HrEmploymentContractType[]; grades: HrJobGrade[];
}) {
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  const [nature, setNature] = useState<EmployeeContractChangeNature>('NEW_CONTRACT');
  const [contractTypeId, setContractTypeId] = useState('');
  const [gradeId, setGradeId] = useState('');

  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>New contract / salary change</button>
      {open ? (
        <FormModal
          title="New contract / salary change" wide
          onClose={() => setOpen(false)}
          onSubmit={requestContractChange}
          submitLabel="Save"
          successTitle="Request created"
          successDetail={(d) => `${d.no} saved — send it for approval when ready`} redirectTo={(d) => `/employee-contract-changes/view/${d.no}`}
        >
          <SearchableSelect id="f_employeeId" name="employeeId" label="Employee" required
            items={employees} getValue={(e) => String(e.id)} getLabel={(e) => `${e.employee_no} — ${e.first_name} ${e.last_name}`}
            value={employeeId} onChange={setEmployeeId} placeholder="Search employee…" />
          <Field name="nature" label="Nature of change" type="select" options={NATURE_OPTIONS}
            defaultValue={nature} onChange={(e) => setNature(e.target.value as EmployeeContractChangeNature)} />

          {nature !== 'SALARY_INCREMENT' ? (
            <>
              <SearchableSelect id="f_contractTypeId" name="contractTypeId" label="Employment contract type"
                items={contractTypes} getValue={(c) => String(c.id)} getLabel={(c) => c.name}
                value={contractTypeId} onChange={setContractTypeId} placeholder="Search contract type…" />
              <div className="grid g2">
                <Field name="proposedStartDate" label="Start date" type="date" required defaultValue={today()} />
                <Field name="proposedEndDate" label="End date" type="date" />
              </div>
            </>
          ) : null}

          <div className="grid g2">
            <Field name="proposedSalaryCents" label="Proposed salary" type="currency" required={nature === 'SALARY_INCREMENT'} />
            <SearchableSelect id="f_proposedGradeId" name="proposedGradeId" label="New job grade (optional)"
              items={grades} getValue={(g) => String(g.id)} getLabel={(g) => `${g.code} — ${g.name}`}
              value={gradeId} onChange={setGradeId} placeholder="Search grade…" />
          </div>
          <Field name="reason" label="Reason" type="textarea" />
        </FormModal>
      ) : null}
    </>
  );
}

export function DeleteButton({ no, className = 'btn sm ghost' }: { no: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => deleteContractChangeRequest(no), {
        confirm: { title: 'Delete this request?', message: 'Only an open request can be deleted.', confirmLabel: 'Delete' },
        successTitle: 'Deleted',
        redirectTo: '/employee-contract-changes',
      })}>
      {busy ? 'Working…' : 'Delete'}
    </button>
  );
}

export function SubmitButton({ no, className = 'btn sm ghost' }: { no: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => submitContractChangeRequest(no), {
        confirm: { title: 'Send this request for approval?', confirmLabel: 'Send for approval' },
        successTitle: (d) => (d.autoApproved ? 'Approved — applied' : 'Sent for approval'),
      })}>
      {busy ? 'Working…' : 'Send for approval'}
    </button>
  );
}

export function CancelApprovalButton({ no, className = 'btn sm ghost' }: { no: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => cancelContractChangeApprovalRequest(no), {
        confirm: { title: 'Recall this request?', message: 'It goes back to Open so you can amend and resubmit it.', confirmLabel: 'Recall' },
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
      onClick={() => run(() => approveContractChangeRequest(no), {
        confirm: { title: 'Approve this request?', message: 'It is applied to the employee immediately — a new contract row is written.', confirmLabel: 'Approve' },
        successTitle: 'Approved — applied',
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
          title="Reject request"
          onClose={() => setOpen(false)}
          onSubmit={(values) => rejectContractChangeRequest(no, String(values.reason || ''))}
          submitLabel="Reject" submitClass="btn danger"
          successTitle="Rejected — back to Open" resultStyle="popup"
        >
          <Field name="reason" label="Reason" type="textarea" required />
        </FormModal>
      ) : null}
    </>
  );
}
