'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { markWhtRemittedRequest } from '@/app/actions/cashMgmt';

export function MarkRemittedButton({ no }: { no: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn sm" onClick={() => setOpen(true)}>Mark remitted</button>
      {open ? (
        <FormModal
          title={`Remit ${no} to KRA`} onClose={() => setOpen(false)}
          onSubmit={(v) => markWhtRemittedRequest(no, String(v.ref || ''))}
          submitLabel="Mark remitted" successTitle="Certificate marked remitted" resultStyle="popup"
        >
          <Field name="ref" label="Remittance reference (KRA payment slip / PRN)" required />
        </FormModal>
      ) : null}
    </>
  );
}
