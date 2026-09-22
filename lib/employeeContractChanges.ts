/*
 * Employee Contract / Salary Change — maker-checker for New Contract, Contract Renewal and
 * Salary Increment (AL's Employee Exit "Type::Renewal" / the contract-focused slice of
 * Employee Change Request). A lighter document than Employee Editing: one header, no sub-lines,
 * same shape as lib/memberCharging.ts. On approval it writes a new lib/employees.ts contract row.
 */
import { one, all, run, tx, nextSequence, audit } from './db.ts';
import { AppError } from './errors.ts';
import { getEmployee, addContract } from './employees.ts';
import { findMatchingWorkflow, findPendingRoutedTask, pickConditionFields, startWorkflow } from './workflow.ts';
import { buildFilterClause, type FilterCondition, type FilterFieldDef } from './listFilters.ts';
import { buildOrderClause, type SortState } from './listSort.ts';
import type {
  Actor, EmployeeContractChange, EmployeeContractChangeNature, EmployeeContractChangeView,
} from './types.ts';

/** No separate "processed" tab: approval applies the contract/salary change immediately. */
export type ContractChangeView = 'open' | 'pending' | 'approved';

const VIEW_CLAUSE: Record<ContractChangeView, string> = {
  open: "c.status = 'Open'",
  pending: "c.status = 'Pending Approval'",
  approved: "c.status = 'Approved'",
};

const SELECT_ROW = `
  SELECT c.*, emp.employee_no, emp.first_name AS employee_first_name, emp.last_name AS employee_last_name
  FROM employee_contract_change c JOIN employee emp ON emp.id = c.employee_id`;

export const CONTRACT_CHANGE_FILTER_FIELDS: FilterFieldDef[] = [
  { key: 'no', label: 'No.', type: 'text', column: 'c.no' },
  {
    key: 'nature', label: 'Nature', type: 'select', column: 'c.nature',
    options: [
      { value: 'NEW_CONTRACT', label: 'New Contract' }, { value: 'RENEWAL', label: 'Renewal' },
      { value: 'SALARY_INCREMENT', label: 'Salary Increment' },
    ],
  },
  { key: 'created_by', label: 'Created By', type: 'text', column: 'c.created_by' },
  { key: 'created_at', label: 'Created', type: 'date', column: 'c.created_at', datetime: true },
];

const SORT_COLUMNS: Record<string, string> = { no: 'c.no', employee: 'emp.first_name', status: 'c.status' };

export interface ListContractChangesOptions {
  view?: ContractChangeView; search?: string; filters?: FilterCondition[]; sort?: SortState | null;
}

export const listContractChanges = (
  { view, search = '', filters = [], sort = null }: ListContractChangesOptions = {},
): Promise<EmployeeContractChangeView[]> => {
  const { clause, params } = buildFilterClause(CONTRACT_CHANGE_FILTER_FIELDS, filters);
  const orderBy = buildOrderClause(SORT_COLUMNS, sort, 'c.no DESC');
  return all<EmployeeContractChangeView>(
    `${SELECT_ROW}
     WHERE (c.no ILIKE @like OR emp.employee_no ILIKE @like OR emp.first_name ILIKE @like OR emp.last_name ILIKE @like)
       ${view ? `AND ${VIEW_CLAUSE[view]}` : ''}
       ${clause}
     ${orderBy}`,
    { like: `%${String(search).trim()}%`, ...params },
  );
};

export const getContractChange = (no: string): Promise<EmployeeContractChangeView | undefined> =>
  one<EmployeeContractChangeView>(`${SELECT_ROW} WHERE c.no = ?`, no);

export const hasAnyContractChanges = async (view?: ContractChangeView): Promise<boolean> =>
  !!(await one(`SELECT 1 FROM employee_contract_change c WHERE ${view ? VIEW_CLAUSE[view] : '1=1'} LIMIT 1`));

