import { one, all } from './db.ts';
import { journalDateWindowSql } from './accounting.ts';
import { getTrialBalance, resolveDimensionFilterIds, TRIAL_BALANCE_FILTER_FIELDS } from './gl.ts';
import { myPendingWorkflowTaskCount } from './workflow.ts';
import { buildFilterClause, type FilterCondition } from './listFilters.ts';
import type {
  AttendanceSummary, BalanceSheet, Cents, DashboardData, IncomeStatement, IsoDate, ReportLine,
} from './types.ts';

/**
 * The Super Role Centre's tiles. Every figure comes from the ledgers the modules already keep —
 * the fee numbers are the customer ledger (a student's fee account is a Receivables customer),
 * cash is the bank/cashbook accounts, income and expense are the G/L account types — so the
 * dashboard cannot disagree with the reports.
 */
export async function getDashboard(userId: number, username: string): Promise<DashboardData> {
  const todayIso = new Date().toISOString().slice(0, 10);
  const [students, teachers, streams, currentTerm, attendance, fees, cash, pnl, pendingApprovals, monthly, byGrade, recentReceipts] = await Promise.all([
    one<DashboardData['students']>(
      `SELECT COUNT(*)::int AS total,
              COALESCE(SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END), 0)::int AS active,
              COALESCE(SUM(CASE WHEN status = 'ACTIVE' AND gender = 'MALE' THEN 1 ELSE 0 END), 0)::int AS boys,
              COALESCE(SUM(CASE WHEN status = 'ACTIVE' AND gender = 'FEMALE' THEN 1 ELSE 0 END), 0)::int AS girls
       FROM student`,
    ),
    one<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM teacher_profile tp JOIN employee e ON e.id = tp.employee_id
       WHERE e.status IN ('ACTIVE', 'ON_LEAVE')`,
    ),
    one<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM stream s JOIN academic_year y ON y.id = s.academic_year_id WHERE y.is_current`,
    ),
    one<{ year: string; term: string; start_date: IsoDate; end_date: IsoDate }>(
      `SELECT y.name AS year, t.name AS term, t.start_date, t.end_date
       FROM academic_term t JOIN academic_year y ON y.id = t.academic_year_id
       WHERE t.is_current ORDER BY t.id DESC LIMIT 1`,
    ),
    one<{ present: number; absent: number; late: number; excused: number }>(
      `SELECT COALESCE(SUM(CASE WHEN status = 'PRESENT' THEN 1 ELSE 0 END), 0)::int AS present,
              COALESCE(SUM(CASE WHEN status = 'ABSENT' THEN 1 ELSE 0 END), 0)::int AS absent,
              COALESCE(SUM(CASE WHEN status = 'LATE' THEN 1 ELSE 0 END), 0)::int AS late,
              COALESCE(SUM(CASE WHEN status = 'EXCUSED' THEN 1 ELSE 0 END), 0)::int AS excused
       FROM attendance_record WHERE date = ?`, todayIso,
    ),
    one<{ invoiced: Cents; collected: Cents; outstanding: Cents; overdue: Cents }>(
      `SELECT COALESCE(SUM(CASE WHEN cle.document_type = 'Invoice' THEN cle.amount_lcy ELSE 0 END), 0) AS invoiced,
              COALESCE(SUM(CASE WHEN cle.document_type = 'Payment' THEN -cle.amount_lcy ELSE 0 END), 0) AS collected,
              COALESCE(SUM(CASE WHEN cle.open = 1 THEN cle.remaining_amount_lcy ELSE 0 END), 0) AS outstanding,
              COALESCE(SUM(CASE WHEN cle.open = 1 AND cle.positive = 1 AND cle.due_date < ? THEN cle.remaining_amount_lcy ELSE 0 END), 0) AS overdue
       FROM cust_ledger_entry cle
       JOIN customer c ON c.id = cle.customer_id
       JOIN student s ON s.customer_id = c.id`, todayIso,
    ),
    one<{ n: Cents }>(`SELECT COALESCE(SUM(balance), 0) AS n FROM bank_account WHERE status = 'ACTIVE'`),
    one<{ income: Cents; expense: Cents }>(
      `SELECT COALESCE(SUM(CASE WHEN a.type = 'INCOME' THEN jl.credit_lcy - jl.debit_lcy ELSE 0 END), 0) AS income,
              COALESCE(SUM(CASE WHEN a.type = 'EXPENSE' THEN jl.debit_lcy - jl.credit_lcy ELSE 0 END), 0) AS expense
       FROM journal_line jl JOIN gl_account a ON a.id = jl.gl_account_id JOIN journal j ON j.id = jl.journal_id
       WHERE a.type IN ('INCOME', 'EXPENSE') AND j.closing_entry = 0`,
    ),
    myPendingWorkflowTaskCount(userId, username),
    all<{ month: string; collected: Cents; invoiced: Cents }>(
      // "month" is a keyword in PostgreSQL and cannot be a bare column alias.
      `SELECT substr(cle.posting_date, 1, 7) AS month,
              COALESCE(SUM(CASE WHEN cle.document_type = 'Payment' THEN -cle.amount_lcy ELSE 0 END), 0) AS collected,
              COALESCE(SUM(CASE WHEN cle.document_type = 'Invoice' THEN cle.amount_lcy ELSE 0 END), 0) AS invoiced
       FROM cust_ledger_entry cle JOIN student s ON s.customer_id = cle.customer_id
       GROUP BY month ORDER BY month DESC LIMIT 12`,
    ),
    all<{ grade: string; students: number }>(
      `SELECT g.name AS grade, COUNT(s.id)::int AS students
       FROM grade_level g LEFT JOIN student s ON s.current_grade_level_id = g.id AND s.status = 'ACTIVE'
       JOIN education_level el ON el.id = g.education_level_id
       GROUP BY g.id, g.name, el.sort, g.sort ORDER BY el.sort, g.sort`,
    ),
    all<DashboardData['recentReceipts'][number]>(
      `SELECT no, posting_date, description, amount, receipt_type FROM posted_receipt ORDER BY id DESC LIMIT 10`,
    ),
  ]);

  const att = attendance!;
  const attTotal = att.present + att.absent + att.late + att.excused;
  const attendanceToday: AttendanceSummary | null = attTotal
    ? { ...att, total: attTotal, rate: Number((((att.present + att.late) / attTotal) * 100).toFixed(1)) }
    : null;
  const income = Number(pnl?.income ?? 0);
  const expense = Number(pnl?.expense ?? 0);

  return {
    students: students!,
    teachers: Number(teachers?.n ?? 0),
    streams: Number(streams?.n ?? 0),
    currentTerm: currentTerm ?? null,
    attendanceToday,
    fees: {
      invoiced: Number(fees?.invoiced ?? 0), collected: Number(fees?.collected ?? 0),
      outstanding: Number(fees?.outstanding ?? 0), overdue: Number(fees?.overdue ?? 0),
    },
    cash: Number(cash?.n ?? 0),
    income,
    expense,
    surplus: income - expense,
    pendingApprovals,
    monthlyCollections: monthly.reverse(),
    enrolmentByGrade: byGrade,
    recentReceipts,
  };
}

