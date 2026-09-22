/*
 * Salary Grades & Scales — ported from the Sacco ERP AL:
 *
 *   Employee Payroll Scales (Tab52203626)   = hr_job_grade          the grade
 *   Salary Scale Pointers   (Tab52203636)   = hr_salary_scale       a notch on the grade + Basic Pay
 *   Income/Deduction Config (Tab52203627)   = hr_salary_scale_benefit  the notch's earnings/deductions
 *   Employee "J-G Steps"                    = employee.salary_scale_id
 *
 * The AL behaviour this reproduces:
 *   * Validate("J-G Steps") — placing an employee on a notch sets their Payroll Salary Card
 *     Basic Pay to the notch's, switches Pays NSSF/SHIF/PAYE on, drops the payroll lines the old
 *     notch conferred and inserts the new notch's (applySalaryScaleToEmployee).
 *   * Income/Deduction Configuration OnValidate(Amount) / OnDelete — changing a notch's benefit
 *     updates every employee on that notch; removing it removes their line (propagate*).
 *   * HR may still edit the employee's lines by hand afterwards — a conferred line is an
 *     ordinary employee_payroll_transaction row, merely tagged with the notch it came from.
 *
 * Kept free of lib/employees.ts imports (that module calls into here), so the contract-salary
 * sync and the open-period lookup are plain SQL.
 */
import { one, all, run, tx, audit } from './db.ts';
import { AppError } from './errors.ts';
import type { Actor, Cents, HrSalaryScale, HrSalaryScaleBenefitView, HrSalaryScaleView } from './types.ts';

/* ------------------------------------------------------------------ reads */

const SELECT_SCALE = `
  SELECT s.*, g.code AS job_grade_code, g.name AS job_grade_name,
         (SELECT COUNT(*) FROM employee e WHERE e.salary_scale_id = s.id)::int AS employee_count
  FROM hr_salary_scale s JOIN hr_job_grade g ON g.id = s.job_grade_id`;

export const listScaleBenefits = (scaleId: number): Promise<HrSalaryScaleBenefitView[]> =>
  all<HrSalaryScaleBenefitView>(
    `SELECT b.*, c.code AS transaction_code, c.name AS transaction_name, c.type AS transaction_type
     FROM hr_salary_scale_benefit b JOIN payroll_transaction_code c ON c.id = b.transaction_code_id
     WHERE b.salary_scale_id = ? ORDER BY c.type, c.name`, scaleId,
  );

/** Every notch, with its benefits — for the setup screen and the employee card's picker. */
export async function listSalaryScales(jobGradeId?: number | null): Promise<HrSalaryScaleView[]> {
  const rows = await all<Omit<HrSalaryScaleView, 'benefits'>>(
    `${SELECT_SCALE} ${jobGradeId ? 'WHERE s.job_grade_id = ?' : ''} ORDER BY g.code, s.sequence, s.code`,
    ...(jobGradeId ? [jobGradeId] : []),
  );
  const out: HrSalaryScaleView[] = [];
  for (const r of rows) out.push({ ...r, employee_count: Number(r.employee_count), benefits: await listScaleBenefits(r.id) });
  return out;
}

export async function getSalaryScale(id: number): Promise<HrSalaryScaleView | undefined> {
  const r = await one<Omit<HrSalaryScaleView, 'benefits'>>(`${SELECT_SCALE} WHERE s.id = ?`, id);
  return r ? { ...r, employee_count: Number(r.employee_count), benefits: await listScaleBenefits(id) } : undefined;
}

/* ------------------------------------------------------------------ notches */

export interface SalaryScaleInput {
  id?: number | null; jobGradeId: number; code: string; name?: string | null; basicPayCents: Cents; sequence?: number | null;
  status?: 'ACTIVE' | 'INACTIVE';
}

