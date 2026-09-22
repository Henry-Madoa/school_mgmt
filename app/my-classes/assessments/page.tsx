import { requireAction, currentCanAction } from '@/lib/session';
import { listAssessmentTypes, getDefaultGradingScale } from '@/lib/academics/setup';
import { listClassMarks } from '@/lib/academics/assessments';
import { listStreamRoster } from '@/lib/students';
import { Page } from '@/components/layout/page';
import { Card, CardHead, EmptyState, Toolbar, Spacer } from '@/components/ui/primitives';
import { SelectFilter } from '@/components/ui/filters';
import { MarksEditor } from '@/components/school/marks-editor';
import { loadTeacherContext, isTeacherContext } from '../context';
import { NotLinked } from '../not-linked';

export default async function MyMarksPage({ searchParams }: { searchParams: Promise<{ stream?: string; subject?: string; type?: string }> }) {
  const user = await requireAction('TEACHER_PORTAL_VIEW');
  const ctx = await loadTeacherContext(user);
  if (!isTeacherContext(ctx)) return <NotLinked user={user} title="Enter Marks" error={ctx.error} />;
  const sp = await searchParams;
  const [types, scale, canEnter] = await Promise.all([listAssessmentTypes(), getDefaultGradingScale(), currentCanAction('TEACHER_PORTAL_ASSESSMENTS')]);
  const taught = ctx.streams.filter((s) => s.subjects.length);
  const stream = taught.find((s) => String(s.id) === sp.stream) ?? (taught.length === 1 ? taught[0] : undefined);
  const subject = stream?.subjects.find((a) => String(a.subject_id) === sp.subject) ?? (stream?.subjects.length === 1 ? stream.subjects[0] : undefined);
  const type = types.find((t) => String(t.id) === sp.type);
  const term = ctx.term;
  const ready = stream && subject && type && term;
  const [roster, existing] = ready ? await Promise.all([listStreamRoster(stream.id), listClassMarks(stream.id, subject.subject_id, type.id, term.id)]) : [[], []];

  return (
    <Page title="Enter Marks" crumb={term ? `${term.name} ${term.year_name} — scores are 0–100; blank clears a mark` : 'No current term'} user={user}>
      <Toolbar>
        <SelectFilter paramName="stream" label="Class" allLabel={stream ? `${stream.grade_level_name} ${stream.name}` : 'Class…'} options={taught.filter((s) => s.id !== stream?.id).map((s) => ({ value: String(s.id), label: `${s.grade_level_name} ${s.name}` }))} />
        <SelectFilter paramName="subject" label="Subject" allLabel={subject ? subject.subject_name : 'Subject…'} disabled={!stream} options={(stream?.subjects ?? []).filter((a) => a.subject_id !== subject?.subject_id).map((a) => ({ value: String(a.subject_id), label: a.subject_name }))} />
        <SelectFilter paramName="type" label="Assessment" allLabel="Assessment…" options={types.map((t) => ({ value: String(t.id), label: t.name }))} />
        <Spacer />
      </Toolbar>
      <Card>
        {ready ? (
          <>
            <CardHead title={`${stream.grade_level_name} ${stream.name} — ${subject.subject_name} · ${type.name}`} sub={`Weight ${type.weight}${scale ? ` · graded on ${scale.name}` : ''}`} />
            {roster.length
              ? <MarksEditor key={`${stream.id}-${subject.subject_id}-${type.id}`} streamId={stream.id} subjectId={subject.subject_id} assessmentTypeId={type.id} termId={term.id} roster={roster} existing={existing} bands={scale?.bands ?? []} viaPortal readOnly={!canEnter} />
              : <EmptyState icon="🎒" title="No students in this class" />}
          </>
        ) : <EmptyState icon="📝" title={taught.length ? 'Pick a class, subject and assessment' : 'No subjects assigned to you this year'} sub={!term ? 'There is no current term — ask the academics office.' : undefined} />}
      </Card>
    </Page>
  );
}
