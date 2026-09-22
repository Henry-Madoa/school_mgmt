/*
 * Employee Exit — maker-checker offboarding (AL "Employee Exit" + "Employee Exit Management"
 * codeunit). Lifecycle: Open -> Pending Approval -> Approved, then a clearance checklist
 * (per hr_clearance_section) runs independently of the approval workflow; once every section
 * clears, the employee flips to PENDING_FINAL_PAYMENT and the final-dues lines are handed to
 * Payroll's currently open period via lib/payroll.ts's transferExitDuesToPayroll().
 */
import { one, all, run, tx, nextSequence, audit } from './db.ts';
import { AppError } from './errors.ts';
import { getEmployee, getCurrentContract } from './employees.ts';
import { transferExitDuesToPayroll } from './payroll.ts';
import { findMatchingWorkflow, findPendingRoutedTask, pickConditionFields, startWorkflow } from './workflow.ts';
import { listClearanceSections } from './hrSetup.ts';
import { sendMail } from './mailer.ts';
import { buildFilterClause, type FilterCondition, type FilterFieldDef } from './listFilters.ts';
import { buildOrderClause, type SortState } from './listSort.ts';
import type {
  Actor, EmployeeExit, EmployeeExitView, EmployeeExitFinalDueLine, EmployeeExitClearanceLine,
  EmployeeExitClearanceLineView,
} from './types.ts';

export type ExitView = 'open' | 'pending' | 'approved';

const VIEW_CLAUSE: Record<ExitView, string> = {
  open: "x.status = 'Open'",
  pending: "x.status = 'Pending Approval'",
  approved: "x.status = 'Approved'",
};

const SELECT_ROW = `
  SELECT x.*, emp.employee_no, emp.first_name AS employee_first_name, emp.last_name AS employee_last_name
  FROM employee_exit x JOIN employee emp ON emp.id = x.employee_id`;

export const EXIT_FILTER_FIELDS: FilterFieldDef[] = [
  { key: 'no', label: 'No.', type: 'text', column: 'x.no' },
  { key: 'created_by', label: 'Created By', type: 'text', column: 'x.created_by' },
  { key: 'created_at', label: 'Created', type: 'date', column: 'x.created_at', datetime: true },
];

const SORT_COLUMNS: Record<string, string> = { no: 'x.no', employee: 'emp.first_name', status: 'x.status', date_of_exit: 'x.date_of_exit' };

export interface ListExitsOptions { view?: ExitView; search?: string; filters?: FilterCondition[]; sort?: SortState | null; }

export const listExits = (
  { view, search = '', filters = [], sort = null }: ListExitsOptions = {},
): Promise<EmployeeExitView[]> => {
  const { clause, params } = buildFilterClause(EXIT_FILTER_FIELDS, filters);
  const orderBy = buildOrderClause(SORT_COLUMNS, sort, 'x.no DESC');
  return all<EmployeeExitView>(
    `${SELECT_ROW}
     WHERE (x.no ILIKE @like OR emp.employee_no ILIKE @like OR emp.first_name ILIKE @like OR emp.last_name ILIKE @like)
       ${view ? `AND ${VIEW_CLAUSE[view]}` : ''}
       ${clause}
     ${orderBy}`,
    { like: `%${String(search).trim()}%`, ...params },
  );
};

export const getExit = (no: string): Promise<EmployeeExitView | undefined> =>
  one<EmployeeExitView>(`${SELECT_ROW} WHERE x.no = ?`, no);

export const hasAnyExits = async (view?: ExitView): Promise<boolean> =>
  !!(await one(`SELECT 1 FROM employee_exit x WHERE ${view ? VIEW_CLAUSE[view] : '1=1'} LIMIT 1`));

export const listFinalDueLines = (exitNo: string): Promise<EmployeeExitFinalDueLine[]> =>
  all('SELECT * FROM employee_exit_final_due_line WHERE exit_no = ? ORDER BY id', exitNo);

