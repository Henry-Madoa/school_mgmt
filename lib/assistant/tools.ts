/*
 * The assistant's tools — everything it can look up, each tied to the permission the same
 * screen needs. Two gates, both server-side:
 *   1. toolsFor(user) hands the model only the tools the signed-in user may run, so a question
 *      outside their permissions has no tool that could answer it (a CRM officer's model never
 *      sees the trial balance tool at all);
 *   2. runTool() re-checks the permission before running, in case a tool name reaches it any
 *      other way.
 * Every tool is read-only and goes through the same lib/ services the pages use, so the assistant
 * can never see a figure the page would not show. Money is passed to the model already formatted
 * in major units; the model is told never to compute figures itself.
 */
import { z } from 'zod';
import type { Anthropic } from '@anthropic-ai/sdk';
import { canAction, canPage, type ActionKey } from '../permissions.ts';
import { listStudents, getStudent } from '../students.ts';
import { feeAccountSummary, feeStatement } from '../fees/statement.ts';
import { listFeeBalances } from '../fees/invoices.ts';
import { buildReportCard, listPublishedTerms } from '../academics/assessments.ts';
import { studentAttendanceSummary, streamAttendanceSummary } from '../academics/attendance.ts';
import { resolveTerm, listStreams } from '../academics/setup.ts';
import { trialBalance, accountBalances } from '../accounting.ts';
import { getBalanceSheet, getIncomeStatement, getDashboard } from '../reports.ts';
import { listMyWorkflowTasks } from '../workflow.ts';
import { buildSearchIndex } from '../globalSearch.ts';
import { getOrg } from '../org.ts';
import { formatMoney, formatDate } from '../format.ts';
import { all } from '../db.ts';
import type { FilterCondition } from '../listFilters.ts';
import type { Cents, SessionUser } from '../types.ts';

const money = (c: Cents | null | undefined): string => formatMoney(Number(c ?? 0));

export interface AssistantTool<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  /** The permission a user needs for this tool to exist for them at all. */
  action: ActionKey;
  schema: S;
  run: (input: z.infer<S>, user: SessionUser) => Promise<unknown>;
}

const tool = <S extends z.ZodTypeAny>(t: AssistantTool<S>): AssistantTool<S> => t;

/* ------------------------------------------------------------------ students */

const findStudents = tool({
  name: 'find_students',
  description: 'Search students by name, admission number or a guardian’s name/phone. Returns up to 10 matches with class, status and fee balance. Use this to resolve who the user means before looking anyone up.',
  action: 'STUDENTS_READ',
  schema: z.object({ query: z.string().min(1).describe('Name, admission no., or guardian name/phone (partial is fine)') }),
  run: async ({ query }) => (await listStudents({ search: query, limit: 10 })).map((s) => ({
    id: s.id, admission_no: s.admission_no, name: `${s.first_name} ${s.last_name}`, status: s.status, gender: s.gender,
    grade: s.grade_level_name, class: s.stream_name, guardian: s.primary_guardian_name, guardian_phone: s.primary_guardian_phone, fee_balance: money(s.fee_balance),
  })),
});

const studentProfile = tool({
  name: 'get_student',
  description: 'A student’s full picture: profile, guardians, enrolment history, and (where permitted) the fee account summary.',
  action: 'STUDENTS_READ',
  schema: z.object({ student_id: z.number().int().describe('From find_students') }),
  run: async ({ student_id }, user) => {
    const s = await getStudent(student_id);
    if (!s) return { error: 'Student not found' };
    const fees = canAction(user, 'FEES_READ') ? await feeAccountSummary(student_id) : null;
    return {
      student: { id: s.id, admission_no: s.admission_no, name: [s.first_name, s.middle_name, s.last_name].filter(Boolean).join(' '), gender: s.gender, date_of_birth: s.date_of_birth, status: s.status, grade: s.grade_level_name, class: s.stream_name, admitted: s.admission_date, county: s.county_name },
      guardians: s.guardians.map((g) => ({ name: g.full_name, relationship: g.relationship, phone: g.phone, email: g.email, primary: g.is_primary })),
      enrolments: s.enrollments.map((e) => ({ year: e.year_name, grade: e.grade_level_name, class: e.stream_name, status: e.status })),
      fees: fees ? { account_no: fees.customer_no, balance: money(fees.balance), overdue: money(fees.overdue), invoiced_to_date: money(fees.invoiced), paid_to_date: money(fees.paid), last_payment: fees.last_payment_date, next_due: fees.next_due_date } : (canAction(user, 'FEES_READ') ? 'no fee account' : 'not permitted'),
    };
  },
});

/* ------------------------------------------------------------------ fees */

