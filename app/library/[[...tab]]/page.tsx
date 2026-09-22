import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import { listBooks, listCategories, listLoans, getLibrarySetup, libraryStats } from '@/lib/library';
import { listActiveStudentsPick } from '@/lib/students';
import { listActiveEmployees } from '@/lib/employees';
import { listPostableAccounts } from '@/lib/gl';
import { formatDate } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { Card, CardHead, DefinitionList, EmptyState, Pill, Stat, TableWrap, Tabs, Toolbar, Spacer, type TabDefinition } from '@/components/ui/primitives';
import { Money } from '@/components/ui/money';
import { SearchInput, SelectFilter } from '@/components/ui/filters';
import { EditableCard } from '@/components/ui/editable-card';
import { NewBookButton, IssueLoanPanel, ReturnLoanButton, ChargeFineButton, LibrarySetupForm } from '../library-forms';

const TABS: TabDefinition[] = [{ key: 'catalogue', label: 'Catalogue' }, { key: 'loans', label: 'Loans' }, { key: 'setup', label: 'Setup' }];

export default async function LibraryPage({ params, searchParams }: { params: Promise<{ tab?: string[] }>; searchParams: Promise<{ q?: string; category?: string; status?: string }> }) {
  const user = await requireAction('LIBRARY_READ');
  const { tab: segments } = await params;
  const sp = await searchParams;
  const tab = segments?.[0] ?? 'catalogue';
  if (!TABS.some((t) => t.key === tab)) notFound();
  const hrefFor = (k: string) => `/library/${k === 'catalogue' ? '' : k}`;
  const [canManage, canSetup, stats, categories] = await Promise.all([currentCanAction('LIBRARY_MANAGE'), currentCanAction('LIBRARY_SETUP_MANAGE'), libraryStats(), listCategories()]);
  const q = sp.q ?? '';

  return (
    <Page title="Library" crumb="The catalogue, every copy by accession number, and the loan desk" user={user}>
      <Tabs tabs={TABS} active={tab} hrefFor={hrefFor} />
      <div className="grid g4">
        <Stat label="Titles" value={String(stats.titles)} accent={false} foot={`${stats.copies} copies`} />
        <Stat label="On loan" value={String(stats.on_loan)} accent={false} />
        <Stat label="Overdue" value={String(stats.overdue)} accent={stats.overdue > 0} />
        <Stat label="Fines not yet charged" value={<Money cents={stats.fines_unpaid} />} accent={Number(stats.fines_unpaid) > 0} foot="Student fines waiting to go to the fee account" />
      </div>

      {tab === 'catalogue' ? (
        <>
          <Toolbar>
            <SearchInput placeholder="Search title, author, ISBN or accession no.…" />
            <SelectFilter paramName="category" allLabel="All categories" options={categories.map((c) => ({ value: c.category, label: `${c.category} (${c.n})` }))} />
            <Spacer />
            {canManage ? <NewBookButton categories={categories.map((c) => c.category)} /> : null}
          </Toolbar>
          <Card>
            {await (async () => {
              const books = await listBooks(q, sp.category || null);
              return books.length ? (
                <TableWrap>
                  <thead><tr><th>Title</th><th>Author</th><th>Category</th><th>Shelf</th><th className="num">Copies</th><th className="num">Available</th><th className="num">On loan</th><th>Status</th></tr></thead>
                  <tbody>
                    {books.map((b) => (
                      <tr key={b.id} className={b.status === 'ACTIVE' ? undefined : 'muted'}>
                        <td><Link href={`/library/books/${b.id}`}><b>{b.title}</b></Link>{b.isbn ? <div className="tiny mono">{b.isbn}</div> : null}</td>
                        <td>{b.author ?? '—'}</td><td>{b.category ?? '—'}</td><td>{b.location ?? '—'}</td>
                        <td className="num">{b.copies}</td>
                        <td className="num">{b.available}{b.copies && !b.available ? <Pill tone="warn">none</Pill> : null}</td>
                        <td className="num">{b.on_loan}</td>
                        <td><Pill status={b.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              ) : <EmptyState icon="📚" title={q || sp.category ? 'Nothing matches' : 'The catalogue is empty'} sub="Add a title and its copies; each copy gets an accession number from the No. Series." />;
            })()}
          </Card>
        </>
      ) : null}

      {tab === 'loans' ? (
        <>
          <Toolbar>
            <SearchInput placeholder="Search borrower, title or accession no.…" />
            <SelectFilter paramName="status" allLabel="Out now" options={[{ value: 'OVERDUE', label: 'Overdue' }, { value: 'RETURNED', label: 'Returned' }, { value: 'LOST', label: 'Lost' }, { value: 'ALL', label: 'Everything' }]} />
            <Spacer />
          </Toolbar>
          {canManage ? <Card><CardHead title="Issue desk" sub="Scan the copy, pick the borrower — the loan period and limits come from Setup" /><IssueLoanPanel students={await listActiveStudentsPick()} staff={await listActiveEmployees()} /></Card> : null}
          <Card>
            {await (async () => {
              const status = (sp.status ?? 'ON_LOAN') as 'ON_LOAN' | 'OVERDUE' | 'RETURNED' | 'LOST' | 'ALL';
              const loans = await listLoans({ status: status === 'ALL' ? null : status, search: q });
              return loans.length ? (
                <TableWrap>
                  <thead><tr><th>Accession</th><th>Title</th><th>Borrower</th><th>Issued</th><th>Due</th><th>Returned</th><th className="num">Fine</th><th>Status</th><th /></tr></thead>
                  <tbody>
                    {loans.map((l) => (
                      <tr key={l.id} className={l.status === 'ON_LOAN' && l.days_overdue > 0 ? undefined : l.status !== 'ON_LOAN' ? 'muted' : undefined}>
                        <td className="mono">{l.accession_no}</td>
                        <td><b>{l.title}</b>{l.author ? <div className="tiny">{l.author}</div> : null}</td>
                        <td>{l.borrower_kind === 'STUDENT' ? <Link href={`/students/view/${l.student_id}`}>{l.borrower_name}</Link> : <Link href={`/employees/view/${l.employee_id}`}>{l.borrower_name}</Link>}<div className="tiny mono">{l.borrower_no} · {l.borrower_kind === 'STUDENT' ? 'student' : 'staff'}</div></td>
                        <td>{formatDate(l.issued_on)}</td>
                        <td style={l.status === 'ON_LOAN' && l.days_overdue > 0 ? { color: 'var(--danger)' } : undefined}>{formatDate(l.due_on)}{l.status === 'ON_LOAN' && l.days_overdue > 0 ? <div className="tiny">{l.days_overdue} day{l.days_overdue === 1 ? '' : 's'} overdue</div> : null}</td>
                        <td>{l.returned_on ? formatDate(l.returned_on) : '—'}</td>
                        <td className="num">{Number(l.fine_amount) ? <><Money cents={l.fine_amount} />{l.fine_invoice_no ? <div className="tiny mono">{l.fine_invoice_no}</div> : null}</> : '—'}</td>
                        <td><Pill status={l.status} tone={l.status === 'ON_LOAN' ? (l.days_overdue > 0 ? 'bad' : 'info') : l.status === 'RETURNED' ? 'ok' : 'warn'} /></td>
                        <td>{canManage ? <span className="inline" style={{ gap: 4 }}><ReturnLoanButton loan={l} />{canSetup ? <ChargeFineButton loan={l} /> : null}</span> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              ) : <EmptyState icon="🔖" title="No loans here" />;
            })()}
          </Card>
        </>
      ) : null}

      {tab === 'setup' ? (
        await (async () => {
          const [setup, accounts] = await Promise.all([getLibrarySetup(), listPostableAccounts()]);
          const acc = accounts.find((a) => a.id === setup.fine_gl_account_id);
          return (
            <EditableCard title="Borrowing rules" sub="The loan period, what a late day costs, and how many books each kind of borrower may hold" canEdit={canSetup} form={<LibrarySetupForm setup={setup} accounts={accounts} />}>
              <div className="grid g2 dl-groups">
                <section className="dl-group">
                  <DefinitionList items={[['Loan period', `${setup.loan_days} days`], ['Fine per day late', <Money cents={setup.fine_per_day} key="f" />], ['Fines income account', acc ? `${acc.code} — ${acc.name}` : <span className="muted-cell" key="a">Not set — fines cannot be charged to fee accounts</span>]]} />
                </section>
                <section className="dl-group">
                  <DefinitionList items={[['Books a student may hold', String(setup.max_loans_student)], ['Books a staff member may hold', String(setup.max_loans_staff)], ['Accession numbers', <Link href="/admin/pool/general/no-series" key="n">No. Series → Library Accession No.</Link>]]} />
                </section>
              </div>
            </EditableCard>
          );
        })()
      ) : null}
    </Page>
  );
}
