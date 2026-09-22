/*
 * Employee Management — the core staff master, ported from the ERP AL (Employee table +
 * extension, object range 52203xxx). Lifecycle: New -> Pending Approval -> Active, then
 * -> On Leave / Pending Final Payment / Inactive / Terminated as other modules (Leave
 * Management, Employee Exit, Payroll) drive it. Only a New record is directly editable — once
 * submitted, further changes to a live employee go through Employee Editing
 * (lib/employeeEdits.ts), a maker-checker split.
 */
import {
  one, all, run, tx, nextSequence, audit,
} from './db.ts';
import { AppError } from './errors.ts';
import { findMatchingWorkflow, findPendingRoutedTask, startWorkflow, pickConditionFields } from './workflow.ts';
import { buildFilterClause, type FilterCondition, type FilterFieldDef } from './listFilters.ts';
import { buildOrderClause, type SortState } from './listSort.ts';
import type {
  Actor, Employee, EmployeeView as EmployeeRow, EmployeeNextOfKin, EmployeeBeneficiary, EmployeeDependant,
  EmployeeEmergencyContact, EmployeeProfessionalBody, EmployeeWorkHistory, EmployeeBankAccount, EmployeeContract,
} from './types.ts';
import { assertContactColumns, assertContactRows } from './validate.ts';
import { applySalaryScaleToEmployee } from './salaryScales.ts';
import { assertJobCanTakeEmployee } from './companyJobs.ts';

/**
 * Placing an employee on a Company Job (AL Employee."Job Code"): the job must be approved with
 * a free post, and it defaults what the record leaves blank — job title, grade, dimensions.
 */
async function placeOnJob(input: Record<string, unknown>, employeeId: number | null, current: { company_job_id: number | null } | null): Promise<void> {
  const jobId = input.company_job_id == null || input.company_job_id === '' ? null : Number(input.company_job_id);
  if (!jobId) return;
  if (current && current.company_job_id === jobId) return;
  const job = await assertJobCanTakeEmployee(jobId, employeeId);
  if (!String(input.job_title ?? '').trim()) input.job_title = job.name;
  if (input.job_grade_id == null && job.job_grade_id) input.job_grade_id = job.job_grade_id;
  if (input.global_dimension_1_id == null && job.global_dimension_1_id) input.global_dimension_1_id = job.global_dimension_1_id;
  if (input.global_dimension_2_id == null && job.global_dimension_2_id) input.global_dimension_2_id = job.global_dimension_2_id;
}

/** Every field a New employee record (or an Employee Editing request) may carry — shared with
 *  lib/employeeEdits.ts so the two stay in lockstep. */
export const EMPLOYEE_EDITABLE_FIELDS = [
  'first_name', 'middle_name', 'last_name', 'gender', 'date_of_birth', 'national_id', 'kra_pin',
  'nssf_no', 'shif_no', 'marital_status', 'phone', 'alt_phone', 'email', 'physical_address',
  'county_id', 'sub_county_id', 'job_title', 'job_grade_id', 'company_job_id',
  'bank_code', 'bank_branch', 'bank_account_no', 'global_dimension_1_id', 'global_dimension_2_id',
] as const;
export type EmployeeEditableField = (typeof EMPLOYEE_EDITABLE_FIELDS)[number];

/** AL Tab52203623 "Payroll Salary Card": the payroll-side fields of the employee. Editable on a
 *  New card and, on an Employee Editing request, by HR only (never by the employee under Self
 *  Service — app/actions/employeeEdits.ts strips them). */
export const PAYROLL_SALARY_FIELDS = [
  'posting_group_id', 'salary_scale_id', 'basic_pay_cents', 'payment_mode', 'payroll_currency_code', 'pays_nssf', 'pays_shif', 'pays_paye',
  'payslip_message', 'suspend_pay', 'suspension_date', 'suspension_reasons', 'stop_relief', 'insurance_certificate',
] as const;
export type PayrollSalaryField = (typeof PAYROLL_SALARY_FIELDS)[number];
const PAYROLL_BOOLEAN_FIELDS: readonly PayrollSalaryField[] = ['pays_nssf', 'pays_shif', 'pays_paye', 'suspend_pay', 'stop_relief', 'insurance_certificate'];

