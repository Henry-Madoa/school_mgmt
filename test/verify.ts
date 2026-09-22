/*
 * Financial and school-operations integrity test suite.
 * Run with:  npm test        (uses a throwaway database, never your live data)
 *
 * The suite writes, reverses and closes real records, so it refuses to start
 * unless TEST_DATABASE_URL names a database of its own — pointing it at the
 * live school would corrupt the ledger it is meant to be checking.
 */
import assert from 'node:assert';

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  console.error(
    '\nTEST_DATABASE_URL is not set.\n'
    + 'This suite posts and reverses real journals, so it needs its own database:\n\n'
    + '  TEST_DATABASE_URL=postgres://user:pass@localhost:5432/school_test npm test\n\n'
    + 'Create the schema there first with:  prisma migrate deploy\n',
  );
  process.exit(1);
}
// Must be set before lib/db is loaded, hence the dynamic imports below.
process.env.DATABASE_URL = testUrl;
// The suite exercises the demonstration school, whatever NODE_ENV the runner sets.
process.env.SEED_DEMO_DATA = 'true';

const { all, one, run, hasAnyRow } = await import('../lib/db.ts');
const { seedIfEmpty } = await import('../lib/seed.ts');
const accounting = await import('../lib/accounting.ts');
const gl = await import('../lib/gl.ts');
const auth = await import('../lib/auth.ts');
const permissions = await import('../lib/permissions.ts');
const jobQueueLib = await import('../lib/jobQueue.ts');
const faDepr = await import('../lib/fixedAssetDepreciation.ts');
const faJournalLib = await import('../lib/faJournal.ts');
const faLib = await import('../lib/fixedAssets.ts');
const dateFormula = await import('../lib/dateFormula.ts');
const custLib = await import('../lib/customers.ts');
const salesLib = await import('../lib/salesDocuments.ts');
const reminderLib = await import('../lib/reminders.ts');
const arReports = await import('../lib/receivablesReports.ts');
const vendorLib = await import('../lib/vendors.ts');
const purchaseLib = await import('../lib/purchaseDocuments.ts');
const apReports = await import('../lib/payablesReports.ts');
const receiptsLib = await import('../lib/receipts.ts');
const pvLib = await import('../lib/paymentVouchers.ts');
const whtLib = await import('../lib/whtCertificate.ts');
const vatReportsLib = await import('../lib/vatReports.ts');
const academics = await import('../lib/academics/setup.ts');
const teachersLib = await import('../lib/academics/teachers.ts');
const timetableLib = await import('../lib/academics/timetable.ts');
const attendanceLib = await import('../lib/academics/attendance.ts');
const assessmentsLib = await import('../lib/academics/assessments.ts');
const studentsLib = await import('../lib/students.ts');
const feeSetup = await import('../lib/fees/setup.ts');
const feeInvoices = await import('../lib/fees/invoices.ts');
const feeStatement = await import('../lib/fees/statement.ts');
const portalLib = await import('../lib/portal.ts');
const announcementsLib = await import('../lib/announcements.ts');
const mpesaLib = await import('../lib/mpesa/index.ts');

import type { Actor, SessionUser } from '../lib/types.ts';

let pass = 0;
let fail = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log(`  \x1b[32m✔\x1b[0m ${name}`);
    pass++;
  } catch (e) {
    console.log(`  \x1b[31m✖ ${name}\x1b[0m\n      ${(e as Error).message}`);
    fail++;
  }
}

const section = (t: string) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const throws = async (fn: () => unknown, codeOrRe: RegExp): Promise<void> => {
  try {
    await fn();
  } catch (e) {
    const s = (e as { code?: string }).code || (e as Error).message;
    assert.ok(String(s).match(codeOrRe), `expected ${codeOrRe}, got ${s}`);
    return;
  }
  assert.fail('expected the operation to be rejected, but it succeeded');
};

/** A session for any user — the effective permissions and profile as the app would load them. */
const sessionFor = async (userId: number): Promise<SessionUser> => {
  const tok = `up-${userId}-${Date.now()}-${Math.random()}`;
  await run('INSERT INTO session (token, user_id, created_at, expires_at) VALUES (?,?,?,?)',
    tok, userId, new Date().toISOString(), new Date(Date.now() + 3_600_000).toISOString());
  const su = (await auth.userFromToken(tok))!;
  await run('DELETE FROM session WHERE token = ?', tok);
  return su;
};

console.log('\nSeeding a throwaway database…');
const seedInfo = await seedIfEmpty();
console.log(`Seeded ${seedInfo.students ?? 0} students and ${seedInfo.teachers ?? 0} teachers.\n`);

const admin: Actor = { id: 1, username: 'admin' };
const today = new Date().toISOString().slice(0, 10);

/* ------------------------------------------------------------------------ */
section('Double-entry integrity');

// PostgreSQL does not accept output-column aliases in HAVING, so the aggregates
// are repeated there rather than referred to by name.
await test('every journal is internally balanced', async () => {
  const bad = await all<{ journal_no: string }>(
    `SELECT j.journal_no, SUM(jl.debit) d, SUM(jl.credit) c FROM journal j
     JOIN journal_line jl ON jl.journal_id = j.id
     GROUP BY j.id HAVING SUM(jl.debit) <> SUM(jl.credit)`,
  );
  assert.strictEqual(bad.length, 0, `${bad.length} unbalanced journals, first: ${bad[0]?.journal_no}`);
});

await test('trial balance nets to zero across the whole ledger', async () => {
  const tb = await accounting.trialBalance();
  const d = tb.reduce((a, r) => a + r.debit_balance, 0);
  const c = tb.reduce((a, r) => a + r.credit_balance, 0);
  assert.strictEqual(d, c, `debits ${d} vs credits ${c}`);
});

await test('stored GL balances match balances recomputed from journal lines', async () => {
  const rows = await accounting.trialBalance();
  const mismatches: typeof rows = [];
  for (const r of rows) {
    const stored = (await one<{ balance: number }>('SELECT balance FROM gl_account WHERE id = ?', r.id))!;
    if (stored.balance !== r.net) mismatches.push(r);
  }
  assert.strictEqual(mismatches.length, 0, `drift on ${mismatches.map((m) => m.code).join(', ')}`);
});

await test('assets equal liabilities plus equity plus surplus', async () => {
  const tb = await accounting.trialBalance();
  const sum = (t: string) => tb.filter((r) => r.type === t).reduce((a, r) => a + r.net, 0);
  const assets = sum('ASSET');
  const rhs = sum('LIABILITY') + sum('EQUITY') + (sum('INCOME') - sum('EXPENSE'));
  assert.strictEqual(assets, rhs, `assets ${assets} vs equity+liabilities ${rhs}`);
});

await test('a dated trial balance still lists accounts with no movement', async () => {
  // Regression: the as-of filter used to sit in the WHERE clause, which turned
  // the LEFT JOIN into an inner join and dropped every zero-movement account.
  const full = await accounting.trialBalance();
  const dated = await accounting.trialBalance({ asOf: today });
  assert.strictEqual(dated.length, full.length, `dated ${dated.length} rows vs undated ${full.length}`);
});

const gd1Filter = (value: string) => [{ field: 'gd1_filter', operator: '=' as const, value }];

await test('a Dimensional Trial Balance still lists every account, and combines dimension codes with |', async () => {
  // Same hazard as the as-of regression above, applied to the new Dimensional filter: a
  // dimension condition tested in WHERE would drop every account with no matching movement
  // instead of showing it at zero.
  const full = await accounting.trialBalance();
  const filtered = await gl.getTrialBalance({ filters: gd1Filter('NO-SUCH-DIMENSION-CODE') });
  assert.strictEqual(filtered.rows.length, full.length, `filtered ${filtered.rows.length} rows vs full ${full.length}`);

  // "A|B" must equal filtering by A and by B separately and summing — the OR-combination this
  // feature exists for ("Trial Balance for NBI|HQ").
  const dims = await all<{ code: string }>('SELECT code FROM global_dimension_1_value LIMIT 2');
  if (dims.length === 2) {
    const [a, b] = dims;
    const [byA, byB, combined] = await Promise.all([
      gl.getTrialBalance({ filters: gd1Filter(a.code) }),
      gl.getTrialBalance({ filters: gd1Filter(b.code) }),
      gl.getTrialBalance({ filters: gd1Filter(`${a.code}|${b.code}`) }),
    ]);
    const sum = (rows: typeof byA.rows) => rows.reduce((s, r) => s + r.net, 0);
    assert.strictEqual(
      sum(combined.rows), sum(byA.rows) + sum(byB.rows),
      `"${a.code}|${b.code}" should equal ${a.code} + ${b.code} summed`,
    );
  }
});

/* ------------------------------------------------------------------------ */

/* ------------------------------------------------------------------------ */
section('Posting engine controls');

await test('a no-direct-posting account rejects a manual journal but still accepts subledger postings', async () => {
  // '1020' (Bank Current Account) is one of the seeded bank_account control accounts.
  await throws(() => gl.postManualJournal({
    valueDate: today,
    lines: [{ account: '1020', debit: 500, credit: 0 }, { account: '4050', debit: 0, credit: 500 }],
  }, admin), /VALIDATION/);
  // The same account still accepts postJournal() directly — document posting callers,
  // and this very test suite's own fixtures above, are unaffected by the manual-journal guard.
  const before = await accounting.accountBalance('1020');
  await accounting.postJournal({
    valueDate: today, module: 'TEST', eventType: 'TEST', user: admin,
    lines: [{ account: '1020', debit: 500, credit: 0 }, { account: '4050', debit: 0, credit: 500 }],
  });
  assert.strictEqual(await accounting.accountBalance('1020'), before + 500);
});

await test('an unbalanced journal is rejected', async () => {
  await throws(() => accounting.postJournal({
    valueDate: today, module: 'TEST', eventType: 'TEST', user: admin,
    lines: [{ account: '1010', debit: 5000, credit: 0 }, { account: '4050', debit: 0, credit: 4000 }],
  }), /OUT_OF_BALANCE/);
});

await test('posting to a header (non-postable) account is rejected', async () => {
  await throws(() => accounting.postJournal({
    valueDate: today, module: 'TEST', eventType: 'TEST', user: admin,
    lines: [{ account: '1000', debit: 5000, credit: 0 }, { account: '4050', debit: 0, credit: 5000 }],
  }), /GL_NOT_POSTABLE/);
});

await test('a line cannot carry both a debit and a credit', async () => {
  await throws(() => accounting.postJournal({
    valueDate: today, module: 'TEST', eventType: 'TEST', user: admin,
    lines: [{ account: '1010', debit: 100, credit: 100 }, { account: '4050', debit: 0, credit: 100 }],
  }), /MIXED_LINE/);
});

await test('an idempotency key is never posted twice', async () => {
  const key = `IDEMPOTENCY-TEST-${Date.now()}`;
  const args = {
    valueDate: today, module: 'TEST', eventType: 'TEST', user: admin, idempotencyKey: key,
    lines: [{ account: '1010', debit: 15000, credit: 0 }, { account: '4050', debit: 0, credit: 15000 }],
  };
  const before = await accounting.accountBalance('4050');
  const a = await accounting.postJournal(args);
  const b = await accounting.postJournal(args);
  assert.strictEqual(a.id, b.id, 'the second call returned a different journal');
  assert.ok(b.duplicate, 'the second call was not flagged as a duplicate');
  assert.strictEqual(await accounting.accountBalance('4050'), before + 15000, 'the amount was posted twice');
});

await test('two simultaneous postings under one idempotency key produce one journal', async () => {
  // Both calls pass the read-before-insert check together; ON CONFLICT on the journal insert is
  // what stops the second from landing, and it must come back as the first one's duplicate.
  const key = `IDEMPOTENCY-RACE-${Date.now()}`;
  const args = {
    valueDate: today, module: 'TEST', eventType: 'TEST', user: admin, idempotencyKey: key,
    lines: [{ account: '1010', debit: 7000, credit: 0 }, { account: '4050', debit: 0, credit: 7000 }],
  };
  const before = await accounting.accountBalance('4050');
  const results = await Promise.all([accounting.postJournal(args), accounting.postJournal(args)]);
  assert.strictEqual(results[0].id, results[1].id, 'the two calls posted different journals');
  assert.strictEqual(results.filter((r) => r.duplicate).length, 1, 'exactly one call should be the duplicate');
  assert.strictEqual(await accounting.accountBalance('4050'), before + 7000, 'the amount was posted twice');
  const n = (await one<{ c: number }>('SELECT COUNT(*) c FROM journal WHERE idempotency_key = ?', key))!.c;
  assert.strictEqual(n, 1);
});

await test('a posting that fails part-way leaves no journal behind', async () => {
  // Accounts are validated up front, so the failure has to come from the line INSERT itself:
  // the second line carries a dimension value that does not exist, and the foreign key rejects
  // it after the header and the first line have already been written. Without the transaction
  // postJournal now opens for itself, that header — and one dangling line — would survive.
  const marker = `ATOMIC-${Date.now()}`;
  const storedBefore = (await one<{ balance: number }>("SELECT balance FROM gl_account WHERE code = '1010'"))!.balance;
  let rejected = false;
  try {
    await accounting.postJournal({
      valueDate: today, module: 'TEST', eventType: 'TEST', user: admin, description: marker,
      lines: [
        { account: '1010', debit: 100, credit: 0 },
        { account: '4050', debit: 0, credit: 100, globalDimension1Id: 999_999_999 },
      ],
    });
  } catch { rejected = true; }
  assert.ok(rejected, 'a line with an unknown dimension value was accepted');
  const left = (await one<{ c: number }>('SELECT COUNT(*) c FROM journal WHERE description = ?', marker))!.c;
  assert.strictEqual(left, 0, 'a half-posted journal header survived the failure');
  const storedAfter = (await one<{ balance: number }>("SELECT balance FROM gl_account WHERE code = '1010'"))!.balance;
  assert.strictEqual(storedAfter, storedBefore, 'the first line moved the stored G/L balance anyway');
});

await test('a closed period rejects normal posting', async () => {
  const code = today.slice(0, 7);
  await run("UPDATE accounting_period SET status='CLOSED' WHERE code = ?", code);
  try {
    await throws(() => accounting.postJournal({
      valueDate: today, module: 'TEST', eventType: 'TEST', user: admin,
      lines: [{ account: '1010', debit: 100, credit: 0 }, { account: '4050', debit: 0, credit: 100 }],
    }), /PERIOD_CLOSED/);
  } finally {
    await run("UPDATE accounting_period SET status='OPEN' WHERE code = ?", code);
  }
});

await test('a reversal creates compensating entries without changing the original', async () => {
  const j = await accounting.postJournal({
    valueDate: today, module: 'TEST', eventType: 'TEST', user: admin, description: 'reversal subject',
    lines: [{ account: '1010', debit: 7700, credit: 0 }, { account: '4050', debit: 0, credit: 7700 }],
  });
  const before = await accounting.accountBalance('4050');
  const LINES = 'SELECT * FROM journal_line WHERE journal_id = ? ORDER BY line_no';
  const originalLines = await all(LINES, j.id);
  const rev = await accounting.reverseJournal(j.id, admin, 'unit test');
  assert.strictEqual(await accounting.accountBalance('4050'), before - 7700, 'the reversal did not unwind the balance');
  const nowLines = await all(LINES, j.id);
  assert.deepStrictEqual(nowLines, originalLines, 'the original journal was mutated');
  const marker = (await one<{ reversed_by_id: number }>(
    'SELECT reversed_by_id FROM journal WHERE id=?', j.id,
  ))!;
  assert.strictEqual(marker.reversed_by_id, rev.id);
  await throws(() => accounting.reverseJournal(j.id, admin, 'again'), /ALREADY_REVERSED/);
});

