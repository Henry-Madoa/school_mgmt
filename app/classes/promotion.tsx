'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Toolbar, Spacer } from '@/components/ui/primitives';
import { useRunAction } from '@/components/ui/run-action';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { promoteStudentsRequest } from '@/app/actions/students';
import { copyStreamsToYearRequest } from '@/app/actions/academics';

const GRADUATE = 'GRADUATE';

interface Row { id: number; admission_no: string; name: string; average: number | null; position: number | null }
interface Target { id: number; label: string; grade_level_id: number }

/** One row per student: promote to a class, repeat in a class of the same grade, or graduate. */
export function PromotionEditor({ students, targets, defaultStreamId, repeatStreams, classOf }: {
  students: Row[]; targets: Target[]; defaultStreamId: number | null; repeatStreams: number[]; classOf: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [choice, setChoice] = useState<Record<number, string>>(Object.fromEntries(students.map((s) => [s.id, defaultStreamId ? String(defaultStreamId) : GRADUATE])));
  const [busy, setBusy] = useState(false);
  const setAll = (v: string) => setChoice(Object.fromEntries(students.map((s) => [s.id, v])));
  const counts = { promote: 0, repeat: 0, graduate: 0 };
  for (const s of students) { const v = choice[s.id]; if (v === GRADUATE) counts.graduate++; else if (repeatStreams.includes(Number(v))) counts.repeat++; else counts.promote++; }

  const apply = async () => {
    const ok = await confirm({ title: 'Apply the promotion?', message: `${counts.promote} promoted, ${counts.repeat} repeating, ${counts.graduate} graduating. Each student's current enrolment is closed and a new one opened in the chosen class; graduates leave the roll (their fee accounts stay open until settled).`, confirmLabel: 'Apply' });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await promoteStudentsRequest(students.map((s) => ({ studentId: s.id, streamId: choice[s.id] === GRADUATE ? null : Number(choice[s.id]) })));
      if (!res.ok) { toast('Could not promote', res.error, 'err'); return; }
      toast('Promotion applied', `${res.data.promoted} promoted, ${res.data.repeated} repeating, ${res.data.graduated} graduated${res.data.skipped ? `, ${res.data.skipped} skipped (already placed or not active)` : ''}`, 'ok');
      router.refresh();
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="inline" style={{ gap: 8, marginBottom: 8 }}>
        <span className="tiny"><b>{counts.promote}</b> promote · <b>{counts.repeat}</b> repeat · <b>{counts.graduate}</b> graduate</span>
        <Spacer />
        {defaultStreamId ? <button type="button" className="btn sm ghost" onClick={() => setAll(String(defaultStreamId))}>All to default</button> : null}
        <button type="button" className="btn sm ghost" onClick={() => setAll(GRADUATE)}>All graduate</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Adm. No.</th><th>Student</th><th className="num">Average</th><th className="num">Position</th><th style={{ width: 280 }}>Next year</th></tr></thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.id} className="register-row">
                <td className="mono">{s.admission_no}</td>
                <td><b>{s.name}</b></td>
                <td className="num">{s.average == null ? '—' : s.average.toFixed(1)}</td>
                <td className="num">{s.position ? `${s.position} / ${classOf}` : '—'}</td>
                <td>
                  <select value={choice[s.id]} onChange={(e) => setChoice({ ...choice, [s.id]: e.target.value })} aria-label={`${s.name} next year`}>
                    {targets.map((t) => <option key={t.id} value={String(t.id)}>{repeatStreams.includes(t.id) ? `Repeat — ${t.label}` : t.label}</option>)}
                    <option value={GRADUATE}>Graduate — leaves the school</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Toolbar>
        <Spacer />
        <button type="button" className="btn" disabled={busy || !students.length} onClick={apply}>{busy ? 'Applying…' : 'Apply promotion'}</button>
      </Toolbar>
    </>
  );
}

export function CopyStreamsButton({ fromYearId, toYearId, fromName, toName, className = 'btn' }: { fromYearId: number; toYearId: number; fromName: string; toName: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy} onClick={() => run(() => copyStreamsToYearRequest(fromYearId, toYearId), {
      confirm: { title: `Open ${toName}'s classes?`, message: `Every class of ${fromName} is copied into ${toName} with its grade, name, capacity and class teacher. Adjust them afterwards under Classes.`, confirmLabel: 'Copy classes' },
      successTitle: 'Classes opened', successDetail: (d) => `${d.copied} class${d.copied === 1 ? '' : 'es'} copied into ${toName}`,
    })}>{busy ? 'Copying…' : `Copy this year's classes into ${toName}`}</button>
  );
}
