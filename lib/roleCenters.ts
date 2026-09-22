/*
 * Role Centre analytics.
 *
 * One aggregate per Role Centre, each a composition of the reused report helpers (lib/reports.ts,
 * lib/financialReports.ts, lib/gl.ts, lib/receivablesReports.ts, lib/payablesReports.ts) plus a
 * few focused queries for the trend series. All money is integer cents.
 *
 * These functions do NOT check permissions — the Role Centre page renders each widget only when
 * the viewer's permission set grants the underlying right (currentCanAction / currentCanPage),
 * so a profile without permission shows locked cards.
 */
import { one, all } from './db.ts';
import { trialBalance } from './accounting.ts';
import { getIncomeStatement, getBalanceSheet } from './reports.ts';
import { today } from './format.ts';
import { addMonths } from './dates.ts';
import type { Cents, IsoDate } from './types.ts';

/* ------------------------------------------------------------------- shared */

/** The last `n` calendar months as `YYYY-MM`, oldest first (includes the current month). */
export function recentMonths(n = 12): string[] {
  const base = `${today().slice(0, 8)}01`;
  return Array.from({ length: n }, (_, i) => addMonths(base, -(n - 1 - i)).slice(0, 7));
}

export interface MonthPoint { month: string; [k: string]: string | number }

/* ---------------------------------------------------------- Finance Manager */

export interface FinanceManagerRoleCenter {
  kpi: { surplus: Cents; income: Cents; expense: Cents; cash: Cents; feesOutstanding: Cents; feesOverdue: Cents };
  pl: { month: string; income: Cents; expense: Cents; surplus: Cents }[];
  incomeMix: { name: string; amount: Cents }[];
  expenseMix: { name: string; amount: Cents }[];
  balanceSheet: { assets: Cents; liabilities: Cents; equity: Cents; surplus: Cents; balanced: boolean };
  ratios: { label: string; value: number; threshold: number; higherIsWorse?: boolean }[];
  approvals: { type: string; count: number }[];
}

export async function getFinanceManagerRoleCenter(): Promise<FinanceManagerRoleCenter> {
  const yearStart = `${today().slice(0, 4)}-01-01`;
  const months = recentMonths(12);
  const [cash, fees, is, bs, monthlyPl, approvals] = await Promise.all([
    one<{ n: Cents }>(`SELECT COALESCE(SUM(balance), 0) AS n FROM bank_account WHERE status = 'ACTIVE'`),
    one<{ invoiced: Cents; collected: Cents; outstanding: Cents; overdue: Cents }>(
      `SELECT COALESCE(SUM(CASE WHEN cle.document_type = 'Invoice' AND cle.posting_date >= @ys THEN cle.amount_lcy ELSE 0 END), 0) AS invoiced,
              COALESCE(SUM(CASE WHEN cle.document_type = 'Payment' AND cle.posting_date >= @ys THEN -cle.amount_lcy ELSE 0 END), 0) AS collected,
              COALESCE(SUM(CASE WHEN cle.open = 1 THEN cle.remaining_amount_lcy ELSE 0 END), 0) AS outstanding,
              COALESCE(SUM(CASE WHEN cle.open = 1 AND cle.positive = 1 AND cle.due_date < @today THEN cle.remaining_amount_lcy ELSE 0 END), 0) AS overdue
       FROM cust_ledger_entry cle JOIN student s ON s.customer_id = cle.customer_id`,
      { ys: yearStart, today: today() },
    ),
    getIncomeStatement({ from: yearStart, to: today() }),
    getBalanceSheet({ asOf: today() }),
    all<{ month: string; income: Cents; expense: Cents }>(
      `SELECT substr(j.value_date,1,7) AS month,
              COALESCE(SUM(CASE WHEN a.type='INCOME' THEN jl.credit_lcy - jl.debit_lcy ELSE 0 END),0) income,
              COALESCE(SUM(CASE WHEN a.type='EXPENSE' THEN jl.debit_lcy - jl.credit_lcy ELSE 0 END),0) expense
       FROM journal_line jl JOIN journal j ON j.id = jl.journal_id JOIN gl_account a ON a.id = jl.gl_account_id
       WHERE a.type IN ('INCOME','EXPENSE') AND j.value_date >= @from AND j.closing_entry = 0
       GROUP BY month`,
      { from: `${months[0]}-01` },
    ),
    all<{ document_type: string; n: number }>(
      "SELECT document_type, COUNT(*) n FROM workflow_task WHERE status='PENDING' GROUP BY document_type ORDER BY n DESC",
    ).catch(() => []),
  ]);

  const byMonth = new Map(monthlyPl.map((r) => [r.month, r]));
  const pl = months.map((m) => {
    const r = byMonth.get(m) ?? { income: 0, expense: 0 };
    return { month: m, income: r.income, expense: r.expense, surplus: r.income - r.expense };
  });

  const invoiced = Number(fees?.invoiced ?? 0);
  const collected = Number(fees?.collected ?? 0);
  const outstanding = Number(fees?.outstanding ?? 0);
  const overdue = Number(fees?.overdue ?? 0);
  const pct = (num: number, den: number): number => (den ? Number(((num / den) * 100).toFixed(1)) : 0);

  return {
    kpi: {
      surplus: is.surplus,
      income: is.totalIncome,
      expense: is.totalExpense,
      cash: Number(cash?.n ?? 0),
      feesOutstanding: outstanding,
      feesOverdue: overdue,
    },
    pl,
    incomeMix: is.income.filter((r) => r.amount !== 0).slice(0, 6).map((r) => ({ name: r.name, amount: r.amount })),
    expenseMix: is.expense.filter((r) => r.amount !== 0).slice(0, 6).map((r) => ({ name: r.name, amount: r.amount })),
    balanceSheet: {
      assets: bs.totals.assets, liabilities: bs.totals.liabilities, equity: bs.totals.equity,
      surplus: bs.surplus, balanced: bs.balanced,
    },
    ratios: [
      { label: 'Fee collection rate (YTD)', value: pct(collected, invoiced), threshold: 90 },
      { label: 'Fees overdue / outstanding', value: pct(overdue, outstanding), threshold: 20, higherIsWorse: true },
      { label: 'Expenditure / income (YTD)', value: pct(is.totalExpense, is.totalIncome), threshold: 95, higherIsWorse: true },
      { label: 'Cash cover of overdue fees', value: pct(Number(cash?.n ?? 0), overdue || 1), threshold: 100 },
    ],
    approvals: approvals.map((r) => ({ type: humaniseDoc(r.document_type), count: Number(r.n) })),
  };
}

