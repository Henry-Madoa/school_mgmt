import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import { listEmployees, hasAnyEmployees, EMPLOYEE_FILTER_FIELDS, type EmployeeListView } from '@/lib/employees';
import { listJobGrades } from '@/lib/hrSetup';
import { listDimensionValues } from '@/lib/pool';
import { getDimensionCaptions } from '@/lib/org';
import { parseFilters } from '@/lib/listFilters';
import { parseSort } from '@/lib/listSort';
import { Page } from '@/components/layout/page';
import {
  Card, EmptyState, Pill, TableWrap, Tabs, Toolbar, Spacer, type TabDefinition,
} from '@/components/ui/primitives';
import { SearchInput } from '@/components/ui/filters';
import { DynamicFilterBar } from '@/components/ui/dynamic-filter';
import { SortLink } from '@/components/ui/sort-link';
import { SubmitButton } from '../employee-actions';

const TABS: TabDefinition[] = [
  { key: 'new', label: 'New', tone: 'info' },
  { key: 'pending', label: 'Pending Approval', tone: 'warn' },
  { key: 'active', label: 'Active', tone: 'ok' },
  { key: 'inactive', label: 'Inactive / Terminated' },
  { key: 'all', label: 'All' },
];

export default async function EmployeesPage({ params, searchParams }: {
  params: Promise<{ tab?: string[] }>;
  searchParams: Promise<{ q?: string; filters?: string; sort?: string }>;
}) {
  const user = await requireAction('EMPLOYEES_READ');
  const { tab: segments } = await params;
  const { q = '', filters: filtersRaw, sort: sortRaw } = await searchParams;
  const filters = parseFilters(filtersRaw);
  const sort = parseSort(sortRaw);

  const requested = segments?.[0];
  if (requested && !TABS.some((t) => t.key === requested)) notFound();
  const tab = (requested ?? 'new') as EmployeeListView;

  const [rows, empty, canCreate, gd1Values, gd2Values, { caption1, caption2 }, jobGrades] = await Promise.all([
    listEmployees({ view: tab, search: q, filters, sort }),
    hasAnyEmployees(tab).then((any) => !any),
    currentCanAction('EMPLOYEES_CREATE'),
    listDimensionValues(1), listDimensionValues(2), getDimensionCaptions(), listJobGrades(),
  ]);
  const fields = EMPLOYEE_FILTER_FIELDS.map((f) => (
    f.key === 'global_dimension_1_id' ? { ...f, label: caption1, options: gd1Values.map((d) => ({ value: d.id, label: `${d.code} — ${d.name}` })) }
      : f.key === 'global_dimension_2_id' ? { ...f, label: caption2, options: gd2Values.map((d) => ({ value: d.id, label: `${d.code} — ${d.name}` })) }
        : f.key === 'job_grade_id' ? { ...f, options: jobGrades.map((g) => ({ value: g.id, label: g.name })) }
          : f
  ));

  return (
    <Page title="Employees" crumb="Staff master — onboarding, bio-data and sub-entities" user={user}>
      <Tabs tabs={TABS} active={tab} hrefFor={(k) => `/employees/${k}`} />
      <Toolbar>
        <SearchInput placeholder="Search name, employee no. or national ID…" disabled={empty} />
        <DynamicFilterBar fields={fields} disabled={empty} />
        <Spacer />
        {canCreate ? <Link href="/employees/new" className="btn">New employee</Link> : null}
      </Toolbar>

      <Card>
        {rows.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th><SortLink sortKey="employee_no">Employee No.</SortLink></th>
                <th><SortLink sortKey="name">Name</SortLink></th>
                <th><SortLink sortKey="gd2">{caption2}</SortLink></th>
                <th>Job Title</th>
                <th><SortLink sortKey="employment_date">Employment Date</SortLink></th>
                <th><SortLink sortKey="status">Status</SortLink></th>
                <th className="num" />
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                return (
                  <tr key={e.id}>
                    <td className="mono"><Link href={`/employees/view/${e.id}?view=${tab}`}>{e.employee_no}</Link></td>
                    <td><b>{e.first_name} {e.last_name}</b></td>
                    <td>{e.global_dimension_2_name || '—'}</td>
                    <td>{e.job_title || '—'}</td>
                    <td>{e.employment_date}</td>
                    <td><Pill status={e.status} /></td>
                    <td className="num">
                      {e.status === 'NEW' && canCreate ? <SubmitButton id={e.id} /> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🧑‍💼" title="No employees here" />}
      </Card>
    </Page>
  );
}
