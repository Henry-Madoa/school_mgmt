'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/modal';
import { FilePicker } from '@/components/ui/uploader';
import { useToast } from '@/components/ui/toast';
import { saveUserSignature } from '@/app/actions/media';
import type { UploadedFile } from '@/lib/types';

/**
 * The signature slot on the User Setup card — the same upload-immediately pattern as a member's
 * biometric slot rather than a field inside a save-on-submit form, because the image goes to
 * Cloudinary the moment it is chosen and the record it belongs to already exists.
 *
 * Whatever is on file here is stamped onto a document printout wherever this user prepared,
 * approved or issued the document (lib/userSignatures.ts).
 */
export function UserSignatureButton({ userId, fullName, src, mediaEnabled, className = 'btn sm ghost' }: {
  userId: number;
  fullName: string;
  /** The delivery URL of the signature already on file, or null. */
  src: string | null;
  /** False when CLOUDINARY_* is not configured — uploads cannot work at all. */
  mediaEnabled: boolean;
  className?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const apply = async (file: UploadedFile | null) => {
    setBusy(true);
    try {
      const res = await saveUserSignature(userId, file);
      if (!res.ok) { toast('Could not update the signature', res.error, 'err'); return; }
      toast(file ? 'Signature updated' : 'Signature removed', undefined, 'ok');
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {src ? 'Change signature' : 'Add signature'}
      </button>
      {open ? (
        <Modal
          title={`Signature — ${fullName}`}
          onClose={() => setOpen(false)}
          footer={
            <>
              <button type="button" className="btn ghost" onClick={() => setOpen(false)} disabled={busy}>Close</button>
              {src ? (
                <button type="button" className="btn danger" disabled={busy} onClick={() => apply(null)}>
                  {busy ? 'Working…' : 'Remove signature'}
                </button>
              ) : null}
            </>
          }
        >
          {!mediaEnabled ? (
            <div className="note">
              Media storage is not configured. Set the <code>CLOUDINARY_*</code> environment variables to enable uploads.
            </div>
          ) : null}
          <div className="biometric-thumb" style={{ marginBottom: 'var(--sp)' }}>
            {src
              ? <img src={src} alt={`${fullName} signature`} />
              : <div className="biometric-placeholder" aria-hidden="true">No signature on file</div>}
          </div>
          <div className="hint" style={{ marginBottom: 'var(--sp)' }}>
            A scan or photograph of the handwritten signature, ideally on white paper and cropped
            close. It is printed at about 180 × 56 px on payment vouchers, receipts, WHT
            certificates and deposit slips wherever {fullName} prepared, approved or issued the
            document.
          </div>
          {mediaEnabled ? (
            <FilePicker
              kind="user_signature" accept="image/*" disabled={busy}
              label={src ? 'Upload a replacement' : 'Upload signature'}
              onUploaded={apply}
            />
          ) : null}
        </Modal>
      ) : null}
    </>
  );
}