const feeStatementTool = tool({
  name: 'fee_statement',
  description: 'A student’s fee statement between two dates: opening balance and every invoice, payment and adjustment with its running balance.',
  action: 'FEES_READ',
  schema: z.object({ student_id: z.number().int(), from: z.string().optional().describe('YYYY-MM-DD'), to: z.string().optional().describe('YYYY-MM-DD') }),
  run: async ({ student_id, from, to }) => {
    const st = await feeStatement(student_id, from ?? null, to ?? null);
    return {
      opening: money(st.opening), closing: money(st.closing),
      lines: st.lines.slice(-60).map((l) => ({ date: l.posting_date, type: l.document_type, document: l.document_no, description: l.description, amount: money(l.amount), remaining: money(l.remaining_amount), due: l.due_date, balance: money(l.running_balance) })),
      truncated: st.lines.length > 60 ? `${st.lines.length - 60} earlier lines omitted` : undefined,
    };
  },
});

const feeBalances = tool({
  name: 'fee_balances',
  description: 'Students with fees owing, optionally only those past due or one class/grade — sorted by what is overdue. Use for "who owes fees", "arrears in Grade 4", collection questions.',
  action: 'FEES_READ',
  schema: z.object({ only_overdue: z.boolean().optional(), stream_id: z.number().int().optional(), grade_level_id: z.number().int().optional(), limit: z.number().int().min(1).max(100).optional() }),
  run: async ({ only_overdue, stream_id, grade_level_id, limit }) => {
    const rows = await listFeeBalances({ onlyOverdue: only_overdue, streamId: stream_id, gradeLevelId: grade_level_id });
    return {
      students: rows.length, total_owing: money(rows.reduce((a, r) => a + Number(r.balance), 0)), total_overdue: money(rows.reduce((a, r) => a + Number(r.overdue), 0)),
      rows: rows.slice(0, limit ?? 25).map((r) => ({ student_id: r.student_id, admission_no: r.admission_no, name: r.student_name, grade: r.grade_level_name, class: r.stream_name, guardian: r.guardian_name, guardian_phone: r.guardian_phone, balance: money(r.balance), overdue: money(r.overdue), oldest_due: r.oldest_due_date, last_paid: r.last_payment_date })),
    };
  },
});

/* ------------------------------------------------------------------ academics */

const reportCardTool = tool({
  name: 'report_card',
  description: 'A student’s report card for a term: each subject’s marks, weighted average and competency level, the overall average, class position, attendance and remarks. Omit term_id for the current term.',
  action: 'REPORT_CARDS_READ',
  schema: z.object({ student_id: z.number().int(), term_id: z.number().int().optional() }),
  run: async ({ student_id, term_id }) => {
    const term = await resolveTerm(term_id ?? null);
    if (!term) return { error: 'No academic term is set up' };
    const rc = await buildReportCard(student_id, term.id);
    if (!rc) return { error: 'Student or term not found' };
    return {
      term: `${rc.term.name} ${rc.term.year_name}`, published: !!rc.card?.is_published, overall: rc.overall, position: rc.position, attendance: rc.attendance,
      subjects: rc.lines.map((l) => ({ subject: l.subject_name, average: l.average, competency: l.competency_label, scores: l.scores.map((x) => `${x.assessment_type_name}: ${x.score}`) })),
      remarks: { class_teacher: rc.card?.class_teacher_remarks ?? null, principal: rc.card?.principal_remarks ?? null },
      published_terms: (await listPublishedTerms(student_id)).map((t) => `${t.term_name} ${t.year_name}`),
    };
  },
});

const attendanceTool = tool({
  name: 'attendance',
  description: 'Attendance for a term — for one student, or for a whole class (stream). Omit term_id for the current term.',
  action: 'ATTENDANCE_READ',
  schema: z.object({ student_id: z.number().int().optional(), stream_id: z.number().int().optional(), term_id: z.number().int().optional() }),
  run: async ({ student_id, stream_id, term_id }) => {
    const term = await resolveTerm(term_id ?? null);
    if (!term) return { error: 'No academic term is set up' };
    if (student_id) return { term: `${term.name} ${term.year_name}`, ...(await studentAttendanceSummary(student_id, term.start_date, term.end_date)) };
    if (stream_id) return { term: `${term.name} ${term.year_name}`, ...(await streamAttendanceSummary(stream_id, term.start_date, term.end_date)) };
    const streams = await listStreams();
    return { term: `${term.name} ${term.year_name}`, classes: await Promise.all(streams.map(async (st) => ({ stream_id: st.id, class: `${st.grade_level_name} ${st.name}`, students: st.students, ...(await streamAttendanceSummary(st.id, term.start_date, term.end_date)) }))) };
  },
});

