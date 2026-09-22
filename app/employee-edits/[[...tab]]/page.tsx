import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import { listEmployeeEditRequests, hasAnyEmployeeEditRequests, EDIT_FILTER_FIELDS, type EmployeeEditView } from '@/lib/employeeEdits';
import { listActiveEmployees } from '@/lib/employees';
import { listDimensionValues } from '@/lib/pool';
import { getDimensionCaptions } from '@/lib/org';
import { parseFilters } from '@/lib/listFilters';
import { parseSort } from '@/lib/listSort';
import { Page } from '@/components/layout/page';
import { Card, EmptyState, Pill, TableWrap, Tabs, Toolbar, Spacer, type TabDefinition } from '@/components/ui/primitives';
import { SearchInput } from '@/components/ui/filters';
import { DynamicFilterBar } from '@/components/ui/dynamic-filter';
import { SortLink } from '@/components/ui/sort-link';
import { NewEditRequestButton, SubmitEditButton, DeleteEditButton, CancelEditApprovalButton, ApplyEditButton } from '../edit-actions';

const TABS: TabDefinition[] = [
  { key: 'open', label: 'Open', tone: 'info' },
  { key: 'pending', label: 'Pending Approval', tone: 'warn' },
  { key: 'approved', label: 'Approved', tone: 'accent' },
  { key: 'processed', label: 'Processed', tone: 'ok' },
];

export default async function EmployeeEditsPage({ params, searchParams }: {
  params: Promise<{ tab?: string[] }>;
  searchParams: Promise<{ q?: string; filters?: string; sort?: string; new?: string }>;
}) {
  const user = await requireAction('EMPLOYEE_EDITS_READ');
  const { tab: segments } = await params;
  const { q = '', filters: filtersRaw, sort: sortRaw, new: newFor } = await searchParams;
  const filters = parseFilters(filtersRaw);
  const sort = parseSort(sortRaw);

  const requested = segments?.[0];
  if (requested && !TABS.some((t) => t.key === requested)) notFound();
  const tab = (requested ?? 'open') as EmployeeEditView;

  const [rows, empty, canUpdate, canApprove, canDelete, employees, gd1Values, gd2Values, { caption1, caption2 }] = await Promise.all([
    listEmployeeEditRequests({ view: tab, search: q, filters, sort }),
    hasAnyEmployeeEditRequests(tab).then((any) => !any),
    currentCanAction('EMPLOYEE_EDITS_UPDATE'),
    currentCanAction('EMPLOYEE_EDITS_APPROVE'),
    currentCanAction('EMPLOYEE_EDITS_DELETE'),
    listActiveEmployees(),
    listDimensionValues(1), listDimensionValues(2), getDimensionCaptions(),
  ]);
  const fields = EDIT_FILTER_FIELDS.map((f) => (
    f.key === 'global_dimension_1_id' ? { ...f, label: caption1, options: gd1Values.map((d) => ({ value: d.id, label: `${d.code} — ${d.name}` })) }
      : f.key === 'global_dimension_2_id' ? { ...f, label: caption2, options: gd2Values.map((d) => ({ value: d.id, label: `${d.code} — ${d.name}` })) }
        : f
  ));

  return (
    <Page title="Employee Editing" crumb="Maker-checker changes to an active employee's details" user={user}>
      <Tabs tabs={TABS} active={tab} hrefFor={(k) => `/employee-edits/${k}`} />
      <Toolbar>
        <SearchInput placeholder="Search request no. or employee…" disabled={empty} />
        <DynamicFilterBar fields={fields} disabled={empty} />
        <Spacer />
        {canUpdate ? <NewEditRequestButton employees={employees} initialEmployeeId={Number(newFor) || null} autoOpen={!!Number(newFor)} /> : null}
      </Toolbar>

      <Card>
        {rows.length ? (
          <TableWrap>
            <thead>
              <tr><th>Request No.</th><th>Employee</th><th>Status</th><th className="num" /></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isOwn = r.created_by === user.username;
                return (
                  <tr key={r.no}>
                    <td className="mono"><Link href={`/employee-edits/view/${r.no}?view=${tab}`}>{r.no}</Link></td>
                    <td><b>{r.employee_first_name} {r.employee_last_name}</b><div className="tiny mono">{r.employee_no}</div></td>
                    <td><Pill status={r.status} /></td>
                    <td className="num">
                      {r.status === 'Open' && canDelete && isOwn ? <DeleteEditButton no={r.no} /> : null}
                      {r.status === 'Open' && canUpdate && isOwn ? <SubmitEditButton no={r.no} /> : null}
                      {r.status === 'Pending Approval' && canUpdate && isOwn ? <CancelEditApprovalButton no={r.no} /> : null}
                      {r.status === 'Approved' && canApprove ? <ApplyEditButton no={r.no} /> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="✏" title="No edit requests here" />}
      </Card>
    </Page>
  );
}
