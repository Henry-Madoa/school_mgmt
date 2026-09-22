/*
 * Employee Self Service — the login's own employee record and the row-level scoping built on
 * it, ported from the Sacco ERP AL where every self-service document does, on insert:
 *
 *     UserSetup.GET(UserId);
 *     UserSetup.TESTFIELD("Employee No.");
 *     Validate("Employee No", UserSetup."Employee No.");   // copies the employee's dimensions
 *
 * and every "SS" list page (SSPurchaseOrderList, SSBudgetPlans, ...) is the module's list with
 * a SourceTableView on that Employee No. Here the User Setup link is approval_user_setup.
 * employee_id; a user who holds only the SELF_SERVICE_* actions (lib/permissions.ts) sees the
 * /self-service module, whose lists are filtered to that employee, and every maker action they
 * call resolves the employee for them rather than trusting the form. The document cards let such
 * a user in when the document is theirs — assertCanViewEmployeeDocument — and refuse otherwise.
 */
import { one, all, run } from './db.ts';
import { AppError, ForbiddenError } from './errors.ts';
import { ACTIONS, canAction, type ActionKey } from './permissions.ts';
import type { Cents, IsoDate, SessionUser } from './types.ts';

export interface SelfEmployee {
  id: number;
  employee_no: string;
  first_name: string;
  last_name: string;
  status: string;
  job_title: string | null;
  email: string | null;
  photo_image: string | null;
  global_dimension_1_id: number | null;
  global_dimension_2_id: number | null;
  global_dimension_1_code: string | null;
  global_dimension_1_name: string | null;
  global_dimension_2_code: string | null;
  global_dimension_2_name: string | null;
}

/** The employee this login is, per User Setup — or null when an administrator has not matched one. */
export const getEmployeeForUser = (userId: number): Promise<SelfEmployee | undefined> =>
  one<SelfEmployee>(
    `SELECT e.id, e.employee_no, e.first_name, e.last_name, e.status, e.job_title, e.email, e.photo_image,
            e.global_dimension_1_id, e.global_dimension_2_id,
            gd1.code AS global_dimension_1_code, gd1.name AS global_dimension_1_name,
            gd2.code AS global_dimension_2_code, gd2.name AS global_dimension_2_name
     FROM approval_user_setup s
     JOIN employee e ON e.id = s.employee_id
     LEFT JOIN global_dimension_1_value gd1 ON gd1.id = e.global_dimension_1_id
     LEFT JOIN global_dimension_2_value gd2 ON gd2.id = e.global_dimension_2_id
     WHERE s.user_id = ?`,
    userId,
  );

/** AL's UserSetup.TESTFIELD("Employee No.") — the message tells the employee who can fix it. */
export async function requireSelfEmployee(user: { id: number }): Promise<SelfEmployee> {
  const emp = await getEmployeeForUser(user.id);
  if (!emp) {
    throw new AppError('Your login is not matched to an employee — ask an administrator to set your Employee No. under Admin Centre → User Setup', 'NO_EMPLOYEE');
  }
  return emp;
}

/**
 * Which employee a maker action works on. A user holding the module's own action (an HR officer
 * raising leave for anyone, a cashier capturing petty cash for a colleague) works on whichever
 * employee the form named; a user holding only the self-service action always works on their own
 * employee record, whatever the form said — the form is not trusted for that.
 */
export async function resolveActingEmployee(
  user: SessionUser, moduleAction: ActionKey, requestedEmployeeId: number | null | undefined,
): Promise<number> {
  if (canAction(user, moduleAction)) {
    if (!requestedEmployeeId) throw new AppError('An employee is required', 'VALIDATION');
    return requestedEmployeeId;
  }
  return (await requireSelfEmployee(user)).id;
}

/**
 * Row-level read for a document card. The module's own action opens any document; otherwise the
 * user must hold the self-service action AND the document must belong to their employee. Returns
 * whether the self-service path applied, so the card can point its links back at /self-service.
 */
export async function assertCanViewEmployeeDocument(
  user: SessionUser, moduleAction: ActionKey, selfAction: ActionKey, documentEmployeeId: number,
): Promise<{ selfService: boolean }> {
  if (canAction(user, moduleAction)) return { selfService: false };
  if (canAction(user, selfAction)) {
    const emp = await getEmployeeForUser(user.id);
    if (emp && emp.id === documentEmployeeId) return { selfService: true };
  }
  throw new ForbiddenError(ACTIONS[moduleAction].page);
}

/**
 * Stamps a document with its employee's Global Dimension 1 / 2 — AL's Validate("Employee No")
 * copying Employee."Global Dimension 1 Code" onto the record. Run after insert and after an edit
 * that may have changed the employee; the journal the document later posts carries the same
 * dimensions (each module's postJournal call passes them).
 */
export async function stampEmployeeDimensions(
  table: 'imprest_request' | 'petty_cash' | 'requisition' | 'staff_claim', no: string,
): Promise<void> {
  await run(
    `UPDATE ${table} d SET global_dimension_1_id = e.global_dimension_1_id, global_dimension_2_id = e.global_dimension_2_id
     FROM employee e WHERE e.id = d.employee_id AND d.no = ?`,
    no,
  );
}

