import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAnyAction, currentCanAction, currentCanAnyAction } from '@/lib/session';
import { assertCanViewEmployeeDocument } from '@/lib/selfService';
import { EmployeeIdentityStrip } from '../../../employees/employee-media';
import { imageSrc, isConfigured } from '@/lib/cloudinary';
import {
  getEmployeeEditRequest, listEditNextOfKin, listEditBeneficiaries, listEditDependants,
  listEditEmergencyContacts, listEditProfessionalBodies, listEditWorkHistory, listEditBankAccounts,
} from '@/lib/employeeEdits';
import { listJobGrades } from '@/lib/hrSetup';
import { listApprovedJobs } from '@/lib/companyJobs';
import { listPostingGroups } from '@/lib/payrollSetup';
import { listCurrencies } from '@/lib/cashMgmtSetup';
import { getCurrentContract } from '@/lib/employees';
import { listSalaryScales } from '@/lib/salaryScales';
import { EditRequestPayrollCard } from '../../../employees/payroll-salary-card-bindings';
import { listCounties, listSubCounties, listDimensionValues } from '@/lib/pool';
import { getDimensionCaptions } from '@/lib/org';
import { findPendingRoutedTask, isEligibleApprover, listWorkflowTasksForDocument } from '@/lib/workflow';
import { formatDateTime } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { DefinitionList, EmptyState, Pill, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { DocumentActionsMenu } from '@/components/ui/document-actions';
import {
  SubmitEditButton, DeleteEditButton, CancelEditApprovalButton, ApproveEditButton, RejectEditButton,
  DelegateEditButton, ApplyEditButton, type EditLookups,
} from '../../edit-actions';
import { EditBioDataCard, EditEmploymentBankingCard } from '../../edit-info-cards';
import {
  EditNextOfKinPanel, EditBeneficiariesPanel, EditDependantsPanel, EditEmergencyContactsPanel,
  EditProfessionalBodiesPanel, EditWorkHistoryPanel, EditBankAccountsPanel,
} from '../../edit-sub-entity-panels';

export default async function EmployeeEditDetailPage({ params, searchParams }: {
  params: Promise<{ no: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const user = await requireAnyAction('EMPLOYEE_EDITS_READ', 'SELF_SERVICE_RECORD_READ');
  const { no } = await params;
  const { edit } = await searchParams;
  const startEditing = edit === '1';

  const req = await getEmployeeEditRequest(no);
  if (!req) notFound();
  // Employee Self Service: an employee reaches only requests against their own record.
  const { selfService } = await assertCanViewEmployeeDocument(user, 'EMPLOYEE_EDITS_READ', 'SELF_SERVICE_RECORD_READ', req.employee_id);

  const [
    canUpdate, canApprove, canDelete, canHrUpdate, postingGroups, currencies, contract, salaryScales, tasks, gd1Values, gd2Values, { caption1, caption2 }, jobGrades, counties, subCounties, companyJobs,
    nextOfKin, beneficiaries, dependants, emergencyContacts, professionalBodies, workHistory, bankAccounts,
  ] = await Promise.all([
    currentCanAnyAction('EMPLOYEE_EDITS_UPDATE', 'SELF_SERVICE_RECORD_UPDATE'),
    currentCanAction('EMPLOYEE_EDITS_APPROVE'),
    currentCanAnyAction('EMPLOYEE_EDITS_DELETE', 'SELF_SERVICE_RECORD_DELETE'),
    currentCanAction('EMPLOYEE_EDITS_UPDATE'),
    listPostingGroups(), listCurrencies(), getCurrentContract(req.employee_id), listSalaryScales(),
    listWorkflowTasksForDocument('EMPLOYEE_EDIT', no),
    listDimensionValues(1), listDimensionValues(2), getDimensionCaptions(),
    listJobGrades(), listCounties(), listSubCounties(), listApprovedJobs(),
    listEditNextOfKin(no), listEditBeneficiaries(no), listEditDependants(no), listEditEmergencyContacts(no),
    listEditProfessionalBodies(no), listEditWorkHistory(no), listEditBankAccounts(no),
  ]);
  const lookups: EditLookups = {
    globalDimension1Values: gd1Values, globalDimension2Values: gd2Values, caption1, caption2,
    jobGrades, counties, subCounties, companyJobs,
  };

  const isOwn = req.created_by === user.username;
  const isOpen = req.status === 'Open';
  const canManage = isOpen && canUpdate && isOwn;

  const routedTask = req.status === 'Pending Approval' ? await findPendingRoutedTask('EMPLOYEE_EDIT', no) : null;
  const canDecideThis = routedTask ? await isEligibleApprover(routedTask, user.id) : canApprove;
  const requestedBy = routedTask?.requested_by ?? req.created_by;
  const canCancelThis = canUpdate && requestedBy === user.username;
  const pendingWith = tasks.find((t) => t.status === 'PENDING')?.pending_with;

  return (
    <Page
      title={`${req.no} — ${req.employee_first_name} ${req.employee_last_name}`}
      crumb={`${req.status}${pendingWith ? ` · pending with ${pendingWith}` : ''}`}
      user={user}
    >
      <Toolbar>
        <Link href={selfService ? '/self-service/employee-editing' : '/employee-edits'} className="btn ghost sm">← {selfService ? 'My employee editing requests' : 'All edit requests'}</Link>
        {!selfService ? <Link href={`/employees/view/${req.employee_id}`} className="btn ghost sm">View employee</Link> : null}
        <Spacer />
        {isOpen && canDelete && isOwn ? <DeleteEditButton no={req.no} listHref={selfService ? '/self-service/employee-editing' : '/employee-edits'} className="btn ghost" /> : null}
        {isOpen && canUpdate && isOwn ? <SubmitEditButton no={req.no} className="btn ghost" /> : null}
        {req.status === 'Pending Approval' && canCancelThis ? <CancelEditApprovalButton no={req.no} className="btn ghost" /> : null}
        {req.status === 'Pending Approval' && canDecideThis ? (
          <>
            {routedTask ? <DelegateEditButton taskId={routedTask.id} className="btn ghost" /> : null}
            <ApproveEditButton no={req.no} />
            <RejectEditButton no={req.no} className="btn ghost" />
          </>
        ) : null}
        {req.status === 'Approved' && canApprove ? <ApplyEditButton no={req.no} /> : null}
        <DocumentActionsMenu />
      </Toolbar>

      <CollapsibleCard title="Status">
        <div className="grid g2 dl-groups">
          <section className="dl-group">
            <div className="dl-caption">Request status</div>
            <DefinitionList items={[
              ['Request No.', <span className="mono" key="no">{req.no}</span>],
              ['Employee', <><span className="mono">{req.employee_no}</span> {req.employee_first_name} {req.employee_last_name}</>],
              ['Status', <Pill status={req.status} key="st" />],
              req.decision_reason ? ['Decision reason', req.decision_reason] : null,
            ]} />
          </section>
          <section className="dl-group">
            <div className="dl-caption">Document trail</div>
            <DefinitionList items={[
              ['Created by', req.created_by || '—'],
              ['Created on', formatDateTime(req.created_at)],
            ]} />
          </section>
        </div>
      </CollapsibleCard>

      <CollapsibleCard title="Proposed identity" sub="Passport photo and specimen signature that will replace the live ones on Apply">
        <EmployeeIdentityStrip
          employeeId={req.employee_id} editRequestNo={req.no} name={`${req.employee_first_name} ${req.employee_last_name}`}
          photoSrc={imageSrc(req.photo_image, { width: 192, height: 192, crop: 'fill' })}
          signatureSrc={imageSrc(req.signature_image, { width: 360, height: 128, crop: 'fit' })}
          canEdit={canManage} mediaEnabled={isConfigured()}
        />
      </CollapsibleCard>

      <EditBioDataCard request={req} lookups={lookups} canEdit={canManage} startEditing={startEditing} />
      <EditEmploymentBankingCard request={req} lookups={lookups} canEdit={canManage} />
      {/* The Payroll Salary Card is HR's: editable only with the module's own update right, never
          through Self Service (the server strips those fields from an employee's save as well). */}
      <EditRequestPayrollCard
        no={req.no} values={req} basicPay={contract?.salary_cents ?? null}
        lookups={{ postingGroups, currencies: currencies.map((c) => ({ code: c.code, description: c.description })), salaryScales, jobGrades }}
        canEdit={canManage && canHrUpdate}
      />

      <div className="grid g2">
        <EditNextOfKinPanel editNo={no} rows={nextOfKin} canManage={canManage} />
        <EditBeneficiariesPanel editNo={no} rows={beneficiaries} canManage={canManage} />
      </div>
      <div className="grid g2">
        <EditDependantsPanel editNo={no} rows={dependants} canManage={canManage} />
        <EditEmergencyContactsPanel editNo={no} rows={emergencyContacts} canManage={canManage} />
      </div>
      <div className="grid g2">
        <EditProfessionalBodiesPanel editNo={no} rows={professionalBodies} canManage={canManage} />
        <EditWorkHistoryPanel editNo={no} rows={workHistory} canManage={canManage} />
      </div>
      <EditBankAccountsPanel editNo={no} rows={bankAccounts} canManage={canManage} />

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
