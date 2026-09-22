import Link from 'next/link';
import { requireAction } from '@/lib/session';
import { listIncidents, INCIDENT_KINDS, type IncidentKind } from '@/lib/incidents';
import { listStreams, getCurrentAcademicYear } from '@/lib/academics/setup';
import { formatDate } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { Card, EmptyState, Pill, Stat, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { SelectFilter } from '@/components/ui/filters';

const tone = (k: string) => (k === 'DISCIPLINE' ? 'bad' : k === 'MEDICAL' ? 'warn' : k === 'EXEAT' ? 'info' : undefined) as 'bad' | 'warn' | 'info' | undefined;

/** The school-wide welfare log — open discipline cases, who is in the sick bay, who is out on exeat. Records are added on the student's card. */
export default async function IncidentsPage({ searchParams }: { searchParams: Promise<{ kind?: string; stream?: string; all?: string }> }) {
  const user = await requireAction('INCIDENTS_READ');
  const sp = await searchParams;
  const year = await getCurrentAcademicYear();
  const kind = INCIDENT_KINDS.find((k) => k.value === sp.kind)?.value ?? null;
  const [rows, streams] = await Promise.all([
    listIncidents({ kind, streamId: sp.stream ? Number(sp.stream) : null, openOnly: sp.all !== '1' }), listStreams(year?.id ?? null),
  ]);
  const count = (k: IncidentKind) => rows.filter((r) => r.kind === k && r.status === 'OPEN').length;
  return (
    <Page title="Discipline & Welfare" crumb="Open discipline cases, sick bay and exeats across the school — recorded on each student's card" user={user}>
      <div className="grid g4">
        <Stat label="Open discipline cases" value={String(count('DISCIPLINE'))} accent={count('DISCIPLINE') > 0} />
        <Stat label="In sick bay / medical" value={String(count('MEDICAL'))} accent={count('MEDICAL') > 0} />
        <Stat label="Out on exeat" value={String(count('EXEAT'))} accent={false} />
        <Stat label="Notes open" value={String(count('NOTE'))} accent={false} />
      </div>
      <Toolbar>
        <SelectFilter paramName="kind" label="Kind" allLabel="All kinds" options={INCIDENT_KINDS.map((k) => ({ value: k.value, label: k.label }))} />
        <SelectFilter paramName="stream" label="Class" allLabel="All classes" options={streams.map((s) => ({ value: String(s.id), label: `${s.grade_level_name} ${s.name}` }))} />
        <SelectFilter paramName="all" label="Status" allLabel="Open only" options={[{ value: '1', label: 'Open and closed' }]} />
        <Spacer />
      </Toolbar>
      <Card>
        {rows.length ? (
          <TableWrap>
            <thead><tr><th>Date</th><th>Student</th><th>Class</th><th>Kind</th><th>Title</th><th>Action taken</th><th>Follow-up</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.status === 'CLOSED' ? 'muted' : undefined}>
                  <td>{formatDate(r.date)}</td>
                  <td><Link href={`/students/view/${r.student_id}`}><b>{r.student_name}</b></Link> <span className="tiny mono">{r.admission_no}</span></td>
                  <td>{r.grade_level_name} {r.stream_name}</td>
                  <td><Pill tone={tone(r.kind)}>{INCIDENT_KINDS.find((k) => k.value === r.kind)?.label ?? r.kind}</Pill></td>
                  <td>{r.title}</td>
                  <td>{r.action_taken ?? '—'}</td>
                  <td>{r.follow_up ? formatDate(r.follow_up) : '—'}</td>
                  <td><Pill status={r.status} tone={r.status === 'OPEN' ? 'warn' : 'ok'} /></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🩺" title="Nothing open" sub="Records are added on a student's card under Discipline, medical & exeats." />}
      </Card>
    </Page>
  );
}