export interface GetBalanceSheetOptions {
  /** One-line Date Filter range (see lib/format.ts's parseDateFilterExpression) — left unset,
   *  the usual cumulative Balance at Date; paired with `asOf`, a Net Change for that period,
   *  the same Date Filter FlowField behaviour as the Trial Balance this reuses. */
  from?: IsoDate | null;
  asOf?: IsoDate | null;
  /** Same filter bar as the Trial Balance: Code/Name/Type plus the Dimensional filter
   *  (Global Dimension combination/range expression) — see TRIAL_BALANCE_DIMENSION_FILTER_
   *  FIELDS in gl.ts. */
  filters?: FilterCondition[];
}

export async function getBalanceSheet(
  { from, asOf, filters = [] }: GetBalanceSheetOptions = {},
): Promise<BalanceSheet> {
  const { rows } = await getTrialBalance({ from, asOf, filters });
  const group = (t: string): ReportLine[] =>
    rows.filter((r) => r.type === t).map((r) => ({ code: r.code, name: r.name, amount: r.net }));
  const sum = (a: ReportLine[]): Cents => a.reduce((x, y) => x + y.amount, 0);

  const assets = group('ASSET');
  const liabilities = group('LIABILITY');
  const equity = group('EQUITY');
  const surplus = sum(group('INCOME')) - sum(group('EXPENSE'));

  const totals = {
    assets: sum(assets),
    liabilities: sum(liabilities),
    equity: sum(equity),
    equityAndLiabilities: sum(liabilities) + sum(equity) + surplus,
  };
  return { assets, liabilities, equity, surplus, totals, balanced: totals.assets === totals.equityAndLiabilities };
}

