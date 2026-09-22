'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FilePicker } from '@/components/ui/uploader';
import { useToast } from '@/components/ui/toast';
import { saveEmployeeImage, saveEmployeeEditImage } from '@/app/actions/media';
import { initials } from '@/lib/format';
import type { UploadedFile } from '@/lib/types';

/**
 * The Employee Card's identity strip — passport photo and specimen signature, side by side.
 * Same upload-immediately pattern as the member 360 photo and the User Setup signature: the
 * image goes to Cloudinary the moment it is chosen and the record it belongs to already exists,
 * so there is no form to save. Like the rest of the card, the slots are editable only while the
 * record is New — the server refuses otherwise (lib/employees.ts setEmployeeImage). Given
 * `editRequestNo`, the same strip edits the *proposed* images on an Employee Editing request
 * instead, which reach the employee when the request is applied.
 */
export function EmployeeIdentityStrip({ employeeId, editRequestNo, name, photoSrc, signatureSrc, canEdit, mediaEnabled }: {
  employeeId: number;
  /** When set, uploads go onto this Employee Editing request rather than the live employee. */
  editRequestNo?: string;
  name: string;
  /** Delivery URLs resolved server-side, or null when nothing is on file. */
  photoSrc: string | null;
  signatureSrc: string | null;
  canEdit: boolean;
  /** False when CLOUDINARY_* is not configured — uploads cannot work at all. */
  mediaEnabled: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<'photo' | 'signature' | null>(null);

  const apply = async (kind: 'photo' | 'signature', file: UploadedFile | null) => {
    setBusy(kind);
    try {
      const res = editRequestNo ? await saveEmployeeEditImage(editRequestNo, kind, file) : await saveEmployeeImage(employeeId, kind, file);
      const what = kind === 'photo' ? 'Photo' : 'Signature';
      if (!res.ok) { toast(`Could not update the ${what.toLowerCase()}`, res.error, 'err'); return; }
      toast(file ? `${what} updated` : `${what} removed`, name, 'ok');
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="biometric-grid">
      <div className="biometric-slot">
        <div className="biometric-thumb" style={{ width: 96, height: 96, borderRadius: '50%' }}>
          {photoSrc
            ? <img src={photoSrc} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
            : <div className="avatar" aria-hidden="true" style={{ width: 84, height: 84, fontSize: 26 }}>{initials(name)}</div>}
        </div>
        <div className="biometric-info">
          <div className="biometric-label">Passport photo</div>
          <div className="tiny">Head-and-shoulders, plain background. Shown on the staff list and the employee's self-service pages.</div>
          {canEdit && mediaEnabled ? (
            <div className="inline" style={{ gap: 6 }}>
              <FilePicker kind="employee_photo" accept="image/*" label={photoSrc ? 'Replace photo' : 'Upload photo'}
                disabled={busy !== null} onUploaded={(f) => apply('photo', f)} />
              {photoSrc ? (
                <button type="button" className="btn ghost sm" disabled={busy !== null} onClick={() => apply('photo', null)}>Remove</button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="biometric-slot">
        <div className="biometric-thumb" style={{ width: 180, height: 64 }}>
          {signatureSrc
            ? <img src={signatureSrc} alt={`${name} signature`} />
            : <div className="biometric-placeholder" aria-hidden="true">No signature on file</div>}
        </div>
        <div className="biometric-info">
          <div className="biometric-label">Specimen signature</div>
          <div className="tiny">A scan of the handwritten signature on white paper, cropped close — the specimen HR and Finance compare against on the employee's own documents.</div>
          {canEdit && mediaEnabled ? (
            <div className="inline" style={{ gap: 6 }}>
              <FilePicker kind="employee_signature" accept="image/*" label={signatureSrc ? 'Replace signature' : 'Upload signature'}
                disabled={busy !== null} onUploaded={(f) => apply('signature', f)} />
              {signatureSrc ? (
                <button type="button" className="btn ghost sm" disabled={busy !== null} onClick={() => apply('signature', null)}>Remove</button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {!mediaEnabled && canEdit ? (
        <div className="note">Media storage is not configured — set the <code>CLOUDINARY_*</code> environment variables to enable uploads.</div>
      ) : null}
    </div>
  );
}
