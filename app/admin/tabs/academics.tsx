/* Admin Centre tabs — academics. Rendered by app/admin/[[...tab]]/page.tsx; moved out of it so each area reads on its own. */
import Link from 'next/link';
import {
  listAcademicYears, listEducationLevels, listGradeLevels, listStreams, listSubjects, listGradingScales, listAssessmentTypes,
} from '@/lib/academics/setup';
import { listActiveTeachers } from '@/lib/academics/teachers';
import { listFeeItems } from '@/lib/fees/setup';
import { listGlAccounts } from '@/lib/gl';
import { formatDate } from '@/lib/format';
import { Card, CardHead, EmptyState, Pill, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import {
  AcademicYearFormButton, DeleteAcademicYearButton, SetCurrentTermButton,
  EducationLevelFormButton, DeleteEducationLevelButton, GradeLevelFormButton, DeleteGradeLevelButton, StreamFormButton, DeleteStreamButton,
  SubjectFormButton, DeleteSubjectButton, GradingScaleFormButton, DeleteGradingScaleButton,
  AssessmentTypeFormButton, DeleteAssessmentTypeButton, FeeItemFormButton, DeleteFeeItemButton,
} from '../academics-forms';

export async function AcademicYearsTab() {
  const years = await listAcademicYears();
  return (
    <>
      <Toolbar>
        <Spacer />
        <AcademicYearFormButton>Add academic year</AcademicYearFormButton>
      </Toolbar>
      {years.length ? years.map((y) => (
        <Card key={y.id}>
          <CardHead title={<>{y.name} {y.is_current ? <Pill tone="ok">Current</Pill> : null}</>}
            sub={`${formatDate(y.start_date)} – ${formatDate(y.end_date)} · ${y.streams} class${y.streams === 1 ? '' : 'es'}`}>
            <AcademicYearFormButton year={y} className="btn sm ghost">Edit</AcademicYearFormButton>{' '}
            {!y.streams ? <DeleteAcademicYearButton id={y.id} /> : null}
          </CardHead>
          {y.terms.length ? (
            <TableWrap>
              <thead><tr><th>Term</th><th>Starts</th><th>Ends</th><th>Status</th><th className="num" /></tr></thead>
              <tbody>
                {y.terms.map((t) => (
                  <tr key={t.id}>
                    <td><b>{t.name}</b></td>
                    <td>{formatDate(t.start_date)}</td>
                    <td>{formatDate(t.end_date)}</td>
                    <td>{t.is_current ? <Pill tone="ok">Current term</Pill> : <span className="muted-cell">—</span>}</td>
                    <td className="num">{!t.is_current ? <SetCurrentTermButton termId={t.id} /> : null}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          ) : <EmptyState icon="📆" title="No terms" sub="Edit the year to add its terms." />}
        </Card>
      )) : (
        <Card><EmptyState icon="📆" title="No academic years yet" sub="Add the current year and its three terms to start admitting students." /></Card>
      )}
    </>
  );
}

export async function StructureTab({ yearId }: { yearId?: string }) {
  const [levels, grades, years, teachers] = await Promise.all([listEducationLevels(), listGradeLevels(), listAcademicYears(), listActiveTeachers()]);
  const selectedYear = years.find((y) => String(y.id) === yearId) ?? years.find((y) => y.is_current) ?? years[0];
  const streams = selectedYear ? await listStreams(selectedYear.id) : [];
  const yearOpts = years.map((y) => ({ id: y.id, name: y.name }));
  return (
    <>
      <Card>
        <CardHead title="Education levels" sub="The school sections — Pre-Primary, Primary, Junior Secondary…">
          <EducationLevelFormButton className="btn sm">Add level</EducationLevelFormButton>
        </CardHead>
        {levels.length ? (
          <TableWrap>
            <thead><tr><th>Level</th><th className="num">Grades</th><th className="num" /></tr></thead>
            <tbody>
              {levels.map((l) => {
                const n = grades.filter((g) => g.education_level_id === l.id).length;
                return (
                  <tr key={l.id}>
                    <td><b>{l.name}</b></td>
                    <td className="num">{n}</td>
                    <td className="num">
                      <EducationLevelFormButton level={l} className="btn sm ghost">Edit</EducationLevelFormButton>{' '}
                      {!n ? <DeleteEducationLevelButton id={l.id} /> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🧱" title="No levels yet" />}
      </Card>

      <Card>
        <CardHead title="Grade levels" sub="PP1 through Grade 12, each under a level">
          <GradeLevelFormButton levels={levels} className="btn sm">Add grade</GradeLevelFormButton>
        </CardHead>
        {grades.length ? (
          <TableWrap>
            <thead><tr><th>Grade</th><th>Level</th><th className="num">Classes</th><th className="num">Students</th><th className="num" /></tr></thead>
            <tbody>
              {grades.map((g) => (
                <tr key={g.id}>
                  <td><b>{g.name}</b></td>
                  <td>{g.education_level_name}</td>
                  <td className="num">{g.streams}</td>
                  <td className="num">{g.students}</td>
                  <td className="num">
                    <GradeLevelFormButton grade={g} levels={levels} className="btn sm ghost">Edit</GradeLevelFormButton>{' '}
                    {!g.streams && !g.students ? <DeleteGradeLevelButton id={g.id} /> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🧱" title="No grades yet" sub={levels.length ? undefined : 'Add an education level first.'} />}
      </Card>

      <Card>
        <CardHead title={`Classes (streams)${selectedYear ? ` — ${selectedYear.name}` : ''}`} sub="Each grade's classes for the year, with the class teacher">
          {years.length > 1 ? (
            <span className="inline" style={{ gap: 4, marginRight: 8 }}>
              {years.map((y) => (
                <Link key={y.id} className={`btn sm ${y.id === selectedYear?.id ? '' : 'ghost'}`} href={`/admin/pool/academics/structure?year=${y.id}`}>{y.name}</Link>
              ))}
            </span>
          ) : null}
          <StreamFormButton grades={grades} years={yearOpts} teachers={teachers} defaultYearId={selectedYear?.id} className="btn sm">Open a class</StreamFormButton>
        </CardHead>
        {streams.length ? (
          <TableWrap>
            <thead><tr><th>Class</th><th>Grade</th><th>Class teacher</th><th className="num">Students</th><th className="num" /></tr></thead>
            <tbody>
              {streams.map((s) => (
                <tr key={s.id}>
                  <td><Link href={`/classes/${s.id}`}><b>{s.grade_level_name} {s.name}</b></Link></td>
                  <td>{s.grade_level_name} <span className="muted-cell">· {s.education_level_name}</span></td>
                  <td>{s.class_teacher_name ?? <span className="muted-cell">Unassigned</span>}</td>
                  <td className="num">{s.students}</td>
                  <td className="num">
                    <StreamFormButton stream={s} grades={grades} years={yearOpts} teachers={teachers} className="btn sm ghost">Edit</StreamFormButton>{' '}
                    {!s.students ? <DeleteStreamButton id={s.id} /> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🏫" title="No classes for this year" sub={years.length ? 'Open a class for each grade.' : 'Add an academic year first.'} />}
      </Card>
    </>
  );
}

export async function SubjectsTab() {
  const [subjects, levels, grades] = await Promise.all([listSubjects(), listEducationLevels(), listGradeLevels()]);
  const gradeName = new Map(grades.map((g) => [g.id, g.name]));
  return (
    <>
      <Toolbar>
        <Spacer />
        <SubjectFormButton levels={levels} grades={grades}>Add subject</SubjectFormButton>
      </Toolbar>
      <Card>
        <CardHead title="Subjects" sub="Learning areas and the grades each one is offered in" />
        {subjects.length ? (
          <TableWrap>
            <thead><tr><th>Code</th><th>Subject</th><th>Level</th><th>Offered in</th><th>Status</th><th className="num" /></tr></thead>
            <tbody>
              {subjects.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{s.code}</td>
                  <td><b>{s.name}</b>{s.is_core ? <span className="tiny muted-cell"> · core</span> : null}</td>
                  <td>{s.education_level_name ?? <span className="muted-cell">Any</span>}</td>
                  <td className="tiny">{s.grade_level_ids.length ? s.grade_level_ids.map((id) => gradeName.get(id)).filter(Boolean).join(', ') : <span className="muted-cell">—</span>}</td>
                  <td><Pill status={s.status} /></td>
                  <td className="num">
                    <SubjectFormButton subject={s} levels={levels} grades={grades} className="btn sm ghost">Edit</SubjectFormButton>{' '}
                    <DeleteSubjectButton id={s.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="📚" title="No subjects yet" />}
      </Card>
    </>
  );
}

export async function GradingTab() {
  const [scales, levels] = await Promise.all([listGradingScales(), listEducationLevels()]);
  return (
    <>
      <Toolbar>
        <Spacer />
        <GradingScaleFormButton levels={levels}>Add grading scale</GradingScaleFormButton>
      </Toolbar>
      {scales.length ? scales.map((s) => (
        <Card key={s.id}>
          <CardHead title={<>{s.name} {s.is_default ? <Pill tone="ok">Default</Pill> : null} {s.education_level_name ? <Pill tone="info">{s.education_level_name}</Pill> : null}</>} sub={s.bands.some((b) => b.points != null) ? 'Letter grades with points — report cards show the mean grade' : 'Score bands and the competency label each one earns'}>
            <GradingScaleFormButton scale={s} levels={levels} className="btn sm ghost">Edit</GradingScaleFormButton>{' '}
            {!s.is_default ? <DeleteGradingScaleButton id={s.id} /> : null}
          </CardHead>
          <TableWrap>
            <thead><tr><th>Band</th><th className="num">From</th><th className="num">To</th><th className="num">Points</th></tr></thead>
            <tbody>
              {s.bands.map((b) => (
                <tr key={b.id}>
                  <td><span className="pill" style={{ background: b.color_hex, color: '#fff' }}>{b.label}</span></td>
                  <td className="num">{b.min_score}</td>
                  <td className="num">{b.max_score}</td>
                  <td className="num">{b.points ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      )) : <Card><EmptyState icon="🎯" title="No grading scales yet" sub="Add a scale so marks earn a competency label on report cards." /></Card>}
    </>
  );
}

export async function AssessmentTypesTab() {
  const rows = await listAssessmentTypes();
  return (
    <>
      <Toolbar>
        <Spacer />
        <AssessmentTypeFormButton>Add assessment type</AssessmentTypeFormButton>
      </Toolbar>
      <Card>
        <CardHead title="Assessment types" sub="CATs, projects and exams, weighted into the term average" />
        {rows.length ? (
          <TableWrap>
            <thead><tr><th>Name</th><th className="num">Weight</th><th>Exam</th><th className="num" /></tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td><b>{t.name}</b></td>
                  <td className="num">{t.weight}</td>
                  <td>{t.is_exam ? <Pill tone="info">Exam</Pill> : <span className="muted-cell">—</span>}</td>
                  <td className="num">
                    <AssessmentTypeFormButton type={t} className="btn sm ghost">Edit</AssessmentTypeFormButton>{' '}
                    <DeleteAssessmentTypeButton id={t.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🧪" title="No assessment types yet" />}
      </Card>
    </>
  );
}

export async function FeeItemsTab() {
  const [items, accounts] = await Promise.all([listFeeItems(), listGlAccounts({ filters: [] })]);
  const income = accounts.filter((a) => a.is_postable && a.status === 'ACTIVE' && a.type === 'INCOME').map((a) => ({ id: a.id, code: a.code, name: a.name }));
  return (
    <>
      <Toolbar>
        <Spacer />
        <FeeItemFormButton accounts={income}>Add fee item</FeeItemFormButton>
      </Toolbar>
      <Card>
        <CardHead title="Fee items" sub="What the school bills — each item credits its own income account when a fee invoice posts" />
        {items.length ? (
          <TableWrap>
            <thead><tr><th>Code</th><th>Fee item</th><th>Income account</th><th>Billed to</th><th>Status</th><th className="num" /></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td className="mono">{i.code}</td>
                  <td><b>{i.name}</b></td>
                  <td><span className="mono">{i.gl_account_code}</span> {i.gl_account_name}</td>
                  <td>{i.applies_to === 'ALL' ? 'Everyone' : i.applies_to === 'BOARDER' ? 'Boarders' : i.applies_to === 'DAY' ? 'Day scholars' : 'Opt-in'}</td>
                  <td><Pill status={i.status} /></td>
                  <td className="num">
                    <FeeItemFormButton item={i} accounts={income} className="btn sm ghost">Edit</FeeItemFormButton>{' '}
                    <DeleteFeeItemButton id={i.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🏷" title="No fee items yet" sub="Add Tuition, Boarding, Transport… and point each at its income account." />}
      </Card>
    </>
  );
}
