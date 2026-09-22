'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { useRunAction } from '@/components/ui/run-action';
import {
  createPayrollPeriodRequest, submitPayrollPeriodRequest, cancelPayrollPeriodApprovalRequest,
  approvePayrollPeriodRequest, rejectPayrollPeriodRequest, closePayrollPeriodRequest, reopenPayrollPeriodRequest,
} from '@/app/actions/payroll';

export function NewPeriodButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>New payroll period</button>
      {open ? (
        <FormModal
          title="New payroll period"
          onClose={() => setOpen(false)}
          onSubmit={createPayrollPeriodRequest}
          submitLabel="Create"
          successTitle="Payroll period created"
        >
          <Field name="periodName" label="Period name" required placeholder="e.g. 2026-09" />
          <div className="grid g2">
            <Field name="startDate" label="Start date" type="date" required />
            <Field name="endDate" label="End date" type="date" required />
          </div>
        </FormModal>
      ) : null}
    </>
  );
}

export function SubmitButton({ id, className = 'btn sm ghost' }: { id: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => submitPayrollPeriodRequest(id), {
        confirm: { title: 'Send this period for approval?', confirmLabel: 'Send for approval' },
        successTitle: (d) => (d.autoApproved ? 'Approved' : 'Sent for approval'),
      })}>
      {busy ? 'Working…' : 'Send for approval'}
    </button>
  );
}

export function CancelApprovalButton({ id, className = 'btn sm ghost' }: { id: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => cancelPayrollPeriodApprovalRequest(id), {
        confirm: { title: 'Recall this period?', confirmLabel: 'Recall' }, successTitle: 'Recalled — back to Open',
      })}>
      {busy ? 'Working…' : 'Cancel approval request'}
    </button>
  );
}

export function ReopenButton({ id, className = 'btn sm ghost' }: { id: number; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Reopen period</button>
      {open ? (
        <FormModal
          title="Reopen this payroll period?"
          onClose={() => setOpen(false)}
          onSubmit={(values) => reopenPayrollPeriodRequest(id, String(values.reason || ''))}
          submitLabel="Reopen"
          successTitle="Period reopened — back to Open"
        >
          <div className="note" style={{ marginBottom: 10 }}>
            The period goes back to Open: lines can be corrected and payroll re-run, and it must be sent for approval again
            before it can be closed. Nothing has been posted yet, so no journal is reversed.
          </div>
          <Field name="reason" label="Reason" required maxLength={200} placeholder="e.g. Transport allowance missing for two staff" />
        </FormModal>
      ) : null}
    </>
  );
}

export { DelegateButton } from '@/components/ui/delegate-button';

export function ApproveButton({ id, className = 'btn sm' }: { id: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => approvePayrollPeriodRequest(id), {
        confirm: { title: 'Approve this payroll period?', confirmLabel: 'Approve' }, successTitle: 'Approved',
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
          title="Reject payroll period"
          onClose={() => setOpen(false)}
          onSubmit={(values) => rejectPayrollPeriodRequest(id, String(values.reason || ''))}
          submitLabel="Reject" submitClass="btn danger"
          successTitle="Rejected — back to Open" resultStyle="popup"
        >
          <Field name="reason" label="Reason" type="textarea" required />
        </FormModal>
      ) : null}
    </>
  );
}

export function CloseButton({ id, next, className = 'btn' }: { id: number; next: { periodName: string; startDate: string; endDate: string }; className?: string }) {
  const [open, setOpen] = useState(false);
  const [override, setOverride] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Close period</button>
      {open ? (
        <FormModal
          title="Close payroll period" wide
          onClose={() => setOpen(false)}
          onSubmit={(values) => closePayrollPeriodRequest(id, values)}
          submitLabel="Close &amp; post"
          successTitle="Period closed"
          successDetail={(d) => `Journal ${d.journalNo} posted · ${d.nextPeriodName} opened`}
        >
          <div className="note" style={{ marginBottom: 10 }}>
            Posts the payroll journal, pays FOSA salaries and check-off loans, then closes this period and opens the next
            one automatically — the current period moved on by one month. This cannot be undone from here.
          </div>
          <div className="card inset" style={{ marginBottom: 10 }}>
            <div className="tiny" style={{ marginBottom: 4 }}>Next period (current + 1M)</div>
            <div><b>{next.periodName}</b> <span className="tiny">· {next.startDate} → {next.endDate}</span></div>
            <label className="tiny" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> Use a different name or dates
            </label>
          </div>
          {override ? (
            <>
              <Field name="periodName" label="Next period name" required defaultValue={next.periodName} />
              <div className="grid g2">
                <Field name="startDate" label="Next period start date" type="date" required defaultValue={next.startDate} />
                <Field name="endDate" label="Next period end date" type="date" required defaultValue={next.endDate} />
              </div>
            </>
          ) : null}
        </FormModal>
      ) : null}
    </>
  );
}