export const listClearanceLines = (exitNo: string): Promise<EmployeeExitClearanceLineView[]> =>
  all(
    `SELECT l.*, s.code AS section_code, s.name AS section_name, s.owner_email
     FROM employee_exit_clearance_line l JOIN hr_clearance_section s ON s.id = l.section_id
     WHERE l.exit_no = ? ORDER BY s.sort_order, s.name`,
    exitNo,
  );

/** The employee's leave balance for the singleton annual leave type — 0 until Leave Management's
 *  tables exist / the employee has no ledger history yet; failures are swallowed so Employee
 *  Exit stays usable standalone. */
async function annualLeaveBalanceDays(employeeId: number): Promise<number> {
  try {
    const row = await one<{ bal: number }>(
      `SELECT COALESCE(SUM(l.quantity), 0) AS bal FROM hr_leave_ledger_entry l
       JOIN hr_leave_type t ON t.id = l.leave_type_id
       WHERE l.employee_id = ? AND t.is_annual = true AND l.closed = false`,
      employeeId,
    );
    return Number(row?.bal ?? 0);
  } catch {
    return 0;
  }
}

/** Recomputes the auto-generated final-dues lines (leave encashment + notice shortfall) from
 *  the exit's current dates — called whenever those dates change while still Open. Any line an
 *  HR user has manually added stays untouched; only the AUTO-tagged ones are replaced. */
async function recomputeAutoFinalDues(no: string, user: Actor): Promise<void> {
  const exit = await one<EmployeeExit>('SELECT * FROM employee_exit WHERE no = ?', no);
  if (!exit) return;
  await run("DELETE FROM employee_exit_final_due_line WHERE exit_no = ? AND description = 'Auto-calculated'", no);
  if (!exit.date_of_exit) return;

  const emp = await getEmployee(exit.employee_id);
  const contract = await getCurrentContract(exit.employee_id);
  const basicPay = Number(contract?.salary_cents || 0);
  const dailyRate = basicPay / 30;

  const leaveBalance = await annualLeaveBalanceDays(exit.employee_id);
  if (leaveBalance > 0 && dailyRate > 0) {
    await run(
      "INSERT INTO employee_exit_final_due_line (exit_no, due_type, description, amount_cents) VALUES (?,?,?,?)",
      no, 'LEAVE_ENCASHMENT', 'Auto-calculated', Math.round(dailyRate * leaveBalance),
    );
  }

  if (exit.date_of_notice && exit.notice_period_days != null && dailyRate > 0) {
    const noticeExpiry = addDays(exit.date_of_notice, exit.notice_period_days);
    const shortfallDays = daysBetween(exit.date_of_exit, noticeExpiry);
    if (shortfallDays > 0) {
      await run(
        "INSERT INTO employee_exit_final_due_line (exit_no, due_type, description, amount_cents) VALUES (?,?,?,?)",
        no, 'NOTICE_PENALTY', 'Auto-calculated', Math.round(dailyRate * shortfallDays),
      );
      await run("UPDATE employee_exit SET notice_fully_served = false WHERE no = ?", no);
    } else {
      await run("UPDATE employee_exit SET notice_fully_served = true WHERE no = ?", no);
    }
  }

  if (emp) {
    const reason = exit.termination_reason_id
      ? await one<{ pay_gratuity: boolean }>('SELECT pay_gratuity FROM hr_termination_reason WHERE id = ?', exit.termination_reason_id)
      : undefined;
    if (reason?.pay_gratuity) {
      await run(
        "INSERT INTO employee_exit_final_due_line (exit_no, due_type, description, amount_cents) VALUES (?,?,?,?)",
        no, 'GRATUITY', 'Auto-calculated — confirm rate with Payroll', 0,
      );
    }
  }
  await audit(user, 'EMPLOYEE_EXIT_RECOMPUTE_DUES', 'employee_exit', no, {});
}