const schoolSnapshot = tool({
  name: 'school_snapshot',
  description: 'The school at a glance: enrolment by grade, teaching staff, today’s attendance, fees invoiced/collected/outstanding/overdue, cash, income and expenditure, pending approvals.',
  action: 'DASHBOARD_VIEW',
  schema: z.object({}),
  run: async (_input, user) => {
    const d = await getDashboard(user.id, user.username);
    return {
      students: d.students, teachers: d.teachers, classes: d.streams, current_term: d.currentTerm, attendance_today: d.attendanceToday,
      fees: { invoiced: money(d.fees.invoiced), collected: money(d.fees.collected), outstanding: money(d.fees.outstanding), overdue: money(d.fees.overdue) },
      cash_and_bank: money(d.cash), income: money(d.income), expenditure: money(d.expense), surplus: money(d.surplus), pending_approvals: d.pendingApprovals,
      enrolment_by_grade: d.enrolmentByGrade,
    };
  },
});

const glBalances = tool({
  name: 'gl_account_balances',
  description: 'Balances of general-ledger accounts by code (e.g. 1020 bank, 1200 fees receivable). Pass the codes you need; unknown codes read 0.',
  action: 'GL_READ',
  schema: z.object({ codes: z.array(z.string()).min(1).max(30) }),
  run: async ({ codes }) => {
    const bal = await accountBalances(codes);
    const names = await all<{ code: string; name: string; type: string }>(`SELECT code, name, type FROM gl_account WHERE code IN (${codes.map(() => '?').join(',')})`, ...codes);
    return codes.map((c) => ({ code: c, name: names.find((n) => n.code === c)?.name ?? 'unknown', type: names.find((n) => n.code === c)?.type, balance: money(bal[c]) }));
  },
});

const trialBalanceTool = tool({
  name: 'trial_balance',
  description: 'The trial balance (every postable account with a debit or credit balance), optionally as at a date or for a period. Large — prefer gl_account_balances for a few accounts.',
  action: 'GL_READ',
  schema: z.object({ as_of: z.string().optional().describe('YYYY-MM-DD'), from: z.string().optional().describe('YYYY-MM-DD, for a net-change trial balance') }),
  run: async ({ as_of, from }) => {
    const rows = await trialBalance({ asOf: as_of ?? null, from: from ?? null });
    const active = rows.filter((r) => r.debit_balance || r.credit_balance);
    return {
      rows: active.map((r) => ({ code: r.code, name: r.name, type: r.type, debit: money(r.debit_balance), credit: money(r.credit_balance) })),
      totals: { debit: money(active.reduce((s, r) => s + r.debit_balance, 0)), credit: money(active.reduce((s, r) => s + r.credit_balance, 0)) },
    };
  },
});

const financialStatements = tool({
  name: 'financial_statements',
  description: 'The statement of financial position (balance sheet) as at a date and the statement of comprehensive income (income statement) for a period.',
  action: 'REPORTS_VIEW',
  schema: z.object({ as_of: z.string().optional().describe('Balance sheet date, YYYY-MM-DD; default today'), from: z.string().optional().describe('Income statement start'), to: z.string().optional().describe('Income statement end') }),
  run: async ({ as_of, from, to }) => {
    const [bs, is] = await Promise.all([getBalanceSheet({ asOf: as_of ?? null }), getIncomeStatement({ from, to })]);
    const lines = (ls: { code: string; name: string; amount: Cents }[]) => ls.filter((l) => l.amount).map((l) => ({ code: l.code, name: l.name, amount: money(l.amount) }));
    return {
      financial_position: { as_of: as_of ?? 'today', assets: lines(bs.assets), liabilities: lines(bs.liabilities), equity: lines(bs.equity), surplus: money(bs.surplus), totals: { assets: money(bs.totals.assets), liabilities_and_equity: money(bs.totals.equityAndLiabilities) }, balanced: bs.balanced },
      comprehensive_income: { from: from ?? 'start', to: to ?? 'today', income: lines(is.income), expense: lines(is.expense), total_income: money(is.totalIncome), total_expense: money(is.totalExpense), surplus: money(is.surplus) },
    };
  },
});

/* ------------------------------------------------------------------ the user's own work */

const myApprovals = tool({
  name: 'my_pending_approvals',
  description: 'Documents waiting for the signed-in user’s approval decision.',
  action: 'APPROVALS_VIEW',
  schema: z.object({}),
  run: async (_input, user) => (await listMyWorkflowTasks(user.id, user.username)).filter((t) => t.status === 'PENDING').slice(0, 30).map((t) => ({
    document_type: t.document_type, document: t.entity_id, requested_by: t.requested_by, requested_at: t.requested_at, amount: t.amount != null ? money(t.amount) : null,
  })),
});

