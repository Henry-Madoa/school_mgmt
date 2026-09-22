/*
 * Payroll period reports — the AL report set (Rep52203525 NSSF, Rep52203531 SHIF,
 * Rep52203527 PAYE, Rep52203528 Net Pay, Rep52203538 Payroll Summary Standard, Rep52203523
 * Payroll Deductions, Rep52203524 Payroll Allowances, Rep52203530 Payroll Company Report,
 * Rep52203536 Pension, Rep52203558 Company Deductions, Rep52203494
 * Master Roll, Rep52203540 Payroll Costing), each with the columns of its RDLC layout, read off
 * the Payroll Period Transactions and P9 lines the run wrote.
 *
 * One description serves both the screen (app/payroll/periods/view/[id]/reports) and the
 * printout (/print/payroll-report/<periodId>-<key>), which carries the RDLCs' shared trailer:
 * the five-role signature strip (Prepared / Checked / Confirmed / Approved / Authorised).
 */
import 'server-only';
import { one, all } from './db.ts';
import { AppError } from './errors.ts';
import { formatMoney } from './format.ts';
import { getPayrollPeriod } from './payroll.ts';
import { getDimensionCaptions } from './org.ts';
import { listActiveDimensionValues } from './pool.ts';
import { listPostingGroups } from './payrollSetup.ts';
import { PAYMENT_MODES } from './types.ts';
import { printBrand, documentMoney } from './documentPrint.ts';
import type { PrintDocument, PrintRow, PrintSignature } from './documentPrint.ts';
import type { PayrollPeriod } from './types.ts';

export type CellKind = 'text' | 'money' | 'int';
export interface ReportColumn { key: string; label: string; kind?: CellKind; width?: string; sum?: boolean }
export interface ReportRow { cells: Record<string, string | number | null>; kind?: 'data' | 'group' | 'subtotal' }
/**
 * AL "Applied Filters": the request-page filters every payroll report takes — the employee's
 * dimensions, posting group and payment mode, one employee, and (on the line-based reports) one
 * transaction code. Carried on the URL so a printout shows exactly what the screen showed.
 */
export interface ReportFilters {
  dim1?: number; dim2?: number; employeeId?: number; postingGroupId?: number; paymentMode?: string; code?: string;
}
export const REPORT_FILTER_PARAMS = ['dim1', 'dim2', 'employee', 'posting', 'mode', 'code'] as const;

export function parseReportFilters(q: Record<string, string | string[] | undefined>): ReportFilters {
  const s = (k: string) => { const v = q[k]; return Array.isArray(v) ? v[0] : v; };
  const id = (k: string) => { const v = Number(s(k)); return Number.isInteger(v) && v > 0 ? v : undefined; };
  return {
    dim1: id('dim1'), dim2: id('dim2'), employeeId: id('employee'), postingGroupId: id('posting'),
    paymentMode: s('mode')?.trim() || undefined, code: s('code')?.trim().toUpperCase() || undefined,
  };
}
export function reportFilterQuery(f: ReportFilters): string {
  const p = new URLSearchParams();
  if (f.dim1) p.set('dim1', String(f.dim1)); if (f.dim2) p.set('dim2', String(f.dim2));
  if (f.employeeId) p.set('employee', String(f.employeeId)); if (f.postingGroupId) p.set('posting', String(f.postingGroupId));
  if (f.paymentMode) p.set('mode', f.paymentMode); if (f.code) p.set('code', f.code);
  const s = p.toString(); return s ? `?${s}` : '';
}

/** The WHERE fragment for the employee-level filters, against alias `e` (employee) or `t`
 *  (a period transaction, which carries the employee's dimensions/posting group/mode of the run). */
function employeeWhere(f: ReportFilters, alias: 'e' | 't'): { sql: string; params: unknown[] } {
  const clauses: string[] = []; const params: unknown[] = [];
  const idCol = alias === 'e' ? 'e.id' : 't.employee_id';
  if (f.dim1) { clauses.push(`${alias}.global_dimension_1_id = ?`); params.push(f.dim1); }
  if (f.dim2) { clauses.push(`${alias}.global_dimension_2_id = ?`); params.push(f.dim2); }
  if (f.employeeId) { clauses.push(`${idCol} = ?`); params.push(f.employeeId); }
  if (f.postingGroupId) { clauses.push(`${alias}.posting_group_id = ?`); params.push(f.postingGroupId); }
  if (f.paymentMode) { clauses.push(`${alias}.payment_mode = ?`); params.push(f.paymentMode); }
  return { sql: clauses.length ? ' AND ' + clauses.join(' AND ') : '', params };
}

