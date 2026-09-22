/*
 * Payroll setup masters — posting groups (G/L account mapping per AL "Employee Posting Group"),
 * PAYE bands, NSSF tiers, Transaction Codes (the reusable earning/deduction catalogue) and the
 * single Payroll Setup rates record. Mirrors lib/payablesSetup.ts's shape.
 */
import { one, all, run, audit } from './db.ts';
import { AppError } from './errors.ts';
import { assertFormulaValid, formulaCodes } from './payrollFormula.ts';
import { PERIOD_CODES } from './payrollCodes.ts';
import type {
  Actor, HrPayrollSetup, PayrollPostingGroup, PayrollPayeBand, PayrollNssfTier, PayrollTransactionCode,
  PayrollTransactionType, PayrollBalanceType, PayrollSpecialType, PayrollAmountPreference,
} from './types.ts';

/* ------------------------------------------------------------------------------- setup singleton */

export const getPayrollSetup = (): Promise<HrPayrollSetup> => one<HrPayrollSetup>('SELECT * FROM hr_payroll_setup WHERE id = 1') as Promise<HrPayrollSetup>;

export interface PayrollSetupInput {
  personalReliefCents?: number; insuranceReliefPct?: number; maxReliefCents?: number; mortgageReliefCents?: number;
  shifPct?: number; shifBasedOn?: string; nssfEmployerFactor?: number;
  housingLevyEnabled?: boolean; housingLevyPct?: number; housingLevyBasedOn?: string;
  minimumReliefThresholdCents?: number; secondaryTaxPct?: number; monthlyWorkingDays?: number;
  pensionDeductionCapCents?: number; prmfCapCents?: number; shifDeductible?: boolean; housingLevyDeductible?: boolean;
}

export async function updatePayrollSetup(input: PayrollSetupInput, user: Actor): Promise<void> {
  await run(
    `UPDATE hr_payroll_setup SET
       personal_relief_cents=?, insurance_relief_pct=?, max_relief_cents=?, mortgage_relief_cents=?,
       shif_pct=?, shif_based_on=?, nssf_employer_factor=?, housing_levy_enabled=?, housing_levy_pct=?,
       housing_levy_based_on=?, minimum_relief_threshold_cents=?, secondary_tax_pct=?, monthly_working_days=?,
       pension_deduction_cap_cents=?, prmf_cap_cents=?, shif_deductible=?, housing_levy_deductible=?,
       updated_at=?, updated_by=?
     WHERE id = 1`,
    Math.round(Number(input.personalReliefCents) || 0), Number(input.insuranceReliefPct) || 0,
    Math.round(Number(input.maxReliefCents) || 0), Math.round(Number(input.mortgageReliefCents) || 0),
    Number(input.shifPct) || 0, input.shifBasedOn || 'GROSS', Number(input.nssfEmployerFactor) || 1,
    !!input.housingLevyEnabled, Number(input.housingLevyPct) || 0, input.housingLevyBasedOn || 'GROSS',
    Math.round(Number(input.minimumReliefThresholdCents) || 0), Number(input.secondaryTaxPct) || 0,
    Math.round(Number(input.monthlyWorkingDays) || 22),
    Math.round(Number(input.pensionDeductionCapCents) || 0), Math.round(Number(input.prmfCapCents) || 0),
    input.shifDeductible !== false, input.housingLevyDeductible !== false,
    new Date().toISOString(), user.username,
  );
  await audit(user, 'PAYROLL_SETUP_UPDATE', 'hr_payroll_setup', 1, {});
}

/* --------------------------------------------------------------------------------- posting groups */

export const listPostingGroups = (): Promise<PayrollPostingGroup[]> => all('SELECT * FROM payroll_posting_group ORDER BY code');

export interface PostingGroupInput {
  id?: number | null; code: string; name: string;
  salaryExpenseAccountId: number; payePayableAccountId: number; netPayPayableAccountId: number;
  nssfEmployeePayableAccountId: number; nssfEmployerExpenseAccountId: number; nssfEmployerPayableAccountId: number;
  shifPayableAccountId: number;
  housingLevyEmployeePayableAccountId: number; housingLevyEmployerExpenseAccountId: number; housingLevyEmployerPayableAccountId: number;
}

