import Link from 'next/link';
import { requireAction, currentCanAction } from '@/lib/session';
import { listVacantPositions } from '@/lib/companyJobs';
import { getDimensionCaptions } from '@/lib/org';
import { Page } from '@/components/layout/page';
import { Card, EmptyState, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';

/** AL Pag52203930 "Vacant Positions" — approved jobs with posts still to fill. */
export default async function VacantPositionsPage() {
  const user = await requireAction('ORGANOGRAM_VIEW');
  const [rows, { caption1 }, canSeeJobs] = await Promise.all([listVacantPositions(), getDimensionCaptions(), currentCanAction('COMPANY_JOBS_READ')]);
  const totalVacant = rows.reduce((s, r) => s + r.vacant, 0);

  return (
    <Page title="Vacant Positions" crumb={`${totalVacant} unfilled post${totalVacant === 1 ? '' : 's'} across ${rows.length} position${rows.length === 1 ? '' : 's'}`} user={user}>
      <Toolbar>
        <Link href="/organogram" className="btn ghost sm">← Organogram</Link>
        {canSeeJobs ? <Link href="/company-jobs" className="btn ghost sm">Company jobs</Link> : null}
        <Spacer />
      </Toolbar>
      <Card>
        {rows.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th>Job ID</th><th>Job Title</th><th>Reports To</th><th>Grade</th><th>{caption1}</th>
                <th className="num">Posts</th><th className="num">Holders</th><th className="num">Vacant</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((j) => (
                <tr key={j.id}>
                  <td className="mono">{canSeeJobs ? <Link href={`/company-jobs/view/${j.id}`}>{j.job_id}</Link> : j.job_id}</td>
                  <td><b>{j.name}</b>{j.profession ? <div className="tiny muted-cell">{j.profession}</div> : null}</td>
                  <td>{j.reports_to_job_name || '—'}</td>
                  <td>{j.job_grade_name || '—'}</td>
                  <td>{j.global_dimension_1_name || '—'}</td>
                  <td className="num">{j.no_of_posts}</td>
                  <td className="num">{j.occupied}</td>
                  <td className="num"><b style={{ color: 'var(--warning)' }}>{j.vacant}</b></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🪑" title="No vacant positions" sub="Every post in the approved establishment is filled." />}
      </Card>
    </Page>
  );
}
