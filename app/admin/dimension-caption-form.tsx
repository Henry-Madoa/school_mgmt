'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHead } from '@/components/ui/primitives';
import { Field, readForm } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { saveDimensionCaptions } from '@/app/actions/pool';

export function DimensionCaptionForm({ caption1, caption2 }: { caption1: string; caption2: string }) {
  const router = useRouter();
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const form = formRef.current;
    if (!form || !form.reportValidity()) return;
    setBusy(true);
    setError('');
    try {
      const values = readForm(form);
      const res = await saveDimensionCaptions(values);
      if (!res.ok) { setError(res.error || 'Could not save'); return; }
      toast('Captions updated', undefined, 'ok');
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHead title="Global Dimension Setup"
        sub="Rename these fields to match how your school uses them — the new labels appear everywhere the field is shown" />
      <form ref={formRef} onSubmit={(e) => e.preventDefault()}>
        <div className="grid g3">
          <Field name="global_dimension_1_caption" label="Global Dimension 1 Caption" defaultValue={caption1}
            required maxLength={60} />
          <Field name="global_dimension_2_caption" label="Global Dimension 2 Caption" defaultValue={caption2}
            required maxLength={60} />
        </div>
      </form>
      {error ? <div className="modal-error">{error}</div> : null}
      <div className="inline" style={{ marginTop: 'var(--sp)' }}>
        <button type="button" className="btn sm" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </Card>
  );
}