/** Form values arrive as strings ('1' / '' for a checkbox); the salary-card columns are typed. */
export function normalisePayrollFields(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of PAYROLL_SALARY_FIELDS) {
    if (body[f] === undefined) continue;
    const v = body[f];
    if (PAYROLL_BOOLEAN_FIELDS.includes(f)) out[f] = v === true || v === 1 || v === '1' || v === 'true' || v === 'on';
    else if (f === 'posting_group_id' || f === 'salary_scale_id') out[f] = v ? Number(v) : null;
    // The form posts basic pay in major units; the column is cents.
    else if (f === 'basic_pay_cents') out[f] = Math.max(0, Math.round((Number(v) || 0) * 100));
    else out[f] = v === '' || v == null ? null : String(v);
  }
  if (out.payment_mode == null) delete out.payment_mode;
  // Lifting a suspension clears its date and reasons with it.
  if (out.suspend_pay === false) { out.suspension_date = null; out.suspension_reasons = null; }
  return out;
}

export type EmployeeInput = Partial<Record<EmployeeEditableField, string | number | null>> & Partial<Record<PayrollSalaryField, unknown>> & {
  nature_of_employment?: string; employee_type?: string; contract_type_id?: number | null;
  employment_date?: string; manager_id?: number | null; overview_manager_id?: number | null;
};

export type EmployeeListView = 'new' | 'pending' | 'active' | 'inactive' | 'all';

const VIEW_CLAUSE: Record<EmployeeListView, string> = {
  new: "e.status = 'NEW'",
  pending: "e.status = 'PENDING_APPROVAL'",
  active: "e.status IN ('ACTIVE','ON_LEAVE','PENDING_FINAL_PAYMENT')",
  inactive: "e.status IN ('INACTIVE','TERMINATED')",
  all: '1=1',
};

const SELECT_EMPLOYEE = `
  SELECT e.*,
         jg.name AS job_grade_name, ppg.code AS posting_group_code, ppg.name AS posting_group_name,
         cj.job_id AS company_job_code, cj.name AS company_job_name,
         ct.name AS contract_type_name,
         mgr.first_name AS manager_first_name, mgr.last_name AS manager_last_name,
         c.name  AS county_name, sc.name AS sub_county_name,
         gd1.code AS global_dimension_1_code, gd1.name AS global_dimension_1_name,
         gd2.code AS global_dimension_2_code, gd2.name AS global_dimension_2_name
  FROM employee e
  LEFT JOIN hr_job_grade jg ON jg.id = e.job_grade_id
  LEFT JOIN company_job cj ON cj.id = e.company_job_id
  LEFT JOIN payroll_posting_group ppg ON ppg.id = e.posting_group_id
  LEFT JOIN hr_employment_contract_type ct ON ct.id = e.contract_type_id
  LEFT JOIN employee mgr ON mgr.id = e.manager_id
  LEFT JOIN county c ON c.id = e.county_id
  LEFT JOIN sub_county sc ON sc.id = e.sub_county_id
  LEFT JOIN global_dimension_1_value gd1 ON gd1.id = e.global_dimension_1_id
  LEFT JOIN global_dimension_2_value gd2 ON gd2.id = e.global_dimension_2_id`;

