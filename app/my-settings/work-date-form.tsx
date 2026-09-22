'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/toast';
import { saveWorkDate } from '@/app/actions/mySettings';

/** BC's own "My Settings" Work Date field — a plain date input rather than the shared `Field`
 *  component, since the Save button lives right alongside it rather than inside a form the
 *  component's own conventions assume. */
export function WorkDateForm({ workDate, systemDate }: { workDate: string; systemDate: string }) {
  const router = useRouter();
  const toast = useToast();
  const [date, setDate] = useState(workDate);
  const [busy, setBusy] = useState(false);
  const usingSystemDate = workDate === systemDate;

  const save = async (next: string) => {
    setBusy(true);
    try {
      const res = await saveWorkDate(next);
      if (!res.ok) { toast('Could not save', res.error, 'err'); return; }
      setDate(res.data.workDate);
      toast(next ? 'Work date updated' : 'Reverted to the system date', undefined, 'ok');
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inline form-row" style={{ marginTop: 'calc(var(--sp)*1.5)' }}>
      <div className="field">
        <label htmlFor="f_workDate">Work date</label>
        <input id="f_workDate" type="date" value={date} disabled={busy}
          onChange={(e) => setDate(e.target.value)} />
      </div>
      <button type="button" className="btn" disabled={busy || date === workDate} onClick={() => save(date)}>
        {busy ? 'Saving…' : 'Save'}
      </button>
      {!usingSystemDate ? (
        <button type="button" className="btn ghost" disabled={busy} onClick={() => save('')}>
          Reset to system date
        </button>
      ) : null}
    </div>
  );
}
