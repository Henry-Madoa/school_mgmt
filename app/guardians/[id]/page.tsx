import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import { getGuardian, listGuardianStudents } from '@/lib/students';
import { listPortalLogins } from '@/lib/portal';
import { formatDate, formatDateTime } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { Card, CardHead, DefinitionList, EmptyState, Pill, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { Money } from '@/components/ui/money';
import { GuardianFormButton, DeleteGuardianButton } from '../guardian-form';

export default async function GuardianPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAction('GUARDIANS_READ');
  const { id: idParam } = await params;
  const id = Number(idParam);
  const guardian = await getGuardian(id);
  if (!guardian) notFound();
  const [students, canManage, logins] = await Promise.all([listGuardianStudents(id), currentCanAction('GUARDIANS_MANAGE'), listPortalLogins({ guardianId: id })]);
  const owing = students.reduce((s, x) => s + Number(x.fee_balance), 0);
  return (
    <Page title={guardian.full_name} crumb={`${guardian.relationship} · ${guardian.phone}`} user={user}>
      <Toolbar>
        <Link href="/guardians" className="btn ghost sm">← All guardians</Link>
        <Spacer />
        {canManage ? <GuardianFormButton guardian={guardian} className="btn ghost">Edit</GuardianFormButton> : null}
        {canManage && !students.length ? <DeleteGuardianButton id={id} /> : null}
      </Toolbar>
      <Card>
        <CardHead title="Contact" sub="Receipts and fee reminders go to the phone and email of the student's primary guardian" />
        <div className="grid g2 dl-groups">
          <section className="dl-group">
            <DefinitionList items={[
              ['Phone', <span className="mono" key="p">{guardian.phone}</span>], ['Email', guardian.email ?? '—'],
              ['National ID', guardian.national_id ?? '—'], ['Occupation', guardian.occupation ?? '—'], ['Address', guardian.address ?? '—'],
            ]} />
          </section>
          <section className="dl-group">
            <DefinitionList items={[
              ['Portal login', logins.length ? logins.map((l) => l.username).join(', ') : <span className="muted-cell" key="l">None — link a user under Administration › Security › User Setup</span>],
              ['On file since', formatDateTime(guardian.created_at)],
              ['Combined fee balance', <Money cents={owing} key="b" />],
            ]} />
          </section>
        </div>
      </Card>
      <Card>
        <CardHead title="Students" sub={`${students.length} student${students.length === 1 ? '' : 's'} under this guardian`} />
        {students.length ? (
          <TableWrap>
            <thead><tr><th>Adm. No.</th><th>Student</th><th>Class</th><th>Admitted</th><th className="num">Fee balance</th><th>Status</th></tr></thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id}>
                  <td className="mono"><Link href={`/students/view/${s.id}`}>{s.admission_no}</Link></td>
                  <td><b>{s.first_name} {s.last_name}</b></td>
                  <td>{s.grade_level_name} {s.stream_name}</td>
                  <td>{formatDate(s.admission_date)}</td>
                  <td className="num"><Money cents={s.fee_balance} /></td>
                  <td><Pill status={s.status} /></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🎒" title="No students linked" />}
      </Card>
    </Page>
  );
}
