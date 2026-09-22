import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import { getStudent } from '@/lib/students';
import { listStreams, getCurrentAcademicYear, getCurrentTerm, listTerms } from '@/lib/academics/setup';
import { listCounties, listSubCounties } from '@/lib/pool';
import { feeAccountSummary, feeStatement } from '@/lib/fees/statement';
import { listStudentFeeInvoices } from '@/lib/fees/invoices';
import { studentAttendanceSummary, listStudentAttendance } from '@/lib/academics/attendance';
import { listStudentMarks, listPublishedTerms } from '@/lib/academics/assessments';
import { listAttachments } from '@/lib/attachments';
import { docFormProps } from '@/app/cash-management/doc-form-props';
import { imageSrc, isConfigured } from '@/lib/cloudinary';
import { formatDate, formatDateTime, today } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { Card, CardHead, DefinitionList, EmptyState, Pill, Stat, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { EditableCard } from '@/components/ui/editable-card';
import { Money } from '@/components/ui/money';
import { AttachmentPanel } from '@/components/attachments/attachment-panel';
import { NewReceiptButton } from '@/app/cash-management/receipt-form';
import { EditStudentForm } from '../../student-form';
import { StudentStatusButton, PlaceStudentButton, StudentPhoto } from '../../student-actions';
import { SendReminderButton } from '@/app/fees/fee-actions';
import { listStudentFeeOptions, listStudentFeeDiscounts, studentBill } from '@/lib/fees/billing';
import { listActiveFeeItems } from '@/lib/fees/setup';
import { FeeOptionsForm, DiscountsTable } from '../../fee-options';
import { IncidentsCard } from '../../incidents-card';
import { ElectivesCard } from '../../electives-card';
import { listStudentIncidents } from '@/lib/incidents';
import { listSubjectsForGrade, listSubjectsForStudent } from '@/lib/academics/setup';
import { getStudentTransport, listRoutes } from '@/lib/transport';
import { studentBed, listBeds } from '@/lib/hostel';
import { studentLoans } from '@/lib/library';
import { ServicesCard } from '../../services-card';

export default async function StudentPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ term?: string }>;
}) {
  const user = await requireAction('STUDENTS_READ');
  const { id: idParam } = await params;
  const { term: termParam } = await searchParams;
  const id = Number(idParam);
  const student = await getStudent(id);
  if (!student) notFound();

  const [year, currentTerm] = await Promise.all([getCurrentAcademicYear(), getCurrentTerm()]);
  const terms = year ? await listTerms(year.id) : [];
  const term = terms.find((t) => String(t.id) === termParam) ?? currentTerm ?? terms[0];
  const from = term?.start_date ?? `${new Date().getFullYear()}-01-01`;
  const to = term ? (term.end_date < today() ? term.end_date : today()) : today();

  const [canEdit, canPlace, canFees, canRemind, canReceipt, streams, counties, subCounties, fees, statement, invoices, attendance, absences, marks, published, attachments] = await Promise.all([
    currentCanAction('STUDENTS_UPDATE'), currentCanAction('CLASSES_MANAGE'), currentCanAction('FEES_READ'), currentCanAction('FEES_REMIND'), currentCanAction('CASH_MGMT_RECEIPT_CREATE'),
    listStreams(year?.id ?? null), listCounties(), listSubCounties(),
    feeAccountSummary(id), feeStatement(id).catch(() => null), listStudentFeeInvoices(id),
    studentAttendanceSummary(id, from, to), listStudentAttendance(id, from, to).then((r) => r.filter((a) => a.status !== 'PRESENT')),
    term ? listStudentMarks(id, term.id) : Promise.resolve([]), listPublishedTerms(id), listAttachments('student', id),
  ]);
  const fp = canReceipt ? await docFormProps() : null;
  const [feeOptions, discounts, feeItems, canFeeSetup, allTerms, incidents, canIncidents, canIncidentsManage, offered, taken, canElectives] = await Promise.all([
    listStudentFeeOptions(id), listStudentFeeDiscounts(id), listActiveFeeItems(), currentCanAction('FEES_STRUCTURE_MANAGE'), listTerms(),
    listStudentIncidents(id), currentCanAction('INCIDENTS_READ'), currentCanAction('INCIDENTS_MANAGE'),
    student.current_grade_level_id ? listSubjectsForGrade(student.current_grade_level_id) : Promise.resolve([]), listSubjectsForStudent(id), currentCanAction('STUDENTS_SUBJECTS_MANAGE'),
  ]);
  const [ride, routes, canTransport, bed, beds, canHostel, loans, canLibrary] = await Promise.all([
    getStudentTransport(id), listRoutes(), currentCanAction('TRANSPORT_MANAGE'), studentBed(id), listBeds(), currentCanAction('HOSTEL_MANAGE'), studentLoans(id), currentCanAction('LIBRARY_MANAGE'),
  ]);
  const nextBill = term && student.current_grade_level_id ? await studentBill({ id, grade_level_id: student.current_grade_level_id, boarding_status: student.boarding_status }, term.id) : null;
  const name = `${student.first_name} ${student.middle_name ? `${student.middle_name} ` : ''}${student.last_name}`;
  const className = student.grade_level_name ? `${student.grade_level_name} ${student.stream_name ?? ''}`.trim() : null;
  const primary = student.guardians.find((g) => g.is_primary) ?? student.guardians[0];

  // Marks grouped by subject for the term at a glance.
  const bySubject = new Map<string, typeof marks>();
  for (const m of marks) { const k = m.subject_name; bySubject.set(k, [...(bySubject.get(k) ?? []), m]); }

  return (
    <Page title={`${name} — ${student.admission_no}`} crumb={`${className ?? 'Not placed'} · ${student.status}${primary ? ` · ${primary.full_name} (${primary.phone})` : ''}`} user={user}>
      <Toolbar>
        <Link href="/students" className="btn ghost sm">← All students</Link>
        <Spacer />
        {canPlace && student.status === 'ACTIVE' ? <PlaceStudentButton id={id} streams={streams} currentStreamId={student.current_stream_id} /> : null}
        {canEdit ? <StudentStatusButton id={id} current={student.status} /> : null}
        <Link href={`/print/student-id/${id}`} className="btn ghost" target="_blank">ID card</Link>
        {student.status !== 'ACTIVE' ? <Link href={`/print/leaving-certificate/${id}`} className="btn ghost" target="_blank">Leaving certificate</Link> : null}
        {canRemind && fees && fees.balance > 0 ? <SendReminderButton studentIds={[id]} className="btn ghost" /> : null}
        {fp && student.customer_no ? (
          <NewReceiptButton {...fp} label="Record a fee payment" preset={[{ lineType: 'Customer', accountNo: student.customer_no, description: `Fees — ${student.admission_no} ${name}`, amount: fees && fees.balance > 0 ? String(fees.balance / 100) : '' }]} />
        ) : null}
      </Toolbar>

      <div className="grid g4">
        <Stat label="Fee balance" value={<Money cents={fees?.balance ?? 0} />} foot={fees?.overdue ? <><Money cents={fees.overdue} /> overdue</> : 'Nothing overdue'} accent={!!fees && fees.balance > 0} />
        <Stat label="Attendance this term" value={`${attendance.rate}%`} foot={`${attendance.present} of ${attendance.total} days present`} />
        <Stat label="Marks this term" value={String(marks.length)} foot={term ? `${term.name} ${term.year_name}` : 'No term open'} />
        <Stat label="Report cards" value={String(published.length)} foot={published[0] ? `Latest: ${published[0].term_name} ${published[0].year_name}` : 'None published yet'} />
      </div>

      <Card>
        <CardHead title="Identity" sub="Photo, admission and placement">
          <Pill status={student.status} />
        </CardHead>
        <div className="grid g2">
          <StudentPhoto studentId={id} name={name} photoSrc={imageSrc(student.photo, { width: 192, height: 192, crop: 'fill' })} canEdit={canEdit} mediaEnabled={isConfigured()} />
          <DefinitionList items={[
            ['Admission No.', <span className="mono" key="no">{student.admission_no}</span>],
            ['Admitted', formatDate(student.admission_date)],
            ['Class', className ? <Link href={`/classes/${student.current_stream_id}`} key="c">{className}</Link> : '—'],
            ['Fee account', student.customer_no ? <Link href={`/receivables/customers/${encodeURIComponent(student.customer_no)}`} className="mono" key="f">{student.customer_no}</Link> : '—'],
            ['Created', `${student.created_by ?? '—'} · ${formatDateTime(student.created_at)}`],
          ]} />
        </div>
      </Card>

      <EditableCard title="Bio-data & guardians" sub="Personal details, home and the guardians on file" canEdit={canEdit}
        form={<EditStudentForm student={student} lookups={{ streams, counties, subCounties }} />}>
        <div className="grid g2 dl-groups">
          <section className="dl-group">
            <div className="dl-caption">Personal</div>
            <DefinitionList items={[
              ['Gender', student.gender ? student.gender[0] + student.gender.slice(1).toLowerCase() : '—'],
              ['Date of birth', student.date_of_birth ? formatDate(student.date_of_birth) : '—'],
              ['Birth certificate', student.birth_certificate_no ?? '—'],
              ['NEMIS UPI', student.nemis_upi ?? '—'],
              ['Religion', student.religion ?? '—'],
              ['Boarding', student.boarding_status === 'BOARDER' ? 'Boarder' : 'Day scholar'],
              ['House', student.house ?? '—'],
              ['Medical notes', student.medical_notes ?? '—'],
            ]} />
          </section>
          <section className="dl-group">
            <div className="dl-caption">Home</div>
            <DefinitionList items={[
              ['County', student.county_name ?? '—'],
              ['Sub-county', student.sub_county_name ?? '—'],
              ['Address', student.address ?? '—'],
            ]} />
          </section>
        </div>
        <div className="hint" style={{ margin: '12px 0 6px' }}>Guardians</div>
        {student.guardians.length ? (
          <TableWrap>
            <thead><tr><th>Name</th><th>Relationship</th><th>Phone</th><th>Email</th><th>National ID</th><th /></tr></thead>
            <tbody>
              {student.guardians.map((g) => (
                <tr key={g.id}>
                  <td><Link href={`/guardians/${g.id}`}><b>{g.full_name}</b></Link></td>
                  <td>{g.relationship}</td>
                  <td className="mono">{g.phone}</td>
                  <td>{g.email ?? '—'}</td>
                  <td className="mono">{g.national_id ?? '—'}</td>
                  <td>{g.is_primary ? <Pill tone="ok">Primary</Pill> : null}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="👪" title="No guardian on file" />}
      </EditableCard>

      {canFees ? (
        <CollapsibleCard title="Fees" sub={fees ? `Fee account ${fees.customer_no}` : 'No fee account'} actions={student.customer_no ? <Link href={`/fees/statement?student=${id}`} className="btn sm ghost">Full statement</Link> : undefined}>
          {fees ? (
            <>
              <div className="grid g4">
                <Stat label="Invoiced to date" value={<Money cents={fees.invoiced} />} small accent={false} />
                <Stat label="Paid to date" value={<Money cents={fees.paid} />} small accent={false} foot={fees.last_payment_date ? `Last paid ${formatDate(fees.last_payment_date)}` : undefined} />
                <Stat label="Balance" value={<Money cents={fees.balance} />} small />
                <Stat label="Next due" value={fees.next_due_date ? formatDate(fees.next_due_date) : '—'} small accent={false} foot={fees.overdue ? <><Money cents={fees.overdue} /> past due</> : undefined} />
              </div>
              <div className="hint" style={{ margin: '12px 0 6px' }}>Fee invoices</div>
              {invoices.length ? (
                <TableWrap>
                  <thead><tr><th>Invoice</th><th>Term</th><th>Posted</th><th>Due</th><th className="num">Amount</th><th className="num">Outstanding</th></tr></thead>
                  <tbody>
                    {invoices.map((i) => (
                      <tr key={i.id}>
                        <td className="mono">{i.posted_invoice_no ? <Link href={`/receivables/posted/${encodeURIComponent(i.posted_invoice_no)}`}>{i.posted_invoice_no}</Link> : <span className="muted-cell">{i.run_no} (unposted)</span>}</td>
                        <td>{i.term_name} {i.year_name}</td>
                        <td>{i.posting_date ? formatDate(i.posting_date) : '—'}</td>
                        <td>{i.due_date ? formatDate(i.due_date) : '—'}</td>
                        <td className="num"><Money cents={i.amount} /></td>
                        <td className="num"><Money cents={i.remaining_amount} /></td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              ) : <EmptyState icon="🧾" title="No fee invoices yet" />}
              {statement && statement.lines.length ? (
                <>
                  <div className="hint" style={{ margin: '12px 0 6px' }}>Recent activity</div>
                  <TableWrap>
                    <thead><tr><th>Date</th><th>Document</th><th>Description</th><th className="num">Amount</th><th className="num">Balance</th></tr></thead>
                    <tbody>
                      {statement.lines.slice(-8).map((l) => (
                        <tr key={l.id}>
                          <td>{formatDate(l.posting_date)}</td>
                          <td className="mono">{l.document_type} {l.document_no}</td>
                          <td>{l.description ?? '—'}</td>
                          <td className="num"><Money cents={l.amount} /></td>
                          <td className="num"><Money cents={l.running_balance} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </TableWrap>
                </>
              ) : null}
            </>
          ) : <EmptyState icon="💰" title="No fee account" sub="Opened automatically on admission — re-save the student to create one." />}
        </CollapsibleCard>
      ) : null}

      {canFees ? (
        <CollapsibleCard title="Fee options & discounts" sub={`${student.boarding_status === 'BOARDER' ? 'Boarder' : 'Day scholar'} · ${feeOptions.length} optional item${feeOptions.length === 1 ? '' : 's'} · ${discounts.filter((d) => d.status === 'ACTIVE').length} active discount${discounts.filter((d) => d.status === 'ACTIVE').length === 1 ? '' : 's'}`}>
          <div className="grid g2">
            <div>
              <div className="hint" style={{ marginBottom: 6 }}>Optional items this student takes</div>
              <FeeOptionsForm studentId={id} items={feeItems.filter((i) => i.applies_to === 'OPT_IN')} selected={feeOptions.map((o) => o.fee_item_id)} canEdit={canFeeSetup} />
            </div>
            <div>
              <div className="hint" style={{ marginBottom: 6 }}>{term ? `What ${term.name} bills` : 'Next bill'}</div>
              {nextBill && nextBill.lines.length ? (
                <TableWrap sortable={false}>
                  <tbody>
                    {nextBill.lines.map((l) => <tr key={l.fee_item_id}><td>{l.fee_item_name}</td><td className="num"><Money cents={l.amount} /></td></tr>)}
                    {nextBill.discounts.map((d) => <tr key={d.discount_id}><td className="muted-cell">Less: {d.description}</td><td className="num muted-cell">(<Money cents={d.amount} />)</td></tr>)}
                    <tr><th>Net for the term</th><th className="num"><Money cents={nextBill.net} /></th></tr>
                  </tbody>
                </TableWrap>
              ) : <EmptyState icon="🏗" title="No fee structure for this grade and term" />}
            </div>
          </div>
          <DiscountsTable studentId={id} rows={discounts} feeItems={feeItems} terms={allTerms} canEdit={canFeeSetup} />
        </CollapsibleCard>
      ) : null}

      <CollapsibleCard title="Academics" sub={term ? `${term.name} ${term.year_name}` : 'No term'} actions={terms.length > 1 ? (
        <span className="inline" style={{ gap: 4 }}>
          {terms.map((t) => <Link key={t.id} href={`/students/view/${id}?term=${t.id}`} className={`btn sm ${t.id === term?.id ? '' : 'ghost'}`}>{t.name}</Link>)}
        </span>
      ) : undefined}>
        <div className="grid g2">
          <div>
            <div className="hint" style={{ marginBottom: 6 }}>Marks</div>
            {bySubject.size ? (
              <TableWrap>
                <thead><tr><th>Subject</th><th>Assessments</th><th className="num">Average</th></tr></thead>
                <tbody>
                  {[...bySubject.entries()].map(([subject, rows]) => {
                    const avg = rows.reduce((s, r) => s + Number(r.score) * Number(r.weight), 0) / rows.reduce((s, r) => s + Number(r.weight), 0);
                    return (
                      <tr key={subject}>
                        <td><b>{subject}</b></td>
                        <td className="tiny">{rows.map((r) => `${r.assessment_type_name}: ${r.score}`).join(' · ')}</td>
                        <td className="num"><b>{avg.toFixed(1)}</b>{rows[0].competency_label ? <div className="tiny">{rows[rows.length - 1].competency_label}</div> : null}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableWrap>
            ) : <EmptyState icon="📝" title="No marks this term" />}
            {published.length ? (
              <div style={{ marginTop: 8 }} className="inline">
                {published.map((p) => <Link key={p.term_id} href={`/report-cards/${id}/${p.term_id}`} className="btn sm ghost">Report card — {p.term_name} {p.year_name}</Link>)}
              </div>
            ) : null}
          </div>
          <div>
            <div className="hint" style={{ marginBottom: 6 }}>Attendance — {attendance.rate}% ({attendance.present}/{attendance.total})</div>
            {absences.length ? (
              <TableWrap>
                <thead><tr><th>Date</th><th>Status</th><th>Remarks</th></tr></thead>
                <tbody>
                  {absences.slice(0, 15).map((a) => (
                    <tr key={a.id}><td>{formatDate(a.date)}</td><td><Pill status={a.status} /></td><td>{a.remarks ?? '—'}</td></tr>
                  ))}
                </tbody>
              </TableWrap>
            ) : <EmptyState icon="✅" title={attendance.total ? 'Present every day marked' : 'No register marked yet'} />}
          </div>
        </div>
      </CollapsibleCard>

      <CollapsibleCard title="Enrolment history" sub={`${student.enrollments.length} record${student.enrollments.length === 1 ? '' : 's'}`} defaultCollapsed>
        {student.enrollments.length ? (
          <TableWrap>
            <thead><tr><th>Year</th><th>Grade</th><th>Class</th><th>Status</th><th>Since</th></tr></thead>
            <tbody>
              {student.enrollments.map((e) => (
                <tr key={e.id}><td>{e.year_name}</td><td>{e.grade_level_name}</td><td>{e.stream_name ?? '—'}</td><td><Pill status={e.status} /></td><td>{formatDateTime(e.created_at)}</td></tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="📚" title="No enrolment yet" />}
      </CollapsibleCard>

      {student.current_grade_level_id ? <ElectivesCard studentId={id} offered={offered} taken={taken.map((t) => t.id)} canEdit={canElectives && student.status === 'ACTIVE'} /> : null}
      {canIncidents ? <IncidentsCard studentId={id} rows={incidents} canManage={canIncidentsManage} /> : null}
      <ServicesCard studentId={id} boarder={student.boarding_status === 'BOARDER'} ride={ride ?? null} routes={routes.filter((r) => r.status === 'ACTIVE')} canTransport={(canTransport || canEdit) && student.status === 'ACTIVE'}
        bed={bed ?? null} freeBeds={beds.filter((b) => !b.allocation_id && b.status === 'AVAILABLE' && (b.hostel_gender === 'MIXED' || !student.gender || b.hostel_gender === student.gender))} canHostel={canHostel && student.status === 'ACTIVE'} loans={loans} canLibrary={canLibrary} />
      <AttachmentPanel entity="student" entityId={id} attachments={attachments} canManage={canEdit} mediaEnabled={isConfigured()} />
    </Page>
  );
}