/* ------------------------------------------------------------------------ */

/* ------------------------------------------------------------------------ */
section('School — admission, placement and the fee account');

const currentYear = (await academics.getCurrentAcademicYear())!;
const currentTerm = (await academics.getCurrentTerm())!;
const streamsNow = await academics.listStreams(currentYear.id);
const grade4East = streamsNow.find((s) => s.grade_level_name === 'Grade 4' && s.name === 'East')!;
const grade4West = streamsNow.find((s) => s.grade_level_name === 'Grade 4' && s.name !== 'East') ?? streamsNow.find((s) => s.grade_level_id === grade4East.grade_level_id && s.id !== grade4East.id)!;

await test('the demonstration school is seeded with a current year, a current term and classes', async () => {
  assert.ok(currentYear.is_current && currentTerm.is_current, 'a current year and term');
  assert.ok(streamsNow.length >= 10, `${streamsNow.length} classes`);
  assert.ok(grade4East && grade4East.students > 0, 'Grade 4 East has students');
  assert.ok((await one<{ c: number }>("SELECT COUNT(*) c FROM student WHERE status = 'ACTIVE'"))!.c > 100);
});

let newStudentId = 0;
let newAdmissionNo = '';
let siblingId = 0;
await test('admitting a student issues an Admission No., opens the fee account and enrols them', async () => {
  const r = await studentsLib.admitStudent({
    firstName: 'Test', lastName: 'Learner', gender: 'FEMALE', dateOfBirth: '2016-03-04', admissionDate: today, streamId: grade4East.id,
  }, [{ fullName: 'Test Parent', phone: '0711000111', email: 'test.parent@example.com', relationship: 'Mother', isPrimary: true }], admin);
  newStudentId = r.id; newAdmissionNo = r.admissionNo;
  assert.ok(/^ADM\d+/.test(r.admissionNo), `admission number from the STUDENT No. Series: ${r.admissionNo}`);
  const s = (await studentsLib.getStudent(r.id))!;
  assert.strictEqual(s.status, 'ACTIVE');
  assert.strictEqual(s.current_stream_id, grade4East.id, 'placed in the class');
  assert.strictEqual(s.current_grade_level_id, grade4East.grade_level_id, 'the class fixes the grade');
  assert.ok(s.customer_id && s.customer_no, 'a Receivables customer is the fee account');
  assert.strictEqual(s.guardians.length, 1);
  assert.ok(s.guardians[0].is_primary);
  assert.strictEqual(s.enrollments.length, 1);
  assert.strictEqual(s.enrollments[0].status, 'ACTIVE');
  const cust = (await one<{ name: string; phone: string | null; email: string | null }>('SELECT name, phone, email FROM customer WHERE id = ?', s.customer_id))!;
  assert.ok(cust.name.includes('Learner'), 'the fee account is named after the student');
  assert.strictEqual(cust.phone, '0711000111', "the account carries the primary guardian's phone");
});

await test('a guardian already on file (same name and phone) is linked, not duplicated', async () => {
  const before = (await one<{ c: number }>('SELECT COUNT(*) c FROM guardian'))!.c;
  const r = await studentsLib.admitStudent({ firstName: 'Sibling', lastName: 'Learner', admissionDate: today, streamId: grade4West.id },
    [{ fullName: 'Test Parent', phone: '0711000111', relationship: 'Mother', isPrimary: true }], admin);
  siblingId = r.id;
  const after = (await one<{ c: number }>('SELECT COUNT(*) c FROM guardian'))!.c;
  assert.strictEqual(after, before, 'no new guardian row');
  const g = await studentsLib.listStudentGuardians(r.id);
  assert.strictEqual(g.length, 1);
  const kids = await studentsLib.listGuardianStudents(g[0].id);
  assert.strictEqual(kids.length, 2, 'the parent now has two children on the roll');
});

await test('a duplicate admission number is refused', async () => {
  await throws(() => studentsLib.admitStudent({ firstName: 'Dup', lastName: 'Learner', admissionDate: today, streamId: grade4East.id, admissionNo: newAdmissionNo },
    [{ fullName: 'Someone', phone: '0722000222', relationship: 'Father', isPrimary: true }], admin), /VALIDATION|already/i);
});

await test('moving a student closes the old enrolment and opens a new one', async () => {
  await studentsLib.placeStudent(newStudentId, grade4West.id, admin);
  const s = (await studentsLib.getStudent(newStudentId))!;
  assert.strictEqual(s.current_stream_id, grade4West.id);
  assert.strictEqual(s.enrollments.filter((e) => e.status === 'ACTIVE').length, 1, 'exactly one active enrolment');
  await studentsLib.placeStudent(newStudentId, grade4East.id, admin);
});

await test('editing a student refreshes the fee account contact details but keeps its posting setup', async () => {
  const before = (await studentsLib.getStudent(newStudentId))!;
  const cust = (await one<{ customer_posting_group_code: string | null; payment_terms_code: string | null; reminder_terms_code: string | null }>('SELECT customer_posting_group_code, payment_terms_code, reminder_terms_code FROM customer WHERE id = ?', before.customer_id))!;
  assert.ok(cust.customer_posting_group_code, 'the account was opened with the default posting group');
  await studentsLib.updateStudent(newStudentId, { firstName: 'Test', lastName: 'Learner', gender: 'FEMALE', dateOfBirth: '2016-03-04', admissionDate: today, address: 'New address' },
    before.guardians.map((g) => ({ id: g.id, fullName: g.full_name, phone: g.phone, email: 'test.parent2@example.com', relationship: g.relationship, isPrimary: g.is_primary })), admin);
  const after = (await one<{ customer_posting_group_code: string | null; payment_terms_code: string | null; reminder_terms_code: string | null; email: string | null }>('SELECT customer_posting_group_code, payment_terms_code, reminder_terms_code, email FROM customer WHERE id = ?', before.customer_id))!;
  assert.strictEqual(after.email, 'test.parent2@example.com', 'the guardian email reached the fee account');
  assert.deepStrictEqual([after.customer_posting_group_code, after.payment_terms_code, after.reminder_terms_code], [cust.customer_posting_group_code, cust.payment_terms_code, cust.reminder_terms_code], 'posting group and terms untouched');
});

await test('a suspended student drops off the roster; the fee account keeps its balance', async () => {
  await studentsLib.setStudentStatus(newStudentId, 'SUSPENDED', 'test', admin);
  assert.ok(!(await studentsLib.listStreamRoster(grade4East.id)).some((s) => s.id === newStudentId));
  await studentsLib.setStudentStatus(newStudentId, 'ACTIVE', null, admin);
  assert.ok((await studentsLib.listStreamRoster(grade4East.id)).some((s) => s.id === newStudentId));
});

/* ------------------------------------------------------------------------ */
section('School — fee structure, invoice runs through the G/L, receipts and balances');

const feeReceivable = async () => accounting.accountBalance('1210');

await test('boarding status, opt-in items and discounts decide what a student is billed', async () => {
  const billing = await import('../lib/fees/billing.ts');
  const items = await feeSetup.listActiveFeeItems();
  const boarding = items.find((i) => i.code === 'BOARDING')!; const lunch = items.find((i) => i.code === 'LUNCH')!; const transport = items.find((i) => i.code === 'TRANSPORT')!;
  assert.ok(boarding.applies_to === 'BOARDER' && lunch.applies_to === 'DAY' && transport.applies_to === 'OPT_IN', 'the seed marks who each item is for');
  const subject = { id: newStudentId, grade_level_id: grade4East.grade_level_id, boarding_status: 'DAY' };
  const day = await billing.studentBill(subject, currentTerm.id);
  assert.ok(day.lines.some((l) => l.fee_item_id === lunch.id) && !day.lines.some((l) => l.fee_item_id === boarding.id), 'a day scholar pays lunch, not boarding');
  assert.ok(!day.lines.some((l) => l.fee_item_id === transport.id), 'transport only when opted in');
  const boarder = await billing.studentBill({ ...subject, boarding_status: 'BOARDER' }, currentTerm.id);
  assert.ok(boarder.lines.some((l) => l.fee_item_id === boarding.id) && !boarder.lines.some((l) => l.fee_item_id === lunch.id), 'a boarder pays boarding, not lunch');
  await billing.setStudentFeeOptions(newStudentId, [transport.id, lunch.id], admin);
  const withBus = await billing.studentBill(subject, currentTerm.id);
  assert.ok(withBus.lines.some((l) => l.fee_item_id === transport.id), 'opted in to transport');
  assert.strictEqual((await billing.listStudentFeeOptions(newStudentId)).length, 1, 'only OPT_IN items are kept as options');
  // A 25% tuition bursary and a fixed sibling discount, capped at the invoice.
  const tuition = items.find((i) => i.code === 'TUITION')!;
  await billing.saveStudentFeeDiscount(null, newStudentId, { feeItemId: tuition.id, percent: 25, description: 'Test bursary' }, admin);
  const { id: sib } = await billing.saveStudentFeeDiscount(null, newStudentId, { amount: 100_000, description: 'Sibling discount' }, admin);
  const discounted = await billing.studentBill(subject, currentTerm.id);
  const tuitionAmt = discounted.lines.find((l) => l.fee_item_id === tuition.id)!.amount;
  assert.strictEqual(discounted.discount, Math.round(tuitionAmt * 0.25) + 100_000, 'both discounts taken');
  assert.strictEqual(discounted.net, discounted.gross - discounted.discount);
  await throws(() => billing.saveStudentFeeDiscount(null, newStudentId, { percent: 10, amount: 500, description: 'both' }, admin), /not both/);
  await throws(() => billing.saveStudentFeeDiscount(null, newStudentId, { percent: 150, description: 'too much' }, admin), /0–100/);
  await billing.deleteStudentFeeDiscount(sib, admin);
  await billing.setStudentFeeOptions(newStudentId, [], admin);
});

await test('a class with a capacity refuses one placement too many', async () => {
  const before = await academics.getStream(grade4West.id);
  const roll = (await studentsLib.listStreamRoster(grade4West.id)).length;
  await academics.saveStream(grade4West.id, { gradeLevelId: before!.grade_level_id, academicYearId: before!.academic_year_id, name: before!.name, classTeacherId: before!.class_teacher_id, capacity: roll }, admin);
  await throws(() => studentsLib.placeStudent(newStudentId, grade4West.id, admin), /is full/);
  await academics.saveStream(grade4West.id, { gradeLevelId: before!.grade_level_id, academicYearId: before!.academic_year_id, name: before!.name, classTeacherId: before!.class_teacher_id, capacity: null }, admin);
});

await test('the fee structure per grade and term drives what an invoice run bills', async () => {
  const lines = await feeSetup.gradeFeeLines(grade4East.grade_level_id, currentTerm.id);
  assert.ok(lines.length >= 3, 'Grade 4 has a structure this term');
  const preview = await feeInvoices.previewRun(currentTerm.id, grade4East.grade_level_id);
  const mine = preview.lines.find((l) => l.student_id === newStudentId)!;
  assert.ok(mine && !mine.already_invoiced, 'the new student is due to be billed');
  const bill = await (await import('../lib/fees/billing.ts')).studentBill({ id: newStudentId, grade_level_id: grade4East.grade_level_id, boarding_status: 'DAY' }, currentTerm.id);
  assert.strictEqual(Number(mine.gross), bill.gross, 'gross = the items that apply to a day scholar');
  assert.strictEqual(Number(mine.amount), bill.net, 'to invoice = net of discounts');
  assert.ok(bill.gross < lines.reduce((a, l) => a + Number(l.amount), 0), 'less than the whole structure (boarding is not billed to a day scholar)');
  assert.ok(preview.lines.filter((l) => l.student_id !== newStudentId && l.student_id !== siblingId).every((l) => l.already_invoiced), 'everyone else was billed by the seed');
});

let invoicedAmount = 0;
await test('posting an invoice run raises one posted Sales Invoice per student and hits the G/L', async () => {
  const receivableBefore = await feeReceivable();
  const balBefore = Number((await feeStatement.feeAccountSummary(newStudentId))!.balance);
  const { no } = await feeInvoices.createFeeInvoiceRun({ termId: currentTerm.id, gradeLevelId: grade4East.grade_level_id, postingDate: today, dueDate: today }, admin);
  const r = await feeInvoices.postFeeInvoiceRun(no, admin);
  assert.strictEqual(r.failures.length, 0, r.failures.map((f) => `${f.admission_no}: ${f.error}`).join('; '));
  assert.strictEqual(r.posted, 2, 'only the two not-yet-invoiced students are billed');
  const runTotal = Number(r.total);
  invoicedAmount = Number((await feeInvoices.listStudentFeeInvoices(newStudentId))[0].amount);
  const inv = (await feeInvoices.listStudentFeeInvoices(newStudentId))[0];
  assert.ok(inv.posted_invoice_no, 'a posted Sales Invoice');
  assert.strictEqual(Number(inv.amount), invoicedAmount);
  const bill = await (await import('../lib/fees/billing.ts')).studentBill({ id: newStudentId, grade_level_id: grade4East.grade_level_id, boarding_status: 'DAY' }, currentTerm.id);
  assert.ok(bill.discount > 0, 'the test bursary is still on file');
  assert.strictEqual(invoicedAmount, bill.net, 'invoiced net of the bursary');
  const discountLines = await all<{ line_amount: number }>('SELECT l.line_amount FROM posted_sales_line l JOIN posted_sales_document d ON d.id = l.posted_sales_document_id WHERE d.no = ? AND l.line_amount < 0', inv.posted_invoice_no);
  assert.strictEqual(discountLines.reduce((a, l) => a + Number(l.line_amount), 0), -bill.discount, 'the discount is its own negative line');
  const contra = (await one<{ id: number }>('SELECT fee_discount_account_id AS id FROM organisation WHERE id = 1'))!.id;
  assert.ok((await accounting.accountBalance((await one<{ code: string }>('SELECT code FROM gl_account WHERE id = ?', contra))!.code)) < 0, 'the contra-income account carries the waived amount');
  assert.strictEqual(Number(inv.remaining_amount), invoicedAmount, 'fully open');
  const summary = (await feeStatement.feeAccountSummary(newStudentId))!;
  assert.strictEqual(Number(summary.balance), balBefore + invoicedAmount, 'the fee account balance rose by the invoice');
  assert.strictEqual(await feeReceivable(), receivableBefore + runTotal, 'School Fees Receivable rose by the run total');
  const run = (await feeInvoices.getFeeInvoiceRun(no))!;
  assert.strictEqual(run.status, 'Posted');
  await throws(() => feeInvoices.postFeeInvoiceRun(no, admin), /posted|VALIDATION/i);
});

await test('a second run for the same term skips everyone already invoiced', async () => {
  const { no } = await feeInvoices.createFeeInvoiceRun({ termId: currentTerm.id, gradeLevelId: grade4East.grade_level_id, postingDate: today, dueDate: today }, admin);
  const r = await feeInvoices.postFeeInvoiceRun(no, admin);
  assert.strictEqual(r.posted, 0);
  assert.ok(r.skipped > 0);
});

