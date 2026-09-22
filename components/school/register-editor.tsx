'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Toolbar, Spacer } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { markRegisterRequest, type RegisterDraft } from '@/app/actions/academics';
import type { AttendanceRecord, AttendanceStatus, StudentListRow } from '@/lib/types';

const STATUSES: { value: AttendanceStatus; label: string; short: string }[] = [
  { value: 'PRESENT', label: 'Present', short: 'P' }, { value: 'ABSENT', label: 'Absent', short: 'A' },
  { value: 'LATE', label: 'Late', short: 'L' }, { value: 'EXCUSED', label: 'Excused', short: 'E' },
];

/**
 * The day's register for a class — one row per student, a four-way status toggle and a remark.
 * Everyone starts Present (or as already marked); the teacher only touches the exceptions.
 * Used by the Attendance screen and the Teacher Portal (`viaPortal` picks the permission).
 */
export function RegisterEditor({ streamId, date, roster, existing, viaPortal = false, readOnly = false }: {
  streamId: number; date: string; roster: StudentListRow[]; existing: AttendanceRecord[]; viaPortal?: boolean; readOnly?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const byStudent = new Map(existing.map((r) => [r.student_id, r]));
  const [rows, setRows] = useState<RegisterDraft[]>(roster.map((s) => ({ studentId: s.id, status: byStudent.get(s.id)?.status ?? 'PRESENT', remarks: byStudent.get(s.id)?.remarks ?? '' })));
  const [busy, setBusy] = useState(false);
  const set = (i: number, patch: Partial<RegisterDraft>) => setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const counts = STATUSES.map((s) => ({ ...s, n: rows.filter((r) => r.status === s.value).length }));

  const save = async () => {
    setBusy(true);
    try {
      const res = await markRegisterRequest(streamId, date, rows, viaPortal);
      if (!res.ok) { toast('Could not save the register', res.error, 'err'); return; }
      toast('Register saved', `${res.data.marked} student${res.data.marked === 1 ? '' : 's'} marked for ${date}`, 'ok');
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="inline" style={{ gap: 12, marginBottom: 8 }}>
        {counts.map((c) => <span key={c.value} className="tiny"><b>{c.n}</b> {c.label.toLowerCase()}</span>)}
        {!readOnly ? <button type="button" className="btn sm ghost" onClick={() => setRows(rows.map((r) => ({ ...r, status: 'PRESENT' })))}>All present</button> : null}
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Adm. No.</th><th>Student</th><th>Status</th><th>Remarks</th></tr></thead>
          <tbody>
            {roster.map((s, i) => (
              <tr key={s.id} className="register-row">
                <td className="mono">{s.admission_no}</td>
                <td><b>{s.first_name} {s.last_name}</b></td>
                <td>
                  <span className="seg" role="radiogroup" aria-label={`${s.first_name} ${s.last_name}`}>
                    {STATUSES.map((st) => (
                      <button key={st.value} type="button" className={`btn sm ghost ${rows[i].status === st.value ? 'on' : ''}`} title={st.label} disabled={readOnly}
                        aria-pressed={rows[i].status === st.value} onClick={() => set(i, { status: st.value })}>{st.short}</button>
                    ))}
                  </span>
                </td>
                <td>{readOnly ? (rows[i].remarks || '—') : <input type="text" value={rows[i].remarks ?? ''} onChange={(e) => set(i, { remarks: e.target.value })} placeholder={rows[i].status === 'PRESENT' ? '' : 'Reason…'} style={{ width: '100%' }} aria-label="Remarks" />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!readOnly ? (
        <Toolbar>
          <Spacer />
          <button type="button" className="btn" disabled={busy || !roster.length} onClick={save}>{busy ? 'Saving…' : existing.length ? 'Update register' : 'Save register'}</button>
        </Toolbar>
      ) : null}
    </>
  );
}
