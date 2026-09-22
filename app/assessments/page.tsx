import Link from 'next/link';
import { requireAction, currentCanAction } from '@/lib/session';
import { listStreams, listTerms, resolveTerm, getCurrentAcademicYear, listSubjectsForGrade, listAssessmentTypes, getDefaultGradingScale } from '@/lib/academics/setup';
import { listClassMarks } from '@/lib/academics/assessments';
import { listStreamRoster } from '@/lib/students';
import { Page } from '@/components/layout/page';
import { Card, CardHead, EmptyState, Toolbar, Spacer } from '@/components/ui/primitives';
import { SelectFilter } from '@/components/ui/filters';
import { MarksEditor } from '@/components/school/marks-editor';

export default async function AssessmentsPage({ searchParams }: { searchParams: Promise<{ stream?: string; subject?: string; type?: string; term?: string }> }) {
  const user = await requireAction('ASSESSMENTS_READ');
  const sp = await searchParams;
  const [year, terms, term, types, scale, canEnter] = await Promise.all([
    getCurrentAcademicYear(), listTerms(), resolveTerm(sp.term ? Number(sp.term) : null), listAssessmentTypes(), getDefaultGradingScale(), currentCanAction('ASSESSMENTS_ENTER'),
  ]);
  const streams = await listStreams(year?.id ?? null);
  const stream = streams.find((s) => String(s.id) === sp.stream);
  const subjects = stream ? await listSubjectsForGrade(stream.grade_level_id) : [];
  const subject = subjects.find((s) => String(s.id) === sp.subject);
  const type = types.find((t) => String(t.id) === sp.type);
  const ready = stream && subject && type && term;
  const [roster, existing] = ready ? await Promise.all([listStreamRoster(stream.id), listClassMarks(stream.id, subject.id, type.id, term.id)]) : [[], []];

  return (
    <Page title="Assessments" crumb="Enter a class's marks for a subject and assessment — the term average and competency follow" user={user}>
      <Toolbar>
        <SelectFilter paramName="stream" label="Class" allLabel="Pick a class…" options={streams.map((s) => ({ value: String(s.id), label: `${s.grade_level_name} ${s.name}` }))} />
        <SelectFilter paramName="subject" label="Subject" allLabel="Subject…" disabled={!stream} options={subjects.map((s) => ({ value: String(s.id), label: s.name }))} />
        <SelectFilter paramName="type" label="Assessment" allLabel="Assessment…" options={types.map((t) => ({ value: String(t.id), label: t.name }))} />
        <SelectFilter paramName="term" label="Term" allLabel={term ? `${term.name} ${term.year_name} (current)` : 'Term'} options={terms.filter((t) => t.id !== term?.id).map((t) => ({ value: String(t.id), label: `${t.name} ${t.year_name}` }))} />
        <Spacer />
        {stream ? <Link href={`/report-cards?stream=${stream.id}${term ? `&term=${term.id}` : ''}`} className="btn ghost sm">Report cards</Link> : null}
      </Toolbar>
      <Card>
        {ready ? (
          <>
            <CardHead title={`${stream.grade_level_name} ${stream.name} — ${subject.name} · ${type.name}`} sub={`${term.name} ${term.year_name} · weight ${type.weight}${scale ? ` · graded on ${scale.name}` : ' · no default grading scale'}`} />
            {roster.length
              ? <MarksEditor key={`${stream.id}-${subject.id}-${type.id}-${term.id}`} streamId={stream.id} subjectId={subject.id} assessmentTypeId={type.id} termId={term.id} roster={roster} existing={existing} bands={scale?.bands ?? []} readOnly={!canEnter} />
              : <EmptyState icon="🎒" title="No students in this class" />}
          </>
        ) : <EmptyState icon="📝" title="Pick a class, subject and assessment" sub={!types.length ? 'No assessment types yet — add them under Administration › Academics › Assessment Types.' : stream && !subjects.length ? 'No subjects are offered in this grade yet.' : undefined} />}
      </Card>
    </Page>
  );
}