await test('a Customer receipt on the fee account reduces the balance and the receivable', async () => {
  const receivableBefore = await feeReceivable();
  const s = (await studentsLib.getStudent(newStudentId))!;
  const bank = (await one<{ id: number }>("SELECT id FROM bank_account WHERE code = 'CASH'"))!;
  const half = Math.round(invoicedAmount / 2 / 100) * 100;
  const { no } = await receiptsLib.createReceipt({
    receiptType: 'Customer', bankAccountId: bank.id, postingDate: today, description: `Fees — ${s.first_name} ${s.last_name}`, receivedAmount: half,
    lines: [{ accountNo: s.customer_no!, description: 'School fees', amount: half }],
  }, admin);
  await receiptsLib.postReceipt(no, admin);
  const summary = (await feeStatement.feeAccountSummary(newStudentId))!;
  assert.strictEqual(Number(summary.paid), half, 'paid to date');
  assert.strictEqual(Number(summary.balance), invoicedAmount - half, 'balance owing');
  assert.strictEqual(await feeReceivable(), receivableBefore - half, 'the receivable fell by the receipt');
  const st = await feeStatement.feeStatement(newStudentId);
  assert.strictEqual(st.closing, invoicedAmount - half, 'the statement closes on the balance');
  assert.ok(st.lines.some((l) => l.document_type === 'Invoice') && st.lines.some((l) => l.document_type === 'Payment'));
});

await test('fee balances list the student with what is owing, and the overdue filter respects the due date', async () => {
  const rows = await feeInvoices.listFeeBalances({ gradeLevelId: grade4East.grade_level_id });
  const mine = rows.find((r) => r.student_id === newStudentId)!;
  assert.ok(mine, 'listed');
  assert.strictEqual(Number(mine.balance), invoicedAmount - Math.round(invoicedAmount / 2 / 100) * 100);
  assert.strictEqual(Number(mine.overdue), 0, 'due today is not overdue');
  const overdue = await feeInvoices.listFeeBalances({ gradeLevelId: grade4East.grade_level_id, onlyOverdue: true });
  assert.ok(!overdue.some((r) => r.student_id === newStudentId));
});

await test('an M-Pesa paybill confirmation matches the admission number and posts a receipt', async () => {
  const before = (await feeStatement.feeAccountSummary(newStudentId))!;
  const r = await mpesaLib.recordC2bPayment({
    TransactionType: 'Pay Bill', TransID: `TEST${Date.now()}`, TransTime: '20260921101010', TransAmount: 1000, BusinessShortCode: '522533',
    BillRefNumber: newAdmissionNo.toLowerCase(), MSISDN: '254711000111', FirstName: 'Test', LastName: 'Parent',
  });
  assert.ok(r.posted, r.error ?? "not posted");
  const after = (await feeStatement.feeAccountSummary(newStudentId))!;
  assert.strictEqual(Number(after.balance), Number(before.balance) - 100_000, 'KES 1,000 came off the balance');
  const tx = (await one<{ status: string; student_id: number; receipt_no: string | null }>('SELECT status, student_id, receipt_no FROM mpesa_transaction WHERE id = ?', r.id))!;
  assert.strictEqual(tx.status, 'POSTED');
  assert.strictEqual(tx.student_id, newStudentId);
  assert.ok(tx.receipt_no, 'the receipt number is kept on the transaction');
  // The same confirmation again is a duplicate, not a second receipt.
  const again = await mpesaLib.recordC2bPayment({ TransID: (await one<{ mpesa_receipt: string }>('SELECT mpesa_receipt FROM mpesa_transaction WHERE id = ?', r.id))!.mpesa_receipt, TransTime: '20260921101010', TransAmount: 1000, BusinessShortCode: '522533', MSISDN: '254711000111' });
  assert.ok(again.duplicate);
});

await test('an M-Pesa payment with an unknown reference from a phone with two children waits for allocation', async () => {
  const r = await mpesaLib.recordC2bPayment({ TransID: `TESTU${Date.now()}`, TransTime: '20260921101010', TransAmount: 500, BusinessShortCode: '522533', BillRefNumber: 'NOSUCH', MSISDN: '254711000111' });
  assert.ok(!r.posted, 'not posted');
  const tx = (await one<{ status: string; match_note: string }>('SELECT status, match_note FROM mpesa_transaction WHERE id = ?', r.id))!;
  assert.ok(/2 students/.test(tx.match_note), tx.match_note);
  const before = (await feeStatement.feeAccountSummary(newStudentId))!;
  const a = await mpesaLib.allocateMpesaTransaction(r.id, { studentId: newStudentId }, admin);
  assert.ok(a.ok, a.error ?? "not allocated");
  const after = (await feeStatement.feeAccountSummary(newStudentId))!;
  assert.strictEqual(Number(after.balance), Number(before.balance) - 50_000);
});

/* ------------------------------------------------------------------------ */
section('School — teachers, timetable, registers, marks and report cards');

const demoTeacherId = (await one<{ employee_id: number }>("SELECT s.employee_id FROM approval_user_setup s JOIN app_user u ON u.id = s.user_id WHERE u.username = 'teacher'"))!.employee_id;
const teacherUser = { id: (await one<{ id: number }>("SELECT id FROM app_user WHERE username = 'teacher'"))!.id };

await test('the demo teacher login resolves to teaching staff with classes this year', async () => {
  assert.strictEqual(await portalLib.requireTeacher(teacherUser), demoTeacherId);
  const mine = await teachersLib.listTeacherAssignments(demoTeacherId);
  assert.ok(mine.length > 0, 'assignments this year');
  assert.ok(await teachersLib.teacherTeaches(demoTeacherId, mine[0].stream_id, mine[0].subject_id));
  const notMine = streamsNow.find((s) => !mine.some((a) => a.stream_id === s.id) && s.class_teacher_id !== demoTeacherId);
  if (notMine) await throws(() => portalLib.assertTeacherOnStream(demoTeacherId, notMine.id), /not assigned|FORBIDDEN/i);
});

await test('the timetable refuses a double booking for the class or the teacher', async () => {
  const a = (await teachersLib.listStreamAssignments(grade4East.id))[0];
  const slot = await timetableLib.saveSlot(null, { streamId: grade4East.id, subjectId: a.subject_id, teacherId: a.teacher_id, termId: currentTerm.id, dayOfWeek: 6, startTime: '08:00', endTime: '08:40' }, admin);
  await throws(() => timetableLib.saveSlot(null, { streamId: grade4East.id, subjectId: a.subject_id, teacherId: a.teacher_id, termId: currentTerm.id, dayOfWeek: 6, startTime: '08:20', endTime: '09:00' }, admin), /already has a lesson/);
  await throws(() => timetableLib.saveSlot(null, { streamId: grade4West.id, subjectId: a.subject_id, teacherId: a.teacher_id, termId: currentTerm.id, dayOfWeek: 6, startTime: '08:00', endTime: '08:40' }, admin), /already timetabled/);
  await throws(() => timetableLib.saveSlot(null, { streamId: grade4East.id, subjectId: a.subject_id, teacherId: a.teacher_id, termId: currentTerm.id, dayOfWeek: 6, startTime: '10:00', endTime: '09:00' }, admin), /end after it starts/);
  await timetableLib.deleteSlot(slot.id, admin);
});

await test('marking the register is idempotent per student and day, and refuses a future date', async () => {
  const roster = await studentsLib.listStreamRoster(grade4East.id);
  const marks = roster.map((s, i) => ({ studentId: s.id, status: (i === 0 ? 'ABSENT' : 'PRESENT') as 'ABSENT' | 'PRESENT' }));
  const r1 = await attendanceLib.markRegister(grade4East.id, today, marks, admin);
  assert.strictEqual(r1.marked, roster.length);
  const r2 = await attendanceLib.markRegister(grade4East.id, today, marks.map((m) => ({ ...m, status: 'PRESENT' as const })), admin);
  assert.strictEqual(r2.marked, roster.length);
  const rows = await attendanceLib.listRegister(grade4East.id, today);
  assert.strictEqual(rows.length, roster.length, 'one row per student, not two');
  assert.ok(rows.every((r) => r.status === 'PRESENT'), 'the second marking replaced the first');
  await throws(() => attendanceLib.markRegister(grade4East.id, '2099-01-01', marks, admin), /future/);
  const summary = await attendanceLib.studentAttendanceSummary(roster[0].id, today, today);
  assert.strictEqual(summary.present, 1);
});

await test('marks are 0–100, earn a competency band, and a blank clears', async () => {
  const subs = await academics.listSubjectsForGrade(grade4East.grade_level_id);
  const types = await academics.listAssessmentTypes();
  const r = await assessmentsLib.enterMarks(grade4East.id, subs[0].id, types[0].id, currentTerm.id, [{ studentId: newStudentId, score: 85 }], admin);
  assert.strictEqual(r.saved, 1);
  const mine = (await assessmentsLib.listStudentMarks(newStudentId, currentTerm.id)).find((m) => m.subject_id === subs[0].id && m.assessment_type_id === types[0].id)!;
  assert.strictEqual(Number(mine.score), 85);
  assert.ok(mine.competency_label, 'banded by the default grading scale');
  await throws(() => assessmentsLib.enterMarks(grade4East.id, subs[0].id, types[0].id, currentTerm.id, [{ studentId: newStudentId, score: 101 }], admin), /0–100/);
  const cleared = await assessmentsLib.enterMarks(grade4East.id, subs[0].id, types[0].id, currentTerm.id, [{ studentId: newStudentId, score: null }], admin);
  assert.strictEqual(cleared.cleared, 1);
});

await test('a report card is built from the marks and stays off the portal until published', async () => {
  const subs = await academics.listSubjectsForGrade(grade4East.grade_level_id);
  const types = await academics.listAssessmentTypes();
  await assessmentsLib.enterMarks(grade4East.id, subs[0].id, types[0].id, currentTerm.id, [{ studentId: newStudentId, score: 70 }], admin);
  await assessmentsLib.enterMarks(grade4East.id, subs[1].id, types[0].id, currentTerm.id, [{ studentId: newStudentId, score: 50 }], admin);
  const card = (await assessmentsLib.buildReportCard(newStudentId, currentTerm.id))!;
  assert.strictEqual(card.overall.average, 60, 'the mean of the subject averages');
  assert.ok(card.position && card.position.of > 1, 'ranked in the class');
  assert.strictEqual(card.card, null, 'no saved card yet');
  assert.ok(!(await assessmentsLib.listPublishedTerms(newStudentId)).some((t) => t.term_id === currentTerm.id));
  await assessmentsLib.saveReportCard(newStudentId, currentTerm.id, { classTeacherRemarks: 'Settling in well.' }, false, admin);
  assert.ok(!(await assessmentsLib.listPublishedTerms(newStudentId)).some((t) => t.term_id === currentTerm.id), 'a draft is not published');
  await assessmentsLib.saveReportCard(newStudentId, currentTerm.id, { classTeacherRemarks: 'Settling in well.' }, true, admin);
  assert.ok((await assessmentsLib.listPublishedTerms(newStudentId)).some((t) => t.term_id === currentTerm.id), 'published');
  const saved = (await assessmentsLib.buildReportCard(newStudentId, currentTerm.id))!.card!;
  assert.ok(saved.is_published && saved.published_by === 'admin');
});

/* ------------------------------------------------------------------------ */
section('School — electives, grading scales per level, instalments, admissions, welfare');

await test('an elective counts only for the students who take it — marks roster and report card follow', async () => {
  const jss = streamsNow.find((s) => s.grade_level_name === 'Grade 7')!;
  const roster = await studentsLib.listStreamRoster(jss.id);
  const subjects = await academics.listSubjectsForGrade(jss.grade_level_id);
  const elective = subjects.find((x) => !x.is_core)!;
  const core = subjects.find((x) => x.is_core)!;
  assert.ok(elective && core, 'Grade 7 offers both core subjects and electives');
  const pupil = roster[0];
  await academics.setStudentElectives(pupil.id, [], admin);
  assert.ok(!(await academics.listSubjectsForStudent(pupil.id)).some((x) => x.id === elective.id), 'not taking the elective');
  assert.ok((await academics.listSubjectTakers(jss.id, core.id)).some((x) => x.id === pupil.id), 'everyone takes a core subject');
  assert.ok(!(await academics.listSubjectTakers(jss.id, elective.id)).some((x) => x.id === pupil.id), 'the marks roster for the elective leaves them out');
  const types = await academics.listAssessmentTypes();
  const r = await assessmentsLib.enterMarks(jss.id, elective.id, types[0].id, currentTerm.id, [{ studentId: pupil.id, score: 77 }], admin);
  assert.strictEqual(r.saved, 0, 'a mark for a subject not taken is ignored');
  await academics.setStudentElectives(pupil.id, [elective.id, core.id], admin);
  const taking = await academics.listSubjectsForStudent(pupil.id);
  assert.ok(taking.some((x) => x.id === elective.id), 'now taking it (core ids in the list are ignored)');
  const r2 = await assessmentsLib.enterMarks(jss.id, elective.id, types[0].id, currentTerm.id, [{ studentId: pupil.id, score: 77 }], admin);
  assert.strictEqual(r2.saved, 1);
  const card = (await assessmentsLib.buildReportCard(pupil.id, currentTerm.id))!;
  assert.ok(card.lines.some((l) => l.subject_id === elective.id), 'the report card lists the elective');
  await assessmentsLib.enterMarks(jss.id, elective.id, types[0].id, currentTerm.id, [{ studentId: pupil.id, score: null }], admin);
});

await test('a grading scale bound to an education level labels that level, with points and a mean grade', async () => {
  const jss = streamsNow.find((s) => s.grade_level_name === 'Grade 7')!;
  const scale = (await academics.gradingScaleForGrade(jss.grade_level_id))!;
  assert.ok(scale.education_level_id && scale.bands.some((b) => b.points != null), 'Junior Secondary uses the letter-grade scale');
  const primary = (await academics.gradingScaleForGrade(grade4East.grade_level_id))!;
  assert.ok(primary.is_default && !primary.education_level_id, 'primary falls back to the CBC default');
  const roster = await studentsLib.listStreamRoster(jss.id);
  const card = (await assessmentsLib.buildReportCard(roster[0].id, currentTerm.id))!;
  assert.ok(card.overall.mean_points != null && card.overall.mean_grade, 'a Grade 7 card carries mean points and a mean grade');
  const band = await academics.bandForScore(82, scale);
  assert.strictEqual(band?.label, 'A');
  assert.strictEqual(band?.points, 12);
});