export const EMPLOYEE_FILTER_FIELDS: FilterFieldDef[] = [
  { key: 'employee_no', label: 'Employee No.', type: 'text', column: 'e.employee_no' },
  { key: 'first_name', label: 'First Name', type: 'text', column: 'e.first_name' },
  { key: 'last_name', label: 'Last Name', type: 'text', column: 'e.last_name' },
  { key: 'national_id', label: 'National ID', type: 'text', column: 'e.national_id' },
  { key: 'global_dimension_1_id', label: 'Global Dimension 1', type: 'select', column: 'e.global_dimension_1_id' },
  { key: 'global_dimension_2_id', label: 'Global Dimension 2', type: 'select', column: 'e.global_dimension_2_id' },
  { key: 'job_grade_id', label: 'Job Grade', type: 'select', column: 'e.job_grade_id' },
  { key: 'gender', label: 'Gender', type: 'select', column: 'e.gender', options: [{ value: 'MALE', label: 'Male' }, { value: 'FEMALE', label: 'Female' }, { value: 'OTHER', label: 'Other' }] },
  {
    key: 'nature_of_employment', label: 'Nature of Employment', type: 'select', column: 'e.nature_of_employment',
    options: [
      { value: 'PERMANENT', label: 'Permanent' }, { value: 'CONTRACT', label: 'Contract' },
      { value: 'BOARD', label: 'Board' }, { value: 'SECONDED', label: 'Seconded' },
    ],
  },
  { key: 'employment_date', label: 'Employment Date', type: 'date', column: 'e.employment_date' },
  { key: 'created_by', label: 'Created By', type: 'text', column: 'e.created_by' },
];

const SORT_COLUMNS: Record<string, string> = {
  employee_no: 'e.employee_no',
  name: 'e.first_name',
  gd1: 'gd1.name',
  gd2: 'gd2.name',
  status: 'e.status',
  employment_date: 'e.employment_date',
};

export interface ListEmployeesOptions {
  view?: EmployeeListView; search?: string; filters?: FilterCondition[]; sort?: SortState | null;
}

export const listEmployees = (
  { view, search = '', filters = [], sort = null }: ListEmployeesOptions = {},
): Promise<EmployeeRow[]> => {
  const { clause, params } = buildFilterClause(EMPLOYEE_FILTER_FIELDS, filters);
  const orderBy = buildOrderClause(SORT_COLUMNS, sort, 'e.employee_no DESC');
  return all<EmployeeRow>(
    `${SELECT_EMPLOYEE}
     WHERE (e.employee_no ILIKE @like OR e.first_name ILIKE @like OR e.last_name ILIKE @like OR e.national_id ILIKE @like)
       ${view ? `AND ${VIEW_CLAUSE[view]}` : ''}
       ${clause}
     ${orderBy}`,
    { like: `%${String(search).trim()}%`, ...params },
  );
};

export const getEmployee = (id: number): Promise<EmployeeRow | undefined> =>
  one<EmployeeRow>(`${SELECT_EMPLOYEE} WHERE e.id = ?`, id);

export const hasAnyEmployees = async (view?: EmployeeListView): Promise<boolean> =>
  !!(await one(`SELECT 1 FROM employee e WHERE ${view ? VIEW_CLAUSE[view] : '1=1'} LIMIT 1`));

export async function getAdjacentEmployeeIds(
  id: number, view?: EmployeeListView,
): Promise<{ prevId: number | null; nextId: number | null }> {
  const clause = view ? `AND ${VIEW_CLAUSE[view]}` : '';
  const [prev, next] = await Promise.all([
    one<{ id: number }>(`SELECT e.id FROM employee e WHERE e.id < ? ${clause} ORDER BY e.id DESC LIMIT 1`, id),
    one<{ id: number }>(`SELECT e.id FROM employee e WHERE e.id > ? ${clause} ORDER BY e.id ASC LIMIT 1`, id),
  ]);
  return { prevId: prev?.id ?? null, nextId: next?.id ?? null };
}

/** Employees eligible for a "pick a manager / reliever / approver" dropdown elsewhere. */
export const listActiveEmployees = (): Promise<Pick<Employee, 'id' | 'employee_no' | 'first_name' | 'last_name'>[]> =>
  all(
    "SELECT id, employee_no, first_name, last_name FROM employee WHERE status IN ('ACTIVE','ON_LEAVE') ORDER BY first_name, last_name",
  );

/* ------------------------------------------------------------------ create / edit (New only) */