export async function saveSalaryScale(input: SalaryScaleInput, user: Actor): Promise<{ id: number }> {
  const code = input.code.trim().toUpperCase();
  if (!code) throw new AppError('A notch code is required — "1", "2" … or "A", "B"', 'VALIDATION');
  if (!input.jobGradeId) throw new AppError('A job grade is required', 'VALIDATION');
  if (!(await one('SELECT 1 FROM hr_job_grade WHERE id = ?', input.jobGradeId))) throw new AppError('Job grade not found', 'NOT_FOUND');
  const basic = Math.max(0, Math.round(input.basicPayCents || 0));
  const dup = await one<{ id: number }>('SELECT id FROM hr_salary_scale WHERE job_grade_id = ? AND code = ? AND id <> ?', input.jobGradeId, code, input.id ?? 0);
  if (dup) throw new AppError(`Notch ${code} already exists on this grade`, 'DUPLICATE');
  const sequence = input.sequence ?? Number((await one<{ n: number }>('SELECT COALESCE(MAX(sequence), 0) + 1 AS n FROM hr_salary_scale WHERE job_grade_id = ?', input.jobGradeId))?.n ?? 1);

  if (input.id) {
    const before = await one<HrSalaryScale>('SELECT * FROM hr_salary_scale WHERE id = ?', input.id);
    if (!before) throw new AppError('Notch not found', 'NOT_FOUND');
    await run(
      'UPDATE hr_salary_scale SET job_grade_id = ?, code = ?, name = ?, basic_pay_cents = ?, sequence = ?, status = ? WHERE id = ?',
      input.jobGradeId, code, input.name?.trim() || null, basic, sequence, input.status ?? before.status, input.id,
    );
    // AL Salary Scale Pointers → Payroll Salary Card: a new Basic Pay reaches everyone on the notch.
    if (Number(before.basic_pay_cents) !== basic) await propagateBasicPay(input.id, basic);
    await audit(user, 'SALARY_SCALE_UPDATE', 'hr_salary_scale', input.id, { code, basic });
    return { id: input.id };
  }
  const info = await run(
    'INSERT INTO hr_salary_scale (job_grade_id, code, name, basic_pay_cents, sequence, status, created_at, created_by) VALUES (?,?,?,?,?,?,?,?)',
    input.jobGradeId, code, input.name?.trim() || null, basic, sequence, input.status ?? 'ACTIVE', new Date().toISOString(), user.username,
  );
  await audit(user, 'SALARY_SCALE_CREATE', 'hr_salary_scale', info.lastInsertRowid, { code, basic });
  return { id: Number(info.lastInsertRowid) };
}

export async function deleteSalaryScale(id: number, user: Actor): Promise<void> {
  const inUse = await one<{ n: number }>('SELECT COUNT(*) AS n FROM employee WHERE salary_scale_id = ?', id);
  if (Number(inUse?.n ?? 0) > 0) throw new AppError(`${inUse!.n} employee(s) are on this notch — move them first`, 'VALIDATION');
  await run('DELETE FROM hr_salary_scale WHERE id = ?', id);
  await audit(user, 'SALARY_SCALE_DELETE', 'hr_salary_scale', id, {});
}

/* ------------------------------------------------------------------ benefits */

export interface ScaleBenefitInput { salaryScaleId: number; transactionCodeId: number; amountCents: Cents; notes?: string | null }

export async function saveScaleBenefit(input: ScaleBenefitInput, user: Actor): Promise<{ id: number }> {
  const code = await one<{ id: number; type: string; name: string }>('SELECT id, type, name FROM payroll_transaction_code WHERE id = ?', input.transactionCodeId);
  if (!code) throw new AppError('Transaction code not found', 'NOT_FOUND');
  // AL: TableRelation Type = Income | Deduction — statutory and system codes are not benefits.
  if (code.type !== 'INCOME' && code.type !== 'DEDUCTION') throw new AppError('Only an earning or a deduction code can be a scale benefit', 'VALIDATION');
  const amount = Math.max(0, Math.round(input.amountCents || 0));
  const existing = await one<{ id: number }>('SELECT id FROM hr_salary_scale_benefit WHERE salary_scale_id = ? AND transaction_code_id = ?', input.salaryScaleId, input.transactionCodeId);
  let id: number;
  if (existing) {
    await run('UPDATE hr_salary_scale_benefit SET amount_cents = ?, notes = ? WHERE id = ?', amount, input.notes?.trim() || null, existing.id);
    id = existing.id;
  } else {
    const info = await run('INSERT INTO hr_salary_scale_benefit (salary_scale_id, transaction_code_id, amount_cents, notes) VALUES (?,?,?,?)',
      input.salaryScaleId, input.transactionCodeId, amount, input.notes?.trim() || null);
    id = Number(info.lastInsertRowid);
  }
  // AL Income/Deduction Configuration OnValidate(Amount): everyone on the notch gets the line
  // at the new amount in the open period (inserted if they never had it).
  await propagateBenefit(input.salaryScaleId, input.transactionCodeId, amount, user);
  await audit(user, 'SALARY_SCALE_BENEFIT_SAVE', 'hr_salary_scale_benefit', id, { code: code.name, amount });
  return { id };
}

