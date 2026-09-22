import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction, requireModuleTab } from '@/lib/session';
import { listTerms, listAcademicYears, listGradeLevels, listStreams, getCurrentTerm, resolveTerm, getCurrentAcademicYear } from '@/lib/academics/setup';
import { listActiveFeeItems, listFeeStructure } from '@/lib/fees/setup';
import { listFeeInvoiceRuns, listTermInvoices, listFeeBalances } from '@/lib/fees/invoices';
import { feeAccountSummary, feeStatement } from '@/lib/fees/statement';
import { getStudent, listActiveStudentsPick } from '@/lib/students';
import { formatDate, today } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { Card, CardHead, EmptyState, Pill, Stat, TableWrap, Tabs, Toolbar, Spacer, type TabDefinition } from '@/components/ui/primitives';
import { Money } from '@/components/ui/money';
import { SelectFilter, DateFilterInput } from '@/components/ui/filters';
import { StudentPicker } from '../student-picker';
import { FeeStructureGrid, CopyStructureButton, NewInvoiceRunButton, SendReminderButton } from '../fee-actions';
import type { AcademicTermWithYear } from '@/lib/types';

const TABS: TabDefinition[] = [
  { key: 'balances', label: 'Fee Balances' },
  { key: 'invoice-runs', label: 'Invoice Runs' },
  { key: 'invoices', label: 'Student Invoices' },
  { key: 'statement', label: 'Fee Statement' },
  { key: 'structure', label: 'Fee Structure' },
];
const TAB_PAGE: Record<string, string> = {
  balances: 'FEES_BALANCES', 'invoice-runs': 'FEES_INVOICE_RUNS', invoices: 'FEES_INVOICES', statement: 'FEES_STATEMENT', structure: 'FEES_STRUCTURE',
};

export default async function FeesPage({ params, searchParams }: {
  params: Promise<{ tab?: string[] }>;
  searchParams: Promise<{ term?: string; grade?: string; stream?: string; overdue?: string; student?: string; from?: string; to?: string }>;
}) {
  const user = await requireAction('FEES_READ');
  const { tab: segments } = await params;
  const sp = await searchParams;
  const tab = segments?.[0] ?? 'balances';
  if (!TABS.some((t) => t.key === tab)) notFound();
  const hrefFor = (k: string) => `/fees/${k === 'balances' ? '' : k}`;
  const tabs = requireModuleTab(user, TABS, TAB_PAGE, tab, !segments?.[0], hrefFor);

  return (
    <Page title="Fees" crumb="Fee structure, invoicing through the G/L, balances, reminders and statements" user={user}>
      <Tabs tabs={tabs} active={tab} hrefFor={hrefFor} />
      {tab === 'balances' ? <BalancesTab grade={sp.grade} stream={sp.stream} overdue={sp.overdue === '1'} /> : null}
      {tab === 'invoice-runs' ? <InvoiceRunsTab /> : null}
      {tab === 'invoices' ? <InvoicesTab term={sp.term} /> : null}
      {tab === 'statement' ? <StatementTab student={sp.student} from={sp.from} to={sp.to} /> : null}
      {tab === 'structure' ? <StructureTab term={sp.term} /> : null}
    </Page>
  );
}

/** The term picker shared by the tabs that are per term. */
function TermFilter({ terms, current }: { terms: AcademicTermWithYear[]; current: number | undefined }) {
  return <SelectFilter paramName="term" label="Term" allLabel={current ? 'Current term' : 'All'} options={terms.map((t) => ({ value: String(t.id), label: `${t.name} ${t.year_name}` }))} />;
}

/* ------------------------------------------------------------------ balances */

