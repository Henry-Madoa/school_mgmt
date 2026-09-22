import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, requireModuleTab, currentCanAction } from '@/lib/session';
import { getEmployeeForUser, type SelfEmployee } from '@/lib/selfService';
import { listLeaveApplications, listLeaveTypes, listLeavePlans } from '@/lib/leaveManagement';
import { listImprestRequests, listPettyCash } from '@/lib/imprest';
import { listRequisitions } from '@/lib/requisitions';
import { listEmployeeEditRequests } from '@/lib/employeeEdits';
import { getEmployee, listNextOfKin, listBankAccounts, getCurrentContract } from '@/lib/employees';
import { NewEditRequestButton } from '../../employee-edits/edit-actions';
import { imageSrc } from '@/lib/cloudinary';
import { DefinitionList } from '@/components/ui/primitives';
import { initials } from '@/lib/format';
import { listActiveEmployees } from '@/lib/employees';
import { listPayrollPeriods } from '@/lib/payroll';
import { buildPayslipDocument, buildP9Document, renderDocument } from '@/lib/payrollPrint';
import { getOrg } from '@/lib/org';
import { formatDate } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { Card, CardHead, EmptyState, Pill, TableWrap, Tabs, Toolbar, Spacer, type TabDefinition } from '@/components/ui/primitives';
import type { LeaveApplicationView2, PlanView } from '@/lib/leaveManagement';
import type { ImprestListView, PettyCashListView } from '@/lib/imprest';
import type { RequisitionListView } from '@/lib/requisitions';
import type { EmployeeEditView } from '@/lib/employeeEdits';
import { Money } from '@/components/ui/money';
import { NewLeaveApplicationButton } from '../../leave-applications/leave-application-actions';
import { NewPlanButton } from '../../leave-plans/plan-actions';
import { NewImprestButton, NewPettyCashButton } from '../../imprest/imprest-actions';
import { NewRequisitionButton } from '../../requisitions/requisition-actions';
import { imprestLookups } from '../../imprest/lookups';
import { requisitionLookups } from '../../requisitions/lookups';
import { SelfServiceDashboard } from '../dashboard';
import type { SessionUser } from '@/lib/types';
import { PrintSheets } from '@/components/ui/print-sheets';

export const dynamic = 'force-dynamic';

/**
 * Employee Self Service — the AL "SS" pages (SSPurchaseOrderList, SSBudgetPlans, ...): every
 * screen is the ordinary document list filtered to the signed-in user's own employee (User Setup
 * → Employee No.), and every New button raises a document that is theirs. The cards the rows open
 * are the modules' own; they admit the employee for their own documents (lib/selfService.ts
 * assertCanViewEmployeeDocument). The screens are reached from the side nav (grouped Payroll /
 * HR / Finance / Inventory there) rather than a tab strip — each is a page of its own here, and
 * SCREENS below is the route → page-permission table, not a menu.
 */
const TAB_PAGE: Record<string, string> = {
  // The dashboard comes with the module itself — no separate page to grant.
  dashboard: 'SELF_SERVICE',
  payslips: 'SELF_SERVICE_PAYSLIPS',
  p9: 'SELF_SERVICE_P9',
  record: 'SELF_SERVICE_RECORD',
  'employee-editing': 'SELF_SERVICE_RECORD',
  leave: 'SELF_SERVICE_LEAVE',
  'leave-plans': 'SELF_SERVICE_LEAVE_PLANS',
  imprest: 'SELF_SERVICE_IMPREST',
  'petty-cash': 'SELF_SERVICE_PETTY_CASH',
  requisitions: 'SELF_SERVICE_REQUISITIONS',
  'purchase-requisitions': 'SELF_SERVICE_REQUISITIONS',
};

/** Each screen's title — the page heading, since there is no tab strip to name it. */
const SCREENS: TabDefinition[] = [
  { key: 'dashboard', label: 'My Dashboard' },
  { key: 'payslips', label: 'My Payslips' },
  { key: 'p9', label: 'My P9 Tax Card' },
  { key: 'record', label: 'My Record' },
  { key: 'employee-editing', label: 'Employee Editing' },
  { key: 'leave', label: 'Leave Applications' },
  { key: 'leave-plans', label: 'Leave Plans' },
  { key: 'imprest', label: 'Imprest Requests & Surrenders' },
  { key: 'petty-cash', label: 'Petty Cash' },
  { key: 'requisitions', label: 'Store Requisitions' },
  { key: 'purchase-requisitions', label: 'Purchase Requisitions' },
];

