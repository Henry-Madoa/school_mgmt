import Link from 'next/link';
import { requireAction } from '@/lib/session';
import { listTerms } from '@/lib/academics/setup';
import { listStudentMarks, listPublishedTerms, buildReportCard } from '@/lib/academics/assessments';
import { getOrg } from '@/lib/org';
import { imageSrc } from '@/lib/cloudinary';
import { formatDate } from '@/lib/format';
import { Card, CardHead, EmptyState, TableWrap } from '@/components/ui/primitives';
import { SelectFilter } from '@/components/ui/filters';
import { ReportCardSheet } from '@/components/school/report-card';
import { loadPortalScope, isPortalScope } from '../context';
import { PortalShell } from '../portal-shell';

/**
 * Grades: the term's marks as they come in, and the report card once the school publishes it.
 * An unpublished term shows the marks only — the standing, position and remarks wait for the
 * report card.
 */
export default async function PortalGradesPage({ searchParams }: { searchParams: Promise<{ student?: string; term?: string }> }) {
  const user = await requireAction('STUDENT_PORTAL_VIEW');
  const sp = await searchParams;
  const scope = await loadPortalScope(user, sp.student, sp.term);
  const terms = await listTerms();
  const term = isPortalScope(scope) ? scope.term : undefined;
  const [marks, published, org] = isPortalScope(scope) && term
    ? await Promise.all([listStudentMarks(scope.student.id, term.id), listPublishedTerms(scope.student.id), getOrg()])
    : [[], [], undefined];
  const isPublished = !!term && published.some((p) => p.term_id === term.id);
  const card = isPortalScope(scope) && term && isPublished ? await buildReportCard(scope.student.id, term.id) : undefined;
  const bySubject = new Map<string, typeof marks>();
  for (const m of marks) bySubject.set(m.subject_name, [...(bySubject.get(m.subject_name) ?? []), m]);

  return (
    <PortalShell user={user} title="Grades & Report Cards" scope={scope}
      extra={<SelectFilter paramName="term" label="Term" allLabel={term ? `${term.name} ${term.year_name}` : 'Term'} options={terms.filter((t) => t.id !== term?.id).map((t) => ({ value: String(t.id), label: `${t.name} ${t.year_name}` }))} />}>
      {isPortalScope(scope) ? (
        <>
          {card ? (
            <Card>
              <CardHead title={`Report card — ${term!.name} ${term!.year_name}`} sub={`Published ${card.card?.published_at ? formatDate(card.card.published_at) : ''}`}>
                <Link href={`/print/report-card/${scope.student.id}-${term!.id}`} className="btn sm ghost" target="_blank">Print</Link>
              </CardHead>
              <ReportCardSheet card={card} school={org ? { name: org.name, motto: org.motto, address: org.physical_address } : undefined} photoSrc={imageSrc(card.student.photo, { width: 128, height: 128, crop: 'fill' })} />
            </Card>
          ) : (
            <Card>
              <CardHead title={`Marks — ${term ? `${term.name} ${term.year_name}` : 'no term'}`} sub={term ? 'As entered by the teachers; the report card with the overall standing and remarks follows when the school publishes it' : undefined} />
              {bySubject.size ? (
                <TableWrap>
                  <thead><tr><th>Subject</th><th>Assessments</th><th className="num">Average</th><th>Competency</th></tr></thead>
                  <tbody>
                    {[...bySubject.entries()].map(([subject, rows]) => {
                      const avg = rows.reduce((s, r) => s + Number(r.score) * Number(r.weight), 0) / rows.reduce((s, r) => s + Number(r.weight), 0);
                      const last = rows[rows.length - 1];
                      return (
                        <tr key={subject}>
                          <td><b>{subject}</b></td>
                          <td className="tiny">{rows.map((r) => `${r.assessment_type_name}: ${r.score}`).join(' · ')}</td>
                          <td className="num"><b>{avg.toFixed(1)}</b></td>
                          <td>{last.competency_label ? <span className="pill" style={{ background: last.band_color ?? undefined, color: last.band_color ? '#fff' : undefined }}>{last.competency_label}</span> : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </TableWrap>
              ) : <EmptyState icon="📝" title="No marks entered yet this term" />}
            </Card>
          )}
          {published.length ? (
            <Card>
              <CardHead title="Published report cards" />
              <div className="inline" style={{ gap: 6 }}>
                {published.map((p) => <Link key={p.term_id} href={`/portal/grades?student=${scope.student.id}&term=${p.term_id}`} className={`btn sm ${p.term_id === term?.id ? '' : 'ghost'}`}>{p.term_name} {p.year_name}</Link>)}
              </div>
            </Card>
          ) : null}
        </>
      ) : null}
    </PortalShell>
  );
}
