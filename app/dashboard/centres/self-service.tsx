import { getOrgBrand } from '@/lib/org';
import { getEmployeeForUser } from '@/lib/selfService';
import { formatDate, today } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { Card, EmptyState } from '@/components/ui/primitives';
import { SelfServiceDashboard } from '../../self-service/dashboard';
import { TeacherSections } from './teacher';
import { DriverSections } from './driver';
import type { SessionUser } from '@/lib/types';

/** Employee Self Service Role Centre — the module's dashboard (app/self-service/dashboard.tsx) as
 *  the home page for a user whose active profile is Employee Self Service. A login the User Setup
 *  marks as a teacher gets the Teacher Portal — today's lessons, registers, marks — on top. */
export async function SelfServiceRoleCentre({ user }: { user: SessionUser }) {
  const [org, me] = await Promise.all([getOrgBrand(), getEmployeeForUser(user.id)]);

  if (!me) {
    return (
      <Page title="Employee Self Service" crumb={org!.name} user={user}>
        <Card>
          <EmptyState icon="🪪" title="Your login is not matched to an employee yet"
            sub="Ask an administrator to set your Employee No. under Admin Centre → User Setup. Your payslips, leave and requests appear here once that is done." />
        </Card>
      </Page>
    );
  }

  return (
    <Page title={`Welcome, ${me.first_name}`} crumb={`${org!.name} · ${me.employee_no}${me.job_title ? ` · ${me.job_title}` : ''} · ${formatDate(today())}`} user={user}>
      {user.isTeacher ? <TeacherSections employeeId={me.id} /> : null}
      <DriverSections employeeId={me.id} />
      <SelfServiceDashboard user={user} me={me} />
    </Page>
  );
}