const whereIs = tool({
  name: 'find_screen',
  description: 'Where a screen or function lives in this system, for the signed-in user’s own navigation — returns the page name, path and menu trail. Use it for "where do I …" / "how do I open …" questions.',
  action: 'DASHBOARD_VIEW',
  schema: z.object({ query: z.string().min(1) }),
  run: async ({ query }, user) => {
    const q = query.toLowerCase();
    return buildSearchIndex(user)
      .filter((e) => `${e.label} ${e.trail} ${e.keywords ?? ''}`.toLowerCase().includes(q))
      .slice(0, 8).map((e) => ({ screen: e.label, path: e.path, menu: e.trail }));
  },
});

const schoolInfo = tool({
  name: 'school_info',
  description: 'The school’s own details: name, registration, contacts, currency, financial year start, and the current academic term.',
  action: 'DASHBOARD_VIEW',
  schema: z.object({}),
  run: async () => {
    const [o, term] = await Promise.all([getOrg(), resolveTerm()]);
    if (!o) return {};
    return { name: o.name, short_name: o.short_name, registration_no: o.registration_no, school_type: o.society_type, phone: o.phone_primary, email: o.email, website: o.website, currency: o.currency_code, financial_year_starts: `${o.fy_start_day}/${o.fy_start_month}`, current_term: term ? `${term.name} ${term.year_name} (${term.start_date} to ${term.end_date})` : null, today: formatDate(new Date().toISOString().slice(0, 10)) };
  },
});

export const ALL_TOOLS: AssistantTool[] = [
  findStudents, studentProfile, feeStatementTool, feeBalances, reportCardTool, attendanceTool, schoolSnapshot,
  glBalances, trialBalanceTool, financialStatements, myApprovals, whereIs, schoolInfo,
];

/** The tools this user may run — the only ones the model is ever told about. */
export const toolsFor = (user: SessionUser): AssistantTool[] =>
  ALL_TOOLS.filter((t) => canAction(user, t.action) || (t.action === 'DASHBOARD_VIEW' && canPage(user, 'DASHBOARD')));

/** What the user can and cannot ask about, in words, for the system prompt. */
export function scopeFor(user: SessionUser): { can: string[]; cannot: string[] } {
  const areas: { label: string; action: ActionKey }[] = [
    { label: 'students, their guardians and classes', action: 'STUDENTS_READ' },
    { label: 'fee balances, invoices and statements', action: 'FEES_READ' },
    { label: 'attendance registers', action: 'ATTENDANCE_READ' },
    { label: 'report cards and marks', action: 'REPORT_CARDS_READ' },
    { label: 'the general ledger and account balances', action: 'GL_READ' },
    { label: 'financial statements', action: 'REPORTS_VIEW' },
    { label: 'their own pending approvals', action: 'APPROVALS_VIEW' },
  ];
  return {
    can: areas.filter((a) => canAction(user, a.action)).map((a) => a.label),
    cannot: areas.filter((a) => !canAction(user, a.action)).map((a) => a.label),
  };
}

/** The tool definitions in the API's shape, from the zod schemas. Not `strict`: several tools
 *  have optional inputs, which strict mode's all-properties-required rule cannot express — the
 *  zod parse in runTool() is the validation that counts. */
export function toolDefinitions(tools: AssistantTool[]): Anthropic.Tool[] {
  return tools.map((t) => {
    const { $schema: _schema, ...schema } = z.toJSONSchema(t.schema) as Record<string, unknown>;
    return { name: t.name, description: t.description, input_schema: schema as Anthropic.Tool['input_schema'] };
  });
}

/** Run one tool for this user, permission re-checked, input validated. Never throws — a failure is a result the model can read. */
export async function runTool(tools: AssistantTool[], name: string, input: unknown, user: SessionUser): Promise<{ ok: boolean; content: string }> {
  const t = tools.find((x) => x.name === name);
  if (!t) return { ok: false, content: 'That tool is not available to you.' };
  if (!(canAction(user, t.action) || (t.action === 'DASHBOARD_VIEW' && canPage(user, 'DASHBOARD')))) {
    return { ok: false, content: 'Your role does not carry the permission this needs.' };
  }
  const parsed = t.schema.safeParse(input);
  if (!parsed.success) return { ok: false, content: `Invalid input: ${parsed.error.issues.map((i) => i.message).join('; ')}` };
  try {
    return { ok: true, content: JSON.stringify(await t.run(parsed.data, user)) };
  } catch (e) {
    return { ok: false, content: `Lookup failed: ${(e as Error).message}` };
  }
}