async function BalancesTab({ grade, stream, overdue }: { grade?: string; stream?: string; overdue: boolean }) {
  const year = await getCurrentAcademicYear();
  const [rows, grades, streams, canRemind] = await Promise.all([
    listFeeBalances({ gradeLevelId: grade ? Number(grade) : null, streamId: stream ? Number(stream) : null, onlyOverdue: overdue }),
    listGradeLevels(), listStreams(year?.id ?? null), currentCanAction('FEES_REMIND'),
  ]);
  const owing = rows.filter((r) => r.balance > 0);
  const total = owing.reduce((s, r) => s + Number(r.balance), 0);
  const past = owing.reduce((s, r) => s + Number(r.overdue), 0);
  return (
    <>
      <div className="grid g3">
        <Stat label="Outstanding" value={<Money cents={total} />} foot={`${owing.length} student${owing.length === 1 ? '' : 's'} owing`} />
        <Stat label="Overdue" value={<Money cents={past} />} foot={`${owing.filter((r) => r.overdue > 0).length} past due`} accent={past > 0} />
        <Stat label="In credit" value={<Money cents={-rows.filter((r) => r.balance < 0).reduce((s, r) => s + Number(r.balance), 0)} />} foot={`${rows.filter((r) => r.balance < 0).length} prepaid`} accent={false} />
      </div>
      <Toolbar>
        <SelectFilter paramName="grade" label="Grade" options={grades.map((g) => ({ value: String(g.id), label: g.name }))} />
        <SelectFilter paramName="stream" label="Class" options={streams.map((s) => ({ value: String(s.id), label: `${s.grade_level_name} ${s.name}` }))} />
        <SelectFilter paramName="overdue" label="Show" allLabel="All balances" options={[{ value: '1', label: 'Overdue only' }]} />
        <Spacer />
        {canRemind && owing.length ? <SendReminderButton gradeLevelId={grade ? Number(grade) : null} streamId={stream ? Number(stream) : null} label={`Remind ${owing.length} guardian${owing.length === 1 ? '' : 's'}`} /> : null}
      </Toolbar>
      <Card>
        {rows.length ? (
          <TableWrap>
            <thead><tr><th>Adm. No.</th><th>Student</th><th>Class</th><th>Guardian</th><th className="num">Balance</th><th className="num">Overdue</th><th>Oldest due</th><th>Last paid</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.student_id}>
                  <td className="mono"><Link href={`/students/view/${r.student_id}`}>{r.admission_no}</Link></td>
                  <td><b>{r.student_name}</b></td>
                  <td>{r.grade_level_name} {r.stream_name}</td>
                  <td>{r.guardian_name ?? '—'}<div className="tiny">{r.guardian_phone}</div></td>
                  <td className="num"><b><Money cents={r.balance} /></b></td>
                  <td className="num">{r.overdue > 0 ? <span style={{ color: 'var(--danger)' }}><Money cents={r.overdue} /></span> : '—'}</td>
                  <td>{r.oldest_due_date ? formatDate(r.oldest_due_date) : '—'}</td>
                  <td>{r.last_payment_date ? formatDate(r.last_payment_date) : '—'}</td>
                  <td className="num"><Link href={`/fees/statement?student=${r.student_id}`} className="btn sm ghost">Statement</Link></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="💰" title="No balances" sub="Every fee account is settled — or nothing has been invoiced yet." />}
      </Card>
    </>
  );
}

/* -------------------------------------------------------------- invoice runs */

