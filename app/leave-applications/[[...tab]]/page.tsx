import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import {
  listLeaveApplications, hasAnyLeaveApplications, listLeaveTypes, LEAVE_APPLICATION_FILTER_FIELDS,
  type LeaveApplicationView2,
} from '@/lib/leaveManagement';
import { listActiveEmployees } from '@/lib/employees';
import { parseFilters } from '@/lib/listFilters';
import { parseSort } from '@/lib/listSort';
import { Page } from '@/components/layout/page';
import { Card, EmptyState, Pill, TableWrap, Tabs, Toolbar, Spacer, type TabDefinition } from '@/components/ui/primitives';
import { SearchInput } from '@/components/ui/filters';
import { DynamicFilterBar } from '@/components/ui/dynamic-filter';
import { NewLeaveApplicationButton, SubmitButton, CancelApprovalButton, DeleteButton } from '../leave-application-actions';

const TABS: TabDefinition[] = [
  { key: 'open', label: 'Open', tone: 'info' },
  { key: 'pending', label: 'Pending Approval', tone: 'warn' },
  { key: 'approved', label: 'Approved', tone: 'ok' },
];

export default async function LeaveApplicationsPage({ params, searchParams }: {
  params: Promise<{ tab?: string[] }>;
  searchParams: Promise<{ q?: string; filters?: string; sort?: string }>;
}) {
  const user = await requireAction('LEAVE_APPLICATIONS_READ');
  const { tab: segments } = await params;
  const { q = '', filters: filtersRaw, sort: sortRaw } = await searchParams;
  const filters = parseFilters(filtersRaw);
  const sort = parseSort(sortRaw);

  const requested = segments?.[0];
  if (requested && !TABS.some((t) => t.key === requested)) notFound();
  const tab = (requested ?? 'open') as LeaveApplicationView2;

  const [rows, empty, canCreate, employees, leaveTypes] = await Promise.all([
    listLeaveApplications({ view: tab, search: q, filters, sort }),
    hasAnyLeaveApplications(tab).then((any) => !any),
    currentCanAction('LEAVE_APPLICATIONS_CREATE'),
    listActiveEmployees(), listLeaveTypes(),
  ]);
  const fields = LEAVE_APPLICATION_FILTER_FIELDS.map((f) => (
    f.key === 'leave_type_id' ? { ...f, options: leaveTypes.map((t) => ({ value: t.id, label: t.name })) } : f
  ));

  return (
    <Page title="Leave Applications" crumb="Apply for, reimburse and track leave" user={user}>
      <Tabs tabs={TABS} active={tab} hrefFor={(k) => `/leave-applications/${k}`} />
      <Toolbar>
        <SearchInput placeholder="Search application no. or employee…" disabled={empty} />
        <DynamicFilterBar fields={fields} disabled={empty} />
        <Spacer />
        {canCreate ? <NewLeaveApplicationButton employees={employees} leaveTypes={leaveTypes} /> : null}
      </Toolbar>

      <Card>
        {rows.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th>No.</th><th>Employee</th><th>Leave Type</th><th>Nature</th>
                <th>Start</th><th>End</th><th className="num">Days</th><th className="num">Balance</th><th>Status</th><th className="num" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isOwn = r.created_by === user.username;
                return (
                  <tr key={r.no}>
                    <td className="mono"><Link href={`/leave-applications/view/${r.no}?view=${tab}`}>{r.no}</Link></td>
                    <td><b>{r.employee_first_name} {r.employee_last_name}</b><div className="tiny mono">{r.employee_no}</div></td>
                    <td>{r.leave_type_name}</td>
                    <td>{r.nature === 'REIMBURSEMENT' ? 'Reimbursement' : 'Application'}</td>
                    <td>{r.start_date}</td>
                    <td>{r.end_date}</td>
                    <td className="num">{r.nature === 'REIMBURSEMENT' ? r.days_to_reimburse : r.days_applied}</td>
                    <td className="num">{r.balance}</td>
                    <td><Pill status={r.status} /></td>
                    <td className="num">
                      {r.status === 'Open' && canCreate && isOwn ? <>
                        <DeleteButton no={r.no} />{' '}<SubmitButton no={r.no} />
                      </> : null}
                      {r.status === 'Pending Approval' && canCreate && isOwn ? <CancelApprovalButton no={r.no} /> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🏖" title="No leave applications here" />}
      </Card>
    </Page>
  );
}
