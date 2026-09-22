'use client';

import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { useEditableCard } from '@/components/ui/editable-card';
import { useRunAction } from '@/components/ui/run-action';
import { updateGuardianRequest, deleteGuardianRequest } from '@/app/actions/students';
import { RELATIONSHIPS } from '@/lib/constants';
import type { Guardian } from '@/lib/types';

const OPTIONS = ['Mother', 'Father', 'Guardian', ...RELATIONSHIPS.filter((r) => r && !['Mother', 'Father', 'Guardian', 'Son', 'Daughter', 'Spouse'].includes(r))];

/** The inline editor on the guardian's Contact card. */
export function GuardianEditForm({ guardian }: { guardian: Guardian }) {
  const { close } = useEditableCard();
  return (
    <FormModal inline title="" onClose={close} onSubmit={(v) => updateGuardianRequest(guardian.id, v)} submitLabel="Save changes" successTitle="Guardian updated">
      <div className="grid g2">
        <Field name="full_name" label="Full name" required defaultValue={guardian.full_name} />
        <Field name="relationship" label="Relationship" type="select" defaultValue={guardian.relationship} options={OPTIONS.includes(guardian.relationship) ? OPTIONS : [guardian.relationship, ...OPTIONS]} />
      </div>
      <div className="grid g2">
        <Field name="phone" label="Phone" type="phone" required defaultValue={guardian.phone} hint="Receipts and fee reminders are sent here" />
        <Field name="email" label="Email" type="email" defaultValue={guardian.email} />
      </div>
      <div className="grid g2">
        <Field name="national_id" label="National ID" defaultValue={guardian.national_id} />
        <Field name="occupation" label="Occupation" defaultValue={guardian.occupation} />
      </div>
      <Field name="address" label="Address" defaultValue={guardian.address} />
    </FormModal>
  );
}

export function DeleteGuardianButton({ id, className = 'btn ghost' }: { id: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy} onClick={() => run(() => deleteGuardianRequest(id), {
      confirm: { title: 'Delete this guardian?', message: 'Only a guardian with no students linked can be removed.', confirmLabel: 'Delete', danger: true },
      successTitle: 'Guardian deleted', redirectTo: '/guardians',
    })}>{busy ? 'Deleting…' : 'Delete'}</button>
  );
}
