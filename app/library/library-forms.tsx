'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field, MoneyInput } from '@/components/ui/field';
import { StudentSelect, type StudentSelectOption } from '@/components/ui/student-select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { GlAccountSelect, type GlAccountSelectOption } from '@/components/ui/gl-account-select';
import { useEditableCard } from '@/components/ui/editable-card';
import { useRunAction } from '@/components/ui/run-action';
import { saveLibrarySetupRequest, saveBookRequest, addCopiesRequest, setCopyStatusRequest, issueLoanRequest, returnLoanRequest, chargeFineRequest } from '@/app/actions/services';
import { today } from '@/lib/format';
import type { LibrarySetup, LibraryBookView, LibraryLoanView } from '@/lib/types';

type Emp = { id: number; employee_no: string; first_name: string; last_name: string };

/* -------------------------------------------------------------------- setup */

export function LibrarySetupForm({ setup, accounts }: { setup: LibrarySetup; accounts: GlAccountSelectOption[] }) {
  const { close } = useEditableCard();
  const [fine, setFine] = useState(String(Number(setup.fine_per_day) / 100 || ''));
  const [acc, setAcc] = useState(String(setup.fine_gl_account_id ?? ''));
  return (
    <FormModal inline title="" onClose={close} onSubmit={saveLibrarySetupRequest} submitLabel="Save rules" successTitle="Library rules saved">
      <div className="grid g4">
        <Field name="loan_days" label="Loan period (days)" type="number" min={1} required defaultValue={setup.loan_days} />
        <div className="field"><label htmlFor="f_fine_per_day">Fine per day late</label><MoneyInput id="f_fine_per_day" name="fine_per_day" value={fine} onChange={setFine} placeholder="0.00" /></div>
        <Field name="max_loans_student" label="Books a student may hold" type="number" min={0} required defaultValue={setup.max_loans_student} />
        <Field name="max_loans_staff" label="Books a staff member may hold" type="number" min={0} required defaultValue={setup.max_loans_staff} />
      </div>
      <GlAccountSelect id="f_fine_gl" name="fine_gl_account_id" label="Fines income account" accounts={accounts} value={acc} onChange={setAcc} hint="A student's fine is charged to their fee account as a posted invoice against this account" />
    </FormModal>
  );
}

/* -------------------------------------------------------------------- books */

function BookFields({ b, categories }: { b?: LibraryBookView | null; categories: string[] }) {
  return (
    <>
      <div className="grid g3">
        <Field name="title" label="Title" required defaultValue={b?.title} />
        <Field name="author" label="Author" defaultValue={b?.author} />
        <Field name="isbn" label="ISBN" defaultValue={b?.isbn} uppercase />
      </div>
      <div className="grid g4">
        <Field name="category" label="Category" defaultValue={b?.category} placeholder="e.g. Mathematics, Fiction, Reference" hint={categories.length ? `In use: ${categories.slice(0, 6).join(', ')}` : undefined} />
        <Field name="publisher" label="Publisher" defaultValue={b?.publisher} />
        <Field name="year" label="Year" type="number" min={1800} max={2100} defaultValue={b?.year} />
        <Field name="location" label="Shelf / location" defaultValue={b?.location} placeholder="e.g. Shelf B3" />
      </div>
      {b ? <Field name="status" label="Status" type="select" defaultValue={b.status} options={['ACTIVE', 'INACTIVE']} /> : null}
    </>
  );
}

export function NewBookButton({ categories, className = 'btn' }: { categories: string[]; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>New title</button>
      {open ? (
        <FormModal title="New title" wide onClose={() => setOpen(false)} onSubmit={(v) => saveBookRequest(v)} successTitle="Title catalogued" successDetail="Now add its copies" redirectTo={(d) => `/library/books/${d.id}`}>
          <BookFields categories={categories} />
          <Field name="copies" label="Copies to add now" type="number" min={0} defaultValue={1} hint="Each copy gets its own accession number" />
        </FormModal>
      ) : null}
    </>
  );
}

export function BookEditForm({ book, categories }: { book: LibraryBookView; categories: string[] }) {
  const { close } = useEditableCard();
  return (
    <FormModal inline title="" onClose={close} onSubmit={(v) => saveBookRequest({ ...v, id: book.id })} submitLabel="Save changes" successTitle="Title updated">
      <BookFields b={book} categories={categories} />
    </FormModal>
  );
}

export function AddCopiesPanel({ bookId }: { bookId: number }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" className="btn sm" onClick={() => setOpen(true)}>Add copies</button>;
  return (
    <div style={{ width: '100%' }}>
      <FormModal inline title="" onClose={() => setOpen(false)} onSubmit={(v) => addCopiesRequest(bookId, Number(v.count), String(v.condition ?? '') || null)} submitLabel="Add" resultStyle="popup" successTitle="Copies added" successDetail={(d) => d.added.join(', ')}>
        <div className="grid g3">
          <Field name="count" label="How many" type="number" min={1} required defaultValue={1} />
          <Field name="condition" label="Condition" type="select" defaultValue="NEW" options={['NEW', 'GOOD', 'FAIR', 'WORN']} />
        </div>
      </FormModal>
    </div>
  );
}