async function InvoiceRunsTab() {
  const [runs, terms, grades, current, canRun] = await Promise.all([listFeeInvoiceRuns(), listTerms(), listGradeLevels(), getCurrentTerm(), currentCanAction('FEES_INVOICE_RUN')]);
  return (
    <>
      <Toolbar>
        <Spacer />
        {canRun ? <NewInvoiceRunButton terms={terms} grades={grades} defaultTermId={current?.id} /> : null}
      </Toolbar>
      <Card>
        <CardHead title="Fee invoice runs" sub="Each run bills a term's fee structure to every Active student, one posted Sales Invoice per student" />
        {runs.length ? (
          <TableWrap>
            <thead><tr><th>No.</th><th>Term</th><th>Grade</th><th>Posting date</th><th>Due date</th><th className="num">Students</th><th className="num">Total</th><th>Status</th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="mono"><Link href={`/fees/invoice-runs/${encodeURIComponent(r.no)}`}>{r.no}</Link></td>
                  <td>{r.term_name} {r.year_name}</td>
                  <td>{r.grade_level_name ?? 'All grades'}</td>
                  <td>{formatDate(r.posting_date)}</td>
                  <td>{formatDate(r.due_date)}</td>
                  <td className="num">{r.students_billed}</td>
                  <td className="num"><Money cents={r.total_amount} /></td>
                  <td><Pill status={r.status} tone={r.status === 'Posted' ? 'ok' : 'warn'}>{r.status}</Pill></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🧾" title="No invoice runs yet" sub="Set the fee structure for the term, then create a run." />}
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ invoices */

async function InvoicesTab({ term: termParam }: { term?: string }) {
  const [terms, term] = await Promise.all([listTerms(), resolveTerm(termParam ? Number(termParam) : null)]);
  const rows = term ? await listTermInvoices(term.id) : [];
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  const open = rows.reduce((s, r) => s + Number(r.remaining_amount), 0);
  return (
    <>
      <Toolbar>
        <TermFilter terms={terms} current={term?.id} />
        <Spacer />
        {term ? <span className="tiny">{term.name} {term.year_name}: {rows.length} invoice{rows.length === 1 ? '' : 's'} · <Money cents={total} /> billed · <Money cents={open} /> open</span> : null}
      </Toolbar>
      <Card>
        {rows.length ? (
          <TableWrap>
            <thead><tr><th>Invoice</th><th>Adm. No.</th><th>Student</th><th>Class</th><th>Run</th><th>Due</th><th className="num">Amount</th><th className="num">Open</th></tr></thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id}>
                  <td className="mono"><Link href={`/receivables/posted/${encodeURIComponent(i.posted_invoice_no)}`}>{i.posted_invoice_no}</Link></td>
                  <td className="mono"><Link href={`/students/view/${i.student_id}`}>{i.admission_no}</Link></td>
                  <td>{i.student_name}</td>
                  <td>{i.grade_level_name} {i.stream_name}</td>
                  <td className="mono"><Link href={`/fees/invoice-runs/${encodeURIComponent(i.run_no)}`}>{i.run_no}</Link></td>
                  <td>{i.due_date ? formatDate(i.due_date) : '—'}</td>
                  <td className="num"><Money cents={i.amount} /></td>
                  <td className="num">{i.remaining_amount > 0 ? <Money cents={i.remaining_amount} /> : <Pill tone="ok">Paid</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="📄" title={term ? `No invoices for ${term.name} ${term.year_name}` : 'No term selected'} />}
      </Card>
    </>
  );
}

/* ----------------------------------------------------------------- statement */

async function StatementTab({ student: studentParam, from, to }: { student?: string; from?: string; to?: string }) {
  const students = await listActiveStudentsPick();
  const studentId = studentParam ? Number(studentParam) : null;
  const student = studentId ? await getStudent(studentId) : undefined;
  const [summary, statement] = student ? await Promise.all([feeAccountSummary(student.id), feeStatement(student.id, from || null, to || null).catch(() => null)]) : [null, null];
  return (
    <>
      <Toolbar>
        <StudentPicker students={students} value={studentId ? String(studentId) : ''} />
        <DateFilterInput paramName="from" label="From" />
        <DateFilterInput paramName="to" label="To" />
        <Spacer />
        {student ? <Link href={`/print/fee-statement/${student.id}?from=${from ?? ''}&to=${to ?? ''}`} className="btn ghost" target="_blank">Print</Link> : null}
      </Toolbar>
      {student ? (
        <>
          <div className="grid g4">
            <Stat label="Student" value={`${student.first_name} ${student.last_name}`} foot={`${student.admission_no} · ${student.grade_level_name ?? ''} ${student.stream_name ?? ''}`} accent={false} />
            <Stat label="Invoiced to date" value={<Money cents={summary?.invoiced ?? 0} />} accent={false} />
            <Stat label="Paid to date" value={<Money cents={summary?.paid ?? 0} />} accent={false} foot={summary?.last_payment_date ? `Last paid ${formatDate(summary.last_payment_date)}` : undefined} />
            <Stat label="Balance" value={<Money cents={summary?.balance ?? 0} />} foot={summary?.overdue ? <><Money cents={summary.overdue} /> overdue</> : 'Nothing overdue'} />
          </div>
          <Card>
            <CardHead title="Fee statement" sub={`${from ? formatDate(from) : 'Start'} – ${formatDate(to || today())} · fee account ${summary?.customer_no ?? ''}`} />
            {statement ? (
              <TableWrap sortable={false}>
                <thead><tr><th>Date</th><th>Document</th><th>Description</th><th>Due</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
                <tbody>
                  <tr className="muted"><td colSpan={6}><i>Balance brought forward</i></td><td className="num"><Money cents={statement.opening} /></td></tr>
                  {statement.lines.map((l) => (
                    <tr key={l.id}>
                      <td>{formatDate(l.posting_date)}</td>
                      <td className="mono">{l.document_type} {l.document_no}</td>
                      <td>{l.description ?? '—'}</td>
                      <td>{l.due_date ? formatDate(l.due_date) : '—'}</td>
                      <td className="num">{l.amount > 0 ? <Money cents={l.amount} /> : ''}</td>
                      <td className="num">{l.amount < 0 ? <Money cents={-l.amount} /> : ''}</td>
                      <td className="num"><Money cents={l.running_balance} /></td>
                    </tr>
                  ))}
                  <tr><th colSpan={6}>Closing balance</th><th className="num"><Money cents={statement.closing} /></th></tr>
                </tbody>
              </TableWrap>
            ) : <EmptyState icon="📑" title="No fee account" />}
          </Card>
        </>
      ) : <Card><EmptyState icon="📑" title="Pick a student" sub="Search by admission number or name to see the fee statement." /></Card>}
    </>
  );
}

/* ----------------------------------------------------------------- structure */

async function StructureTab({ term: termParam }: { term?: string }) {
  const [terms, term, grades, items, canEdit] = await Promise.all([listTerms(), resolveTerm(termParam ? Number(termParam) : null), listGradeLevels(), listActiveFeeItems(), currentCanAction('FEES_STRUCTURE_MANAGE')]);
  const rows = term ? await listFeeStructure(term.id) : [];
  const years = await listAcademicYears();
  return (
    <>
      <Toolbar>
        <TermFilter terms={terms} current={term?.id} />
        <Spacer />
        {canEdit && term && !rows.length && terms.length > 1 ? <CopyStructureButton toTermId={term.id} terms={terms} /> : null}
        {canEdit ? <Link href="/admin/pool/academics/fee-items" className="btn ghost">Fee items</Link> : null}
      </Toolbar>
      <Card>
        <CardHead title={term ? `Fee structure — ${term.name} ${term.year_name}` : 'Fee structure'} sub="What each grade pays per term, item by item — an invoice run bills exactly these lines" />
        {!term ? <EmptyState icon="📆" title="No term" sub={years.length ? 'Pick a term above.' : 'Add an academic year and its terms first.'} />
          : !items.length ? <EmptyState icon="🏷" title="No fee items yet" sub="Add fee items (Tuition, Boarding…) in Administration › Academics › Fee Items." />
            : !grades.length ? <EmptyState icon="🧱" title="No grade levels yet" />
              : <FeeStructureGrid key={term.id} termId={term.id} grades={grades} items={items} rows={rows} canEdit={canEdit} />}
      </Card>
    </>
  );
}
