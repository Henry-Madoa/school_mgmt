'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { StudentSelect, type StudentSelectOption } from '@/components/ui/student-select';
import { useRunAction } from '@/components/ui/run-action';
import {
  requestStkPaymentRequest, allocateMpesaRequest, postMpesaRequest, cancelMpesaRequest, queryStkRequest, registerC2bUrlsRequest,
} from '@/app/actions/mpesa';

export function RequestPaymentButton({ students, configured, initialStudentId, initialPhone }: {
  students: StudentSelectOption[]; configured: boolean; initialStudentId?: number | null; initialPhone?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [studentId, setStudentId] = useState(initialStudentId ? String(initialStudentId) : '');
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)} disabled={!configured} title={configured ? undefined : 'M-Pesa is not configured on this server'}>Request payment</button>
      {open ? (
        <FormModal title="Request an M-Pesa fee payment" onClose={() => setOpen(false)} onSubmit={requestStkPaymentRequest}
          submitLabel="Send to phone" successTitle="Payment request sent" successDetail={(d) => d.customerMessage} redirectTo={(d) => `/mpesa/view/${d.id}`}>
          <StudentSelect id="f_student" name="studentId" students={students} value={studentId} onChange={setStudentId} required />
          <div className="grid g2">
            <Field name="phone" label="Phone" required defaultValue={initialPhone ?? ''} hint="The guardian's handset that receives the prompt" />
            <Field name="amount" label="Amount" type="currency" required hint="Whole shillings" />
          </div>
          <Field name="description" label="Shown on the phone" defaultValue="School fees" />
        </FormModal>
      ) : null}
    </>
  );
}

export function AllocateForm({ id, students, initialStudentId }: { id: number; students: StudentSelectOption[]; initialStudentId: number | null }) {
  const [studentId, setStudentId] = useState(initialStudentId ? String(initialStudentId) : '');
  return (
    <FormModal inline title="Allocate this payment" onClose={() => undefined} onSubmit={(v) => allocateMpesaRequest(id, v)}
      submitLabel="Allocate and post" successTitle={(d) => (d.ok ? 'Posted' : 'Allocated — posting refused')} successDetail={(d) => d.error ?? 'The payment has been receipted on the student’s fee account'} resultStyle="popup">
      <StudentSelect id="f_alloc_student" name="studentId" students={students} value={studentId} onChange={setStudentId} required />
    </FormModal>
  );
}

export function PostNowButton({ id, className = 'btn sm' }: { id: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => postMpesaRequest(id), { successTitle: (d) => (d.ok ? 'Posted' : 'Posting refused'), successDetail: (d) => d.error ?? 'Receipted on the fee account' })}>
      {busy ? 'Posting…' : 'Post now'}
    </button>
  );
}

export function CheckStatusButton({ id, className = 'btn sm ghost' }: { id: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => queryStkRequest(id), { successTitle: (d) => `M-Pesa says: ${d.status.toLowerCase()}`, successDetail: (d) => d.desc })}>
      {busy ? 'Asking…' : 'Check status'}
    </button>
  );
}

export function CancelMpesaButton({ id, className = 'btn sm ghost' }: { id: number; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Cancel</button>
      {open ? (
        <FormModal title="Cancel this M-Pesa record" onClose={() => setOpen(false)} onSubmit={(v) => cancelMpesaRequest(id, String(v.reason || ''))}
          submitLabel="Cancel record" submitClass="btn danger" successTitle="Cancelled" resultStyle="popup">
          <div className="note">Only the record here is cancelled — no money moves. Use this for a duplicate or a payment refunded outside the system.</div>
          <Field name="reason" label="Reason" type="textarea" required />
        </FormModal>
      ) : null}
    </>
  );
}

export function RegisterUrlsButton({ className = 'btn sm ghost' }: { className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => registerC2bUrlsRequest(), { confirm: { title: 'Register the paybill callback URLs with Safaricom?', message: 'Do this once after deployment, and again if the public URL changes.', confirmLabel: 'Register' }, successTitle: 'Registered', successDetail: (d) => d.description })}>
      {busy ? 'Registering…' : 'Register paybill URLs'}
    </button>
  );
}
