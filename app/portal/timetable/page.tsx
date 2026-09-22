import { requireAction } from '@/lib/session';
import { listStreamTimetable } from '@/lib/academics/timetable';
import { Card, CardHead, EmptyState } from '@/components/ui/primitives';
import { TimetableGrid } from '@/components/school/timetable-grid';
import { loadPortalScope, isPortalScope } from '../context';
import { PortalShell } from '../portal-shell';

export default async function PortalTimetablePage({ searchParams }: { searchParams: Promise<{ student?: string }> }) {
  const user = await requireAction('STUDENT_PORTAL_VIEW');
  const { student } = await searchParams;
  const scope = await loadPortalScope(user, student);
  const slots = isPortalScope(scope) && scope.term && scope.student.current_stream_id ? await listStreamTimetable(scope.student.current_stream_id, scope.term.id) : [];
  return (
    <PortalShell user={user} title="Timetable" scope={scope}>
      {isPortalScope(scope) ? (
        <Card>
          <CardHead title={`${scope.student.grade_level_name ?? ''} ${scope.student.stream_name ?? ''} — ${scope.term ? `${scope.term.name} ${scope.term.year_name}` : 'no current term'}`} sub="The class's week" />
          {slots.length ? <TimetableGrid slots={slots} focus="stream" /> : <EmptyState icon="🗓" title="No timetable published yet" />}
        </Card>
      ) : null}
    </PortalShell>
  );
}
