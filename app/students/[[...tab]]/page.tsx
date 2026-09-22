import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import { listStudents, hasAnyStudents, STUDENT_FILTER_FIELDS } from '@/lib/students';
import { listGradeLevels, listStreams, getCurrentAcademicYear } from '@/lib/academics/setup';
import { parseFilters } from '@/lib/listFilters';
import { parseSort } from '@/lib/listSort';
import { Page } from '@/components/layout/page';
import { Card, EmptyState, Pill, TableWrap, Tabs, Toolbar, Spacer, type TabDefinition } from '@/components/ui/primitives';
import { SearchInput } from '@/components/ui/filters';
import { DynamicFilterBar } from '@/components/ui/dynamic-filter';
import { SortLink } from '@/components/ui/sort-link';
import { Money } from '@/components/ui/money';
import { formatDate } from '@/lib/format';
import type { StudentStatus } from '@/lib/types';

const TABS: TabDefinition[] = [
  { key: 'active', label: 'Active', tone: 'ok' },
  { key: 'suspended', label: 'Suspended', tone: 'warn' },
  { key: 'graduated', label: 'Graduated' },
  { key: 'transferred', label: 'Transferred' },
  { key: 'inactive', label: 'Inactive' },
  { key: 'all', label: 'All' },
];

export default async function StudentsPage({ params, searchParams }: {
  params: Promise<{ tab?: string[] }>;
  searchParams: Promise<{ q?: string; filters?: string; sort?: string }>;
}) {
  const user = await requireAction('STUDENTS_READ');
  const { tab: segments } = await params;
  const { q = '', filters: filtersRaw, sort: sortRaw } = await searchParams;
  const requested = segments?.[0];
  if (requested && !TABS.some((t) => t.key === requested)) notFound();
  const tab = requested ?? 'active';
  const filters = parseFilters(filtersRaw);
  const sort = parseSort(sortRaw);
  const statusFilter = tab === 'all' ? [] : [{ field: 'status', operator: '=' as const, value: tab.toUpperCase() as StudentStatus }];

  const year = await getCurrentAcademicYear();
  const [rows, empty, canCreate, grades, streams] = await Promise.all([
    listStudents({ search: q, filters: [...statusFilter, ...filters], sort }),
    hasAnyStudents().then((any) => !any),
    currentCanAction('STUDENTS_CREATE'),
    listGradeLevels(), listStreams(year?.id ?? null),
  ]);
  const fields = STUDENT_FILTER_FIELDS.filter((f) => f.key !== 'status' || tab === 'all').map((f) => (
    f.key === 'current_grade_level_id' ? { ...f, options: grades.map((g) => ({ value: g.id, label: g.name })) }
      : f.key === 'current_stream_id' ? { ...f, options: streams.map((s) => ({ value: s.id, label: `${s.grade_level_name} ${s.name}` })) }
        : f
  ));

  return (
    <Page title="Students" crumb="The student register — admission, placement, guardians and fee accounts" user={user}>
      <Tabs tabs={TABS} active={tab} hrefFor={(k) => `/students/${k}`} />
      <Toolbar>
        <SearchInput placeholder="Search admission no., name or guardian…" disabled={empty} />
        <DynamicFilterBar fields={fields} disabled={empty} />
        <Spacer />
        {canCreate ? <Link href="/students/new" className="btn">Admit a student</Link> : null}
      </Toolbar>
      <Card>
        {rows.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th><SortLink sortKey="admission_no">Adm. No.</SortLink></th>
                <th><SortLink sortKey="name">Student</SortLink></th>
                <th><SortLink sortKey="grade">Class</SortLink></th>
                <th>Guardian</th>
                <th><SortLink sortKey="admission_date">Admitted</SortLink></th>
                <th className="num"><SortLink sortKey="fee_balance">Fee balance</SortLink></th>
                <th><SortLink sortKey="status">Status</SortLink></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td className="mono"><Link href={`/students/view/${s.id}`}>{s.admission_no}</Link></td>
                  <td><b>{s.first_name} {s.middle_name ? `${s.middle_name} ` : ''}{s.last_name}</b>{s.gender ? <span className="tiny muted-cell"> · {s.gender === 'MALE' ? 'M' : 'F'}</span> : null}</td>
                  <td>{s.grade_level_name ? `${s.grade_level_name} ${s.stream_name ?? ''}` : <span className="muted-cell">Not placed</span>}</td>
                  <td>{s.primary_guardian_name ? <>{s.primary_guardian_name}<div className="tiny muted-cell">{s.primary_guardian_phone}</div></> : '—'}</td>
                  <td>{formatDate(s.admission_date)}</td>
                  <td className="num"><Money cents={s.fee_balance} /></td>
                  <td><Pill status={s.status} /></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🎒" title={empty ? 'No students admitted yet' : 'No students here'} sub={empty && canCreate ? 'Admit the first student to open their fee account.' : undefined} />}
      </Card>
    </Page>
  );
}