/** What the filter bar offers, and how an applied filter reads on the report header. */
export interface ReportFilterOptions {
  captions: { caption1: string; caption2: string };
  dim1: { id: number; code: string; name: string }[]; dim2: { id: number; code: string; name: string }[];
  employees: { id: number; employee_no: string; name: string }[];
  postingGroups: { id: number; code: string; name: string }[];
  paymentModes: string[];
  codes: { code: string; name: string; group_text: string }[];
}
export async function getReportFilterOptions(periodId: number): Promise<ReportFilterOptions> {
  const [captions, d1, d2, employees, groups, codes] = await Promise.all([
    getDimensionCaptions(), listActiveDimensionValues(1), listActiveDimensionValues(2),
    all<{ id: number; employee_no: string; name: string }>(
      `SELECT e.id, e.employee_no, (e.first_name || ' ' || e.last_name) AS name FROM employee e
       WHERE EXISTS (SELECT 1 FROM payroll_p9_line p WHERE p.payroll_period_id = ? AND p.employee_id = e.id) ORDER BY e.first_name, e.last_name`, periodId),
    listPostingGroups(),
    all<{ code: string; name: string; group_text: string }>(
      `SELECT transaction_code AS code, MIN(transaction_name) AS name, MIN(group_text) AS group_text FROM payroll_period_transaction
       WHERE payroll_period_id = ? AND transaction_type <> 'MEMO' GROUP BY transaction_code ORDER BY MIN(group_order), transaction_code`, periodId),
  ]);
  return {
    captions, dim1: d1.map((v) => ({ id: v.id, code: v.code, name: v.name })), dim2: d2.map((v) => ({ id: v.id, code: v.code, name: v.name })),
    employees, postingGroups: groups.map((g) => ({ id: g.id, code: g.code, name: g.name })), paymentModes: [...PAYMENT_MODES], codes,
  };
}

/** "Department: Finance · Payment mode: Bank Transfer" — the RDLCs' "Applied Filters" line. */
export function describeReportFilters(f: ReportFilters, o: ReportFilterOptions): string {
  const parts: string[] = [];
  const name = <T extends { id: number; code: string; name: string }>(list: T[], id?: number) => { const v = list.find((x) => x.id === id); return v ? `${v.code} — ${v.name}` : id ? String(id) : ''; };
  if (f.dim1) parts.push(`${o.captions.caption1}: ${name(o.dim1, f.dim1)}`);
  if (f.dim2) parts.push(`${o.captions.caption2}: ${name(o.dim2, f.dim2)}`);
  if (f.employeeId) { const e = o.employees.find((x) => x.id === f.employeeId); parts.push(`Employee: ${e ? `${e.employee_no} ${e.name}` : f.employeeId}`); }
  if (f.postingGroupId) parts.push(`Posting group: ${name(o.postingGroups, f.postingGroupId)}`);
  if (f.paymentMode) parts.push(`Payment mode: ${f.paymentMode}`);
  if (f.code) { const c = o.codes.find((x) => x.code === f.code); parts.push(`Transaction: ${f.code}${c ? ` — ${c.name}` : ''}`); }
  return parts.join(' · ');
}

export interface PayrollReport {
  key: PayrollReportKey; title: string;
  filters: ReportFilters; appliedFilters: string;
  /** The RDLC's header line — "SHIF For :", "Payroll Deductions For :" … */
  forLabel: string;
  period: PayrollPeriod; landscape: boolean; grouped: boolean;
  columns: ReportColumn[]; rows: ReportRow[]; totals: Record<string, number>;
  /** Extra header facts beside the period (a filter, a count). */
  meta: { label: string; value: string }[];
  employees: number;
}

export const PAYROLL_REPORT_KEYS = [
  'summary', 'master-roll', 'net-pay', 'paye', 'nssf', 'shif', 'housing-levy', 'pension',
  'allowances', 'deductions', 'company-deductions', 'company', 'costing',
] as const;
export type PayrollReportKey = typeof PAYROLL_REPORT_KEYS[number];

export const PAYROLL_REPORT_LABELS: Record<PayrollReportKey, string> = {
  summary: 'Payroll Summary', 'master-roll': 'Master Roll', 'net-pay': 'Net Pay', paye: 'PAYE', nssf: 'NSSF', shif: 'SHIF',
  'housing-levy': 'Housing Levy', pension: 'Pension', allowances: 'Allowances', deductions: 'Deductions',
  'company-deductions': 'Company Deductions', company: 'Company Report', costing: 'Costing',
};

