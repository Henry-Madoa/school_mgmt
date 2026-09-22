/*
 * Payroll — the calculation engine + period lifecycle. Unlike the AL source (which only tags
 * lines with a G/L account for an external export), this posts real double-entry journals via
 * the existing postJournal() engine on period close (user-confirmed design choice) — every other
 * financial module here already works that way.
 *
 * Corrections versus the AL source: NSSF is a correct Kenyan Tier I/Tier II tiered accumulation
 * (AL only reads its first tier row); PAYE is a clean progressive-band function; proration uses
 * the real `monthly_working_days` setting (AL hardcodes 22 despite having that exact field).
 *
 * Known simplifications (documented, not silent): a transaction code's `is_formula` amount is not
 * evaluated — the amount stored on the employee's own recurring transaction line is used as-is;
 * there is no pension-contribution cap or "1/3 net pay" soft-flag; NSSF is always based on gross
 * pay (SHIF/Housing Levy base is configurable via Payroll Setup).
 */
import { one, all, run, tx, audit } from './db.ts';
import { AppError } from './errors.ts';
import { postJournal } from './accounting.ts';
import { getEmployee, getCurrentContract } from './employees.ts';
import { getPayrollSetup, listPayeBands, listNssfTiers } from './payrollSetup.ts';
import { findMatchingWorkflow, findPendingRoutedTask, pickConditionFields, startWorkflow } from './workflow.ts';
import { settleImprestsFromPayroll } from './imprest.ts';
import { evaluateFormula } from './payrollFormula.ts';
import { PERIOD_CODES, PERIOD_GROUPS, type PeriodCode, type PeriodGroup } from './payrollCodes.ts';

export { PERIOD_CODES, PERIOD_GROUPS, type PeriodCode, type PeriodGroup };
import type {
  Actor, Cents, IsoDate, PayrollPeriod, PayrollPeriodStatus, PayrollPostingGroup, PayrollTransactionCode,
  PayrollTransactionType, EmployeePayrollTransactionView, PayrollPeriodTransactionView, EmployeeExitDueType, PayrollP9Line,
} from './types.ts';

/* ============================================================================ system tx codes */

/**
 * One-off Earnings & Deductions codes other modules book against (leave allowance, the exit's
 * final dues) — created on demand in the catalogue. Basic pay, gross pay, the tax workings, the
 * statutories and net pay are NOT codes here: the run writes them straight into Payroll Period
 * Transactions under the fixed codes in PERIOD_CODES, exactly as AL fnUpdatePeriodTrans does.
 */
const SYSTEM_CODES: { code: string; name: string; type: PayrollTransactionType }[] = [
  { code: 'LVALLOW', name: 'Leave Allowance', type: 'INCOME' },
  { code: 'LVENC', name: 'Leave Encashment (Exit)', type: 'INCOME' },
  { code: 'GRATUITY', name: 'Gratuity (Exit)', type: 'INCOME' },
  { code: 'NOTICEINC', name: 'Notice Income (Exit)', type: 'INCOME' },
  { code: 'NOTICEPEN', name: 'Notice Penalty (Exit)', type: 'DEDUCTION' },
  { code: 'UNCLEARED', name: 'Uncleared Items (Exit)', type: 'DEDUCTION' },
];

async function ensureSystemTransactionCodes(): Promise<Record<string, number>> {
  const ids: Record<string, number> = {};
  for (const c of SYSTEM_CODES) {
    const row = await one<{ id: number }>('SELECT id FROM payroll_transaction_code WHERE code = ?', c.code);
    if (row) { ids[c.code] = row.id; continue; }
    const info = await run(
      'INSERT INTO payroll_transaction_code (code, name, type, taxable, created_at, created_by) VALUES (?,?,?,?,?,?)',
      c.code, c.name, c.type, false, new Date().toISOString(), 'SYSTEM',
    );
    ids[c.code] = Number(info.lastInsertRowid);
  }
  return ids;
}

/** One Payroll Period Transaction as the run assembles it, before it is written. */
interface PeriodTxDraft {
  code: string; codeId: number | null; name: string; type: 'INCOME' | 'DEDUCTION' | 'COMPANY_DEDUCTION' | 'MEMO' | 'NET';
  group: PeriodGroup; subOrder: number; amountCents: number;
  balanceCents?: number | null; originalCents?: number | null;
  glAccountId?: number | null; postAs?: 'DEBIT' | 'CREDIT' | null; postToJournal: boolean;
  journalAccountType?: 'GL' | 'EMPLOYEE';
  companyDeduction?: boolean; imprestNo?: string | null;
}

/**
 * The run's own group/order for an Earnings & Deductions code — AL's "Group Text" per
 * transaction type: Income → ALLOWANCE (3), Deduction → DEDUCTIONS (8), Company Deduction →
 * EMPLOYER (10).
 */
const groupForType = (t: PayrollTransactionType): PeriodGroup => (t === 'INCOME' ? 'ALLOWANCE' : t === 'DEDUCTION' ? 'DEDUCTIONS' : 'EMPLOYER');

/* ================================================================================ calculation */

function daysBetweenInclusive(fromIso: string, toIso: string): number {
  const a = new Date(fromIso + 'T00:00:00Z').getTime();
  const b = new Date(toIso + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86_400_000) + 1;
}

/** Progressive PAYE — walks the bands in order, taxing only the slice of taxable pay that falls
 *  in each band (a band's `upper_bound_cents` is that band's own width; null = unbounded/last). */
export async function calculatePaye(taxablePayCents: number): Promise<number> {
  const bands = await listPayeBands();
  let remaining = Math.max(0, taxablePayCents);
  let tax = 0;
  for (const band of bands) {
    if (remaining <= 0) break;
    const width = band.upper_bound_cents ?? Infinity;
    const inBand = Math.min(remaining, width);
    tax += inBand * (band.rate_pct / 100);
    remaining -= inBand;
  }
  return Math.round(tax);
}

/** Correct Kenyan NSSF Tier I/II tiered accumulation — sums the contribution owed for the slice
 *  of `baseCents` that falls in each configured tier (the AL source only reads its first tier
 *  row, which is a bug this port does not reproduce). */
export async function calculateNssf(baseCents: number): Promise<{ employee: number; employer: number }> {
  const tiers = await listNssfTiers();
  let employee = 0; let employer = 0;
  for (const tier of tiers) {
    const inTier = Math.max(0, Math.min(baseCents, tier.upper_limit_cents) - tier.lower_limit_cents);
    if (inTier <= 0) continue;
    employee += inTier * (tier.employee_rate_pct / 100);
    employer += inTier * (tier.employer_rate_pct / 100);
  }
  return { employee: Math.round(employee), employer: Math.round(employer) };
}



/**
 * AL Cod52203433 "Payroll Processing".fnProcessPayroll for one employee in one open period —
 * re-runnable (it purges the employee's Payroll Period Transactions and P9 line for the period
 * first). It writes one Payroll Period Transaction per line, grouped and ordered as the payslip
 * reads, and one payroll_p9_line row for the KRA card. A formula code's amount is computed from
 * the lines already written before it (AL fnPureFormula / fnGetTransAmount), so an allowance
 * formula may use [BPAY] and the allowances written before it, and a deduction formula may also
 * use [GPAY]. The statutories and tax workings come after the deductions (they need the pension,
 * insurance and mortgage lines), so they are not available to a formula.
 */