await test('a run split into instalments posts one invoice per instalment, each with its own due date, adding up exactly', async () => {
  const r = await studentsLib.admitStudent({ firstName: 'Instalment', lastName: 'Learner', admissionDate: today, streamId: grade4West.id },
    [{ fullName: 'Inst Parent', phone: '0733000333', relationship: 'Father', isPrimary: true }], admin);
  await throws(() => feeInvoices.createFeeInvoiceRun({ termId: currentTerm.id, gradeLevelId: grade4West.grade_level_id, postingDate: today, dueDate: today, instalments: [{ pct: 60, due_date: today }, { pct: 30, due_date: today }] }, admin), /add up to 100/);
  const { no } = await feeInvoices.createFeeInvoiceRun({ termId: currentTerm.id, gradeLevelId: grade4West.grade_level_id, postingDate: today, dueDate: today, instalments: [{ pct: 60, due_date: today }, { pct: 40, due_date: '2099-12-31' }] }, admin);
  const posted = await feeInvoices.postFeeInvoiceRun(no, admin);
  assert.strictEqual(posted.failures.length, 0, posted.failures.map((f) => f.error).join('; '));
  const inv = (await feeInvoices.listStudentFeeInvoices(r.id)).sort((a, b) => a.instalment_no - b.instalment_no);
  assert.strictEqual(inv.length, 2, 'two invoices');
  const billing = await import('../lib/fees/billing.ts');
  const bill = await billing.studentBill({ id: r.id, grade_level_id: grade4West.grade_level_id, boarding_status: 'DAY' }, currentTerm.id);
  assert.strictEqual(Number(inv[0].amount) + Number(inv[1].amount), bill.net, 'the instalments add up to the bill');
  assert.strictEqual(inv[0].due_date, today);
  assert.strictEqual(inv[1].due_date, '2099-12-31');
  const summary = (await feeStatement.feeAccountSummary(r.id))!;
  assert.strictEqual(Number(summary.balance), bill.net);
  assert.strictEqual(Number(summary.overdue), 0, 'nothing overdue yet');
  assert.strictEqual(feeInvoices.splitByInstalments(1001, [{ pct: 50, due_date: today }, { pct: 50, due_date: today }]).join(','), '501,500', 'rounding lands on the last instalment');
});

await test('an application moves through the pipeline and admission creates the student with the guardian', async () => {
  const admissions = await import('../lib/admissions.ts');
  const { id, no } = await admissions.saveApplication(null, { firstName: 'Applicant', lastName: 'Test', gradeLevelId: grade4East.grade_level_id, academicYearId: currentYear.id, guardianName: 'App Parent', guardianPhone: '0744000444', status: 'ENQUIRY' }, admin);
  assert.ok(/^APP/.test(no));
  await admissions.setApplicationStatus(id, 'APPLIED', admin);
  await admissions.setApplicationStatus(id, 'OFFERED', admin);
  await throws(() => admissions.setApplicationStatus(id, 'ADMITTED', admin), /Use Admit/);
  const r = await admissions.admitApplication(id, grade4East.id, today, null, admin);
  const s = (await studentsLib.getStudent(r.studentId))!;
  assert.strictEqual(s.current_stream_id, grade4East.id);
  assert.strictEqual(s.guardians[0].phone, '0744000444');
  const a = (await admissions.getApplication(id))!;
  assert.strictEqual(a.status, 'ADMITTED');
  assert.strictEqual(a.student_id, r.studentId);
  await throws(() => admissions.admitApplication(id, grade4East.id, today, null, admin), /already been admitted/);
});

await test('incidents are logged per student and the school-wide log shows what is open', async () => {
  const incidents = await import('../lib/incidents.ts');
  const { id } = await incidents.saveIncident(null, newStudentId, { kind: 'EXEAT', date: today, title: 'Test exeat', followUp: '2099-01-01' }, admin);
  await throws(() => incidents.saveIncident(null, newStudentId, { kind: 'SOMETHING', date: today, title: 'x' }, admin), /kind/);
  const mine = await incidents.listStudentIncidents(newStudentId);
  assert.ok(mine.some((i) => i.id === id && i.status === 'OPEN'));
  assert.ok((await incidents.listIncidents({ kind: 'EXEAT', openOnly: true })).some((i) => i.id === id));
  await incidents.saveIncident(id, newStudentId, { kind: 'EXEAT', date: today, title: 'Test exeat', status: 'CLOSED' }, admin);
  assert.ok(!(await incidents.listIncidents({ openOnly: true })).some((i) => i.id === id), 'closed items drop off the open log');
  await incidents.deleteIncident(id, admin);
});

/* ------------------------------------------------------------------------ */
section('School — portal scoping and announcements');

await test('a parent login sees only their own children; a student login only themselves', async () => {
  const parentUser = { id: (await one<{ id: number }>("SELECT id FROM app_user WHERE username = 'parent'"))!.id };
  const studentUser = { id: (await one<{ id: number }>("SELECT id FROM app_user WHERE username = 'student'"))!.id };
  const p = await portalLib.portalStudents(parentUser);
  assert.strictEqual(p.kind, 'GUARDIAN');
  assert.ok(p.students.length >= 1);
  const s = await portalLib.portalStudents(studentUser);
  assert.strictEqual(s.kind, 'STUDENT');
  assert.strictEqual(s.students.length, 1);
  assert.ok(p.students.some((x) => x.id === s.students[0].id), 'the demo student is the demo parent’s child');
  await throws(() => portalLib.requirePortalStudent(parentUser, newStudentId), /not on your account|FORBIDDEN/i);
  await throws(() => portalLib.portalStudents(teacherUser), /not matched/);
});

await test('announcements reach the audiences they are addressed to', async () => {
  const { id } = await announcementsLib.createAnnouncement({ title: 'Test notice', body: 'For Grade 4 East only', audience: 'STREAM', streamId: grade4East.id }, admin);
  const forClass = await announcementsLib.visibleAnnouncements({ audiences: ['STUDENTS'], streamIds: [grade4East.id] });
  assert.ok(forClass.some((a) => a.id === id));
  const forOther = await announcementsLib.visibleAnnouncements({ audiences: ['STUDENTS'], streamIds: [grade4West.id] });
  assert.ok(!forOther.some((a) => a.id === id));
  await throws(() => announcementsLib.createAnnouncement({ title: 'x', body: 'y', audience: 'STREAM' }, admin), /Pick the class/);
  await announcementsLib.deleteAnnouncement(id, admin);
});

await test('every School service exposed to the web-service channels is registered with a permission', async () => {
  const { CHANNELS_INTEGRATION } = await import('../lib/webServices/channels.ts');
  assert.ok(CHANNELS_INTEGRATION.procedures.length >= 10);
  for (const c of CHANNELS_INTEGRATION.procedures) assert.ok(c.action && c.action in permissions.ACTIONS, `${c.name} names a real action (${c.action})`);
});

/* ------------------------------------------------------------------------ */
section('School services — transport (buses as fixed assets, drivers as employees, work tickets), hostel beds, library');

const transportLib = await import('../lib/transport.ts');
const hostelLib = await import('../lib/hostel.ts');
const libraryLib = await import('../lib/library.ts');
const { addDaysIso } = await import('../lib/format.ts');

await test('a bus must be a VEHICLES fixed asset and a driver an employee with a licence on file', async () => {
  const buses = await transportLib.listBuses();
  assert.ok(buses.length >= 2, 'the demo school runs two buses');
  for (const b of buses) {
    const fa = (await one<{ fa_class_code: string }>('SELECT fa_class_code FROM fixed_asset WHERE no = ?', b.fixed_asset_no))!;
    assert.strictEqual(fa.fa_class_code, 'VEHICLES', `${b.registration_no} sits in the Fixed Asset register`);
  }
  const ict = (await one<{ no: string }>("SELECT no FROM fixed_asset WHERE fa_class_code = 'ICT' LIMIT 1"))!;
  await throws(() => transportLib.saveBus(null, { fixedAssetNo: ict.no, registrationNo: 'KZZ 999Z', capacity: 10 }, admin), /VEHICLES/);
  await throws(() => transportLib.saveBus(null, { fixedAssetNo: 'FA-NOPE', registrationNo: 'KZZ 999Z', capacity: 10 }, admin), /Fixed Asset register/);
  const drivers = await transportLib.listDrivers();
  assert.ok(drivers.length >= 2);
  for (const d of drivers) assert.ok(await hasAnyRow('employee', 'id = ?', d.employee_id), 'every driver is an HR employee');
  const cook = (await one<{ id: number }>("SELECT id FROM employee WHERE job_title = 'Head Cook'"))!;
  await throws(() => transportLib.saveBus(null, { fixedAssetNo: buses[0].fixed_asset_no, registrationNo: 'KZZ 998Z', capacity: 10, driverEmployeeId: cook.id }, admin), /driver profile/);
  // One driver, one bus.
  const other = buses.find((b) => b.id !== buses[0].id)!;
  await throws(() => transportLib.saveBus(other.id, { fixedAssetNo: other.fixed_asset_no, registrationNo: other.registration_no, capacity: other.capacity, driverEmployeeId: buses[0].driver_employee_id, routeId: other.route_id }, admin), /already assigned/);
});

await test('a work ticket is issued before the bus leaves, refused while one is open or the papers have lapsed, and closed with the odometer and fuel', async () => {
  const bus = (await transportLib.listBuses()).find((b) => b.registration_no === 'KDA 456B')!;
  assert.ok(bus.driver_employee_id && bus.route_id);
  const before = bus.odometer;
  const { no } = await transportLib.openWorkTicket({ busId: bus.id, date: today, purpose: 'ROUTE_RUN', odometerStart: before }, admin);
  assert.ok(/^WT\d+/.test(no), `numbered from the WORK_TICKET series: ${no}`);
  const t = (await transportLib.getWorkTicket(no))!;
  assert.strictEqual(t.driver_employee_id, bus.driver_employee_id, 'defaults to the assigned driver');
  assert.strictEqual(t.route_id, bus.route_id, 'and the bus’s route');
  assert.strictEqual(t.status, 'OPEN');
  await throws(() => transportLib.openWorkTicket({ busId: bus.id, date: today, purpose: 'ROUTE_RUN' }, admin), /already has an open work ticket/);
  await throws(() => transportLib.closeWorkTicket(no, { odometerEnd: before - 1 }, admin), /odometer/i);
  const { distance } = await transportLib.closeWorkTicket(no, { odometerEnd: before + 70, fuelLitres: 12.5, fuelCost: 222500 }, admin);
  assert.strictEqual(distance, 70);
  const after = (await transportLib.getBus(bus.id))!;
  assert.strictEqual(after.odometer, before + 70, 'the bus’s odometer advances with the ticket');
  await throws(() => transportLib.closeWorkTicket(no, { odometerEnd: before + 80 }, admin), /already closed/);
  // Expired insurance stops the next ticket.
  await run('UPDATE school_bus SET insurance_expiry = ? WHERE id = ?', '2020-01-01', bus.id);
  await throws(() => transportLib.openWorkTicket({ busId: bus.id, date: today, purpose: 'ROUTE_RUN' }, admin), /insurance has expired/);
  await run('UPDATE school_bus SET insurance_expiry = ? WHERE id = ?', bus.insurance_expiry, bus.id);
  // A trip needs a destination; a workshop visit does not need a route.
  await throws(() => transportLib.openWorkTicket({ busId: bus.id, date: today, purpose: 'TRIP' }, admin), /destination/);
  const { no: wt2 } = await transportLib.openWorkTicket({ busId: bus.id, date: today, purpose: 'MAINTENANCE', destination: 'Workshop' }, admin);
  await transportLib.cancelWorkTicket(wt2, 'Not needed', admin);
  assert.strictEqual((await transportLib.getWorkTicket(wt2))!.status, 'CANCELLED');
  const summary = await transportLib.fleetSummary(`${today.slice(0, 4)}-01-01`, today);
  const mine = summary.find((s) => s.bus_id === bus.id)!;
  assert.ok(mine.trips >= 1 && mine.km >= 70 && Number(mine.fuel_cost) >= 222500, 'the fleet report picks the closed ticket up');
});

await test('putting a student on a route opts them into the Transport fee item; taking them off removes it', async () => {
  const route = (await transportLib.listRoutes()).find((r) => r.code === 'C')!;
  assert.ok(route.stops.length >= 3, 'the demo route has stops');
  const transportItem = (await one<{ id: number }>("SELECT id FROM fee_item WHERE code = 'TRANSPORT'"))!;
  await transportLib.setStudentTransport(newStudentId, { routeId: route.id, stopId: route.stops[1].id, direction: 'MORNING' }, admin);
  const ride = (await transportLib.getStudentTransport(newStudentId))!;
  assert.strictEqual(ride.stop_name, route.stops[1].name);
  assert.strictEqual(ride.direction, 'MORNING');
  assert.ok(await hasAnyRow('student_fee_option', 'student_id = ? AND fee_item_id = ?', newStudentId, transportItem.id), 'the fare is billed on the next run');
  const otherRoute = (await transportLib.listRoutes()).find((r) => r.code === 'A')!;
  await throws(() => transportLib.setStudentTransport(newStudentId, { routeId: route.id, stopId: otherRoute.stops[0].id }, admin), /not on the route/);
  assert.ok((await transportLib.listRiders(route.id)).some((r) => r.student_id === newStudentId));
  await throws(() => transportLib.deleteRoute(route.id, admin), /ride this route/);
  await transportLib.setStudentTransport(newStudentId, { routeId: null }, admin);
  assert.ok(!(await transportLib.getStudentTransport(newStudentId)));
  assert.ok(!(await hasAnyRow('student_fee_option', 'student_id = ? AND fee_item_id = ?', newStudentId, transportItem.id)), 'and the opt-in goes with it');
});

await test('a bed takes one boarder of the house’s gender at a time; allocations are kept as history', async () => {
  const hostels = await hostelLib.listHostels();
  assert.ok(hostels.length >= 4, 'four houses in the demo');
  const girls = hostels.find((h) => h.gender === 'FEMALE')!;
  const boys = hostels.find((h) => h.gender === 'MALE')!;
  const freeGirls = (await hostelLib.listBeds(girls.id)).find((b) => !b.allocation_id && b.status === 'AVAILABLE')!;
  const freeBoys = (await hostelLib.listBeds(boys.id)).find((b) => !b.allocation_id && b.status === 'AVAILABLE')!;
  assert.ok(freeGirls && freeBoys, 'the seed leaves spare beds');
  // The test student is a day scholar (female).
  await throws(() => hostelLib.allocateBed(freeGirls.id, newStudentId, today, admin), /day scholar/);
  await run("UPDATE student SET boarding_status = 'BOARDER' WHERE id = ?", newStudentId);
  await throws(() => hostelLib.allocateBed(freeBoys.id, newStudentId, today, admin), /boys’ hostel/);
  const { id: alloc } = await hostelLib.allocateBed(freeGirls.id, newStudentId, today, admin);
  const bed = (await hostelLib.studentBed(newStudentId))!;
  assert.strictEqual(bed.id, alloc);
  assert.strictEqual(bed.hostel_name, girls.name);
  await throws(() => hostelLib.allocateBed(freeGirls.id, siblingId, today, admin), /taken/);
  assert.ok(!(await hostelLib.unallocatedBoarders()).some((s) => s.id === newStudentId), 'no longer in the queue');
  // Moving to another bed vacates the first; both stay in the history.
  const another = (await hostelLib.listBeds(girls.id)).find((b) => !b.allocation_id && b.status === 'AVAILABLE' && b.id !== freeGirls.id)!;
  await hostelLib.allocateBed(another.id, newStudentId, today, admin);
  const history = await hostelLib.studentBedHistory(newStudentId);
  assert.strictEqual(history.length, 2);
  assert.strictEqual(history.filter((h) => h.status === 'ACTIVE').length, 1);
  await throws(() => hostelLib.setBedStatus(another.id, 'OUT_OF_SERVICE', admin), /occupied/);
  await hostelLib.vacateBed(history.find((h) => h.status === 'ACTIVE')!.id, today, admin);
  assert.ok(!(await hostelLib.studentBed(newStudentId)));
  assert.ok((await hostelLib.unallocatedBoarders()).some((s) => s.id === newStudentId), 'a boarder without a bed is back in the queue');
  await run("UPDATE student SET boarding_status = 'DAY' WHERE id = ?", newStudentId);
});

