import Link from 'next/link';
import { requireAction, currentCanAction } from '@/lib/session';
import { listApplications, applicationCounts, type ApplicationStatus } from '@/lib/admissions';
import { listGradeLevels, listAcademicYears } from '@/lib/academics/setup';
import { formatDate } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { Card, EmptyState, Pill, Stat, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { SearchInput, SelectFilter } from '@/components/ui/filters';
import { NewApplicationCard } from './application-card';

const STAGES: { value: ApplicationStatus; label: string }[] = [
  { value: 'ENQUIRY', label: 'Enquiries' }, { value: 'APPLIED', label: 'Applied' }, { value: 'OFFERED', label: 'Offered' }, { value: 'ADMITTED', label: 'Admitted' }, { value: 'DECLINED', label: 'Declined' },
];

export default async function AdmissionsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const user = await requireAction('ADMISSIONS_READ');
  const { q = '', status } = await searchParams;
  const stage = STAGES.find((s) => s.value === status)?.value ?? null;
  const [rows, counts, grades, years, canManage] = await Promise.all([
    listApplications(stage ?? 'OPEN', q), applicationCounts(), listGradeLevels(), listAcademicYears(), currentCanAction('ADMISSIONS_MANAGE'),
  ]);
  const n = (s: ApplicationStatus) => counts.find((c) => c.status === s)?.n ?? 0;

  return (
    <Page title="Admissions" crumb="Enquiries and applications — follow up, offer a place, admit into a class" user={user}>
      <div className="grid g4">
        <Stat label="Enquiries" value={String(n('ENQUIRY'))} accent={false} />
        <Stat label="Applied" value={String(n('APPLIED'))} />
        <Stat label="Offered" value={String(n('OFFERED'))} accent={n('OFFERED') > 0} />
        <Stat label="Admitted" value={String(n('ADMITTED'))} accent={false} foot={`${n('DECLINED')} declined`} />
      </div>
      <Toolbar>
        <SearchInput placeholder="Search applicant, guardian, phone or no.…" />
        <SelectFilter paramName="status" label="Stage" allLabel="All open" options={STAGES.map((s) => ({ value: s.value, label: s.label }))} />
        <Spacer />
        {canManage ? <NewApplicationCard grades={grades} years={years} /> : null}
      </Toolbar>
      <Card>
        {rows.length ? (
          <TableWrap>
            <thead><tr><th>No.</th><th>Applicant</th><th>Grade · Year</th><th>Guardian</th><th>Received</th><th>Stage</th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="mono"><Link href={`/admissions/${a.id}`}>{a.no}</Link></td>
                  <td><Link href={`/admissions/${a.id}`}><b>{a.first_name} {a.last_name}</b></Link>{a.previous_school ? <div className="tiny">from {a.previous_school}</div> : null}</td>
                  <td>{a.grade_level_name} · {a.year_name}{a.boarding_status === 'BOARDER' ? <span className="tiny"> · boarder</span> : null}</td>
                  <td>{a.guardian_name}<div className="tiny mono">{a.guardian_phone}</div></td>
                  <td>{formatDate(a.applied_at.slice(0, 10))}</td>
                  <td>{a.status === 'ADMITTED' && a.student_id ? <Link href={`/students/view/${a.student_id}`}><Pill tone="ok">Admitted · {a.admission_no}</Pill></Link> : <Pill status={a.status} tone={a.status === 'DECLINED' ? 'bad' : a.status === 'OFFERED' ? 'ok' : a.status === 'APPLIED' ? 'info' : undefined} />}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="📥" title={stage ? `No ${STAGES.find((s) => s.value === stage)!.label.toLowerCase()}` : 'No open applications'} sub="Record enquiries as they come in; open one to follow up, offer a place and admit." />}
      </Card>
    </Page>
  );
}
