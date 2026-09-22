import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import { getTeacher, listTeacherAssignments } from '@/lib/academics/teachers';
import { listStreams, listActiveSubjects, getCurrentAcademicYear, getCurrentTerm } from '@/lib/academics/setup';
import { listTeacherTimetable } from '@/lib/academics/timetable';
import { listPortalLogins } from '@/lib/portal';
import { all } from '@/lib/db';
import { imageSrc } from '@/lib/cloudinary';
import { initials } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { Card, CardHead, DefinitionList, EmptyState, Pill, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { TimetableGrid } from '@/components/school/timetable-grid';
import { TeacherProfileFormButton, RemoveTeacherButton, AssignTeacherButton, UnassignButton } from '../teacher-forms';

export default async function TeacherPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAction('TEACHERS_READ');
  const { id: idParam } = await params;
  const employeeId = Number(idParam);
  const teacher = await getTeacher(employeeId);
  if (!teacher) notFound();
  const [year, term, canManage] = await Promise.all([getCurrentAcademicYear(), getCurrentTerm(), currentCanAction('TEACHERS_MANAGE')]);
  const [assignments, streams, subjects, slots, classTeacherOf, logins] = await Promise.all([
    listTeacherAssignments(employeeId, year?.id), listStreams(year?.id ?? null), listActiveSubjects(),
    term ? listTeacherTimetable(employeeId, term.id) : Promise.resolve([]),
    all<{ id: number; name: string; grade_level_name: string }>(
      `SELECT s.id, s.name, g.name AS grade_level_name FROM stream s JOIN grade_level g ON g.id = s.grade_level_id JOIN academic_year y ON y.id = s.academic_year_id
       WHERE s.class_teacher_id = ? AND y.is_current ORDER BY g.sort, s.name`, employeeId),
    listPortalLogins({ employeeId }),
  ]);
  const name = `${teacher.first_name} ${teacher.last_name}`;
  const photo = imageSrc(teacher.photo_image, { width: 192, height: 192, crop: 'fill' });

  return (
    <Page title={`${name} — ${teacher.employee_no}`} crumb={`${teacher.specialisation ?? 'Teaching staff'} · ${teacher.employee_status}`} user={user}>
      <Toolbar>
        <Link href="/teachers" className="btn ghost sm">← Teaching staff</Link>
        <Spacer />
        <Link href={`/employees/view/${employeeId}`} className="btn ghost">HR record</Link>
        {canManage ? <TeacherProfileFormButton teacher={teacher} className="btn ghost">Edit profile</TeacherProfileFormButton> : null}
        {canManage ? <RemoveTeacherButton employeeId={employeeId} /> : null}
      </Toolbar>

      <Card>
        <CardHead title="Profile" sub="The teaching profile — HR keeps the employment record"><Pill status={teacher.employee_status} /></CardHead>
        <div className="grid g2">
          <div className="inline" style={{ gap: 14 }}>
            <div style={{ width: 96, height: 96, borderRadius: '50%', overflow: 'hidden', flex: '0 0 auto' }}>
              {photo ? <img src={photo} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div className="avatar" style={{ width: 96, height: 96, fontSize: 30 }}>{initials(name)}</div>}
            </div>
            <DefinitionList items={[
              ['TSC number', teacher.tsc_number ?? '—'], ['Qualification', teacher.qualification ?? '—'], ['Specialisation', teacher.specialisation ?? '—'],
            ]} />
          </div>
          <DefinitionList items={[
            ['Phone', teacher.phone ?? '—'], ['Email', teacher.email ?? '—'],
            ['Class teacher of', classTeacherOf.length ? classTeacherOf.map((c) => <Link key={c.id} href={`/classes/${c.id}`} style={{ marginRight: 8 }}>{c.grade_level_name} {c.name}</Link>) : '—'],
            ['Portal login', logins.length ? logins.map((l) => l.username).join(', ') : <span className="muted-cell" key="l">None — link a user under Administration › Security › User Setup</span>],
          ]} />
        </div>
      </Card>

      <Card>
        <CardHead title={`Subjects taught — ${year?.name ?? 'no current year'}`} sub="Each assignment lets the teacher mark the register and enter marks for that class">
          {canManage && year ? <AssignTeacherButton teacherId={employeeId} streams={streams} subjects={subjects} className="btn sm">Assign a subject</AssignTeacherButton> : null}
        </CardHead>
        {assignments.length ? (
          <TableWrap>
            <thead><tr><th>Class</th><th>Subject</th><th className="num">Students</th><th className="num" /></tr></thead>
            <tbody>
              {assignments.map((a) => (
                <tr key={a.id}>
                  <td><Link href={`/classes/${a.stream_id}`}><b>{a.grade_level_name} {a.stream_name}</b></Link></td>
                  <td>{a.subject_name} <span className="tiny mono">{a.subject_code}</span></td>
                  <td className="num">{a.students}</td>
                  <td className="num">{canManage ? <UnassignButton id={a.id} /> : null}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="📚" title="No subjects assigned this year" />}
      </Card>

      <Card>
        <CardHead title={`Timetable — ${term ? `${term.name} ${term.year_name}` : 'no current term'}`} sub="Where this teacher is, period by period" />
        {slots.length ? <TimetableGrid slots={slots} focus="teacher" /> : <EmptyState icon="🗓" title="Nothing timetabled this term" />}
      </Card>
    </Page>
  );
}