await test('library: accession numbers per copy, loan limits, overdue block, fines charged to the fee account through the G/L', async () => {
  const setup = await libraryLib.getLibrarySetup();
  assert.ok(setup.fine_gl_account_id, 'the demo names a fines income account');
  const { id: bookId } = await libraryLib.saveBook(null, { title: 'Test Title', author: 'Tester', category: 'Test' }, admin);
  const { added } = await libraryLib.addCopies(bookId, 2, admin);
  assert.strictEqual(added.length, 2);
  assert.ok(added.every((a) => /^ACC\d+/.test(a)), `accession numbers from the LIBRARY_BOOK series: ${added.join(', ')}`);
  const before = await feeStatement.feeAccountSummary(newStudentId);
  const finesIncome = async () => Number((await one<{ c: number }>('SELECT COALESCE(SUM(jl.credit) - SUM(jl.debit), 0)::bigint c FROM journal_line jl WHERE jl.gl_account_id = ?', setup.fine_gl_account_id))!.c);
  const incomeBefore = await finesIncome();
  // Issue: due date from the loan period.
  const loan1 = await libraryLib.issueLoan({ accessionNo: added[0], studentId: newStudentId, issuedOn: today }, admin);
  assert.strictEqual(loan1.dueOn, addDaysIso(today, setup.loan_days));
  await throws(() => libraryLib.issueLoan({ accessionNo: added[0], studentId: siblingId }, admin), /is on loan/);
  await throws(() => libraryLib.issueLoan({ accessionNo: added[1] }, admin), /Pick the borrower/);
  // Backdated so it is overdue; then no further loan until it is back.
  await run('UPDATE library_loan SET issued_on = ?, due_on = ? WHERE id = ?', addDaysIso(today, -20), addDaysIso(today, -6), loan1.id);
  await throws(() => libraryLib.issueLoan({ accessionNo: added[1], studentId: newStudentId }, admin), /overdue/);
  const { fine, daysLate } = await libraryLib.returnLoan(loan1.id, { returnedOn: today }, admin);
  assert.strictEqual(daysLate, 6);
  assert.strictEqual(fine, 6 * Number(setup.fine_per_day));
  assert.strictEqual((await libraryLib.listCopies(bookId)).find((c) => c.accession_no === added[0])!.status, 'AVAILABLE');
  // The fine goes to the fee account as a posted Sales Invoice.
  const { invoiceNo } = await libraryLib.chargeFineToFeeAccount(loan1.id, admin);
  assert.ok(invoiceNo);
  const after = await feeStatement.feeAccountSummary(newStudentId);
  assert.strictEqual(Number(after!.balance) - Number(before!.balance), fine, 'the fine is on the fee balance');
  assert.strictEqual((await finesIncome()) - incomeBefore, fine, 'credited to the fines income account in the G/L');
  await throws(() => libraryLib.chargeFineToFeeAccount(loan1.id, admin), /Already charged/);
  // Limits: a student holds at most max_loans_student.
  const extra = await libraryLib.addCopies(bookId, setup.max_loans_student + 1, admin);
  for (let i = 0; i < setup.max_loans_student; i++) await libraryLib.issueLoan({ accessionNo: extra.added[i], studentId: newStudentId }, admin);
  await throws(() => libraryLib.issueLoan({ accessionNo: extra.added[setup.max_loans_student], studentId: newStudentId }, admin), /limit/);
  for (const l of await libraryLib.studentLoans(newStudentId)) if (l.status === 'ON_LOAN') await libraryLib.returnLoan(l.id, {}, admin);
  const stats = await libraryLib.libraryStats();
  assert.ok(stats.titles >= 18 && stats.on_loan >= 10, 'the demo library is stocked and lending');
});

/* ------------------------------------------------------------------------ */
section('System Automation (Job Queue)');

await test('a new entry starts On Hold', async () => {
  const { id } = await jobQueueLib.createJobQueueEntry(
    { code: 'TEST-EFR-JOB1', description: 'test', job_type: 'FEE_REMINDERS', run_every_minutes: 60 }, admin,
  );
  const entry = await jobQueueLib.getJobQueueEntry(id);
  assert.strictEqual(entry!.status, 'ON HOLD');
  await jobQueueLib.deleteJobQueueEntry(id, admin);
});

await test('runDueJobQueueEntries ignores an On Hold entry but runs a Ready, due one', async () => {
  const { id } = await jobQueueLib.createJobQueueEntry(
    { code: 'TEST-EFR-JOB2', description: 'test', job_type: 'FEE_REMINDERS', run_every_minutes: 60 }, admin,
  );
  await jobQueueLib.runDueJobQueueEntries();
  let entry = await jobQueueLib.getJobQueueEntry(id);
  assert.strictEqual(entry!.last_run_at, null, 'an On Hold entry must never run');

  await jobQueueLib.setJobQueueEntryStatus(id, 'READY', admin);
  await jobQueueLib.runDueJobQueueEntries();
  entry = await jobQueueLib.getJobQueueEntry(id);
  assert.strictEqual(entry!.last_run_status, 'SUCCESS');
  assert.ok(entry!.last_run_message);
  assert.ok(entry!.next_run_at! > entry!.last_run_at!, 'next_run_at should be rescheduled forward from the run');
  await jobQueueLib.deleteJobQueueEntry(id, admin);
});

await test('running an entry now works regardless of its schedule', async () => {
  const { id } = await jobQueueLib.createJobQueueEntry(
    { code: 'TEST-EFR-JOB3', description: 'test', job_type: 'FEE_REMINDERS', run_every_minutes: 60 }, admin,
  );
  await jobQueueLib.runJobQueueEntryNow(id, admin);
  const entry = await jobQueueLib.getJobQueueEntry(id);
  assert.strictEqual(entry!.status, 'ON HOLD', 'running now must not itself flip the entry to Ready');
  assert.strictEqual(entry!.last_run_status, 'SUCCESS');
  await jobQueueLib.deleteJobQueueEntry(id, admin);
});

/* ------------------------------------------------------------------------ */

/* ------------------------------------------------------------------------ */
section('Ledger still balances after every operation above');

await test('trial balance is still square', async () => {
  const tb = await accounting.trialBalance();
  const d = tb.reduce((a, r) => a + r.debit_balance, 0);
  const c = tb.reduce((a, r) => a + r.credit_balance, 0);
  assert.strictEqual(d, c);
});

/* ------------------------------------------------------------------------ */
section('Fixed Assets');

await test('the 30/360 day count matches Business Central', () => {
  assert.strictEqual(faDepr.depreciationDays('2024-01-01', '2024-02-01'), 30);
  assert.strictEqual(faDepr.depreciationDays('2024-01-01', '2025-01-01'), 360);
  assert.strictEqual(faDepr.depreciationDays('2024-01-31', '2024-02-29'), 29); // day clamped to 30 both ends → 29
  assert.strictEqual(faDepr.depreciationDays('2024-03-01', '2024-01-01'), 0);
});

await test('straight-line depreciation charges an even fraction of the basis and stops at salvage', () => {
  const base = {
    depreciation_method: 'Straight-Line' as const,
    depreciation_starting_date: '2024-01-01',
    depreciation_ending_date: null,
    no_of_depreciation_years: 5,
    straight_line_pct: 0,
    declining_balance_pct: 0,
    salvage_value: 20_000_00,
    last_depreciation_date: null,
    acquisition_cost: 1_200_000_00,
    accumulated_depreciation: 0,
    write_down_amount: 0,
    appreciation_amount: 0,
    book_value: 1_200_000_00,
    disposed: 0 as const,
  };
  // One full year: (1,200,000 − 20,000) / 5 = 236,000.
  const oneYear = faDepr.computeDepreciation(base, '2025-01-01');
  assert.strictEqual(oneYear.amount, -236_000_00);
  assert.strictEqual(oneYear.newBookValue, 964_000_00);

  // Near the end, with book value just above salvage, it takes only what is left.
  const almostDone = faDepr.computeDepreciation(
    { ...base, book_value: 25_000_00, accumulated_depreciation: -1_175_000_00 }, '2026-01-01', 100_00,
  );
  assert.strictEqual(almostDone.amount, -5_000_00);
  assert.strictEqual(almostDone.newBookValue, 20_000_00);

  // Once book value is at salvage, nothing more is due.
  const done = faDepr.computeDepreciation({ ...base, book_value: 20_000_00 }, '2027-01-01');
  assert.strictEqual(done.amount, 0);
});

await test('a Manual book is never auto-depreciated', () => {
  const r = faDepr.computeDepreciation({
    depreciation_method: 'Manual', depreciation_starting_date: '2024-01-01', depreciation_ending_date: null,
    no_of_depreciation_years: 5, straight_line_pct: 0, declining_balance_pct: 0, salvage_value: 0,
    last_depreciation_date: null, acquisition_cost: 1_000_000_00, accumulated_depreciation: 0,
    write_down_amount: 0, appreciation_amount: 0, book_value: 1_000_000_00, disposed: 0,
  }, '2025-01-01');
  assert.strictEqual(r.amount, 0);
});

await test('the seeded assets have their acquisition posted and some depreciation run', async () => {
  const assets = await faLib.listFixedAssets();
  assert.ok(assets.length >= 3, 'expected the seed to create demo fixed assets');
  for (const a of assets) {
    assert.ok(a.acquisition_cost > 0, `${a.no} has no acquisition cost`);
    assert.ok(a.book_value < a.acquisition_cost, `${a.no} has not been depreciated`);
    assert.ok(a.book_value > 0, `${a.no} is already fully depreciated`);
  }
});

await test('every FA ledger book value reconciles to its FA Depreciation Book roll-up', async () => {
  const books = await all<{ fixed_asset_id: number; depreciation_book_code: string; book_value: number }>(
    'SELECT fixed_asset_id, depreciation_book_code, book_value FROM fa_depreciation_book',
  );
  for (const b of books) {
    const led = (await one<{ total: number }>(
      `SELECT COALESCE(SUM(CASE WHEN part_of_book_value = 1 THEN amount ELSE 0 END), 0) AS total
       FROM fa_ledger_entry WHERE fixed_asset_id = ? AND depreciation_book_code = ?`,
      b.fixed_asset_id, b.depreciation_book_code,
    ))!;
    assert.strictEqual(led.total, b.book_value, `asset ${b.fixed_asset_id} book value diverged from its ledger`);
  }
});

await test('the FA subledger ties to the property, plant & equipment control accounts', async () => {
  const report = await (await import('../lib/fixedAssetReports.ts')).getFaBookValueReport({ bookCode: 'COMPANY' });
  const cost = await accounting.accountBalance('1420') + await accounting.accountBalance('1430');
  const accum = await accounting.accountBalance('1425') + await accounting.accountBalance('1435');
  assert.strictEqual(report.totals.book_value, cost + accum);
});

await test('disposing an asset above its book value books a gain and zeroes the book value', async () => {
  const sys: Actor = { id: 1, username: 'system' };
  const asset = (await faLib.listFixedAssets()).find((a) => !a.disposed && a.book_value > 0)!;
  const bookValueBefore = asset.book_value;
  const gainBefore = await accounting.accountBalance('4060');

  const lineNo = await (await import('../lib/db.ts')).run(
    `INSERT INTO fa_journal_line (no, posting_date, fixed_asset_id, depreciation_book_code, fa_posting_type, amount,
       balancing_gl_account_id, status, created_at, created_by)
     VALUES (?, ?, ?, 'COMPANY', 'Disposal', ?, (SELECT id FROM gl_account WHERE code='1020'), 'Approved', ?, 'system')`,
    `FAJ-DISPOSE-TEST`, '2026-08-31', asset.id, bookValueBefore + 50_000_00, new Date().toISOString(),
  ).then(() => 'FAJ-DISPOSE-TEST');

  const res = await faJournalLib.postFaJournalLine(lineNo, sys);
  assert.strictEqual(res.bookValue, 0);
  assert.ok(res.disposed);

  const after = await faLib.getFixedAsset(asset.no);
  assert.ok(after?.disposal_date, 'disposal date was not stamped');
  // Gain on disposal = proceeds − book value = 50,000 (a credit to income account 4060).
  assert.strictEqual(await accounting.accountBalance('4060') - gainBefore, 50_000_00);
});

/* ------------------------------------------------------------------------ */
section('Receivables');

await test('BC date formulas resolve correctly', () => {
  assert.strictEqual(dateFormula.applyDateFormula('2026-01-15', '30D'), '2026-02-14');
  assert.strictEqual(dateFormula.applyDateFormula('2026-01-15', 'CM'), '2026-01-31');
  assert.strictEqual(dateFormula.applyDateFormula('2026-01-15', 'CM+10D'), '2026-02-10');
  assert.strictEqual(dateFormula.applyDateFormula('2026-01-15', ''), '2026-01-15');
});

await test('a seeded customer exists with a posted invoice and a balance', async () => {
  const customers = await custLib.listCustomers();
  assert.ok(customers.length >= 3, 'expected the seed to create demo customers');
  const withBalance = customers.filter((c) => c.balance > 0);
  assert.ok(withBalance.length >= 1, 'expected at least one customer with an open balance');
  for (const c of withBalance) {
    const led = (await one<{ total: number }>(
      'SELECT COALESCE(SUM(remaining_amount),0) total FROM cust_ledger_entry WHERE customer_id = ? AND open = 1', c.id,
    ))!;
    assert.strictEqual(led.total, c.balance, `${c.no} balance diverged from its open ledger entries`);
  }
});

await test('the receivables subledger ties to the 1250 control account', async () => {
  const subledger = (await one<{ total: number }>('SELECT COALESCE(SUM(remaining_amount),0) total FROM cust_ledger_entry WHERE open = 1'))!;
  assert.strictEqual(subledger.total, await accounting.accountBalance('1250'));
});

await test('posting a sales invoice creates an open Cust. Ledger Entry, moves the G/L and the customer balance', async () => {
  const sys: Actor = { id: 1, username: 'system' };
  const cust = (await custLib.listCustomers())[0];
  const before = cust.balance;
  const glBefore = await accounting.accountBalance('4094');
  const arBefore = await accounting.accountBalance('1250');

  const { no } = await salesLib.createSalesDocument(
    { documentType: 'Invoice', customerId: cust.id, postingDate: '2026-08-01', documentDate: '2026-08-01', paymentTermsCode: '30 DAYS' }, sys,
  );
  await salesLib.setSalesLines(no, [{ type: 'G/L Account', no: '4094', description: 'Test service', quantity: 1, unitPrice: 50_000_00 }], sys);
  await run("UPDATE sales_header SET status = 'Released', due_date = '2026-08-31', sell_to_name = ? WHERE no = ?", cust.name, no);
  const res = await salesLib.postSalesDocument(no, { invoice: true }, sys);
  assert.ok(res.custLedgerEntryId, 'no Cust. Ledger Entry created');

  const cle = (await one<{ amount: number; remaining_amount: number; open: number; due_date: string }>(
    'SELECT amount, remaining_amount, open, due_date FROM cust_ledger_entry WHERE id = ?', res.custLedgerEntryId,
  ))!;
  assert.strictEqual(cle.amount, 50_000_00);
  assert.strictEqual(cle.remaining_amount, 50_000_00);
  assert.strictEqual(cle.open, 1);
  assert.strictEqual(cle.due_date, '2026-08-31');
  assert.strictEqual(await accounting.accountBalance('4094'), glBefore + 50_000_00);
  assert.strictEqual(await accounting.accountBalance('1250'), arBefore + 50_000_00);
  assert.strictEqual((await custLib.getCustomerById(cust.id))!.balance, before + 50_000_00);
});