export interface GetIncomeStatementOptions {
  from?: string;
  to?: string;
  /** Same filter bar as the Trial Balance — see GetBalanceSheetOptions.filters. */
  filters?: FilterCondition[];
}

export async function getIncomeStatement(
  { from, to, filters = [] }: GetIncomeStatementOptions = {},
): Promise<IncomeStatement> {
  // A plain INNER JOIN, unlike the Trial Balance's own LEFT JOIN aggregate — an income/expense
  // account with nothing posted in the period is meant to be absent here (the report only ever
  // shows accounts with real activity; Section's own render already drops amount === 0 lines
  // regardless), so a dimension/account condition is safe straight in the WHERE clause.
  const { clause: whereClause, params: whereParams } = buildFilterClause(TRIAL_BALANCE_FILTER_FIELDS, filters, 'is');
  const gd1 = filters.find((f) => f.field === 'gd1_filter' && f.value !== '');
  const gd2 = filters.find((f) => f.field === 'gd2_filter' && f.value !== '');
  const [gd1Ids, gd2Ids] = await Promise.all([
    gd1 ? resolveDimensionFilterIds(1, gd1.value) : Promise.resolve(null),
    gd2 ? resolveDimensionFilterIds(2, gd2.value) : Promise.resolve(null),
  ]);
  const dimParams: Record<string, unknown> = {};
  const dimParts: string[] = [];
  if (gd1Ids !== null) { dimParts.push('AND jl.global_dimension_1_id = ANY(@gd1Ids)'); dimParams.gd1Ids = gd1Ids; }
  if (gd2Ids !== null) { dimParts.push('AND jl.global_dimension_2_id = ANY(@gd2Ids)'); dimParams.gd2Ids = gd2Ids; }

  const rows = await all<{ code: string; name: string; type: string; d: Cents; c: Cents }>(
    `SELECT a.code, a.name, a.type, COALESCE(SUM(jl.debit_lcy),0) d, COALESCE(SUM(jl.credit_lcy),0) c
     FROM gl_account a
     JOIN journal_line jl ON jl.gl_account_id = a.id
     JOIN journal j ON j.id = jl.journal_id
     WHERE a.type IN ('INCOME','EXPENSE')
       ${journalDateWindowSql('j', '@from', '@to')}
       ${whereClause}
       ${dimParts.join(' ')}
     GROUP BY a.id ORDER BY a.code`,
    { from: from || null, to: to || null, ...whereParams, ...dimParams },
  );
  const income = rows.filter((r) => r.type === 'INCOME')
    .map((r) => ({ code: r.code, name: r.name, amount: r.c - r.d }));
  const expense = rows.filter((r) => r.type === 'EXPENSE')
    .map((r) => ({ code: r.code, name: r.name, amount: r.d - r.c }));
  const s = (a: ReportLine[]): Cents => a.reduce((x, y) => x + y.amount, 0);
  return {
    income, expense,
    totalIncome: s(income), totalExpense: s(expense),
    surplus: s(income) - s(expense),
    from, to,
  };
}
