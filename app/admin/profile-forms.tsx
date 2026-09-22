'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { saveProfileRequest, deleteProfileRequest } from '@/app/actions/admin';
import type { Profile } from '@/lib/types';

const ROLE_CENTRES = [
  { value: 'SUPER', label: 'Super' },
  { value: 'SCHOOL_ADMIN', label: 'School Administration' },
  { value: 'TEACHER', label: 'Teacher Portal' },
  { value: 'STUDENT_PARENT', label: 'Student / Parent Portal' },
  { value: 'FINANCE_MANAGER', label: 'Finance Manager' },
  { value: 'ACCOUNTANT', label: 'Accountant' },
  { value: 'HR_PAYROLL', label: 'HR & Payroll' },
  { value: 'SELF_SERVICE', label: 'Employee Self Service' },
];

export function ProfileFormButton({ profile, className = 'btn', children }: {
  profile?: Profile | null; className?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const p = profile ?? null;
  const locked = !!p?.is_system;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          title={p ? `Edit ${p.name}` : 'New Role Centre profile'}
          onClose={() => setOpen(false)}
          onSubmit={(v) => saveProfileRequest(p?.id ?? null, v)}
          submitLabel={p ? 'Save' : 'Create'} successTitle="Saved"
        >
          <div className="grid g2">
            <Field name="code" label="Code" required uppercase defaultValue={p?.code} disabled={!!p}
              hint={p ? undefined : 'A short identifier, e.g. BRANCH-OPS'} />
            <Field name="roleCentre" label="Role Centre (dashboard)" type="select"
              defaultValue={p?.role_centre ?? 'SUPER'} options={ROLE_CENTRES} disabled={locked}
              hint={locked ? 'Locked for a built-in profile' : 'Which analytics dashboard this profile lands on'} />
          </div>
          <Field name="name" label="Name" required defaultValue={p?.name ?? ''} />
          <Field name="description" label="Description" defaultValue={p?.description ?? ''} />
          <div className="grid g2">
            <Field name="icon" label="Icon (emoji)" defaultValue={p?.icon ?? ''} maxLength={4} />
            <Field name="sort" label="Sort order" type="number" defaultValue={String(p?.sort ?? 0)} />
          </div>
        </FormModal>
      ) : null}
    </>
  );
}

export function DeleteProfileButton({ code }: { code: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className="btn sm ghost danger" disabled={busy}
      onClick={async () => {
        if (!window.confirm(`Delete the ${code} profile? Users assigned to it fall back to their default Role Centre.`)) return;
        setBusy(true);
        const res = await deleteProfileRequest(code);
        setBusy(false);
        if (!res.ok) window.alert(res.error || 'Could not delete');
        else router.refresh();
      }}>
      {busy ? '…' : '×'}
    </button>
  );
}