export async function deleteScaleBenefit(id: number, user: Actor): Promise<void> {
  const b = await one<{ salary_scale_id: number; transaction_code_id: number }>('SELECT salary_scale_id, transaction_code_id FROM hr_salary_scale_benefit WHERE id = ?', id);
  if (!b) throw new AppError('Benefit not found', 'NOT_FOUND');
  await run('DELETE FROM hr_salary_scale_benefit WHERE id = ?', id);
  // AL OnDelete: the line the notch conferred leaves everyone on it (open period only).
  const period = await openPeriod();
  if (period) {
    await run(
      `DELETE FROM employee_payroll_transaction WHERE payroll_period_id = ? AND salary_scale_id = ? AND transaction_code_id = ?`,
      period.id, b.salary_scale_id, b.transaction_code_id,
    );
  }
  await audit(user, 'SALARY_SCALE_BENEFIT_DELETE', 'hr_salary_scale_benefit', id, {});
}

/** Copies every benefit of one notch onto another (replacing what the target had) — how a
 *  scale is built quickly: define notch 1, copy, adjust. */
export async function copyScaleBenefits(fromScaleId: number, toScaleId: number, user: Actor): Promise<{ copied: number }> {
  if (fromScaleId === toScaleId) throw new AppError('Choose a different notch to copy from', 'VALIDATION');
  const rows = await all<{ transaction_code_id: number; amount_cents: Cents; notes: string | null }>(
    'SELECT transaction_code_id, amount_cents, notes FROM hr_salary_scale_benefit WHERE salary_scale_id = ?', fromScaleId,
  );
  await tx(async () => {
    await run('DELETE FROM hr_salary_scale_benefit WHERE salary_scale_id = ?', toScaleId);
    for (const r of rows) {
      await run('INSERT INTO hr_salary_scale_benefit (salary_scale_id, transaction_code_id, amount_cents, notes) VALUES (?,?,?,?)',
        toScaleId, r.transaction_code_id, r.amount_cents, r.notes);
    }
  });
  // Everyone on the target notch follows it.
  const emps = await all<{ id: number }>('SELECT id FROM employee WHERE salary_scale_id = ?', toScaleId);
  for (const e of emps) await conferBenefits(e.id, toScaleId, user);
  await audit(user, 'SALARY_SCALE_BENEFITS_COPY', 'hr_salary_scale', toScaleId, { from: fromScaleId, copied: rows.length });
  return { copied: rows.length };
}

/* ------------------------------------------------------------------ inheritance */

const openPeriod = () => one<{ id: number }>("SELECT id FROM payroll_period WHERE status = 'OPEN' ORDER BY id DESC LIMIT 1");

async function propagateBasicPay(scaleId: number, basic: Cents): Promise<void> {
  await run('UPDATE employee SET basic_pay_cents = ? WHERE salary_scale_id = ?', basic, scaleId);
  await run(
    `UPDATE employee_contract c SET salary_cents = ? FROM employee e WHERE e.id = c.employee_id AND c.is_current = true AND e.salary_scale_id = ?`,
    basic, scaleId,
  );
}

async function propagateBenefit(scaleId: number, transactionCodeId: number, amount: Cents, user: Actor): Promise<void> {
  const period = await openPeriod();
  if (!period) return;
  const emps = await all<{ id: number }>('SELECT id FROM employee WHERE salary_scale_id = ?', scaleId);
  for (const e of emps) {
    const existing = await one<{ id: number }>(
      'SELECT id FROM employee_payroll_transaction WHERE employee_id = ? AND payroll_period_id = ? AND transaction_code_id = ? AND salary_scale_id = ?',
      e.id, period.id, transactionCodeId, scaleId,
    );
    if (existing) await run('UPDATE employee_payroll_transaction SET amount_cents = ? WHERE id = ?', amount, existing.id);
    else {
      await run(
        `INSERT INTO employee_payroll_transaction (employee_id, transaction_code_id, payroll_period_id, amount_cents, temporary, notes, salary_scale_id, created_at, created_by)
         VALUES (?,?,?,?,false,?,?,?,?)`,
        e.id, transactionCodeId, period.id, amount, 'From salary scale', scaleId, new Date().toISOString(), user.username,
      );
    }
  }
}

