'use server';

import { revalidatePath } from 'next/cache';
import { requireAction } from '@/lib/session';
import { actionResult } from '@/lib/errors';
import {
  updatePayrollSetup, savePostingGroup, deletePostingGroup, savePayeBand, deletePayeBand,
  saveNssfTier, deleteNssfTier, saveTransactionCode, deleteTransactionCode,
  type PostingGroupInput, type TransactionCodeInput,
} from '@/lib/payrollSetup';
import type { ActionResult, FormValues, PayrollBalanceType, PayrollAmountPreference, PayrollSpecialType, PayrollTransactionType } from '@/lib/types';

const REVALIDATE = '/admin/pool/hr-payroll';

export async function updatePayrollSetupRequest(values: FormValues): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const user = await requireAction('PAYROLL_SETUP_MANAGE');
    await updatePayrollSetup({
      personalReliefCents: values.personalReliefCents ? Math.round(Number(values.personalReliefCents) * 100) : 0,
      insuranceReliefPct: Number(values.insuranceReliefPct),
      maxReliefCents: values.maxReliefCents ? Math.round(Number(values.maxReliefCents) * 100) : 0,
      mortgageReliefCents: values.mortgageReliefCents ? Math.round(Number(values.mortgageReliefCents) * 100) : 0,
      pensionDeductionCapCents: values.pensionDeductionCapCents ? Math.round(Number(values.pensionDeductionCapCents) * 100) : 0,
      prmfCapCents: values.prmfCapCents ? Math.round(Number(values.prmfCapCents) * 100) : 0,
      shifDeductible: values.shifDeductible === '1' || values.shifDeductible === 'on' || values.shifDeductible === 'true',
      housingLevyDeductible: values.housingLevyDeductible === '1' || values.housingLevyDeductible === 'on' || values.housingLevyDeductible === 'true',
      shifPct: Number(values.shifPct), shifBasedOn: String(values.shifBasedOn || 'GROSS'),
      nssfEmployerFactor: Number(values.nssfEmployerFactor),
      housingLevyEnabled: !!Number(values.housingLevyEnabled), housingLevyPct: Number(values.housingLevyPct),
      housingLevyBasedOn: String(values.housingLevyBasedOn || 'GROSS'),
      minimumReliefThresholdCents: values.minimumReliefThresholdCents ? Math.round(Number(values.minimumReliefThresholdCents) * 100) : 0,
      secondaryTaxPct: Number(values.secondaryTaxPct), monthlyWorkingDays: Number(values.monthlyWorkingDays),
    }, user);
    revalidatePath(REVALIDATE);
    return { updated: true };
  });
}

function toPostingGroupInput(values: FormValues): PostingGroupInput {
  return {
    id: values.id ? Number(values.id) : null, code: String(values.code || ''), name: String(values.name || ''),
    salaryExpenseAccountId: Number(values.salaryExpenseAccountId), payePayableAccountId: Number(values.payePayableAccountId),
    netPayPayableAccountId: Number(values.netPayPayableAccountId), nssfEmployeePayableAccountId: Number(values.nssfEmployeePayableAccountId),
    nssfEmployerExpenseAccountId: Number(values.nssfEmployerExpenseAccountId), nssfEmployerPayableAccountId: Number(values.nssfEmployerPayableAccountId),
    shifPayableAccountId: Number(values.shifPayableAccountId),
    housingLevyEmployeePayableAccountId: Number(values.housingLevyEmployeePayableAccountId),
    housingLevyEmployerExpenseAccountId: Number(values.housingLevyEmployerExpenseAccountId),
    housingLevyEmployerPayableAccountId: Number(values.housingLevyEmployerPayableAccountId),
  };
}

export async function savePostingGroupRequest(values: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('PAYROLL_POSTING_GROUPS_MANAGE');
    const res = await savePostingGroup(toPostingGroupInput(values), user);
    revalidatePath(REVALIDATE);
    return res;
  });
}

export async function deletePostingGroupRequest(id: number): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => {
    const user = await requireAction('PAYROLL_POSTING_GROUPS_MANAGE');
    await deletePostingGroup(id, user);
    revalidatePath(REVALIDATE);
    return { deleted: true };
  });
}

export async function savePayeBandRequest(values: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('PAYROLL_PAYE_BANDS_MANAGE');
    const res = await savePayeBand({
      id: values.id ? Number(values.id) : null, sortOrder: Number(values.sortOrder),
      upperBoundCents: values.upperBoundCents ? Math.round(Number(values.upperBoundCents) * 100) : null,
      ratePct: Number(values.ratePct),
    }, user);
    revalidatePath(REVALIDATE);
    return res;
  });
}

export async function deletePayeBandRequest(id: number): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => {
    const user = await requireAction('PAYROLL_PAYE_BANDS_MANAGE');
    await deletePayeBand(id, user);
    revalidatePath(REVALIDATE);
    return { deleted: true };
  });
}

export async function saveNssfTierRequest(values: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('PAYROLL_NSSF_TIERS_MANAGE');
    const res = await saveNssfTier({
      id: values.id ? Number(values.id) : null, tierNo: Number(values.tierNo),
      lowerLimitCents: Math.round(Number(values.lowerLimitCents) * 100), upperLimitCents: Math.round(Number(values.upperLimitCents) * 100),
      employeeRatePct: Number(values.employeeRatePct), employerRatePct: Number(values.employerRatePct),
    }, user);
    revalidatePath(REVALIDATE);
    return res;
  });
}

export async function deleteNssfTierRequest(id: number): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => {
    const user = await requireAction('PAYROLL_NSSF_TIERS_MANAGE');
    await deleteNssfTier(id, user);
    revalidatePath(REVALIDATE);
    return { deleted: true };
  });
}

function toTransactionCodeInput(values: FormValues): TransactionCodeInput {
  return {
    id: values.id ? Number(values.id) : null, code: String(values.code || ''), name: String(values.name || ''),
    type: String(values.type || 'INCOME') as PayrollTransactionType, taxable: !!Number(values.taxable),
    isFormula: !!Number(values.isFormula), formula: values.formula ? String(values.formula) : null,
    amountPreference: (String(values.amountPreference || 'FORMULA') as PayrollAmountPreference),
    employerFactor: values.employerFactor ? Number(values.employerFactor) : 0,
    employerFormula: values.employerFormula ? String(values.employerFormula) : null,
    fixedAmountCents: values.fixedAmountCents ? Math.round(Number(values.fixedAmountCents) * 100) : 0,
    upperLimitCents: values.upperLimitCents ? Math.round(Number(values.upperLimitCents) * 100) : null,
    balanceType: String(values.balanceType || 'NONE') as PayrollBalanceType,
    specialType: String(values.specialType || 'NONE') as PayrollSpecialType,
    glAccountId: values.glAccountId ? Number(values.glAccountId) : null,
    employerGlAccountId: values.employerGlAccountId ? Number(values.employerGlAccountId) : null,
    forEveryEmployee: !!Number(values.forEveryEmployee),
  };
}

export async function saveTransactionCodeRequest(values: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('PAYROLL_TRANSACTION_CODES_MANAGE');
    const res = await saveTransactionCode(toTransactionCodeInput(values), user);
    revalidatePath(REVALIDATE);
    return res;
  });
}

export async function deleteTransactionCodeRequest(id: number): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => {
    const user = await requireAction('PAYROLL_TRANSACTION_CODES_MANAGE');
    await deleteTransactionCode(id, user);
    revalidatePath(REVALIDATE);
    return { deleted: true };
  });
}
