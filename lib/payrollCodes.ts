/*
 * The payroll run's own transaction codes and payslip groups on Payroll Period Transactions
 * (AL Tab52203619) — shared by the run, the reports and the transaction-code catalogue (which
 * validates formulas against them) without a circular import.
 */

/**
 * The run's own transaction codes on Payroll Period Transactions (AL: BPAY, GPAY, DEFCON, OOI,
 * TXBP, TXCHRG, PSNR, INSR, NSSF, SHIF, NHF, PAYE, NPAY …). A formula on an Earnings &
 * Deductions code may refer to any of them — `[BPAY]*0.15`, `[GPAY]*2%`.
 */
export const PERIOD_CODES = {
  BPAY: 'Basic Pay',
  BENEFIT: 'Non-Cash Benefits',
  QTRS: 'Value of Quarters',
  GPAY: 'Gross Pay',
  DEFCON: 'Defined Contribution (lowest of 30% basic, actual, cap)',
  OOI: 'Owner Occupier Interest (allowable)',
  'AHL-RL': 'Housing Levy (allowable deduction)',
  'SHIF-RL': 'SHIF (allowable deduction)',
  'PRMF-RL': 'Post-Retirement Medical Fund (allowable)',
  TXBP: 'Chargeable Pay',
  TXCHRG: 'Tax Charged',
  PSNR: 'Personal Relief',
  INSR: 'Insurance Relief',
  NSSF: 'NSSF',
  'NSSF-ER': 'NSSF (Employer)',
  SHIF: 'SHIF',
  AHL: 'Affordable Housing Levy',
  'AHL-ER': 'Affordable Housing Levy (Employer)',
  PAYE: 'PAYE',
  NPAY: 'Net Pay',
} as const;
export type PeriodCode = keyof typeof PERIOD_CODES;

/** AL "Group Text" / "Group Order" on Payroll Period Transactions — the payslip's sections. */
export const PERIOD_GROUPS = {
  'BASIC SALARY': 1,
  'ALLOWANCE': 3,
  'GROSS PAY': 4,
  'TAX CALCULATIONS': 6,
  'STATUTORIES': 7,
  'DEDUCTIONS': 8,
  'NET PAY': 9,
  'EMPLOYER': 10,
} as const;
export type PeriodGroup = keyof typeof PERIOD_GROUPS;