await test('createReminders picks up an overdue entry and computes interest + fee', async () => {
  const sys: Actor = { id: 1, username: 'system' };
  // The seeded tenant (14 DAYS terms) has an invoice from two months ago — overdue.
  const tenant = (await all<{ id: number; no: string }>("SELECT id, no FROM customer WHERE customer_posting_group_code = 'TENANT' LIMIT 1"))[0];
  const overdue = (await one<{ n: number }>(
    "SELECT COUNT(*) n FROM cust_ledger_entry WHERE customer_id = ? AND open = 1 AND due_date < ?", tenant.id, new Date().toISOString().slice(0, 10),
  ))!;
  assert.ok(Number(overdue.n) >= 1, 'expected the seeded tenant to have an overdue invoice');

  const res = await reminderLib.createReminders({ customerId: tenant.id, documentDate: new Date().toISOString().slice(0, 10) }, sys);
  const rem = (await one<{ no: string; interest_amount: number; additional_fee: number; reminder_level: number }>(
    "SELECT no, interest_amount, additional_fee, reminder_level FROM reminder_header WHERE customer_id = ? AND status = 'Open' ORDER BY id DESC LIMIT 1", tenant.id,
  ));
  assert.ok(res.created >= 1 || rem, 'no reminder created for the overdue tenant');

  if (rem) {
    const glBefore = await accounting.accountBalance('4099');
    const arBefore = await accounting.accountBalance('1250');
    const issue = await reminderLib.issueReminder(rem.no, sys);
    if (rem.additional_fee > 0 || rem.interest_amount > 0) {
      assert.ok(issue.journalNo, 'issuing a reminder with a charge posted no journal');
      const feeMoved = (await accounting.accountBalance('4099')) - glBefore;
      const interestMoved = (await accounting.accountBalance('4098'));
      assert.ok(feeMoved >= 0 && interestMoved >= 0);
      assert.ok((await accounting.accountBalance('1250')) >= arBefore, 'AR did not rise with the reminder charge');
    }
  }
});

await test('the Aged AR report buckets an overdue entry and its total ties to 1250', async () => {
  const asOf = new Date().toISOString().slice(0, 10);
  const report = await arReports.getAgedAccountsReceivable({ asOf });
  const grand = report.totals.balance;
  assert.strictEqual(grand, report.totals.not_due + report.totals.bucket_1 + report.totals.bucket_2 + report.totals.bucket_3 + report.totals.bucket_over);
  assert.strictEqual(grand, await accounting.accountBalance('1250'), 'Aged AR grand total does not equal the 1250 control account');
});

await test('a sales credit memo reverses signs against the ledger', async () => {
  const sys: Actor = { id: 1, username: 'system' };
  const cust = (await custLib.listCustomers())[0];
  const arBefore = await accounting.accountBalance('1250');
  const { no } = await salesLib.createSalesDocument(
    { documentType: 'Credit Memo', customerId: cust.id, postingDate: '2026-08-10', documentDate: '2026-08-10' }, sys,
  );
  await salesLib.setSalesLines(no, [{ type: 'G/L Account', no: '4094', description: 'Credit', quantity: 1, unitPrice: 10_000_00 }], sys);
  await run("UPDATE sales_header SET status = 'Released', sell_to_name = ? WHERE no = ?", cust.name, no);
  const res = await salesLib.postSalesDocument(no, { invoice: true }, sys);
  const cle = (await one<{ amount: number; positive: number }>('SELECT amount, positive FROM cust_ledger_entry WHERE id = ?', res.custLedgerEntryId))!;
  assert.strictEqual(cle.amount, -10_000_00);
  assert.strictEqual(cle.positive, 0);
  assert.strictEqual(await accounting.accountBalance('1250'), arBefore - 10_000_00);
});

section('Payables');

await test('a seeded vendor exists with a posted invoice and a balance', async () => {
  const vendors = await vendorLib.listVendors();
  assert.ok(vendors.length >= 3, 'expected the seed to create demo vendors');
  const withBalance = vendors.filter((v) => v.balance > 0);
  assert.ok(withBalance.length >= 1, 'expected at least one vendor with an open balance');
  for (const v of withBalance) {
    const led = (await one<{ total: number }>(
      'SELECT COALESCE(SUM(remaining_amount),0) total FROM vendor_ledger_entry WHERE vendor_id = ? AND open = 1', v.id,
    ))!;
    assert.strictEqual(led.total, v.balance, `${v.no} balance diverged from its open ledger entries`);
  }
});

await test('the payables subledger ties to the 2150 control account', async () => {
  const subledger = (await one<{ total: number }>('SELECT COALESCE(SUM(remaining_amount),0) total FROM vendor_ledger_entry WHERE open = 1'))!;
  assert.strictEqual(subledger.total, await accounting.accountBalance('2150'));
});

await test('posting a purchase invoice (G/L line) creates an open Vendor Ledger Entry and moves the G/L', async () => {
  const sys: Actor = { id: 1, username: 'system' };
  const vend = (await vendorLib.listVendors())[0];
  const before = vend.balance;
  const glBefore = await accounting.accountBalance('5030');
  const apBefore = await accounting.accountBalance('2150');

  const { no } = await purchaseLib.createPurchaseDocument(
    { documentType: 'Invoice', vendorId: vend.id, postingDate: '2026-08-01', documentDate: '2026-08-01', paymentTermsCode: '30 DAYS', vendorInvoiceNo: 'TEST-INV-1' }, sys,
  );
  await purchaseLib.setPurchaseLines(no, [{ type: 'G/L Account', no: '5030', description: 'Test supplies', quantity: 1, directUnitCost: 40_000_00 }], sys);
  await run("UPDATE purchase_header SET status = 'Released', due_date = '2026-08-31', buy_from_name = ? WHERE no = ?", vend.name, no);
  const res = await purchaseLib.postPurchaseDocument(no, { invoice: true }, sys);
  assert.ok(res.vendorLedgerEntryId, 'no Vendor Ledger Entry created');

  const vle = (await one<{ amount: number; remaining_amount: number; open: number; due_date: string; positive: number }>(
    'SELECT amount, remaining_amount, open, due_date, positive FROM vendor_ledger_entry WHERE id = ?', res.vendorLedgerEntryId,
  ))!;
  assert.strictEqual(vle.amount, 40_000_00);
  assert.strictEqual(vle.remaining_amount, 40_000_00);
  assert.strictEqual(vle.open, 1);
  assert.strictEqual(vle.positive, 1);
  assert.strictEqual(vle.due_date, '2026-08-31');
  assert.strictEqual(await accounting.accountBalance('5030'), glBefore + 40_000_00);
  assert.strictEqual(await accounting.accountBalance('2150'), apBefore + 40_000_00);
  assert.strictEqual((await vendorLib.getVendorById(vend.id))!.balance, before + 40_000_00);
});

await test('a purchase invoice with a Fixed Asset line posts an FA acquisition', async () => {
  const sys: Actor = { id: 1, username: 'system' };
  const vend = (await vendorLib.listVendors())[0];
  const { no: assetNo } = await faLib.createFixedAsset(
    { description: 'Payables test asset', faClassCode: 'EQUIPMENT', faSubclassCode: 'OFFICE-EQUIP', faLocationCode: 'HQ', blocked: false, inactive: false }, sys,
  );
  const asset = (await one<{ id: number }>('SELECT id FROM fixed_asset WHERE no = ?', assetNo))!;
  await faLib.setFaDepreciationBook(asset.id, {
    depreciationBookCode: 'COMPANY', faPostingGroupCode: 'EQUIPMENT', depreciationMethod: 'Straight-Line',
    depreciationStartingDate: '2026-08-01', depreciationEndingDate: null, noOfDepreciationYears: 4,
    straightLinePct: 0, decliningBalancePct: 0, salvageValue: 0, disposalCalculationMethod: 'Net',
  }, sys);

  const { no } = await purchaseLib.createPurchaseDocument(
    { documentType: 'Invoice', vendorId: vend.id, postingDate: '2026-08-02', documentDate: '2026-08-02', vendorInvoiceNo: 'TEST-FA-1' }, sys,
  );
  await purchaseLib.setPurchaseLines(no, [{ type: 'Fixed Asset', no: assetNo, description: 'New asset', quantity: 1, directUnitCost: 250_000_00, faDepreciationBookCode: 'COMPANY' }], sys);
  await run("UPDATE purchase_header SET status = 'Released', buy_from_name = ? WHERE no = ?", vend.name, no);
  await purchaseLib.postPurchaseDocument(no, { invoice: true }, sys);

  const book = (await one<{ acquisition_cost: number; book_value: number }>(
    "SELECT acquisition_cost, book_value FROM fa_depreciation_book WHERE fixed_asset_id = ? AND depreciation_book_code = 'COMPANY'", asset.id,
  ))!;
  assert.strictEqual(book.acquisition_cost, 250_000_00);
  assert.strictEqual(book.book_value, 250_000_00);
  const stamped = (await one<{ acquisition_date: string | null }>('SELECT acquisition_date FROM fixed_asset WHERE id = ?', asset.id))!;
  assert.ok(stamped.acquisition_date, 'acquisition_date not stamped');
});

await test('the Aged AP report buckets an overdue entry and its total ties to 2150', async () => {
  const asOf = new Date().toISOString().slice(0, 10);
  const report = await apReports.getAgedAccountsPayable({ asOf });
  const grand = report.totals.balance;
  assert.strictEqual(grand, report.totals.not_due + report.totals.bucket_1 + report.totals.bucket_2 + report.totals.bucket_3 + report.totals.bucket_over);
  assert.strictEqual(grand, await accounting.accountBalance('2150'), 'Aged AP grand total does not equal the 2150 control account');
});

await test('a purchase credit memo reverses signs against the ledger', async () => {
  const sys: Actor = { id: 1, username: 'system' };
  const vend = (await vendorLib.listVendors())[0];
  const apBefore = await accounting.accountBalance('2150');
  const { no } = await purchaseLib.createPurchaseDocument(
    { documentType: 'Credit Memo', vendorId: vend.id, postingDate: '2026-08-10', documentDate: '2026-08-10', vendorInvoiceNo: 'TEST-CM-1' }, sys,
  );
  await purchaseLib.setPurchaseLines(no, [{ type: 'G/L Account', no: '5030', description: 'Credit', quantity: 1, directUnitCost: 8_000_00 }], sys);
  await run("UPDATE purchase_header SET status = 'Released', buy_from_name = ? WHERE no = ?", vend.name, no);
  const res = await purchaseLib.postPurchaseDocument(no, { invoice: true }, sys);
  const vle = (await one<{ amount: number; positive: number }>('SELECT amount, positive FROM vendor_ledger_entry WHERE id = ?', res.vendorLedgerEntryId))!;
  assert.strictEqual(vle.amount, -8_000_00);
  assert.strictEqual(vle.positive, 0);
  assert.strictEqual(await accounting.accountBalance('2150'), apBefore - 8_000_00);
});

/* ------------------------------------------------------------------------ */
section('Cash Management, VAT & Withholding Tax');

const cmSys: Actor = { id: 1, username: 'system' };
await run('UPDATE cash_management_setup SET receipt_approval_limit = 999999999999, pv_approval_limit = 999999999999 WHERE id = 1');

await test('the seed created the VAT Posting Setup (BC style, reused for WHT)', async () => {
  const vat16 = (await one<{ vat_pct: number; tax_type: string; code: string }>(
    "SELECT s.vat_pct, s.tax_type, a.code FROM vat_posting_setup s JOIN gl_account a ON a.id = s.tax_account_id WHERE s.vat_bus_posting_group_code = 'STANDARD' AND s.vat_prod_posting_group_code = 'VAT16'",
  ))!;
  assert.strictEqual(vat16.vat_pct, 16);
  assert.strictEqual(vat16.tax_type, 'VAT');
  assert.strictEqual(vat16.code, '1260');
  const wht = (await one<{ vat_pct: number; tax_type: string; code: string }>(
    "SELECT s.vat_pct, s.tax_type, a.code FROM vat_posting_setup s JOIN gl_account a ON a.id = s.tax_account_id WHERE s.vat_prod_posting_group_code = 'WHT-PROF'",
  ))!;
  assert.strictEqual(wht.vat_pct, 5);
  assert.strictEqual(wht.tax_type, 'WHT');
  assert.strictEqual(wht.code, '2190');
});

let vatInvoiceNo = '';
await test('a purchase invoice with a VAT16 line extracts input VAT to 1260; a no-VAT line is unchanged', async () => {
  const vend = (await vendorLib.listVendors())[0];
  const b1260 = await accounting.accountBalance('1260');
  const b2150 = await accounting.accountBalance('2150');
  const b5030 = await accounting.accountBalance('5030');
  const { no } = await purchaseLib.createPurchaseDocument(
    { documentType: 'Invoice', vendorId: vend.id, postingDate: '2026-08-05', documentDate: '2026-08-05', paymentTermsCode: '30 DAYS', vendorInvoiceNo: 'VAT-INV-1' }, cmSys,
  );
  vatInvoiceNo = no;
  await purchaseLib.setPurchaseLines(no, [
    { type: 'G/L Account', no: '5030', description: 'Consultancy', quantity: 1, directUnitCost: 100_000_00, vatProdPostingGroupCode: 'VAT16' },
    { type: 'G/L Account', no: '5030', description: 'Reimbursables (no VAT)', quantity: 1, directUnitCost: 10_000_00 },
  ], cmSys);
  await run("UPDATE purchase_header SET status = 'Released', due_date = '2026-09-04', buy_from_name = ? WHERE no = ?", vend.name, no);
  const res = await purchaseLib.postPurchaseDocument(no, { invoice: true }, cmSys);

  assert.strictEqual(await accounting.accountBalance('5030'), b5030 + 110_000_00, 'expense ex-VAT (both lines)');
  assert.strictEqual(await accounting.accountBalance('1260'), b1260 + 16_000_00, 'input VAT = 16% of the VAT line');
  assert.strictEqual(await accounting.accountBalance('2150'), b2150 + 126_000_00, 'payables = ex-VAT + VAT');
  const vle = (await one<{ amount: number }>('SELECT amount FROM vendor_ledger_entry WHERE id = ?', res.vendorLedgerEntryId))!;
  assert.strictEqual(vle.amount, 126_000_00, 'the vendor is owed the VAT-inclusive total');
  const ve = (await one<{ base: number; amount: number }>("SELECT base, amount FROM vat_entry WHERE document_no = ? AND tax_type = 'VAT'", no))!;
  assert.strictEqual(ve.base, 100_000_00);
  assert.strictEqual(ve.amount, 16_000_00);
});

