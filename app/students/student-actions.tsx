'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { FilePicker } from '@/components/ui/uploader';
import { useToast } from '@/components/ui/toast';
import { setStudentStatusRequest, placeStudentRequest } from '@/app/actions/students';
import { saveStudentPhoto } from '@/app/actions/media';
import { initials } from '@/lib/format';
import type { StreamView, StudentStatus, UploadedFile } from '@/lib/types';

const STATUS_LABEL: Record<StudentStatus, string> = {
  ACTIVE: 'Active', GRADUATED: 'Graduated', TRANSFERRED: 'Transferred out', SUSPENDED: 'Suspended', INACTIVE: 'Inactive',
};

/** Change the student's status with a reason — suspend, reinstate, graduate, transfer out. */
export function StudentStatusButton({ id, current, className = 'btn ghost' }: { id: number; current: StudentStatus; className?: string }) {
  const [open, setOpen] = useState(false);
  const options = (Object.keys(STATUS_LABEL) as StudentStatus[]).filter((s) => s !== current).map((s) => ({ value: s, label: STATUS_LABEL[s] }));
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Change status</button>
      {open ? (
        <FormModal title="Change student status" onClose={() => setOpen(false)}
          onSubmit={(v) => setStudentStatusRequest(id, String(v.status) as StudentStatus, String(v.reason ?? '').trim() || null)}
          submitLabel="Update" successTitle="Status updated" resultStyle="popup">
          <Field name="status" label="New status" type="select" required defaultValue={options[0]?.value} options={options} />
          <Field name="reason" label="Reason" type="textarea" rows={2} placeholder="Recorded on the student's audit trail" />
          <div className="note">A student who is not Active drops off class rosters and is skipped by fee invoice runs; the fee account and its balance stay as they are.</div>
        </FormModal>
      ) : null}
    </>
  );
}

/** Move the student to another class — this year's streams only. */
export function PlaceStudentButton({ id, streams, currentStreamId, className = 'btn ghost' }: { id: number; streams: StreamView[]; currentStreamId: number | null; className?: string }) {
  const [open, setOpen] = useState(false);
  const [streamId, setStreamId] = useState('');
  return (
    <>
      <button type="button" className={className} onClick={() => { setStreamId(''); setOpen(true); }}>{currentStreamId ? 'Move class' : 'Place in class'}</button>
      {open ? (
        <FormModal title={currentStreamId ? 'Move to another class' : 'Place in a class'} onClose={() => setOpen(false)}
          onSubmit={(v) => placeStudentRequest(id, Number(v.stream_id))} submitLabel="Place" successTitle="Student placed" resultStyle="popup">
          <SearchableSelect name="stream_id" label="Class" required items={streams.filter((s) => s.id !== currentStreamId)}
            getValue={(s) => String(s.id)} getLabel={(s) => `${s.grade_level_name} ${s.name} (${s.year_name})`}
            value={streamId} onChange={setStreamId} placeholder="Search grade / class…" emptyText="No other classes this year" />
          <div className="note">The current enrolment is closed and a new one opened for the target class; attendance and marks already on file stay with the term they were recorded in.</div>
        </FormModal>
      ) : null}
    </>
  );
}

/** The student's photo — uploaded straight to Cloudinary and saved the moment it is chosen. */
export function StudentPhoto({ studentId, name, photoSrc, canEdit, mediaEnabled }: {
  studentId: number; name: string; photoSrc: string | null; canEdit: boolean; mediaEnabled: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const apply = async (file: UploadedFile | null) => {
    setBusy(true);
    try {
      const res = await saveStudentPhoto(studentId, file);
      if (!res.ok) { toast('Could not update the photo', res.error, 'err'); return; }
      toast(file ? 'Photo updated' : 'Photo removed', name, 'ok');
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="inline" style={{ gap: 14, alignItems: 'center' }}>
      <div style={{ width: 96, height: 96, borderRadius: '50%', overflow: 'hidden', flex: '0 0 auto' }}>
        {photoSrc
          ? <img src={photoSrc} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <div className="avatar" aria-hidden="true" style={{ width: 96, height: 96, fontSize: 30 }}>{initials(name)}</div>}
      </div>
      {canEdit && mediaEnabled ? (
        <div className="inline" style={{ gap: 6 }}>
          <FilePicker kind="photo" accept="image/*" label={photoSrc ? 'Replace photo' : 'Upload photo'} disabled={busy} onUploaded={(f) => apply(f)} />
          {photoSrc ? <button type="button" className="btn ghost sm" disabled={busy} onClick={() => apply(null)}>Remove</button> : null}
        </div>
      ) : null}
      {!mediaEnabled && canEdit ? <div className="note">Media storage is not configured — set the <code>CLOUDINARY_*</code> variables to enable uploads.</div> : null}
    </div>
  );
}