export default async function SelfServicePage({ params, searchParams }: {
  params: Promise<{ tab?: string[] }>;
  searchParams: Promise<{ period?: string; year?: string; view?: string }>;
}) {
  const user = await requireAction('SELF_SERVICE_VIEW');
  const { tab: segments } = await params;
  const sp = await searchParams;
  const tab = segments?.[0] ?? 'dashboard';
  const screen = SCREENS.find((t) => t.key === tab);
  if (!screen) notFound();
  // Permission per screen (and the module root lands on the first screen the user may open).
  requireModuleTab(user, SCREENS, TAB_PAGE, tab, !segments?.[0], (k) => `/self-service/${k}`);

  const me = await getEmployeeForUser(user.id);
  const crumb = me ? `${me.employee_no} · ${me.first_name} ${me.last_name}${me.job_title ? ` · ${me.job_title}` : ''}` : 'Not yet matched to an employee';

  return (
    <Page title={screen.label} crumb={`Employee Self Service · ${crumb}`} user={user}>
      {!me ? (
        <Card>
          <EmptyState icon="🪪" title="Your login is not matched to an employee yet"
            sub="Ask an administrator to set your Employee No. under Admin Centre → User Setup. Until then there is nothing here to show." />
        </Card>
      ) : (
        <>
          {tab === 'dashboard' ? <SelfServiceDashboard user={user} me={me} /> : null}
          {tab === 'payslips' ? <PayslipsTab me={me} period={sp.period} /> : null}
          {tab === 'p9' ? <P9Tab me={me} year={sp.year} /> : null}
          {tab === 'record' ? <RecordTab me={me} /> : null}
          {tab === 'employee-editing' ? <EmployeeEditingTab me={me} view={sp.view} /> : null}
          {tab === 'leave' ? <LeaveTab me={me} user={user} view={sp.view} /> : null}
          {tab === 'leave-plans' ? <LeavePlansTab me={me} user={user} view={sp.view} /> : null}
          {tab === 'imprest' ? <ImprestTab me={me} user={user} view={sp.view} /> : null}
          {tab === 'petty-cash' ? <PettyCashTab me={me} user={user} view={sp.view} /> : null}
          {tab === 'requisitions' ? <RequisitionsTab me={me} user={user} reqType="Store Requisition" view={sp.view} /> : null}
          {tab === 'purchase-requisitions' ? <RequisitionsTab me={me} user={user} reqType="Purchase Requisition" view={sp.view} /> : null}
        </>
      )}
    </Page>
  );
}

const selfLite = (me: SelfEmployee) => ({ id: me.id, employee_no: me.employee_no, first_name: me.first_name, last_name: me.last_name });

/* ------------------------------------------------------------------ status views */

/**
 * The status strip each list screen carries — the same buckets the module's own list has
 * (Open / Pending Approval / Approved …), plus All. `?view=` on the screen's route picks one;
 * a screen opens on Open, where the employee's own drafts are.
 */
const VIEWS = {
  'employee-editing': [
    { key: 'open', label: 'Open', tone: 'info' }, { key: 'pending', label: 'Pending Approval', tone: 'warn' },
    { key: 'approved', label: 'Approved', tone: 'accent' }, { key: 'processed', label: 'Processed', tone: 'ok' }, { key: 'all', label: 'All' },
  ],
  leave: [
    { key: 'open', label: 'Open', tone: 'info' }, { key: 'pending', label: 'Pending Approval', tone: 'warn' },
    { key: 'approved', label: 'Approved', tone: 'ok' }, { key: 'processed', label: 'Processed' }, { key: 'all', label: 'All' },
  ],
  'leave-plans': [
    { key: 'open', label: 'Open', tone: 'info' }, { key: 'pending', label: 'Pending Approval', tone: 'warn' },
    { key: 'approved', label: 'Approved', tone: 'ok' }, { key: 'all', label: 'All' },
  ],
  imprest: [
    { key: 'open', label: 'Open', tone: 'info' }, { key: 'pending', label: 'Pending Approval', tone: 'warn' },
    { key: 'approved', label: 'Approved — to issue' }, { key: 'issued', label: 'Issued', tone: 'accent' }, { key: 'overdue', label: 'Overdue', tone: 'warn' },
    { key: 'surrender-pending', label: 'Surrender pending' }, { key: 'surrender-approved', label: 'Surrender approved' },
    { key: 'closed', label: 'Closed', tone: 'ok' }, { key: 'all', label: 'All' },
  ],
  'petty-cash': [
    { key: 'open', label: 'Open', tone: 'info' }, { key: 'pending', label: 'Pending Approval', tone: 'warn' },
    { key: 'approved', label: 'Approved' }, { key: 'posted', label: 'Posted' }, { key: 'paid', label: 'Paid', tone: 'ok' }, { key: 'all', label: 'All' },
  ],
  requisitions: [
    { key: 'open', label: 'Open', tone: 'info' }, { key: 'pending', label: 'Pending Approval', tone: 'warn' },
    { key: 'approved', label: 'Approved — to issue' }, { key: 'issued', label: 'Issued', tone: 'accent' }, { key: 'received', label: 'Received', tone: 'ok' }, { key: 'all', label: 'All' },
  ],
  'purchase-requisitions': [
    { key: 'open', label: 'Open', tone: 'info' }, { key: 'pending', label: 'Pending Approval', tone: 'warn' },
    { key: 'approved', label: 'Approved — under review' }, { key: 'closed', label: 'Closed', tone: 'ok' }, { key: 'all', label: 'All' },
  ],
} satisfies Record<string, TabDefinition[]>;

