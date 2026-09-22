import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import { getFeeInvoiceRun, listRunInvoices, previewRun } from '@/lib/fees/invoices';
import { formatDate, formatDateTime } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { Card, CardHead, DefinitionList, EmptyState, Pill, Stat, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { Money } from '@/components/ui/money';
import { PostRunButton, DeleteRunButton } from '../../fee-actions';

export default async function FeeInvoiceRunPage({ params }: { params: Promise<{ no: string }> }) {
  const user = await requireAction('FEES_READ');
  const { no: noParam } = await params;
  const no = decodeURIComponent(noParam);
  const run = await getFeeInvoiceRun(no);
  if (!run) notFound();
  const canRun = await currentCanAction('FEES_INVOICE_RUN');
  const posted = run.status === 'Posted';
  const invoices = posted ? await listRunInvoices(run.id) : [];
  const preview = posted ? null : await previewRun(run.term_id, run.grade_level_id);
  const open = invoices.reduce((s, i) => s + Number(i.remaining_amount), 0);

  return (
    <Page title={`Fee invoice run ${run.no}`} crumb={`${run.term_name} ${run.year_name} · ${run.grade_level_name ?? 'All grades'} · ${run.status}`} user={user}>
      <Toolbar>
        <Link href="/fees/invoice-runs" className="btn ghost sm">← All runs</Link>
        <Spacer />
        {!posted && canRun ? <DeleteRunButton no={run.no} /> : null}
        {!posted && canRun && preview?.toBill ? <PostRunButton no={run.no} students={preview.toBill} /> : null}
      </Toolbar>

      <div className="grid g4">
        <Stat label={posted ? 'Students billed' : 'Students to bill'} value={String(posted ? run.students_billed : preview?.toBill ?? 0)} accent={false} />
        <Stat label={posted ? 'Total invoiced' : 'Total to invoice'} value={<Money cents={posted ? run.total_amount : preview?.total ?? 0} />} />
        <Stat label="Still open" value={<Money cents={posted ? open : 0} />} accent={posted && open > 0} foot={posted ? `${invoices.filter((i) => i.remaining_amount > 0).length} unpaid` : undefined} />
        <Stat label="Due date" value={formatDate(run.due_date)} accent={false} foot={`Posting ${formatDate(run.posting_date)}`} />
      </div>

      <Card>
        <CardHead title="Run" sub={posted ? 'Posted — each student has a Sales Invoice on their fee account' : 'Open — nothing has reached the G/L; post it when the list below is right'}>
          <Pill status={run.status} tone={posted ? 'ok' : 'warn'}>{run.status}</Pill>
        </CardHead>
        <div className="grid g2 dl-groups">
          <section className="dl-group">
            <DefinitionList items={[
              ['Term', `${run.term_name} ${run.year_name}`], ['Grade', run.grade_level_name ?? 'All grades'],
              ['Posting date', formatDate(run.posting_date)], ['Due date', formatDate(run.due_date)],
            ]} />
          </section>
          <section className="dl-group">
            <DefinitionList items={[
              ['Created', `${run.created_by ?? '—'} · ${formatDateTime(run.created_at)}`],
              posted ? ['Posted', `${run.posted_by ?? '—'} · ${formatDateTime(run.posted_at)}`] : null,
            ]} />
          </section>
        </div>
      </Card>

      <Card>
        <CardHead title={posted ? 'Invoices' : 'Students'} sub={posted ? 'One posted invoice per student — open the number for the document' : 'Every Active student in scope and what the fee structure bills them; those already invoiced this term are skipped'} />
        {posted ? (invoices.length ? (
          <TableWrap>
            <thead><tr><th>Invoice</th><th>Adm. No.</th><th>Student</th><th>Class</th><th className="num">Amount</th><th className="num">Open</th></tr></thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id}>
                  <td className="mono"><Link href={`/receivables/posted/${encodeURIComponent(i.posted_invoice_no)}`}>{i.posted_invoice_no}</Link></td>
                  <td className="mono"><Link href={`/students/view/${i.student_id}`}>{i.admission_no}</Link></td>
                  <td>{i.student_name}</td>
                  <td>{i.grade_level_name} {i.stream_name}</td>
                  <td className="num"><Money cents={i.amount} /></td>
                  <td className="num">{i.remaining_amount > 0 ? <Money cents={i.remaining_amount} /> : <Pill tone="ok">Paid</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🧾" title="No invoices on this run" />) : (preview?.lines.length ? (
          <TableWrap>
            <thead><tr><th>Adm. No.</th><th>Student</th><th>Grade</th><th className="num">Amount</th><th /></tr></thead>
            <tbody>
              {preview.lines.map((l) => (
                <tr key={l.student_id} className={l.already_invoiced || !l.amount ? 'muted' : undefined}>
                  <td className="mono"><Link href={`/students/view/${l.student_id}`}>{l.admission_no}</Link></td>
                  <td>{l.student_name}</td>
                  <td>{l.grade_level_name}</td>
                  <td className="num"><Money cents={l.amount} /></td>
                  <td>{l.already_invoiced ? <Pill tone="info">Already invoiced</Pill> : !l.amount ? <Pill tone="warn">No fee structure</Pill> : null}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🎒" title="No students in scope" sub="No Active students are placed in the grade(s) for this term." />)}
      </Card>
    </Page>
  );
}
