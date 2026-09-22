import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import { hasAnyRow } from '@/lib/db';
import {
  getEmployee, getAdjacentEmployeeIds, listActiveEmployees, listNextOfKin, listBeneficiaries, listDependants,
  listEmergencyContacts, listProfessionalBodies, listWorkHistory, listBankAccounts, listContracts,
  type EmployeeListView,
} from '@/lib/employees';
import { listJobGrades, listContractTypes } from '@/lib/hrSetup';
import { listApprovedJobs } from '@/lib/companyJobs';
import { listPostingGroups } from '@/lib/payrollSetup';
import { listCurrencies } from '@/lib/cashMgmtSetup';
import { listSalaryScales } from '@/lib/salaryScales';
import { EmployeePayrollCard } from '../../payroll-salary-card-bindings';
import { listCounties, listSubCounties, listDimensionValues } from '@/lib/pool';
import { getDimensionCaptions } from '@/lib/org';
import { findPendingRoutedTask, isEligibleApprover, listWorkflowTasksForDocument } from '@/lib/workflow';
import { formatDateTime } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { DefinitionList, EmptyState, Pill, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { Money } from '@/components/ui/money';
import { DocumentActionsMenu } from '@/components/ui/document-actions';
import { CardNav } from '@/components/ui/card-nav';
import {
  DeleteButton, SubmitButton, CancelApprovalButton, ApproveButton, RejectButton, DelegateButton,
  type EmployeeLookups,
} from '../../employee-actions';
import { BioDataCard, EmploymentCard, BankingCard } from '../../employee-info-cards';
import { EmployeeIdentityStrip } from '../../employee-media';
import { imageSrc, isConfigured } from '@/lib/cloudinary';
import {
  NextOfKinPanel, BeneficiariesPanel, DependantsPanel, EmergencyContactsPanel,
  ProfessionalBodiesPanel, WorkHistoryPanel, BankAccountsPanel,
} from '../../sub-entity-panels';

const VIEWS: EmployeeListView[] = ['new', 'pending', 'active', 'inactive', 'all'];

export default async function EmployeeDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string; edit?: string }>;
}) {
  const user = await requireAction('EMPLOYEES_READ');
  const { id: idParam } = await params;
  const id = Number(idParam);
  const { view: viewRaw, edit } = await searchParams;
  const view = VIEWS.includes(viewRaw as EmployeeListView) ? (viewRaw as EmployeeListView) : undefined;
  const startEditing = edit === '1';

  const emp = await getEmployee(id);
  if (!emp) notFound();

  const [
    canCreate, canApprove, canEditRequests, tasks, { prevId, nextId }, gd1Values, gd2Values, { caption1, caption2 },
    jobGrades, contractTypes, counties, subCounties,
    managers, companyJobs, nextOfKin, beneficiaries, dependants, emergencyContacts, professionalBodies, workHistory, bankAccounts, contracts,
  ] = await Promise.all([
    currentCanAction('EMPLOYEES_CREATE'),
    currentCanAction('EMPLOYEES_APPROVE'),
    currentCanAction('EMPLOYEE_EDITS_UPDATE'),
    listWorkflowTasksForDocument('EMPLOYEE_ONBOARDING', String(id)),
    getAdjacentEmployeeIds(id, view),
    listDimensionValues(1), listDimensionValues(2), getDimensionCaptions(),
    listJobGrades(), listContractTypes(), listCounties(), listSubCounties(), listActiveEmployees(), listApprovedJobs(),
    listNextOfKin(id), listBeneficiaries(id), listDependants(id), listEmergencyContacts(id),
    listProfessionalBodies(id), listWorkHistory(id), listBankAccounts(id), listContracts(id),
  ]);
  const [postingGroups, currencies, salaryScales, isTeacher, isDriver, canTransport] = await Promise.all([
    listPostingGroups(), listCurrencies(), listSalaryScales(),
    hasAnyRow('teacher_profile', 'employee_id = ?', id), hasAnyRow('driver_profile', 'employee_id = ?', id), currentCanAction('TRANSPORT_READ'),
  ]);
  const lookups: EmployeeLookups = {
    globalDimension1Values: gd1Values, globalDimension2Values: gd2Values, caption1, caption2,
    jobGrades, contractTypes, counties, subCounties, managers, companyJobs,
  };

  const isOwn = emp.created_by === user.username;
  const isNew = emp.status === 'NEW';
  // A New record — freshly captured, rejected or recalled — is editable by anyone who may create
  // employees, not only its original creator. Once approved the card is read-only: changes to an
  // Active employee go through Employee Editing (a change request, approved, then applied).
  const canManageSubEntities = isNew && canCreate;
  const isApproved = emp.status === 'ACTIVE' || emp.status === 'ON_LEAVE';

  const routedTask = emp.status === 'PENDING_APPROVAL' ? await findPendingRoutedTask('EMPLOYEE_ONBOARDING', String(id)) : null;
  const canDecideThis = routedTask ? await isEligibleApprover(routedTask, user.id) : canApprove;
  const requestedBy = routedTask?.requested_by ?? emp.created_by;
  const canCancelThis = canCreate && requestedBy === user.username;
  const pendingWith = tasks.find((t) => t.status === 'PENDING')?.pending_with;
  const q = view ? `?view=${view}` : '';

  return (
    <>
      <CardNav prevHref={prevId ? `/employees/view/${prevId}${q}` : null} nextHref={nextId ? `/employees/view/${nextId}${q}` : null} />
      <Page
        title={`${emp.first_name} ${emp.last_name} — ${emp.employee_no}`}
        crumb={`${emp.status}${emp.global_dimension_2_name ? ` · ${emp.global_dimension_2_name}` : ''}${pendingWith ? ` · pending with ${pendingWith}` : ''}`}
        user={user}
      >
        <Toolbar>
          <Link href="/employees" className="btn ghost sm">← All employees</Link>
          <Spacer />
          {isTeacher ? <Link href={`/teachers/${emp.id}`} className="btn ghost">Teacher profile</Link> : null}
          {isDriver && canTransport ? <Link href={`/transport/drivers/${emp.id}`} className="btn ghost">Driver profile</Link> : null}
          {isNew && canCreate && isOwn ? <DeleteButton id={emp.id} className="btn ghost" /> : null}
          {isNew && canCreate ? <SubmitButton id={emp.id} className="btn ghost" /> : null}
          {isApproved && canEditRequests ? <Link href={`/employee-edits?new=${emp.id}`} className="btn ghost">Request a change (Employee Editing)</Link> : null}
          {emp.status === 'PENDING_APPROVAL' && canCancelThis ? <CancelApprovalButton id={emp.id} className="btn ghost" /> : null}
          {emp.status === 'PENDING_APPROVAL' && canDecideThis ? (
            <>
              {routedTask ? <DelegateButton taskId={routedTask.id} className="btn ghost" /> : null}
              <ApproveButton id={emp.id} />
              <RejectButton id={emp.id} className="btn ghost" />
            </>
          ) : null}
          <DocumentActionsMenu />
        </Toolbar>

        <CollapsibleCard title="Status" sub={isNew ? 'New — the card is editable; send it for approval when it is complete' : isApproved ? 'Approved and Active — the card is read-only; changes are made through an Employee Editing request' : undefined}>
          <div className="grid g2 dl-groups">
            <section className="dl-group">
              <div className="dl-caption">Record status</div>
              <DefinitionList items={[
                ['Employee No.', <span className="mono" key="no">{emp.employee_no}</span>],
                ['Status', <Pill status={emp.status} key="st" />],
                emp.decision_reason ? ['Decision reason', emp.decision_reason] : null,
              ]} />
            </section>
            <section className="dl-group">
              <div className="dl-caption">Document trail</div>
              <DefinitionList items={[
                ['Created by', emp.created_by || '—'],
                ['Created on', formatDateTime(emp.created_at)],
              ]} />
            </section>
          </div>
        </CollapsibleCard>

        <CollapsibleCard title="Identity" sub={isNew ? 'Passport photo and specimen signature — upload them while the record is New' : 'Passport photo and specimen signature — fixed once the record is approved'}>
          <EmployeeIdentityStrip
            employeeId={emp.id} name={`${emp.first_name} ${emp.last_name}`}
            photoSrc={imageSrc(emp.photo_image, { width: 192, height: 192, crop: 'fill' })}
            signatureSrc={imageSrc(emp.signature_image, { width: 360, height: 128, crop: 'fit' })}
            canEdit={canManageSubEntities} mediaEnabled={isConfigured()}
          />
        </CollapsibleCard>

        <BioDataCard employee={emp} lookups={lookups} canEdit={canManageSubEntities} startEditing={startEditing} />
        <EmploymentCard employee={emp} lookups={lookups} canEdit={canManageSubEntities} />
        <BankingCard employee={emp} canEdit={canManageSubEntities} />
        <EmployeePayrollCard
          employeeId={emp.id} values={emp} basicPay={contracts.find((c) => c.is_current)?.salary_cents ?? contracts[0]?.salary_cents ?? null}
          cumulative={null} lookups={{ postingGroups, currencies: currencies.map((c) => ({ code: c.code, description: c.description })), salaryScales, jobGrades }}
          canEdit={canManageSubEntities}
        />

        <CollapsibleCard title="Contract history" sub={`${contracts.length} contract record${contracts.length === 1 ? '' : 's'}`}>
          {contracts.length ? (
            <TableWrap>
              <thead><tr><th>Start</th><th>End</th><th>Job title</th><th className="num">Salary</th><th>Current</th></tr></thead>
              <tbody>
                {contracts.map((c) => (
                  <tr key={c.id}>
                    <td>{c.start_date}</td>
                    <td>{c.end_date || '—'}</td>
                    <td>{c.job_title || '—'}</td>
                    <td className="num"><Money cents={c.salary_cents} /></td>
                    <td>{c.is_current ? <Pill tone="ok">Current</Pill> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          ) : <EmptyState icon="📄" title="No contract recorded yet — opens automatically on approval" />}
        </CollapsibleCard>

        <div className="grid g2">
          <NextOfKinPanel employeeId={id} rows={nextOfKin} canManage={canManageSubEntities} />
          <BeneficiariesPanel employeeId={id} rows={beneficiaries} canManage={canManageSubEntities} />
        </div>
        <div className="grid g2">
          <DependantsPanel employeeId={id} rows={dependants} canManage={canManageSubEntities} />
          <EmergencyContactsPanel employeeId={id} rows={emergencyContacts} canManage={canManageSubEntities} />
        </div>
        <div className="grid g2">
          <ProfessionalBodiesPanel employeeId={id} rows={professionalBodies} canManage={canManageSubEntities} />
          <WorkHistoryPanel employeeId={id} rows={workHistory} canManage={canManageSubEntities} />
        </div>
        <BankAccountsPanel employeeId={id} rows={bankAccounts} canManage={canManageSubEntities} />

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
    </>
  );
}
