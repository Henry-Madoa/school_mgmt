import Link from 'next/link';
import { requireAction } from '@/lib/session';
import { listGuardians } from '@/lib/students';
import { Page } from '@/components/layout/page';
import { Card, EmptyState, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { SearchInput } from '@/components/ui/filters';

export default async function GuardiansPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireAction('GUARDIANS_READ');
  const { q = '' } = await searchParams;
  const rows = await listGuardians(q);
  return (
    <Page title="Guardians" crumb="Parents and guardians — who the school reaches about each student" user={user}>
      <Toolbar>
        <SearchInput placeholder="Search name, phone, email or ID…" />
        <Spacer />
        <span className="tiny">Guardians are added on the student&apos;s card — admit a student or edit their bio-data.</span>
      </Toolbar>
      <Card>
        {rows.length ? (
          <TableWrap>
            <thead><tr><th>Name</th><th>Relationship</th><th>Phone</th><th>Email</th><th>Students</th></tr></thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.id}>
                  <td><Link href={`/guardians/${g.id}`}><b>{g.full_name}</b></Link></td>
                  <td>{g.relationship}</td>
                  <td className="mono">{g.phone}</td>
                  <td>{g.email ?? '—'}</td>
                  <td>{g.student_names ?? <span className="muted-cell">None</span>}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="👪" title="No guardians yet" />}
      </Card>
    </Page>
  );
}
