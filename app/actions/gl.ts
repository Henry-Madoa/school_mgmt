'use server';

import { revalidatePath } from 'next/cache';
import { requireAction } from '@/lib/session';
import { actionResult, AppError } from '@/lib/errors';
import * as gl from '@/lib/gl';
import {
  getCloseIncomeStatementContext, listClosingRuns, previewCloseIncomeStatement, postCloseIncomeStatement,
  type CloseIncomeStatementInput,
} from '@/lib/closeIncomeStatement';
import { toCents } from '@/lib/format';
import type { FilterCondition } from '@/lib/listFilters';
import type {
  AccountingPeriod, ActionResult, FormValues, GlAccount, GlAccountStructureType, GlAccountType,
  JournalLineInput, JournalRelatedEntries, PostedJournal,
} from '@/lib/types';

/*
 * The ledger and journal drill-downs open as modals over the list, as they did
 * in the SPA. They fetch on open rather than shipping every account's 500-line
 * ledger with the page.
 */
export async function fetchAccountLedger(
  code: string,
  opts: { from?: string; asOf?: string; filters?: FilterCondition[] } = {},
): Promise<ActionResult<gl.AccountLedger>> {
  return actionResult(async () => {
    await requireAction('GL_READ');
    const ledger = await gl.getAccountLedger(code, {
      from: opts.from || null, asOf: opts.asOf || null, filters: opts.filters,
    });
    if (!ledger) throw new AppError('Account not found', 'NOT_FOUND');
    return ledger;
  });
}

export async function fetchJournal(id: number): Promise<ActionResult<gl.JournalDetail>> {
  return actionResult(async () => {
    await requireAction('GL_READ');
    const journal = await gl.getJournal(id);
    if (!journal) throw new AppError('Journal not found', 'NOT_FOUND');
    return journal;
  });
}

/** A manual journal line as typed into the entry grid. */
export interface JournalLineDraft {
  account: string;
  narration: string;
  debit: string;
  credit: string;
  globalDimension1Id: number | '';
  globalDimension2Id: number | '';
}

export async function createJournal(
  values: FormValues,
  lines: JournalLineDraft[],
): Promise<ActionResult<gl.CreateJournalResult>> {
  return actionResult(async () => {
    const user = await requireAction('GL_JOURNAL_CREATE');
    const result = await gl.createJournal({
      valueDate: String(values.valueDate || ''),
      description: String(values.description || ''),
      lines: lines.map((l): JournalLineInput => ({
        account: l.account,
        narration: l.narration,
        debit: toCents(l.debit),
        credit: toCents(l.credit),
        globalDimension1Id: l.globalDimension1Id || null,
        globalDimension2Id: l.globalDimension2Id || null,
      })),
    }, user);
    revalidatePath('/accounting');
    revalidatePath('/reports');
    revalidatePath('/approvals');
    return result;
  });
}

export async function reverseJournal(id: number, values: FormValues): Promise<ActionResult<PostedJournal>> {
  return actionResult(async () => {
    const user = await requireAction('GL_JOURNAL_REVERSE');
    const rev = await gl.reverseJournalEntry(id, String(values.reason || '').trim(), user);
    revalidatePath('/accounting');
    revalidatePath('/reports');
    return rev;
  });
}

/** Find Entries / Navigate — every subledger entry sharing this journal, for the "Related
 *  entries" section of the journal modal. */
export async function fetchJournalRelatedEntries(journalId: number): Promise<ActionResult<JournalRelatedEntries>> {
  return actionResult(async () => {
    await requireAction('GL_READ');
    return gl.getJournalRelatedEntries(journalId);
  });
}

// Bank Accounts + Bank Reconciliation moved to the Cash Management module — see
// app/actions/cashMgmt.ts.