/** The RDLCs' signature strip: role → the office that signs it. */
export const PAYROLL_REPORT_SIGNATORIES: { label: string; position: string }[] = [
  { label: 'Prepared By', position: 'Human Resource Officer' },
  { label: 'Checked By', position: 'Accountant' },
  { label: 'Confirmed By', position: 'Chief Accountant' },
  { label: 'Approved By', position: 'Head of Finance' },
  { label: 'Authorised By', position: 'Chief Executive Officer' },
];

const n = (v: unknown) => Number(v ?? 0);
const money = (key: string, label: string, extra: Partial<ReportColumn> = {}): ReportColumn => ({ key, label, kind: 'money', sum: true, ...extra });
const text = (key: string, label: string, extra: Partial<ReportColumn> = {}): ReportColumn => ({ key, label, kind: 'text', ...extra });

function sumRows(rows: ReportRow[], columns: ReportColumn[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const c of columns) if (c.sum) totals[c.key] = rows.filter((r) => !r.kind || r.kind === 'data').reduce((s, r) => s + n(r.cells[c.key]), 0);
  return totals;
}

/** Employee identity + the period's P9 figures, one row per processed employee. */
interface EmpFigures {
  employee_id: number; employee_no: string; name: string; national_id: string | null; kra_pin: string | null;
  nssf_no: string | null; shif_no: string | null; bank_account_no: string | null; payment_mode: string;
  department: string | null; job_grade: string | null;
  basic: number; gross: number; taxable: number; paye: number; nssf: number; shif: number; ahl: number; pension: number; deductions: number; net: number;
}
const empFigures = (periodId: number, f: ReportFilters) => { const w = employeeWhere(f, 'e'); return all<EmpFigures>(
  `SELECT e.id AS employee_id, e.employee_no, (e.first_name || ' ' || e.last_name) AS name, e.national_id, e.kra_pin, e.nssf_no, e.shif_no,
          e.bank_account_no, e.payment_mode, gd2.name AS department, jg.name AS job_grade,
          p9.basic_pay_cents AS basic, p9.gross_pay_cents AS gross, p9.taxable_pay_cents AS taxable, p9.paye_cents AS paye,
          p9.nssf_cents AS nssf, p9.shif_cents AS shif, p9.housing_levy_cents AS ahl, p9.pension_cents AS pension,
          p9.deductions_cents AS deductions, p9.net_pay_cents AS net
   FROM payroll_p9_line p9 JOIN employee e ON e.id = p9.employee_id
   LEFT JOIN global_dimension_2_value gd2 ON gd2.id = e.global_dimension_2_id
   LEFT JOIN hr_job_grade jg ON jg.id = e.job_grade_id
   WHERE p9.payroll_period_id = ?${w.sql} ORDER BY e.first_name, e.last_name`, periodId, ...w.params,
); };

/** Sum of one period-transaction code per employee, as a map. */
async function codeByEmployee(periodId: number, where: string, ...params: unknown[]): Promise<Map<number, number>> {
  // Per-employee sums are joined onto the (already filtered) employee list, so no filter here.
  const rows = await all<{ employee_id: number; v: number }>(
    `SELECT employee_id, COALESCE(SUM(amount_cents), 0) AS v FROM payroll_period_transaction WHERE payroll_period_id = ? AND ${where} GROUP BY employee_id`,
    periodId, ...params,
  );
  return new Map(rows.map((r) => [r.employee_id, n(r.v)]));
}

