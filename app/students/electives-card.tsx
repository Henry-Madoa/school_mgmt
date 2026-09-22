'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/toast';
import { setStudentElectivesRequest } from '@/app/actions/admissions';
import type { Subject } from '@/lib/types';

/**
 * The subjects a student takes: core subjects of the grade are fixed; electives are ticked here.
 * Marks entry and the report card follow this list, so an elective shows only for those who take it.
 */
export function ElectivesCard({ studentId, offered, taken, canEdit }: { studentId: number; offered: Subject[]; taken: number[]; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const core = offered.filter((s) => s.is_core);
  const electives = offered.filter((s) => !s.is_core);
  const [picked, setPicked] = useState<number[]>(taken.filter((id) => electives.some((e) => e.id === id)));
  const [busy, setBusy] = useState(false);
  const dirty = picked.length !== taken.filter((id) => electives.some((e) => e.id === id)).length || picked.some((id) => !taken.includes(id));
  const save = async () => {
    setBusy(true);
    try {
      const res = await setStudentElectivesRequest(studentId, picked);
      if (!res.ok) { toast('Could not save', res.error, 'err'); return; }
      toast('Subjects saved', `${core.length + res.data.saved} subjects this year`, 'ok');
      router.refresh();
    } finally { setBusy(false); }
  };
  return (
    <div className="card">
      <div className="card-head">
        <div><h3>Subjects</h3><div className="card-sub">{core.length} core · {picked.length} of {electives.length} electives</div></div>
        <div className="spacer" />
        {canEdit && electives.length ? <button type="button" className={`btn sm ${dirty ? '' : 'ghost'}`} disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : 'Save subjects'}</button> : null}
      </div>
      <div className="grid g2">
        <div>
          <div className="hint" style={{ marginBottom: 6 }}>Core — everyone in the grade</div>
          {core.length ? core.map((s) => <div key={s.id} className="tiny" style={{ marginBottom: 4 }}>✓ {s.name}</div>) : <div className="tiny muted-cell">No core subjects offered in this grade yet.</div>}
        </div>
        <div>
          <div className="hint" style={{ marginBottom: 6 }}>Electives — tick what this student takes</div>
          {electives.length ? electives.map((s) => (
            <div key={s.id} className="checkline">
              <input type="checkbox" id={`el_${s.id}`} checked={picked.includes(s.id)} disabled={!canEdit}
                onChange={(e) => setPicked(e.target.checked ? [...picked, s.id] : picked.filter((x) => x !== s.id))} />
              <label htmlFor={`el_${s.id}`}>{s.name}</label>
            </div>
          )) : <div className="tiny muted-cell">No electives in this grade — a subject becomes an elective by unticking “core” under Administration → Academics → Subjects.</div>}
        </div>
      </div>
    </div>
  );
}
