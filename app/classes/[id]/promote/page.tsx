import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction } from '@/lib/session';
import { getStream, listStreams, listAcademicYears, listGradeLevels } from '@/lib/academics/setup';
import { listStreamRoster } from '@/lib/students';
import { classStandings } from '@/lib/academics/assessments';
import { all } from '@/lib/db';
import { Page } from '@/components/layout/page';
import { Card, CardHead, EmptyState, Toolbar, Spacer } from '@/components/ui/primitives';
import { SelectFilter } from '@/components/ui/filters';
import { PromotionEditor, CopyStreamsButton } from '../../promotion';

/**
 * End-of-year promotion for one class: every student gets a next-year class (the same-named
 * stream one grade up by default), a repeat, or graduates. Next year's classes must exist —
 * the button copies this year's if they don't.
 */
export default async function PromoteClassPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ year?: string }> }) {
  const user = await requireAction('CLASSES_MANAGE');
  const { id: idParam } = await params;
  const sp = await searchParams;
  const id = Number(idParam);
  const stream = await getStream(id);
  if (!stream) notFound();
  const [years, grades, roster] = await Promise.all([listAcademicYears(), listGradeLevels(), listStreamRoster(id)]);
  const thisYear = years.find((y) => y.id === stream.academic_year_id)!;
  const later = years.filter((y) => y.start_date > thisYear.start_date).sort((a, b) => a.start_date.localeCompare(b.start_date));
  const target = later.find((y) => String(y.id) === sp.year) ?? later[0];
  const targetStreams = target ? await listStreams(target.id) : [];
  // Latest term with marks for the class, for the standings shown beside each name.
  const lastTerm = await all<{ id: number }>(
    'SELECT t.id FROM academic_term t WHERE t.academic_year_id = ? ORDER BY t.start_date DESC LIMIT 1', stream.academic_year_id,
  );
  const standings = lastTerm[0] ? await classStandings(id, lastTerm[0].id) : [];
  const rank = new Map(standings.map((s, i) => [s.student_id, { pos: i + 1, avg: s.average }]));
  const grade = grades.find((g) => g.id === stream.grade_level_id)!;
  const sameLevel = grades.filter((g) => g.education_level_id === grade.education_level_id);
  const nextGrade = grades.filter((g) => g.sort > grade.sort && g.education_level_id === grade.education_level_id).sort((a, b) => a.sort - b.sort)[0]
    ?? grades.filter((g) => !sameLevel.includes(g) && g.education_level_id > grade.education_level_id).sort((a, b) => a.education_level_id - b.education_level_id || a.sort - b.sort)[0];
  const defaultStream = nextGrade ? (targetStreams.find((s) => s.grade_level_id === nextGrade.id && s.name === stream.name) ?? targetStreams.find((s) => s.grade_level_id === nextGrade.id)) : undefined;

  return (
    <Page title={`Promote ${stream.grade_level_name} ${stream.name}`} crumb={`${thisYear.name} → ${target ? target.name : 'no later year yet'} · ${roster.length} students`} user={user}>
      <Toolbar>
        <Link href={`/classes/${id}`} className="btn ghost sm">← Class</Link>
        {later.length > 1 ? <SelectFilter paramName="year" label="Promote into" allLabel={target ? target.name : 'Year'} options={later.filter((y) => y.id !== target?.id).map((y) => ({ value: String(y.id), label: y.name }))} /> : null}
        <Spacer />
        {target && !targetStreams.length ? <CopyStreamsButton fromYearId={thisYear.id} toYearId={target.id} fromName={thisYear.name} toName={target.name} /> : null}
      </Toolbar>
      <Card>
        <CardHead title={target ? `Next-year classes in ${target.name}` : 'No later academic year'}
          sub={target ? (targetStreams.length ? `Each student defaults to ${nextGrade ? `${nextGrade.name} ${stream.name}` : 'graduation'}; change any, then apply` : `Open ${target.name}'s classes first — copy this year's with one click.`) : 'Add the next academic year under Administration → Academics → Academic Years, then come back.'} />
        {!roster.length ? <EmptyState icon="🎒" title="No students in this class" />
          : target && targetStreams.length ? (
            <PromotionEditor
              students={roster.map((s) => ({ id: s.id, admission_no: s.admission_no, name: `${s.first_name} ${s.last_name}`, average: rank.get(s.id)?.avg ?? null, position: rank.get(s.id)?.pos ?? null }))}
              targets={targetStreams.map((s) => ({ id: s.id, label: `${s.grade_level_name} ${s.name}`, grade_level_id: s.grade_level_id }))}
              defaultStreamId={defaultStream?.id ?? null} repeatStreams={targetStreams.filter((s) => s.grade_level_id === stream.grade_level_id).map((s) => s.id)}
              classOf={standings.length} />
          ) : null}
      </Card>
    </Page>
  );
}