/** The active view key for a screen — the requested one when it exists, else Open. */
function pickView<K extends keyof typeof VIEWS>(screen: K, requested: string | undefined): string {
  const keys = VIEWS[screen].map((v) => v.key);
  return requested && keys.includes(requested) ? requested : 'open';
}

function StatusTabs({ screen, active }: { screen: keyof typeof VIEWS; active: string }) {
  return <Tabs tabs={VIEWS[screen]} active={active} hrefFor={(k) => `/self-service/${screen}?view=${k}`} />;
}

/* ------------------------------------------------------------------ payroll */

async function PayslipsTab({ me, period }: { me: SelfEmployee; period?: string }) {
  const periods = await listPayrollPeriods();
  if (!periods.length) return <Card><EmptyState icon="🧾" title="No payroll periods yet" /></Card>;
  const periodId = period ? Number(period) : periods[0].id;
  const slip = await buildPayslipDocument(periodId, me.id);
  return (
    <>
      <Toolbar>
        <div className="inline" style={{ flexWrap: 'wrap' }}>
          {periods.slice(0, 12).map((p) => (
            <Link key={p.id} href={`/self-service/payslips?period=${p.id}`} className={`btn sm ${p.id === periodId ? '' : 'ghost'}`}>{p.period_name}</Link>
          ))}
        </div>
        <Spacer />
        {slip ? <a className="btn sm" href={`/print/payslip/${me.id}-${periodId}`} target="_blank" rel="noreferrer">Print / Save as PDF</a> : null}
      </Toolbar>
      {slip ? <PrintSheets html={renderDocument(slip)} />
        : <Card><EmptyState icon="🧾" title="No payslip for this period" sub="Payroll has not been run for you in this period yet." /></Card>}
    </>
  );
}

async function P9Tab({ me, year }: { me: SelfEmployee; year?: string }) {
  const y = year || String(new Date().getFullYear());
  const years = Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - i));
  const doc = await buildP9Document(me.id, y);
  return (
    <>
      <Toolbar>
        <div className="inline">
          {years.map((yy) => <Link key={yy} href={`/self-service/p9?year=${yy}`} className={`btn sm ${yy === y ? '' : 'ghost'}`}>{yy}</Link>)}
        </div>
        <Spacer />
        {doc ? <a className="btn sm" href={`/print/p9/${me.id}-${y}`} target="_blank" rel="noreferrer">Print / Save as PDF</a> : null}
      </Toolbar>
      {doc ? <PrintSheets html={renderDocument(doc)} />
        : <Card><EmptyState icon="📄" title={`No P9 for ${y}`} sub="No payroll has been posted for you in that year." /></Card>}
    </>
  );
}

/* ------------------------------------------------------------------ my record */

/**
 * The employee's own record as HR holds it, and the way to change it: an Employee Editing
 * request (the AL Employee Change Request, raised against UserSetup."Employee No."), which is
 * approved and then applied to the live record — the live record itself stays read-only here.
 */
