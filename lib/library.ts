/*
 * Library — the catalogue (titles and their physical copies, each with an accession number),
 * loans to students and staff, returns, overdue fines, and charging a student's fine to their
 * fee account (a posted Sales Invoice to the library-fines income account, so it is collected
 * with the fees and shows on the statement).
 */
import { one, all, run, tx, audit, hasAnyRow, nextSequence } from './db.ts';
import { AppError } from './errors.ts';
import { createSalesDocument, setSalesLines, postSalesDocument } from './salesDocuments.ts';
import type { Actor, Cents, IsoDate, LibraryBookView, LibraryCopy, LibraryLoan, LibraryLoanView, LibrarySetup } from './types.ts';

const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);

/* --------------------------------------------------------------------- setup */

export const getLibrarySetup = async (): Promise<LibrarySetup> =>
  (await one<LibrarySetup>('SELECT * FROM library_setup WHERE id = 1')) ?? { id: 1, loan_days: 14, fine_per_day: 0, max_loans_student: 2, max_loans_staff: 5, fine_gl_account_id: null };

export async function saveLibrarySetup(input: { loanDays: number; finePerDay: Cents; maxLoansStudent: number; maxLoansStaff: number; fineGlAccountId?: number | null }, user: Actor): Promise<void> {
  if (!(Number(input.loanDays) >= 1)) throw new AppError('Loans run for at least a day', 'VALIDATION');
  if (input.fineGlAccountId) {
    const acc = await one<{ type: string; is_postable: number }>('SELECT type, is_postable FROM gl_account WHERE id = ?', input.fineGlAccountId);
    if (!acc || !acc.is_postable || acc.type !== 'INCOME') throw new AppError('Fines post to an active INCOME posting account', 'VALIDATION');
  }
  await run(
    `INSERT INTO library_setup (id, loan_days, fine_per_day, max_loans_student, max_loans_staff, fine_gl_account_id) VALUES (1,?,?,?,?,?)
     ON CONFLICT (id) DO UPDATE SET loan_days = EXCLUDED.loan_days, fine_per_day = EXCLUDED.fine_per_day, max_loans_student = EXCLUDED.max_loans_student, max_loans_staff = EXCLUDED.max_loans_staff, fine_gl_account_id = EXCLUDED.fine_gl_account_id`,
    Math.round(Number(input.loanDays)), Math.max(0, Math.round(Number(input.finePerDay) || 0)), Math.max(1, Math.round(Number(input.maxLoansStudent) || 1)), Math.max(1, Math.round(Number(input.maxLoansStaff) || 1)), input.fineGlAccountId || null,
  );
  await audit(user, 'LIBRARY_SETUP_SAVE', 'library_setup', 1, {});
}

/* ----------------------------------------------------------------- catalogue */

const BOOK_SELECT = `
  SELECT b.*, (SELECT COUNT(*)::int FROM library_copy c WHERE c.book_id = b.id AND c.status NOT IN ('WITHDRAWN')) AS copies,
         (SELECT COUNT(*)::int FROM library_copy c WHERE c.book_id = b.id AND c.status = 'AVAILABLE') AS available,
         (SELECT COUNT(*)::int FROM library_copy c WHERE c.book_id = b.id AND c.status = 'ON_LOAN') AS on_loan
  FROM library_book b`;

export const listBooks = (search = '', category?: string | null): Promise<LibraryBookView[]> =>
  all<LibraryBookView>(
    `${BOOK_SELECT} WHERE (b.title ILIKE @like OR COALESCE(b.author, '') ILIKE @like OR COALESCE(b.isbn, '') ILIKE @like OR EXISTS (SELECT 1 FROM library_copy c WHERE c.book_id = b.id AND c.accession_no ILIKE @like))
     ${category ? 'AND b.category = @category' : ''} ORDER BY b.status, b.title LIMIT 500`, { like: `%${search.trim()}%`, category: category ?? null },
  );