export async function savePostingGroup(input: PostingGroupInput, user: Actor): Promise<{ id: number }> {
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  if (!code) throw new AppError('A code is required', 'VALIDATION');
  if (!name) throw new AppError('A name is required', 'VALIDATION');
  const ids = [
    input.salaryExpenseAccountId, input.payePayableAccountId, input.netPayPayableAccountId,
    input.nssfEmployeePayableAccountId, input.nssfEmployerExpenseAccountId, input.nssfEmployerPayableAccountId,
    input.shifPayableAccountId, input.housingLevyEmployeePayableAccountId, input.housingLevyEmployerExpenseAccountId,
    input.housingLevyEmployerPayableAccountId,
  ];
  if (ids.some((v) => !v)) throw new AppError('Every G/L account on this posting group is required', 'VALIDATION');

  if (input.id) {
    const dup = await one('SELECT 1 FROM payroll_posting_group WHERE code = ? AND id != ?', code, input.id);
    if (dup) throw new AppError('That code already exists', 'DUPLICATE');
    await run(
      `UPDATE payroll_posting_group SET code=?, name=?, salary_expense_account_id=?, paye_payable_account_id=?,
         net_pay_payable_account_id=?, nssf_employee_payable_account_id=?, nssf_employer_expense_account_id=?,
         nssf_employer_payable_account_id=?, shif_payable_account_id=?, housing_levy_employee_payable_account_id=?,
         housing_levy_employer_expense_account_id=?, housing_levy_employer_payable_account_id=? WHERE id=?`,
      code, name, ...ids, input.id,
    );
    await audit(user, 'PAYROLL_POSTING_GROUP_UPDATE', 'payroll_posting_group', input.id, {});
    return { id: input.id };
  }
  if (await one('SELECT 1 FROM payroll_posting_group WHERE code = ?', code)) throw new AppError('That code already exists', 'DUPLICATE');
  const info = await run(
    `INSERT INTO payroll_posting_group
       (code, name, salary_expense_account_id, paye_payable_account_id, net_pay_payable_account_id,
        nssf_employee_payable_account_id, nssf_employer_expense_account_id, nssf_employer_payable_account_id,
        shif_payable_account_id, housing_levy_employee_payable_account_id, housing_levy_employer_expense_account_id,
        housing_levy_employer_payable_account_id, created_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    code, name, ...ids, new Date().toISOString(), user.username,
  );
  await audit(user, 'PAYROLL_POSTING_GROUP_CREATE', 'payroll_posting_group', info.lastInsertRowid, {});
  return { id: Number(info.lastInsertRowid) };
}

export async function deletePostingGroup(id: number, user: Actor): Promise<void> {
  if (await one('SELECT 1 FROM employee WHERE posting_group_id = ?', id)) {
    throw new AppError('This posting group has employees assigned and cannot be removed', 'IN_USE');
  }
  await run('DELETE FROM payroll_posting_group WHERE id = ?', id);
  await audit(user, 'PAYROLL_POSTING_GROUP_DELETE', 'payroll_posting_group', id, {});
}

/* -------------------------------------------------------------------------------------- PAYE bands */

export const listPayeBands = (): Promise<PayrollPayeBand[]> => all('SELECT * FROM payroll_paye_band ORDER BY sort_order');

export async function savePayeBand(
  input: { id?: number | null; sortOrder: number; upperBoundCents: number | null; ratePct: number }, user: Actor,
): Promise<{ id: number }> {
  if (!(Number(input.ratePct) >= 0)) throw new AppError('A rate is required', 'VALIDATION');
  if (input.id) {
    await run('UPDATE payroll_paye_band SET sort_order=?, upper_bound_cents=?, rate_pct=? WHERE id=?', input.sortOrder, input.upperBoundCents, input.ratePct, input.id);
    await audit(user, 'PAYROLL_PAYE_BAND_UPDATE', 'payroll_paye_band', input.id, {});
    return { id: input.id };
  }
  const info = await run('INSERT INTO payroll_paye_band (sort_order, upper_bound_cents, rate_pct) VALUES (?,?,?)', input.sortOrder, input.upperBoundCents, input.ratePct);
  await audit(user, 'PAYROLL_PAYE_BAND_CREATE', 'payroll_paye_band', info.lastInsertRowid, {});
  return { id: Number(info.lastInsertRowid) };
}

export async function deletePayeBand(id: number, user: Actor): Promise<void> {
  await run('DELETE FROM payroll_paye_band WHERE id = ?', id);
  await audit(user, 'PAYROLL_PAYE_BAND_DELETE', 'payroll_paye_band', id, {});
}

/* ------------------------------------------------------------------------------------- NSSF tiers */

export const listNssfTiers = (): Promise<PayrollNssfTier[]> => all('SELECT * FROM payroll_nssf_tier ORDER BY tier_no');

export async function saveNssfTier(
  input: { id?: number | null; tierNo: number; lowerLimitCents: number; upperLimitCents: number; employeeRatePct: number; employerRatePct: number }, user: Actor,
): Promise<{ id: number }> {
  if (input.upperLimitCents <= input.lowerLimitCents) throw new AppError('Upper limit must exceed lower limit', 'VALIDATION');
  if (input.id) {
    await run(
      'UPDATE payroll_nssf_tier SET tier_no=?, lower_limit_cents=?, upper_limit_cents=?, employee_rate_pct=?, employer_rate_pct=? WHERE id=?',
      input.tierNo, input.lowerLimitCents, input.upperLimitCents, input.employeeRatePct, input.employerRatePct, input.id,
    );
    await audit(user, 'PAYROLL_NSSF_TIER_UPDATE', 'payroll_nssf_tier', input.id, {});
    return { id: input.id };
  }
  const info = await run(
    'INSERT INTO payroll_nssf_tier (tier_no, lower_limit_cents, upper_limit_cents, employee_rate_pct, employer_rate_pct) VALUES (?,?,?,?,?)',
    input.tierNo, input.lowerLimitCents, input.upperLimitCents, input.employeeRatePct, input.employerRatePct,
  );
  await audit(user, 'PAYROLL_NSSF_TIER_CREATE', 'payroll_nssf_tier', info.lastInsertRowid, {});
  return { id: Number(info.lastInsertRowid) };
}

export async function deleteNssfTier(id: number, user: Actor): Promise<void> {
  await run('DELETE FROM payroll_nssf_tier WHERE id = ?', id);
  await audit(user, 'PAYROLL_NSSF_TIER_DELETE', 'payroll_nssf_tier', id, {});
}

/* ------------------------------------------------------------------------------- transaction codes */

/** The Earnings & Deductions catalogue. Retired codes (the run's old statutory codes) are kept
 *  for history but never offered to a picker. */
export const listTransactionCodes = (): Promise<PayrollTransactionCode[]> => all("SELECT * FROM payroll_transaction_code WHERE status <> 'INACTIVE' ORDER BY name");
export const getTransactionCode = (id: number): Promise<PayrollTransactionCode | undefined> => one('SELECT * FROM payroll_transaction_code WHERE id = ?', id);

export interface TransactionCodeInput {
  id?: number | null; code: string; name: string; type: PayrollTransactionType; taxable?: boolean;
  isFormula?: boolean; formula?: string | null; amountPreference?: PayrollAmountPreference;
  employerFactor?: number; employerFormula?: string | null;
  fixedAmountCents?: number; upperLimitCents?: number | null;
  balanceType?: PayrollBalanceType; specialType?: PayrollSpecialType;
  glAccountId?: number | null; employerGlAccountId?: number | null; forEveryEmployee?: boolean;
}

export async function saveTransactionCode(input: TransactionCodeInput, user: Actor): Promise<{ id: number }> {
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  if (!code) throw new AppError('A code is required', 'VALIDATION');
  if (!name) throw new AppError('A name is required', 'VALIDATION');

  // AL "Is Formula" / Formula: checked here so a run never trips on a malformed expression, and
  // a formula may only refer to the run's own codes or to another Earnings & Deductions code.
  const formula = input.isFormula ? (input.formula?.trim() || null) : null;
  if (input.isFormula) {
    if (!formula) throw new AppError('A formula code needs its formula — e.g. [BPAY]*0.15', 'VALIDATION');
    try { assertFormulaValid(formula); } catch (err) { throw new AppError(err instanceof Error ? err.message : 'Bad formula', 'VALIDATION'); }
    for (const ref of formulaCodes(formula)) {
      if (ref === code) throw new AppError(`The formula cannot refer to its own code [${ref}]`, 'VALIDATION');
      if (ref in PERIOD_CODES) continue;
      if (!(await one('SELECT 1 FROM payroll_transaction_code WHERE code = ?', ref))) {
        throw new AppError(`[${ref}] is not a payroll code — use one of the run's codes (${Object.keys(PERIOD_CODES).map((k) => `[${k}]`).join(' ')}) or an existing transaction code`, 'VALIDATION');
      }
    }
  }
  // Employer contribution (AL "Include Employer Deduction"): only a deduction carries one, it
  // needs an employer expense account to cost to, and a formula is checked like the main one.
  const employerFactor = input.type === 'DEDUCTION' ? Math.max(0, Number(input.employerFactor) || 0) : 0;
  const employerFormula = input.type === 'DEDUCTION' ? (input.employerFormula?.trim() || null) : null;
  if (employerFormula) {
    try { assertFormulaValid(employerFormula); } catch (err) { throw new AppError(`Employer formula: ${err instanceof Error ? err.message : 'bad formula'}`, 'VALIDATION'); }
    for (const ref of formulaCodes(employerFormula)) {
      if (ref === code || ref in PERIOD_CODES) continue;
      if (!(await one('SELECT 1 FROM payroll_transaction_code WHERE code = ?', ref))) throw new AppError(`Employer formula: [${ref}] is not a payroll code`, 'VALIDATION');
    }
  }
  if ((employerFactor > 0 || employerFormula) && !input.employerGlAccountId) {
    throw new AppError('An employer contribution needs the employer expense account', 'VALIDATION');
  }
  const fields = {
    type: input.type, taxable: input.taxable !== false, is_formula: !!input.isFormula,
    employer_factor: employerFactor, employer_formula: employerFormula,
    formula,
    amount_preference: (input.isFormula ? input.amountPreference : null) || 'FORMULA',
    fixed_amount_cents: Math.round(Number(input.fixedAmountCents) || 0),
    upper_limit_cents: input.upperLimitCents != null ? Math.round(input.upperLimitCents) : null,
    balance_type: input.balanceType || 'NONE', special_type: input.specialType || 'NONE',
    gl_account_id: input.glAccountId || null, employer_gl_account_id: input.employerGlAccountId || null,
    for_every_employee: !!input.forEveryEmployee,
  };

  if (input.id) {
    const dup = await one('SELECT 1 FROM payroll_transaction_code WHERE code = ? AND id != ?', code, input.id);
    if (dup) throw new AppError('That code already exists', 'DUPLICATE');
    await run(
      `UPDATE payroll_transaction_code SET code=?, name=?, type=?, taxable=?, is_formula=?, formula=?, amount_preference=?,
         employer_factor=?, employer_formula=?,
         fixed_amount_cents=?, upper_limit_cents=?, balance_type=?, special_type=?, gl_account_id=?,
         employer_gl_account_id=?, for_every_employee=? WHERE id=?`,
      code, name, fields.type, fields.taxable, fields.is_formula, fields.formula, fields.amount_preference,
      fields.employer_factor, fields.employer_formula, fields.fixed_amount_cents,
      fields.upper_limit_cents, fields.balance_type, fields.special_type, fields.gl_account_id,
      fields.employer_gl_account_id, fields.for_every_employee, input.id,
    );
    await audit(user, 'PAYROLL_TRANSACTION_CODE_UPDATE', 'payroll_transaction_code', input.id, {});
    return { id: input.id };
  }
  if (await one('SELECT 1 FROM payroll_transaction_code WHERE code = ?', code)) throw new AppError('That code already exists', 'DUPLICATE');
  const info = await run(
    `INSERT INTO payroll_transaction_code
       (code, name, type, taxable, is_formula, formula, amount_preference, employer_factor, employer_formula,
        fixed_amount_cents, upper_limit_cents, balance_type,
        special_type, gl_account_id, employer_gl_account_id, for_every_employee, created_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    code, name, fields.type, fields.taxable, fields.is_formula, fields.formula, fields.amount_preference,
    fields.employer_factor, fields.employer_formula, fields.fixed_amount_cents,
    fields.upper_limit_cents, fields.balance_type, fields.special_type, fields.gl_account_id,
    fields.employer_gl_account_id, fields.for_every_employee, new Date().toISOString(), user.username,
  );
  await audit(user, 'PAYROLL_TRANSACTION_CODE_CREATE', 'payroll_transaction_code', info.lastInsertRowid, {});
  return { id: Number(info.lastInsertRowid) };
}

export async function deleteTransactionCode(id: number, user: Actor): Promise<void> {
  if (await one('SELECT 1 FROM employee_payroll_transaction WHERE transaction_code_id = ?', id)) {
    throw new AppError('This code has been used on a payroll transaction and cannot be removed', 'IN_USE');
  }
  await run('DELETE FROM payroll_transaction_code WHERE id = ?', id);
  await audit(user, 'PAYROLL_TRANSACTION_CODE_DELETE', 'payroll_transaction_code', id, {});
}