async function RecordTab({ me }: { me: SelfEmployee }) {
  const [emp, nok, banks, contract, requests, canRequest] = await Promise.all([
    getEmployee(me.id), listNextOfKin(me.id), listBankAccounts(me.id), getCurrentContract(me.id),
    listEmployeeEditRequests({ employeeId: me.id }), currentCanAction('SELF_SERVICE_RECORD_UPDATE'),
  ]);
  if (!emp) return <Card><EmptyState icon="🪪" title="Employee record not found" /></Card>;
  const inFlight = requests.find((r) => r.status !== 'Processed');
  const photo = imageSrc(emp.photo_image, { width: 104, height: 104, crop: 'fill' });
  return (
    <>
      <Toolbar>
        <Spacer />
        {canRequest && !inFlight ? <NewEditRequestButton employees={[selfLite(me)]} self={selfLite(me)} label="Request a change to my record" /> : null}
        {canRequest && inFlight ? <Link href={`/employee-edits/view/${inFlight.no}`} className="btn">Open my pending change request {inFlight.no}</Link> : null}
        <Link href="/self-service/employee-editing" className="btn ghost">Employee editing</Link>
      </Toolbar>
      <div className="grid">
        <Card>
          <CardHead title="My record" sub="As HR holds it — request a change under Employee editing to have it updated" />
          <div className="member-photo" style={{ marginBottom: 'var(--sp)' }}>
            {photo ? <img src={photo} alt={`${emp.first_name} ${emp.last_name}`} className="photo" /> : <div className="avatar" aria-hidden="true">{initials(`${emp.first_name} ${emp.last_name}`)}</div>}
          </div>
          <div className="grid g2">
            <DefinitionList items={[
              ['Employee No.', <span className="mono" key="no">{emp.employee_no}</span>],
              ['Name', `${emp.first_name} ${emp.middle_name ? emp.middle_name + ' ' : ''}${emp.last_name}`],
              ['Gender', emp.gender || '—'],
              ['Date of birth', emp.date_of_birth ? formatDate(emp.date_of_birth) : '—'],
              ['National ID', emp.national_id || '—'],
              ['KRA PIN', emp.kra_pin || '—'],
              ['Phone', emp.phone || '—'],
              ['Email', emp.email || '—'],
              ['Physical address', emp.physical_address || '—'],
            ]} />
            <DefinitionList items={[
              ['Payment mode', emp.payment_mode],
              ['Job title', emp.job_title || '—'],
              ['Job grade', emp.job_grade_name || '—'],
              ['Employment date', emp.employment_date ? formatDate(emp.employment_date) : '—'],
              ['Contract', contract ? `${contract.job_title || ''} from ${formatDate(contract.start_date)}` : '—'],
              ['Status', <Pill status={emp.status} key="st" />],
              ['Next of kin', nok.length ? nok.map((n) => n.full_name).join(', ') : '—'],
              ['Bank accounts', banks.length ? banks.map((b) => `${b.bank_code ?? ''} ${b.account_no}`.trim()).join(', ') : '—'],
            ]} />
          </div>
        </Card>
      </div>
    </>
  );
}

/**
 * Employee Editing, self-service side — the AL Employee Change Request list filtered to the
 * signed-in employee: every change request they have raised against their own record, and the
 * way to raise the next one (one in flight at a time).
 */