function assertMandatory(input: EmployeeInput): void {
  if (!input.first_name?.toString().trim()) throw new AppError('First name is required', 'VALIDATION');
  if (!input.last_name?.toString().trim()) throw new AppError('Last name is required', 'VALIDATION');
  if (!input.employment_date) throw new AppError('An employment date is required', 'VALIDATION');
}

export async function createEmployee(input: EmployeeInput, user: Actor): Promise<{ id: number; employeeNo: string }> {
  assertMandatory(input);
  assertContactColumns(input as Record<string, unknown>);
  const employeeNo = await nextSequence('EMPLOYEE');
  await placeOnJob(input as Record<string, unknown>, null, null);
  const cols = EMPLOYEE_EDITABLE_FIELDS.filter((f) => input[f] !== undefined);
  const info = await run(
    `INSERT INTO employee
       (employee_no, employment_date, nature_of_employment, employee_type, contract_type_id,
        manager_id, overview_manager_id, created_at, created_by ${cols.length ? ',' + cols.join(',') : ''})
     VALUES (?,?,?,?,?,?,?,?,? ${cols.length ? ',' + cols.map(() => '?').join(',') : ''})`,
    employeeNo, input.employment_date, input.nature_of_employment || 'PERMANENT', input.employee_type || 'STAFF',
    input.contract_type_id ?? null, input.manager_id ?? null, input.overview_manager_id ?? null,
    new Date().toISOString(), user.username, ...cols.map((c) => input[c] ?? null),
  );
  const id = Number(info.lastInsertRowid);
  await audit(user, 'EMPLOYEE_CREATE', 'employee', id, { employeeNo });
  return { id, employeeNo };
}

export async function updateEmployee(id: number, input: EmployeeInput, user: Actor): Promise<EmployeeRow> {
  assertContactColumns(input as Record<string, unknown>);
  const before = await one<Employee>('SELECT * FROM employee WHERE id = ?', id);
  if (!before) throw new AppError('Employee not found', 'NOT_FOUND');
  if (before.status !== 'NEW') {
    throw new AppError('Only a new, not-yet-submitted employee record can be edited directly — use Employee Editing instead', 'VALIDATION');
  }
  await placeOnJob(input as Record<string, unknown>, id, before);
  const cols = EMPLOYEE_EDITABLE_FIELDS.filter((f) => input[f] !== undefined);
  const extra: [string, unknown][] = Object.entries(normalisePayrollFields(input as Record<string, unknown>));
  if (input.employment_date !== undefined) extra.push(['employment_date', input.employment_date]);
  if (input.nature_of_employment !== undefined) extra.push(['nature_of_employment', input.nature_of_employment]);
  if (input.employee_type !== undefined) extra.push(['employee_type', input.employee_type]);
  if (input.contract_type_id !== undefined) extra.push(['contract_type_id', input.contract_type_id]);
  if (input.manager_id !== undefined) extra.push(['manager_id', input.manager_id]);
  if (input.overview_manager_id !== undefined) extra.push(['overview_manager_id', input.overview_manager_id]);
  const allCols = [...cols, ...extra.map(([c]) => c)];
  if (allCols.length) {
    await run(
      `UPDATE employee SET ${allCols.map((c) => `${c}=?`).join(',')} WHERE id=?`,
      ...cols.map((c) => input[c] ?? null), ...extra.map(([, v]) => v ?? null), id,
    );
    const bp = extra.find(([c]) => c === 'basic_pay_cents');
    if (bp) await syncContractSalary(id, Number(bp[1]));
    // A new notch confers its Basic Pay and benefits (AL Validate("J-G Steps")); a Basic Pay typed
    // alongside it in the same save is HR's manual override and wins.
    const scale = extra.find(([c]) => c === 'salary_scale_id');
    if (scale && (scale[1] ?? null) !== (before.salary_scale_id ?? null)) {
      await applySalaryScaleToEmployee(id, scale[1] as number | null, user);
      if (bp && Number(bp[1]) > 0) {
        await run('UPDATE employee SET basic_pay_cents = ? WHERE id = ?', Number(bp[1]), id);
        await syncContractSalary(id, Number(bp[1]));
      }
    }
    await audit(user, 'EMPLOYEE_UPDATE', 'employee', id, {});
  }
  return (await getEmployee(id))!;
}

