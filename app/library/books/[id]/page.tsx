import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import { getBook, listCopies, listCategories, bookLoans } from '@/lib/library';
import { listActiveStudentsPick } from '@/lib/students';
import { listActiveEmployees } from '@/lib/employees';
import { formatDate, formatDateTime } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { Card, CardHead, DefinitionList, EmptyState, Pill, Stat, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { Money } from '@/components/ui/money';
import { EditableCard } from '@/components/ui/editable-card';
import { BookEditForm, AddCopiesPanel, CopyStatusButtons, IssueLoanPanel, ReturnLoanButton } from '../../library-forms';

export default async function BookPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAction('LIBRARY_READ');
  const { id: idParam } = await params;
  const id = Number(idParam);
  const book = await getBook(id);
  if (!book) notFound();
  const [copies, categories, canManage, loans] = await Promise.all([listCopies(id), listCategories(), currentCanAction('LIBRARY_MANAGE'), bookLoans(id)]);
  const free = copies.find((c) => c.status === 'AVAILABLE');
  const [students, staff] = canManage && free ? await Promise.all([listActiveStudentsPick(), listActiveEmployees()]) : [[], []];

  return (
    <Page title={book.title} crumb={[book.author, book.publisher, book.year ? String(book.year) : null].filter(Boolean).join(' · ') || 'Library title'} user={user}>
      <Toolbar><Link href="/library" className="btn ghost sm">← Catalogue</Link><Spacer /></Toolbar>
      <div className="grid g4">
        <Stat label="Copies" value={String(book.copies)} accent={false} />
        <Stat label="On the shelf" value={String(book.available)} accent={book.copies > 0 && book.available === 0} foot={book.copies && !book.available ? 'Every copy is out' : undefined} />
        <Stat label="On loan" value={String(book.on_loan)} accent={false} />
        <Stat label="Category" value={book.category ?? '—'} accent={false} small foot={book.location ? `Shelf ${book.location}` : undefined} />
      </div>
      <EditableCard title="Title" sub="The catalogue record — copies are listed below by accession number" canEdit={canManage} form={<BookEditForm book={book} categories={categories.map((c) => c.category)} />}>
        <div className="grid g2 dl-groups">
          <section className="dl-group">
            <DefinitionList items={[['Title', book.title], ['Author', book.author ?? '—'], ['ISBN', book.isbn ? <span className="mono" key="i">{book.isbn}</span> : '—'], ['Publisher', book.publisher ?? '—']]} />
          </section>
          <section className="dl-group">
            <DefinitionList items={[['Year', book.year ? String(book.year) : '—'], ['Category', book.category ?? '—'], ['Shelf / location', book.location ?? '—'], ['Status', <Pill key="s" status={book.status} />], ['Catalogued', formatDateTime(book.created_at)]]} />
          </section>
        </div>
      </EditableCard>

      {canManage && free ? <Card><CardHead title="Issue desk" sub={`${free.accession_no} is the next copy on the shelf`} /><IssueLoanPanel students={students} staff={staff} accessionNo={free.accession_no} /></Card> : null}

      <Card>
        <CardHead title="Copies" sub="Each physical copy with its accession number and where it is" />
        {copies.length ? (
          <TableWrap>
            <thead><tr><th>Accession no.</th><th>Condition</th><th>Status</th><th>With</th><th>Due</th><th>Added</th><th /></tr></thead>
            <tbody>
              {copies.map((c) => (
                <tr key={c.id} className={c.status === 'WITHDRAWN' || c.status === 'LOST' ? 'muted' : undefined}>
                  <td className="mono"><b>{c.accession_no}</b></td>
                  <td>{c.condition ?? '—'}</td>
                  <td><Pill status={c.status} tone={c.status === 'AVAILABLE' ? 'ok' : c.status === 'ON_LOAN' ? 'info' : c.status === 'WITHDRAWN' ? '' : 'bad'} /></td>
                  <td>{c.borrower ?? '—'}</td>
                  <td>{c.due_on ? formatDate(c.due_on) : '—'}</td>
                  <td>{formatDate(c.added_at?.slice(0, 10) ?? null)}</td>
                  <td>{canManage ? <CopyStatusButtons copyId={c.id} status={c.status} /> : null}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="📖" title="No copies yet" sub="Add the copies on the shelf; each gets an accession number." />}
        {canManage ? <div style={{ marginTop: 8 }}><AddCopiesPanel bookId={id} /></div> : null}
      </Card>

      <Card>
        <CardHead title="Loan history" sub="Who has borrowed this title" />
        {loans.length ? (
          <TableWrap>
            <thead><tr><th>Accession</th><th>Borrower</th><th>Issued</th><th>Due</th><th>Returned</th><th className="num">Fine</th><th>Status</th><th /></tr></thead>
            <tbody>
              {loans.map((l) => (
                <tr key={l.id}>
                  <td className="mono">{l.accession_no}</td>
                  <td>{l.borrower_kind === 'STUDENT' ? <Link href={`/students/view/${l.student_id}`}>{l.borrower_name}</Link> : l.borrower_name} <span className="tiny mono">{l.borrower_no}</span></td>
                  <td>{formatDate(l.issued_on)}</td><td>{formatDate(l.due_on)}</td><td>{l.returned_on ? formatDate(l.returned_on) : '—'}</td>
                  <td className="num">{Number(l.fine_amount) ? <Money cents={l.fine_amount} /> : '—'}</td>
                  <td><Pill status={l.status} tone={l.status === 'ON_LOAN' ? (l.days_overdue > 0 ? 'bad' : 'info') : l.status === 'RETURNED' ? 'ok' : 'warn'} /></td>
                  <td>{canManage ? <ReturnLoanButton loan={l} /> : null}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <div className="tiny muted-cell">Never borrowed.</div>}
      </Card>
    </Page>
  );
}
