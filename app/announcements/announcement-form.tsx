'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { useRunAction } from '@/components/ui/run-action';
import { saveAnnouncementRequest, deleteAnnouncementRequest } from '@/app/actions/academics';
import { ANNOUNCEMENT_AUDIENCES as AUDIENCES } from '@/lib/constants';
import type { AnnouncementAudience, AnnouncementView, GradeLevel, StreamView } from '@/lib/types';

/** Write or edit a notice. In the Teacher Portal (`viaPortal`) the audience is fixed to one of the teacher's own classes. */
export function AnnouncementFormButton({ announcement, grades, streams, viaPortal = false, className = 'btn', children }: {
  announcement?: AnnouncementView | null; grades: GradeLevel[]; streams: StreamView[]; viaPortal?: boolean; className?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [audience, setAudience] = useState<AnnouncementAudience>(viaPortal ? 'STREAM' : announcement?.audience ?? 'ALL');
  const toLocal = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal title={announcement ? 'Edit announcement' : 'New announcement'} wide onClose={() => setOpen(false)}
          onSubmit={(v) => saveAnnouncementRequest({ ...v, id: announcement?.id ?? '', published_at: v.published_at ? `${v.published_at}T00:00:00.000Z` : '', expires_at: v.expires_at ? `${v.expires_at}T23:59:59.000Z` : '' }, viaPortal)}
          submitLabel={announcement ? 'Save' : 'Publish'} successTitle={announcement ? 'Announcement updated' : 'Announcement published'}>
          <Field name="title" label="Title" required defaultValue={announcement?.title} />
          <Field name="body" label="Message" type="textarea" rows={5} required defaultValue={announcement?.body} />
          <div className="grid g3">
            {viaPortal ? <input type="hidden" name="audience" value="STREAM" /> : (
              <Field name="audience" label="Audience" type="select" required defaultValue={audience} options={AUDIENCES} onChange={(e) => setAudience(e.target.value as AnnouncementAudience)} />
            )}
            {audience === 'GRADE_LEVEL' ? <Field name="grade_level_id" label="Grade" type="select" required defaultValue={announcement?.grade_level_id ?? grades[0]?.id ?? ''} options={grades.map((g) => ({ value: g.id, label: g.name }))} /> : null}
            {audience === 'STREAM' ? <Field name="stream_id" label="Class" type="select" required defaultValue={announcement?.stream_id ?? streams[0]?.id ?? ''} options={streams.map((s) => ({ value: s.id, label: `${s.grade_level_name} ${s.name}` }))} /> : null}
          </div>
          <div className="grid g2">
            <Field name="published_at" label="Publish on" type="date" defaultValue={toLocal(announcement?.published_at)} hint="Blank = now" />
            <Field name="expires_at" label="Expires" type="date" defaultValue={toLocal(announcement?.expires_at)} hint="Blank = stays up" />
          </div>
        </FormModal>
      ) : null}
    </>
  );
}

export function DeleteAnnouncementButton({ id }: { id: number }) {
  const { run, busy } = useRunAction();
  return <button type="button" className="btn sm ghost" disabled={busy} onClick={() => run(() => deleteAnnouncementRequest(id), { confirm: { title: 'Delete this announcement?', confirmLabel: 'Delete', danger: true }, successTitle: 'Announcement deleted' })}>{busy ? '…' : 'Delete'}</button>;
}