/** Basic Pay lives on the Payroll Salary Card; the payroll run reads the current contract — so a
 *  change to one is written onto the other. */
export async function syncContractSalary(employeeId: number, basicPayCents: number): Promise<void> {
  await run('UPDATE employee_contract SET salary_cents = ? WHERE employee_id = ? AND is_current = true', Math.round(basicPayCents), employeeId);
}

/**
 * Sets (or clears) the employee's passport photo or specimen signature — the Employee Card's
 * identity strip. Like every other field on the card, it is editable only while the record is
 * New; once it has been sent for approval or approved, the images are fixed (a change would go
 * through Employee Editing like any other). Returns what was on file before, for the caller to
 * tidy up in media storage.
 */
export async function setEmployeeImage(
  id: number, kind: 'photo' | 'signature', publicId: string | null, user: Actor,
): Promise<string | null> {
  const col = kind === 'photo' ? 'photo_image' : 'signature_image';
  const before = await one<{ status: string; photo_image: string | null; signature_image: string | null }>(
    'SELECT status, photo_image, signature_image FROM employee WHERE id = ?', id,
  );
  if (!before) throw new AppError('Employee not found', 'NOT_FOUND');
  if (before.status !== 'NEW') {
    throw new AppError('The photo and signature can only be changed while the employee record is New', 'VALIDATION');
  }
  await run(`UPDATE employee SET ${col} = ? WHERE id = ?`, publicId, id);
  await audit(user, publicId ? `EMPLOYEE_${kind.toUpperCase()}_SET` : `EMPLOYEE_${kind.toUpperCase()}_CLEAR`, 'employee', id, {});
  return before[col];
}

export async function deleteEmployee(id: number, user: Actor): Promise<void> {
  const before = await one<Pick<Employee, 'status'>>('SELECT status FROM employee WHERE id = ?', id);
  if (!before) throw new AppError('Employee not found', 'NOT_FOUND');
  if (before.status !== 'NEW') throw new AppError('Only a new, not-yet-submitted employee record can be deleted', 'VALIDATION');
  await run('DELETE FROM employee WHERE id = ?', id);
  await audit(user, 'EMPLOYEE_DELETE', 'employee', id, {});
}

/* -------------------------------------------------------------------- sub-entities (live) */

async function assertBeneficiaryPercentages(rows: { percentage: number }[]): Promise<void> {
  if (!rows.length) return;
  const total = Math.round(rows.reduce((s, r) => s + (Number(r.percentage) || 0), 0) * 100) / 100;
  if (total > 100.01) throw new AppError(`Beneficiary percentages cannot exceed 100% (currently ${total}%)`, 'VALIDATION');
}

export const listNextOfKin = (employeeId: number): Promise<EmployeeNextOfKin[]> =>
  all('SELECT * FROM employee_next_of_kin WHERE employee_id = ? ORDER BY id', employeeId);

export async function replaceNextOfKin(employeeId: number, rows: Omit<EmployeeNextOfKin, 'id' | 'employee_id'>[]): Promise<void> {
  const clean = rows.filter((r) => r.full_name?.trim());
  assertContactRows(clean as unknown as Record<string, unknown>[]);
  await tx(async () => {
    await run('DELETE FROM employee_next_of_kin WHERE employee_id = ?', employeeId);
    for (const r of clean) {
      await run(
        'INSERT INTO employee_next_of_kin (employee_id, full_name, relationship, id_no, phone, email) VALUES (?,?,?,?,?,?)',
        employeeId, r.full_name.trim(), r.relationship || null, r.id_no || null, r.phone || null, r.email || null,
      );
    }
  });
}

export const listBeneficiaries = (employeeId: number): Promise<EmployeeBeneficiary[]> =>
  all('SELECT * FROM employee_beneficiary WHERE employee_id = ? ORDER BY id', employeeId);

