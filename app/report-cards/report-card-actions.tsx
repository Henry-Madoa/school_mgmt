'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Field, readForm } from '@/components/ui/field';
import { Toolbar, Spacer } from '@/components/ui/primitives';
import { useRunAction } from '@/components/ui/run-action';
import { useToast } from '@/components/ui/toast';
import { saveReportCardRequest, publishClassReportCardsRequest } from '@/app/actions/academics';
import type { ReportCard } from '@/lib/types';

/** Publishes every report card in a class for the term. */
export function PublishClassButton({ streamId, termId, className = 'btn' }: { streamId: number; termId: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy} onClick={() => run(() => publishClassReportCardsRequest(streamId, termId), {
      confirm: { title: 'Publish the class report cards?', message: 'Every Active student in the class gets their report card for this term on the Student / Parent portal. Remarks already saved are kept.', confirmLabel: 'Publish' },
      successTitle: 'Report cards published', successDetail: (d) => `${d.published} report card${d.published === 1 ? '' : 's'} now visible on the portal`,
    })}>{busy ? 'Publishing…' : 'Publish class report cards'}</button>
  );
}

/** The remarks on one student's card, with Save (draft) and Publish. */
export function ReportCardRemarksForm({ studentId, termId, card }: { studentId: number; termId: number; card: ReportCard | null }) {
  const router = useRouter();
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState<'save' | 'publish' | null>(null);
  const submit = async (publish: boolean) => {
    const form = formRef.current;
    if (!form) return;
    setBusy(publish ? 'publish' : 'save');
    try {
      const res = await saveReportCardRequest(studentId, termId, readForm(form), publish);
      if (!res.ok) { toast('Could not save', res.error, 'err'); return; }
      toast(publish ? 'Report card published' : 'Remarks saved', publish ? 'Now visible on the Student / Parent portal' : undefined, 'ok');
      router.refresh();
    } finally {
      setBusy(null);
    }
  };
  return (
    <form ref={formRef} onSubmit={(e) => e.preventDefault()}>
      <Field name="class_teacher_remarks" label="Class teacher's remarks" type="textarea" rows={3} defaultValue={card?.class_teacher_remarks} />
      <Field name="principal_remarks" label="Principal's remarks" type="textarea" rows={2} defaultValue={card?.principal_remarks} />
      <Toolbar>
        <Spacer />
        <button type="button" className="btn ghost" disabled={busy !== null} onClick={() => submit(false)}>{busy === 'save' ? 'Saving…' : 'Save remarks'}</button>
        <button type="button" className="btn" disabled={busy !== null} onClick={() => submit(true)}>{busy === 'publish' ? 'Publishing…' : card?.is_published ? 'Save & re-publish' : 'Save & publish'}</button>
      </Toolbar>
    </form>
  );
}
