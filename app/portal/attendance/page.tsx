import { requireAction } from '@/lib/session';
import { listTerms } from '@/lib/academics/setup';
import { studentAttendanceSummary, listStudentAttendance } from '@/lib/academics/attendance';
import { formatDate, today } from '@/lib/format';
import { Card, CardHead, EmptyState, Pill, Stat, TableWrap } from '@/components/ui/primitives';
import { SelectFilter } from '@/components/ui/filters';
import { loadPortalScope, isPortalScope } from '../context';
import { PortalShell } from '../portal-shell';

export default async function PortalAttendancePage({ searchParams }: { searchParams: Promise<{ student?: string; term?: string }> }) {
  const user = await requireAction('STUDENT_PORTAL_VIEW');
  const sp = await searchParams;
  const scope = await loadPortalScope(user, sp.student, sp.term);
  const terms = await listTerms();
  const term = isPortalScope(scope) ? scope.term : undefined;
  const from = term?.start_date ?? `${new Date().getFullYear()}-01-01`;
  const to = term ? (term.end_date < today() ? term.end_date : today()) : today();
  const [summary, records] = isPortalScope(scope) ? await Promise.all([studentAttendanceSummary(scope.student.id, from, to), listStudentAttendance(scope.student.id, from, to)]) : [null, []];
  const exceptions = records.filter((r) => r.status !== 'PRESENT');
  return (
    <PortalShell user={user} title="Attendance" scope={scope}
      extra={<SelectFilter paramName="term" label="Term" allLabel={term ? `${term.name} ${term.year_name}` : 'Term'} options={terms.filter((t) => t.id !== term?.id).map((t) => ({ value: String(t.id), label: `${t.name} ${t.year_name}` }))} />}>
      {summary ? (
        <>
          <div className="grid g4">
            <Stat label="Attendance" value={`${summary.rate}%`} foot={`${summary.present + summary.late} of ${summary.total} days`} />
            <Stat label="Absent" value={String(summary.absent)} accent={summary.absent > 0} />
            <Stat label="Late" value={String(summary.late)} accent={false} />
            <Stat label="Excused" value={String(summary.excused)} accent={false} />
          </div>
          <Card>
            <CardHead title="Days not present" sub={term ? `${term.name} ${term.year_name}` : undefined} />
            {exceptions.length ? (
              <TableWrap>
                <thead><tr><th>Date</th><th>Status</th><th>Remarks</th></tr></thead>
                <tbody>{exceptions.map((r) => <tr key={r.id}><td>{formatDate(r.date)}</td><td><Pill status={r.status} /></td><td>{r.remarks ?? '—'}</td></tr>)}</tbody>
              </TableWrap>
            ) : <EmptyState icon="✅" title={summary.total ? 'Present every day marked' : 'No register marked yet this term'} />}
          </Card>
        </>
      ) : null}
    </PortalShell>
  );
}