export async function replaceBeneficiaries(employeeId: number, rows: Omit<EmployeeBeneficiary, 'id' | 'employee_id'>[]): Promise<void> {
  const clean = rows.filter((r) => r.full_name?.trim()).map((r) => ({ ...r, percentage: Number(r.percentage) || 0 }));
  assertContactRows(clean as unknown as Record<string, unknown>[]);
  await assertBeneficiaryPercentages(clean);
  await tx(async () => {
    await run('DELETE FROM employee_beneficiary WHERE employee_id = ?', employeeId);
    for (const r of clean) {
      await run(
        `INSERT INTO employee_beneficiary
           (employee_id, full_name, id_no, date_of_birth, relationship, gender, phone, email, percentage, is_minor)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        employeeId, r.full_name.trim(), r.id_no || null, r.date_of_birth || null, r.relationship || null,
        r.gender || null, r.phone || null, r.email || null, r.percentage, !!r.is_minor,
      );
    }
  });
}

export const listDependants = (employeeId: number): Promise<EmployeeDependant[]> =>
  all('SELECT * FROM employee_dependant WHERE employee_id = ? ORDER BY id', employeeId);

export async function replaceDependants(employeeId: number, rows: Omit<EmployeeDependant, 'id' | 'employee_id'>[]): Promise<void> {
  const clean = rows.filter((r) => r.full_name?.trim());
  await tx(async () => {
    await run('DELETE FROM employee_dependant WHERE employee_id = ?', employeeId);
    for (const r of clean) {
      await run(
        `INSERT INTO employee_dependant
           (employee_id, full_name, id_or_birth_cert_no, date_of_birth, relationship, gender, is_student, status)
         VALUES (?,?,?,?,?,?,?,?)`,
        employeeId, r.full_name.trim(), r.id_or_birth_cert_no || null, r.date_of_birth || null,
        r.relationship || null, r.gender || null, !!r.is_student, r.status || 'ACTIVE',
      );
    }
  });
}

export const listEmergencyContacts = (employeeId: number): Promise<EmployeeEmergencyContact[]> =>
  all('SELECT * FROM employee_emergency_contact WHERE employee_id = ? ORDER BY id', employeeId);

export async function replaceEmergencyContacts(employeeId: number, rows: Omit<EmployeeEmergencyContact, 'id' | 'employee_id'>[]): Promise<void> {
  const clean = rows.filter((r) => r.full_name?.trim());
  assertContactRows(clean as unknown as Record<string, unknown>[]);
  await tx(async () => {
    await run('DELETE FROM employee_emergency_contact WHERE employee_id = ?', employeeId);
    for (const r of clean) {
      await run(
        'INSERT INTO employee_emergency_contact (employee_id, full_name, relationship, phone, alt_phone, email) VALUES (?,?,?,?,?,?)',
        employeeId, r.full_name.trim(), r.relationship || null, r.phone || null, r.alt_phone || null, r.email || null,
      );
    }
  });
}

export const listProfessionalBodies = (employeeId: number): Promise<EmployeeProfessionalBody[]> =>
  all('SELECT * FROM employee_professional_body WHERE employee_id = ? ORDER BY id', employeeId);

export async function replaceProfessionalBodies(employeeId: number, rows: Omit<EmployeeProfessionalBody, 'id' | 'employee_id'>[]): Promise<void> {
  const clean = rows.filter((r) => r.body_name?.trim());
  await tx(async () => {
    await run('DELETE FROM employee_professional_body WHERE employee_id = ?', employeeId);
    for (const r of clean) {
      await run(
        'INSERT INTO employee_professional_body (employee_id, body_name, membership_no, from_date, to_date) VALUES (?,?,?,?,?)',
        employeeId, r.body_name.trim(), r.membership_no || null, r.from_date || null, r.to_date || null,
      );
    }
  });
}

export const listWorkHistory = (employeeId: number): Promise<EmployeeWorkHistory[]> =>
  all('SELECT * FROM employee_work_history WHERE employee_id = ? ORDER BY id', employeeId);

export async function replaceWorkHistory(employeeId: number, rows: Omit<EmployeeWorkHistory, 'id' | 'employee_id'>[]): Promise<void> {
  const clean = rows.filter((r) => r.institution?.trim());
  await tx(async () => {
    await run('DELETE FROM employee_work_history WHERE employee_id = ?', employeeId);
    for (const r of clean) {
      await run(
        'INSERT INTO employee_work_history (employee_id, institution, position_held, from_date, to_date, reason_for_leaving) VALUES (?,?,?,?,?,?)',
        employeeId, r.institution.trim(), r.position_held || null, r.from_date || null, r.to_date || null, r.reason_for_leaving || null,
      );
    }
  });
}

export const listBankAccounts = (employeeId: number): Promise<EmployeeBankAccount[]> =>
  all('SELECT * FROM employee_bank_account WHERE employee_id = ? ORDER BY id', employeeId);

async function assertBankSplitPercentages(rows: { percentage: number }[]): Promise<void> {
  if (!rows.length) return;
  const total = Math.round(rows.reduce((s, r) => s + (Number(r.percentage) || 0), 0) * 100) / 100;
  if (Math.abs(total - 100) > 0.01) {
    throw new AppError(`Bank account split percentages must add up to 100% (currently ${total}%)`, 'VALIDATION');
  }
}

export async function replaceBankAccounts(employeeId: number, rows: Omit<EmployeeBankAccount, 'id' | 'employee_id'>[]): Promise<void> {
  const clean = rows.filter((r) => r.account_no?.trim()).map((r) => ({ ...r, percentage: Number(r.percentage) || 0 }));
  await assertBankSplitPercentages(clean);
  await tx(async () => {
    await run('DELETE FROM employee_bank_account WHERE employee_id = ?', employeeId);
    for (const r of clean) {
      await run(
        'INSERT INTO employee_bank_account (employee_id, bank_code, branch, account_no, percentage) VALUES (?,?,?,?,?)',
        employeeId, r.bank_code || null, r.branch || null, r.account_no.trim(), r.percentage,
      );
    }
  });
}

/* ------------------------------------------------------------------------------ contracts */

export const listContracts = (employeeId: number): Promise<EmployeeContract[]> =>
  all('SELECT * FROM employee_contract WHERE employee_id = ? ORDER BY start_date DESC, id DESC', employeeId);

export const getCurrentContract = (employeeId: number): Promise<EmployeeContract | undefined> =>
  one('SELECT * FROM employee_contract WHERE employee_id = ? AND is_current = true', employeeId);

/** Inserts a new contract row and demotes any prior "current" one — used at onboarding approval
 *  and by lib/employeeContractChanges.ts when a New Contract / Renewal / Salary Increment is
 *  applied. */
export async function addContract(
  employeeId: number,
  contract: {
    contractTypeId?: number | null; startDate: string; endDate?: string | null; jobTitle?: string | null;
    gradeId?: number | null; salaryCents?: number; noticePeriodDays?: number | null;
  },
  user: Actor,
): Promise<{ id: number }> {
  return tx(async () => {
    await run('UPDATE employee_contract SET is_current = false WHERE employee_id = ? AND is_current = true', employeeId);
    const info = await run(
      `INSERT INTO employee_contract
         (employee_id, contract_type_id, start_date, end_date, job_title, grade_id, salary_cents,
          notice_period_days, is_current, created_at, created_by)
       VALUES (?,?,?,?,?,?,?,?,true,?,?)`,
      employeeId, contract.contractTypeId ?? null, contract.startDate, contract.endDate ?? null,
      contract.jobTitle ?? null, contract.gradeId ?? null, Math.round(contract.salaryCents || 0),
      contract.noticePeriodDays ?? null, new Date().toISOString(), user.username,
    );
    return { id: Number(info.lastInsertRowid) };
  });
}

/* -------------------------------------------------------------------------- onboarding (maker-checker) */

export async function submitEmployeeForApproval(id: number, user: Actor): Promise<{ autoApproved: boolean }> {
  const emp = await one<Employee>('SELECT * FROM employee WHERE id = ?', id);
  if (!emp) throw new AppError('Employee not found', 'NOT_FOUND');
  if (emp.status !== 'NEW') throw new AppError('Only a new employee record can be submitted for approval', 'VALIDATION');
  if (!emp.national_id) throw new AppError('A national ID is required before sending for approval', 'VALIDATION');

  const matched = await findMatchingWorkflow('EMPLOYEE_ONBOARDING', await pickConditionFields('EMPLOYEE_ONBOARDING', emp));
  if (!matched) throw new AppError('There is no enabled workflow for this document', 'NO_WORKFLOW');

  await tx(async () => {
    await run("UPDATE employee SET status = 'PENDING_APPROVAL' WHERE id = ?", id);
    await startWorkflow(matched.workflow, matched.steps, {
      documentType: 'EMPLOYEE_ONBOARDING', entityId: String(id), requestedBy: user.username, amount: 0,
    });
  });
  const after = await one<{ status: string }>('SELECT status FROM employee WHERE id = ?', id);
  return { autoApproved: after?.status === 'ACTIVE' };
}

export async function cancelEmployeeApproval(id: number, user: Actor): Promise<void> {
  const emp = await one<Pick<Employee, 'status' | 'created_by'>>('SELECT status, created_by FROM employee WHERE id = ?', id);
  if (!emp) throw new AppError('Employee not found', 'NOT_FOUND');
  if (emp.status !== 'PENDING_APPROVAL') throw new AppError('Only a record pending approval can be recalled', 'VALIDATION');
  const routed = await findPendingRoutedTask('EMPLOYEE_ONBOARDING', String(id));
  const requestedBy = routed?.requested_by ?? emp.created_by;
  if (requestedBy !== user.username) throw new AppError('Only the person who submitted this record can recall it', 'NOT_REQUESTER');
  await run("UPDATE employee SET status = 'NEW' WHERE id = ?", id);
  await audit(user, 'EMPLOYEE_CANCEL_APPROVAL', 'employee', id, {});
}

/** Approval flips the employee Active and opens their first contract row (job title/grade/salary
 *  as captured on the form), mirroring AL's RenameEmployeeOnApproval side effect minus the
 *  natural-key rename — this system keeps a stable id throughout. */
export async function approveEmployee(id: number, user: Actor): Promise<void> {
  return tx(async () => {
    const emp = await one<Employee>('SELECT * FROM employee WHERE id = ?', id);
    if (!emp) throw new AppError('Employee not found', 'NOT_FOUND');
    if (emp.status !== 'PENDING_APPROVAL') throw new AppError('Only a record pending approval can be approved', 'VALIDATION');

    const probationEnd = addMonths(emp.employment_date, emp.probation_period_months);
    await run(
      "UPDATE employee SET status = 'ACTIVE', decision_reason = NULL, probation_end_date = ? WHERE id = ?",
      probationEnd, id,
    );
    if (!(await getCurrentContract(id))) {
      await addContract(id, {
        contractTypeId: emp.contract_type_id, startDate: emp.employment_date, jobTitle: emp.job_title,
        gradeId: emp.job_grade_id, salaryCents: Number(emp.basic_pay_cents || 0),
      }, user);
    }
    await audit(user, 'EMPLOYEE_APPROVE', 'employee', id, {});
  });
}

export async function rejectEmployee(id: number, reason: string | null, user: Actor): Promise<void> {
  if (!reason?.trim()) throw new AppError('A reason is required to reject an employee record', 'VALIDATION');
  const emp = await one<Employee>('SELECT * FROM employee WHERE id = ?', id);
  if (!emp) throw new AppError('Employee not found', 'NOT_FOUND');
  if (emp.status !== 'PENDING_APPROVAL') throw new AppError('Only a record pending approval can be rejected', 'VALIDATION');
  await run("UPDATE employee SET status = 'NEW', decision_reason = ? WHERE id = ?", reason, id);
  await audit(user, 'EMPLOYEE_REJECT', 'employee', id, { reason });
}

function addMonths(isoDate: string, months: number): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}