function humaniseDoc(t: string): string {
  return String(t || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ----------------------------------------------------------------- Accountant */

export interface AccountantRoleCenter {
  kpi: { balanced: boolean; outOfBalanceBy: Cents; draftJournals: number; journalsThisMonth: number; agedArTotal: Cents; agedApTotal: Cents };
  journalsByMonth: { month: string; journals: number; amount: Cents }[];
  bySource: { name: string; amount: Cents; entries: number }[];
  bankRec: { name: string; glBalance: Cents; lastReconciled: IsoDate | null; status: string }[];
  tax: { vatInput: Cents; whtWithheld: Cents };
}

export async function getAccountantRoleCenter(): Promise<AccountantRoleCenter> {
  const months = recentMonths(12);
  const ym = today().slice(0, 7);
  const yearStart = `${today().slice(0, 4)}-01-01`;
  const [tb, drafts, thisMonth, jByMonth, bySource, banks, vat, wht] = await Promise.all([
    trialBalance(),
    one<{ n: number }>("SELECT COUNT(*) n FROM journal WHERE COALESCE(status,'POSTED') NOT IN ('POSTED','REVERSED')").catch(() => ({ n: 0 })),
    one<{ n: number }>('SELECT COUNT(*) n FROM journal WHERE substr(value_date,1,7) = @ym', { ym }),
    all<{ month: string; n: number; amt: Cents }>(
      `SELECT substr(value_date,1,7) AS month, COUNT(*) n, COALESCE(SUM(amount),0) amt
       FROM journal WHERE value_date >= @from AND closing_entry = 0 GROUP BY month`,
      { from: `${months[0]}-01` },
    ),
    all<{ source_module: string; amt: Cents; n: number }>(
      `SELECT COALESCE(source_module,'GL') AS source_module, COALESCE(SUM(amount),0) amt, COUNT(*) n
       FROM journal WHERE value_date >= @ys AND closing_entry = 0 GROUP BY source_module ORDER BY amt DESC`,
      { ys: yearStart },
    ),
    all<{ name: string; balance: Cents; last_reconciled: IsoDate | null }>(
      `SELECT ba.name, ba.balance,
              (SELECT MAX(br.statement_date) FROM bank_reconciliation br
               WHERE br.bank_account_id = ba.id AND br.status = 'POSTED') AS last_reconciled
       FROM bank_account ba WHERE ba.status='ACTIVE' ORDER BY ba.name`,
    ).catch(() => []),
    one<{ v: Cents }>(
      "SELECT COALESCE(SUM(amount),0) v FROM vat_entry WHERE tax_type='VAT' AND type='Purchase' AND posting_date >= @ys",
      { ys: yearStart },
    ).catch(() => ({ v: 0 })),
    one<{ v: Cents }>(
      "SELECT COALESCE(SUM(amount),0) v FROM vat_entry WHERE tax_type='WHT' AND posting_date >= @ys",
      { ys: yearStart },
    ).catch(() => ({ v: 0 })),
  ]);

  const totals = tb.reduce((a, r) => ({ d: a.d + r.debit_balance, c: a.c + r.credit_balance }), { d: 0, c: 0 });
  const arAp = await Promise.all([
    import('./receivablesReports.ts').then((m) => m.getAgedAccountsReceivable({ asOf: today() })).catch(() => null),
    import('./payablesReports.ts').then((m) => m.getAgedAccountsPayable({ asOf: today() })).catch(() => null),
  ]);
  const agedArTotal = sumAgedBalance(arAp[0]);
  const agedApTotal = sumAgedBalance(arAp[1]);

  const jMap = new Map(jByMonth.map((r) => [r.month, r]));
  const daysSince = (d: IsoDate | null): number =>
    d ? Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000) : 9999;

  return {
    kpi: {
      balanced: totals.d === totals.c,
      outOfBalanceBy: Math.abs(totals.d - totals.c),
      draftJournals: Number(drafts?.n ?? 0),
      journalsThisMonth: Number(thisMonth?.n ?? 0),
      agedArTotal,
      agedApTotal,
    },
    journalsByMonth: months.map((m) => {
      const r = jMap.get(m);
      return { month: m, journals: Number(r?.n ?? 0), amount: Number(r?.amt ?? 0) };
    }),
    bySource: bySource.slice(0, 7).map((r) => ({ name: humaniseDoc(r.source_module), amount: r.amt, entries: Number(r.n) })),
    bankRec: banks.map((b) => ({
      name: b.name, glBalance: b.balance, lastReconciled: b.last_reconciled,
      status: daysSince(b.last_reconciled) <= 35 ? 'Current' : daysSince(b.last_reconciled) >= 9999 ? 'Never' : 'Overdue',
    })),
    tax: { vatInput: Number(vat?.v ?? 0), whtWithheld: Number(wht?.v ?? 0) },
  };
}

function sumAgedBalance(report: unknown): Cents {
  const r = report as { totals?: { balance?: number }; rows?: { balance?: number }[] } | null;
  if (r?.totals && typeof r.totals.balance === 'number') return r.totals.balance;
  if (!Array.isArray(r?.rows)) return 0;
  return r.rows.reduce((a, x) => a + (Number(x.balance) || 0), 0);
}

/* -------------------------------------------------------------------- HR & Payroll */

export interface HrPayrollRoleCenter {
  kpi: {
    headcountActive: number; headcountNew: number; headcountPendingApproval: number;
    pendingApprovals: number; leaveApplicationsPending: number; payrollPeriodStatus: string | null;
    lastNetPay: Cents;
  };
  headcountByDepartment: { name: string; count: number }[];
  upcomingLeave: { employeeName: string; leaveType: string; startDate: IsoDate }[];
  probationEnding: { employeeName: string; endDate: IsoDate }[];
  contractsExpiring: { employeeName: string; endDate: IsoDate }[];
}

export async function getHrPayrollRoleCenter(): Promise<HrPayrollRoleCenter> {
  const t = today();
  const in30 = addMonths(t, 1);
  const [
    active, newCount, pendingApprovalCount, byDept, pendingApprovalsTotal, leaveApps, openPeriod,
    lastPeriodNetPay, probation, contracts, upcomingLeave,
  ] = await Promise.all([
    one<{ n: number }>("SELECT COUNT(*) n FROM employee WHERE status IN ('ACTIVE','ON_LEAVE')").catch(() => ({ n: 0 })),
    one<{ n: number }>("SELECT COUNT(*) n FROM employee WHERE status = 'NEW'").catch(() => ({ n: 0 })),
    one<{ n: number }>("SELECT COUNT(*) n FROM employee WHERE status = 'PENDING_APPROVAL'").catch(() => ({ n: 0 })),
    all<{ name: string; n: number }>(
      `SELECT COALESCE(gd2.name, 'Unassigned') AS name, COUNT(*) AS n FROM employee e
       LEFT JOIN global_dimension_2_value gd2 ON gd2.id = e.global_dimension_2_id
       WHERE e.status IN ('ACTIVE','ON_LEAVE') GROUP BY gd2.name ORDER BY n DESC LIMIT 8`,
    ).catch(() => []),
    one<{ n: number }>(
      `SELECT
         (SELECT COUNT(*) FROM employee WHERE status = 'PENDING_APPROVAL')
         + (SELECT COUNT(*) FROM employee_edit_request WHERE status = 'Pending Approval')
         + (SELECT COUNT(*) FROM employee_exit WHERE status = 'Pending Approval')
         + (SELECT COUNT(*) FROM employee_contract_change WHERE status = 'Pending Approval')
         + (SELECT COUNT(*) FROM hr_leave_application WHERE status = 'Pending Approval')
         + (SELECT COUNT(*) FROM hr_leave_adjustment WHERE status = 'Pending Approval')
         + (SELECT COUNT(*) FROM hr_leave_recall WHERE status = 'Pending Approval')
         + (SELECT COUNT(*) FROM hr_leave_plan WHERE status = 'Pending Approval')
         + (SELECT COUNT(*) FROM payroll_period WHERE status = 'PENDING_APPROVAL')
         AS n`,
    ).catch(() => ({ n: 0 })),
    one<{ n: number }>("SELECT COUNT(*) n FROM hr_leave_application WHERE status = 'Pending Approval'").catch(() => ({ n: 0 })),
    one<{ status: string }>("SELECT status FROM payroll_period WHERE status IN ('OPEN','PENDING_APPROVAL','APPROVED') ORDER BY start_date DESC LIMIT 1").catch(() => undefined),
    one<{ v: number }>(
      `SELECT COALESCE(SUM(l.amount_cents), 0) AS v FROM payroll_period_transaction l
       WHERE l.transaction_code = 'NPAY' AND l.payroll_period_id = (SELECT id FROM payroll_period ORDER BY start_date DESC LIMIT 1)`,
    ).catch(() => ({ v: 0 })),
    all<{ name: string; probation_end_date: string }>(
      `SELECT (first_name || ' ' || last_name) AS name, probation_end_date FROM employee
       WHERE status IN ('ACTIVE') AND probation_status = 'ON_PROBATION' AND probation_end_date IS NOT NULL AND probation_end_date <= @d
       ORDER BY probation_end_date LIMIT 8`,
      { d: in30 },
    ).catch(() => []),
    all<{ name: string; end_date: string }>(
      `SELECT (e.first_name || ' ' || e.last_name) AS name, c.end_date FROM employee_contract c
       JOIN employee e ON e.id = c.employee_id
       WHERE c.is_current = true AND c.end_date IS NOT NULL AND c.end_date <= @d AND e.status IN ('ACTIVE','ON_LEAVE')
       ORDER BY c.end_date LIMIT 8`,
      { d: in30 },
    ).catch(() => []),
    all<{ name: string; leave_type: string; start_date: string }>(
      `SELECT (e.first_name || ' ' || e.last_name) AS name, lt.name AS leave_type, a.start_date FROM hr_leave_application a
       JOIN employee e ON e.id = a.employee_id JOIN hr_leave_type lt ON lt.id = a.leave_type_id
       WHERE a.status = 'Approved' AND a.start_date >= @t AND a.start_date <= @d
       ORDER BY a.start_date LIMIT 8`,
      { t, d: in30 },
    ).catch(() => []),
  ]);

  return {
    kpi: {
      headcountActive: Number(active?.n ?? 0), headcountNew: Number(newCount?.n ?? 0),
      headcountPendingApproval: Number(pendingApprovalCount?.n ?? 0),
      pendingApprovals: Number(pendingApprovalsTotal?.n ?? 0),
      leaveApplicationsPending: Number(leaveApps?.n ?? 0),
      payrollPeriodStatus: openPeriod?.status ?? null,
      lastNetPay: Number(lastPeriodNetPay?.v ?? 0),
    },
    headcountByDepartment: byDept.map((d) => ({ name: d.name, count: Number(d.n) })),
    upcomingLeave: upcomingLeave.map((r) => ({ employeeName: r.name, leaveType: r.leave_type, startDate: r.start_date })),
    probationEnding: probation.map((r) => ({ employeeName: r.name, endDate: r.probation_end_date })),
    contractsExpiring: contracts.map((r) => ({ employeeName: r.name, endDate: r.end_date })),
  };
}

/* ---------------------------------------------------------------- School Administration */

export interface SchoolAdminRoleCenter {
  kpi: { students: number; boys: number; girls: number; classes: number; teachers: number; unplaced: number; pendingApprovals: number };
  term: { id: number; name: string; year: string; start_date: IsoDate; end_date: IsoDate; daysLeft: number } | null;
  attendanceToday: { present: number; absent: number; late: number; excused: number; total: number; rate: number } | null;
  attendanceTrend: { date: IsoDate; rate: number }[];
  enrolmentByGrade: { grade: string; students: number }[];
  classesWithoutRegister: { stream_id: number; name: string; students: number }[];
  marksProgress: { subject: string; entered: number; expected: number }[];
  admissionsByMonth: { month: string; admitted: number }[];
}

export async function getSchoolAdminRoleCenter(): Promise<SchoolAdminRoleCenter> {
  const todayIso = today();
  const months = recentMonths(12);
  const [counts, term, att, trend, byGrade, admissions, approvals] = await Promise.all([
    one<{ students: number; boys: number; girls: number; classes: number; teachers: number; unplaced: number }>(
      `SELECT (SELECT COUNT(*)::int FROM student WHERE status = 'ACTIVE') AS students,
              (SELECT COUNT(*)::int FROM student WHERE status = 'ACTIVE' AND gender = 'MALE') AS boys,
              (SELECT COUNT(*)::int FROM student WHERE status = 'ACTIVE' AND gender = 'FEMALE') AS girls,
              (SELECT COUNT(*)::int FROM stream s JOIN academic_year y ON y.id = s.academic_year_id WHERE y.is_current) AS classes,
              (SELECT COUNT(*)::int FROM teacher_profile tp JOIN employee e ON e.id = tp.employee_id WHERE e.status IN ('ACTIVE', 'ON_LEAVE')) AS teachers,
              (SELECT COUNT(*)::int FROM student WHERE status = 'ACTIVE' AND current_stream_id IS NULL) AS unplaced`,
    ),
    one<{ id: number; name: string; year: string; start_date: IsoDate; end_date: IsoDate }>(
      `SELECT t.id, t.name, y.name AS year, t.start_date, t.end_date FROM academic_term t JOIN academic_year y ON y.id = t.academic_year_id WHERE t.is_current LIMIT 1`,
    ),
    one<{ present: number; absent: number; late: number; excused: number }>(
      `SELECT COALESCE(SUM(CASE WHEN status = 'PRESENT' THEN 1 ELSE 0 END), 0)::int AS present, COALESCE(SUM(CASE WHEN status = 'ABSENT' THEN 1 ELSE 0 END), 0)::int AS absent,
              COALESCE(SUM(CASE WHEN status = 'LATE' THEN 1 ELSE 0 END), 0)::int AS late, COALESCE(SUM(CASE WHEN status = 'EXCUSED' THEN 1 ELSE 0 END), 0)::int AS excused
       FROM attendance_record WHERE date = ?`, todayIso,
    ),
    all<{ date: IsoDate; rate: number }>(
      `SELECT date, ROUND(100.0 * SUM(CASE WHEN status IN ('PRESENT', 'LATE') THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1) AS rate
       FROM attendance_record WHERE date >= ? GROUP BY date ORDER BY date`, addMonths(todayIso, -1),
    ),
    all<{ grade: string; students: number }>(
      `SELECT g.name AS grade, COUNT(s.id)::int AS students FROM grade_level g JOIN education_level el ON el.id = g.education_level_id
       LEFT JOIN student s ON s.current_grade_level_id = g.id AND s.status = 'ACTIVE' GROUP BY g.id, g.name, el.sort, g.sort ORDER BY el.sort, g.sort`,
    ),
    all<{ month: string; admitted: number }>(
      `SELECT substr(admission_date, 1, 7) AS month, COUNT(*)::int AS admitted FROM student WHERE admission_date >= @from GROUP BY month`, { from: `${months[0]}-01` },
    ),
    one<{ n: number }>("SELECT COUNT(*)::int AS n FROM workflow_task WHERE status = 'PENDING'").catch(() => ({ n: 0 })),
  ]);
  const attTotal = att ? att.present + att.absent + att.late + att.excused : 0;
  const isSchoolDay = [1, 2, 3, 4, 5].includes(new Date(`${todayIso}T00:00:00Z`).getUTCDay());
  const [noRegister, marks] = await Promise.all([
    isSchoolDay ? all<{ stream_id: number; name: string; students: number }>(
      `SELECT s.id AS stream_id, g.name || ' ' || s.name AS name, (SELECT COUNT(*)::int FROM student st WHERE st.current_stream_id = s.id AND st.status = 'ACTIVE') AS students
       FROM stream s JOIN grade_level g ON g.id = s.grade_level_id JOIN academic_year y ON y.id = s.academic_year_id JOIN education_level el ON el.id = g.education_level_id
       WHERE y.is_current AND NOT EXISTS (SELECT 1 FROM attendance_record ar WHERE ar.stream_id = s.id AND ar.date = ?)
       ORDER BY el.sort, g.sort, s.name`, todayIso,
    ) : Promise.resolve([]),
    term ? all<{ subject: string; entered: number; expected: number }>(
      `SELECT sub.name AS subject,
              (SELECT COUNT(*)::int FROM assessment_record ar WHERE ar.subject_id = sub.id AND ar.term_id = @term) AS entered,
              (SELECT COUNT(*)::int FROM student st JOIN subject_offering so ON so.grade_level_id = st.current_grade_level_id AND so.subject_id = sub.id WHERE st.status = 'ACTIVE')
                * (SELECT COUNT(*)::int FROM assessment_type) AS expected
       FROM subject sub WHERE sub.status = 'ACTIVE' ORDER BY sub.name`, { term: term.id },
    ) : Promise.resolve([]),
  ]);
  const admMap = new Map(admissions.map((r) => [r.month, Number(r.admitted)]));
  return {
    kpi: { ...counts!, pendingApprovals: Number(approvals?.n ?? 0) },
    term: term ? { ...term, daysLeft: Math.max(0, Math.ceil((new Date(term.end_date).getTime() - new Date(todayIso).getTime()) / 86_400_000)) } : null,
    attendanceToday: attTotal ? { ...att!, total: attTotal, rate: Number((((att!.present + att!.late) / attTotal) * 100).toFixed(1)) } : null,
    attendanceTrend: trend.map((t) => ({ date: t.date, rate: Number(t.rate) })),
    enrolmentByGrade: byGrade,
    classesWithoutRegister: noRegister,
    marksProgress: marks.filter((m) => Number(m.expected) > 0).map((m) => ({ subject: m.subject, entered: Number(m.entered), expected: Number(m.expected) })),
    admissionsByMonth: months.map((m) => ({ month: m, admitted: admMap.get(m) ?? 0 })),
  };
}

/* ---------------------------------------------------------------- Teacher */

export interface TeacherRoleCenter {
  term: { id: number; name: string; year: string; start_date: IsoDate; end_date: IsoDate } | null;
  classTeacherOf: { stream_id: number; name: string; students: number; registerTakenToday: boolean }[];
  classes: { stream_id: number; subject_id: number; name: string; subject: string; students: number; marksEntered: number; marksExpected: number }[];
  today: { start_time: string; end_time: string; subject: string; stream: string; room: string | null }[];
  attendanceThisWeek: { present: number; absent: number; late: number; excused: number; total: number; rate: number } | null;
}

export async function getTeacherRoleCenter(teacherId: number): Promise<TeacherRoleCenter> {
  const todayIso = today();
  const dow = new Date(`${todayIso}T00:00:00Z`).getUTCDay();
  const term = await one<{ id: number; name: string; year: string; start_date: IsoDate; end_date: IsoDate }>(
    `SELECT t.id, t.name, y.name AS year, t.start_date, t.end_date FROM academic_term t JOIN academic_year y ON y.id = t.academic_year_id WHERE t.is_current LIMIT 1`,
  );
  const weekStart = new Date(`${todayIso}T00:00:00Z`); weekStart.setUTCDate(weekStart.getUTCDate() - ((dow + 6) % 7));
  const [classTeacherOf, classes, todaySlots, week] = await Promise.all([
    all<{ stream_id: number; name: string; students: number; taken: boolean }>(
      `SELECT s.id AS stream_id, g.name || ' ' || s.name AS name, (SELECT COUNT(*)::int FROM student st WHERE st.current_stream_id = s.id AND st.status = 'ACTIVE') AS students,
              EXISTS (SELECT 1 FROM attendance_record ar WHERE ar.stream_id = s.id AND ar.date = ?) AS taken
       FROM stream s JOIN grade_level g ON g.id = s.grade_level_id JOIN academic_year y ON y.id = s.academic_year_id WHERE y.is_current AND s.class_teacher_id = ? ORDER BY g.sort, s.name`,
      todayIso, teacherId,
    ),
    all<{ stream_id: number; subject_id: number; name: string; subject: string; students: number; entered: number; expected: number }>(
      `SELECT s.id AS stream_id, sub.id AS subject_id, g.name || ' ' || s.name AS name, sub.name AS subject,
              (SELECT COUNT(*)::int FROM student st WHERE st.current_stream_id = s.id AND st.status = 'ACTIVE') AS students,
              (SELECT COUNT(*)::int FROM assessment_record ar JOIN student st ON st.id = ar.student_id WHERE st.current_stream_id = s.id AND ar.subject_id = sub.id AND ar.term_id = @term) AS entered,
              (SELECT COUNT(*)::int FROM student st WHERE st.current_stream_id = s.id AND st.status = 'ACTIVE') * (SELECT COUNT(*)::int FROM assessment_type) AS expected
       FROM teacher_subject_assignment a JOIN stream s ON s.id = a.stream_id JOIN grade_level g ON g.id = s.grade_level_id JOIN subject sub ON sub.id = a.subject_id JOIN academic_year y ON y.id = a.academic_year_id
       WHERE a.teacher_id = @teacher AND y.is_current ORDER BY g.sort, s.name, sub.name`, { teacher: teacherId, term: term?.id ?? -1 },
    ),
    term ? all<{ start_time: string; end_time: string; subject: string; stream: string; room: string | null }>(
      `SELECT ts.start_time, ts.end_time, sub.name AS subject, g.name || ' ' || s.name AS stream, ts.room
       FROM timetable_slot ts JOIN subject sub ON sub.id = ts.subject_id JOIN stream s ON s.id = ts.stream_id JOIN grade_level g ON g.id = s.grade_level_id
       WHERE ts.teacher_id = ? AND ts.term_id = ? AND ts.day_of_week = ? ORDER BY ts.start_time`, teacherId, term.id, dow,
    ) : Promise.resolve([]),
    one<{ present: number; absent: number; late: number; excused: number }>(
      `SELECT COALESCE(SUM(CASE WHEN ar.status = 'PRESENT' THEN 1 ELSE 0 END), 0)::int AS present, COALESCE(SUM(CASE WHEN ar.status = 'ABSENT' THEN 1 ELSE 0 END), 0)::int AS absent,
              COALESCE(SUM(CASE WHEN ar.status = 'LATE' THEN 1 ELSE 0 END), 0)::int AS late, COALESCE(SUM(CASE WHEN ar.status = 'EXCUSED' THEN 1 ELSE 0 END), 0)::int AS excused
       FROM attendance_record ar JOIN stream s ON s.id = ar.stream_id WHERE s.class_teacher_id = ? AND ar.date >= ?`, teacherId, weekStart.toISOString().slice(0, 10),
    ),
  ]);
  const wt = week ? week.present + week.absent + week.late + week.excused : 0;
  return {
    term: term ?? null,
    classTeacherOf: classTeacherOf.map((c) => ({ stream_id: c.stream_id, name: c.name, students: Number(c.students), registerTakenToday: !!c.taken })),
    classes: classes.map((c) => ({ stream_id: c.stream_id, subject_id: c.subject_id, name: c.name, subject: c.subject, students: Number(c.students), marksEntered: Number(c.entered), marksExpected: Number(c.expected) })),
    today: todaySlots,
    attendanceThisWeek: wt ? { ...week!, total: wt, rate: Number((((week!.present + week!.late) / wt) * 100).toFixed(1)) } : null,
  };
}