await test('a Receipt (G/L line) posts Dr bank / Cr income and writes a Bank Ledger Entry + posted_receipt', async () => {
  const bank = (await one<{ gl_account_id: number; balance: number; balance_lcy: number }>("SELECT gl_account_id, balance, balance_lcy FROM bank_account WHERE code = 'BANK'"))!;
  const bankBal = await accounting.accountBalance('1020');
  const incomeBal = await accounting.accountBalance('4050');
  const { no } = await receiptsLib.createReceipt({
    receiptType: 'G/L Account', bankAccountId: (await one<{ id: number }>("SELECT id FROM bank_account WHERE code = 'BANK'"))!.id,
    postingDate: '2026-08-10', description: 'Sundry income received', payModeCode: null,
    lines: [{ lineType: 'G/L Account', accountNo: '4050', description: 'Photocopy income', amount: 5_000_00 }],
  }, cmSys);
  const res = await receiptsLib.postReceipt(no, cmSys);
  assert.ok(res.journalNo, 'a journal was posted');
  assert.strictEqual(await accounting.accountBalance('1020'), bankBal + 5_000_00);
  assert.strictEqual(await accounting.accountBalance('4050'), incomeBal + 5_000_00);
  const bale = (await one<{ document_type: string; amount: number; amount_lcy: number }>(
    "SELECT document_type, amount, amount_lcy FROM bank_account_ledger_entry WHERE document_no = ? ORDER BY id DESC LIMIT 1", no,
  ))!;
  assert.strictEqual(bale.document_type, 'Receipt');
  assert.strictEqual(bale.amount, 5_000_00);
  assert.strictEqual(bale.amount_lcy, 5_000_00);
  const pr = (await one<{ amount: number }>('SELECT amount FROM posted_receipt WHERE receipt_no = ?', no))!;
  assert.strictEqual(pr.amount, 5_000_00);
  assert.strictEqual((await one<{ balance: number }>("SELECT balance FROM bank_account WHERE code = 'BANK'"))!.balance, bank.balance + 5_000_00);
});

await test('a Payment Voucher paying the VAT invoice with WHT-PROF closes it, books WHT payable and issues a certificate', async () => {
  const vend = (await vendorLib.listVendors())[0];
  await run("UPDATE vendor SET pin_no = 'A001122334Z' WHERE id = ?", vend.id);
  const bankId = (await one<{ id: number }>("SELECT id FROM bank_account WHERE code = 'BANK'"))!.id;
  const b2150 = await accounting.accountBalance('2150');
  const b2190 = await accounting.accountBalance('2190');
  const b1020 = await accounting.accountBalance('1020');

  const { no } = await pvLib.createPaymentVoucher({
    payingBankAccountId: bankId, date: '2026-08-12', payModeCode: 'EFT', description: `Pay ${vatInvoiceNo}`, payeeName: vend.name,
    lines: [{ lineType: 'Vendor', accountNo: vend.no, amount: 126_000_00, appliesToDocNo: vatInvoiceNo, whtCodeOne: 'WHT-PROF' }],
  }, cmSys);
  // WHT base = ex-VAT 100,000 → 5% = 5,000. Net paid = 126,000 − 5,000 = 121,000.
  const line = (await one<{ wht_amount_one: number; net_amount: number }>(
    'SELECT wht_amount_one, net_amount FROM payment_voucher_line WHERE payment_voucher_header_id = (SELECT id FROM payment_voucher_header WHERE no = ?)', no,
  ))!;
  assert.strictEqual(line.wht_amount_one, 5_000_00, 'WHT on the VAT-exclusive base');
  assert.strictEqual(line.net_amount, 121_000_00);

  const res = await pvLib.postPaymentVoucher(no, cmSys);
  assert.strictEqual(await accounting.accountBalance('2150'), b2150 - 126_000_00, 'the invoice is cleared in full');
  assert.strictEqual(await accounting.accountBalance('2190'), b2190 + 5_000_00, 'WHT payable rises');
  assert.strictEqual(await accounting.accountBalance('1020'), b1020 - 121_000_00, 'bank falls by the net paid');
  const vle = (await one<{ open: number }>("SELECT open FROM vendor_ledger_entry WHERE document_no = ? AND document_type = 'Invoice'", vatInvoiceNo))!;
  assert.strictEqual(vle.open, 0, 'the purchase invoice is closed');
  assert.strictEqual(res.whtCertificateNos.length, 1, 'one WHT certificate');
  const cert = (await whtLib.getWhtCertificate(res.whtCertificateNos[0]))!;
  assert.strictEqual(cert.total_wht, 5_000_00);
  assert.strictEqual(cert.lines[0].base, 100_000_00);
});

await test('a direct-expense Payment Voucher extracts VAT and withholds both income WHT and withholding VAT', async () => {
  const bankId = (await one<{ id: number }>("SELECT id FROM bank_account WHERE code = 'BANK'"))!.id;
  const b1260 = await accounting.accountBalance('1260');
  const b2190 = await accounting.accountBalance('2190');
  const b2195 = await accounting.accountBalance('2195');
  const b1020 = await accounting.accountBalance('1020');
  const b5030 = await accounting.accountBalance('5030');

  const { no } = await pvLib.createPaymentVoucher({
    payingBankAccountId: bankId, date: '2026-08-14', payModeCode: 'EFT', description: 'Direct consultancy', payeeName: 'Ad-hoc Consultant',
    lines: [{ lineType: 'G/L Account', accountNo: '5030', amount: 116_000_00, vatProdPostingGroupCode: 'VAT16', whtCodeOne: 'WHT-PROF', whtCodeTwo: 'WHT-VAT' }],
  }, cmSys);
  await pvLib.postPaymentVoucher(no, cmSys);
  assert.strictEqual(await accounting.accountBalance('5030'), b5030 + 100_000_00, 'expense net of VAT');
  assert.strictEqual(await accounting.accountBalance('1260'), b1260 + 16_000_00, 'input VAT extracted');
  assert.strictEqual(await accounting.accountBalance('2190'), b2190 + 5_000_00, 'income WHT 5%');
  assert.strictEqual(await accounting.accountBalance('2195'), b2195 + 2_000_00, 'withholding VAT 2%');
  assert.strictEqual(await accounting.accountBalance('1020'), b1020 - 109_000_00, 'bank = gross − both WHTs');
});

await test('the VAT Input Listing total ties to the vat_entry ledger', async () => {
  const rows = await vatReportsLib.vatInputListing({ from: '2026-01-01', to: '2026-12-31' });
  const listed = rows.reduce((s, r) => s + Number(r.amount), 0);
  const ledger = Number((await one<{ t: number }>("SELECT COALESCE(SUM(amount),0) t FROM vat_entry WHERE tax_type = 'VAT'"))!.t);
  assert.strictEqual(listed, ledger);
});

await test('every Cash Management journal is internally balanced in LCY', async () => {
  const rows = await all<{ id: number; d: number; c: number }>(
    "SELECT j.id, SUM(jl.debit_lcy) d, SUM(jl.credit_lcy) c FROM journal j JOIN journal_line jl ON jl.journal_id = j.id WHERE j.source_module = 'CASH_MGMT' GROUP BY j.id",
  );
  assert.ok(rows.length > 0, 'some Cash Management journals were posted');
  for (const r of rows) assert.strictEqual(Number(r.d), Number(r.c), `journal ${r.id} did not balance`);
});

await test('the payables subledger still ties to 2150 after the VAT invoice + payment voucher', async () => {
  const subledger = Number((await one<{ total: number }>('SELECT COALESCE(SUM(remaining_amount_lcy),0) total FROM vendor_ledger_entry WHERE open = 1'))!.total);
  assert.strictEqual(subledger, await accounting.accountBalance('2150'));
});

/* ------------------------------------------------------------------------ */

/* ------------------------------------------------------------------------ */
section('Security');

await test('passwords are salted and never stored in the clear', async () => {
  const row = (await one<{ password_hash: string }>(
    "SELECT password_hash FROM app_user WHERE username='admin'",
  ))!;
  assert.ok(row.password_hash.startsWith('scrypt$'));
  assert.ok(!row.password_hash.includes('admin123'));
  assert.ok(auth.verifyPassword('admin123', row.password_hash));
  assert.ok(!auth.verifyPassword('admin124', row.password_hash));
});

await test('two users with the same password get different hashes', () => {
  assert.notStrictEqual(auth.hashPassword('same-password'), auth.hashPassword('same-password'));
});

await test('role permissions gate access correctly', async () => {
  const role = (await one<{ id: number }>("SELECT id FROM role WHERE name='Bursar'"))!;
  const permissionSet = await auth.loadPermissionSet(role.id);
  const bursar = { is_system: 0, permissionSet } as SessionUser;
  assert.ok(permissions.canAction(bursar, 'CASH_MGMT_RECEIPT_CREATE'));
  assert.ok(!permissions.canAction(bursar, 'PAYROLL_PERIODS_APPROVE'));
  assert.ok(!permissions.canAction(bursar, 'ADMIN_USER_MANAGE'));
  const sysadmin = { is_system: 1, permissionSet: { tables: {}, pages: {} } } as SessionUser;
  assert.ok(permissions.canAction(sysadmin, 'ADMIN_USER_MANAGE'));
});

/* ------------------------------------------------------------------------ */

section('Financial Reports (Account Schedules)');

const expr = await import('../lib/expr.ts');
const finReports = await import('../lib/financialReports.ts');
const reportsLib = await import('../lib/reports.ts');

await test('the formula evaluator honours precedence, parens and divide-by-zero', () => {
  assert.strictEqual(expr.evalFormula('2+3*4', {}), 14);
  assert.strictEqual(expr.evalFormula('(2+3)*4', {}), 20);
  assert.strictEqual(expr.evalFormula('-A+B', { A: 10, B: 3 }), -7);
  assert.strictEqual(expr.evalFormula('A/B*100', { A: 5, B: 0 }), 0);
  assert.strictEqual(expr.evalFormula('UNKNOWN+1', {}), 1);
  assert.ok(!expr.isValidFormula('A +* B'));
});

await test('a seeded Financial Report runs and its formula rows reconcile', async () => {
  const res = await finReports.runFinancialReport({ reportName: 'SASRA-CAPITAL-ADEQUACY', to: today });
  const byRow = Object.fromEntries(res.rows.map((r) => [r.rowNo, r.cells[0]?.value ?? 0]));
  assert.ok(res.rows.length >= 7, 'every capital-adequacy line is present');
  assert.ok(byRow.TA > 0, 'total assets is non-zero on the seeded ledger');
  const expectedR1 = byRow.TA === 0 ? 0 : (byRow.CORE / byRow.TA) * 100;
  assert.ok(Math.abs(byRow.R1 - expectedR1) < 1e-6, 'R1 equals CORE / TA * 100');
});

await test('the seeded Statement of Financial Position balances', async () => {
  const res = await finReports.runFinancialReport({ reportName: 'STMT-FIN-POSITION', to: today });
  const chk = res.rows.find((r) => r.rowNo === 'CHK')!;
  assert.ok(Math.abs(chk.cells[0]?.value ?? 0) < 100, 'assets equal equity + liabilities (within a shilling)');

  const bs = await reportsLib.getBalanceSheet({ asOf: today });
  const ta = res.rows.find((r) => r.rowNo === 'TA')!.cells[0]?.value ?? 0;
  assert.ok(Math.abs(ta - bs.totals.assets) < 100, 'total assets agrees with getBalanceSheet()');
});

await test('a comparison-date column measures the prior fiscal year, and formulas fold in', async () => {
  await finReports.saveColumnLayoutName({ name: 'TEST-CL', description: 'test' }, admin);
  await finReports.saveColumnLayoutLine({ layoutName: 'TEST-CL', columnNo: 'TY', columnHeader: 'This Year', columnType: 'NET_CHANGE' }, admin);
  await finReports.saveColumnLayoutLine({ layoutName: 'TEST-CL', columnNo: 'LY', columnHeader: 'Last Year', columnType: 'NET_CHANGE', comparisonDateFormula: '-1Y' }, admin);
  await finReports.saveColumnLayoutLine({ layoutName: 'TEST-CL', columnNo: 'VAR', columnHeader: 'Change', columnType: 'FORMULA', formula: 'TY-LY' }, admin);

  await finReports.saveAccScheduleName({ name: 'TEST-FR', description: 'test', defaultColumnLayoutName: 'TEST-CL' }, admin);
  await finReports.saveAccScheduleLine({ scheduleName: 'TEST-FR', rowNo: 'INC', description: 'Income', totalingType: 'POSTING_ACCOUNTS', totaling: '4010' }, admin);
  await finReports.saveAccScheduleLine({ scheduleName: 'TEST-FR', rowNo: 'DBL', description: 'Doubled', totalingType: 'FORMULA', totaling: 'INC+INC' }, admin);

  const col = (rows: Awaited<ReturnType<typeof finReports.runFinancialReport>>, rowNo: string, colNo: string): number => {
    const r = rows.rows.find((x) => x.rowNo === rowNo)!;
    return r.cells[rows.columns.findIndex((c) => c.columnNo === colNo)]?.value ?? 0;
  };
  const opts = { rowGroup: 'TEST-FR' as const, from: '2026-01-01', to: '2026-12-31' };
  const beforeTY = col(await finReports.runFinancialReport(opts), 'INC', 'TY');
  const beforeLY = col(await finReports.runFinancialReport(opts), 'INC', 'LY');

  await accounting.postJournal({
    valueDate: '2026-06-30', module: 'TEST', eventType: 'TEST_FR', description: 'current year income',
    lines: [{ account: '4010', debit: 0, credit: 100_00 }, { account: '1210', debit: 100_00, credit: 0 }], user: admin,
  });
  await accounting.postJournal({
    valueDate: '2025-06-30', module: 'TEST', eventType: 'TEST_FR', description: 'prior year income',
    lines: [{ account: '4010', debit: 0, credit: 40_00 }, { account: '1210', debit: 40_00, credit: 0 }], user: admin,
  });

  const res = await finReports.runFinancialReport(opts);
  assert.strictEqual(col(res, 'INC', 'TY') - beforeTY, 100_00, 'the this-year column picks up the 2026 posting');
  assert.strictEqual(col(res, 'INC', 'LY') - beforeLY, 40_00, 'the -1Y comparison column picks up the 2025 posting');
  assert.strictEqual(col(res, 'INC', 'VAR'), col(res, 'INC', 'TY') - col(res, 'INC', 'LY'), 'the formula column is TY - LY');
  assert.strictEqual(col(res, 'DBL', 'TY'), col(res, 'INC', 'TY') * 2, 'a formula row evaluates over the other rows in its column');
});

await test('a dimension totaling that matches nothing yields zero', async () => {
  await finReports.saveAccScheduleLine({
    scheduleName: 'TEST-FR', rowNo: 'INCD', description: 'Income (unknown dimension)',
    totalingType: 'POSTING_ACCOUNTS', totaling: '4010', dimension1Totaling: 'ZZZ-NO-SUCH-CODE',
  }, admin);
  const res = await finReports.runFinancialReport({ rowGroup: 'TEST-FR', from: '2026-01-01', to: '2026-12-31' });
  const incd = res.rows.find((r) => r.rowNo === 'INCD')!;
  assert.strictEqual(incd.cells[0]?.value ?? 0, 0);
});

/* ------------------------------------------------------------------------ */

section('Role Centres & Profiles');

const profilesLib = await import('../lib/profiles.ts');
const roleCentersLib = await import('../lib/roleCenters.ts');

await test('the eight Role Centre profiles and the permission sets are seeded', async () => {
  const codes = (await all<{ code: string }>('SELECT code FROM profile ORDER BY sort')).map((r) => r.code);
  assert.deepStrictEqual(codes, ['SUPER', 'SCHOOL_ADMIN', 'STUDENT_PARENT', 'FINANCE_MANAGER', 'ACCOUNTANT', 'HR_PAYROLL', 'SELF_SERVICE']);
  for (const name of ['Principal', 'Academics Officer', 'Teacher', 'Bursar', 'Accountant', 'HR & Payroll Officer', 'Student / Parent']) {
    const row = await one<{ id: number; lines: number }>(
      `SELECT r.id, COUNT(l.id) lines FROM role r LEFT JOIN permission_set_line l ON l.role_id = r.id
       WHERE r.name = ? GROUP BY r.id`, name,
    );
    assert.ok(row && Number(row.lines) > 3, `${name} exists with permission lines`);
  }
});