export const getBook = (id: number): Promise<LibraryBookView | undefined> => one<LibraryBookView>(`${BOOK_SELECT} WHERE b.id = ?`, id);
export const listCategories = (): Promise<{ category: string; n: number }[]> => all("SELECT category, COUNT(*)::int AS n FROM library_book WHERE category IS NOT NULL GROUP BY category ORDER BY category");
export const listCopies = (bookId: number): Promise<(LibraryCopy & { borrower: string | null; due_on: IsoDate | null })[]> =>
  all(`SELECT c.*, COALESCE(s.first_name || ' ' || s.last_name, e.first_name || ' ' || e.last_name) AS borrower, l.due_on
       FROM library_copy c LEFT JOIN library_loan l ON l.copy_id = c.id AND l.status = 'ON_LOAN' LEFT JOIN student s ON s.id = l.student_id LEFT JOIN employee e ON e.id = l.employee_id
       WHERE c.book_id = ? ORDER BY c.accession_no`, bookId);

export interface BookInput { isbn?: string | null; title: string; author?: string | null; publisher?: string | null; year?: number | null; category?: string | null; location?: string | null; status?: string | null }

export async function saveBook(id: number | null, input: BookInput, user: Actor): Promise<{ id: number }> {
  const title = String(input.title || '').trim();
  if (!title) throw new AppError('A title is required', 'VALIDATION');
  const row = [input.isbn?.trim() || null, title, input.author?.trim() || null, input.publisher?.trim() || null, input.year ? Math.round(Number(input.year)) : null, input.category?.trim() || null, input.location?.trim() || null, input.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE'];
  if (id) {
    await run('UPDATE library_book SET isbn=?, title=?, author=?, publisher=?, year=?, category=?, location=?, status=? WHERE id=?', ...row, id);
    await audit(user, 'BOOK_UPDATE', 'library_book', id, { title });
    return { id };
  }
  const info = await run('INSERT INTO library_book (isbn, title, author, publisher, year, category, location, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)', ...row, now());
  await audit(user, 'BOOK_CREATE', 'library_book', info.lastInsertRowid, { title });
  return { id: Number(info.lastInsertRowid) };
}

/** Adds N copies, each with the next accession number from the LIBRARY_BOOK series (or the given prefix). */
export async function addCopies(bookId: number, count: number, user: Actor, condition?: string | null): Promise<{ added: string[] }> {
  if (!(await hasAnyRow('library_book', 'id = ?', bookId))) throw new AppError('Book not found', 'NOT_FOUND');
  const n = Math.max(1, Math.min(200, Math.round(Number(count) || 1)));
  const added: string[] = [];
  await tx(async () => {
    for (let i = 0; i < n; i++) {
      const acc = await nextSequence('LIBRARY_BOOK');
      await run('INSERT INTO library_copy (book_id, accession_no, status, condition, added_at) VALUES (?,?,?,?,?)', bookId, acc, 'AVAILABLE', condition?.trim() || null, now());
      added.push(acc);
    }
  });
  await audit(user, 'BOOK_COPIES_ADD', 'library_book', bookId, { added: added.length });
  return { added };
}

export async function setCopyStatus(copyId: number, status: 'AVAILABLE' | 'LOST' | 'DAMAGED' | 'WITHDRAWN', user: Actor): Promise<void> {
  const c = await one<LibraryCopy>('SELECT * FROM library_copy WHERE id = ?', copyId);
  if (!c) throw new AppError('Copy not found', 'NOT_FOUND');
  if (c.status === 'ON_LOAN') throw new AppError('The copy is on loan — return it (or mark the loan lost) first', 'VALIDATION');
  await run('UPDATE library_copy SET status = ? WHERE id = ?', status, copyId);
  await audit(user, 'BOOK_COPY_STATUS', 'library_copy', copyId, { status });
}

/* --------------------------------------------------------------------- loans */

const LOAN_SELECT = `
  SELECT l.*, c.accession_no, b.title, b.author,
         COALESCE(s.first_name || ' ' || s.last_name, e.first_name || ' ' || e.last_name) AS borrower_name,
         COALESCE(s.admission_no, e.employee_no) AS borrower_no,
         CASE WHEN s.id IS NULL THEN 'STAFF' ELSE 'STUDENT' END AS borrower_kind,
         GREATEST(0, (COALESCE(l.returned_on, CURRENT_DATE::text)::date - l.due_on::date))::int AS days_overdue
  FROM library_loan l JOIN library_copy c ON c.id = l.copy_id JOIN library_book b ON b.id = c.book_id
  LEFT JOIN student s ON s.id = l.student_id LEFT JOIN employee e ON e.id = l.employee_id`;

export const listLoans = (opts: { status?: 'ON_LOAN' | 'RETURNED' | 'LOST' | 'OVERDUE' | null; search?: string; limit?: number } = {}): Promise<LibraryLoanView[]> =>
  all<LibraryLoanView>(
    `${LOAN_SELECT}
     WHERE (COALESCE(s.first_name || ' ' || s.last_name, e.first_name || ' ' || e.last_name) ILIKE @like OR b.title ILIKE @like OR c.accession_no ILIKE @like OR COALESCE(s.admission_no, e.employee_no) ILIKE @like)
       ${opts.status === 'OVERDUE' ? "AND l.status = 'ON_LOAN' AND l.due_on < CURRENT_DATE::text" : opts.status ? 'AND l.status = @status' : ''}
     ORDER BY l.status = 'ON_LOAN' DESC, l.due_on, l.id DESC LIMIT ${Math.max(1, Math.min(opts.limit ?? 300, 2000))}`,
    { like: `%${(opts.search ?? '').trim()}%`, status: opts.status ?? null },
  );
export const studentLoans = (studentId: number): Promise<LibraryLoanView[]> => all<LibraryLoanView>(`${LOAN_SELECT} WHERE l.student_id = ? ORDER BY l.status = 'ON_LOAN' DESC, l.issued_on DESC LIMIT 100`, studentId);
export const bookLoans = (bookId: number): Promise<LibraryLoanView[]> => all<LibraryLoanView>(`${LOAN_SELECT} WHERE b.id = ? ORDER BY l.status = 'ON_LOAN' DESC, l.issued_on DESC LIMIT 100`, bookId);
export const employeeLoans = (employeeId: number): Promise<LibraryLoanView[]> => all<LibraryLoanView>(`${LOAN_SELECT} WHERE l.employee_id = ? ORDER BY l.status = 'ON_LOAN' DESC, l.issued_on DESC LIMIT 100`, employeeId);

export interface IssueInput { accessionNo: string; studentId?: number | null; employeeId?: number | null; issuedOn?: IsoDate | null; dueOn?: IsoDate | null }

/** Issues a copy to a student or a member of staff, within the borrowing limit and the loan period. */
export async function issueLoan(input: IssueInput, user: Actor): Promise<{ id: number; dueOn: IsoDate }> {
  const setup = await getLibrarySetup();
  const copy = await one<LibraryCopy & { title: string }>('SELECT c.*, b.title FROM library_copy c JOIN library_book b ON b.id = c.book_id WHERE c.accession_no = ?', String(input.accessionNo || '').trim().toUpperCase());
  if (!copy) throw new AppError('No copy with that accession number', 'NOT_FOUND');
  if (copy.status !== 'AVAILABLE') throw new AppError(`${copy.accession_no} (${copy.title}) is ${copy.status.toLowerCase().replace('_', ' ')}`, 'VALIDATION');
  if ((input.studentId ? 1 : 0) + (input.employeeId ? 1 : 0) !== 1) throw new AppError('Pick the borrower — a student or a member of staff', 'VALIDATION');
  if (input.studentId) {
    const s = await one<{ status: string }>('SELECT status FROM student WHERE id = ?', input.studentId);
    if (!s || s.status !== 'ACTIVE') throw new AppError('Only an active student can borrow', 'VALIDATION');
    const open = (await one<{ c: number }>("SELECT COUNT(*)::int c FROM library_loan WHERE student_id = ? AND status = 'ON_LOAN'", input.studentId))!.c;
    if (open >= setup.max_loans_student) throw new AppError(`The student already has ${open} book${open === 1 ? '' : 's'} out (limit ${setup.max_loans_student})`, 'VALIDATION');
    if (await hasAnyRow('library_loan', "student_id = ? AND status = 'ON_LOAN' AND due_on < ?", input.studentId, today())) throw new AppError('The student has an overdue book — return it first', 'VALIDATION');
  } else {
    if (!(await hasAnyRow('employee', "id = ? AND status IN ('ACTIVE', 'ON_LEAVE')", input.employeeId))) throw new AppError('Only an active employee can borrow', 'VALIDATION');
    const open = (await one<{ c: number }>("SELECT COUNT(*)::int c FROM library_loan WHERE employee_id = ? AND status = 'ON_LOAN'", input.employeeId))!.c;
    if (open >= setup.max_loans_staff) throw new AppError(`${open} book${open === 1 ? '' : 's'} already out (limit ${setup.max_loans_staff})`, 'VALIDATION');
  }
  const issuedOn = input.issuedOn && /^\d{4}-\d{2}-\d{2}$/.test(input.issuedOn) ? input.issuedOn : today();
  const due = new Date(`${issuedOn}T00:00:00Z`); due.setUTCDate(due.getUTCDate() + setup.loan_days);
  const dueOn = input.dueOn && /^\d{4}-\d{2}-\d{2}$/.test(input.dueOn) ? input.dueOn : due.toISOString().slice(0, 10);
  if (dueOn < issuedOn) throw new AppError('The due date cannot be before the issue date', 'VALIDATION');
  return tx(async () => {
    const info = await run('INSERT INTO library_loan (copy_id, student_id, employee_id, issued_on, due_on, status, issued_by) VALUES (?,?,?,?,?,?,?)', copy.id, input.studentId || null, input.employeeId || null, issuedOn, dueOn, 'ON_LOAN', user.username);
    await run("UPDATE library_copy SET status = 'ON_LOAN' WHERE id = ?", copy.id);
    await audit(user, 'LIBRARY_ISSUE', 'library_loan', info.lastInsertRowid, { copy: copy.accession_no, student: input.studentId ?? null, employee: input.employeeId ?? null });
    return { id: Number(info.lastInsertRowid), dueOn };
  });
}

/** Returns a copy; a late return carries a fine at the setup rate (recorded, charged separately). */
export async function returnLoan(loanId: number, input: { returnedOn?: IsoDate | null; lost?: boolean; remarks?: string | null }, user: Actor): Promise<{ fine: Cents; daysLate: number }> {
  const setup = await getLibrarySetup();
  const l = await one<LibraryLoan>('SELECT * FROM library_loan WHERE id = ?', loanId);
  if (!l) throw new AppError('Loan not found', 'NOT_FOUND');
  if (l.status !== 'ON_LOAN') throw new AppError('This loan is already closed', 'VALIDATION');
  const returnedOn = input.returnedOn && /^\d{4}-\d{2}-\d{2}$/.test(input.returnedOn) ? input.returnedOn : today();
  if (returnedOn < l.issued_on) throw new AppError('The return date cannot be before the issue date', 'VALIDATION');
  const daysLate = Math.max(0, Math.round((Date.parse(returnedOn) - Date.parse(l.due_on)) / 86_400_000));
  const fine = daysLate * Number(setup.fine_per_day);
  await tx(async () => {
    await run('UPDATE library_loan SET returned_on=?, status=?, fine_amount=?, returned_by=?, remarks=COALESCE(?, remarks) WHERE id=?', returnedOn, input.lost ? 'LOST' : 'RETURNED', fine, user.username, input.remarks?.trim() || null, l.id);
    await run('UPDATE library_copy SET status = ? WHERE id = ?', input.lost ? 'LOST' : 'AVAILABLE', l.copy_id);
  });
  await audit(user, input.lost ? 'LIBRARY_LOST' : 'LIBRARY_RETURN', 'library_loan', l.id, { daysLate, fine });
  return { fine, daysLate };
}

/** Charges a student's fine to their fee account: a posted Sales Invoice with one line to the fines income account. */
export async function chargeFineToFeeAccount(loanId: number, user: Actor): Promise<{ invoiceNo: string }> {
  const setup = await getLibrarySetup();
  if (!setup.fine_gl_account_id) throw new AppError('Set the library fines income account under Library → Setup first', 'VALIDATION');
  const l = await one<LibraryLoan & { accession_no: string; title: string; customer_id: number | null; admission_no: string }>(
    'SELECT l.*, c.accession_no, b.title, s.customer_id, s.admission_no FROM library_loan l JOIN library_copy c ON c.id = l.copy_id JOIN library_book b ON b.id = c.book_id JOIN student s ON s.id = l.student_id WHERE l.id = ?', loanId,
  );
  if (!l) throw new AppError('Not a student loan', 'NOT_FOUND');
  if (!(Number(l.fine_amount) > 0)) throw new AppError('There is no fine on this loan', 'VALIDATION');
  if (l.fine_invoice_no) throw new AppError(`Already charged on ${l.fine_invoice_no}`, 'VALIDATION');
  if (!l.customer_id) throw new AppError('The student has no fee account', 'VALIDATION');
  const acc = (await one<{ code: string }>('SELECT code FROM gl_account WHERE id = ?', setup.fine_gl_account_id))!;
  return tx(async () => {
    const { no } = await createSalesDocument({ documentType: 'Invoice', customerId: l.customer_id!, postingDate: today(), documentDate: today(), yourReference: `Library fine — ${l.accession_no}` }, user);
    await setSalesLines(no, [{ type: 'G/L Account', no: acc.code, description: `Library fine — ${l.title} (${l.accession_no}), ${l.returned_on ? 'returned' : 'lost'} ${l.returned_on ?? ''}`.trim(), quantity: 1, unitPrice: Number(l.fine_amount) }], user);
    await run(`UPDATE sales_header SET status = 'Released', payment_terms_code = NULL, due_date = ? WHERE no = ?`, today(), no);
    const posted = await postSalesDocument(no, {}, user);
    if (!posted.invoiceNo) throw new AppError('The fine did not post', 'VALIDATION');
    await run('UPDATE library_loan SET fine_invoice_no = ? WHERE id = ?', posted.invoiceNo, l.id);
    await audit(user, 'LIBRARY_FINE_CHARGE', 'library_loan', l.id, { invoice: posted.invoiceNo, amount: l.fine_amount });
    return { invoiceNo: posted.invoiceNo };
  });
}

export const libraryStats = async (): Promise<{ titles: number; copies: number; on_loan: number; overdue: number; fines_unpaid: Cents }> =>
  (await one(`SELECT (SELECT COUNT(*)::int FROM library_book WHERE status = 'ACTIVE') AS titles, (SELECT COUNT(*)::int FROM library_copy WHERE status <> 'WITHDRAWN') AS copies,
                     (SELECT COUNT(*)::int FROM library_loan WHERE status = 'ON_LOAN') AS on_loan, (SELECT COUNT(*)::int FROM library_loan WHERE status = 'ON_LOAN' AND due_on < CURRENT_DATE::text) AS overdue,
                     (SELECT COALESCE(SUM(fine_amount), 0) FROM library_loan WHERE fine_amount > 0 AND fine_invoice_no IS NULL AND student_id IS NOT NULL) AS fines_unpaid`))!;
