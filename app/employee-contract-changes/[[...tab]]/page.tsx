import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import {
  listContractChanges, hasAnyContractChanges, CONTRACT_CHANGE_FILTER_FIELDS, type ContractChangeView,
} from '@/lib/employeeContractChanges';
import { listActiveEmployees } from '@/lib/employees';
import { listContractTypes, listJobGrades } from '@/lib/hrSetup';
import { parseFilters } from '@/lib/listFilters';
import { parseSort } from '@/lib/listSort';
import { Page } from '@/components/layout/page';
import { Card, EmptyState, Pill, TableWrap, Tabs, Toolbar, Spacer, type TabDefinition } from '@/components/ui/primitives';
import { SearchInput } from '@/components/ui/filters';
import { DynamicFilterBar } from '@/components/ui/dynamic-filter';
import { Money } from '@/components/ui/money';
import { NewContractChangeButton, SubmitButton, CancelApprovalButton, DeleteButton } from '../contract-change-actions';

const TABS: TabDefinition[] = [
  { key: 'open', label: 'Open', tone: 'info' },
  { key: 'pending', label: 'Pending Approval', tone: 'warn' },
  { key: 'approved', label: 'Approved', tone: 'ok' },
];

const NATURE_LABELS: Record<string, string> = { NEW_CONTRACT: 'New Contract', RENEWAL: 'Renewal', SALARY_INCREMENT: 'Salary Increment' };

export default async function ContractChangesPage({ params, searchParams }: {
  params: Promise<{ tab?: string[] }>;
  searchParams: Promise<{ q?: string; filters?: string; sort?: string }>;
}) {
  const user = await requireAction('EMPLOYEE_CONTRACT_CHANGES_READ');
  const { tab: segments } = await params;
  const { q = '', filters: filtersRaw, sort: sortRaw } = await searchParams;
  const filters = parseFilters(filtersRaw);
  const sort = parseSort(sortRaw);

  const requested = segments?.[0];
  if (requested && !TABS.some((t) => t.key === requested)) notFound();
  const tab = (requested ?? 'open') as ContractChangeView;

  const [rows, empty, canCreate, employees, contractTypes, grades] = await Promise.all([
    listContractChanges({ view: tab, search: q, filters, sort }),
    hasAnyContractChanges(tab).then((any) => !any),
    currentCanAction('EMPLOYEE_CONTRACT_CHANGES_CREATE'),
    listActiveEmployees(), listContractTypes(), listJobGrades(),
  ]);

  return (
    <Page title="Employee Contract / Salary Changes" crumb="New contracts, renewals and salary increments" user={user}>
      <Tabs tabs={TABS} active={tab} hrefFor={(k) => `/employee-contract-changes/${k}`} />
      <Toolbar>
        <SearchInput placeholder="Search request no. or employee…" disabled={empty} />
        <DynamicFilterBar fields={CONTRACT_CHANGE_FILTER_FIELDS} disabled={empty} />
        <Spacer />
        {canCreate ? <NewContractChangeButton employees={employees} contractTypes={contractTypes} grades={grades} /> : null}
      </Toolbar>

      <Card>
        {rows.length ? (
          <TableWrap>
            <thead>
              <tr><th>No.</th><th>Employee</th><th>Nature</th><th className="num">Proposed salary</th><th>Status</th><th className="num" /></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isOwn = r.created_by === user.username;
                return (
                  <tr key={r.no}>
                    <td className="mono"><Link href={`/employee-contract-changes/view/${r.no}?view=${tab}`}>{r.no}</Link></td>
                    <td><b>{r.employee_first_name} {r.employee_last_name}</b><div className="tiny mono">{r.employee_no}</div></td>
                    <td>{NATURE_LABELS[r.nature] || r.nature}</td>
                    <td className="num">{r.proposed_salary_cents != null ? <Money cents={r.proposed_salary_cents} /> : '—'}</td>
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
        ) : <EmptyState icon="📄" title="No contract / salary change requests here" />}
      </Card>
    </Page>
  );
}
