import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import { buildReportCard } from '@/lib/academics/assessments';
import { getOrg } from '@/lib/org';
import { imageSrc } from '@/lib/cloudinary';
import { Page } from '@/components/layout/page';
import { Card, CardHead, Toolbar, Spacer } from '@/components/ui/primitives';
import { ReportCardSheet } from '@/components/school/report-card';
import { ReportCardRemarksForm } from '../../report-card-actions';

export default async function ReportCardPage({ params }: { params: Promise<{ studentId: string; termId: string }> }) {
  const user = await requireAction('REPORT_CARDS_READ');
  const { studentId: sParam, termId: tParam } = await params;
  const studentId = Number(sParam);
  const termId = Number(tParam);
  const [card, org, canPublish] = await Promise.all([buildReportCard(studentId, termId), getOrg(), currentCanAction('REPORT_CARDS_PUBLISH')]);
  if (!card) notFound();
  return (
    <Page title={`Report card — ${card.student.name}`} crumb={`${card.term.name} ${card.term.year_name} · ${card.student.grade_level_name ?? ''} ${card.student.stream_name ?? ''}`} user={user}>
      <Toolbar>
        <Link href={`/students/view/${studentId}`} className="btn ghost sm">← Student</Link>
        <Spacer />
        <Link href={`/print/report-card/${studentId}-${termId}`} className="btn ghost" target="_blank">Print</Link>
      </Toolbar>
      <Card>
        <ReportCardSheet card={card} school={org ? { name: org.name, motto: org.motto, address: org.physical_address } : undefined} photoSrc={imageSrc(card.student.photo, { width: 128, height: 128, crop: 'fill' })} />
      </Card>
      {canPublish ? (
        <Card>
          <CardHead title="Remarks & publishing" sub="Saved remarks stay a draft until published; publishing makes the card visible on the Student / Parent portal" />
          <ReportCardRemarksForm studentId={studentId} termId={termId} card={card.card} />
        </Card>
      ) : null}
    </Page>
  );
}
