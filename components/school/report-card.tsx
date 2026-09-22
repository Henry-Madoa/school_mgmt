import type { ReportCardView } from '@/lib/academics/assessments';
import { formatDate } from '@/lib/format';

/**
 * A term's report card, laid out the same wherever it is shown — the Report Cards screen, the
 * Student/Parent portal and the print sheet. Marks per assessment, the weighted subject average
 * with its competency band, the overall standing, attendance and the remarks.
 */
export function ReportCardSheet({ card, school, photoSrc }: { card: ReportCardView; school?: { name: string; motto?: string | null; address?: string | null }; photoSrc?: string | null }) {
  const types = [...new Map(card.lines.flatMap((l) => l.scores).map((s) => [s.assessment_type_id, s.assessment_type_name])).entries()];
  const att = card.attendance;
  return (
    <div className="report-card">
      {school ? (
        <div style={{ textAlign: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{school.name}</div>
          {school.address ? <div className="tiny">{school.address}</div> : null}
          {school.motto ? <div className="tiny"><i>{school.motto}</i></div> : null}
          <div style={{ fontWeight: 600, marginTop: 6 }}>Progress Report — {card.term.name} {card.term.year_name}</div>
        </div>
      ) : null}
      <div className="inline" style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{card.student.name}</div>
          <div className="tiny">Adm. No. <span className="mono">{card.student.admission_no}</span> · {card.student.grade_level_name} {card.student.stream_name}</div>
          <div className="tiny">{card.term.name} {card.term.year_name} · {formatDate(card.term.start_date)} – {formatDate(card.term.end_date)}</div>
        </div>
        {photoSrc ? <img src={photoSrc} alt="" style={{ width: 64, height: 64, borderRadius: 8, objectFit: 'cover' }} /> : null}
        <div style={{ textAlign: 'right' }}>
          <div className="tiny">Overall average</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{card.overall.average ?? '—'}</div>
          {card.overall.competency_label ? <span className="rc-band" style={{ background: card.overall.band_color ?? '#64748b' }}>{card.overall.competency_label}</span> : null}
          {card.overall.mean_points != null ? <div className="tiny" style={{ marginTop: 4 }}>Mean grade <b>{card.overall.mean_grade ?? '—'}</b> · {card.overall.mean_points} points</div> : null}
          {card.position ? <div className="tiny" style={{ marginTop: 4 }}>Position {card.position.rank} of {card.position.of}</div> : null}
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Subject</th>
              {types.map(([id, name]) => <th key={id} className="num">{name}</th>)}
              <th className="num">Average</th>
              <th>{card.overall.scale_name && card.lines.some((l) => l.points != null) ? 'Grade' : 'Competency'}</th>
              {card.lines.some((l) => l.points != null) ? <th className="num">Points</th> : null}
            </tr>
          </thead>
          <tbody>
            {card.lines.map((l) => (
              <tr key={l.subject_id}>
                <td><b>{l.subject_name}</b></td>
                {types.map(([id]) => { const s = l.scores.find((x) => x.assessment_type_id === id); return <td key={id} className="num">{s ? s.score : '—'}</td>; })}
                <td className="num"><b>{l.average ?? '—'}</b></td>
                <td>{l.competency_label ? <span className="rc-band" style={{ background: l.band_color ?? '#64748b' }}>{l.competency_label}</span> : <span className="muted-cell">—</span>}</td>
                {card.lines.some((x) => x.points != null) ? <td className="num">{l.points ?? '—'}</td> : null}
              </tr>
            ))}
            {!card.lines.length ? <tr><td colSpan={types.length + 4} className="muted-cell">No marks recorded this term.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="grid g2" style={{ marginTop: 10 }}>
        <div>
          <div className="hint">Attendance</div>
          <div>{att.total ? `Present ${att.present + att.late} of ${att.total} days (${att.rate}%)${att.absent ? ` · ${att.absent} absent` : ''}${att.excused ? ` · ${att.excused} excused` : ''}` : 'No register marked this term'}</div>
        </div>
        <div>
          <div className="hint">Status</div>
          <div>{card.card?.is_published ? `Published ${card.card.published_at ? formatDate(card.card.published_at) : ''} by ${card.card.published_by ?? ''}` : 'Draft — not yet visible to the student or parents'}</div>
        </div>
      </div>
      <div className="hint" style={{ marginTop: 10 }}>Class teacher&apos;s remarks</div>
      <div className="rc-remarks">{card.card?.class_teacher_remarks ?? <span className="muted-cell">—</span>}</div>
      <div className="hint" style={{ marginTop: 10 }}>Principal&apos;s remarks</div>
      <div className="rc-remarks">{card.card?.principal_remarks ?? <span className="muted-cell">—</span>}</div>
    </div>
  );
}
