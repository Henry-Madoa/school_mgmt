import { requireAction } from '@/lib/session';
import { visibleAnnouncements } from '@/lib/announcements';
import { Card, CardHead } from '@/components/ui/primitives';
import { AnnouncementList } from '@/components/school/announcement-list';
import { loadPortalScope, isPortalScope } from '../context';
import { PortalShell } from '../portal-shell';

export default async function PortalAnnouncementsPage({ searchParams }: { searchParams: Promise<{ student?: string }> }) {
  const user = await requireAction('STUDENT_PORTAL_VIEW');
  const { student } = await searchParams;
  const scope = await loadPortalScope(user, student);
  const rows = isPortalScope(scope) ? await visibleAnnouncements({
    audiences: scope.kind === 'STUDENT' ? ['STUDENTS'] : ['GUARDIANS'],
    gradeLevelIds: scope.students.map((s) => s.current_grade_level_id).filter((x): x is number => !!x),
    streamIds: scope.students.map((s) => s.current_stream_id).filter((x): x is number => !!x),
  }) : [];
  return (
    <PortalShell user={user} title="Announcements" crumb="Notices from the school, your grade and your class" scope={scope}>
      <Card>
        <CardHead title="Notice board" />
        <AnnouncementList rows={rows} empty="No notices right now" />
      </Card>
    </PortalShell>
  );
}