async function EmployeeEditingTab({ me, view }: { me: SelfEmployee; view?: string }) {
  const v = pickView('employee-editing', view);
  const [requests, all, canRequest] = await Promise.all([
    listEmployeeEditRequests({ employeeId: me.id, view: v === 'all' ? undefined : (v as EmployeeEditView) }),
    listEmployeeEditRequests({ employeeId: me.id }),
    currentCanAction('SELF_SERVICE_RECORD_UPDATE'),
  ]);
  const inFlight = all.find((r) => r.status !== 'Processed');
  return (
    <>
      <StatusTabs screen="employee-editing" active={v} />
      <Toolbar>
        <Link href="/self-service/record" className="btn ghost">My record</Link>
        <Spacer />
        {canRequest && !inFlight ? <NewEditRequestButton employees={[selfLite(me)]} self={selfLite(me)} label="New change request" /> : null}
        {canRequest && inFlight ? <Link href={`/employee-edits/view/${inFlight.no}`} className="btn">Open my pending request {inFlight.no}</Link> : null}
      </Toolbar>
      <Card>
        <CardHead title="My employee editing requests" sub="Each request snapshots your record, is edited on its card, approved by HR, then applied to the live record" />
        {requests.length ? (
          <TableWrap>
            <thead><tr><th>No.</th><th>Raised</th><th>Status</th><th>Decision</th></tr></thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.no}>
                  <td className="mono"><Link href={`/employee-edits/view/${r.no}`}>{r.no}</Link></td>
                  <td>{r.created_at ? formatDate(r.created_at.slice(0, 10)) : '—'}</td>
                  <td><Pill status={r.status} /></td>
                  <td className="tiny muted-cell">{r.decision_reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="✏" title="No change requests yet" sub="Use New change request to update your details." />}
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ leave */

async function LeaveTab({ me, user, view }: { me: SelfEmployee; user: SessionUser; view?: string }) {
  const v = pickView('leave', view);
  // Colleagues are still listed — as relievers, not as applicants; the applicant is locked to me.
  const [rows, canCreate, leaveTypes, colleagues] = await Promise.all([
    listLeaveApplications({ employeeId: me.id, view: v === 'all' ? undefined : (v as LeaveApplicationView2) }),
    currentCanAction('SELF_SERVICE_LEAVE_CREATE'),
    listLeaveTypes(), listActiveEmployees(),
  ]);
  return (
    <>
      <StatusTabs screen="leave" active={v} />
      <Toolbar>
        <Spacer />
        {canCreate ? <NewLeaveApplicationButton employees={colleagues} leaveTypes={leaveTypes} self={selfLite(me)} /> : null}
      </Toolbar>
      <Card>
        <CardHead title="My leave applications" sub="Applications and reimbursements you have raised — open one to send it for approval or recall it" />
        {rows.length ? (
          <TableWrap>
            <thead>
              <tr><th>No.</th><th>Leave type</th><th>Nature</th><th>Start</th><th>End</th><th className="num">Days</th><th className="num">Balance</th><th>Status</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.no}>
                  <td className="mono"><Link href={`/leave-applications/view/${r.no}`}>{r.no}</Link></td>
                  <td>{r.leave_type_name}</td>
                  <td>{r.nature === 'REIMBURSEMENT' ? 'Reimbursement' : 'Application'}</td>
                  <td>{formatDate(r.start_date)}</td>
                  <td>{formatDate(r.end_date)}</td>
                  <td className="num">{r.nature === 'REIMBURSEMENT' ? r.days_to_reimburse : r.days_applied}</td>
                  <td className="num">{r.balance}</td>
                  <td><Pill status={r.status} />{r.status === 'Open' && r.created_by !== user.username ? <span className="tiny"> (raised by HR)</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🏖" title="No leave applications yet" sub="Use New leave application to apply." />}
      </Card>
    </>
  );
}

async function LeavePlansTab({ me, user, view }: { me: SelfEmployee; user: SessionUser; view?: string }) {
  const v = pickView('leave-plans', view);
  const [rows, canCreate] = await Promise.all([listLeavePlans(v === 'all' ? undefined : (v as PlanView), me.id), currentCanAction('SELF_SERVICE_LEAVE_PLANS_CREATE')]);
  void user;
  return (
    <>
      <StatusTabs screen="leave-plans" active={v} />
      <Toolbar>
        <Spacer />
        {canCreate ? <NewPlanButton employees={[selfLite(me)]} self={selfLite(me)} /> : null}
      </Toolbar>
      <Card>
        <CardHead title="My leave plans" sub="Planned leave windows for the current leave calendar" />
        {rows.length ? (
          <TableWrap>
            <thead><tr><th>No.</th><th>Created</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.no}>
                  <td className="mono"><Link href={`/leave-plans/view/${p.no}`}>{p.no}</Link></td>
                  <td>{p.created_at ? formatDate(p.created_at.slice(0, 10)) : '—'}</td>
                  <td><Pill status={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🗓" title="No leave plans yet" sub="Start one, then add the windows you plan to be away." />}
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ staff cash desk */

async function ImprestTab({ me, user, view }: { me: SelfEmployee; user: SessionUser; view?: string }) {
  const v = pickView('imprest', view);
  const [rows, canCreate] = await Promise.all([listImprestRequests({ employeeId: me.id, view: v as ImprestListView }), currentCanAction('SELF_SERVICE_IMPREST_CREATE')]);
  const lookups = canCreate ? { ...(await imprestLookups()), employees: [selfLite(me)], self: selfLite(me) } : null;
  void user;
  return (
    <>
      <StatusTabs screen="imprest" active={v} />
      <Toolbar>
        <Spacer />
        {lookups ? <NewImprestButton lookups={lookups} /> : null}
      </Toolbar>
      <Card>
        <CardHead title="My imprests" sub="Requests you have raised; once issued, open one to surrender it" />
        {rows.length ? (
          <TableWrap>
            <thead><tr><th>No.</th><th>Date</th><th>Purpose</th><th className="num">Amount</th><th>Request</th><th>Issued</th><th>Surrender</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.no}>
                  <td className="mono"><Link href={`/imprest/view/${r.no}`}>{r.no}</Link></td>
                  <td>{formatDate(r.request_date)}</td>
                  <td>{r.purpose}</td>
                  <td className="num"><Money cents={r.request_amount} /></td>
                  <td><Pill status={r.status} /></td>
                  <td>{r.posted ? <Pill tone="ok">Issued</Pill> : <span className="tiny muted-cell">—</span>}</td>
                  <td>{r.posted ? (r.surrendered ? <Pill tone="ok">Surrendered</Pill> : <Pill status={r.surrender_status} />) : <span className="tiny muted-cell">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="💼" title="No imprest requests yet" sub="Use New imprest request to ask for an advance against a purpose." />}
      </Card>
    </>
  );
}

async function PettyCashTab({ me, user, view }: { me: SelfEmployee; user: SessionUser; view?: string }) {
  const v = pickView('petty-cash', view);
  const [rows, canCreate, org] = await Promise.all([listPettyCash(v as PettyCashListView, '', me.id), currentCanAction('SELF_SERVICE_PETTY_CASH_CREATE'), getOrg()]);
  const lookups = canCreate ? { ...(await imprestLookups()), employees: [selfLite(me)], self: selfLite(me) } : null;
  const limit = Number(org?.petty_cash_limit ?? 0);
  void user;
  return (
    <>
      <StatusTabs screen="petty-cash" active={v} />
      <Toolbar>
        <Spacer />
        {lookups ? <NewPettyCashButton lookups={lookups} limit={limit} /> : null}
      </Toolbar>
      <Card>
        <CardHead title="My petty cash" sub={`Small expenses paid from a petty cash float${limit ? ` — up to ${(limit / 100).toLocaleString()} each` : ''}`} />
        {rows.length ? (
          <TableWrap>
            <thead><tr><th>No.</th><th>Date</th><th>Narration</th><th className="num">Amount</th><th>Status</th><th>Paid</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.no}>
                  <td className="mono"><Link href={`/imprest/petty-cash/${p.no}`}>{p.no}</Link></td>
                  <td>{formatDate(p.request_date)}</td>
                  <td>{p.payment_narration}</td>
                  <td className="num"><Money cents={p.total_amount} /></td>
                  <td><Pill status={p.status} /></td>
                  <td>{p.posted ? <Pill tone="ok">Posted</Pill> : <span className="tiny muted-cell">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="💵" title="No petty cash requests yet" />}
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ requisitions */

async function RequisitionsTab({ me, user, reqType, view }: { me: SelfEmployee; user: SessionUser; reqType: 'Store Requisition' | 'Purchase Requisition'; view?: string }) {
  const screen = reqType === 'Store Requisition' ? 'requisitions' : 'purchase-requisitions';
  const v = pickView(screen, view);
  const [rows, canCreate] = await Promise.all([listRequisitions(reqType, v as RequisitionListView, '', me.id), currentCanAction('SELF_SERVICE_REQUISITIONS_CREATE')]);
  const lookups = canCreate ? { ...(await requisitionLookups()), employees: [selfLite(me)], self: selfLite(me) } : null;
  void user;
  return (
    <>
      <StatusTabs screen={screen} active={v} />
      <Toolbar>
        <Spacer />
        {lookups ? <NewRequisitionButton type={reqType} lookups={lookups} /> : null}
      </Toolbar>
      <Card>
        <CardHead title={reqType === 'Store Requisition' ? 'My store requisitions' : 'My purchase requisitions'}
          sub={reqType === 'Store Requisition' ? 'Items you have asked the store to issue' : 'Goods or services you have asked procurement to buy'} />
        {rows.length ? (
          <TableWrap>
            <thead><tr><th>No.</th><th>Date</th><th>Title</th><th className="num">Qty</th><th className="num">Amount</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.no}>
                  <td className="mono"><Link href={`/requisitions/view/${r.no}`}>{r.no}</Link></td>
                  <td>{formatDate(r.requisition_date)}</td>
                  <td>{r.title}</td>
                  <td className="num">{r.total_quantity}</td>
                  <td className="num"><Money cents={r.total_amount} /></td>
                  <td><Pill status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="📋" title={`No ${reqType.toLowerCase()}s yet`} />}
      </Card>
    </>
  );
}
