import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import { listCompanyJobs, listApprovedJobs, type JobView } from '@/lib/companyJobs';
import { listJobGrades } from '@/lib/hrSetup';
import { listDimensionValues } from '@/lib/pool';
import { getDimensionCaptions } from '@/lib/org';
import { Page } from '@/components/layout/page';
import { Card, EmptyState, Pill, TableWrap, Tabs, Toolbar, Spacer, type TabDefinition } from '@/components/ui/primitives';
import { NewJobButton, SubmitButton, CancelApprovalButton, DeleteButton, type JobLookups } from '../job-actions';

const TABS: TabDefinition[] = [
  { key: 'open', label: 'Open', tone: 'info' },
  { key: 'pending', label: 'Pending Approval', tone: 'warn' },
  { key: 'approved', label: 'Approved', tone: 'ok' },
  { key: 'retired', label: 'Retired' },
  { key: 'all', label: 'All' },
];

/** AL Pag52203917 "Company Jobs" — the establishment list. */
export default async function CompanyJobsPage({ params }: { params: Promise<{ tab?: string[] }> }) {
  const user = await requireAction('COMPANY_JOBS_READ');
  const { tab: segments } = await params;
  const requested = segments?.[0];
  if (requested && !TABS.some((t) => t.key === requested)) notFound();
  const tab = (requested ?? 'approved') as JobView;

  const [rows, canCreate, approved, jobGrades, gd1Values, gd2Values, { caption1, caption2 }] = await Promise.all([
    listCompanyJobs(tab), currentCanAction('COMPANY_JOBS_CREATE'), listApprovedJobs(),
    listJobGrades(), listDimensionValues(1), listDimensionValues(2), getDimensionCaptions(),
  ]);
  const lookups: JobLookups = {
    jobs: approved.map((j) => ({ id: j.id, job_id: j.job_id, name: j.name, status: j.status })),
    jobGrades, globalDimension1Values: gd1Values, globalDimension2Values: gd2Values, caption1, caption2,
  };

  return (
    <Page title="Company Jobs" crumb="The establishment — every approved position, its posts and reporting line" user={user}>
      <Tabs tabs={TABS} active={tab} hrefFor={(k) => `/company-jobs/${k}`} />
      <Toolbar>
        <Link href="/organogram" className="btn ghost sm">View organogram</Link>
        <Link href="/organogram/vacant" className="btn ghost sm">Vacant positions</Link>
        <Spacer />
        {canCreate ? <NewJobButton lookups={lookups} /> : null}
      </Toolbar>

      <Card>
        {rows.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th>Job ID</th><th>Job Title</th><th>Reports To</th><th>Grade</th><th>{caption1}</th>
                <th className="num">Posts</th><th className="num">Holders</th><th className="num">Vacant</th><th>Status</th><th className="num" />
              </tr>
            </thead>
            <tbody>
              {rows.map((j) => {
                const isOwn = j.created_by === user.username;
                return (
                  <tr key={j.id}>
                    <td className="mono"><Link href={`/company-jobs/view/${j.id}`}>{j.job_id}</Link></td>
                    <td><b>{j.name}</b>{j.is_management ? <div className="tiny muted-cell">Management</div> : null}</td>
                    <td>{j.reports_to_job_code ? <>{j.reports_to_job_name} <span className="tiny mono">{j.reports_to_job_code}</span></> : <span className="muted-cell">—</span>}</td>
                    <td>{j.job_grade_name || '—'}</td>
                    <td>{j.global_dimension_1_name || '—'}</td>
                    <td className="num">{j.no_of_posts}</td>
                    <td className="num">{j.occupied}</td>
                    <td className="num">{j.vacant > 0 ? <b style={{ color: 'var(--warning)' }}>{j.vacant}</b> : j.vacant}</td>
                    <td><Pill status={j.status} /></td>
                    <td className="num">
                      {j.status === 'Open' && canCreate && isOwn ? <>
                        <DeleteButton id={j.id} />{' '}<SubmitButton id={j.id} />
                      </> : null}
                      {j.status === 'Pending Approval' && canCreate && isOwn ? <CancelApprovalButton id={j.id} /> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="💼" title="No positions here" sub={tab === 'approved' ? 'Draft a position under Open and send it for approval to add it to the establishment.' : undefined} />}
      </Card>
    </Page>
  );
}