/* ------------------------------------------------------------------ role centre data */

export interface SelfServiceRoleCenterData {
  leaveBalances: { leave_type: string; balance: number }[];
  counts: {
    leaveOpen: number; leavePending: number; leaveApproved: number;
    plansOpen: number; imprestsOpen: number; imprestsPending: number; imprestsOutstanding: number;
    pettyCashOpen: number; requisitionsOpen: number; requisitionsPending: number;
  };
  imprestOutstanding: Cents;
  latestPayslip: { period_id: number; period_name: string; end_date: IsoDate; net_pay: Cents } | null;
  upcomingLeave: { no: string; leave_type: string; start_date: IsoDate; end_date: IsoDate; days: number }[];
}

export async function getSelfServiceRoleCenter(employeeId: number): Promise<SelfServiceRoleCenterData> {
  const [balances, leave, plans, imprests, pc, reqs, outstanding, payslip, upcoming] = await Promise.all([
    all<{ leave_type: string; balance: number }>(
      `SELECT t.name AS leave_type, COALESCE(SUM(l.quantity), 0) AS balance
       FROM hr_leave_ledger_entry l
       JOIN hr_leave_type t ON t.id = l.leave_type_id
       JOIN hr_leave_calendar c ON c.id = l.leave_calendar_id AND c.is_current = true
       WHERE l.employee_id = ? AND l.closed = false
       GROUP BY t.name ORDER BY t.name`,
      employeeId,
    ),
    one<{ o: number; p: number; a: number }>(
      `SELECT COUNT(*) FILTER (WHERE status = 'Open') AS o, COUNT(*) FILTER (WHERE status = 'Pending Approval') AS p,
              COUNT(*) FILTER (WHERE status = 'Approved') AS a
       FROM hr_leave_application WHERE employee_id = ?`, employeeId,
    ),
    one<{ o: number }>(`SELECT COUNT(*) AS o FROM hr_leave_plan WHERE employee_id = ? AND status = 'Open'`, employeeId),
    one<{ o: number; p: number; s: number }>(
      `SELECT COUNT(*) FILTER (WHERE status = 'Open' AND NOT posted) AS o,
              COUNT(*) FILTER (WHERE status = 'Pending Approval' OR surrender_status = 'Pending Approval') AS p,
              COUNT(*) FILTER (WHERE posted AND NOT surrendered) AS s
       FROM imprest_request WHERE employee_id = ?`, employeeId,
    ).catch(() => ({ o: 0, p: 0, s: 0 })),
    one<{ o: number }>(`SELECT COUNT(*) AS o FROM petty_cash WHERE employee_id = ? AND status = 'Open'`, employeeId),
    one<{ o: number; p: number }>(
      `SELECT COUNT(*) FILTER (WHERE status = 'Open') AS o, COUNT(*) FILTER (WHERE status = 'Pending Approval') AS p
       FROM requisition WHERE employee_id = ?`, employeeId,
    ),
    one<{ total: Cents }>('SELECT COALESCE(SUM(amount), 0) AS total FROM employee_ledger_entry WHERE employee_id = ?', employeeId)
      .catch(() => ({ total: 0 })),
    one<{ period_id: number; period_name: string; end_date: IsoDate; net_pay: Cents }>(
      `SELECT p.id AS period_id, p.period_name, p.end_date, l.net_pay_cents AS net_pay
       FROM payroll_p9_line l JOIN payroll_period p ON p.id = l.payroll_period_id
       WHERE l.employee_id = ?
       ORDER BY p.end_date DESC LIMIT 1`, employeeId,
    ),
    all<{ no: string; leave_type: string; start_date: IsoDate; end_date: IsoDate; days: number }>(
      `SELECT a.no, t.name AS leave_type, a.start_date, a.end_date, a.total_days AS days
       FROM hr_leave_application a JOIN hr_leave_type t ON t.id = a.leave_type_id
       WHERE a.employee_id = ? AND a.status = 'Approved' AND a.end_date >= CURRENT_DATE::text
       ORDER BY a.start_date LIMIT 5`, employeeId,
    ).catch(() => []),
  ]);
  return {
    leaveBalances: balances.map((b) => ({ leave_type: b.leave_type, balance: Number(b.balance) })),
    counts: {
      leaveOpen: Number(leave?.o ?? 0), leavePending: Number(leave?.p ?? 0), leaveApproved: Number(leave?.a ?? 0),
      plansOpen: Number(plans?.o ?? 0),
      imprestsOpen: Number(imprests?.o ?? 0), imprestsPending: Number(imprests?.p ?? 0), imprestsOutstanding: Number(imprests?.s ?? 0),
      pettyCashOpen: Number(pc?.o ?? 0),
      requisitionsOpen: Number(reqs?.o ?? 0), requisitionsPending: Number(reqs?.p ?? 0),
    },
    imprestOutstanding: Number(outstanding?.total ?? 0),
    latestPayslip: payslip ? { ...payslip, net_pay: Number(payslip.net_pay) } : null,
    upcomingLeave: upcoming,
  };
}