export async function createGlAccount(values: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('GL_ACCOUNT_MANAGE');
    const created = await gl.createGlAccount({
      code: String(values.code || '').trim(),
      name: String(values.name || '').trim(),
      type: values.type as GlAccountType,
      parent_code: String(values.parent_code || '') || null,
      account_type: (values.account_type || 'POSTING') as GlAccountStructureType,
      totaling: String(values.totaling || '').trim() || null,
    }, user);
    revalidatePath('/accounting/accounts');
    return created;
  });
}

export async function updateGlAccount(code: string, values: FormValues): Promise<ActionResult<GlAccount>> {
  return actionResult(async () => {
    const user = await requireAction('GL_ACCOUNT_MANAGE');
    const updated = await gl.updateGlAccount(code, {
      name: String(values.name || '').trim(),
      type: values.type as GlAccountType,
      parent_code: String(values.parent_code || '') || null,
      account_type: (values.account_type || 'POSTING') as GlAccountStructureType,
      totaling: String(values.totaling || '').trim() || null,
      status: (String(values.status || 'ACTIVE') as 'ACTIVE' | 'INACTIVE'),
    }, user);
    revalidatePath('/accounting/accounts');
    return updated;
  });
}

export async function setPeriodStatus(code: string, status: string): Promise<ActionResult<AccountingPeriod>> {
  return actionResult(async () => {
    const user = await requireAction('GL_PERIOD_CLOSE');
    const period = await gl.setPeriodStatus(code, status, user);
    revalidatePath('/accounting/periods');
    return period;
  });
}

/** Business Central "Close Year": closes the earliest open fiscal year; cannot be undone. */
export async function closeFiscalYearRequest(): Promise<ActionResult<gl.FiscalYear>> {
  return actionResult(async () => {
    const user = await requireAction('GL_PERIOD_CLOSE');
    const year = await gl.closeFiscalYear(user);
    revalidatePath('/accounting/periods');
    revalidatePath('/accounting/close-income-statement');
    return year;
  });
}

/** Business Central "Create Fiscal Year": the next twelve monthly periods. */
export async function createFiscalYearRequest(noOfPeriods = 12): Promise<ActionResult<AccountingPeriod[]>> {
  return actionResult(async () => {
    const user = await requireAction('GL_PERIOD_CREATE');
    const periods = await gl.createFiscalYear(user, Number(noOfPeriods) || 12);
    revalidatePath('/accounting/periods');
    revalidatePath('/accounting/close-income-statement');
    return periods;
  });
}

/* ------------------------------------------------------ close income statement */

export async function closeIncomeStatementContextRequest() {
  return actionResult(async () => {
    await requireAction('GL_READ');
    return getCloseIncomeStatementContext();
  });
}

export async function listClosingRunsRequest(fiscalYearEndDate: string) {
  return actionResult(async () => {
    await requireAction('GL_READ');
    return listClosingRuns(fiscalYearEndDate);
  });
}

export async function previewCloseIncomeStatementRequest(input: CloseIncomeStatementInput) {
  return actionResult(async () => {
    await requireAction('GL_CLOSE_INCOME_STATEMENT');
    return previewCloseIncomeStatement(input);
  });
}

export async function postCloseIncomeStatementRequest(input: CloseIncomeStatementInput) {
  return actionResult(async () => {
    const user = await requireAction('GL_CLOSE_INCOME_STATEMENT');
    const journal = await postCloseIncomeStatement(input, user);
    revalidatePath('/accounting');
    revalidatePath('/accounting/close-income-statement');
    revalidatePath('/accounting/journals');
    revalidatePath('/accounting/trial-balance');
    return journal;
  });
}

/**
 * Business Central's "Indent Chart of Accounts" action — restamps every account's indentation
 * from its Begin-Total / End-Total bracketing and fills in each End-Total's Totaling range.
 */
export async function indentChartOfAccountsRequest(): Promise<ActionResult<gl.IndentChartResult>> {
  return actionResult(async () => {
    const user = await requireAction('GL_ACCOUNT_MANAGE');
    const result = await gl.indentChartOfAccounts(user);
    revalidatePath('/accounting/accounts');
    return result;
  });
}
