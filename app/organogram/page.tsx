import Link from 'next/link';
import { requireAction, currentCanAction } from '@/lib/session';
import { getOrganogram, listUnplacedEmployees } from '@/lib/companyJobs';
import { Page } from '@/components/layout/page';
import { Card, EmptyState, Stat, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { OrgChart } from './org-chart';

/** The company organogram — approved positions by reporting line, with their holders. */
export default async function OrganogramPage() {
  const user = await requireAction('ORGANOGRAM_VIEW');
  const [{ roots, totals, unplaced }, unplacedEmployees, canSeeJobs] = await Promise.all([
    getOrganogram(), listUnplacedEmployees(), currentCanAction('COMPANY_JOBS_READ'),
  ]);

  return (
    <Page title="Organogram" crumb="The establishment as a reporting structure — approved positions and who holds them" user={user}>
      <Toolbar>
        {canSeeJobs ? <Link href="/company-jobs" className="btn ghost sm">Company jobs</Link> : null}
        <Link href="/organogram/vacant" className="btn ghost sm">Vacant positions</Link>
        <Spacer />
      </Toolbar>

      <div className="grid g4" style={{ marginBottom: 'calc(var(--sp) * 2)' }}>
        <Stat label="Positions" value={totals.jobs} foot={`${roots.length} top-level`} />
        <Stat label="Established posts" value={totals.posts} accent={false} />
        <Stat label="Occupied" value={totals.occupied} accent={false} foot={totals.posts ? `${Math.round((totals.occupied / totals.posts) * 100)}% of the establishment` : undefined} />
        <Stat label="Vacant" value={<Link href="/organogram/vacant">{totals.vacant}</Link>} accent={false}
          foot={unplaced ? `${unplaced} active staff not placed on a position` : 'Every active employee is placed'} />
      </div>

      <Card>
        {roots.length
          ? <OrgChart roots={roots} />
          : <EmptyState icon="🏛" title="No approved positions yet" sub="Draw up positions under Company Jobs and approve them; each one's Immediate Supervisor sets where it sits on the chart." />}
      </Card>

      {unplacedEmployees.length ? (
        <CollapsibleCard title="Not on the organogram" sub={`${unplacedEmployees.length} active employee${unplacedEmployees.length === 1 ? '' : 's'} without a company job — place them from the Employment card of their record`} defaultCollapsed>
          <TableWrap>
            <thead><tr><th>Employee No.</th><th>Name</th><th>Status</th></tr></thead>
            <tbody>
              {unplacedEmployees.map((e) => (
                <tr key={e.id}>
                  <td className="mono"><Link href={`/employees/view/${e.id}`}>{e.employee_no}</Link></td>
                  <td><b>{e.first_name} {e.last_name}</b></td>
                  <td>{e.status}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </CollapsibleCard>
      ) : null}
    </Page>
  );
}
