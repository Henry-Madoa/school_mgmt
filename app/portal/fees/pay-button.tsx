'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { portalStkPaymentRequest } from '@/app/actions/mpesa';

/** "Pay now" — an M-Pesa STK push to the parent's phone; the receipt posts to the fee account when M-Pesa confirms. */
export function PayFeesButton({ studentId, phone, balance, paybill, admissionNo }: { studentId: number; phone: string | null; balance: number; paybill: string | null; admissionNo: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>Pay with M-Pesa</button>
      {open ? (
        <FormModal title="Pay school fees" onClose={() => setOpen(false)} onSubmit={(v) => portalStkPaymentRequest({ ...v, studentId })}
          submitLabel="Send request to my phone" successTitle="Payment request sent" resultStyle="popup"
          successDetail={(d) => `${d.customerMessage} Enter your M-Pesa PIN on the handset; the receipt appears on the statement once M-Pesa confirms.`}>
          <input type="hidden" name="studentId" value={studentId} />
          <div className="grid g2">
            <Field name="phone" label="M-Pesa phone" type="phone" required defaultValue={phone ?? ''} placeholder="07XX XXX XXX" />
            <Field name="amount" label="Amount (KES)" type="currency" required defaultValue={balance > 0 ? balance / 100 : ''} min={1} />
          </div>
          {paybill ? <div className="note">Or pay from your M-Pesa menu: Paybill <b>{paybill}</b>, account <b>{admissionNo}</b>.</div> : null}
        </FormModal>
      ) : null}
    </>
  );
}
