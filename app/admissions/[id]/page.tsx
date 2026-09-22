import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import { getApplication } from '@/lib/admissions';
import { listGradeLevels, listAcademicYears, listStreams } from '@/lib/academics/setup';
import { formatDate, formatDateTime } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { Card, CardHead, DefinitionList, Pill, Toolbar, Spacer } from '@/components/ui/primitives';
import { EditableCard } from '@/components/ui/editable-card';
import { ApplicationEditForm, AdmitApplicationPanel, STATUS_LABEL } from '../application-card';
import { ApplicationStatusButton } from '../status-button';

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAction('ADMISSIONS_READ');
  const { id: idParam } = await params;
  const id = Number(idParam);
  const a = await getApplication(id);
  if (!a) notFound();
  const [grades, years, canManage] = await Promise.all([listGradeLevels(), listAcademicYears(), currentCanAction('ADMISSIONS_MANAGE')]);
  const streams = canManage && a.status !== 'ADMITTED' ? await listStreams(a.academic_year_id) : [];
  const open = a.status !== 'ADMITTED';
  const tone = a.status === 'DECLINED' ? 'bad' : a.status === 'OFFERED' || a.status === 'ADMITTED' ? 'ok' : a.status === 'APPLIED' ? 'info' : undefined;

  return (
    <Page title={`${a.first_name} ${a.last_name} — ${a.no}`} crumb={`${STATUS_LABEL[a.status]} · ${a.grade_level_name} ${a.year_name} · received ${formatDate(a.applied_at.slice(0, 10))}`} user={user}>
      <Toolbar>
        <Link href="/admissions" className="btn ghost sm">← Admissions</Link>
        <Spacer />
        {canManage && a.status === 'ENQUIRY' ? <ApplicationStatusButton id={id} status="APPLIED" /> : null}
        {canManage && a.status === 'APPLIED' ? <ApplicationStatusButton id={id} status="OFFERED" /> : null}
        {canManage && open && a.status !== 'DECLINED' ? <ApplicationStatusButton id={id} status="DECLINED" /> : null}
        {canManage && a.status === 'DECLINED' ? <ApplicationStatusButton id={id} status="APPLIED" /> : null}
        {a.student_id ? <Link href={`/students/view/${a.student_id}`} className="btn">Open student {a.admission_no}</Link> : null}
      </Toolbar>

      <EditableCard title="Application" sub="The applicant, the place applied for and the guardian to follow up with" canEdit={canManage && open}
        badge={<Pill tone={tone}>{STATUS_LABEL[a.status]}</Pill>} form={<ApplicationEditForm application={a} grades={grades} years={years} />}>
        <div className="grid g2 dl-groups">
          <section className="dl-group">
            <div className="dl-caption">Applicant</div>
            <DefinitionList items={[
              ['Name', [a.first_name, a.middle_name, a.last_name].filter(Boolean).join(' ')],
              ['Gender', a.gender ? a.gender[0] + a.gender.slice(1).toLowerCase() : '—'],
              ['Date of birth', a.date_of_birth ? formatDate(a.date_of_birth) : '—'],
              ['Previous school', a.previous_school ?? '—'],
              ['Applied for', `${a.grade_level_name} · ${a.year_name} · ${a.boarding_status === 'BOARDER' ? 'boarder' : 'day scholar'}`],
            ]} />
          </section>
          <section className="dl-group">
            <div className="dl-caption">Guardian & trail</div>
            <DefinitionList items={[
              ['Guardian', `${a.guardian_name} (${a.guardian_relationship})`],
              ['Phone', <span className="mono" key="p">{a.guardian_phone}</span>],
              ['Email', a.guardian_email ?? '—'],
              ['Received', `${formatDateTime(a.applied_at)} · ${a.created_by ?? '—'}`],
              a.decided_at ? ['Decided', formatDateTime(a.decided_at)] : null,
            ]} />
          </section>
        </div>
        {a.notes ? <><div className="hint" style={{ marginTop: 8 }}>Notes</div><div style={{ whiteSpace: 'pre-wrap' }}>{a.notes}</div></> : null}
      </EditableCard>

      {canManage && open && a.status !== 'DECLINED' ? (
        <Card>
          <CardHead title="Admit" sub={a.status === 'OFFERED' ? 'A place has been offered — admit once the guardian accepts' : 'Admitting closes the application and creates the student, guardian and fee account'} />
          <AdmitApplicationPanel application={a} streams={streams} />
        </Card>
      ) : null}
    </Page>
  );
}
