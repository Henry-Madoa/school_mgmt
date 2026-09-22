import { requireAction } from '@/lib/session';
import { SuperRoleCentre } from './centres/super';
import { SchoolAdminRoleCentre } from './centres/school-admin';
import { StudentParentRoleCentre } from './centres/student-parent';
import { FinanceManagerRoleCentre } from './centres/finance-manager';
import { AccountantRoleCentre } from './centres/accountant';
import { HrPayrollRoleCentre } from './centres/hr-payroll';
import { SelfServiceRoleCentre } from './centres/self-service';

/**
 * The dashboard is a Role Centre dispatcher (Business Central "Role Center"). Which one renders is
 * decided by the user's active Profile (My Settings → Role Centre) — a landing-page choice that
 * grants no permissions. Every Role Centre is permission-aware: a widget the viewer's permission
 * set does not unlock shows as a locked card.
 */
export default async function DashboardPage() {
  const user = await requireAction('DASHBOARD_VIEW');
  switch (user.activeProfile.role_centre) {
    case 'SCHOOL_ADMIN': return <SchoolAdminRoleCentre user={user} />;
    case 'STUDENT_PARENT': return <StudentParentRoleCentre user={user} />;
    case 'FINANCE_MANAGER': return <FinanceManagerRoleCentre user={user} />;
    case 'ACCOUNTANT': return <AccountantRoleCentre user={user} />;
    case 'HR_PAYROLL': return <HrPayrollRoleCentre user={user} />;
    case 'SELF_SERVICE': return <SelfServiceRoleCentre user={user} />;
    default: return <SuperRoleCentre user={user} />;
  }
}
