import { requireAction, currentCanAction } from '@/lib/session';
import { listAnnouncements, visibleAnnouncements } from '@/lib/announcements';
import { listGradeLevels, listStreams, getCurrentAcademicYear } from '@/lib/academics/setup';
import { Page } from '@/components/layout/page';
import { Card, CardHead, Toolbar, Spacer } from '@/components/ui/primitives';
import { AnnouncementList } from '@/components/school/announcement-list';
import { AnnouncementFormButton, DeleteAnnouncementButton } from './announcement-form';

export default async function AnnouncementsPage() {
  const user = await requireAction('ANNOUNCEMENTS_READ');
  const [canManage, year, grades] = await Promise.all([currentCanAction('ANNOUNCEMENTS_MANAGE'), getCurrentAcademicYear(), listGradeLevels()]);
  const streams = await listStreams(year?.id ?? null);
  // The office sees everything it has written (scheduled and expired included); everyone else sees what is addressed to staff.
  const rows = canManage ? await listAnnouncements() : await visibleAnnouncements({ audiences: ['STAFF', 'TEACHERS'] });
  return (
    <Page title="Announcements" crumb="Notices to the school, the staff, a grade or a class — shown on the portals and dashboards" user={user}>
      <Toolbar>
        <Spacer />
        {canManage ? <AnnouncementFormButton grades={grades} streams={streams}>New announcement</AnnouncementFormButton> : null}
      </Toolbar>
      <Card>
        <CardHead title="Notice board" sub={canManage ? `${rows.length} announcement${rows.length === 1 ? '' : 's'} on file` : 'What is addressed to staff'} />
        <AnnouncementList rows={rows} actions={canManage ? (a) => (
          <>
            <AnnouncementFormButton announcement={a} grades={grades} streams={streams} className="btn sm ghost">Edit</AnnouncementFormButton>
            <DeleteAnnouncementButton id={a.id} />
          </>
        ) : undefined} />
      </Card>
    </Page>
  );
}