export function CopyStatusButtons({ copyId, status }: { copyId: number; status: string }) {
  const { run, busy } = useRunAction();
  if (status === 'ON_LOAN') return null;
  const set = (s: 'AVAILABLE' | 'LOST' | 'DAMAGED' | 'WITHDRAWN') => run(() => setCopyStatusRequest(copyId, s), { successTitle: `Copy marked ${s.toLowerCase()}` });
  return (
    <span className="inline" style={{ gap: 4 }}>
      {status !== 'AVAILABLE' ? <button type="button" className="btn sm ghost" disabled={busy} onClick={() => set('AVAILABLE')}>Back on shelf</button> : null}
      {status === 'AVAILABLE' ? <button type="button" className="btn sm ghost" disabled={busy} onClick={() => set('DAMAGED')}>Damaged</button> : null}
      {status !== 'WITHDRAWN' ? <button type="button" className="btn sm ghost" disabled={busy} onClick={() => set('WITHDRAWN')}>Withdraw</button> : null}
    </span>
  );
}

/* -------------------------------------------------------------------- loans */

/** The issue desk: scan/type the accession number, pick who takes it. */
export function IssueLoanPanel({ students, staff, accessionNo, studentId: fixedStudent, className = 'btn' }: { students: StudentSelectOption[]; staff: Emp[]; accessionNo?: string | null; studentId?: number | null; className?: string }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'STUDENT' | 'STAFF'>('STUDENT');
  const [studentId, setStudentId] = useState(String(fixedStudent ?? ''));
  const [employeeId, setEmployeeId] = useState('');
  if (!open) return <button type="button" className={className} onClick={() => setOpen(true)}>Issue a book</button>;
  return (
    <div style={{ width: '100%' }}>
      <FormModal inline title="" onClose={() => setOpen(false)} onSubmit={issueLoanRequest} submitLabel="Issue" resultStyle="popup" successTitle="Book issued" successDetail={(d) => `Due back ${d.dueOn}`}>
        <div className="grid g3">
          <Field name="accession_no" label="Accession no." required uppercase defaultValue={accessionNo ?? ''} placeholder="Scan or type, e.g. ACC-00012" />
          {fixedStudent ? <input type="hidden" name="borrower_kind" value="STUDENT" /> : <Field name="borrower_kind" label="Borrower" type="select" defaultValue={kind} options={[{ value: 'STUDENT', label: 'Student' }, { value: 'STAFF', label: 'Staff' }]} onChange={(e) => setKind(e.target.value as 'STUDENT' | 'STAFF')} />}
          <Field name="issued_on" label="Issued" type="date" required defaultValue={today()} />
        </div>
        {fixedStudent ? <input type="hidden" name="student_id" value={fixedStudent} /> : kind === 'STUDENT'
          ? <StudentSelect id="f_loan_student" name="student_id" label="Student" students={students} value={studentId} onChange={setStudentId} required />
          : <SearchableSelect id="f_loan_staff" name="employee_id" label="Staff member" required items={staff} getValue={(e) => String(e.id)} getLabel={(e) => `${e.employee_no} — ${e.first_name} ${e.last_name}`} value={employeeId} onChange={setEmployeeId} placeholder="Search staff…" />}
        <Field name="due_on" label="Due back (blank = loan period)" type="date" defaultValue="" />
      </FormModal>
    </div>
  );
}

/** Return, inline on the loan's row. */
export function ReturnLoanButton({ loan }: { loan: LibraryLoanView }) {
  const [open, setOpen] = useState(false);
  if (loan.status !== 'ON_LOAN') return null;
  if (!open) return <button type="button" className="btn sm" onClick={() => setOpen(true)}>Return</button>;
  return (
    <div style={{ width: '100%', minWidth: 420 }}>
      <FormModal inline title="" onClose={() => setOpen(false)} onSubmit={(v) => returnLoanRequest(loan.id, v)} submitLabel="Record return" resultStyle="popup" successTitle="Book returned" successDetail={(d) => (d.daysLate ? `${d.daysLate} day${d.daysLate === 1 ? '' : 's'} late — fine ${(d.fine / 100).toFixed(2)}` : 'On time')}>
        <div className="grid g3">
          <Field name="returned_on" label="Returned on" type="date" required defaultValue={today()} />
          <Field name="lost" label="Outcome" type="select" defaultValue="0" options={[{ value: '0', label: 'Returned' }, { value: '1', label: 'Lost — copy written off' }]} />
          <Field name="remarks" label="Remarks" defaultValue="" />
        </div>
      </FormModal>
    </div>
  );
}

export function ChargeFineButton({ loan }: { loan: LibraryLoanView }) {
  const { run, busy } = useRunAction();
  if (loan.borrower_kind !== 'STUDENT' || !(Number(loan.fine_amount) > 0) || loan.fine_invoice_no) return null;
  return <button type="button" className="btn sm ghost" disabled={busy} onClick={() => run(() => chargeFineRequest(loan.id), { confirm: { title: 'Charge the fine to the fee account?', message: `${loan.borrower_name} is invoiced the fine on ${loan.title}; it shows on the fee statement.`, confirmLabel: 'Charge' }, successTitle: 'Fine charged', successDetail: (d) => d.invoiceNo })}>{busy ? '…' : 'Charge to fees'}</button>;
}
