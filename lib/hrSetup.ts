/*
 * HR & Payroll — Employee Management setup masters: Job Grades (replaces AL "Employee Payroll
 * Scales"), Employment Contract Types, Termination Reasons (AL "Grounds for Termination") and
 * Exit Clearance Sections. Department is not a bespoke master here — it is the existing Global
 * Dimension 2 (global_dimension_2_value, see lib/pool.ts's listDimensionValues), the same
 * dimension infrastructure Members and G/L postings already use, managed under Admin -> Setup
 * Pool -> General -> Global Dimensions.
 */
import { one, all, run, audit } from './db.ts';
import { AppError } from './errors.ts';
import type {
  Actor, HrJobGrade, HrEmploymentContractType, HrTerminationReason, HrClearanceSection,
} from './types.ts';

/* -------------------------------------------------------------------------- job grades */

export const listJobGrades = (): Promise<HrJobGrade[]> =>
  all<HrJobGrade>('SELECT * FROM hr_job_grade ORDER BY code');

export interface JobGradeInput {
  id?: number | null; code: string; name: string;
  noticePeriodDays?: number; probationNoticePeriodDays?: number;
  leaveAllowanceAmount?: number; trainingAllowanceAmount?: number; overtimeAllowanceAmount?: number;
}

export async function saveJobGrade(input: JobGradeInput, user: Actor): Promise<{ id: number }> {
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  if (!code) throw new AppError('A grade code is required', 'VALIDATION');
  if (!name) throw new AppError('A grade name is required', 'VALIDATION');
  const noticePeriodDays = Math.round(Number(input.noticePeriodDays) || 30);
  const probationNoticePeriodDays = Math.round(Number(input.probationNoticePeriodDays) || 7);
  const leaveAllowanceAmount = Math.round(Number(input.leaveAllowanceAmount) || 0);
  const trainingAllowanceAmount = Math.round(Number(input.trainingAllowanceAmount) || 0);
  const overtimeAllowanceAmount = Math.round(Number(input.overtimeAllowanceAmount) || 0);

  if (input.id) {
    const dup = await one('SELECT 1 FROM hr_job_grade WHERE code = ? AND id != ?', code, input.id);
    if (dup) throw new AppError('That grade code already exists', 'DUPLICATE');
    await run(
      `UPDATE hr_job_grade SET code=?, name=?, notice_period_days=?, probation_notice_period_days=?,
         leave_allowance_amount=?, training_allowance_amount=?, overtime_allowance_amount=? WHERE id=?`,
      code, name, noticePeriodDays, probationNoticePeriodDays,
      leaveAllowanceAmount, trainingAllowanceAmount, overtimeAllowanceAmount, input.id,
    );
    await audit(user, 'HR_JOB_GRADE_UPDATE', 'hr_job_grade', input.id, {});
    return { id: input.id };
  }
  if (await one('SELECT 1 FROM hr_job_grade WHERE code = ?', code)) {
    throw new AppError('That grade code already exists', 'DUPLICATE');
  }
  const info = await run(
    `INSERT INTO hr_job_grade
       (code, name, notice_period_days, probation_notice_period_days, leave_allowance_amount,
        training_allowance_amount, overtime_allowance_amount, created_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    code, name, noticePeriodDays, probationNoticePeriodDays,
    leaveAllowanceAmount, trainingAllowanceAmount, overtimeAllowanceAmount,
    new Date().toISOString(), user.username,
  );
  await audit(user, 'HR_JOB_GRADE_CREATE', 'hr_job_grade', info.lastInsertRowid, {});
  return { id: Number(info.lastInsertRowid) };
}

export async function deleteJobGrade(id: number, user: Actor): Promise<void> {
  if (await one('SELECT 1 FROM employee WHERE job_grade_id = ?', id)) {
    throw new AppError('This grade has employees assigned and cannot be removed', 'IN_USE');
  }
  await run('DELETE FROM hr_job_grade WHERE id = ?', id);
  await audit(user, 'HR_JOB_GRADE_DELETE', 'hr_job_grade', id, {});
}

/* ------------------------------------------------------------------ contract types */

export const listContractTypes = (): Promise<HrEmploymentContractType[]> =>
  all<HrEmploymentContractType>('SELECT * FROM hr_employment_contract_type ORDER BY name');

export async function saveContractType(
  input: { id?: number | null; code: string; name: string; defaultNoticePeriodDays?: number }, user: Actor,
): Promise<{ id: number }> {
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  if (!code) throw new AppError('A code is required', 'VALIDATION');
  if (!name) throw new AppError('A name is required', 'VALIDATION');
  const days = Math.round(Number(input.defaultNoticePeriodDays) || 30);

  if (input.id) {
    const dup = await one('SELECT 1 FROM hr_employment_contract_type WHERE code = ? AND id != ?', code, input.id);
    if (dup) throw new AppError('That code already exists', 'DUPLICATE');
    await run(
      'UPDATE hr_employment_contract_type SET code=?, name=?, default_notice_period_days=? WHERE id=?',
      code, name, days, input.id,
    );
    await audit(user, 'HR_CONTRACT_TYPE_UPDATE', 'hr_employment_contract_type', input.id, {});
    return { id: input.id };
  }
  if (await one('SELECT 1 FROM hr_employment_contract_type WHERE code = ?', code)) {
    throw new AppError('That code already exists', 'DUPLICATE');
  }
  const info = await run(
    'INSERT INTO hr_employment_contract_type (code, name, default_notice_period_days, created_at, created_by) VALUES (?,?,?,?,?)',
    code, name, days, new Date().toISOString(), user.username,
  );
  await audit(user, 'HR_CONTRACT_TYPE_CREATE', 'hr_employment_contract_type', info.lastInsertRowid, {});
  return { id: Number(info.lastInsertRowid) };
}

export async function deleteContractType(id: number, user: Actor): Promise<void> {
  if (await one('SELECT 1 FROM employee WHERE contract_type_id = ?', id)) {
    throw new AppError('This contract type is in use and cannot be removed', 'IN_USE');
  }
  await run('DELETE FROM hr_employment_contract_type WHERE id = ?', id);
  await audit(user, 'HR_CONTRACT_TYPE_DELETE', 'hr_employment_contract_type', id, {});
}

/* ---------------------------------------------------------------- termination reasons */

export const listTerminationReasons = (): Promise<HrTerminationReason[]> =>
  all<HrTerminationReason>('SELECT * FROM hr_termination_reason ORDER BY description');

export async function saveTerminationReason(
  input: { id?: number | null; code: string; description: string; payGratuity?: boolean }, user: Actor,
): Promise<{ id: number }> {
  const code = input.code.trim().toUpperCase();
  const description = input.description.trim();
  if (!code) throw new AppError('A code is required', 'VALIDATION');
  if (!description) throw new AppError('A description is required', 'VALIDATION');
  const payGratuity = !!input.payGratuity;

  if (input.id) {
    const dup = await one('SELECT 1 FROM hr_termination_reason WHERE code = ? AND id != ?', code, input.id);
    if (dup) throw new AppError('That code already exists', 'DUPLICATE');
    await run(
      'UPDATE hr_termination_reason SET code=?, description=?, pay_gratuity=? WHERE id=?',
      code, description, payGratuity, input.id,
    );
    await audit(user, 'HR_TERMINATION_REASON_UPDATE', 'hr_termination_reason', input.id, {});
    return { id: input.id };
  }
  if (await one('SELECT 1 FROM hr_termination_reason WHERE code = ?', code)) {
    throw new AppError('That code already exists', 'DUPLICATE');
  }
  const info = await run(
    'INSERT INTO hr_termination_reason (code, description, pay_gratuity, created_at, created_by) VALUES (?,?,?,?,?)',
    code, description, payGratuity, new Date().toISOString(), user.username,
  );
  await audit(user, 'HR_TERMINATION_REASON_CREATE', 'hr_termination_reason', info.lastInsertRowid, {});
  return { id: Number(info.lastInsertRowid) };
}

export async function deleteTerminationReason(id: number, user: Actor): Promise<void> {
  if (await one('SELECT 1 FROM employee_exit WHERE termination_reason_id = ?', id)) {
    throw new AppError('This reason is used by an employee exit and cannot be removed', 'IN_USE');
  }
  await run('DELETE FROM hr_termination_reason WHERE id = ?', id);
  await audit(user, 'HR_TERMINATION_REASON_DELETE', 'hr_termination_reason', id, {});
}

/* ---------------------------------------------------------------- clearance sections */

export const listClearanceSections = (): Promise<HrClearanceSection[]> =>
  all<HrClearanceSection>('SELECT * FROM hr_clearance_section ORDER BY sort_order, name');

export async function saveClearanceSection(
  input: { id?: number | null; code: string; name: string; ownerEmail?: string | null; sortOrder?: number }, user: Actor,
): Promise<{ id: number }> {
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  if (!code) throw new AppError('A code is required', 'VALIDATION');
  if (!name) throw new AppError('A name is required', 'VALIDATION');
  const ownerEmail = input.ownerEmail?.trim() || null;
  const sortOrder = Math.round(Number(input.sortOrder) || 0);

  if (input.id) {
    const dup = await one('SELECT 1 FROM hr_clearance_section WHERE code = ? AND id != ?', code, input.id);
    if (dup) throw new AppError('That code already exists', 'DUPLICATE');
    await run(
      'UPDATE hr_clearance_section SET code=?, name=?, owner_email=?, sort_order=? WHERE id=?',
      code, name, ownerEmail, sortOrder, input.id,
    );
    await audit(user, 'HR_CLEARANCE_SECTION_UPDATE', 'hr_clearance_section', input.id, {});
    return { id: input.id };
  }
  if (await one('SELECT 1 FROM hr_clearance_section WHERE code = ?', code)) {
    throw new AppError('That code already exists', 'DUPLICATE');
  }
  const info = await run(
    'INSERT INTO hr_clearance_section (code, name, owner_email, sort_order, created_at, created_by) VALUES (?,?,?,?,?,?)',
    code, name, ownerEmail, sortOrder, new Date().toISOString(), user.username,
  );
  await audit(user, 'HR_CLEARANCE_SECTION_CREATE', 'hr_clearance_section', info.lastInsertRowid, {});
  return { id: Number(info.lastInsertRowid) };
}

export async function deleteClearanceSection(id: number, user: Actor): Promise<void> {
  if (await one('SELECT 1 FROM employee_exit_clearance_line WHERE section_id = ?', id)) {
    throw new AppError('This section is used on an employee exit and cannot be removed', 'IN_USE');
  }
  await run('DELETE FROM hr_clearance_section WHERE id = ?', id);
  await audit(user, 'HR_CLEARANCE_SECTION_DELETE', 'hr_clearance_section', id, {});
}