export async function buildPayrollReport(periodId: number, key: PayrollReportKey, filters: ReportFilters = {}): Promise<PayrollReport> {
  const period = await getPayrollPeriod(periodId);
  if (!period) throw new AppError('Payroll period not found', 'NOT_FOUND');
  const [emps, options] = await Promise.all([empFigures(periodId, filters), getReportFilterOptions(periodId)]);
  const appliedFilters = describeReportFilters(filters, options);
  // The line-based reports filter on the transaction rows themselves (they carry the employee's
  // dimensions, posting group and payment mode as of the run) and on the transaction code.
  const tw = employeeWhere(filters, 't');
  const lineWhere = tw.sql + (filters.code ? ' AND t.transaction_code = ?' : '');
  const lineParams = [...tw.params, ...(filters.code ? [filters.code] : [])];
  const base = { key, period, filters, appliedFilters, meta: [] as { label: string; value: string }[], employees: emps.length, grouped: false };
  const numbered = (rows: ReportRow[]) => rows.map((r, i) => ({ ...r, cells: { no: i + 1, ...r.cells } }));
  const finish = (r: Omit<PayrollReport, 'totals' | keyof typeof base> & Partial<typeof base>): PayrollReport => {
    const full = { ...base, ...r };
    return { ...full, totals: sumRows(full.rows, full.columns) };
  };

  switch (key) {
    case 'shif': {
      // Rep52203531 — No. | Emp No. | Emp Name | National ID | SHIF Number | Amount
      const rows = emps.filter((e) => e.shif > 0).map((e): ReportRow => ({ cells: { emp_no: e.employee_no, name: e.name, national_id: e.national_id, shif_no: e.shif_no, amount: e.shif } }));
      return finish({ title: 'SHIF Report', forLabel: 'SHIF For', landscape: false,
        columns: [text('no', 'No.', { kind: 'int', width: '5%' }), text('emp_no', 'Emp No.'), text('name', 'Emp Name'), text('national_id', 'National ID'), text('shif_no', 'SHIF Number'), money('amount', 'Amount')],
        rows: numbered(rows) });
    }
    case 'nssf': {
      // Rep52203525 — No. | Emp No. | Emp Name | NSSF Number | KRA Pin | National ID | Employee | Voluntary Amount | Employer | Total
      const employer = await codeByEmployee(periodId, "transaction_code = 'NSSF-ER' AND post_as = 'DEBIT'");
      const rows = emps.filter((e) => e.nssf > 0 || employer.get(e.employee_id)).map((e): ReportRow => {
        const er = employer.get(e.employee_id) ?? 0;
        return { cells: { emp_no: e.employee_no, name: e.name, nssf_no: e.nssf_no, kra_pin: e.kra_pin, national_id: e.national_id, employee: e.nssf, voluntary: 0, employer: er, total: e.nssf + er } };
      });
      return finish({ title: 'NSSF Report', forLabel: 'NSSF For', landscape: true,
        columns: [text('no', 'No.', { kind: 'int', width: '4%' }), text('emp_no', 'Emp No.'), text('name', 'Emp Name'), text('nssf_no', 'NSSF Number'), text('kra_pin', 'KRA Pin'), text('national_id', 'National ID'),
          money('employee', 'Employee'), money('voluntary', 'Voluntary Amount'), money('employer', 'Employer'), money('total', 'Total')],
        rows: numbered(rows) });
    }
    case 'paye': {
      // Rep52203527 — Row No | No. | KRA PIN | Emp Name | Basic Pay | Gross Pay | Taxable Pay | Paye
      const rows = emps.map((e): ReportRow => ({ cells: { emp_no: e.employee_no, kra_pin: e.kra_pin, name: e.name, basic: e.basic, gross: e.gross, taxable: e.taxable, paye: e.paye } }));
      return finish({ title: 'PAYE Report', forLabel: 'PAYE For', landscape: false,
        columns: [text('no', 'Row No', { kind: 'int', width: '5%' }), text('emp_no', 'No.'), text('kra_pin', 'KRA PIN'), text('name', 'Emp Name'), money('basic', 'Basic Pay'), money('gross', 'Gross Pay'), money('taxable', 'Taxable Pay'), money('paye', 'PAYE')],
        rows: numbered(rows) });
    }
    case 'housing-levy': {
      // Laid out like the SHIF/NSSF reports: the levy has both an employee and an employer side.
      const employer = await codeByEmployee(periodId, "transaction_code = 'AHL-ER' AND post_as = 'DEBIT'");
      const rows = emps.filter((e) => e.ahl > 0).map((e): ReportRow => {
        const er = employer.get(e.employee_id) ?? 0;
        return { cells: { emp_no: e.employee_no, name: e.name, national_id: e.national_id, kra_pin: e.kra_pin, gross: e.gross, employee: e.ahl, employer: er, total: e.ahl + er } };
      });
      return finish({ title: 'Affordable Housing Levy Report', forLabel: 'Housing Levy For', landscape: true,
        columns: [text('no', 'No.', { kind: 'int', width: '4%' }), text('emp_no', 'Emp No.'), text('name', 'Emp Name'), text('national_id', 'National ID'), text('kra_pin', 'KRA Pin'),
          money('gross', 'Gross Pay'), money('employee', 'Employee'), money('employer', 'Employer'), money('total', 'Total')],
        rows: numbered(rows) });
    }
    case 'net-pay': {
      // Rep52203528 — Emp. No | Employee Name | Account No. | Net Pay
      const rows = emps.map((e): ReportRow => ({ cells: { emp_no: e.employee_no, name: e.name,
        account: e.bank_account_no, mode: e.payment_mode, net: e.net } }));
      return finish({ title: 'Net Pay Report', forLabel: 'Net Pay For', landscape: false,
        columns: [text('emp_no', 'Emp. No'), text('name', 'Employee Name'), text('account', 'Account No.'), text('mode', 'Payment Mode'), money('net', 'Net Pay')], rows });
    }
    case 'summary': {
      // Rep52203538 Payroll Summary Standard — R. No. | Emp No. | Employee Name | Basic Pay | Allowances | Gross Pay | SHIF | PAYE | NSSF | Pension | Other Deduction | Net Pay
      const allowances = await codeByEmployee(periodId, "group_text = 'ALLOWANCE'");
      const rows = emps.map((e): ReportRow => ({ cells: { emp_no: e.employee_no, name: e.name, basic: e.basic, allowances: allowances.get(e.employee_id) ?? 0, gross: e.gross,
        shif: e.shif, paye: e.paye, nssf: e.nssf, pension: e.pension, other: e.deductions - e.pension, net: e.net } }));
      return finish({ title: 'Payroll Summary Standard', forLabel: 'Payroll Summary Standard For', landscape: true,
        columns: [text('no', 'R. No.', { kind: 'int', width: '4%' }), text('emp_no', 'Emp No.'), text('name', 'Employee Name'), money('basic', 'Basic Pay'), money('allowances', 'Allowances'), money('gross', 'Gross Pay'),
          money('shif', 'SHIF'), money('paye', 'PAYE'), money('nssf', 'NSSF'), money('pension', 'Pension'), money('other', 'Other Deduction'), money('net', 'Net Pay')],
        rows: numbered(rows) });
    }
    case 'master-roll': {
      // Rep52203494 — No. | Employee Name | Basic Salary | up to ten earnings | Gross Salary | Taxable Pay | Statutory Deduction | Other Deduct. | Net Pay
      const earnCodes = await all<{ transaction_code: string; transaction_name: string; total: number }>(
        `SELECT transaction_code, MIN(transaction_name) AS transaction_name, SUM(amount_cents) AS total FROM payroll_period_transaction
         WHERE payroll_period_id = ? AND group_text = 'ALLOWANCE' AND employee_id IN (SELECT e.id FROM employee e WHERE 1=1${employeeWhere(filters, 'e').sql})
         GROUP BY transaction_code ORDER BY total DESC`, periodId, ...employeeWhere(filters, 'e').params);
      const shown = earnCodes.slice(0, 10); const rest = new Set(earnCodes.slice(10).map((c) => c.transaction_code));
      const earnLines = await all<{ employee_id: number; transaction_code: string; v: number }>(
        `SELECT employee_id, transaction_code, SUM(amount_cents) AS v FROM payroll_period_transaction WHERE payroll_period_id = ? AND group_text = 'ALLOWANCE' GROUP BY employee_id, transaction_code`, periodId);
      const perEmp = new Map<number, Record<string, number>>();
      for (const l of earnLines) {
        const m = perEmp.get(l.employee_id) ?? {}; const k = rest.has(l.transaction_code) ? 'OTHER_EARN' : l.transaction_code;
        m[k] = (m[k] ?? 0) + n(l.v); perEmp.set(l.employee_id, m);
      }
      const rows = emps.map((e): ReportRow => {
        const earn = perEmp.get(e.employee_id) ?? {};
        const statutory = e.nssf + e.shif + e.ahl + e.paye;
        const cells: Record<string, string | number | null> = { name: e.name, emp_no: e.employee_no, basic: e.basic };
        for (const c of shown) cells[c.transaction_code] = earn[c.transaction_code] ?? 0;
        if (rest.size) cells.OTHER_EARN = earn.OTHER_EARN ?? 0;
        Object.assign(cells, { gross: e.gross, taxable: e.taxable, statutory, other: e.deductions, net: e.net });
        return { cells };
      });
      return finish({ title: 'Master Roll', forLabel: 'Master Roll For', landscape: true,
        columns: [text('no', 'No.', { kind: 'int', width: '3%' }), text('emp_no', 'Emp No.'), text('name', 'Employee Name'), money('basic', 'Basic Salary'),
          ...shown.map((c) => money(c.transaction_code, c.transaction_name)), ...(rest.size ? [money('OTHER_EARN', 'Other Earnings')] : []),
          money('gross', 'Gross Salary'), money('taxable', 'Taxable Pay'), money('statutory', 'Statutory Deduction'), money('other', 'Other Deduct.'), money('net', 'Net Pay')],
        rows: numbered(rows) });
    }
    case 'pension': {
      // Rep52203536 — No. | Name | ID Number | PIN | Basic Pay | Allowances | Taxable | Employee Amount | Employer Amount | Employee Voluntary | Total Amount
      const allowances = await codeByEmployee(periodId, "group_text = 'ALLOWANCE'");
      const employer = await codeByEmployee(periodId, `transaction_code_id IN (SELECT id FROM payroll_transaction_code WHERE special_type = 'PENSION') AND group_text = 'EMPLOYER' AND post_as = 'DEBIT'`);
      const rows = emps.filter((e) => e.pension > 0 || employer.get(e.employee_id)).map((e): ReportRow => {
        const er = employer.get(e.employee_id) ?? 0;
        return { cells: { name: e.name, emp_no: e.employee_no, national_id: e.national_id, kra_pin: e.kra_pin, basic: e.basic, allowances: allowances.get(e.employee_id) ?? 0, taxable: e.taxable, employee: e.pension, employer: er, voluntary: 0, total: e.pension + er } };
      });
      return finish({ title: 'Pensions Contribution Report', forLabel: 'Pension Contributions For', landscape: true,
        columns: [text('no', 'No.', { kind: 'int', width: '4%' }), text('emp_no', 'Emp No.'), text('name', 'Name'), text('national_id', 'ID Number'), text('kra_pin', 'PIN'), money('basic', 'Basic Pay'), money('allowances', 'Allowances'), money('taxable', 'Taxable'),
          money('employee', 'Employee Amount'), money('employer', 'Employer Amount'), money('voluntary', 'Employee Voluntary'), money('total', 'Total Amount')],
        rows: numbered(rows), meta: [{ label: 'Classification', value: 'CONFIDENTIAL' }] });
    }
    case 'allowances':
    case 'deductions': {
      // Rep52203524 / Rep52203523 — grouped by department: Trans. Code | Transaction Name | Amount, Sub-Total per department, Total
      const group = key === 'allowances' ? 'ALLOWANCE' : 'DEDUCTIONS';
      const captions = await getDimensionCaptions();
      const lines = await all<{ department: string | null; transaction_code: string; transaction_name: string; amount: number; employees: number }>(
        `SELECT COALESCE(gd2.name, 'Unassigned') AS department, t.transaction_code, MIN(t.transaction_name) AS transaction_name, SUM(t.amount_cents) AS amount, COUNT(DISTINCT t.employee_id) AS employees
         FROM payroll_period_transaction t LEFT JOIN global_dimension_2_value gd2 ON gd2.id = t.global_dimension_2_id
         WHERE t.payroll_period_id = ? AND t.group_text = ?${lineWhere} GROUP BY department, t.transaction_code ORDER BY department, t.transaction_code`, periodId, group, ...lineParams);
      const rows: ReportRow[] = [];
      let dept: string | null = null; let sub = 0;
      const flush = () => { if (dept != null) rows.push({ kind: 'subtotal', cells: { code: '', name: `Sub-Total — ${dept}`, employees: null, amount: sub } }); };
      for (const l of lines) {
        if (l.department !== dept) { flush(); dept = l.department; sub = 0; rows.push({ kind: 'group', cells: { code: dept, name: '', employees: null, amount: null } }); }
        rows.push({ cells: { code: l.transaction_code, name: l.transaction_name, employees: n(l.employees), amount: n(l.amount) } }); sub += n(l.amount);
      }
      flush();
      return finish({ title: key === 'allowances' ? 'Payroll Allowances Report' : 'Payroll Deductions Report', forLabel: key === 'allowances' ? 'Payroll Allowances For' : 'Payroll Deductions For', landscape: false, grouped: true,
        columns: [text('code', 'Trans. Code'), text('name', 'Transaction Name'), text('employees', 'Employees', { kind: 'int' }), money('amount', 'Amount')],
        rows, meta: [{ label: 'Grouped by', value: captions.caption2 }] });
    }
    case 'company-deductions': {
      // Rep52203558 — per deduction: No | Emp. No | Employee Name | Department | Amount | Balance
      const lines = await all<{ transaction_code: string; transaction_name: string; employee_no: string; staff_name: string; department: string | null; amount: number; balance: number | null }>(
        `SELECT t.transaction_code, t.transaction_name, e.employee_no, t.staff_name, gd2.name AS department, t.amount_cents AS amount, t.balance_cents AS balance
         FROM payroll_period_transaction t JOIN employee e ON e.id = t.employee_id LEFT JOIN global_dimension_2_value gd2 ON gd2.id = t.global_dimension_2_id
         WHERE t.payroll_period_id = ? AND t.group_text = 'EMPLOYER' AND t.post_as = 'DEBIT'${lineWhere} ORDER BY t.transaction_name, e.first_name, e.last_name`, periodId, ...lineParams);
      const rows: ReportRow[] = []; let cur: string | null = null; let sub = 0; let i = 0;
      const flush = () => { if (cur != null) rows.push({ kind: 'subtotal', cells: { no: null, emp_no: '', name: `Sub-Total — ${cur}`, department: '', amount: sub, balance: null } }); };
      for (const l of lines) {
        if (l.transaction_name !== cur) { flush(); cur = l.transaction_name; sub = 0; i = 0; rows.push({ kind: 'group', cells: { no: null, emp_no: l.transaction_code, name: l.transaction_name, department: '', amount: null, balance: null } }); }
        i += 1; rows.push({ cells: { no: i, emp_no: l.employee_no, name: l.staff_name, department: l.department, amount: n(l.amount), balance: l.balance == null ? null : n(l.balance) } }); sub += n(l.amount);
      }
      flush();
      return finish({ title: 'Payroll Company Deductions', forLabel: 'Payroll Company Deductions For', landscape: false, grouped: true,
        columns: [text('no', 'No', { kind: 'int', width: '5%' }), text('emp_no', 'Emp. No'), text('name', 'Employee Name'), text('department', 'Department'), money('amount', 'Amount'), money('balance', 'Balance', { sum: false })], rows });
    }
    case 'company': {
      // Rep52203530 Payroll Company Report — per group: Code | Transaction Name | Total Amount, then Gross Pay, Statutory, Other Deductions, NET SALARY, Bank Transfer Amount
      const lines = await all<{ group_text: string; group_order: number; transaction_code: string; transaction_name: string; amount: number; employees: number }>(
        `SELECT group_text, MIN(group_order) AS group_order, transaction_code, MIN(transaction_name) AS transaction_name, SUM(amount_cents) AS amount, COUNT(DISTINCT employee_id) AS employees
         FROM payroll_period_transaction t WHERE t.payroll_period_id = ? AND (t.post_as IS NULL OR t.post_as <> 'DEBIT' OR t.group_text IN ('BASIC SALARY','ALLOWANCE'))
           AND t.transaction_type <> 'MEMO'${lineWhere}
         GROUP BY t.group_text, t.transaction_code ORDER BY MIN(t.group_order), t.transaction_code`, periodId, ...lineParams);
      const rows: ReportRow[] = []; let cur: string | null = null; let sub = 0;
      const flush = () => { if (cur != null) rows.push({ kind: 'subtotal', cells: { code: '', name: `Total ${cur.toLowerCase()}`, employees: null, amount: sub } }); };
      for (const l of lines) {
        if (l.group_text !== cur) { flush(); cur = l.group_text; sub = 0; rows.push({ kind: 'group', cells: { code: cur, name: '', employees: null, amount: null } }); }
        rows.push({ cells: { code: l.transaction_code, name: l.transaction_name, employees: n(l.employees), amount: n(l.amount) } }); sub += n(l.amount);
      }
      flush();
      const gross = emps.reduce((s, e) => s + e.gross, 0); const net = emps.reduce((s, e) => s + e.net, 0);
      const statutory = emps.reduce((s, e) => s + e.nssf + e.shif + e.ahl + e.paye, 0); const other = emps.reduce((s, e) => s + e.deductions, 0);
      const bank = emps.filter((e) => e.payment_mode === 'Bank Transfer').reduce((s, e) => s + e.net, 0);
      return finish({ title: 'Payroll Company Report', forLabel: 'Company Payroll Totals For', landscape: false, grouped: true,
        columns: [text('code', 'Code'), text('name', 'Transaction Name'), text('employees', 'Employees', { kind: 'int' }), money('amount', 'Total Amount', { sum: false })],
        rows, meta: [
          { label: 'Gross Pay', value: formatMoney(gross) }, { label: 'Total Statutory Deductions', value: formatMoney(statutory) },
          { label: 'Total Other Deductions', value: formatMoney(other) }, { label: 'NET SALARY', value: formatMoney(net) },
          { label: 'Bank Transfer Amount', value: formatMoney(bank) }, { label: 'Paid by Cheque, Cash or M-Pesa', value: formatMoney(net - bank) },
        ] });
    }
    case 'costing': {
      // Rep52203540 — per transaction: Emp. Code | Staff Name | Job Group | Amount
      const lines = await all<{ transaction_code: string; transaction_name: string; group_text: string; employee_no: string; staff_name: string; job_grade: string | null; amount: number }>(
        `SELECT t.transaction_code, t.transaction_name, t.group_text, e.employee_no, t.staff_name, jg.name AS job_grade, SUM(t.amount_cents) AS amount
         FROM payroll_period_transaction t JOIN employee e ON e.id = t.employee_id LEFT JOIN hr_job_grade jg ON jg.id = e.job_grade_id
         WHERE t.payroll_period_id = ? AND t.transaction_type <> 'MEMO' AND (t.post_as = 'DEBIT' OR t.group_text = 'DEDUCTIONS' OR t.group_text = 'STATUTORIES')${lineWhere}
         GROUP BY t.transaction_code, t.transaction_name, t.group_text, e.employee_no, t.staff_name, jg.name, e.first_name, e.last_name
         ORDER BY MIN(t.group_order), t.transaction_code, e.first_name, e.last_name`, periodId, ...lineParams);
      const rows: ReportRow[] = []; let cur: string | null = null; let sub = 0;
      const flush = () => { if (cur != null) rows.push({ kind: 'subtotal', cells: { emp_no: '', name: `Total — ${cur}`, job_grade: '', amount: sub } }); };
      for (const l of lines) {
        const label = `${l.transaction_code} — ${l.transaction_name}`;
        if (label !== cur) { flush(); cur = label; sub = 0; rows.push({ kind: 'group', cells: { emp_no: l.transaction_code, name: l.transaction_name, job_grade: l.group_text, amount: null } }); }
        rows.push({ cells: { emp_no: l.employee_no, name: l.staff_name, job_grade: l.job_grade, amount: n(l.amount) } }); sub += n(l.amount);
      }
      flush();
      return finish({ title: 'Payroll Costing Report', forLabel: 'Payroll Costing Report For Period', landscape: false, grouped: true,
        columns: [text('emp_no', 'Emp. Code'), text('name', 'Staff Name'), text('job_grade', 'Job Group'), money('amount', 'Amount', { sum: false })], rows });
    }
  }
}