export async function runPayrollForEmployee(periodId: number, employeeId: number, user: Actor): Promise<void> {
  return tx(async () => {
    const period = await one<PayrollPeriod>('SELECT * FROM payroll_period WHERE id = ?', periodId);
    if (!period) throw new AppError('Payroll period not found', 'NOT_FOUND');
    if (period.status !== 'OPEN') throw new AppError('Payroll can only be run for an Open period', 'VALIDATION');

    const emp = await getEmployee(employeeId);
    if (!emp) throw new AppError('Employee not found', 'NOT_FOUND');
    // Payroll Salary Card "Suspend Pay": the employee is left out of the run until it is lifted.
    if (emp.suspend_pay) {
      throw new AppError(`${emp.employee_no}'s pay is suspended${emp.suspension_date ? ` since ${emp.suspension_date}` : ''}${emp.suspension_reasons ? ` — ${emp.suspension_reasons}` : ''}`, 'VALIDATION');
    }
    if (!emp.posting_group_id) throw new AppError(`${emp.employee_no} has no payroll posting group set`, 'VALIDATION');
    const postingGroup = await one<PayrollPostingGroup>('SELECT * FROM payroll_posting_group WHERE id = ?', emp.posting_group_id);
    if (!postingGroup) throw new AppError('Posting group not found', 'NOT_FOUND');

    const setup = await getPayrollSetup();
    const contract = await getCurrentContract(employeeId);
    const basicPayFull = Number(contract?.salary_cents || 0);
    await run('DELETE FROM payroll_period_transaction WHERE payroll_period_id = ? AND employee_id = ?', periodId, employeeId);
    await run('DELETE FROM payroll_p9_line WHERE payroll_period_id = ? AND employee_id = ?', periodId, employeeId);

    // Proration for a mid-period joiner — uses the real Monthly Working Days setting.
    let basicPay = basicPayFull;
    if (contract?.start_date && contract.start_date > period.start_date) {
      const workedDays = Math.max(0, daysBetweenInclusive(contract.start_date, period.end_date));
      const ratio = Math.min(1, workedDays / setup.monthly_working_days);
      basicPay = Math.round(basicPayFull * ratio);
    }

    // The period transactions, in the order they are computed. `amountOf` is what a formula
    // sees — AL fnGetTransAmount over the Payroll Period Transaction table for this employee.
    const lines: PeriodTxDraft[] = [];
    const amountOf = (code: string): number | undefined => {
      const hit = lines.filter((l) => l.code === code);
      return hit.length ? hit.reduce((s, l) => s + l.amountCents, 0) : undefined;
    };
    const ALWAYS = new Set(['GPAY', 'TXBP', 'TXCHRG']);
    const put = (d: PeriodTxDraft) => { if (d.amountCents !== 0 || ALWAYS.has(d.code)) lines.push({ ...d, amountCents: Math.round(d.amountCents) }); };
    const memo = (code: PeriodCode, subOrder: number, amountCents: number) =>
      put({ code, codeId: null, name: PERIOD_CODES[code], type: 'MEMO', group: 'TAX CALCULATIONS', subOrder, amountCents, postToJournal: false });

    /** AL: a formula code's amount comes from the formula; "Amount Preference" then picks
     *  between it and the amount on the employee's line. An upper limit still caps the result. */
    const resolveAmount = (code: PayrollTransactionCode, row: EmployeePayrollTransactionView): number => {
      let amount = Number(row.amount_cents);
      if (code.is_formula && code.formula) {
        let computed: number;
        try { computed = evaluateFormula(code.formula, amountOf); }
        catch (err) { throw new AppError(`${code.code}: ${err instanceof Error ? err.message : 'bad formula'}`, 'VALIDATION'); }
        const pref = code.amount_preference ?? 'FORMULA';
        amount = pref === 'HIGHER' ? Math.max(amount, computed) : pref === 'LOWER' ? Math.min(amount, computed) : computed;
      }
      if (code.upper_limit_cents != null) amount = Math.min(amount, Number(code.upper_limit_cents));
      return Math.round(amount);
    };
    const codeCache = new Map<number, PayrollTransactionCode>();
    const codeFor = async (id: number): Promise<PayrollTransactionCode | undefined> => {
      if (!codeCache.has(id)) {
        const c = await one<PayrollTransactionCode>('SELECT * FROM payroll_transaction_code WHERE id = ?', id);
        if (c) codeCache.set(id, c);
      }
      return codeCache.get(id);
    };
    const linesOfType = (type: PayrollTransactionType) => all<EmployeePayrollTransactionView>(
      `SELECT t.*, c.name AS transaction_code_name, c.type AS transaction_type
       FROM employee_payroll_transaction t JOIN payroll_transaction_code c ON c.id = t.transaction_code_id
       WHERE t.employee_id = ? AND t.payroll_period_id = ? AND t.stopped = false AND c.type = ?
         AND (t.start_date IS NULL OR t.start_date <= ?) AND (t.end_date IS NULL OR t.end_date >= ?)
       ORDER BY c.is_formula, c.code`,
      employeeId, periodId, type, period.end_date, period.start_date,
    );

    // 1. BASIC SALARY — from the contract, never an Earnings & Deductions line.
    put({ code: 'BPAY', codeId: null, name: PERIOD_CODES.BPAY, type: 'INCOME', group: 'BASIC SALARY', subOrder: 1, amountCents: basicPay,
      glAccountId: postingGroup.salary_expense_account_id, postAs: 'DEBIT', postToJournal: true });

    // 3. ALLOWANCE — the employee's own earnings (fixed lines first, then formula lines, so a
    // formula can build on them). Non-cash benefits (P9 B/C) are taxed but neither paid nor
    // journalled — they go to the tax workings instead.
    let taxableAllowances = 0; let nonTaxableAllowances = 0; let nonCashBenefits = 0; let valueOfQuarters = 0;
    for (const row of await linesOfType('INCOME')) {
      const code = await codeFor(row.transaction_code_id);
      if (!code) continue;
      const amount = resolveAmount(code, row);
      if (code.special_type === 'NON_CASH_BENEFIT') { nonCashBenefits += amount; continue; }
      if (code.special_type === 'VALUE_OF_QUARTERS') { valueOfQuarters += amount; continue; }
      if (code.taxable) taxableAllowances += amount; else nonTaxableAllowances += amount;
      put({ code: code.code, codeId: code.id, name: code.name, type: 'INCOME', group: 'ALLOWANCE', subOrder: 0, amountCents: amount,
        glAccountId: code.gl_account_id ?? postingGroup.salary_expense_account_id, postAs: 'DEBIT', postToJournal: true });
    }
    memo('BENEFIT', 0, nonCashBenefits);
    memo('QTRS', 0, valueOfQuarters);

    // 4. GROSS PAY — cash gross (what the journal and net pay start from); the P9's column D
    // also carries the non-cash columns B and C.
    const grossPay = basicPay + taxableAllowances + nonTaxableAllowances;
    const taxableGross = basicPay + taxableAllowances + nonCashBenefits + valueOfQuarters;
    const p9GrossPay = grossPay + nonCashBenefits + valueOfQuarters;
    put({ code: 'GPAY', codeId: null, name: PERIOD_CODES.GPAY, type: 'MEMO', group: 'GROSS PAY', subOrder: 0, amountCents: grossPay, postToJournal: false });

    // 8. DEDUCTIONS — the employee's own; the special types feed the tax workings below. A
    // deduction formula can read [BPAY], [GPAY] and every allowance.
    let pensionDeduction = 0; let insurancePremium = 0; let mortgageInterest = 0; let prmfContribution = 0; let otherDeductions = 0;
    for (const row of await linesOfType('DEDUCTION')) {
      const code = await codeFor(row.transaction_code_id);
      if (!code) continue;
      const amount = resolveAmount(code, row);
      if (code.special_type === 'PENSION') pensionDeduction += amount;
      else if (code.special_type === 'INSURANCE') insurancePremium += amount;
      else if (code.special_type === 'MORTGAGE') mortgageInterest += amount;
      else if (code.special_type === 'PRMF') prmfContribution += amount;
      else otherDeductions += amount;

      if (!code.gl_account_id) throw new AppError(`Transaction code ${code.code} has no G/L account configured`, 'VALIDATION');
      put({ code: code.code, codeId: code.id, name: code.name, type: 'DEDUCTION', group: 'DEDUCTIONS', subOrder: 0, amountCents: amount,
        balanceCents: row.balance_cents != null ? Math.max(0, Number(row.balance_cents) - amount) : null, originalCents: row.original_amount_cents,
        glAccountId: code.gl_account_id, postAs: 'CREDIT', postToJournal: true,
        journalAccountType: ['IMPRECOV', 'IMPCLAIM'].includes(code.code) ? 'EMPLOYEE' : 'GL',
        imprestNo: ['IMPRECOV', 'IMPCLAIM'].includes(code.code) ? row.notes?.match(/(?:Imprest|Staff Claim) (\S+)/)?.[1] ?? null : null });

      // AL "Include Employer Deduction": the employer's share of a pension (or any deduction) —
      // factor × the employee's amount, or the code's own employer formula, which can read the
      // employee's line just written (e.g. [PENSION]*2). Costed to the employer expense account,
      // credited to the deduction's payable; it never touches net pay.
      if (code.employer_factor > 0 || code.employer_formula) {
        if (!code.employer_gl_account_id) throw new AppError(`${code.code} carries an employer contribution but has no employer expense account`, 'VALIDATION');
        let employerAmount = Math.round(amount * (code.employer_factor || 0));
        if (code.employer_formula) {
          try { employerAmount = evaluateFormula(code.employer_formula, amountOf); }
          catch (err) { throw new AppError(`${code.code} employer formula: ${err instanceof Error ? err.message : 'bad formula'}`, 'VALIDATION'); }
        }
        if (employerAmount > 0) {
          const er = { code: `${code.code}-ER`, codeId: code.id, name: `${code.name} (Employer)`, type: 'COMPANY_DEDUCTION' as const, group: 'EMPLOYER' as const, subOrder: 3, amountCents: employerAmount, postToJournal: true, companyDeduction: true };
          put({ ...er, glAccountId: code.employer_gl_account_id, postAs: 'DEBIT' });
          put({ ...er, glAccountId: code.gl_account_id, postAs: 'CREDIT' });
        }
      }

      if (code.balance_type === 'REDUCING' && row.balance_cents != null) {
        const newBalance = Math.max(0, Number(row.balance_cents) - amount);
        await run('UPDATE employee_payroll_transaction SET balance_cents = ?, executed_periods = executed_periods + 1 WHERE id = ?', newBalance, row.id);
        if (newBalance === 0) await run('UPDATE employee_payroll_transaction SET stopped = true WHERE id = ?', row.id);
      } else if (row.no_of_periods != null) {
        const executed = row.executed_periods + 1;
        await run('UPDATE employee_payroll_transaction SET executed_periods = ? WHERE id = ?', executed, row.id);
        if (executed >= row.no_of_periods) await run('UPDATE employee_payroll_transaction SET stopped = true WHERE id = ?', row.id);
      }
    }

    // 10. EMPLOYER — company deductions: an employer-side cost, never taken from the employee.
    for (const row of await linesOfType('COMPANY_DEDUCTION')) {
      const code = await codeFor(row.transaction_code_id);
      if (!code) continue;
      const amount = resolveAmount(code, row);
      const expenseAccount = code.employer_gl_account_id ?? code.gl_account_id;
      if (!expenseAccount || !code.gl_account_id) throw new AppError(`Company deduction ${code.code} needs both a G/L expense and payable account`, 'VALIDATION');
      put({ code: code.code, codeId: code.id, name: code.name, type: 'COMPANY_DEDUCTION', group: 'EMPLOYER', subOrder: 0, amountCents: amount,
        glAccountId: expenseAccount, postAs: 'DEBIT', postToJournal: true, companyDeduction: true });
      put({ code: code.code, codeId: code.id, name: code.name, type: 'COMPANY_DEDUCTION', group: 'EMPLOYER', subOrder: 0, amountCents: amount,
        glAccountId: code.gl_account_id, postAs: 'CREDIT', postToJournal: true, companyDeduction: true });
    }

    // 7. STATUTORIES — NSSF (always on gross), SHIF and the Housing Levy (base per Payroll
    // Setup). Salary Card "Pays NSSF / SHIF / PAYE": an exempt employee (an expatriate on a
    // home-country scheme, a pensioner …) simply has no line for that statutory.
    const nssf = emp.pays_nssf ? await calculateNssf(grossPay) : { employee: 0, employer: 0 };
    put({ code: 'NSSF', codeId: null, name: PERIOD_CODES.NSSF, type: 'DEDUCTION', group: 'STATUTORIES', subOrder: 1, amountCents: nssf.employee,
      glAccountId: postingGroup.nssf_employee_payable_account_id, postAs: 'CREDIT', postToJournal: true });
    const nssfEmployer = Math.round(nssf.employer * setup.nssf_employer_factor);
    put({ code: 'NSSF-ER', codeId: null, name: PERIOD_CODES['NSSF-ER'], type: 'COMPANY_DEDUCTION', group: 'EMPLOYER', subOrder: 1, amountCents: nssfEmployer,
      glAccountId: postingGroup.nssf_employer_expense_account_id, postAs: 'DEBIT', postToJournal: true, companyDeduction: true });
    put({ code: 'NSSF-ER', codeId: null, name: PERIOD_CODES['NSSF-ER'], type: 'COMPANY_DEDUCTION', group: 'EMPLOYER', subOrder: 1, amountCents: nssfEmployer,
      glAccountId: postingGroup.nssf_employer_payable_account_id, postAs: 'CREDIT', postToJournal: true, companyDeduction: true });

    const shifBase = setup.shif_based_on === 'BASIC' ? basicPay : setup.shif_based_on === 'TAXABLE' ? taxableGross : grossPay;
    const shif = emp.pays_shif ? Math.round(shifBase * (setup.shif_pct / 100)) : 0;
    put({ code: 'SHIF', codeId: null, name: PERIOD_CODES.SHIF, type: 'DEDUCTION', group: 'STATUTORIES', subOrder: 2, amountCents: shif,
      glAccountId: postingGroup.shif_payable_account_id, postAs: 'CREDIT', postToJournal: true });

    let housingLevyEmployee = 0;
    if (setup.housing_levy_enabled) {
      const hlBase = setup.housing_levy_based_on === 'BASIC' ? basicPay : setup.housing_levy_based_on === 'TAXABLE' ? taxableGross : grossPay;
      housingLevyEmployee = Math.round(hlBase * (setup.housing_levy_pct / 100));
      put({ code: 'AHL', codeId: null, name: PERIOD_CODES.AHL, type: 'DEDUCTION', group: 'STATUTORIES', subOrder: 3, amountCents: housingLevyEmployee,
        glAccountId: postingGroup.housing_levy_employee_payable_account_id, postAs: 'CREDIT', postToJournal: true });
      put({ code: 'AHL-ER', codeId: null, name: PERIOD_CODES['AHL-ER'], type: 'COMPANY_DEDUCTION', group: 'EMPLOYER', subOrder: 2, amountCents: housingLevyEmployee,
        glAccountId: postingGroup.housing_levy_employer_expense_account_id, postAs: 'DEBIT', postToJournal: true, companyDeduction: true });
      put({ code: 'AHL-ER', codeId: null, name: PERIOD_CODES['AHL-ER'], type: 'COMPANY_DEDUCTION', group: 'EMPLOYER', subOrder: 2, amountCents: housingLevyEmployee,
        glAccountId: postingGroup.housing_levy_employer_payable_account_id, postAs: 'CREDIT', postToJournal: true, companyDeduction: true });
    }

    // 6. TAX CALCULATIONS — the KRA P9 card's arithmetic (revised form, Tax Laws (Amendment)
    // Act 2024), each working written as a memo line:
    //   E  defined contribution = lowest of E1 30% of basic, E2 actual pension + NSSF, E3 the fixed cap
    //   F  owner-occupier interest, capped;  G = E + F
    //   H  Affordable Housing Levy, I SHIF, J post-retirement medical fund (capped) — allowable
    //      deductions where Payroll Setup says so
    //   K  chargeable pay = D − G − H − I − J
    const definedContribution = Math.min(Math.round(basicPay * 0.30), pensionDeduction + nssf.employee, setup.pension_deduction_cap_cents);
    const ownerOccupierInterest = Math.min(mortgageInterest, setup.mortgage_relief_cents);
    const ahlDeductible = setup.housing_levy_deductible ? housingLevyEmployee : 0;
    const shifDeductible = setup.shif_deductible ? shif : 0;
    const prmfDeductible = Math.min(prmfContribution, setup.prmf_cap_cents);
    const taxablePay = Math.max(0, taxableGross - definedContribution - ownerOccupierInterest - ahlDeductible - shifDeductible - prmfDeductible);
    const exempt = !emp.pays_paye || (grossPay - nssf.employee) <= setup.minimum_relief_threshold_cents;
    const taxCharged = exempt ? 0 : await calculatePaye(taxablePay);
    // Reliefs (P9 columns M and N): the personal relief unless the Salary Card's "Stop Relief"
    // withholds it (a second employment), and insurance relief only with the "Insurance
    // Certificate?" on file. Mortgage interest is a deduction above (col. F), not a relief.
    const insuranceRelief = emp.insurance_certificate ? Math.round(insurancePremium * (setup.insurance_relief_pct / 100)) : 0;
    const personalRelief = emp.stop_relief ? 0 : setup.personal_relief_cents;
    const totalRelief = exempt ? 0 : Math.min(personalRelief + insuranceRelief, setup.max_relief_cents);
    const paye = exempt ? 0 : Math.max(0, taxCharged - totalRelief);
    memo('DEFCON', 1, definedContribution);
    memo('OOI', 2, ownerOccupierInterest);
    memo('AHL-RL', 3, ahlDeductible);
    memo('SHIF-RL', 4, shifDeductible);
    memo('PRMF-RL', 5, prmfDeductible);
    memo('TXBP', 6, taxablePay);
    memo('TXCHRG', 7, taxCharged);
    memo('PSNR', 8, exempt ? 0 : personalRelief);
    memo('INSR', 9, exempt ? 0 : insuranceRelief);
    put({ code: 'PAYE', codeId: null, name: PERIOD_CODES.PAYE, type: 'DEDUCTION', group: 'STATUTORIES', subOrder: 4, amountCents: paye,
      glAccountId: postingGroup.paye_payable_account_id, postAs: 'CREDIT', postToJournal: true });

    // 9. NET PAY
    const netPay = grossPay - nssf.employee - shif - housingLevyEmployee - paye - otherDeductions - pensionDeduction - insurancePremium - mortgageInterest - prmfContribution;
    if (netPay < 0) throw new AppError(`${emp.employee_no}'s net pay would be negative — review their deductions`, 'VALIDATION');
    put({ code: 'NPAY', codeId: null, name: PERIOD_CODES.NPAY, type: 'NET', group: 'NET PAY', subOrder: 0, amountCents: netPay,
      glAccountId: postingGroup.net_pay_payable_account_id, postAs: 'CREDIT', postToJournal: true,
      journalAccountType: 'GL' });

    // Write the Payroll Period Transactions — with the employee's payroll identity of the
    // moment (AL copies posting group, payment mode, grade/notch, dimensions and bank details
    // onto every line) so the period's reports read true after the employee changes.
    const staffName = `${emp.first_name} ${emp.last_name}`;
    let payslipOrder = 0;
    for (const l of lines) {
      payslipOrder += 1;
      await run(
        `INSERT INTO payroll_period_transaction
           (payroll_period_id, employee_id, transaction_code, transaction_code_id, transaction_name, transaction_type,
            group_text, group_order, sub_group_order, payslip_order, amount_cents, balance_cents, original_amount_cents,
            gl_account_id, post_as, post_to_journal, journal_account_type, company_deduction, imprest_no,
            posting_group_id, payment_mode, salary_scale_id, global_dimension_1_id, global_dimension_2_id,
            staff_name, bank_code, bank_branch, bank_account_no, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        periodId, employeeId, l.code, l.codeId, l.name, l.type,
        l.group, PERIOD_GROUPS[l.group], l.subOrder, payslipOrder, l.amountCents, l.balanceCents ?? null, l.originalCents ?? null,
        l.glAccountId ?? null, l.postAs ?? null, l.postToJournal, l.journalAccountType ?? 'GL', !!l.companyDeduction, l.imprestNo ?? null,
        emp.posting_group_id, emp.payment_mode, emp.salary_scale_id, emp.global_dimension_1_id, emp.global_dimension_2_id,
        staffName, emp.bank_code, emp.bank_branch, emp.bank_account_no, new Date().toISOString(),
      );
    }
    await run(
      `INSERT INTO payroll_p9_line
         (employee_id, payroll_period_id, basic_pay_cents, gross_pay_cents, taxable_pay_cents, tax_charged_cents,
          insurance_relief_cents, personal_relief_cents, paye_cents, nssf_cents, shif_cents, housing_levy_cents,
          deductions_cents, net_pay_cents, benefits_cents, quarters_cents, pension_cents, defined_contribution_cents,
          owner_occupier_interest_cents, prmf_cents, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      employeeId, periodId, basicPay, p9GrossPay, taxablePay, taxCharged, insuranceRelief,
      exempt ? 0 : personalRelief, paye, nssf.employee, shif, housingLevyEmployee,
      otherDeductions + pensionDeduction + insurancePremium + mortgageInterest + prmfContribution, netPay,
      nonCashBenefits, valueOfQuarters, pensionDeduction, definedContribution, ownerOccupierInterest, prmfDeductible,
      new Date().toISOString(),
    );
    await audit(user, 'PAYROLL_RUN_EMPLOYEE', 'payroll_period', periodId, { employeeId, netPay });
  });
}

/** One row per processed period for an employee — the payroll history on their Payroll card. */
export interface EmployeePayrollHistoryRow {
  period_id: number; period_name: string; end_date: IsoDate; period_status: string;
  basic_pay_cents: Cents; gross_pay_cents: Cents; taxable_pay_cents: Cents; paye_cents: Cents;
  nssf_cents: Cents; shif_cents: Cents; housing_levy_cents: Cents; deductions_cents: Cents; net_pay_cents: Cents;
}
export const listEmployeePayrollHistory = (employeeId: number, limit = 12): Promise<EmployeePayrollHistoryRow[]> =>
  all<EmployeePayrollHistoryRow>(
    `SELECT p.id AS period_id, p.period_name, p.end_date, p.status AS period_status,
            l.basic_pay_cents, l.gross_pay_cents, l.taxable_pay_cents, l.paye_cents, l.nssf_cents, l.shif_cents,
            l.housing_levy_cents, l.deductions_cents, l.net_pay_cents
     FROM payroll_p9_line l JOIN payroll_period p ON p.id = l.payroll_period_id
     WHERE l.employee_id = ? ORDER BY p.end_date DESC LIMIT ?`, employeeId, limit,
  );

/** AL Payroll Salary Card FlowFields — Cumm BasicPay / GrossPay / NetPay off the P9 lines,
 *  Cumm Allowances / Deductions off the posted period lines. */
export async function getPayrollCumulatives(employeeId: number): Promise<{ basicPay: Cents; grossPay: Cents; netPay: Cents; allowances: Cents; deductions: Cents }> {
  const [p9, lines] = await Promise.all([
    one<{ basic: Cents; gross: Cents; net: Cents }>(
      'SELECT COALESCE(SUM(basic_pay_cents),0) AS basic, COALESCE(SUM(gross_pay_cents),0) AS gross, COALESCE(SUM(net_pay_cents),0) AS net FROM payroll_p9_line WHERE employee_id = ?', employeeId,
    ),
    one<{ allowances: Cents; deductions: Cents }>(
      "SELECT COALESCE(SUM(CASE WHEN group_text = 'ALLOWANCE' THEN amount_cents ELSE 0 END),0) AS allowances, COALESCE(SUM(CASE WHEN group_text IN ('DEDUCTIONS','STATUTORIES') THEN amount_cents ELSE 0 END),0) AS deductions FROM payroll_period_transaction WHERE employee_id = ?", employeeId,
    ),
  ]);
  return { basicPay: Number(p9?.basic ?? 0), grossPay: Number(p9?.gross ?? 0), netPay: Number(p9?.net ?? 0), allowances: Number(lines?.allowances ?? 0), deductions: Number(lines?.deductions ?? 0) };
}

export async function runPayrollForPeriod(periodId: number, user: Actor): Promise<{ processed: number; failed: { employeeId: number; error: string }[] }> {
  const employees = await all<{ id: number }>("SELECT id FROM employee WHERE status IN ('ACTIVE','ON_LEAVE','PENDING_FINAL_PAYMENT') AND posting_group_id IS NOT NULL AND suspend_pay = false");
  let processed = 0;
  const failed: { employeeId: number; error: string }[] = [];
  for (const emp of employees) {
    try {
      await runPayrollForEmployee(periodId, emp.id, user);
      processed += 1;
    } catch (err) {
      failed.push({ employeeId: emp.id, error: err instanceof AppError ? err.message : 'Unexpected error' });
    }
  }
  return { processed, failed };
}

/* ============================================================================ period lifecycle */

export const listPayrollPeriods = (): Promise<PayrollPeriod[]> => all('SELECT * FROM payroll_period ORDER BY start_date DESC');
export const getPayrollPeriod = (id: number): Promise<PayrollPeriod | undefined> => one('SELECT * FROM payroll_period WHERE id = ?', id);
export const getOpenPayrollPeriod = (): Promise<PayrollPeriod | undefined> => one("SELECT * FROM payroll_period WHERE status = 'OPEN'");

export async function createPayrollPeriod(input: { periodName: string; startDate: string; endDate: string }, user: Actor): Promise<{ id: number }> {
  if (await one("SELECT 1 FROM payroll_period WHERE status IN ('OPEN','PENDING_APPROVAL')")) {
    throw new AppError('There is already an Open or Pending Approval payroll period', 'VALIDATION');
  }
  const info = await run(
    'INSERT INTO payroll_period (period_name, start_date, end_date, created_at, created_by) VALUES (?,?,?,?,?)',
    input.periodName.trim(), input.startDate, input.endDate, new Date().toISOString(), user.username,
  );
  await audit(user, 'PAYROLL_PERIOD_CREATE', 'payroll_period', info.lastInsertRowid, {});
  return { id: Number(info.lastInsertRowid) };
}

/**
 * Everything the period's journal needs is in place: every line that posts names a G/L account,
 * that account exists, is a posting account and is active, and debits equal credits. Checked
 * when the period is sent for approval — so a missing account on a posting group or a
 * transaction code is raised to whoever ran payroll, not discovered at Close — and again at
 * Close, before anything moves.
 */
export async function assertPayrollJournalPostable(periodId: number): Promise<void> {
  const problems: string[] = [];
  const missing = await all<{ employee_no: string; transaction_code: string; transaction_name: string }>(
    `SELECT DISTINCT e.employee_no, t.transaction_code, t.transaction_name
     FROM payroll_period_transaction t JOIN employee e ON e.id = t.employee_id
     WHERE t.payroll_period_id = ? AND t.post_to_journal = true AND t.gl_account_id IS NULL
     ORDER BY t.transaction_code, e.employee_no`, periodId,
  );
  const byCode = new Map<string, { name: string; employees: string[] }>();
  for (const m of missing) {
    const c = byCode.get(m.transaction_code) ?? { name: m.transaction_name, employees: [] };
    c.employees.push(m.employee_no); byCode.set(m.transaction_code, c);
  }
  for (const [code, c] of byCode) problems.push(`${code} — ${c.name} has no G/L account (${c.employees.slice(0, 3).join(', ')}${c.employees.length > 3 ? ` +${c.employees.length - 3} more` : ''})`);

  const bad = await all<{ transaction_code: string; transaction_name: string; code: string | null; name: string | null; is_postable: number | boolean | null; status: string | null }>(
    `SELECT DISTINCT t.transaction_code, t.transaction_name, g.code, g.name, g.is_postable, g.status
     FROM payroll_period_transaction t LEFT JOIN gl_account g ON g.id = t.gl_account_id
     WHERE t.payroll_period_id = ? AND t.post_to_journal = true AND t.gl_account_id IS NOT NULL
       AND (g.id IS NULL OR COALESCE(g.is_postable, 0) <> 1 OR g.status <> 'ACTIVE')`, periodId,
  );
  for (const b of bad) {
    problems.push(b.code == null
      ? `${b.transaction_code} — ${b.transaction_name} points at a G/L account that no longer exists`
      : `${b.transaction_code} — ${b.transaction_name} posts to ${b.code} ${b.name}, which is ${b.status !== 'ACTIVE' ? 'not active' : 'not a posting account'}`);
  }

  const bal = await one<{ d: number; c: number }>(
    "SELECT COALESCE(SUM(CASE WHEN post_as = 'DEBIT' THEN amount_cents ELSE 0 END), 0) AS d, COALESCE(SUM(CASE WHEN post_as = 'CREDIT' THEN amount_cents ELSE 0 END), 0) AS c FROM payroll_period_transaction WHERE payroll_period_id = ? AND post_to_journal = true", periodId,
  );
  if (Number(bal?.d ?? 0) !== Number(bal?.c ?? 0)) {
    problems.push(`the payroll journal does not balance (debits ${(Number(bal?.d ?? 0) / 100).toLocaleString()} vs credits ${(Number(bal?.c ?? 0) / 100).toLocaleString()}) — re-run payroll`);
  }
  if (problems.length) {
    throw new AppError(`The payroll journal cannot be posted yet: ${problems.join('; ')}. Set the accounts on the posting group / transaction codes, re-run payroll and send again.`, 'VALIDATION');
  }
}

export async function submitPayrollPeriod(id: number, user: Actor): Promise<{ autoApproved: boolean }> {
  const period = await getPayrollPeriod(id);
  if (!period) throw new AppError('Not found', 'NOT_FOUND');
  if (period.status !== 'OPEN') throw new AppError('Only an open period can be submitted for approval', 'VALIDATION');
  if (!(await one('SELECT 1 FROM payroll_period_transaction WHERE payroll_period_id = ?', id))) {
    throw new AppError('Run payroll for at least one employee first', 'VALIDATION');
  }
  await assertPayrollJournalPostable(id);
  const matched = await findMatchingWorkflow('PAYROLL_PERIOD', await pickConditionFields('PAYROLL_PERIOD', period));
  if (!matched) throw new AppError('There is no enabled workflow for this document', 'NO_WORKFLOW');
  await tx(async () => {
    await run("UPDATE payroll_period SET status = 'PENDING_APPROVAL' WHERE id = ?", id);
    await startWorkflow(matched.workflow, matched.steps, { documentType: 'PAYROLL_PERIOD', entityId: String(id), requestedBy: user.username, amount: 0 });
  });
  const after = await getPayrollPeriod(id);
  return { autoApproved: after?.status === 'APPROVED' };
}

export async function cancelPayrollPeriodApproval(id: number, user: Actor): Promise<void> {
  const period = await getPayrollPeriod(id);
  if (!period) throw new AppError('Not found', 'NOT_FOUND');
  if (period.status !== 'PENDING_APPROVAL') throw new AppError('Only a period pending approval can be recalled', 'VALIDATION');
  const routed = await findPendingRoutedTask('PAYROLL_PERIOD', String(id));
  const requestedBy = routed?.requested_by ?? period.created_by;
  if (requestedBy !== user.username) throw new AppError('Only the person who submitted this can cancel it', 'NOT_REQUESTER');
  await run("UPDATE payroll_period SET status = 'OPEN' WHERE id = ?", id);
  await audit(user, 'PAYROLL_PERIOD_CANCEL_APPROVAL', 'payroll_period', id, {});
}

export async function approvePayrollPeriod(id: number, user: Actor): Promise<void> {
  const period = await getPayrollPeriod(id);
  if (!period) throw new AppError('Not found', 'NOT_FOUND');
  if (period.status !== 'PENDING_APPROVAL') throw new AppError('Only a period pending approval can be approved', 'VALIDATION');
  await run("UPDATE payroll_period SET status = 'APPROVED', decision_reason = NULL WHERE id = ?", id);
  await audit(user, 'PAYROLL_PERIOD_APPROVE', 'payroll_period', id, {});
}

/**
 * Reopen an Approved period that has not been closed: back to Open so lines can be corrected and
 * payroll re-run, after which it goes through approval again. A Closed period has posted its
 * journal and paid its employees — it stays closed (corrections belong in the next period).
 */
export async function reopenPayrollPeriod(id: number, reason: string, user: Actor): Promise<void> {
  const period = await getPayrollPeriod(id);
  if (!period) throw new AppError('Not found', 'NOT_FOUND');
  if (period.status === 'CLOSED') throw new AppError('A closed period has already posted its journal and paid its employees — it cannot be reopened; make corrections in the next period', 'VALIDATION');
  if (period.status !== 'APPROVED') throw new AppError('Only an approved period can be reopened (a pending one is recalled instead)', 'VALIDATION');
  if (!reason.trim()) throw new AppError('Give the reason for reopening', 'VALIDATION');
  await run("UPDATE payroll_period SET status = 'OPEN', decision_reason = ? WHERE id = ?", `Reopened by ${user.username}: ${reason.trim()}`, id);
  await audit(user, 'PAYROLL_PERIOD_REOPEN', 'payroll_period', id, { reason: reason.trim() });
}

export async function rejectPayrollPeriod(id: number, reason: string | null, user: Actor): Promise<void> {
  if (!reason?.trim()) throw new AppError('A reason is required', 'VALIDATION');
  const period = await getPayrollPeriod(id);
  if (!period) throw new AppError('Not found', 'NOT_FOUND');
  if (period.status !== 'PENDING_APPROVAL') throw new AppError('Only a period pending approval can be rejected', 'VALIDATION');
  await run("UPDATE payroll_period SET status = 'OPEN', decision_reason = ? WHERE id = ?", reason, id);
  await audit(user, 'PAYROLL_PERIOD_REJECT', 'payroll_period', id, { reason });
}

/** Approved -> posts one balanced journal for the whole period (aggregated by G/L account) and
 *  rolls every recurring, non-temporary employee_payroll_transaction line forward into a newly
 *  opened next period. */
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** ISO date + n calendar months, clamped to the month's end (BC CalcDate('1M') on the 31st → the 30th). */
function addMonths(iso: IsoDate, months: number): IsoDate {
  const [y, m, d] = iso.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(d, last);
  return `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
const lastDayOfMonth = (iso: IsoDate): IsoDate => {
  const [y, m] = iso.split('-').map(Number);
  return `${y}-${String(m).padStart(2, '0')}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
const isMonthEnd = (iso: IsoDate) => iso === lastDayOfMonth(iso);

/**
 * AL fnClosePayrollPeriod: the next period is the current one moved on by one month —
 * dtNewPeriod := CalcDate('1M', dtOpenPeriod), "Period Name" := <Month Text><Year>. The dates
 * shift by a calendar month (a month-end stays a month-end), and the name follows whatever
 * convention the current period uses — "2026-09" → "2026-10", "Sept-2026" → "Oct-2026",
 * "September 2026" → "October 2026" — falling back to AL's "<Month> <Year>".
 */
export function nextPayrollPeriod(period: Pick<PayrollPeriod, 'period_name' | 'start_date' | 'end_date'>): { periodName: string; startDate: IsoDate; endDate: IsoDate } {
  const startDate = addMonths(period.start_date, 1);
  const endDate = isMonthEnd(period.end_date) ? lastDayOfMonth(addMonths(period.end_date, 1)) : addMonths(period.end_date, 1);
  const [ny, nm] = startDate.split('-').map(Number);
  const month = MONTHS_LONG[nm - 1];
  const name = period.period_name.trim();
  let periodName: string;
  const ym = /^(\d{4})[-/](\d{1,2})$/.exec(name);
  const my = /^([A-Za-z]+)([\s\-/_]*)(\d{4})$/.exec(name);
  if (ym) periodName = `${ny}-${String(nm).padStart(2, '0')}`;
  else if (my) {
    // A full month name stays full; any abbreviation ("Sep", "Sept") becomes the standard three letters. The separator is kept.
    const abbr = my[1].length >= (MONTHS_LONG.find((m) => m.toLowerCase().startsWith(my[1].toLowerCase()))?.length ?? 99) ? month : month.slice(0, 3);
    periodName = `${abbr}${my[2]}${ny}`;
  } else periodName = `${month} ${ny}`;
  return { periodName, startDate, endDate };
}

export async function closePayrollPeriod(id: number, nextOverride: { periodName?: string; startDate?: string; endDate?: string } | null, user: Actor): Promise<{ nextPeriodId: number; journalNo: string; nextPeriodName: string }> {
  return tx(async () => {
    const period = await getPayrollPeriod(id);
    if (!period) throw new AppError('Not found', 'NOT_FOUND');
    if (period.status !== 'APPROVED') throw new AppError('Only an approved period can be closed', 'VALIDATION');
    // AL: the next period is derived (current + 1M); an explicit override is accepted but never required.
    const derived = nextPayrollPeriod(period);
    const nextPeriod = {
      periodName: nextOverride?.periodName?.trim() || derived.periodName,
      startDate: nextOverride?.startDate || derived.startDate,
      endDate: nextOverride?.endDate || derived.endDate,
    };
    if (nextPeriod.startDate <= period.end_date) throw new AppError('The next period must start after this one ends', 'VALIDATION');
    if (await one('SELECT 1 FROM payroll_period WHERE period_name = ?', nextPeriod.periodName)) throw new AppError(`A period named ${nextPeriod.periodName} already exists`, 'DUPLICATE');
    // Post first, close second: the journal (checked once more — an account may have been
    // retired since approval), then the SACCO side; only then the next period and CLOSED. All
    // inside one transaction, so a failure anywhere leaves the period Approved and untouched.
    await assertPayrollJournalPostable(id);

    // Only lines flagged "Post To Journal" reach the G/L — the tax workings are memo lines.
    const lines = await all<{ gl_account_id: number | null; post_as: 'DEBIT' | 'CREDIT'; total: string }>(
      "SELECT gl_account_id, post_as, SUM(amount_cents) AS total FROM payroll_period_transaction WHERE payroll_period_id = ? AND post_to_journal = true GROUP BY gl_account_id, post_as",
      id,
    );
    const journalLines = lines.filter((l) => l.gl_account_id != null && l.post_as).map((l) => ({
      account: l.gl_account_id!,
      debit: l.post_as === 'DEBIT' ? Number(l.total) : undefined,
      credit: l.post_as === 'CREDIT' ? Number(l.total) : undefined,
      narration: `Payroll ${period.period_name}`,
    }));
    const posted = await postJournal({
      valueDate: period.end_date, module: 'PAYROLL', eventType: 'PAYROLL_PERIOD_CLOSE',
      description: `Payroll — ${period.period_name}`, reference: period.period_name,
      lines: journalLines, user, idempotencyKey: `PAYROLL-${id}`,
    });
    // Imprest recoveries and claim reimbursements on this payroll settle the employee subledger.
    await settleImprestsFromPayroll(id, period.end_date, posted.id, user);

    const info = await run(
      'INSERT INTO payroll_period (period_name, start_date, end_date, created_at, created_by) VALUES (?,?,?,?,?)',
      nextPeriod.periodName.trim(), nextPeriod.startDate, nextPeriod.endDate, new Date().toISOString(), user.username,
    );
    const nextPeriodId = Number(info.lastInsertRowid);

    // Roll the recurring lines forward — except a line whose End Date falls before the next
    // period starts: it ceases with this period, and is marked stopped here so its history says so.
    const recurring = await all<{ id: number; employee_id: number; transaction_code_id: number; amount_cents: number; original_amount_cents: number | null; balance_cents: number | null; no_of_periods: number | null; executed_periods: number; stopped: boolean; temporary: boolean; notes: string | null; start_date: string | null; end_date: string | null; salary_scale_id: number | null }>(
      'SELECT * FROM employee_payroll_transaction WHERE payroll_period_id = ? AND temporary = false AND stopped = false', id,
    );
    for (const r of recurring) {
      if (r.end_date && r.end_date < nextPeriod.startDate) {
        await run('UPDATE employee_payroll_transaction SET stopped = true WHERE id = ?', r.id);
        continue;
      }
      await run(
        `INSERT INTO employee_payroll_transaction
           (employee_id, transaction_code_id, payroll_period_id, amount_cents, original_amount_cents, balance_cents,
            no_of_periods, executed_periods, temporary, notes, start_date, end_date, salary_scale_id, created_at, created_by)
         VALUES (?,?,?,?,?,?,?,?,false,?,?,?,?,?,?)`,
        r.employee_id, r.transaction_code_id, nextPeriodId, r.amount_cents, r.original_amount_cents, r.balance_cents,
        r.no_of_periods, r.executed_periods, r.notes, r.start_date, r.end_date, r.salary_scale_id, new Date().toISOString(), user.username,
      );
    }

    await run("UPDATE payroll_period SET status = 'CLOSED', closed_at = ?, closed_by = ? WHERE id = ?", new Date().toISOString(), user.username, id);
    await audit(user, 'PAYROLL_PERIOD_CLOSE', 'payroll_period', id, { nextPeriodId, nextPeriodName: nextPeriod.periodName, journalNo: posted.journal_no });
    return { nextPeriodId, journalNo: posted.journal_no, nextPeriodName: nextPeriod.periodName };
  });
}

/* ==================================================================== employee payroll lines */

export const listEmployeeTransactions = (employeeId: number, periodId: number): Promise<EmployeePayrollTransactionView[]> =>
  all(
    `SELECT t.*, c.name AS transaction_code_name, c.type AS transaction_type
     FROM employee_payroll_transaction t JOIN payroll_transaction_code c ON c.id = t.transaction_code_id
     WHERE t.employee_id = ? AND t.payroll_period_id = ? ORDER BY c.name`,
    employeeId, periodId,
  );

/** The Payroll Period Transactions of a period (or of one employee in it), in payslip order. */
export const listPeriodTransactions = (periodId: number, employeeId?: number): Promise<PayrollPeriodTransactionView[]> =>
  all(
    `SELECT l.*, e.employee_no, e.first_name AS employee_first_name, e.last_name AS employee_last_name
     FROM payroll_period_transaction l JOIN employee e ON e.id = l.employee_id
     WHERE l.payroll_period_id = ? ${employeeId ? 'AND l.employee_id = ?' : ''} ORDER BY e.first_name, e.last_name, l.group_order, l.sub_group_order, l.payslip_order`,
    ...(employeeId ? [periodId, employeeId] : [periodId]),
  );

/** How many monthly payroll periods [from, to] spans, counting both end months — what "Runs for
 *  N periods" becomes when a line is given an End Date. */
export function periodsInWindow(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00Z'); const b = new Date(to + 'T00:00:00Z');
  return Math.max(1, (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + 1);
}

export interface EmployeeTransactionInput {
  employeeId: number; periodId: number; transactionCodeId: number; amountCents: number;
  originalAmountCents?: number | null; temporary?: boolean; notes?: string | null;
  /** The line is in force only for periods overlapping [startDate, endDate]; either side may be open.
   *  "Runs for N periods" is derived from the window, never supplied. */
  startDate?: string | null; endDate?: string | null;
}

/**
 * AL Payroll Employee Transaction is keyed on Employee Code + Transaction Code + period: one line
 * per code per period, so an employee cannot carry two Transport Allowances.
 */
export async function assertNoDuplicateLine(employeeId: number, periodId: number, code: Pick<PayrollTransactionCode, 'id' | 'code' | 'name'>): Promise<void> {
  const existing = await one<{ id: number; stopped: boolean; salary_scale_id: number | null }>(
    'SELECT id, stopped, salary_scale_id FROM employee_payroll_transaction WHERE employee_id = ? AND payroll_period_id = ? AND transaction_code_id = ? ORDER BY stopped, id LIMIT 1',
    employeeId, periodId, code.id,
  );
  if (!existing) return;
  const label = `${code.code} — ${code.name}`;
  if (existing.stopped) throw new AppError(`${label} is already on this employee for the period, stopped — reactivate that line instead of adding another`, 'DUPLICATE');
  if (existing.salary_scale_id) throw new AppError(`${label} is already conferred by the employee's salary scale notch this period — adjust that line instead of adding another`, 'DUPLICATE');
  throw new AppError(`${label} is already on this employee for the period — edit or stop the existing line instead of adding a second one`, 'DUPLICATE');
}

export async function addEmployeeTransaction(input: EmployeeTransactionInput, user: Actor): Promise<{ id: number }> {
  const period = await getPayrollPeriod(input.periodId);
  if (!period || period.status !== 'OPEN') throw new AppError('Transactions can only be added to an Open period', 'VALIDATION');
  const code = await one<PayrollTransactionCode>('SELECT * FROM payroll_transaction_code WHERE id = ?', input.transactionCodeId);
  if (!code) throw new AppError('Transaction code not found', 'NOT_FOUND');
  await assertNoDuplicateLine(input.employeeId, input.periodId, code);
  const startDate = input.startDate || null;
  const endDate = input.endDate || null;
  if (startDate && endDate && startDate > endDate) throw new AppError('The end date cannot be before the start date', 'VALIDATION');
  if (endDate && endDate < period.start_date) throw new AppError(`The end date is before the open period (${period.period_name}) — the line would never run`, 'VALIDATION');
  // "Runs for N periods" is derived, never typed: a dated window fixes it — from the start date
  // (or this period, if the start is blank or earlier) to the end date, month by month — and no
  // end date means indefinite, until stopped.
  const noOfPeriods = endDate
    ? periodsInWindow(startDate && startDate > period.start_date ? startDate : period.start_date, endDate)
    : null;
  const info = await run(
    `INSERT INTO employee_payroll_transaction
       (employee_id, transaction_code_id, payroll_period_id, amount_cents, original_amount_cents, balance_cents,
        no_of_periods, temporary, notes, start_date, end_date, created_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    input.employeeId, input.transactionCodeId, input.periodId, Math.round(input.amountCents),
    input.originalAmountCents != null ? Math.round(input.originalAmountCents) : null,
    code.balance_type === 'REDUCING' ? Math.round(input.originalAmountCents ?? input.amountCents) : null,
    noOfPeriods, !!input.temporary, input.notes?.trim() || null, startDate, endDate, new Date().toISOString(), user.username,
  );
  await audit(user, 'PAYROLL_EMPLOYEE_TRANSACTION_ADD', 'employee_payroll_transaction', info.lastInsertRowid, {});
  return { id: Number(info.lastInsertRowid) };
}

export async function removeEmployeeTransaction(id: number, user: Actor): Promise<void> {
  const row = await one<{ payroll_period_id: number }>('SELECT payroll_period_id FROM employee_payroll_transaction WHERE id = ?', id);
  if (!row) throw new AppError('Not found', 'NOT_FOUND');
  const period = await getPayrollPeriod(row.payroll_period_id);
  if (!period || period.status !== 'OPEN') throw new AppError('Transactions can only be removed from an Open period', 'VALIDATION');
  await run('DELETE FROM employee_payroll_transaction WHERE id = ?', id);
  await audit(user, 'PAYROLL_EMPLOYEE_TRANSACTION_REMOVE', 'employee_payroll_transaction', id, {});
}

export async function stopEmployeeTransaction(id: number, stopped: boolean, user: Actor): Promise<void> {
  await run('UPDATE employee_payroll_transaction SET stopped = ? WHERE id = ?', stopped, id);
  await audit(user, 'PAYROLL_EMPLOYEE_TRANSACTION_STOP', 'employee_payroll_transaction', id, { stopped });
}

/* ======================================================================= cross-module hooks */

/** Leave Management hook: a leave application flagged `leave_allowance_payable` credits the
 *  employee's grade-based Leave Allowance amount into the currently open payroll period, once
 *  (skipped silently if there is no open period yet — the next run's operator adds it manually). */
export async function applyLeaveAllowance(employeeId: number, user: Actor): Promise<void> {
  const period = await getOpenPayrollPeriod();
  if (!period) return;
  const emp = await getEmployee(employeeId);
  if (!emp?.job_grade_id) return;
  const grade = await one<{ leave_allowance_amount: number }>('SELECT leave_allowance_amount FROM hr_job_grade WHERE id = ?', emp.job_grade_id);
  if (!grade || !(Number(grade.leave_allowance_amount) > 0)) return;
  const sys = await ensureSystemTransactionCodes();
  const already = await one(
    'SELECT 1 FROM employee_payroll_transaction WHERE employee_id = ? AND payroll_period_id = ? AND transaction_code_id = ?',
    employeeId, period.id, sys.LVALLOW,
  );
  if (already) return;
  await addEmployeeTransaction({
    employeeId, periodId: period.id, transactionCodeId: sys.LVALLOW, amountCents: Number(grade.leave_allowance_amount),
    temporary: true, notes: 'Leave allowance on approved annual leave',
  }, user);
}

/* ================================================================================== reports */

export interface PayslipData {
  employee: { id: number; employee_no: string; first_name: string; last_name: string; job_title: string | null };
  period: PayrollPeriod;
  lines: { section: string; code: string; name: string; amountCents: number; isDebit: boolean }[];
  p9: import('./types.ts').PayrollP9Line | undefined;
}

/** One employee's printable payslip for a period — every posted line grouped by section, plus
 *  the P9 summary row that run produced. */
export async function getPayslip(periodId: number, employeeId: number): Promise<PayslipData> {
  const [period, emp, lines, p9] = await Promise.all([
    getPayrollPeriod(periodId),
    one<{ id: number; employee_no: string; first_name: string; last_name: string; job_title: string | null }>(
      'SELECT id, employee_no, first_name, last_name, job_title FROM employee WHERE id = ?', employeeId,
    ),
    all<{ section: string; code: string; name: string; amount_cents: number; is_debit: boolean; transaction_type: string }>(
      `SELECT l.group_text AS section, l.transaction_code AS code, l.transaction_name AS name, l.amount_cents,
              (l.post_as = 'DEBIT') AS is_debit, l.transaction_type
       FROM payroll_period_transaction l
       WHERE l.payroll_period_id = ? AND l.employee_id = ? ORDER BY l.group_order, l.sub_group_order, l.payslip_order`,
      periodId, employeeId,
    ),
    one<import('./types.ts').PayrollP9Line>('SELECT * FROM payroll_p9_line WHERE payroll_period_id = ? AND employee_id = ?', periodId, employeeId),
  ]);
  if (!period) throw new AppError('Payroll period not found', 'NOT_FOUND');
  if (!emp) throw new AppError('Employee not found', 'NOT_FOUND');
  return {
    employee: emp, period,
    lines: lines.map((l) => ({ section: l.section, code: l.code, name: l.name, amountCents: Number(l.amount_cents), isDebit: l.is_debit, isMemo: l.transaction_type === 'MEMO' })),
    p9,
  };
}

export interface NetPayReportRow { employeeId: number; employeeNo: string; name: string; grossPayCents: number; totalDeductionsCents: number; netPayCents: number }

/** Net Pay Report — one row per employee: gross pay, everything withheld, and net pay. */
export async function getNetPayReport(periodId: number): Promise<NetPayReportRow[]> {
  const rows = await all<{ id: number; employee_no: string; name: string; gross: number; net: number }>(
    `SELECT e.id, e.employee_no, (e.first_name || ' ' || e.last_name) AS name,
            COALESCE(p9.gross_pay_cents, 0) AS gross, COALESCE(p9.net_pay_cents, 0) AS net
     FROM employee e JOIN payroll_p9_line p9 ON p9.employee_id = e.id AND p9.payroll_period_id = ?
     ORDER BY e.first_name, e.last_name`,
    periodId,
  );
  return rows.map((r) => ({
    employeeId: r.id, employeeNo: r.employee_no, name: r.name,
    grossPayCents: Number(r.gross), netPayCents: Number(r.net),
    totalDeductionsCents: Number(r.gross) - Number(r.net),
  }));
}

export interface StatutoryReportRow { employeeId: number; employeeNo: string; name: string; amountCents: number }

/** NSSF / SHIF / PAYE / Housing Levy remittance listing — one row per employee who has a
 *  Payroll Period Transaction under that code in the period. */
async function getStatutoryReport(periodId: number, periodCode: PeriodCode): Promise<StatutoryReportRow[]> {
  const rows = await all<{ id: number; employee_no: string; name: string; amount: number }>(
    `SELECT e.id, e.employee_no, (e.first_name || ' ' || e.last_name) AS name, SUM(l.amount_cents) AS amount
     FROM payroll_period_transaction l JOIN employee e ON e.id = l.employee_id
     WHERE l.payroll_period_id = ? AND l.transaction_code = ?
     GROUP BY e.id, e.employee_no, e.first_name, e.last_name ORDER BY e.first_name, e.last_name`,
    periodId, periodCode,
  );
  return rows.map((r) => ({ employeeId: r.id, employeeNo: r.employee_no, name: r.name, amountCents: Number(r.amount) }));
}
export const getNssfReport = (periodId: number): Promise<StatutoryReportRow[]> => getStatutoryReport(periodId, 'NSSF');
export const getShifReport = (periodId: number): Promise<StatutoryReportRow[]> => getStatutoryReport(periodId, 'SHIF');
export const getPayeReport = (periodId: number): Promise<StatutoryReportRow[]> => getStatutoryReport(periodId, 'PAYE');
export const getHousingLevyReport = (periodId: number): Promise<StatutoryReportRow[]> => getStatutoryReport(periodId, 'AHL');

export interface CompanySummaryReport {
  period: PayrollPeriod; employeeCount: number;
  grossPayCents: number; taxablePayCents: number; payeCents: number; nssfEmployeeCents: number; nssfEmployerCents: number;
  shifCents: number; housingLevyEmployeeCents: number; housingLevyEmployerCents: number; deductionsCents: number; netPayCents: number;
  byDepartment: { name: string; employeeCount: number; grossPayCents: number; netPayCents: number }[];
}

/** Company Summary — the whole period's statutory + net-pay totals, plus a per-department
 *  breakdown, for the approver's overview before Approve/Close. */
export async function getCompanySummary(periodId: number): Promise<CompanySummaryReport> {
  const period = await getPayrollPeriod(periodId);
  if (!period) throw new AppError('Payroll period not found', 'NOT_FOUND');

  const totals = await one<{
    n: number; gross: number; taxable: number; paye: number; nssf: number; shif: number; hlevy: number; deductions: number; net: number;
  }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(gross_pay_cents),0) AS gross, COALESCE(SUM(taxable_pay_cents),0) AS taxable,
            COALESCE(SUM(paye_cents),0) AS paye, COALESCE(SUM(nssf_cents),0) AS nssf, COALESCE(SUM(shif_cents),0) AS shif,
            COALESCE(SUM(housing_levy_cents),0) AS hlevy, COALESCE(SUM(deductions_cents),0) AS deductions,
            COALESCE(SUM(net_pay_cents),0) AS net
     FROM payroll_p9_line WHERE payroll_period_id = ?`,
    periodId,
  );
  const nssfEmployer = await one<{ v: number }>(
    "SELECT COALESCE(SUM(l.amount_cents),0) AS v FROM payroll_period_transaction l WHERE l.payroll_period_id = ? AND l.transaction_code = 'NSSF-ER' AND l.post_as = 'DEBIT'",
    periodId,
  );
  const hlevyEmployer = await one<{ v: number }>(
    "SELECT COALESCE(SUM(l.amount_cents),0) AS v FROM payroll_period_transaction l WHERE l.payroll_period_id = ? AND l.transaction_code = 'AHL-ER' AND l.post_as = 'DEBIT'",
    periodId,
  );
  const byDept = await all<{ name: string; n: number; gross: number; net: number }>(
    `SELECT COALESCE(gd2.name, 'Unassigned') AS name, COUNT(*) AS n,
            COALESCE(SUM(p9.gross_pay_cents),0) AS gross, COALESCE(SUM(p9.net_pay_cents),0) AS net
     FROM payroll_p9_line p9 JOIN employee e ON e.id = p9.employee_id
     LEFT JOIN global_dimension_2_value gd2 ON gd2.id = e.global_dimension_2_id
     WHERE p9.payroll_period_id = ? GROUP BY gd2.name ORDER BY gross DESC`,
    periodId,
  );

  return {
    period, employeeCount: Number(totals?.n ?? 0), grossPayCents: Number(totals?.gross ?? 0),
    taxablePayCents: Number(totals?.taxable ?? 0), payeCents: Number(totals?.paye ?? 0),
    nssfEmployeeCents: Number(totals?.nssf ?? 0), nssfEmployerCents: Number(nssfEmployer?.v ?? 0),
    shifCents: Number(totals?.shif ?? 0),
    housingLevyEmployeeCents: Number(totals?.hlevy ?? 0), housingLevyEmployerCents: Number(hlevyEmployer?.v ?? 0),
    deductionsCents: Number(totals?.deductions ?? 0), netPayCents: Number(totals?.net ?? 0),
    byDepartment: byDept.map((d) => ({ name: d.name, employeeCount: Number(d.n), grossPayCents: Number(d.gross), netPayCents: Number(d.net) })),
  };
}

export interface PayrollRegisterRow {
  employeeId: number; employeeNo: string; name: string;
  basicCents: number; allowancesCents: number; grossCents: number; taxableCents: number;
  payeCents: number; nssfCents: number; shifCents: number; housingLevyCents: number;
  deductionsCents: number; netCents: number;
}

/** Payroll Register — the master report, one wide row per employee covering every figure on
 *  their payslip for the period. */
export async function getPayrollRegister(periodId: number): Promise<PayrollRegisterRow[]> {
  const [p9Rows, basicAllowance] = await Promise.all([
    all<{ employee_id: number; employee_no: string; name: string; basic: number; gross: number; taxable: number; paye: number; nssf: number; shif: number; hlevy: number; deductions: number; net: number }>(
      `SELECT p9.employee_id, e.employee_no, (e.first_name || ' ' || e.last_name) AS name,
              p9.basic_pay_cents AS basic, p9.gross_pay_cents AS gross, p9.taxable_pay_cents AS taxable,
              p9.paye_cents AS paye, p9.nssf_cents AS nssf, p9.shif_cents AS shif, p9.housing_levy_cents AS hlevy,
              p9.deductions_cents AS deductions, p9.net_pay_cents AS net
       FROM payroll_p9_line p9 JOIN employee e ON e.id = p9.employee_id
       WHERE p9.payroll_period_id = ? ORDER BY e.first_name, e.last_name`,
      periodId,
    ),
    all<{ employee_id: number; total: number }>(
      "SELECT employee_id, COALESCE(SUM(amount_cents),0) AS total FROM payroll_period_transaction WHERE payroll_period_id = ? AND group_text = 'ALLOWANCE' GROUP BY employee_id",
      periodId,
    ),
  ]);
  const allowanceByEmployee = new Map(basicAllowance.map((r) => [r.employee_id, Number(r.total)]));
  return p9Rows.map((r) => ({
    employeeId: r.employee_id, employeeNo: r.employee_no, name: r.name,
    basicCents: Number(r.basic), allowancesCents: allowanceByEmployee.get(r.employee_id) ?? 0,
    grossCents: Number(r.gross), taxableCents: Number(r.taxable), payeCents: Number(r.paye),
    nssfCents: Number(r.nssf), shifCents: Number(r.shif), housingLevyCents: Number(r.hlevy),
    deductionsCents: Number(r.deductions), netCents: Number(r.net),
  }));
}

export interface DeductionsReportRow { employeeId: number; employeeNo: string; name: string; code: string; codeName: string; amountCents: number }

/** Deductions Report — every non-statutory deduction line (loans, welfare, insurance, ...) per
 *  employee, for remitting to whichever third party each code represents. */
export async function getDeductionsReport(periodId: number): Promise<DeductionsReportRow[]> {
  const rows = await all<{ employee_id: number; employee_no: string; name: string; code: string; code_name: string; amount: number }>(
    `SELECT l.employee_id, e.employee_no, (e.first_name || ' ' || e.last_name) AS name, l.transaction_code AS code, l.transaction_name AS code_name, l.amount_cents AS amount
     FROM payroll_period_transaction l JOIN employee e ON e.id = l.employee_id
     WHERE l.payroll_period_id = ? AND l.group_text = 'DEDUCTIONS'
     ORDER BY e.first_name, e.last_name, l.transaction_name`,
    periodId,
  );
  return rows.map((r) => ({ employeeId: r.employee_id, employeeNo: r.employee_no, name: r.name, code: r.code, codeName: r.code_name, amountCents: Number(r.amount) }));
}

/** One month of the KRA P9 card — the lettered columns of the revised form, plus what the
 *  payslip-style summaries still read (NSSF, SHIF, net pay). */
export interface P9AnnualRow {
  periodName: string;
  /** Calendar month (1–12) of the period's start date — the card's Month column; 0 on the totals row. */
  monthNo: number;
  /** A basic salary, B non-cash benefits, C value of quarters, D total gross pay. */
  basicCents: number; benefitsCents: number; quartersCents: number; grossCents: number;
  /** E1 30% of A, E2 actual (staff pension + NSSF), E3 the fixed cap, E the lowest of the three. */
  e1Cents: number; e2Cents: number; e3Cents: number; definedContributionCents: number;
  /** F owner-occupier interest, G = E + F. */
  ownerOccupierInterestCents: number; retirementAndInterestCents: number;
  /** H Affordable Housing Levy, I SHIF, J post-retirement medical fund. */
  housingLevyCents: number; shifCents: number; prmfCents: number;
  /** K chargeable pay, L tax charged, M personal relief, N insurance relief, O PAYE. */
  taxableCents: number; taxChargedCents: number; personalReliefCents: number; insuranceReliefCents: number; payeCents: number;
  nssfCents: number; pensionCents: number; netCents: number;
}

/** KRA P9 — one employee's monthly breakdown for a calendar year, for the annual tax
 *  certificate. `year` is a 4-digit string (e.g. "2026"), matched against the payroll period's
 *  own name (YYYY-MM) or its start date. */
export interface P9Employee {
  employee_no: string; first_name: string; middle_name: string | null; last_name: string; kra_pin: string | null;
}

export async function getP9Annual(employeeId: number, year: string): Promise<{ employee: P9Employee; rows: P9AnnualRow[]; totals: P9AnnualRow }> {
  const [employee, setup] = await Promise.all([
    one<P9Employee>('SELECT employee_no, first_name, middle_name, last_name, kra_pin FROM employee WHERE id = ?', employeeId),
    getPayrollSetup(),
  ]);
  if (!employee) throw new AppError('Employee not found', 'NOT_FOUND');
  const rows = await all<PayrollP9Line & { period_name: string; start_date: string }>(
    `SELECT p9.*, pp.period_name, pp.start_date
     FROM payroll_p9_line p9 JOIN payroll_period pp ON pp.id = p9.payroll_period_id
     WHERE p9.employee_id = ? AND (pp.period_name ILIKE ? OR pp.start_date ILIKE ?)
     ORDER BY pp.start_date`,
    employeeId, `${year}-%`, `${year}-%`,
  );
  const n = (v: unknown) => Number(v ?? 0);
  const mapped = rows.map((r): P9AnnualRow => {
    const basic = n(r.basic_pay_cents);
    const e2 = n(r.pension_cents) + n(r.nssf_cents);
    const e = n(r.defined_contribution_cents);
    const f = n(r.owner_occupier_interest_cents);
    return {
      periodName: r.period_name, monthNo: Number(String(r.start_date).slice(5, 7)) || 0,
      basicCents: basic, benefitsCents: n(r.benefits_cents), quartersCents: n(r.quarters_cents), grossCents: n(r.gross_pay_cents),
      e1Cents: Math.round(basic * 0.30), e2Cents: e2, e3Cents: n(setup.pension_deduction_cap_cents), definedContributionCents: e,
      ownerOccupierInterestCents: f, retirementAndInterestCents: e + f,
      housingLevyCents: setup.housing_levy_deductible ? n(r.housing_levy_cents) : 0,
      shifCents: setup.shif_deductible ? n(r.shif_cents) : 0,
      prmfCents: n(r.prmf_cents),
      taxableCents: n(r.taxable_pay_cents), taxChargedCents: n(r.tax_charged_cents),
      personalReliefCents: n(r.personal_relief_cents), insuranceReliefCents: n(r.insurance_relief_cents), payeCents: n(r.paye_cents),
      nssfCents: n(r.nssf_cents), pensionCents: n(r.pension_cents), netCents: n(r.net_pay_cents),
    };
  });
  const zero: P9AnnualRow = {
    periodName: 'Total', monthNo: 0, basicCents: 0, benefitsCents: 0, quartersCents: 0, grossCents: 0, e1Cents: 0, e2Cents: 0, e3Cents: 0,
    definedContributionCents: 0, ownerOccupierInterestCents: 0, retirementAndInterestCents: 0, housingLevyCents: 0, shifCents: 0,
    prmfCents: 0, taxableCents: 0, taxChargedCents: 0, personalReliefCents: 0, insuranceReliefCents: 0, payeCents: 0,
    nssfCents: 0, pensionCents: 0, netCents: 0,
  };
  const totals = mapped.reduce<P9AnnualRow>((a, r) => {
    const out = { ...a };
    for (const k of Object.keys(zero) as (keyof P9AnnualRow)[]) {
      if (k !== 'periodName') (out[k] as number) = (a[k] as number) + (r[k] as number);
    }
    return out;
  }, zero);
  return { employee, rows: mapped, totals };
}

/** Employee Exit hook: once every clearance section is cleared, the exit's final-dues lines are
 *  pushed into the currently open payroll period as one-off transactions. */
export async function transferExitDuesToPayroll(exitNo: string, user: Actor): Promise<{ transferred: number }> {
  const period = await getOpenPayrollPeriod();
  if (!period) return { transferred: 0 };
  const exit = await one<{ employee_id: number }>('SELECT employee_id FROM employee_exit WHERE no = ?', exitNo);
  if (!exit) throw new AppError('Exit not found', 'NOT_FOUND');
  const dueLines = await all<{ due_type: EmployeeExitDueType; amount_cents: number }>(
    'SELECT due_type, amount_cents FROM employee_exit_final_due_line WHERE exit_no = ?', exitNo,
  );
  const sys = await ensureSystemTransactionCodes();
  const codeFor: Record<EmployeeExitDueType, string> = {
    LEAVE_ENCASHMENT: 'LVENC', NOTICE_PENALTY: 'NOTICEPEN', NOTICE_INCOME: 'NOTICEINC',
    GRATUITY: 'GRATUITY', UNCLEARED_ITEMS: 'UNCLEARED',
  };
  let transferred = 0;
  for (const line of dueLines) {
    if (!(Number(line.amount_cents) > 0)) continue;
    await addEmployeeTransaction({
      employeeId: exit.employee_id, periodId: period.id, transactionCodeId: sys[codeFor[line.due_type]],
      amountCents: Number(line.amount_cents), temporary: true, notes: `Final settlement — ${exitNo}`,
    }, user);
    transferred += 1;
  }
  return { transferred };
}
