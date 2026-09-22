'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { EmptyState, Pill, TableWrap } from '@/components/ui/primitives';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { FilePicker } from '@/components/ui/uploader';
import { useToast } from '@/components/ui/toast';
import { addAttachment, removeAttachment } from '@/app/actions/media';
import { ATTACHMENT_CATEGORIES } from '@/lib/constants';
import { formatBytes, formatDateTime } from '@/lib/format';
import type { Attachment, AttachmentEntity, UploadedFile } from '@/lib/types';

export interface AttachmentPanelProps {
  entity: AttachmentEntity;
  entityId: number;
  attachments: Attachment[];
  /** Whether this user may add or remove files. Viewing needs only READ. */
  canManage: boolean;
  mediaEnabled: boolean;
}

export function AttachmentPanel({
  entity, entityId, attachments, canManage, mediaEnabled,
}: AttachmentPanelProps) {
  const router = useRouter();
  const toast = useToast();
  const [category, setCategory] = useState(ATTACHMENT_CATEGORIES[0]);
  const [busy, setBusy] = useState(false);

  const attach = async (file: UploadedFile) => {
    setBusy(true);
    try {
      const res = await addAttachment(entity, entityId, file, category);
      if (!res.ok) { toast('Could not attach', res.error, 'err'); return; }
      toast('File attached', res.data.filename, 'ok');
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (a: Attachment) => {
    setBusy(true);
    try {
      const res = await removeAttachment(entity, entityId, a.id);
      if (!res.ok) { toast('Could not remove', res.error, 'err'); return; }
      toast('File removed', a.filename, 'ok');
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <CollapsibleCard
      title="Documents"
      sub={`${attachments.length} file${attachments.length === 1 ? '' : 's'} held against this record`}
    >
      {canManage ? (
        mediaEnabled ? (
          <div className="attach-add">
            <label className="field" style={{ margin: 0 }}>
              <span className="attach-label">Category</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)} disabled={busy}>
                {ATTACHMENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <FilePicker
              kind="attachment"
              entity={entity}
              accept="image/*,.pdf,.doc,.docx,.txt,.csv"
              label="Attach a document"
              disabled={busy}
              onUploaded={attach}
            />
          </div>
        ) : (
          <div className="note" style={{ marginBottom: 'var(--sp)' }}>
            Media storage is not configured. Set the <code>CLOUDINARY_*</code> environment variables to enable uploads.
          </div>
        )
      ) : null}

      {attachments.length ? (
        <TableWrap>
          <thead>
            <tr>
              <th>File</th><th>Category</th><th className="num">Size</th>
              <th>Uploaded</th><th>By</th><th className="num" />
            </tr>
          </thead>
          <tbody>
            {attachments.map((a) => (
              <tr key={a.id}>
                <td>
                  {/* Opens in a new tab; Cloudinary serves the original bytes. */}
                  <a href={a.url} target="_blank" rel="noopener noreferrer">{a.filename}</a>
                  {a.format ? <span className="tiny mono"> .{a.format}</span> : null}
                </td>
                <td>{a.category ? <Pill tone="info">{a.category}</Pill> : '—'}</td>
                <td className="num">{formatBytes(a.bytes)}</td>
                <td>{formatDateTime(a.uploaded_at)}</td>
                <td className="muted-cell">{a.uploaded_by}</td>
                <td className="num">
                  {canManage ? (
                    <button type="button" className="btn sm ghost" disabled={busy}
                      onClick={() => remove(a)}>
                      Remove
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : (
        <EmptyState icon="📎" title="No documents attached"
          sub={canManage ? 'Attach KYC papers, payslips or security documents' : undefined} />
      )}
    </CollapsibleCard>
  );
}