export interface ExitInput {
  employeeId: number; terminationReasonId?: number | null; dateOfNotice?: string | null; dateOfExit?: string | null;
  noticePeriodDays?: number | null; canBeReemployed?: boolean | null; reasonsForNotServingNotice?: string | null;
}

export async function createExit(input: ExitInput, user: Actor): Promise<{ no: string }> {
  if (!input.employeeId) throw new AppError('An employee is required', 'VALIDATION');
  const emp = await getEmployee(input.employeeId);
  if (!emp) throw new AppError('Employee not found', 'NOT_FOUND');
  if (!['ACTIVE', 'ON_LEAVE'].includes(emp.status)) throw new AppError('Only an active employee can be exited', 'VALIDATION');
  if (await one("SELECT 1 FROM employee_exit WHERE employee_id = ? AND status != 'Approved'", input.employeeId)) {
    throw new AppError('This employee already has an exit request in progress', 'DUPLICATE_REQUEST');
  }

  const no = await nextSequence('EMPLOYEE_EXIT');
  const noticePeriodDays = input.noticePeriodDays
    ?? (emp.probation_status === 'ON_PROBATION' ? 7 : (await gradeNoticeDays(emp.job_grade_id)));

  await tx(async () => {
    await run(
      `INSERT INTO employee_exit
         (no, employee_id, termination_reason_id, date_of_notice, date_of_exit, notice_period_days,
          reasons_for_not_serving_notice, can_be_reemployed, created_at, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      no, input.employeeId, input.terminationReasonId ?? null, input.dateOfNotice ?? null, input.dateOfExit ?? null,
      noticePeriodDays, input.reasonsForNotServingNotice?.trim() || null, input.canBeReemployed ?? null,
      new Date().toISOString(), user.username,
    );
    const sections = await listClearanceSections();
    for (const s of sections) {
      await run('INSERT INTO employee_exit_clearance_line (exit_no, section_id) VALUES (?,?)', no, s.id);
    }
    await recomputeAutoFinalDues(no, user);
  });
  await audit(user, 'EMPLOYEE_EXIT_CREATE', 'employee_exit', no, {});
  return { no };
}

async function gradeNoticeDays(gradeId: number | null): Promise<number> {
  if (!gradeId) return 30;
  const g = await one<{ notice_period_days: number }>('SELECT notice_period_days FROM hr_job_grade WHERE id = ?', gradeId);
  return g?.notice_period_days ?? 30;
}

export async function updateExit(no: string, input: Partial<ExitInput>, user: Actor): Promise<EmployeeExitView> {
  const before = await one<EmployeeExit>('SELECT * FROM employee_exit WHERE no = ?', no);
  if (!before) throw new AppError('Exit request not found', 'NOT_FOUND');
  if (before.status !== 'Open') throw new AppError('Only an open exit request can be edited', 'VALIDATION');

  const cols: [string, unknown][] = [];
  if (input.terminationReasonId !== undefined) cols.push(['termination_reason_id', input.terminationReasonId]);
  if (input.dateOfNotice !== undefined) cols.push(['date_of_notice', input.dateOfNotice]);
  if (input.dateOfExit !== undefined) cols.push(['date_of_exit', input.dateOfExit]);
  if (input.noticePeriodDays !== undefined) cols.push(['notice_period_days', input.noticePeriodDays]);
  if (input.canBeReemployed !== undefined) cols.push(['can_be_reemployed', input.canBeReemployed]);
  if (input.reasonsForNotServingNotice !== undefined) cols.push(['reasons_for_not_serving_notice', input.reasonsForNotServingNotice]);

  if (cols.length) {
    await run(`UPDATE employee_exit SET ${cols.map(([c]) => `${c}=?`).join(',')} WHERE no=?`, ...cols.map(([, v]) => v), no);
    await recomputeAutoFinalDues(no, user);
    await audit(user, 'EMPLOYEE_EXIT_UPDATE', 'employee_exit', no, {});
  }
  return (await getExit(no))!;
}

/** Adds/overrides a manual final-dues line — anything not tagged "Auto-calculated" survives
 *  recomputeAutoFinalDues(). */
export async function addFinalDueLine(
  no: string, line: { dueType: EmployeeExitFinalDueLine['due_type']; description?: string | null; amountCents: number }, user: Actor,
): Promise<void> {
  const exit = await one<Pick<EmployeeExit, 'status'>>('SELECT status FROM employee_exit WHERE no = ?', no);
  if (!exit) throw new AppError('Exit request not found', 'NOT_FOUND');
  if (exit.status !== 'Open') throw new AppError('Only an open exit request can be edited', 'VALIDATION');
  await run(
    'INSERT INTO employee_exit_final_due_line (exit_no, due_type, description, amount_cents) VALUES (?,?,?,?)',
    no, line.dueType, line.description?.trim() || null, Math.round(line.amountCents),
  );
  await audit(user, 'EMPLOYEE_EXIT_ADD_DUE_LINE', 'employee_exit', no, { dueType: line.dueType });
}

export async function removeFinalDueLine(no: string, lineId: number, user: Actor): Promise<void> {
  const exit = await one<Pick<EmployeeExit, 'status'>>('SELECT status FROM employee_exit WHERE no = ?', no);
  if (!exit) throw new AppError('Exit request not found', 'NOT_FOUND');
  if (exit.status !== 'Open') throw new AppError('Only an open exit request can be edited', 'VALIDATION');
  await run('DELETE FROM employee_exit_final_due_line WHERE id = ? AND exit_no = ?', lineId, no);
  await audit(user, 'EMPLOYEE_EXIT_REMOVE_DUE_LINE', 'employee_exit', no, { lineId });
}

/* -------------------------------------------------------------------------- maker-checker */

export async function submitExit(no: string, user: Actor): Promise<{ autoApproved: boolean }> {
  const req = await one<EmployeeExit>('SELECT * FROM employee_exit WHERE no = ?', no);
  if (!req) throw new AppError('Exit request not found', 'NOT_FOUND');
  if (req.status !== 'Open') throw new AppError('Only an open exit request can be submitted for approval', 'VALIDATION');
  if (!req.date_of_notice || !req.date_of_exit || !req.termination_reason_id) {
    throw new AppError('Reason, date of notice and date of exit are required before sending for approval', 'VALIDATION');
  }

  const matched = await findMatchingWorkflow('EMPLOYEE_EXIT', await pickConditionFields('EMPLOYEE_EXIT', req));
  if (!matched) throw new AppError('There is no enabled workflow for this document', 'NO_WORKFLOW');

  await tx(async () => {
    await run("UPDATE employee_exit SET status = 'Pending Approval' WHERE no = ?", no);
    await startWorkflow(matched.workflow, matched.steps, { documentType: 'EMPLOYEE_EXIT', entityId: no, requestedBy: user.username, amount: 0 });
  });
  const after = await one<{ status: string }>('SELECT status FROM employee_exit WHERE no = ?', no);
  return { autoApproved: after?.status === 'Approved' };
}

export async function cancelExitApproval(no: string, user: Actor): Promise<void> {
  const req = await one<Pick<EmployeeExit, 'status' | 'created_by'>>('SELECT status, created_by FROM employee_exit WHERE no = ?', no);
  if (!req) throw new AppError('Exit request not found', 'NOT_FOUND');
  if (req.status !== 'Pending Approval') throw new AppError('Only a request pending approval can be recalled', 'VALIDATION');
  const routed = await findPendingRoutedTask('EMPLOYEE_EXIT', no);
  const requestedBy = routed?.requested_by ?? req.created_by;
  if (requestedBy !== user.username) throw new AppError('Only the person who submitted this can cancel it', 'NOT_REQUESTER');
  await run("UPDATE employee_exit SET status = 'Open' WHERE no = ?", no);
  await audit(user, 'EMPLOYEE_EXIT_CANCEL_APPROVAL', 'employee_exit', no, {});
}

export async function rejectExit(no: string, reason: string | null, user: Actor): Promise<void> {
  if (!reason?.trim()) throw new AppError('A reason is required to reject a request', 'VALIDATION');
  const req = await one<EmployeeExit>('SELECT * FROM employee_exit WHERE no = ?', no);
  if (!req) throw new AppError('Exit request not found', 'NOT_FOUND');
  if (req.status !== 'Pending Approval') throw new AppError('Only a request pending approval can be rejected', 'VALIDATION');
  await run("UPDATE employee_exit SET status = 'Open', decision_reason = ? WHERE no = ?", reason, no);
  await audit(user, 'EMPLOYEE_EXIT_REJECT', 'employee_exit', no, { reason });
}

/** Approval doesn't itself change the employee — clearance (below) does. It emails every
 *  clearance section owner (AL's SendExitClearanceFormToSections), matching Employee Exit
 *  Management's split between "approved" and "cleared". */
export async function approveExit(no: string, user: Actor): Promise<void> {
  const req = await getExit(no);
  if (!req) throw new AppError('Exit request not found', 'NOT_FOUND');
  if (req.status !== 'Pending Approval') throw new AppError('Only a request pending approval can be approved', 'VALIDATION');
  await run("UPDATE employee_exit SET status = 'Approved', decision_reason = NULL WHERE no = ?", no);
  await audit(user, 'EMPLOYEE_EXIT_APPROVE', 'employee_exit', no, {});

  const sections = await listClearanceLines(no);
  await Promise.all(sections.filter((s) => s.owner_email).map((s) => sendMail({
    to: s.owner_email!,
    subject: `Exit clearance required — ${req.employee_first_name} ${req.employee_last_name} (${req.employee_no})`,
    html: `<p>${req.employee_first_name} ${req.employee_last_name} (${req.employee_no}) is exiting on ${req.date_of_exit}.</p>
           <p>Please clear the <b>${s.section_name}</b> section for exit request ${no}.</p>`,
  })));
}

/** Clears one section; when every section is cleared, flips the employee to Pending Final
 *  Payment and marks the exit cleared — the point Payroll's transferExitDuesToPayroll() (added
 *  in the Payroll phase) picks up from. */
export async function clearExitSection(
  no: string, sectionId: number, remarks: string | null, user: Actor,
): Promise<{ fullyCleared: boolean }> {
  return tx(async () => {
    const exit = await one<EmployeeExit>('SELECT * FROM employee_exit WHERE no = ?', no);
    if (!exit) throw new AppError('Exit request not found', 'NOT_FOUND');
    if (exit.status !== 'Approved') throw new AppError('Only an approved exit can be cleared', 'VALIDATION');

    await run(
      'UPDATE employee_exit_clearance_line SET cleared = true, cleared_by = ?, cleared_at = ?, remarks = ? WHERE exit_no = ? AND section_id = ?',
      user.username, new Date().toISOString(), remarks?.trim() || null, no, sectionId,
    );
    const remaining = await one('SELECT 1 FROM employee_exit_clearance_line WHERE exit_no = ? AND cleared = false LIMIT 1', no);
    const fullyCleared = !remaining;
    if (fullyCleared) {
      await run("UPDATE employee_exit SET cleared = true WHERE no = ?", no);
      await run("UPDATE employee SET status = 'PENDING_FINAL_PAYMENT' WHERE id = ?", exit.employee_id);
      await transferExitDuesToPayroll(no, user);
    }
    await audit(user, 'EMPLOYEE_EXIT_CLEAR_SECTION', 'employee_exit', no, { sectionId, fullyCleared });
    return { fullyCleared };
  });
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso + 'T00:00:00Z').getTime();
  const b = new Date(toIso + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86_400_000);
}