/* ------------------------------------------------------------------------------- printout */

const bare = (c: number) => formatMoney(c, { showSymbol: false });

/** The report as a PrintDocument — the RDLC's page: letterhead, "<Report> For : <period>", the
 *  numbered table with its Totals row, and the five-role signature strip. */
export async function buildPayrollReportPrint(periodId: number, key: PayrollReportKey, filters: ReportFilters = {}): Promise<PrintDocument | null> {
  const [brand, report] = await Promise.all([printBrand(), buildPayrollReport(periodId, key, filters)]);
  if (!brand) return null;
  const moneyFmt = documentMoney(brand, brand.currency_code);
  const cell = (c: ReportColumn, v: string | number | null): string => {
    if (v == null || v === '') return '';
    if (c.kind === 'money') return n(v) ? bare(n(v)) : '-';
    return String(v);
  };
  const rows: PrintRow[] = report.rows.map((r) => {
    if (r.kind === 'group') {
      const label = report.columns.map((c) => r.cells[c.key]).filter((v) => v != null && v !== '').join(' — ');
      return { muted: true, cells: { [report.columns[1]?.key ?? report.columns[0].key]: label } };
    }
    return { strong: r.kind === 'subtotal', cells: Object.fromEntries(report.columns.map((c) => [c.key, cell(c, r.cells[c.key] ?? null)])) };
  });
  const hasTotals = Object.keys(report.totals).length > 0;
  if (hasTotals && report.rows.length) {
    const first = report.columns.find((c) => !c.sum)?.key ?? report.columns[0].key;
    rows.push({ strong: true, cells: { [first]: 'Totals', ...Object.fromEntries(Object.entries(report.totals).map(([k, v]) => [k, v ? bare(v) : '-'])) } });
  }
  const signatures: PrintSignature[] = PAYROLL_REPORT_SIGNATORIES.map((s) => ({ label: `${s.label} — ${s.position}`, block: null }));
  return {
    brand,
    title: report.title,
    subtitle: `${report.forLabel} : ${report.period.period_name}`,
    landscape: report.landscape,
    status: { label: report.period.status, tone: report.period.status === 'CLOSED' || report.period.status === 'APPROVED' ? 'ok' : 'info' },
    parties: [],
    meta: [
      { label: report.forLabel, value: report.period.period_name },
      { label: 'Period', value: `${report.period.start_date} – ${report.period.end_date}` },
      { label: 'Employees', value: String(report.employees) },
      ...(report.appliedFilters ? [{ label: 'Applied Filters', value: report.appliedFilters }] : []),
      ...report.meta,
      ...(report.totals.amount != null ? [{ label: 'Total', value: moneyFmt(report.totals.amount), strong: true }]
        : report.totals.net != null ? [{ label: 'Total Net Pay', value: moneyFmt(report.totals.net), strong: true }] : []),
    ],
    columns: report.columns.map((c) => ({ key: c.key, label: c.label, align: c.kind === 'money' || c.kind === 'int' ? 'right' : 'left', width: c.width })),
    rows,
    empty: 'No employees were processed in this period.',
    totals: [],
    signatures,
    footnote: `${report.title} — ${report.period.period_name}. Figures are as processed in the payroll period; confidential.`,
  };
}
