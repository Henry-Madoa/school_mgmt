/*
 * Leave Management — ported from the ERP AL. Balance is always SUM(hr_leave_ledger_entry.
 * quantity) for the employee/type/calendar — an append-only signed ledger, never a stored
 * mutable column. Day-counting (weekend/holiday exclusion per leave type) is one shared pure
 * function, replacing AL's logic triplicated across Leave Applications/Recall/Plan Lines.
 * Posting collapses AL's Journal Template/Batch/Line/Register indirection (BC plumbing this app
 * doesn't need) into a direct transactional ledger insert.
 */
import { one, all, run, tx, nextSequence, audit } from './db.ts';
import { AppError } from './errors.ts';
import { getEmployee } from './employees.ts';
import { applyLeaveAllowance } from './payroll.ts';
import { sendMail } from './mailer.ts';
import { findMatchingWorkflow, findPendingRoutedTask, pickConditionFields, startWorkflow } from './workflow.ts';
import { buildFilterClause, type FilterCondition, type FilterFieldDef } from './listFilters.ts';
import { buildOrderClause, type SortState } from './listSort.ts';
import type {
  Actor, HrLeaveType, HrLeaveCalendar, HrHoliday, HrLeaveDaysToAccrue, LeaveLedgerEntryType,
  HrLeaveApplication, HrLeaveApplicationView, LeaveApplicationNature,
  HrLeaveAdjustment, HrLeaveAdjustmentView, HrLeaveAdjustmentLineView,
  HrLeaveRecall, HrLeaveRecallView, HrLeavePlan, HrLeavePlanView, HrLeavePlanLine, HrLeaveLedgerEntry,
} from './types.ts';

/* ======================================================================================= setup */

export const listLeaveTypes = (): Promise<HrLeaveType[]> => all<HrLeaveType>('SELECT * FROM hr_leave_type ORDER BY name');
export const getLeaveType = (id: number): Promise<HrLeaveType | undefined> => one<HrLeaveType>('SELECT * FROM hr_leave_type WHERE id = ?', id);
export const getAnnualLeaveType = (): Promise<HrLeaveType | undefined> => one<HrLeaveType>('SELECT * FROM hr_leave_type WHERE is_annual = true');

export interface LeaveTypeInput {
  id?: number | null; code: string; name: string; standardDays?: number; accrues?: boolean;
  daysToAccrue?: number; unlimitedDays?: boolean; gender?: string; balanceTreatment?: string;
  maxCarryForwardDays?: number; inclusiveOfSaturday?: boolean; inclusiveOfSunday?: boolean;
  inclusiveOfHolidays?: boolean; fixedDays?: boolean; isAnnual?: boolean; maxApplicableDays?: number | null;
  checkBalance?: boolean; isSickLeave?: boolean; requiresAdminApproval?: boolean;
  leaveBalanceNotificationThreshold?: number | null; disabled?: boolean;
}

