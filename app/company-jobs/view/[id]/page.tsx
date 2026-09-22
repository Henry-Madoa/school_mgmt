import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import {
  getCompanyJob, listApprovedJobs, listJobResponsibilities, listJobRequirements, listJobQualifications, listJobHolders,
} from '@/lib/companyJobs';
import { listJobGrades } from '@/lib/hrSetup';
import { listDimensionValues } from '@/lib/pool';
import { getDimensionCaptions } from '@/lib/org';
import { findPendingRoutedTask, isEligibleApprover, listWorkflowTasksForDocument } from '@/lib/workflow';
import { formatDate, formatDateTime, initials } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { DefinitionList, EmptyState, Pill, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { DocumentActionsMenu } from '@/components/ui/document-actions';
import {
  JobDetailsCard, ResponsibilitiesPanel, RequirementsPanel, QualificationsPanel,
  SubmitButton, CancelApprovalButton, ApproveButton, RejectButton, DelegateButton, DeleteButton, ReopenButton, RetireButton,
  type JobLookups,
} from '../../job-actions';

/** AL Pag52203983 "Company Job" card. */
export default async function CompanyJobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAction('COMPANY_JOBS_READ');
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id)) notFound();

  const job = await getCompanyJob(id);
  if (!job) notFound();

  const [
    canCreate, canApprove, tasks, responsibilities, requirements, qualifications, holders,
    approved, jobGrades, gd1Values, gd2Values, { caption1, caption2 },
  ] = await Promise.all([
    currentCanAction('COMPANY_JOBS_CREATE'), currentCanAction('COMPANY_JOBS_APPROVE'),
    listWorkflowTasksForDocument('COMPANY_JOB', String(id)),
    listJobResponsibilities(id), listJobRequirements(id), listJobQualifications(id), listJobHolders(id),
    listApprovedJobs(), listJobGrades(), listDimensionValues(1), listDimensionValues(2), getDimensionCaptions(),
  ]);
  const lookups: JobLookups = {
    jobs: approved.map((j) => ({ id: j.id, job_id: j.job_id, name: j.name, status: j.status })),
    jobGrades, globalDimension1Values: gd1Values, globalDimension2Values: gd2Values, caption1, caption2,
  };

  const isOwn = job.created_by === user.username;
  const isOpen = job.status === 'Open';
  // Like Employee onboarding, an Open draft — new, rejected or recalled — is editable by anyone who may draw up jobs.
  const canManage = isOpen && canCreate;
  const routedTask = job.status === 'Pending Approval' ? await findPendingRoutedTask('COMPANY_JOB', String(id)) : null;
  const canDecideThis = routedTask ? await isEligibleApprover(routedTask, user.id) : canApprove;
  const requestedBy = routedTask?.requested_by ?? job.created_by;
  const canCancelThis = canCreate && requestedBy === user.username;
  const pendingWith = tasks.find((t) => t.status === 'PENDING')?.pending_with;

  return (
    <Page
      title={`${job.job_id} — ${job.name}`}
      crumb={`${job.status} · ${job.occupied} of ${job.no_of_posts} post${job.no_of_posts === 1 ? '' : 's'} filled${pendingWith ? ` · pending with ${pendingWith}` : ''}`}
      user={user}
    >
      <Toolbar>
        <Link href="/company-jobs" className="btn ghost sm">← All positions</Link>
        <Link href="/organogram" className="btn ghost sm">Organogram</Link>
        <Spacer />
        {isOpen && canCreate && isOwn ? <DeleteButton id={job.id} className="btn ghost" /> : null}
        {isOpen && canCreate ? <SubmitButton id={job.id} className="btn ghost" /> : null}
        {job.status === 'Pending Approval' && canCancelThis ? <CancelApprovalButton id={job.id} className="btn ghost" /> : null}
        {job.status === 'Pending Approval' && canDecideThis ? (
          <>
            {routedTask ? <DelegateButton taskId={routedTask.id} className="btn ghost" /> : null}
            <ApproveButton id={job.id} />
            <RejectButton id={job.id} className="btn ghost" />
          </>
        ) : null}
        {(job.status === 'Approved' || job.status === 'Retired') && canCreate ? <ReopenButton id={job.id} className="btn ghost" /> : null}
        {job.status === 'Approved' && canApprove ? <RetireButton id={job.id} className="btn ghost" /> : null}
        <DocumentActionsMenu />
      </Toolbar>

      <JobDetailsCard job={job} lookups={lookups} canEdit={canManage} />

      <RequirementsPanel jobId={id} rows={requirements} canManage={canManage} />
      <QualificationsPanel jobId={id} rows={qualifications} canManage={canManage} />
      <ResponsibilitiesPanel jobId={id} rows={responsibilities} canManage={canManage} />

      <CollapsibleCard title="Holders" sub={`${job.occupied} active of ${job.no_of_posts} post${job.no_of_posts === 1 ? '' : 's'}, ${job.vacant} vacant`}>
        {holders.length ? (
          <TableWrap>
            <thead><tr><th>Employee</th><th>Employee No.</th><th>Employed since</th><th>Status</th></tr></thead>
            <tbody>
              {holders.map((h) => (
                <tr key={h.id}>
                  <td>
                    <span className="inline" style={{ gap: 8 }}>
                      {h.photo_image
                        ? <img src={h.photo_image} alt="" className="avatar" style={{ objectFit: 'cover' }} />
                        : <span className="avatar" aria-hidden="true">{initials(`${h.first_name} ${h.last_name}`)}</span>}
                      <Link href={`/employees/view/${h.id}`}><b>{h.first_name} {h.last_name}</b></Link>
                    </span>
                  </td>
                  <td className="mono">{h.employee_no}</td>
                  <td>{h.employment_date ? formatDate(h.employment_date) : '—'}</td>
                  <td><Pill status={h.status} /></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🪑" title="Nobody is placed on this position" sub="Employees are placed on a position from the Employment card of their record." />}
      </CollapsibleCard>

      <CollapsibleCard title="Document trail">
        <DefinitionList items={[
          ['Created by', job.created_by || '—'],
          ['Created on', formatDateTime(job.created_at)],
          job.approved_at ? ['Approved by', job.approved_by || '—'] : null,
          job.approved_at ? ['Approved on', formatDateTime(job.approved_at)] : null,
        ]} />
      </CollapsibleCard>

      <CollapsibleCard title="Approval details" sub={`${tasks.length} approval step${tasks.length === 1 ? '' : 's'} routed`}>
        {tasks.length ? (
          <TableWrap>
            <thead><tr><th>Sent by</th><th>Sent date</th><th>Approver</th><th>Approved on</th><th /></tr></thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id}>
                  <td>{t.requested_by || '—'}</td>
                  <td>{formatDateTime(t.requested_at)}</td>
                  <td className="muted-cell">{t.decided_by || t.pending_with || '—'}</td>
                  <td>{t.decided_at ? formatDateTime(t.decided_at) : '—'}</td>
                  <td><Pill status={t.status} /></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🕓" title="Not yet sent for approval" />}
      </CollapsibleCard>
    </Page>
  );
}
