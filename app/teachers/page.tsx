import Link from 'next/link';
import { requireAction, currentCanAction } from '@/lib/session';
import { listTeachers, listEmployeesNotTeachers } from '@/lib/academics/teachers';
import { imageSrc } from '@/lib/cloudinary';
import { initials } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { Card, EmptyState, Pill, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { SearchInput } from '@/components/ui/filters';
import { TeacherProfileFormButton } from './teacher-forms';

export default async function TeachersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireAction('TEACHERS_READ');
  const { q = '' } = await searchParams;
  const [rows, canManage] = await Promise.all([listTeachers(q), currentCanAction('TEACHERS_MANAGE')]);
  const candidates = canManage ? await listEmployeesNotTeachers() : [];
  return (
    <Page title="Teaching Staff" crumb="Employees flagged as teachers, and what each one teaches this year" user={user}>
      <Toolbar>
        <SearchInput placeholder="Search name, employee no. or TSC no.…" />
        <Spacer />
        {canManage ? <TeacherProfileFormButton employees={candidates}>Add teaching staff</TeacherProfileFormButton> : null}
      </Toolbar>
      <Card>
        {rows.length ? (
          <TableWrap>
            <thead><tr><th>Employee No.</th><th>Teacher</th><th>TSC No.</th><th>Qualification</th><th>Specialisation</th><th className="num">Classes</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((t) => {
                const photo = imageSrc(t.photo_image, { width: 64, height: 64, crop: 'fill' });
                return (
                  <tr key={t.id}>
                    <td className="mono"><Link href={`/teachers/${t.employee_id}`}>{t.employee_no}</Link></td>
                    <td>
                      <span className="inline" style={{ gap: 8 }}>
                        {photo ? <img src={photo} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} /> : <span className="avatar" style={{ width: 28, height: 28, fontSize: 11 }}>{initials(`${t.first_name} ${t.last_name}`)}</span>}
                        <b>{t.first_name} {t.last_name}</b>
                      </span>
                    </td>
                    <td className="mono">{t.tsc_number ?? '—'}</td>
                    <td>{t.qualification ?? '—'}</td>
                    <td>{t.specialisation ?? '—'}</td>
                    <td className="num">{t.assignments}</td>
                    <td><Pill status={t.employee_status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🧑‍🏫" title="No teaching staff yet" sub={canManage ? 'Onboard staff under HR › Employees, then flag them here.' : undefined} />}
      </Card>
    </Page>
  );
}