export async function saveLeaveType(input: LeaveTypeInput, user: Actor): Promise<{ id: number }> {
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  if (!code) throw new AppError('A code is required', 'VALIDATION');
  if (!name) throw new AppError('A name is required', 'VALIDATION');

  const fields = {
    standard_days: Number(input.standardDays) || 0,
    accrues: !!input.accrues,
    days_to_accrue: Number(input.daysToAccrue) || 0,
    unlimited_days: !!input.unlimitedDays,
    gender: input.gender || 'ANY',
    balance_treatment: input.balanceTreatment || 'IGNORE',
    max_carry_forward_days: Number(input.maxCarryForwardDays) || 0,
    inclusive_of_saturday: !!input.inclusiveOfSaturday,
    inclusive_of_sunday: !!input.inclusiveOfSunday,
    inclusive_of_holidays: !!input.inclusiveOfHolidays,
    fixed_days: !!input.fixedDays,
    is_annual: !!input.isAnnual,
    max_applicable_days: input.maxApplicableDays ?? null,
    check_balance: input.checkBalance !== false,
    is_sick_leave: !!input.isSickLeave,
    requires_admin_approval: !!input.requiresAdminApproval,
    leave_balance_notification_threshold: input.leaveBalanceNotificationThreshold ?? null,
    disabled: !!input.disabled,
  };

  return tx(async () => {
    // AL's "Is Annual Leave" singleton: force-unset any other type first (the DB's own partial
    // unique index is the hard backstop; this keeps the UI from just erroring on a re-pick).
    if (fields.is_annual) await run('UPDATE hr_leave_type SET is_annual = false WHERE is_annual = true');

    if (input.id) {
      const dup = await one('SELECT 1 FROM hr_leave_type WHERE code = ? AND id != ?', code, input.id);
      if (dup) throw new AppError('That code already exists', 'DUPLICATE');
      await run(
        `UPDATE hr_leave_type SET code=?, name=?, standard_days=?, accrues=?, days_to_accrue=?, unlimited_days=?,
           gender=?, balance_treatment=?, max_carry_forward_days=?, inclusive_of_saturday=?, inclusive_of_sunday=?,
           inclusive_of_holidays=?, fixed_days=?, is_annual=?, max_applicable_days=?, check_balance=?, is_sick_leave=?,
           requires_admin_approval=?, leave_balance_notification_threshold=?, disabled=? WHERE id=?`,
        code, name, fields.standard_days, fields.accrues, fields.days_to_accrue, fields.unlimited_days,
        fields.gender, fields.balance_treatment, fields.max_carry_forward_days, fields.inclusive_of_saturday,
        fields.inclusive_of_sunday, fields.inclusive_of_holidays, fields.fixed_days, fields.is_annual,
        fields.max_applicable_days, fields.check_balance, fields.is_sick_leave, fields.requires_admin_approval,
        fields.leave_balance_notification_threshold, fields.disabled, input.id,
      );
      await audit(user, 'HR_LEAVE_TYPE_UPDATE', 'hr_leave_type', input.id, {});
      return { id: input.id };
    }
    if (await one('SELECT 1 FROM hr_leave_type WHERE code = ?', code)) throw new AppError('That code already exists', 'DUPLICATE');
    const info = await run(
      `INSERT INTO hr_leave_type
         (code, name, standard_days, accrues, days_to_accrue, unlimited_days, gender, balance_treatment,
          max_carry_forward_days, inclusive_of_saturday, inclusive_of_sunday, inclusive_of_holidays, fixed_days,
          is_annual, max_applicable_days, check_balance, is_sick_leave, requires_admin_approval,
          leave_balance_notification_threshold, disabled, created_at, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      code, name, fields.standard_days, fields.accrues, fields.days_to_accrue, fields.unlimited_days,
      fields.gender, fields.balance_treatment, fields.max_carry_forward_days, fields.inclusive_of_saturday,
      fields.inclusive_of_sunday, fields.inclusive_of_holidays, fields.fixed_days, fields.is_annual,
      fields.max_applicable_days, fields.check_balance, fields.is_sick_leave, fields.requires_admin_approval,
      fields.leave_balance_notification_threshold, fields.disabled, new Date().toISOString(), user.username,
    );
    await audit(user, 'HR_LEAVE_TYPE_CREATE', 'hr_leave_type', info.lastInsertRowid, {});
    return { id: Number(info.lastInsertRowid) };
  });
}

export async function deleteLeaveType(id: number, user: Actor): Promise<void> {
  if (await one('SELECT 1 FROM hr_leave_ledger_entry WHERE leave_type_id = ?', id)) {
    throw new AppError('This leave type has ledger history and cannot be removed', 'IN_USE');
  }
  await run('DELETE FROM hr_leave_type WHERE id = ?', id);
  await audit(user, 'HR_LEAVE_TYPE_DELETE', 'hr_leave_type', id, {});
}

export const listLeaveCalendars = (): Promise<HrLeaveCalendar[]> => all('SELECT * FROM hr_leave_calendar ORDER BY start_date DESC');
export const getCurrentLeaveCalendar = (): Promise<HrLeaveCalendar | undefined> => one('SELECT * FROM hr_leave_calendar WHERE is_current = true');

export async function createLeaveCalendar(
  input: { code: string; startDate: string; endDate: string; makeCurrent?: boolean }, user: Actor,
): Promise<{ id: number }> {
  const code = input.code.trim();
  if (!code) throw new AppError('A code is required', 'VALIDATION');
  if (!input.startDate || !input.endDate) throw new AppError('Start and end dates are required', 'VALIDATION');
  return tx(async () => {
    if (input.makeCurrent) await run('UPDATE hr_leave_calendar SET is_current = false WHERE is_current = true');
    const info = await run(
      'INSERT INTO hr_leave_calendar (code, start_date, end_date, is_current, created_at, created_by) VALUES (?,?,?,?,?,?)',
      code, input.startDate, input.endDate, !!input.makeCurrent, new Date().toISOString(), user.username,
    );
    await audit(user, 'HR_LEAVE_CALENDAR_CREATE', 'hr_leave_calendar', info.lastInsertRowid, {});
    return { id: Number(info.lastInsertRowid) };
  });
}

export const listHolidays = (): Promise<HrHoliday[]> => all('SELECT * FROM hr_holiday ORDER BY date');

export async function saveHoliday(input: { id?: number | null; date: string; reason: string; recurring?: boolean }, user: Actor): Promise<{ id: number }> {
  if (!input.date) throw new AppError('A date is required', 'VALIDATION');
  if (!input.reason?.trim()) throw new AppError('A reason is required', 'VALIDATION');
  if (input.id) {
    await run('UPDATE hr_holiday SET date=?, reason=?, recurring=? WHERE id=?', input.date, input.reason.trim(), !!input.recurring, input.id);
    await audit(user, 'HR_HOLIDAY_UPDATE', 'hr_holiday', input.id, {});
    return { id: input.id };
  }
  if (await one('SELECT 1 FROM hr_holiday WHERE date = ?', input.date)) throw new AppError('That date is already a holiday', 'DUPLICATE');
  const info = await run('INSERT INTO hr_holiday (date, reason, recurring) VALUES (?,?,?)', input.date, input.reason.trim(), !!input.recurring);
  await audit(user, 'HR_HOLIDAY_CREATE', 'hr_holiday', info.lastInsertRowid, {});
  return { id: Number(info.lastInsertRowid) };
}

export async function deleteHoliday(id: number, user: Actor): Promise<void> {
  await run('DELETE FROM hr_holiday WHERE id = ?', id);
  await audit(user, 'HR_HOLIDAY_DELETE', 'hr_holiday', id, {});
}

export const listAccrueMatrix = (): Promise<(HrLeaveDaysToAccrue & { leave_type_name: string; job_grade_name: string })[]> =>
  all(
    `SELECT m.*, lt.name AS leave_type_name, jg.name AS job_grade_name
     FROM hr_leave_days_to_accrue m
     JOIN hr_leave_type lt ON lt.id = m.leave_type_id JOIN hr_job_grade jg ON jg.id = m.job_grade_id
     ORDER BY lt.name, jg.name`,
  );

export async function saveAccrueMatrixRow(
  input: { id?: number | null; leaveTypeId: number; jobGradeId: number; daysToAccrue: number; leaveDayWorthCents?: number }, user: Actor,
): Promise<{ id: number }> {
  if (!input.leaveTypeId || !input.jobGradeId) throw new AppError('A leave type and job grade are required', 'VALIDATION');
  const dup = await one<{ id: number }>(
    'SELECT id FROM hr_leave_days_to_accrue WHERE leave_type_id = ? AND job_grade_id = ?', input.leaveTypeId, input.jobGradeId,
  );
  if (dup && dup.id !== input.id) throw new AppError('A row for this leave type and grade already exists', 'DUPLICATE');
  if (input.id) {
    await run(
      'UPDATE hr_leave_days_to_accrue SET leave_type_id=?, job_grade_id=?, days_to_accrue=?, leave_day_worth_cents=? WHERE id=?',
      input.leaveTypeId, input.jobGradeId, Number(input.daysToAccrue) || 0, Math.round(Number(input.leaveDayWorthCents) || 0), input.id,
    );
    await audit(user, 'HR_ACCRUE_MATRIX_UPDATE', 'hr_leave_days_to_accrue', input.id, {});
    return { id: input.id };
  }
  const info = await run(
    'INSERT INTO hr_leave_days_to_accrue (leave_type_id, job_grade_id, days_to_accrue, leave_day_worth_cents) VALUES (?,?,?,?)',
    input.leaveTypeId, input.jobGradeId, Number(input.daysToAccrue) || 0, Math.round(Number(input.leaveDayWorthCents) || 0),
  );
  await audit(user, 'HR_ACCRUE_MATRIX_CREATE', 'hr_leave_days_to_accrue', info.lastInsertRowid, {});
  return { id: Number(info.lastInsertRowid) };
}

export async function deleteAccrueMatrixRow(id: number, user: Actor): Promise<void> {
  await run('DELETE FROM hr_leave_days_to_accrue WHERE id = ?', id);
  await audit(user, 'HR_ACCRUE_MATRIX_DELETE', 'hr_leave_days_to_accrue', id, {});
}

/* =================================================================================== day-count */

export interface DayCountResult { daysApplied: number; weekendDays: number; holidayDays: number; totalDays: number }

/** The single shared implementation of AL's triplicated day-counting logic (Leave Applications /
 *  Recall / Plan Lines): walks every calendar day from start to end inclusive, and a day consumes
 *  a leave day unless it's a Saturday/Sunday/holiday the leave type doesn't mark inclusive. */
export function countLeaveDays(startDate: string, endDate: string, type: Pick<HrLeaveType, 'inclusive_of_saturday' | 'inclusive_of_sunday' | 'inclusive_of_holidays'>, holidays: Set<string>): DayCountResult {
  let daysApplied = 0; let weekendDays = 0; let holidayDays = 0; let totalDays = 0;
  const d = new Date(startDate + 'T00:00:00Z');
  const end = new Date(endDate + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || Number.isNaN(end.getTime()) || d.getTime() > end.getTime()) {
    throw new AppError('Invalid date range', 'VALIDATION');
  }
  while (d.getTime() <= end.getTime()) {
    totalDays += 1;
    const dow = d.getUTCDay();
    const iso = d.toISOString().slice(0, 10);
    const isSaturday = dow === 6; const isSunday = dow === 0;
    const isHoliday = holidays.has(iso);
    if (isSaturday || isSunday) weekendDays += 1;
    if (isHoliday) holidayDays += 1;
    let counts = true;
    if (isSaturday && !type.inclusive_of_saturday) counts = false;
    if (isSunday && !type.inclusive_of_sunday) counts = false;
    if (isHoliday && !type.inclusive_of_holidays) counts = false;
    if (counts) daysApplied += 1;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return { daysApplied, weekendDays, holidayDays, totalDays };
}

async function holidaySet(): Promise<Set<string>> {
  const rows = await all<{ date: string }>('SELECT date FROM hr_holiday');
  return new Set(rows.map((r) => r.date));
}

/* ======================================================================================= ledger */

export const getLeaveBalance = async (employeeId: number, leaveTypeId: number, leaveCalendarId: number): Promise<number> => {
  const row = await one<{ bal: number }>(
    'SELECT COALESCE(SUM(quantity), 0) AS bal FROM hr_leave_ledger_entry WHERE employee_id = ? AND leave_type_id = ? AND leave_calendar_id = ? AND closed = false',
    employeeId, leaveTypeId, leaveCalendarId,
  );
  return Number(row?.bal ?? 0);
};

export interface PostLedgerEntryInput {
  employeeId: number; leaveTypeId: number; leaveCalendarId: number; quantity: number; entryType: LeaveLedgerEntryType;
  postingDate: string; documentNo?: string | null; sourceType?: string | null; sourceId?: string | null; description?: string | null;
}

export async function postLeaveLedgerEntry(input: PostLedgerEntryInput, user: Actor): Promise<void> {
  await run(
    `INSERT INTO hr_leave_ledger_entry
       (employee_id, leave_type_id, leave_calendar_id, quantity, entry_type, posting_date, document_no,
        source_type, source_id, description, created_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    input.employeeId, input.leaveTypeId, input.leaveCalendarId, input.quantity, input.entryType, input.postingDate,
    input.documentNo ?? null, input.sourceType ?? null, input.sourceId ?? null, input.description ?? null,
    new Date().toISOString(), user.username,
  );
}

export const listLedgerEntriesForEmployee = (employeeId: number): Promise<(HrLeaveLedgerEntry & { leave_type_name: string })[]> =>
  all(
    `SELECT l.*, t.name AS leave_type_name FROM hr_leave_ledger_entry l JOIN hr_leave_type t ON t.id = l.leave_type_id
     WHERE l.employee_id = ? ORDER BY l.posting_date DESC, l.id DESC`,
    employeeId,
  );

/* =================================================================================== applications */

export type LeaveApplicationView2 = 'open' | 'pending' | 'approved' | 'processed';
const APP_VIEW_CLAUSE: Record<LeaveApplicationView2, string> = {
  open: "a.status = 'Open'", pending: "a.status = 'Pending Approval'", approved: "a.status = 'Approved'", processed: "a.status = 'Processed'",
};

const SELECT_APPLICATION = `
  SELECT a.*, emp.employee_no, emp.first_name AS employee_first_name, emp.last_name AS employee_last_name,
         lt.name AS leave_type_name, rel.first_name AS reliever_first_name, rel.last_name AS reliever_last_name
  FROM hr_leave_application a
  JOIN employee emp ON emp.id = a.employee_id
  JOIN hr_leave_type lt ON lt.id = a.leave_type_id
  LEFT JOIN employee rel ON rel.id = a.reliever_id`;

export const LEAVE_APPLICATION_FILTER_FIELDS: FilterFieldDef[] = [
  { key: 'no', label: 'No.', type: 'text', column: 'a.no' },
  { key: 'leave_type_id', label: 'Leave Type', type: 'select', column: 'a.leave_type_id' },
  { key: 'start_date', label: 'Start Date', type: 'date', column: 'a.start_date' },
  { key: 'created_by', label: 'Created By', type: 'text', column: 'a.created_by' },
];
const APP_SORT_COLUMNS: Record<string, string> = { no: 'a.no', employee: 'emp.first_name', start_date: 'a.start_date', status: 'a.status' };

export interface ListLeaveApplicationsOptions {
  view?: LeaveApplicationView2; search?: string; filters?: FilterCondition[]; sort?: SortState | null;
  /** Employee Self Service: only this employee's applications (the AL "SS" list's SourceTableView). */
  employeeId?: number | null;
}

export async function listLeaveApplications(
  { view, search = '', filters = [], sort = null, employeeId = null }: ListLeaveApplicationsOptions = {},
): Promise<HrLeaveApplicationView[]> {
  const { clause, params } = buildFilterClause(LEAVE_APPLICATION_FILTER_FIELDS, filters);
  const orderBy = buildOrderClause(APP_SORT_COLUMNS, sort, 'a.no DESC');
  const rows = await all<HrLeaveApplicationView>(
    `${SELECT_APPLICATION}
     WHERE (a.no ILIKE @like OR emp.employee_no ILIKE @like OR emp.first_name ILIKE @like OR emp.last_name ILIKE @like)
       ${view ? `AND ${APP_VIEW_CLAUSE[view]}` : ''}
       ${employeeId ? 'AND a.employee_id = @employeeId' : ''}
       ${clause}
     ${orderBy}`,
    { like: `%${String(search).trim()}%`, ...(employeeId ? { employeeId } : {}), ...params },
  );
  for (const r of rows) r.balance = await getLeaveBalance(r.employee_id, r.leave_type_id, r.leave_calendar_id);
  return rows;
}

export async function getLeaveApplication(no: string): Promise<HrLeaveApplicationView | undefined> {
  const r = await one<HrLeaveApplicationView>(`${SELECT_APPLICATION} WHERE a.no = ?`, no);
  if (r) r.balance = await getLeaveBalance(r.employee_id, r.leave_type_id, r.leave_calendar_id);
  return r;
}

export const hasAnyLeaveApplications = async (view?: LeaveApplicationView2): Promise<boolean> =>
  !!(await one(`SELECT 1 FROM hr_leave_application a WHERE ${view ? APP_VIEW_CLAUSE[view] : '1=1'} LIMIT 1`));

export interface LeaveApplicationInput {
  employeeId: number; leaveTypeId: number; nature?: LeaveApplicationNature; startDate: string; endDate: string;
  relieverId?: number | null; leaveAllowancePayable?: boolean;
  daysDropped?: number | null; daysToReimburse?: number | null; justification?: string | null;
}

async function assertNoOverlap(employeeId: number, startDate: string, endDate: string, excludeNo?: string): Promise<void> {
  const overlap = await one(
    `SELECT 1 FROM hr_leave_application
     WHERE employee_id = ? AND status IN ('Open','Pending Approval','Approved') AND nature = 'APPLICATION'
       AND no != ? AND start_date <= ? AND end_date >= ?`,
    employeeId, excludeNo ?? '', endDate, startDate,
  );
  if (overlap) throw new AppError('This employee already has an overlapping leave application', 'VALIDATION');
}

export async function createLeaveApplication(input: LeaveApplicationInput, user: Actor): Promise<{ no: string }> {
  const emp = await getEmployee(input.employeeId);
  if (!emp) throw new AppError('Employee not found', 'NOT_FOUND');
  if (!['ACTIVE', 'ON_LEAVE'].includes(emp.status)) throw new AppError('Only an active employee can apply for leave', 'VALIDATION');
  const type = await getLeaveType(input.leaveTypeId);
  if (!type) throw new AppError('Leave type not found', 'NOT_FOUND');
  if (type.gender !== 'ANY' && emp.gender && type.gender !== emp.gender) {
    throw new AppError(`${type.name} is restricted to ${type.gender.toLowerCase()} employees`, 'VALIDATION');
  }
  const calendar = await getCurrentLeaveCalendar();
  if (!calendar) throw new AppError('There is no current leave calendar — set one up first', 'VALIDATION');
  if (!input.startDate || !input.endDate) throw new AppError('Start and end dates are required', 'VALIDATION');
  await assertNoOverlap(input.employeeId, input.startDate, input.endDate);

  const nature: LeaveApplicationNature = input.nature === 'REIMBURSEMENT' ? 'REIMBURSEMENT' : 'APPLICATION';
  let daysApplied = 0; let weekendDays = 0; let holidayDays = 0; let totalDays = 0;
  if (nature === 'APPLICATION') {
    const holidays = await holidaySet();
    const count = countLeaveDays(input.startDate, input.endDate, type, holidays);
    daysApplied = count.daysApplied; weekendDays = count.weekendDays; holidayDays = count.holidayDays; totalDays = count.totalDays;
    if (type.max_applicable_days != null && daysApplied > type.max_applicable_days) {
      throw new AppError(`${type.name} cannot exceed ${type.max_applicable_days} days per application`, 'VALIDATION');
    }
    if (type.check_balance && !type.unlimited_days) {
      const balance = await getLeaveBalance(input.employeeId, input.leaveTypeId, calendar.id);
      if (daysApplied > balance) throw new AppError(`Insufficient leave balance — ${balance} day(s) available`, 'VALIDATION');
    }
  } else {
    if (!(Number(input.daysToReimburse) > 0)) throw new AppError('Days to reimburse must be greater than zero', 'VALIDATION');
    if (!input.justification?.trim()) throw new AppError('A justification is required for a reimbursement/reinstatement', 'VALIDATION');
  }

  const no = await nextSequence('LEAVE_APPLICATION');
  await run(
    `INSERT INTO hr_leave_application
       (no, employee_id, leave_type_id, nature, leave_calendar_id, start_date, end_date, days_applied,
        weekend_days, holiday_days, total_days, reliever_id, leave_allowance_payable, days_dropped,
        days_to_reimburse, justification, created_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    no, input.employeeId, input.leaveTypeId, nature, calendar.id, input.startDate, input.endDate, daysApplied,
    weekendDays, holidayDays, totalDays, input.relieverId ?? null, !!input.leaveAllowancePayable,
    input.daysDropped ?? null, input.daysToReimburse ?? null, input.justification?.trim() || null,
    new Date().toISOString(), user.username,
  );
  await audit(user, 'LEAVE_APPLICATION_CREATE', 'hr_leave_application', no, { nature });
  return { no };
}

export async function deleteLeaveApplication(no: string, user: Actor): Promise<void> {
  const row = await one<Pick<HrLeaveApplication, 'status' | 'created_by'>>('SELECT status, created_by FROM hr_leave_application WHERE no = ?', no);
  if (!row) throw new AppError('Not found', 'NOT_FOUND');
  if (row.status !== 'Open') throw new AppError('Only an open application can be deleted', 'VALIDATION');
  if (row.created_by !== user.username) throw new AppError('Only the person who created this can delete it', 'NOT_CREATOR');
  await run('DELETE FROM hr_leave_application WHERE no = ?', no);
  await audit(user, 'LEAVE_APPLICATION_DELETE', 'hr_leave_application', no, {});
}

export async function submitLeaveApplication(no: string, user: Actor): Promise<{ autoApproved: boolean }> {
  const req = await one<HrLeaveApplication>('SELECT * FROM hr_leave_application WHERE no = ?', no);
  if (!req) throw new AppError('Not found', 'NOT_FOUND');
  if (req.status !== 'Open') throw new AppError('Only an open application can be submitted for approval', 'VALIDATION');

  const matched = await findMatchingWorkflow('LEAVE_APPLICATION', await pickConditionFields('LEAVE_APPLICATION', req));
  if (!matched) throw new AppError('There is no enabled workflow for this document', 'NO_WORKFLOW');

  await tx(async () => {
    await run("UPDATE hr_leave_application SET status = 'Pending Approval' WHERE no = ?", no);
    await startWorkflow(matched.workflow, matched.steps, { documentType: 'LEAVE_APPLICATION', entityId: no, requestedBy: user.username, amount: 0 });
    const after = await one<{ status: string }>('SELECT status FROM hr_leave_application WHERE no = ?', no);
    if (after?.status === 'Approved') await postApprovedLeaveApplication(no, user);
  });
  const after = await one<{ status: string }>('SELECT status FROM hr_leave_application WHERE no = ?', no);
  return { autoApproved: after?.status === 'Approved' };
}

export async function cancelLeaveApplicationApproval(no: string, user: Actor): Promise<void> {
  const req = await one<Pick<HrLeaveApplication, 'status' | 'created_by'>>('SELECT status, created_by FROM hr_leave_application WHERE no = ?', no);
  if (!req) throw new AppError('Not found', 'NOT_FOUND');
  if (req.status !== 'Pending Approval') throw new AppError('Only an application pending approval can be recalled', 'VALIDATION');
  const routed = await findPendingRoutedTask('LEAVE_APPLICATION', no);
  const requestedBy = routed?.requested_by ?? req.created_by;
  if (requestedBy !== user.username) throw new AppError('Only the person who submitted this can cancel it', 'NOT_REQUESTER');
  await run("UPDATE hr_leave_application SET status = 'Open' WHERE no = ?", no);
  await audit(user, 'LEAVE_APPLICATION_CANCEL_APPROVAL', 'hr_leave_application', no, {});
}

export async function rejectLeaveApplication(no: string, reason: string | null, user: Actor): Promise<void> {
  if (!reason?.trim()) throw new AppError('A reason is required to reject an application', 'VALIDATION');
  const req = await one<HrLeaveApplication>('SELECT * FROM hr_leave_application WHERE no = ?', no);
  if (!req) throw new AppError('Not found', 'NOT_FOUND');
  if (req.status !== 'Pending Approval') throw new AppError('Only an application pending approval can be rejected', 'VALIDATION');
  await run("UPDATE hr_leave_application SET status = 'Open', decision_reason = ? WHERE no = ?", reason, no);
  await audit(user, 'LEAVE_APPLICATION_REJECT', 'hr_leave_application', no, { reason });
}

/** Approval posts automatically — AL's PostLeaveAfterApproval fires the instant Status flips to
 *  Approved, no separate manual "Post" step for a regular application. */
export async function approveLeaveApplication(no: string, user: Actor): Promise<void> {
  return tx(async () => {
    const req = await one<HrLeaveApplication>('SELECT * FROM hr_leave_application WHERE no = ?', no);
    if (!req) throw new AppError('Not found', 'NOT_FOUND');
    if (req.status !== 'Pending Approval') throw new AppError('Only an application pending approval can be approved', 'VALIDATION');
    await run("UPDATE hr_leave_application SET status = 'Approved', decision_reason = NULL WHERE no = ?", no);
    await postApprovedLeaveApplication(no, user);
    await audit(user, 'LEAVE_APPLICATION_APPROVE', 'hr_leave_application', no, {});
  });
}

async function postApprovedLeaveApplication(no: string, user: Actor): Promise<void> {
  const req = await one<HrLeaveApplication>('SELECT * FROM hr_leave_application WHERE no = ?', no);
  if (!req || req.posted) return;
  if (req.nature === 'APPLICATION') {
    await postLeaveLedgerEntry({
      employeeId: req.employee_id, leaveTypeId: req.leave_type_id, leaveCalendarId: req.leave_calendar_id,
      quantity: -Math.abs(req.days_applied), entryType: 'NEGATIVE', postingDate: new Date().toISOString().slice(0, 10),
      documentNo: no, sourceType: 'LEAVE_APPLICATION', sourceId: no, description: `Leave taken ${req.start_date} to ${req.end_date}`,
    }, user);
    if (req.leave_allowance_payable) await applyLeaveAllowance(req.employee_id, user);
  } else {
    await postLeaveLedgerEntry({
      employeeId: req.employee_id, leaveTypeId: req.leave_type_id, leaveCalendarId: req.leave_calendar_id,
      quantity: Math.abs(req.days_to_reimburse || 0), entryType: 'REIMBURSEMENT', postingDate: new Date().toISOString().slice(0, 10),
      documentNo: no, sourceType: 'LEAVE_APPLICATION', sourceId: no, description: req.justification || 'Leave reimbursement',
    }, user);
  }
  await run("UPDATE hr_leave_application SET posted = true, posting_date = ? WHERE no = ?", new Date().toISOString().slice(0, 10), no);
}

/* =================================================================================== adjustments */

export type AdjustmentView = 'open' | 'pending' | 'approved';
const ADJ_VIEW_CLAUSE: Record<AdjustmentView, string> = { open: "j.status = 'Open'", pending: "j.status = 'Pending Approval'", approved: "j.status = 'Approved'" };

const SELECT_ADJUSTMENT = `
  SELECT j.*, lt.name AS leave_type_name, (SELECT COUNT(*) FROM hr_leave_adjustment_line l WHERE l.adjustment_no = j.no) AS line_count
  FROM hr_leave_adjustment j JOIN hr_leave_type lt ON lt.id = j.leave_type_id`;

export async function listLeaveAdjustments(view?: AdjustmentView): Promise<HrLeaveAdjustmentView[]> {
  return all<HrLeaveAdjustmentView>(`${SELECT_ADJUSTMENT} ${view ? `WHERE ${ADJ_VIEW_CLAUSE[view]}` : ''} ORDER BY j.no DESC`);
}
export const getLeaveAdjustment = (no: string): Promise<HrLeaveAdjustmentView | undefined> => one(`${SELECT_ADJUSTMENT} WHERE j.no = ?`, no);
export const hasAnyLeaveAdjustments = async (view?: AdjustmentView): Promise<boolean> =>
  !!(await one(`SELECT 1 FROM hr_leave_adjustment j WHERE ${view ? ADJ_VIEW_CLAUSE[view] : '1=1'} LIMIT 1`));

export const listAdjustmentLines = (no: string): Promise<HrLeaveAdjustmentLineView[]> =>
  all(
    `SELECT l.*, e.employee_no, e.first_name AS employee_first_name, e.last_name AS employee_last_name
     FROM hr_leave_adjustment_line l JOIN employee e ON e.id = l.employee_id WHERE l.adjustment_no = ? ORDER BY e.first_name`,
    no,
  );

export async function createLeaveAdjustment(
  input: { leaveTypeId: number; type: 'POSITIVE' | 'NEGATIVE'; description?: string | null; days: number }, user: Actor,
): Promise<{ no: string }> {
  if (!input.leaveTypeId) throw new AppError('A leave type is required', 'VALIDATION');
  if (!(Number(input.days) > 0)) throw new AppError('Days must be greater than zero', 'VALIDATION');
  const no = await nextSequence('LEAVE_ADJUSTMENT');
  await run(
    'INSERT INTO hr_leave_adjustment (no, leave_type_id, type, description, days, created_at, created_by) VALUES (?,?,?,?,?,?,?)',
    no, input.leaveTypeId, input.type, input.description?.trim() || null, Number(input.days), new Date().toISOString(), user.username,
  );
  await audit(user, 'LEAVE_ADJUSTMENT_CREATE', 'hr_leave_adjustment', no, {});
  return { no };
}

/** Replaces the assigned-employee list — every row gets the header's uniform `days` amount,
 *  matching AL's "Assign Employees" bulk action. */
export async function setAdjustmentEmployees(no: string, employeeIds: number[], user: Actor): Promise<void> {
  const adj = await one<HrLeaveAdjustment>('SELECT * FROM hr_leave_adjustment WHERE no = ?', no);
  if (!adj) throw new AppError('Not found', 'NOT_FOUND');
  if (adj.status !== 'Open') throw new AppError('Only an open adjustment can be edited', 'VALIDATION');
  await tx(async () => {
    await run('DELETE FROM hr_leave_adjustment_line WHERE adjustment_no = ?', no);
    for (const id of [...new Set(employeeIds)]) {
      await run('INSERT INTO hr_leave_adjustment_line (adjustment_no, employee_id, days) VALUES (?,?,?)', no, id, adj.days);
    }
  });
  await audit(user, 'LEAVE_ADJUSTMENT_ASSIGN', 'hr_leave_adjustment', no, { count: employeeIds.length });
}

export async function deleteLeaveAdjustment(no: string, user: Actor): Promise<void> {
  const row = await one<Pick<HrLeaveAdjustment, 'status' | 'created_by'>>('SELECT status, created_by FROM hr_leave_adjustment WHERE no = ?', no);
  if (!row) throw new AppError('Not found', 'NOT_FOUND');
  if (row.status !== 'Open') throw new AppError('Only an open adjustment can be deleted', 'VALIDATION');
  await run('DELETE FROM hr_leave_adjustment WHERE no = ?', no);
  await audit(user, 'LEAVE_ADJUSTMENT_DELETE', 'hr_leave_adjustment', no, {});
}

export async function submitLeaveAdjustment(no: string, user: Actor): Promise<{ autoApproved: boolean }> {
  const req = await one<HrLeaveAdjustment>('SELECT * FROM hr_leave_adjustment WHERE no = ?', no);
  if (!req) throw new AppError('Not found', 'NOT_FOUND');
  if (req.status !== 'Open') throw new AppError('Only an open adjustment can be submitted for approval', 'VALIDATION');
  if (!(await one('SELECT 1 FROM hr_leave_adjustment_line WHERE adjustment_no = ?', no))) {
    throw new AppError('Assign at least one employee first', 'VALIDATION');
  }
  const matched = await findMatchingWorkflow('LEAVE_ADJUSTMENT', await pickConditionFields('LEAVE_ADJUSTMENT', req));
  if (!matched) throw new AppError('There is no enabled workflow for this document', 'NO_WORKFLOW');
  await tx(async () => {
    await run("UPDATE hr_leave_adjustment SET status = 'Pending Approval' WHERE no = ?", no);
    await startWorkflow(matched.workflow, matched.steps, { documentType: 'LEAVE_ADJUSTMENT', entityId: no, requestedBy: user.username, amount: 0 });
  });
  const after = await one<{ status: string }>('SELECT status FROM hr_leave_adjustment WHERE no = ?', no);
  return { autoApproved: after?.status === 'Approved' };
}

export async function cancelLeaveAdjustmentApproval(no: string, user: Actor): Promise<void> {
  const req = await one<Pick<HrLeaveAdjustment, 'status' | 'created_by'>>('SELECT status, created_by FROM hr_leave_adjustment WHERE no = ?', no);
  if (!req) throw new AppError('Not found', 'NOT_FOUND');
  if (req.status !== 'Pending Approval') throw new AppError('Only an adjustment pending approval can be recalled', 'VALIDATION');
  const routed = await findPendingRoutedTask('LEAVE_ADJUSTMENT', no);
  const requestedBy = routed?.requested_by ?? req.created_by;
  if (requestedBy !== user.username) throw new AppError('Only the person who submitted this can cancel it', 'NOT_REQUESTER');
  await run("UPDATE hr_leave_adjustment SET status = 'Open' WHERE no = ?", no);
  await audit(user, 'LEAVE_ADJUSTMENT_CANCEL_APPROVAL', 'hr_leave_adjustment', no, {});
}

export async function rejectLeaveAdjustment(no: string, reason: string | null, user: Actor): Promise<void> {
  if (!reason?.trim()) throw new AppError('A reason is required to reject this', 'VALIDATION');
  const req = await one<HrLeaveAdjustment>('SELECT * FROM hr_leave_adjustment WHERE no = ?', no);
  if (!req) throw new AppError('Not found', 'NOT_FOUND');
  if (req.status !== 'Pending Approval') throw new AppError('Only an adjustment pending approval can be rejected', 'VALIDATION');
  await run("UPDATE hr_leave_adjustment SET status = 'Open', decision_reason = ? WHERE no = ?", reason, no);
  await audit(user, 'LEAVE_ADJUSTMENT_REJECT', 'hr_leave_adjustment', no, { reason });
}

/** Approve posts a ledger line (Positive/Negative per header type) for every assigned employee. */
export async function approveLeaveAdjustment(no: string, user: Actor): Promise<void> {
  return tx(async () => {
    const req = await one<HrLeaveAdjustment>('SELECT * FROM hr_leave_adjustment WHERE no = ?', no);
    if (!req) throw new AppError('Not found', 'NOT_FOUND');
    if (req.status !== 'Pending Approval') throw new AppError('Only an adjustment pending approval can be approved', 'VALIDATION');
    const calendar = await getCurrentLeaveCalendar();
    if (!calendar) throw new AppError('There is no current leave calendar', 'VALIDATION');
    const lines = await all<{ employee_id: number; days: number }>('SELECT employee_id, days FROM hr_leave_adjustment_line WHERE adjustment_no = ?', no);
    for (const line of lines) {
      await postLeaveLedgerEntry({
        employeeId: line.employee_id, leaveTypeId: req.leave_type_id, leaveCalendarId: calendar.id,
        quantity: req.type === 'NEGATIVE' ? -Math.abs(line.days) : Math.abs(line.days),
        entryType: req.type === 'NEGATIVE' ? 'NEGATIVE' : 'POSITIVE', postingDate: new Date().toISOString().slice(0, 10),
        documentNo: no, sourceType: 'LEAVE_ADJUSTMENT', sourceId: no, description: req.description,
      }, user);
    }
    await run("UPDATE hr_leave_adjustment SET status = 'Approved', decision_reason = NULL WHERE no = ?", no);
    await audit(user, 'LEAVE_ADJUSTMENT_APPROVE', 'hr_leave_adjustment', no, { employees: lines.length });
  });
}

/* ======================================================================================= recalls */

export type RecallView = 'open' | 'pending' | 'approved';
const RECALL_VIEW_CLAUSE: Record<RecallView, string> = { open: "r.status = 'Open'", pending: "r.status = 'Pending Approval'", approved: "r.status = 'Approved'" };
const SELECT_RECALL = `
  SELECT r.*, e.employee_no, e.first_name AS employee_first_name, e.last_name AS employee_last_name,
         a.start_date AS application_start_date, a.end_date AS application_end_date, a.days_applied AS application_days_applied
  FROM hr_leave_recall r JOIN employee e ON e.id = r.employee_id JOIN hr_leave_application a ON a.no = r.application_no`;

export const listLeaveRecalls = (view?: RecallView): Promise<HrLeaveRecallView[]> =>
  all(`${SELECT_RECALL} ${view ? `WHERE ${RECALL_VIEW_CLAUSE[view]}` : ''} ORDER BY r.no DESC`);
export const getLeaveRecall = (no: string): Promise<HrLeaveRecallView | undefined> => one(`${SELECT_RECALL} WHERE r.no = ?`, no);
export const hasAnyLeaveRecalls = async (view?: RecallView): Promise<boolean> =>
  !!(await one(`SELECT 1 FROM hr_leave_recall r WHERE ${view ? RECALL_VIEW_CLAUSE[view] : '1=1'} LIMIT 1`));

/** The recallable applications for an employee — Approved, ongoing (not fully recalled already). */
export const recallableApplications = (employeeId: number): Promise<HrLeaveApplicationView[]> =>
  all(
    `${SELECT_APPLICATION} WHERE a.employee_id = ? AND a.status = 'Approved' AND a.nature = 'APPLICATION' ORDER BY a.start_date DESC`,
    employeeId,
  );

export async function createLeaveRecall(input: { employeeId: number; applicationNo: string; daysToRecall: number }, user: Actor): Promise<{ no: string }> {
  const app = await one<HrLeaveApplication>("SELECT * FROM hr_leave_application WHERE no = ? AND status = 'Approved'", input.applicationNo);
  if (!app) throw new AppError('Approved leave application not found', 'NOT_FOUND');
  if (app.employee_id !== input.employeeId) throw new AppError('That application does not belong to this employee', 'VALIDATION');
  const alreadyRecalled = await one<{ total: number }>(
    "SELECT COALESCE(SUM(days_to_recall),0) AS total FROM hr_leave_recall WHERE application_no = ? AND status != 'Open'", input.applicationNo,
  );
  const remaining = app.days_applied - Number(alreadyRecalled?.total ?? 0);
  if (!(Number(input.daysToRecall) > 0) || input.daysToRecall > remaining) {
    throw new AppError(`Days to recall must be between 1 and ${remaining}`, 'VALIDATION');
  }
  const no = await nextSequence('LEAVE_RECALL');
  await run(
    'INSERT INTO hr_leave_recall (no, employee_id, application_no, days_to_recall, created_at, created_by) VALUES (?,?,?,?,?,?)',
    no, input.employeeId, input.applicationNo, input.daysToRecall, new Date().toISOString(), user.username,
  );
  await audit(user, 'LEAVE_RECALL_CREATE', 'hr_leave_recall', no, {});
  return { no };
}

export async function deleteLeaveRecall(no: string, user: Actor): Promise<void> {
  const row = await one<Pick<HrLeaveRecall, 'status' | 'created_by'>>('SELECT status, created_by FROM hr_leave_recall WHERE no = ?', no);
  if (!row) throw new AppError('Not found', 'NOT_FOUND');
  if (row.status !== 'Open') throw new AppError('Only an open recall can be deleted', 'VALIDATION');
  await run('DELETE FROM hr_leave_recall WHERE no = ?', no);
  await audit(user, 'LEAVE_RECALL_DELETE', 'hr_leave_recall', no, {});
}

export async function submitLeaveRecall(no: string, user: Actor): Promise<{ autoApproved: boolean }> {
  const req = await one<HrLeaveRecall>('SELECT * FROM hr_leave_recall WHERE no = ?', no);
  if (!req) throw new AppError('Not found', 'NOT_FOUND');
  if (req.status !== 'Open') throw new AppError('Only an open recall can be submitted for approval', 'VALIDATION');
  const matched = await findMatchingWorkflow('LEAVE_RECALL', await pickConditionFields('LEAVE_RECALL', req));
  if (!matched) throw new AppError('There is no enabled workflow for this document', 'NO_WORKFLOW');
  await tx(async () => {
    await run("UPDATE hr_leave_recall SET status = 'Pending Approval' WHERE no = ?", no);
    await startWorkflow(matched.workflow, matched.steps, { documentType: 'LEAVE_RECALL', entityId: no, requestedBy: user.username, amount: 0 });
  });
  const after = await one<{ status: string }>('SELECT status FROM hr_leave_recall WHERE no = ?', no);
  return { autoApproved: after?.status === 'Approved' };
}

export async function cancelLeaveRecallApproval(no: string, user: Actor): Promise<void> {
  const req = await one<Pick<HrLeaveRecall, 'status' | 'created_by'>>('SELECT status, created_by FROM hr_leave_recall WHERE no = ?', no);
  if (!req) throw new AppError('Not found', 'NOT_FOUND');
  if (req.status !== 'Pending Approval') throw new AppError('Only a recall pending approval can be recalled', 'VALIDATION');
  const routed = await findPendingRoutedTask('LEAVE_RECALL', no);
  const requestedBy = routed?.requested_by ?? req.created_by;
  if (requestedBy !== user.username) throw new AppError('Only the person who submitted this can cancel it', 'NOT_REQUESTER');
  await run("UPDATE hr_leave_recall SET status = 'Open' WHERE no = ?", no);
  await audit(user, 'LEAVE_RECALL_CANCEL_APPROVAL', 'hr_leave_recall', no, {});
}

export async function rejectLeaveRecall(no: string, reason: string | null, user: Actor): Promise<void> {
  if (!reason?.trim()) throw new AppError('A reason is required', 'VALIDATION');
  const req = await one<HrLeaveRecall>('SELECT * FROM hr_leave_recall WHERE no = ?', no);
  if (!req) throw new AppError('Not found', 'NOT_FOUND');
  if (req.status !== 'Pending Approval') throw new AppError('Only a recall pending approval can be rejected', 'VALIDATION');
  await run("UPDATE hr_leave_recall SET status = 'Open', decision_reason = ? WHERE no = ?", reason, no);
  await audit(user, 'LEAVE_RECALL_REJECT', 'hr_leave_recall', no, { reason });
}

/** Approval credits the recalled days back — a Reimbursement ledger entry. */
export async function approveLeaveRecall(no: string, user: Actor): Promise<void> {
  return tx(async () => {
    const req = await one<HrLeaveRecall>('SELECT * FROM hr_leave_recall WHERE no = ?', no);
    if (!req) throw new AppError('Not found', 'NOT_FOUND');
    if (req.status !== 'Pending Approval') throw new AppError('Only a recall pending approval can be approved', 'VALIDATION');
    const app = await one<HrLeaveApplication>('SELECT * FROM hr_leave_application WHERE no = ?', req.application_no);
    if (!app) throw new AppError('Source application not found', 'NOT_FOUND');
    await postLeaveLedgerEntry({
      employeeId: req.employee_id, leaveTypeId: app.leave_type_id, leaveCalendarId: app.leave_calendar_id,
      quantity: Math.abs(req.days_to_recall), entryType: 'REIMBURSEMENT', postingDate: new Date().toISOString().slice(0, 10),
      documentNo: no, sourceType: 'LEAVE_RECALL', sourceId: no, description: `Recalled from leave ${req.application_no}`,
    }, user);
    await run("UPDATE hr_leave_recall SET status = 'Approved', decision_reason = NULL WHERE no = ?", no);
    await audit(user, 'LEAVE_RECALL_APPROVE', 'hr_leave_recall', no, {});
  });
}

/* ========================================================================================= plans */

export type PlanView = 'open' | 'pending' | 'approved';
const PLAN_VIEW_CLAUSE: Record<PlanView, string> = { open: "p.status = 'Open'", pending: "p.status = 'Pending Approval'", approved: "p.status = 'Approved'" };
const SELECT_PLAN = `
  SELECT p.*, e.employee_no, e.first_name AS employee_first_name, e.last_name AS employee_last_name
  FROM hr_leave_plan p JOIN employee e ON e.id = p.employee_id`;

export const listLeavePlans = (view?: PlanView, employeeId?: number | null): Promise<HrLeavePlanView[]> =>
  all(
    `${SELECT_PLAN} WHERE ${view ? PLAN_VIEW_CLAUSE[view] : '1=1'} ${employeeId ? 'AND p.employee_id = @employeeId' : ''} ORDER BY p.no DESC`,
    employeeId ? { employeeId } : {},
  );
export const getLeavePlan = (no: string): Promise<HrLeavePlanView | undefined> => one(`${SELECT_PLAN} WHERE p.no = ?`, no);
export const hasAnyLeavePlans = async (view?: PlanView): Promise<boolean> =>
  !!(await one(`SELECT 1 FROM hr_leave_plan p WHERE ${view ? PLAN_VIEW_CLAUSE[view] : '1=1'} LIMIT 1`));
export const listPlanLines = (no: string): Promise<HrLeavePlanLine[]> => all('SELECT * FROM hr_leave_plan_line WHERE plan_no = ? ORDER BY start_date', no);

export async function createLeavePlan(employeeId: number, user: Actor): Promise<{ no: string }> {
  const emp = await getEmployee(employeeId);
  if (!emp) throw new AppError('Employee not found', 'NOT_FOUND');
  const calendar = await getCurrentLeaveCalendar();
  if (!calendar) throw new AppError('There is no current leave calendar', 'VALIDATION');
  const no = await nextSequence('LEAVE_PLAN');
  await run(
    'INSERT INTO hr_leave_plan (no, employee_id, leave_calendar_id, created_at, created_by) VALUES (?,?,?,?,?)',
    no, employeeId, calendar.id, new Date().toISOString(), user.username,
  );
  await audit(user, 'LEAVE_PLAN_CREATE', 'hr_leave_plan', no, {});
  return { no };
}

/** Replaces the plan's lines — validated against the singleton annual leave type's balance
 *  (minus days already planned across the other lines) and checked for overlap, matching AL's
 *  Leave Plan Lines table triggers. */
export async function setPlanLines(no: string, lines: { startDate: string; endDate: string }[], user: Actor): Promise<void> {
  const plan = await one<HrLeavePlan>('SELECT * FROM hr_leave_plan WHERE no = ?', no);
  if (!plan) throw new AppError('Not found', 'NOT_FOUND');
  if (plan.status !== 'Open') throw new AppError('Only an open plan can be edited', 'VALIDATION');
  const type = await getAnnualLeaveType();
  if (!type) throw new AppError('No leave type is marked as the annual leave type', 'VALIDATION');
  const holidays = await holidaySet();

  const sorted = [...lines].sort((a, b) => a.startDate.localeCompare(b.startDate));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startDate <= sorted[i - 1].endDate) throw new AppError('Plan lines cannot overlap each other', 'VALIDATION');
  }
  let totalPlanned = 0;
  for (const l of sorted) totalPlanned += countLeaveDays(l.startDate, l.endDate, type, holidays).daysApplied;
  const balance = await getLeaveBalance(plan.employee_id, type.id, plan.leave_calendar_id);
  if (totalPlanned > balance) throw new AppError(`Planned days (${totalPlanned}) exceed the annual leave balance (${balance})`, 'VALIDATION');

  await tx(async () => {
    await run('DELETE FROM hr_leave_plan_line WHERE plan_no = ?', no);
    for (const l of sorted) {
      const days = countLeaveDays(l.startDate, l.endDate, type, holidays).daysApplied;
      await run('INSERT INTO hr_leave_plan_line (plan_no, start_date, end_date, days) VALUES (?,?,?,?)', no, l.startDate, l.endDate, days);
    }
  });
  await audit(user, 'LEAVE_PLAN_SET_LINES', 'hr_leave_plan', no, { lines: sorted.length });
}

export async function deleteLeavePlan(no: string, user: Actor): Promise<void> {
  const row = await one<Pick<HrLeavePlan, 'status' | 'created_by'>>('SELECT status, created_by FROM hr_leave_plan WHERE no = ?', no);
  if (!row) throw new AppError('Not found', 'NOT_FOUND');
  if (row.status !== 'Open') throw new AppError('Only an open plan can be deleted', 'VALIDATION');
  await run('DELETE FROM hr_leave_plan WHERE no = ?', no);
  await audit(user, 'LEAVE_PLAN_DELETE', 'hr_leave_plan', no, {});
}

export async function submitLeavePlan(no: string, user: Actor): Promise<{ autoApproved: boolean }> {
  const req = await one<HrLeavePlan>('SELECT * FROM hr_leave_plan WHERE no = ?', no);
  if (!req) throw new AppError('Not found', 'NOT_FOUND');
  if (req.status !== 'Open') throw new AppError('Only an open plan can be submitted for approval', 'VALIDATION');
  if (!(await one('SELECT 1 FROM hr_leave_plan_line WHERE plan_no = ?', no))) throw new AppError('Add at least one planned leave window first', 'VALIDATION');
  const matched = await findMatchingWorkflow('LEAVE_PLAN', await pickConditionFields('LEAVE_PLAN', req));
  if (!matched) throw new AppError('There is no enabled workflow for this document', 'NO_WORKFLOW');
  await tx(async () => {
    await run("UPDATE hr_leave_plan SET status = 'Pending Approval' WHERE no = ?", no);
    await startWorkflow(matched.workflow, matched.steps, { documentType: 'LEAVE_PLAN', entityId: no, requestedBy: user.username, amount: 0 });
  });
  const after = await one<{ status: string }>('SELECT status FROM hr_leave_plan WHERE no = ?', no);
  return { autoApproved: after?.status === 'Approved' };
}

export async function cancelLeavePlanApproval(no: string, user: Actor): Promise<void> {
  const req = await one<Pick<HrLeavePlan, 'status' | 'created_by'>>('SELECT status, created_by FROM hr_leave_plan WHERE no = ?', no);
  if (!req) throw new AppError('Not found', 'NOT_FOUND');
  if (req.status !== 'Pending Approval') throw new AppError('Only a plan pending approval can be recalled', 'VALIDATION');
  const routed = await findPendingRoutedTask('LEAVE_PLAN', no);
  const requestedBy = routed?.requested_by ?? req.created_by;
  if (requestedBy !== user.username) throw new AppError('Only the person who submitted this can cancel it', 'NOT_REQUESTER');
  await run("UPDATE hr_leave_plan SET status = 'Open' WHERE no = ?", no);
  await audit(user, 'LEAVE_PLAN_CANCEL_APPROVAL', 'hr_leave_plan', no, {});
}

export async function rejectLeavePlan(no: string, reason: string | null, user: Actor): Promise<void> {
  if (!reason?.trim()) throw new AppError('A reason is required', 'VALIDATION');
  const req = await one<HrLeavePlan>('SELECT * FROM hr_leave_plan WHERE no = ?', no);
  if (!req) throw new AppError('Not found', 'NOT_FOUND');
  if (req.status !== 'Pending Approval') throw new AppError('Only a plan pending approval can be rejected', 'VALIDATION');
  await run("UPDATE hr_leave_plan SET status = 'Open', decision_reason = ? WHERE no = ?", reason, no);
  await audit(user, 'LEAVE_PLAN_REJECT', 'hr_leave_plan', no, { reason });
}

/** No ledger posting — a plan is a schedule, not a transaction; the balance is only actually
 *  debited when the employee later files the real Leave Application. */
export async function approveLeavePlan(no: string, user: Actor): Promise<void> {
  const req = await one<HrLeavePlan>('SELECT * FROM hr_leave_plan WHERE no = ?', no);
  if (!req) throw new AppError('Not found', 'NOT_FOUND');
  if (req.status !== 'Pending Approval') throw new AppError('Only a plan pending approval can be approved', 'VALIDATION');
  await run("UPDATE hr_leave_plan SET status = 'Approved', decision_reason = NULL WHERE no = ?", no);
  await audit(user, 'LEAVE_PLAN_APPROVE', 'hr_leave_plan', no, {});
}

/* ============================================================================== accrual / close */

/** Monthly accrual run — for every non-disabled leave type with `accrues=true`, credits every
 *  Active/On Leave employee the per-grade rate from hr_leave_days_to_accrue (falling back to the
 *  type's own flat `days_to_accrue`). Safe to re-run: pass a distinct `runId` to dedupe, or just
 *  call once a month via System Automation. */
export async function runLeaveAccrual(user: Actor): Promise<{ posted: number }> {
  const calendar = await getCurrentLeaveCalendar();
  if (!calendar) throw new AppError('There is no current leave calendar', 'VALIDATION');
  const types = await all<HrLeaveType>('SELECT * FROM hr_leave_type WHERE accrues = true AND disabled = false');
  const employees = await all<{ id: number; job_grade_id: number | null }>("SELECT id, job_grade_id FROM employee WHERE status IN ('ACTIVE','ON_LEAVE')");
  const matrixRows = await all<HrLeaveDaysToAccrue>('SELECT * FROM hr_leave_days_to_accrue');
  const today = new Date().toISOString().slice(0, 10);
  let posted = 0;
  await tx(async () => {
    for (const type of types) {
      for (const emp of employees) {
        const override = matrixRows.find((m) => m.leave_type_id === type.id && m.job_grade_id === emp.job_grade_id);
        const days = override ? override.days_to_accrue : type.days_to_accrue;
        if (!(days > 0)) continue;
        await postLeaveLedgerEntry({
          employeeId: emp.id, leaveTypeId: type.id, leaveCalendarId: calendar.id, quantity: days, entryType: 'ACCRUED',
          postingDate: today, documentNo: 'ACCRUED', sourceType: 'ACCRUAL_RUN', description: `Monthly accrual — ${type.name}`,
        }, user);
        posted += 1;
      }
    }
  });
  await audit(user, 'LEAVE_ACCRUAL_RUN', 'hr_leave_calendar', calendar.id, { posted });
  return { posted };
}

/** Period close — for every non-disabled type, caps each employee's balance at
 *  `max_carry_forward_days` (if carry-forward is allowed) and posts a fresh full allotment,
 *  then closes the current calendar's ledger entries and opens the next one. Mirrors AL's Close
 *  Leave Period codeunit. */
export async function closeLeavePeriod(
  input: { nextCode: string; nextStartDate: string; nextEndDate: string }, user: Actor,
): Promise<{ id: number }> {
  const calendar = await getCurrentLeaveCalendar();
  if (!calendar) throw new AppError('There is no current leave calendar', 'VALIDATION');
  const types = await all<HrLeaveType>('SELECT * FROM hr_leave_type WHERE disabled = false');
  const employees = await all<{ id: number; gender: string | null }>("SELECT id, gender FROM employee WHERE status IN ('ACTIVE','ON_LEAVE')");

  return tx(async () => {
    const info = await run(
      'INSERT INTO hr_leave_calendar (code, start_date, end_date, is_current, created_at, created_by) VALUES (?,?,?,?,?,?)',
      input.nextCode, input.nextStartDate, input.nextEndDate, false, new Date().toISOString(), user.username,
    );
    const nextCalendarId = Number(info.lastInsertRowid);

    for (const type of types) {
      for (const emp of employees) {
        if (type.gender !== 'ANY' && emp.gender && type.gender !== emp.gender) continue;
        const balance = await getLeaveBalance(emp.id, type.id, calendar.id);
        if (type.balance_treatment === 'CARRY_FORWARD') {
          const carried = Math.min(Math.max(balance, 0), type.max_carry_forward_days);
          if (carried > 0) {
            await postLeaveLedgerEntry({
              employeeId: emp.id, leaveTypeId: type.id, leaveCalendarId: nextCalendarId, quantity: carried,
              entryType: 'OPENING_BALANCE', postingDate: input.nextStartDate, documentNo: 'OPENBAL',
              sourceType: 'PERIOD_CLOSE', description: `Carried forward from ${calendar.code}`,
            }, user);
          }
        }
        if (type.standard_days > 0) {
          await postLeaveLedgerEntry({
            employeeId: emp.id, leaveTypeId: type.id, leaveCalendarId: nextCalendarId, quantity: type.standard_days,
            entryType: 'OPENING_BALANCE', postingDate: input.nextStartDate, documentNo: 'OPENBAL',
            sourceType: 'PERIOD_CLOSE', description: `${calendar.code} renewal allotment`,
          }, user);
        }
      }
    }

    await run('UPDATE hr_leave_ledger_entry SET closed = true WHERE leave_calendar_id = ?', calendar.id);
    await run('UPDATE hr_leave_calendar SET is_current = false, closed = true, closed_at = ?, closed_by = ? WHERE id = ?', new Date().toISOString(), user.username, calendar.id);
    await run('UPDATE hr_leave_calendar SET is_current = true WHERE id = ?', nextCalendarId);
    await audit(user, 'LEAVE_PERIOD_CLOSE', 'hr_leave_calendar', calendar.id, { nextCalendarId });
    return { id: nextCalendarId };
  });
}

/* =================================================================================== reminders */

/** Balance-reminder emails — for every Active/On Leave employee whose balance for a type exceeds
 *  that type's notification threshold. Meant to run from System Automation (job queue), same shape
 *  as lib/jobQueue.ts's other handlers. */
export async function sendLeaveBalanceReminders(): Promise<{ sent: number }> {
  const calendar = await getCurrentLeaveCalendar();
  if (!calendar) return { sent: 0 };
  const types = await all<HrLeaveType>('SELECT * FROM hr_leave_type WHERE leave_balance_notification_threshold IS NOT NULL');
  let sent = 0;
  for (const type of types) {
    const employees = await all<{ id: number; email: string | null; first_name: string; last_name: string }>(
      "SELECT id, email, first_name, last_name FROM employee WHERE status IN ('ACTIVE','ON_LEAVE')",
    );
    for (const emp of employees) {
      if (!emp.email) continue;
      const balance = await getLeaveBalance(emp.id, type.id, calendar.id);
      if (balance <= (type.leave_balance_notification_threshold ?? Infinity)) continue;
      await sendMail({
        to: emp.email, subject: `Leave balance reminder — ${type.name}`,
        html: `<p>Hi ${emp.first_name},</p><p>Your ${type.name} balance is currently ${balance} day(s). Please liaise with your supervisor to plan its utilisation.</p>`,
      });
      sent += 1;
    }
  }
  return { sent };
}

/** Impending-leave emails — for every Approved Leave Plan line starting exactly `leadDays` from
 *  today. Meant to run daily from System Automation. */
export async function sendImpendingLeaveNotifications(leadDays: number): Promise<{ sent: number }> {
  const target = new Date();
  target.setUTCDate(target.getUTCDate() + leadDays);
  const targetIso = target.toISOString().slice(0, 10);
  const rows = await all<{ email: string | null; first_name: string; last_name: string; start_date: string }>(
    `SELECT e.email, e.first_name, e.last_name, l.start_date
     FROM hr_leave_plan_line l JOIN hr_leave_plan p ON p.no = l.plan_no JOIN employee e ON e.id = p.employee_id
     WHERE p.status = 'Approved' AND l.start_date = ?`,
    targetIso,
  );
  let sent = 0;
  for (const r of rows) {
    if (!r.email) continue;
    await sendMail({
      to: r.email, subject: 'Upcoming leave reminder',
      html: `<p>Hi ${r.first_name},</p><p>This is a reminder that your planned leave starts on ${r.start_date}.</p>`,
    });
    sent += 1;
  }
  return { sent };
}
