'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Toolbar, Spacer } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { enterMarksRequest, type MarkDraft } from '@/app/actions/academics';
import type { AssessmentBand, AssessmentRecordView, StudentListRow } from '@/lib/types';

/**
 * A class's marks for one subject and assessment — one score box per student (0–100, blank
 * clears), the competency band shown live from the default grading scale. Used by the
 * Assessments screen and the Teacher Portal (`viaPortal` picks the permission).
 */
export function MarksEditor({ streamId, subjectId, assessmentTypeId, termId, roster, existing, bands, viaPortal = false, readOnly = false }: {
  streamId: number; subjectId: number; assessmentTypeId: number; termId: number;
  roster: StudentListRow[]; existing: AssessmentRecordView[]; bands: AssessmentBand[]; viaPortal?: boolean; readOnly?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const byStudent = new Map(existing.map((r) => [r.student_id, r]));
  const [rows, setRows] = useState<MarkDraft[]>(roster.map((s) => ({ studentId: s.id, score: byStudent.get(s.id)?.score ?? '', remarks: byStudent.get(s.id)?.remarks ?? '' })));
  const [busy, setBusy] = useState(false);
  const set = (i: number, patch: Partial<MarkDraft>) => setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const band = (score: string | number | null | undefined): AssessmentBand | undefined => {
    if (score === '' || score == null) return undefined;
    const n = Number(score);
    return bands.find((b) => n >= b.min_score && n <= b.max_score);
  };
  const entered = rows.filter((r) => r.score !== '' && r.score != null);
  const avg = entered.length ? entered.reduce((s, r) => s + Number(r.score), 0) / entered.length : null;

  const save = async () => {
    setBusy(true);
    try {
      const res = await enterMarksRequest(streamId, subjectId, assessmentTypeId, termId, rows, viaPortal);
      if (!res.ok) { toast('Could not save the marks', res.error, 'err'); return; }
      toast('Marks saved', `${res.data.saved} saved${res.data.cleared ? `, ${res.data.cleared} cleared` : ''}`, 'ok');
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="inline" style={{ gap: 12, marginBottom: 8 }}>
        <span className="tiny"><b>{entered.length}</b> of {roster.length} entered</span>
        <span className="tiny">Class average <b>{avg == null ? '—' : avg.toFixed(1)}</b></span>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Adm. No.</th><th>Student</th><th style={{ width: 110 }}>Score</th><th>Competency</th><th>Remarks</th></tr></thead>
          <tbody>
            {roster.map((s, i) => {
              const b = band(rows[i].score);
              return (
                <tr key={s.id} className="register-row">
                  <td className="mono">{s.admission_no}</td>
                  <td><b>{s.first_name} {s.last_name}</b></td>
                  <td>{readOnly ? (rows[i].score === '' ? '—' : rows[i].score) : (
                    <input type="number" min={0} max={100} step="0.5" value={rows[i].score ?? ''} aria-label={`${s.first_name} ${s.last_name} score`}
                      onChange={(e) => set(i, { score: e.target.value })} onKeyDown={(e) => {
                        // Enter moves down the column, the way a mark book is keyed.
                        if (e.key === 'Enter') { e.preventDefault(); (e.currentTarget.closest('tr')?.nextElementSibling?.querySelector('input[type=number]') as HTMLInputElement | null)?.focus(); }
                      }} />
                  )}</td>
                  <td>{b ? <span className="pill" style={{ background: b.color_hex, color: '#fff', borderColor: b.color_hex }}>{b.label}</span> : <span className="muted-cell">—</span>}</td>
                  <td>{readOnly ? (rows[i].remarks || '—') : <input type="text" value={rows[i].remarks ?? ''} onChange={(e) => set(i, { remarks: e.target.value })} style={{ width: '100%' }} aria-label="Remarks" />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!readOnly ? (
        <Toolbar>
          <Spacer />
          <button type="button" className="btn" disabled={busy || !roster.length} onClick={save}>{busy ? 'Saving…' : 'Save marks'}</button>
        </Toolbar>
      ) : null}
    </>
  );
}
