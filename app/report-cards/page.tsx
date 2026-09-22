import Link from 'next/link';
import { requireAction, currentCanAction } from '@/lib/session';
import { listStreams, listTerms, resolveTerm, getCurrentAcademicYear } from '@/lib/academics/setup';
import { classStandings } from '@/lib/academics/assessments';
import { listStreamRoster } from '@/lib/students';
import { all } from '@/lib/db';
import { Page } from '@/components/layout/page';
import { Card, CardHead, EmptyState, Pill, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { SelectFilter } from '@/components/ui/filters';
import { PublishClassButton } from './report-card-actions';

export default async function ReportCardsPage({ searchParams }: { searchParams: Promise<{ stream?: string; term?: string }> }) {
  const user = await requireAction('REPORT_CARDS_READ');
  const sp = await searchParams;
  const [year, terms, term, canPublish] = await Promise.all([getCurrentAcademicYear(), listTerms(), resolveTerm(sp.term ? Number(sp.term) : null), currentCanAction('REPORT_CARDS_PUBLISH')]);
  const streams = await listStreams(year?.id ?? null);
  const stream = streams.find((s) => String(s.id) === sp.stream);
  const [roster, standings, cards] = stream && term ? await Promise.all([
    listStreamRoster(stream.id), classStandings(stream.id, term.id),
    all<{ student_id: number; is_published: boolean; class_teacher_remarks: string | null }>('SELECT student_id, is_published, class_teacher_remarks FROM report_card WHERE term_id = ? AND student_id IN (SELECT id FROM student WHERE current_stream_id = ?)', term.id, stream.id),
  ]) : [[], [], []];
  const rank = new Map(standings.map((s, i) => [s.student_id, { pos: i + 1, avg: s.average, subjects: s.subjects }]));
  const cardOf = new Map(cards.map((c) => [c.student_id, c]));
  const published = cards.filter((c) => c.is_published).length;

  return (
    <Page title="Report Cards" crumb="A class's standings for the term — review each card, add remarks, publish to the portal" user={user}>
      <Toolbar>
        <SelectFilter paramName="stream" label="Class" allLabel="Pick a class…" options={streams.map((s) => ({ value: String(s.id), label: `${s.grade_level_name} ${s.name}` }))} />
        <SelectFilter paramName="term" label="Term" allLabel={term ? `${term.name} ${term.year_name} (current)` : 'Term'} options={terms.filter((t) => t.id !== term?.id).map((t) => ({ value: String(t.id), label: `${t.name} ${t.year_name}` }))} />
        <Spacer />
        {stream && term && canPublish && standings.length ? <PublishClassButton streamId={stream.id} termId={term.id} /> : null}
      </Toolbar>
      <Card>
        {stream && term ? (
          <>
            <CardHead title={`${stream.grade_level_name} ${stream.name} — ${term.name} ${term.year_name}`} sub={`${standings.length} of ${roster.length} students have marks · ${published} published`} />
            {roster.length ? (
              <TableWrap>
                <thead><tr><th>Adm. No.</th><th>Student</th><th className="num">Subjects</th><th className="num">Average</th><th className="num">Position</th><th>Remarks</th><th>Status</th><th className="num" /></tr></thead>
                <tbody>
                  {roster.map((s) => {
                    const r = rank.get(s.id);
                    const c = cardOf.get(s.id);
                    return (
                      <tr key={s.id}>
                        <td className="mono">{s.admission_no}</td>
                        <td><b>{s.first_name} {s.last_name}</b></td>
                        <td className="num">{r?.subjects ?? 0}</td>
                        <td className="num">{r ? r.avg.toFixed(1) : '—'}</td>
                        <td className="num">{r ? `${r.pos} / ${standings.length}` : '—'}</td>
                        <td>{c?.class_teacher_remarks ? <Pill tone="ok">Added</Pill> : <span className="muted-cell">—</span>}</td>
                        <td>{c?.is_published ? <Pill tone="ok">Published</Pill> : <Pill tone="warn">Draft</Pill>}</td>
                        <td className="num"><Link href={`/report-cards/${s.id}/${term.id}`} className="btn sm ghost">Open</Link></td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableWrap>
            ) : <EmptyState icon="🎒" title="No students in this class" />}
          </>
        ) : <EmptyState icon="📄" title="Pick a class and a term" />}
      </Card>
    </Page>
  );
}