await test('a Profile is a landing page only — it grants no permissions', async () => {
  const teacher = (await one<{ id: number }>("SELECT id FROM app_user WHERE username='teacher'"))!;
  const before = await auth.loadPermissionSet(
    (await one<{ role_id: number }>('SELECT role_id FROM app_user WHERE id = ?', teacher.id))!.role_id,
  );
  const fm = (await one<{ id: number }>("SELECT id FROM profile WHERE code='FINANCE_MANAGER'"))!;
  const held = (await profilesLib.listUserProfiles(teacher.id)).map((p) => p.id);
  await profilesLib.setUserProfiles(teacher.id, [...held, fm.id], admin);
  await profilesLib.setActiveProfile(teacher.id, fm.id, admin);

  const tok = `rc-${Date.now()}`;
  await run('INSERT INTO session (token, user_id, created_at, expires_at) VALUES (?,?,?,?)',
    tok, teacher.id, new Date().toISOString(), new Date(Date.now() + 3_600_000).toISOString());
  const su = (await auth.userFromToken(tok))!;
  await run('DELETE FROM session WHERE token = ?', tok);

  assert.strictEqual(su.activeProfile.code, 'FINANCE_MANAGER', 'the Finance Manager Role Centre is now active');
  assert.deepStrictEqual(su.permissionSet.pages, before.pages, 'pages are unchanged by the profile');
  assert.deepStrictEqual(su.permissionSet.tables, before.tables, 'table rights are unchanged by the profile');
  // The Teacher permission set carries no G/L rights regardless of the profile.
  assert.ok(!permissions.canAction(su as SessionUser, 'GL_JOURNAL_APPROVE'));
  await profilesLib.setUserProfiles(teacher.id, held, admin);
});

await test('assigning profiles keeps the active one valid; an unassigned choice is rejected', async () => {
  const u = (await one<{ id: number }>("SELECT id FROM app_user WHERE username='hr'"))!;
  const held = (await profilesLib.listUserProfiles(u.id)).map((p) => p.id);
  const [sa, acc] = await Promise.all([
    one<{ id: number }>("SELECT id FROM profile WHERE code='SCHOOL_ADMIN'"),
    one<{ id: number }>("SELECT id FROM profile WHERE code='ACCOUNTANT'"),
  ]);
  await profilesLib.setUserProfiles(u.id, [sa!.id], admin);
  let active = (await one<{ active_profile_id: number | null }>('SELECT active_profile_id FROM app_user WHERE id = ?', u.id))!;
  assert.strictEqual(active.active_profile_id, sa!.id, 'active resets to the only assigned profile');

  // Switching to a profile the user does not hold falls back rather than sticking.
  const back = await profilesLib.setActiveProfile(u.id, acc!.id, admin);
  assert.strictEqual(back.code, 'SCHOOL_ADMIN', 'an unassigned profile choice falls back to an assigned one');

  // Removing every profile clears the active pointer.
  await profilesLib.setUserProfiles(u.id, [], admin);
  active = (await one<{ active_profile_id: number | null }>('SELECT active_profile_id FROM app_user WHERE id = ?', u.id))!;
  assert.strictEqual(active.active_profile_id, null);
  await profilesLib.setUserProfiles(u.id, held, admin);
});

await test('the active Role Centre scopes which sidebar groups show', async () => {
  const { NAV, groupInRoleCentre } = await import('../lib/nav.ts');
  const groupsFor = (centre: string) => NAV.filter((g) => groupInRoleCentre(g, centre)).map((g) => g.group);

  // Super sees every group.
  assert.deepStrictEqual(groupsFor('SUPER'), NAV.map((g) => g.group));
  // A specialised centre sees Operations + Administration + only its own area.
  const self = groupsFor('SELF_SERVICE');
  assert.ok(self.includes('Operations') && self.includes('Self Service') && self.includes('Administration'));
  assert.ok(!self.includes('Fees') && !self.includes('Finance') && !self.includes('Academics'));
  assert.ok(groupsFor('FINANCE_MANAGER').includes('Finance') && groupsFor('FINANCE_MANAGER').includes('Fees'));
  assert.ok(groupsFor('SCHOOL_ADMIN').includes('Academics') && !groupsFor('SCHOOL_ADMIN').includes('My School'));
  assert.ok(groupsFor('STUDENT_PARENT').includes('My School') && !groupsFor('STUDENT_PARENT').includes('Academics'));
});

await test('the Teacher Portal shows inside Self Service only for a login marked as a teacher', async () => {
  const { NAV, isSubMenu } = await import('../lib/nav.ts');
  const selfService = NAV.find((g) => g.group === 'Self Service')!;
  assert.ok(selfService.items.some((e) => isSubMenu(e) && e.submenu === 'My Classes'), 'My Classes is a Self Service sub-menu');
  const teacher = (await one<{ id: number }>("SELECT id FROM app_user WHERE username='teacher'"))!;
  const su = await sessionFor(teacher.id);
  assert.ok(su.isTeacher && permissions.canNav(su, 'TEACHER_PORTAL'), 'the demo teacher is marked as a teacher and sees the portal');
  await run('UPDATE approval_user_setup SET is_teacher = 0 WHERE user_id = ?', teacher.id);
  const off = await sessionFor(teacher.id);
  assert.ok(!off.isTeacher && !permissions.canNav(off, 'TEACHER_PORTAL'), 'untick Teacher and the portal disappears, permission or not');
  await throws(() => portalLib.requireTeacher({ id: teacher.id }), /not marked as a teacher/);
  await run('UPDATE approval_user_setup SET is_teacher = 1 WHERE user_id = ?', teacher.id);
});

await test('every Role Centre aggregate returns a well-formed object on the seeded school', async () => {
  const sa = await roleCentersLib.getSchoolAdminRoleCenter();
  assert.ok(sa.kpi.students > 0 && sa.kpi.classes > 0 && sa.term, 'students, classes and a current term');

  const teacherId = (await one<{ employee_id: number }>("SELECT s.employee_id FROM approval_user_setup s JOIN app_user u ON u.id = s.user_id WHERE u.username = 'teacher'"))!.employee_id;
  const t = await roleCentersLib.getTeacherRoleCenter(teacherId);
  assert.ok(t.classes.length > 0 && t.term, 'the demo teacher has classes this term');

  const fm = await roleCentersLib.getFinanceManagerRoleCenter();
  assert.ok(fm.pl.length === 12 && fm.ratios.length === 4 && Number.isFinite(fm.ratios[0].value));

  const acc = await roleCentersLib.getAccountantRoleCenter();
  assert.ok(typeof acc.kpi.balanced === 'boolean' && acc.journalsByMonth.length === 12);
});

section('Per-user permission overrides');

const userPermsLib = await import('../lib/userPermissions.ts');

await test('a DENY override removes a right the role grants', async () => {
  const subject = (await one<{ id: number }>("SELECT id FROM app_user WHERE username='bursar'"))!;
  await userPermsLib.resetUserPermissions(subject.id, admin);

  const before = await sessionFor(subject.id);
  assert.ok(permissions.canPage(before, 'CASH_MGMT'), 'Bursar role grants the cash office');
  assert.ok(permissions.canAction(before, 'CASH_MGMT_RECEIPT_CREATE'));

  await userPermsLib.setUserPermissions(subject.id, [
    { objectType: 'PAGE', objectName: 'CASH_MGMT', rights: { execute: false } },
  ], admin);

  const after = await sessionFor(subject.id);
  assert.ok(!permissions.canPage(after, 'CASH_MGMT'), 'the override hides the screen');
  assert.ok(!permissions.canAction(after, 'CASH_MGMT_RECEIPT_CREATE'), 'and every action behind it');
  await userPermsLib.resetUserPermissions(subject.id, admin);
});

await test('a GRANT override adds a right the role lacks', async () => {
  const subject = (await one<{ id: number }>("SELECT id FROM app_user WHERE username='teacher'"))!;
  const before = await sessionFor(subject.id);
  assert.ok(!permissions.canAction(before, 'GL_READ'), 'the test role has no general-ledger access');

  await userPermsLib.setUserPermissions(subject.id, [
    { objectType: 'PAGE', objectName: 'GL', rights: { execute: true } },
    { objectType: 'TABLE', objectName: 'journal', rights: { read: true } },
    { objectType: 'TABLE', objectName: 'journal_line', rights: { read: true } },
    { objectType: 'TABLE', objectName: 'gl_account', rights: { read: true } },
  ], admin);

  const after = await sessionFor(subject.id);
  assert.ok(permissions.canAction(after, 'GL_READ'), 'the override grants it');
  await userPermsLib.resetUserPermissions(subject.id, admin);
});

await test('an additional Permission Set is unioned into the effective rights (BC model)', async () => {
  const subject = (await one<{ id: number }>("SELECT id FROM app_user WHERE username='teacher'"))!;
  const financeRole = (await one<{ id: number }>("SELECT id FROM role WHERE name='Accountant'"))!;
  await userPermsLib.setUserPermissionSets(subject.id, [], admin);

  const before = await sessionFor(subject.id);
  assert.ok(!permissions.canAction(before, 'GL_READ') && permissions.canAction(before, 'TEACHER_PORTAL_VIEW'));

  await userPermsLib.setUserPermissionSets(subject.id, [financeRole.id], admin);
  const after = await sessionFor(subject.id);
  assert.ok(permissions.canAction(after, 'GL_READ'), 'Accountant rights are added…');
  assert.ok(permissions.canAction(after, 'TEACHER_PORTAL_VIEW'), '…without losing the Teacher rights (union)');

  assert.deepStrictEqual(
    [...(await userPermsLib.listUserPermissionSets(subject.id)).map((s) => s.name)],
    ['Accountant'],
  );
  await userPermsLib.setUserPermissionSets(subject.id, [], admin);
});

await test('two users on the same role differ only by their overrides', async () => {
  const [a, b] = await all<{ id: number; role_id: number }>(
    "SELECT id, role_id FROM app_user WHERE username IN ('bursar','hr') ORDER BY username",
  );
  // Put both on the Bursar role for the test.
  const bursarRole = (await one<{ id: number }>("SELECT id FROM role WHERE name='Bursar'"))!;
  await run('UPDATE app_user SET role_id = ? WHERE id IN (?,?)', bursarRole.id, a.id, b.id);
  await userPermsLib.resetUserPermissions(a.id, admin);
  await userPermsLib.resetUserPermissions(b.id, admin);

  await userPermsLib.setUserPermissions(a.id, [
    { objectType: 'TABLE', objectName: 'receipt_header', rights: { read: true } }, // strip insert/modify
  ], admin);

  const sa = await sessionFor(a.id);
  const sb = await sessionFor(b.id);
  assert.notDeepStrictEqual(sa.permissionSet.tables.receipt_header, sb.permissionSet.tables.receipt_header);
  const roleSet = await auth.loadPermissionSet(bursarRole.id);
  assert.deepStrictEqual(sb.permissionSet.tables, roleSet.tables, 'the un-overridden user matches the role exactly');

  await userPermsLib.resetUserPermissions(a.id, admin);
  await run('UPDATE app_user SET role_id = ? WHERE id = ?', b.role_id, b.id);
  await run('UPDATE app_user SET role_id = ? WHERE id = ?', a.role_id, a.id);
});

await test('an override equal to the role default is not stored', async () => {
  const subject = (await one<{ id: number }>("SELECT id FROM app_user WHERE username='bursar'"))!;
  const roleSet = await auth.loadPermissionSet(
    (await one<{ role_id: number }>('SELECT role_id FROM app_user WHERE id = ?', subject.id))!.role_id,
  );
  const t = roleSet.tables.receipt_header!;
  await userPermsLib.setUserPermissions(subject.id, [
    { objectType: 'TABLE', objectName: 'receipt_header', rights: { ...t, execute: false } },
  ], admin);
  const n = await one<{ n: number }>('SELECT COUNT(*) n FROM user_permission_line WHERE user_id = ?', subject.id);
  assert.strictEqual(Number(n?.n ?? 0), 0, 'a no-op override writes no row');
});

await test('a nav entry is hidden when the page is reachable but its data is not readable', async () => {
  // A permission set that grants the STUDENTS page Execute but NOT `student` table Read — the classic
  // way a hand-edited matrix leaves a module in the sidebar the user cannot actually use.
  const subject = (await one<{ id: number }>("SELECT id FROM app_user WHERE username='bursar'"))!;
  const rid = Number((await run(
    "INSERT INTO role (name, description, is_system) VALUES ('ZZ Nav Test', 't', 0)",
  )).lastInsertRowid);
  await run("INSERT INTO permission_set_line (role_id, object_type, object_name, execute_perm) VALUES (?, 'PAGE', 'DASHBOARD', 1)", rid);
  await run("INSERT INTO permission_set_line (role_id, object_type, object_name, execute_perm) VALUES (?, 'PAGE', 'STUDENTS', 1)", rid);
  const orig = (await one<{ role_id: number }>('SELECT role_id FROM app_user WHERE id = ?', subject.id))!.role_id;
  await run('UPDATE app_user SET role_id = ? WHERE id = ?', rid, subject.id);
  await userPermsLib.resetUserPermissions(subject.id, admin);
  await userPermsLib.setUserPermissionSets(subject.id, [], admin);

  const tok = `nv-${Date.now()}`;
  await run('INSERT INTO session (token, user_id, created_at, expires_at) VALUES (?,?,?,?)',
    tok, subject.id, new Date().toISOString(), new Date(Date.now() + 3_600_000).toISOString());
  const su = (await auth.userFromToken(tok))!;
  await run('DELETE FROM session WHERE token = ?', tok);

  assert.ok(permissions.canPage(su as SessionUser, 'STUDENTS'), 'the page shell is reachable');
  assert.ok(!permissions.canNav(su as SessionUser, 'STUDENTS'), 'but the nav entry is hidden — no student read');
  assert.ok(permissions.canNav(su as SessionUser, 'DASHBOARD'), 'the dashboard entry still shows');

  await run('UPDATE app_user SET role_id = ? WHERE id = ?', orig, subject.id);
  await run('DELETE FROM role WHERE id = ?', rid);
});

await test('the System Administrator cannot be restricted by an override', async () => {
  const adminUser = (await one<{ id: number }>("SELECT id FROM app_user WHERE username='admin'"))!;
  // Even a raw override row must not restrict a system user.
  await run(
    `INSERT INTO user_permission_line (user_id, object_type, object_name, execute_perm)
     VALUES (?, 'PAGE', 'GL', 0) ON CONFLICT (user_id, object_type, object_name) DO NOTHING`,
    adminUser.id,
  );
  const su = await sessionFor(adminUser.id);
  assert.ok(permissions.canPage(su, 'GL') && permissions.canAction(su, 'GL_JOURNAL_APPROVE'),
    'is_system short-circuits every check');
  const matrix = await userPermsLib.getUserPermissionMatrix(adminUser.id);
  assert.strictEqual(matrix.isSystem, true);
  await throws(() => userPermsLib.setUserPermissions(adminUser.id, [], admin), /SYSTEM_USER/);
  await run('DELETE FROM user_permission_line WHERE user_id = ?', adminUser.id);
});

/* ------------------------------------------------------------------------ */
console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${pass} passed, ${fail} failed\x1b[0m\n`);
process.exit(fail ? 1 : 0);