export interface ContractChangeInput {
  employeeId: number; nature: EmployeeContractChangeNature; contractTypeId?: number | null;
  proposedStartDate?: string | null; proposedEndDate?: string | null; proposedSalaryCents?: number | null;
  proposedGradeId?: number | null; reason?: string | null;
}

function assertMandatory(input: ContractChangeInput): void {
  if (!input.employeeId) throw new AppError('An employee is required', 'VALIDATION');
  if (!['NEW_CONTRACT', 'RENEWAL', 'SALARY_INCREMENT'].includes(input.nature)) throw new AppError('Invalid nature of change', 'VALIDATION');
  if ((input.nature === 'NEW_CONTRACT' || input.nature === 'RENEWAL') && !input.proposedStartDate) {
    throw new AppError('A start date is required', 'VALIDATION');
  }
  if (input.nature === 'SALARY_INCREMENT' && !(Number(input.proposedSalaryCents) > 0)) {
    throw new AppError('A proposed salary is required', 'VALIDATION');
  }
}

export async function createContractChange(input: ContractChangeInput, user: Actor): Promise<{ no: string }> {
  assertMandatory(input);
  const emp = await getEmployee(input.employeeId);
  if (!emp) throw new AppError('Employee not found', 'NOT_FOUND');
  const no = await nextSequence('EMPLOYEE_CONTRACT_CHANGE');
  await run(
    `INSERT INTO employee_contract_change
       (no, employee_id, nature, contract_type_id, proposed_start_date, proposed_end_date,
        proposed_salary_cents, proposed_grade_id, reason, created_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    no, input.employeeId, input.nature, input.contractTypeId ?? null, input.proposedStartDate ?? null,
    input.proposedEndDate ?? null, input.proposedSalaryCents != null ? Math.round(input.proposedSalaryCents) : null,
    input.proposedGradeId ?? null, input.reason?.trim() || null, new Date().toISOString(), user.username,
  );
  await audit(user, 'EMPLOYEE_CONTRACT_CHANGE_CREATE', 'employee_contract_change', no, { nature: input.nature });
  return { no };
}

export async function deleteContractChange(no: string, user: Actor): Promise<void> {
  const before = await one<Pick<EmployeeContractChange, 'status' | 'created_by'>>('SELECT status, created_by FROM employee_contract_change WHERE no = ?', no);
  if (!before) throw new AppError('Not found', 'NOT_FOUND');
  if (before.status !== 'Open') throw new AppError('Only an open request can be deleted', 'VALIDATION');
  if (before.created_by !== user.username) throw new AppError('Only the person who created this can delete it', 'NOT_CREATOR');
  await run('DELETE FROM employee_contract_change WHERE no = ?', no);
  await audit(user, 'EMPLOYEE_CONTRACT_CHANGE_DELETE', 'employee_contract_change', no, {});
}

export async function submitContractChange(no: string, user: Actor): Promise<{ autoApproved: boolean }> {
  const req = await one<EmployeeContractChange>('SELECT * FROM employee_contract_change WHERE no = ?', no);
  if (!req) throw new AppError('Not found', 'NOT_FOUND');
  if (req.status !== 'Open') throw new AppError('Only an open request can be submitted for approval', 'VALIDATION');

  const matched = await findMatchingWorkflow('EMPLOYEE_CONTRACT_CHANGE', await pickConditionFields('EMPLOYEE_CONTRACT_CHANGE', req));
  if (!matched) throw new AppError('There is no enabled workflow for this document', 'NO_WORKFLOW');

  await tx(async () => {
    await run("UPDATE employee_contract_change SET status = 'Pending Approval' WHERE no = ?", no);
    await startWorkflow(matched.workflow, matched.steps, { documentType: 'EMPLOYEE_CONTRACT_CHANGE', entityId: no, requestedBy: user.username, amount: Number(req.proposed_salary_cents || 0) });
  });
  const after = await one<{ status: string }>('SELECT status FROM employee_contract_change WHERE no = ?', no);
  return { autoApproved: after?.status === 'Approved' };
}

export async function cancelContractChangeApproval(no: string, user: Actor): Promise<void> {
  const req = await one<Pick<EmployeeContractChange, 'status' | 'created_by'>>('SELECT status, created_by FROM employee_contract_change WHERE no = ?', no);
  if (!req) throw new AppError('Not found', 'NOT_FOUND');
  if (req.status !== 'Pending Approval') throw new AppError('Only a request pending approval can be recalled', 'VALIDATION');
  const routed = await findPendingRoutedTask('EMPLOYEE_CONTRACT_CHANGE', no);
  const requestedBy = routed?.requested_by ?? req.created_by;
  if (requestedBy !== user.username) throw new AppError('Only the person who submitted this can cancel it', 'NOT_REQUESTER');
  await run("UPDATE employee_contract_change SET status = 'Open' WHERE no = ?", no);
  await audit(user, 'EMPLOYEE_CONTRACT_CHANGE_CANCEL_APPROVAL', 'employee_contract_change', no, {});
}

export async function rejectContractChange(no: string, reason: string | null, user: Actor): Promise<void> {
  if (!reason?.trim()) throw new AppError('A reason is required to reject a request', 'VALIDATION');
  const req = await one<EmployeeContractChange>('SELECT * FROM employee_contract_change WHERE no = ?', no);
  if (!req) throw new AppError('Not found', 'NOT_FOUND');
  if (req.status !== 'Pending Approval') throw new AppError('Only a request pending approval can be rejected', 'VALIDATION');
  await run("UPDATE employee_contract_change SET status = 'Open', decision_reason = ? WHERE no = ?", reason, no);
  await audit(user, 'EMPLOYEE_CONTRACT_CHANGE_REJECT', 'employee_contract_change', no, { reason });
}

/** Approved -> writes the new contract row (and, for a Salary Increment, that's the whole
 *  effect — the new salary lives on the contract row Payroll reads from). */
export async function approveContractChange(no: string, user: Actor): Promise<void> {
  return tx(async () => {
    const req = await one<EmployeeContractChange>('SELECT * FROM employee_contract_change WHERE no = ?', no);
    if (!req) throw new AppError('Not found', 'NOT_FOUND');
    if (req.status !== 'Pending Approval') throw new AppError('Only a request pending approval can be approved', 'VALIDATION');

    const emp = await getEmployee(req.employee_id);
    if (!emp) throw new AppError('Employee not found', 'NOT_FOUND');

    if (req.nature === 'SALARY_INCREMENT') {
      await addContract(req.employee_id, {
        contractTypeId: emp.contract_type_id, startDate: req.proposed_start_date || new Date().toISOString().slice(0, 10),
        jobTitle: emp.job_title, gradeId: req.proposed_grade_id ?? emp.job_grade_id,
        salaryCents: Number(req.proposed_salary_cents || 0),
      }, user);
    } else {
      await addContract(req.employee_id, {
        contractTypeId: req.contract_type_id ?? emp.contract_type_id, startDate: req.proposed_start_date!,
        endDate: req.proposed_end_date, jobTitle: emp.job_title, gradeId: req.proposed_grade_id ?? emp.job_grade_id,
        salaryCents: Number(req.proposed_salary_cents || 0),
      }, user);
      if (req.contract_type_id) await run('UPDATE employee SET contract_type_id = ? WHERE id = ?', req.contract_type_id, req.employee_id);
    }
    if (req.proposed_grade_id) await run('UPDATE employee SET job_grade_id = ? WHERE id = ?', req.proposed_grade_id, req.employee_id);

    await run("UPDATE employee_contract_change SET status = 'Approved', decision_reason = NULL WHERE no = ?", no);
    await audit(user, 'EMPLOYEE_CONTRACT_CHANGE_APPROVE', 'employee_contract_change', no, { nature: req.nature });
  });
}
