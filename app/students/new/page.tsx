import { requireAction } from '@/lib/session';
import { listStreams, getCurrentAcademicYear } from '@/lib/academics/setup';
import { listCounties, listSubCounties } from '@/lib/pool';
import { Page } from '@/components/layout/page';
import { AdmitStudentForm } from '../student-form';

export default async function AdmitStudentPage() {
  const user = await requireAction('STUDENTS_CREATE');
  const year = await getCurrentAcademicYear();
  const [streams, counties, subCounties] = await Promise.all([listStreams(year?.id ?? null), listCounties(), listSubCounties()]);
  return (
    <Page title="Admit a student" crumb="Bio-data, class placement and guardians — the fee account opens on admission" user={user}>
      <AdmitStudentForm lookups={{ streams, counties, subCounties }} />
    </Page>
  );
}
