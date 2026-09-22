'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { LockedEmployee } from '@/components/ui/locked-employee';
import { useRunAction } from '@/components/ui/run-action';
import { LineRowsFormButton, LineRowsPanel, type LineColumn } from '@/components/ui/line-rows-editor';
import {
  requestLeavePlan, setPlanLinesRequest, deleteLeavePlanRequest, submitLeavePlanRequest,
  cancelLeavePlanApprovalRequest, approveLeavePlanRequest, rejectLeavePlanRequest,
} from '@/app/actions/leavePlans';
import type { EmployeeView, HrLeavePlanLine } from '@/lib/types';

type EmployeeLite = Pick<EmployeeView, 'id' | 'employee_no' | 'first_name' | 'last_name'>;

export function NewPlanButton({ employees, self, viewBase = '/leave-plans/view' }: {
  employees: EmployeeLite[];
  /** Employee Self Service: the plan is this employee's own — no picker. */
  self?: EmployeeLite | null;
  viewBase?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState(self ? String(self.id) : '');
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>New leave plan</button>
      {open ? (
        <FormModal
          title="New leave plan"
          onClose={() => setOpen(false)}
          onSubmit={async () => {
            const res = await requestLeavePlan(Number(employeeId));
            if (res.ok) router.push(`${viewBase}/${res.data.no}`);
            return res;
          }}
          submitLabel="Start plan"
          successTitle="Leave plan created"
          successDetail={(d) => `${d.no} — add planned leave windows next`} redirectTo={(d) => `/leave-plans/view/${d.no}`}
        >
          {self ? <LockedEmployee employee={self} hint="The plan is your own." /> : (
            <SearchableSelect id="f_employeeId" name="employeeId" label="Employee" required
              items={employees} getValue={(e) => String(e.id)} getLabel={(e) => `${e.employee_no} — ${e.first_name} ${e.last_name}`}
              value={employeeId} onChange={setEmployeeId} placeholder="Search employee…" />
          )}
        </FormModal>
      ) : null}
    </>
  );
}

type Row = Omit<HrLeavePlanLine, 'id' | 'plan_no' | 'days'>;
const PLAN_COLUMNS: LineColumn<Row>[] = [
  { key: 'start_date', label: 'Start date', type: 'date' },
  { key: 'end_date', label: 'End date', type: 'date' },
];
const emptyLine = (): Row => ({ start_date: '', end_date: '' });

export function PlanLinesPanel({ no, lines, canManage }: { no: string; lines: HrLeavePlanLine[]; canManage: boolean }) {
  const displayColumns: LineColumn<HrLeavePlanLine>[] = [
    { key: 'start_date', label: 'Start date' }, { key: 'end_date', label: 'End date' }, { key: 'days', label: 'Days' },
  ];
  return (
    <LineRowsPanel title="Planned leave windows" rows={lines} columns={displayColumns} icon="🗓"
      manageButton={canManage ? (
        <LineRowsFormButton title="Planned leave windows" rows={lines} columns={PLAN_COLUMNS} emptyRow={emptyLine}
          onSave={(rows) => setPlanLinesRequest(no, rows.map((r) => ({ startDate: String(r.start_date), endDate: String(r.end_date) })))}
          className="btn sm ghost" successTitle="Saved">
          Manage
        </LineRowsFormButton>
      ) : null} />
  );
}

export function DeleteButton({ no, className = 'btn sm ghost' }: { no: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => deleteLeavePlanRequest(no), {
        confirm: { title: 'Delete this plan?', confirmLabel: 'Delete' }, successTitle: 'Deleted',
        redirectTo: '/leave-plans',
      })}>
      {busy ? 'Working…' : 'Delete'}
    </button>
  );
}

export function SubmitButton({ no, className = 'btn sm ghost' }: { no: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => submitLeavePlanRequest(no), {
        confirm: { title: 'Send this plan for approval?', confirmLabel: 'Send for approval' },
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
      onClick={() => run(() => cancelLeavePlanApprovalRequest(no), {
        confirm: { title: 'Recall this plan?', confirmLabel: 'Recall' }, successTitle: 'Recalled — back to Open',
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
      onClick={() => run(() => approveLeavePlanRequest(no), {
        confirm: { title: 'Approve this plan?', confirmLabel: 'Approve' }, successTitle: 'Approved',
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
          title="Reject plan"
          onClose={() => setOpen(false)}
          onSubmit={(values) => rejectLeavePlanRequest(no, String(values.reason || ''))}
          submitLabel="Reject" submitClass="btn danger"
          successTitle="Rejected — back to Open" resultStyle="popup"
        >
          <Field name="reason" label="Reason" type="textarea" required />
        </FormModal>
      ) : null}
    </>
  );
}
