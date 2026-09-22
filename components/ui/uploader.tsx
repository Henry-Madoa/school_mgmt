'use client';

import { useCallback, useRef, useState } from 'react';
import { requestUploadSignature } from '@/app/actions/media';
import type { AttachmentEntity, UploadedFile, UploadSignature } from '@/lib/types';

type UploadKind =
  | 'logo' | 'photo' | 'attachment' | 'user_signature' | 'employee_photo' | 'employee_signature' | 'ceo_signature';

const prettyBytes = (n: number) =>
  n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

/** Longest edge, in pixels, that each kind is downscaled to before upload. */
const MAX_DIMENSION: Record<UploadKind, number> = {
  logo: 1024,
  ceo_signature: 1200,
  photo: 1600,
  attachment: 1920,
  user_signature: 1200,
  employee_photo: 1600,
  employee_signature: 1200,
};

/** Below this, re-encoding costs more CPU than it saves in transfer time. */
const SKIP_COMPRESSION_BELOW_BYTES = 400_000;

/**
 * Downscale and re-encode an oversized image in the browser before it goes
 * anywhere near the network.
 *
 * Camera and phone-scan originals routinely arrive at 8-12 MB; nothing here
 * needs more than a few hundred KB to be legible, and the upload time is
 * dominated by bytes on the wire, not server processing. GIF and SVG are left
 * alone (animation / vector data a canvas would flatten or blow up), and any
 * canvas or codec failure falls back to the original file untouched.
 */
async function compressImage(file: File, maxDimension: number): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') {
    return file;
  }
  if (file.size <= SKIP_COMPRESSION_BELOW_BYTES) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1) {
      bitmap.close();
      return file;
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) { bitmap.close(); return file; }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    // PNG keeps transparency (logos); everything else re-encodes as JPEG,
    // which is far smaller than PNG for photographic content.
    const outType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, outType, outType === 'image/jpeg' ? 0.82 : undefined));
    if (!blob || blob.size >= file.size) return file;

    const ext = outType === 'image/png' ? 'png' : 'jpg';
    const name = file.name.replace(/\.\w+$/, '') + '.' + ext;
    return new File([blob], name, { type: outType });
  } catch {
    return file;
  }
}

/**
 * Posts a file straight from the browser to Cloudinary.
 *
 * The server signs the request but never sees the bytes, so a 10 MB scan does
 * not have to fit through a Server Action. XHR rather than fetch, purely
 * because it reports upload progress and fetch does not.
 */
function putToCloudinary(
  file: File,
  sig: UploadSignature,
  onProgress: (pct: number) => void,
): Promise<UploadedFile> {
  return new Promise((resolve, reject) => {
    const body = new FormData();
    body.append('file', file);
    body.append('api_key', sig.apiKey);
    body.append('timestamp', String(sig.timestamp));
    body.append('folder', sig.folder);
    body.append('signature', sig.signature);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${sig.cloudName}/${sig.resourceType}/upload`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let payload: {
        public_id?: string; original_filename?: string; resource_type?: string;
        error?: { message?: string };
      } = {};
      try { payload = JSON.parse(xhr.responseText); } catch { /* non-JSON error body */ }
      if (xhr.status >= 200 && xhr.status < 300 && payload.public_id) {
        resolve({
          publicId: payload.public_id,
          originalFilename: payload.original_filename || file.name,
          resourceType: payload.resource_type,
        });
      } else {
        reject(new Error(payload.error?.message || `Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('Could not reach media storage'));
    xhr.send(body);
  });
}

export interface UseUploadResult {
  upload: (file: File) => Promise<UploadedFile | null>;
  busy: boolean;
  progress: number;
  error: string;
  clearError: () => void;
}

/** Signature -> validate -> direct upload. Errors are returned, never thrown. */
function useUpload(kind: UploadKind, entity?: AttachmentEntity): UseUploadResult {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  const upload = useCallback(async (file: File): Promise<UploadedFile | null> => {
    setBusy(true);
    setError('');
    setProgress(0);
    try {
      const signed = await requestUploadSignature(kind, entity);
      if (!signed.ok) { setError(signed.error); return null; }
      const sig = signed.data;

      const prepared = await compressImage(file, MAX_DIMENSION[kind]);

      // Checked here for a fast, clear message; Cloudinary's own upload preset
      // remains the authority once the file leaves the browser.
      if (prepared.size > sig.maxBytes) {
        setError(`That file is ${prettyBytes(prepared.size)}. The limit is ${prettyBytes(sig.maxBytes)}.`);
        return null;
      }
      if (sig.accepted.length && !sig.accepted.includes(prepared.type)) {
        setError(`${prepared.type || 'That file type'} is not accepted here.`);
        return null;
      }

      return await putToCloudinary(prepared, sig, setProgress);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
      return null;
    } finally {
      setBusy(false);
    }
  }, [kind, entity]);

  return { upload, busy, progress, error, clearError: () => setError('') };
}

export interface FilePickerProps {
  kind: UploadKind;
  entity?: AttachmentEntity;
  accept?: string;
  label?: string;
  disabled?: boolean;
  onUploaded: (file: UploadedFile) => void | Promise<void>;
}

/** A file input plus progress and error reporting. */
export function FilePicker({
  kind, entity, accept, label = 'Choose file', disabled, onUploaded,
}: FilePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { upload, busy, progress, error } = useUpload(kind, entity);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    const uploaded = await upload(file);
    // Reset so re-selecting the same file still fires a change event.
    if (inputRef.current) inputRef.current.value = '';
    if (uploaded) await onUploaded(uploaded);
  };

  return (
    <div className="uploader">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        disabled={disabled || busy}
        aria-label={label}
        onChange={(e) => pick(e.target.files?.[0])}
      />
      {busy ? (
        <div className="upload-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div className="bar" style={{ width: `${progress}%` }} />
          <span>{progress}%</span>
        </div>
      ) : null}
      {error ? <div className="upload-error">{error}</div> : null}
    </div>
  );
}
