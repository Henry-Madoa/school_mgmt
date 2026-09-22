import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import { listExits, hasAnyExits, EXIT_FILTER_FIELDS, type ExitView } from '@/lib/employeeExits';
import { listActiveEmployees } from '@/lib/employees';
import { listTerminationReasons } from '@/lib/hrSetup';
import { parseFilters } from '@/lib/listFilters';
import { parseSort } from '@/lib/listSort';
import { Page } from '@/components/layout/page';
import { Card, EmptyState, Pill, TableWrap, Tabs, Toolbar, Spacer, type TabDefinition } from '@/components/ui/primitives';
import { SearchInput } from '@/components/ui/filters';
import { DynamicFilterBar } from '@/components/ui/dynamic-filter';
import { NewExitButton, SubmitButton, CancelApprovalButton } from '../exit-actions';

const TABS: TabDefinition[] = [
  { key: 'open', label: 'Open', tone: 'info' },
  { key: 'pending', label: 'Pending Approval', tone: 'warn' },
  { key: 'approved', label: 'Approved', tone: 'ok' },
];

export default async function EmployeeExitsPage({ params, searchParams }: {
  params: Promise<{ tab?: string[] }>;
  searchParams: Promise<{ q?: string; filters?: string; sort?: string }>;
}) {
  const user = await requireAction('EMPLOYEE_EXITS_READ');
  const { tab: segments } = await params;
  const { q = '', filters: filtersRaw, sort: sortRaw } = await searchParams;
  const filters = parseFilters(filtersRaw);
  const sort = parseSort(sortRaw);

  const requested = segments?.[0];
  if (requested && !TABS.some((t) => t.key === requested)) notFound();
  const tab = (requested ?? 'open') as ExitView;

  const [rows, empty, canCreate, employees, reasons] = await Promise.all([
    listExits({ view: tab, search: q, filters, sort }),
    hasAnyExits(tab).then((any) => !any),
    currentCanAction('EMPLOYEE_EXITS_CREATE'),
    listActiveEmployees(), listTerminationReasons(),
  ]);

  return (
    <Page title="Employee Exits" crumb="Offboarding, final dues and clearance" user={user}>
      <Tabs tabs={TABS} active={tab} hrefFor={(k) => `/employee-exits/${k}`} />
      <Toolbar>
        <SearchInput placeholder="Search exit no. or employee…" disabled={empty} />
        <DynamicFilterBar fields={EXIT_FILTER_FIELDS} disabled={empty} />
        <Spacer />
        {canCreate ? <NewExitButton employees={employees} reasons={reasons} /> : null}
      </Toolbar>

      <Card>
        {rows.length ? (
          <TableWrap>
            <thead>
              <tr><th>No.</th><th>Employee</th><th>Date of exit</th><th>Cleared</th><th>Status</th><th className="num" /></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isOwn = r.created_by === user.username;
                return (
                  <tr key={r.no}>
                    <td className="mono"><Link href={`/employee-exits/view/${r.no}?view=${tab}`}>{r.no}</Link></td>
                    <td><b>{r.employee_first_name} {r.employee_last_name}</b><div className="tiny mono">{r.employee_no}</div></td>
                    <td>{r.date_of_exit || '—'}</td>
                    <td>{r.cleared ? <Pill tone="ok">Cleared</Pill> : '—'}</td>
                    <td><Pill status={r.status} /></td>
                    <td className="num">
                      {r.status === 'Open' && canCreate && isOwn ? <SubmitButton no={r.no} /> : null}
                      {r.status === 'Pending Approval' && canCreate && isOwn ? <CancelApprovalButton no={r.no} /> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🚪" title="No employee exits here" />}
      </Card>
    </Page>
  );
}
