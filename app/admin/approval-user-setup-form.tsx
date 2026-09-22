'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { saveApprovalUserSetupRow } from '@/app/actions/workflows';
import type { ApprovalUserSetupRow } from '@/lib/types';

type EmployeeOption = { id: number; employee_no: string; first_name: string; last_name: string };

export function ApprovalUserSetupFormButton({ row, users, employees, className = 'btn', children }: {
  row: ApprovalUserSetupRow;
  users: ApprovalUserSetupRow[];
  /** Employees a login can be matched to (AL User Setup "Employee No."). */
  employees: EmployeeOption[];
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const others = users.filter((u) => u.user_id !== row.user_id);
  const [approverId, setApproverId] = useState(String(row.approver_id ?? ''));
  const [substituteId, setSubstituteId] = useState(String(row.substitute_id ?? ''));
  const [employeeId, setEmployeeId] = useState(String(row.employee_id ?? ''));
  // An employee already matched to another login is not offered — the link is one-to-one.
  const linkedElsewhere = new Set(users.filter((u) => u.user_id !== row.user_id && u.employee_id).map((u) => u.employee_id));
  const employeeChoices = employees.filter((e) => !linkedElsewhere.has(e.id));

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          title={`Approval setup — ${row.full_name}`}
          onClose={() => setOpen(false)}
          onSubmit={(values) => saveApprovalUserSetupRow(row.user_id, values)}
          submitLabel="Save"
          successTitle="Approval setup saved"
        >
          <div className="grid g2">
            <SearchableSelect name="approver_id" label="Approver"
              hint="Resolved for this user's requests when a workflow step is set to &quot;Requester's approver&quot;"
              items={others} getValue={(u) => String(u.user_id)} getLabel={(u) => u.full_name}
              value={approverId} onChange={setApproverId} placeholder="Search user…" emptyText="No matching users" />
            <SearchableSelect name="substitute_id" label="Substitute"
              hint="Also eligible to act on anything routed to this user"
              items={others} getValue={(u) => String(u.user_id)} getLabel={(u) => u.full_name}
              value={substituteId} onChange={setSubstituteId} placeholder="Search user…" emptyText="No matching users" />
          </div>
          <SearchableSelect name="employee_id" label="Employee No."
            hint="Which employee this login is — Employee Self Service scopes its lists to this employee and stamps new leave, imprest, petty cash and requisition documents with them and their dimensions. One login per employee."
            items={employeeChoices} getValue={(e) => String(e.id)} getLabel={(e) => `${e.employee_no} — ${e.first_name} ${e.last_name}`}
            value={employeeId} onChange={setEmployeeId} placeholder="Search employee…" emptyText="No matching employees" />
          <Field name="is_approval_administrator" label="Approval Administrator"
            type="checkbox" defaultValue={row.is_approval_administrator}
            hint="Fallback approver when a &quot;Requester's approver&quot; step can't resolve one" />
          <Field name="can_reverse_journal" label="Can Reverse Journal"
            type="checkbox" defaultValue={row.can_reverse_journal}
            hint="Required to reverse any posted transaction — GL journal, savings, and so on — on top of that module's own reversal permission" />

          <h4 className="section-title">Posting setup</h4>
          <div className="card-sub">
            This user's own Allow Posting window — blank leaves the company-wide Posting Dates
            (Admin Centre → Company Information) in force for them. The two time fields only
            refine the boundary dates themselves: on the From date they must post at/after that
            time, on the To date at/before it — any date strictly between the two is never
            time-restricted.
          </div>
          <div className="grid g2">
            <Field name="allow_posting_from" label="Allow posting from" type="date"
              defaultValue={row.allow_posting_from ?? ''} />
            <Field name="allow_posting_to" label="Allow posting to" type="date"
              defaultValue={row.allow_posting_to ?? ''} />
            <Field name="allow_posting_from_time" label="From time" type="time"
              defaultValue={row.allow_posting_from_time ?? ''} />
            <Field name="allow_posting_to_time" label="To time" type="time"
              defaultValue={row.allow_posting_to_time ?? ''} />
          </div>
        </FormModal>
      ) : null}
    </>
  );
}