/** Replaces the open period's scale-conferred lines for one employee with the notch's benefits. */
async function conferBenefits(employeeId: number, scaleId: number | null, user: Actor): Promise<number> {
  const period = await openPeriod();
  if (!period) return 0;
  await run('DELETE FROM employee_payroll_transaction WHERE employee_id = ? AND payroll_period_id = ? AND salary_scale_id IS NOT NULL', employeeId, period.id);
  if (!scaleId) return 0;
  const benefits = await all<{ transaction_code_id: number; amount_cents: Cents }>('SELECT transaction_code_id, amount_cents FROM hr_salary_scale_benefit WHERE salary_scale_id = ?', scaleId);
  let conferred = 0;
  for (const b of benefits) {
    // One line per code per period (AL's key): a line HR keyed by hand for this code stays.
    if (await one('SELECT 1 FROM employee_payroll_transaction WHERE employee_id = ? AND payroll_period_id = ? AND transaction_code_id = ? AND loan_id IS NULL', employeeId, period.id, b.transaction_code_id)) continue;
    await run(
      `INSERT INTO employee_payroll_transaction (employee_id, transaction_code_id, payroll_period_id, amount_cents, temporary, notes, salary_scale_id, created_at, created_by)
       VALUES (?,?,?,?,false,?,?,?,?)`,
      employeeId, b.transaction_code_id, period.id, Number(b.amount_cents), 'From salary scale', scaleId, new Date().toISOString(), user.username,
    );
    conferred += 1;
  }
  return conferred;
}

/**
 * AL Employee.Validate("J-G Steps"): puts the employee on a notch (or takes them off with null)
 * — Basic Pay follows the notch (and the current contract with it), the statutory switches come
 * on, and the notch's benefits replace whatever the previous notch conferred in the open period.
 * Lines HR added by hand are untouched. The notch must belong to the employee's job grade.
 */
export async function applySalaryScaleToEmployee(employeeId: number, scaleId: number | null, user: Actor): Promise<{ basicPay: Cents; benefits: number }> {
  const emp = await one<{ id: number; job_grade_id: number | null; employee_no: string }>('SELECT id, job_grade_id, employee_no FROM employee WHERE id = ?', employeeId);
  if (!emp) throw new AppError('Employee not found', 'NOT_FOUND');
  if (!scaleId) {
    await run('UPDATE employee SET salary_scale_id = NULL WHERE id = ?', employeeId);
    const removed = await conferBenefits(employeeId, null, user);
    await audit(user, 'EMPLOYEE_SALARY_SCALE_CLEAR', 'employee', employeeId, { removed });
    return { basicPay: 0, benefits: 0 };
  }
  const scale = await one<HrSalaryScale>('SELECT * FROM hr_salary_scale WHERE id = ?', scaleId);
  if (!scale) throw new AppError('Salary scale notch not found', 'NOT_FOUND');
  if (emp.job_grade_id && scale.job_grade_id !== emp.job_grade_id) {
    throw new AppError('That notch belongs to a different job grade — set the job grade first', 'VALIDATION');
  }
  const basic = Number(scale.basic_pay_cents);
  await run(
    `UPDATE employee SET salary_scale_id = ?, job_grade_id = COALESCE(job_grade_id, ?), basic_pay_cents = ?,
       pays_nssf = true, pays_shif = true, pays_paye = true WHERE id = ?`,
    scaleId, scale.job_grade_id, basic, employeeId,
  );
  await run('UPDATE employee_contract SET salary_cents = ? WHERE employee_id = ? AND is_current = true', basic, employeeId);
  const benefits = await conferBenefits(employeeId, scaleId, user);
  await audit(user, 'EMPLOYEE_SALARY_SCALE_APPLY', 'employee', employeeId, { scale: scale.code, basic, benefits });
  return { basicPay: basic, benefits };
}
