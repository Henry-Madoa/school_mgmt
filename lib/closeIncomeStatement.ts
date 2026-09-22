/*
 * Close Income Statement — Business Central's batch job of the same name (Report 94), the
 * year-end step that empties every income-statement account into retained earnings.
 *
 * How BC does it, and how that maps here:
 *
 *   1. The fiscal year must already be closed (Accounting Periods → Close Year). Same rule:
 *      lib/gl.ts closeFiscalYear() marks the year's periods fiscally_closed, and previewing or
 *      posting for any other year-end is refused with BC's own message.
 *   2. For every posting account whose Income/Balance is Income Statement (INCOME / EXPENSE
 *      here), BC takes the net change over the fiscal year — *including* any closing entries
 *      already posted on its closing date — and writes a journal line for the opposite amount,
 *      so the account ends the year at zero. Because earlier closing entries are counted, running
 *      the job a second time (after late postings into a closed year) transfers only what has
 *      changed since, which is exactly what BC tells you to do.
 *   3. The lines are dated the year's closing date — "C31/12/2025" in BC, a date that sits after
 *      the last day of the year and before the first day of the next. lib/accounting.ts models
 *      it as the last day plus a closing_entry flag; every date-bounded G/L query reads the flag
 *      (journalDateWindowSql), so the year's P&L still shows its income and the next year's
 *      opening balance sheet shows the income accounts at zero.
 *   4. Close by dimensions: with a dimension ticked, the net change is taken per dimension value
 *      and each line carries it, so retained earnings can still be analysed by branch / fund.
 *   5. Post to Retained Earnings Acc. — "Balance" writes one retained-earnings line per dimension
 *      combination for the net result; "Details" writes one per closed account, so the retained
 *      earnings ledger shows where the result came from.
 *   6. BC leaves the lines in a general journal batch for the user to review and post. The
 *      review is the Preview step on the screen; Post writes them through postJournal in one
 *      transaction, flagged as closing entries so a period closed against postings does not
 *      refuse them (BC posts into closed fiscal years too).
 *
 * BC's "Inventory Period Closed" confirmation and Business Unit consolidation are not modelled:
 * there are no inventory periods here, and no consolidation.
 */
import { one, all, tx, audit } from './db.ts';
import { AppError } from './errors.ts';
import { postJournal } from './accounting.ts';
import { findFiscalYearEnding, listFiscalYears, type FiscalYear } from './gl.ts';
import { getDimensionCaptions } from './org.ts';
import type { Actor, Cents, GlAccount, IsoDate, JournalLineInput, PostedJournal } from './types.ts';
import { CLOSE_INCOME_STATEMENT_DESCRIPTION } from './workflowConstants.ts';

/** BC's default Posting Description on the batch job. */
export const DEFAULT_POSTING_DESCRIPTION = CLOSE_INCOME_STATEMENT_DESCRIPTION;

export interface CloseIncomeStatementInput {
  /** The last day of the fiscal year being closed. */
  fiscalYearEndDate: IsoDate;
  /** BC "Document No." — lands on the journal's reference. */
  documentNo: string;
  /** BC "Retained Earnings Acc." — must be a posting balance-sheet account. */
  retainedEarningsAccountCode: string;
  postingDescription?: string | null;
  /** BC "Close by → Dimensions": take the net change per Global Dimension 1 / 2 value. */
  closeByDimension1?: boolean;
  closeByDimension2?: boolean;
  /** BC "Post to Retained Earnings Acc.": one line for the balance, or one per closed account. */
  postToRetainedEarnings: 'Balance' | 'Details';
}

export interface ClosingLine {
  accountCode: string;
  accountName: string;
  accountType: 'INCOME' | 'EXPENSE' | 'RETAINED';
  globalDimension1Id: number | null;
  globalDimension1Code: string | null;
  globalDimension2Id: number | null;
  globalDimension2Code: string | null;
  /** Net change over the year (credit-positive) that the line reverses — for the closed accounts. */
  netChange: Cents;
  debit: Cents;
  credit: Cents;
}

export interface CloseIncomeStatementPreview {
  fiscalYear: { startDate: IsoDate; endDate: IsoDate };
  postingDate: IsoDate;
  lines: ClosingLine[];
  totals: { debit: Cents; credit: Cents; income: Cents; expense: Cents; result: Cents };
  /** BC's messages that do not block the run but that the user should read first. */
  warnings: string[];
  /** Nothing left to transfer — every income statement account already stands at zero. */
  nothingToClose: boolean;
}

/** One earlier closing run for a year — the screen's history list. */
export interface ClosingRun {
  journalId: number;
  journalNo: string;
  reference: string | null;
  description: string | null;
  postedAt: string;
  postedBy: string | null;
  amount: Cents;
  reversed: boolean;
}

export interface CloseIncomeStatementContext {
  /** Fiscal years with a defined last day, oldest first, with whether each is closed. */
  fiscalYears: { startDate: IsoDate; endDate: IsoDate; closed: boolean; hasOpenResult: boolean }[];
  /** The year BC defaults to: the latest closed one. */
  defaultFiscalYearEndDate: IsoDate | null;
  /** Posting balance-sheet accounts the retained earnings line may go to. */
  balanceSheetAccounts: { code: string; name: string; type: string }[];
  /** The retained earnings account used on the most recent run, if any. */
  lastRetainedEarningsAccountCode: string | null;
  dimensionCaptions: { caption1: string; caption2: string };
}

/* --------------------------------------------------------------------- context */

export async function getCloseIncomeStatementContext(): Promise<CloseIncomeStatementContext> {
  const years = (await listFiscalYears()).filter((y): y is FiscalYear & { endDate: IsoDate } => y.complete && !!y.endDate);
  const fiscalYears = [];
  for (const y of years) {
    fiscalYears.push({
      startDate: y.startDate, endDate: y.endDate, closed: y.closed,
      hasOpenResult: y.closed ? (await incomeStatementNetChange(y.startDate, y.endDate, false, false)).some((r) => r.net !== 0) : false,
    });
  }
  const closedYears = fiscalYears.filter((y) => y.closed);
  const [accounts, last, captions] = await Promise.all([
    all<{ code: string; name: string; type: string }>(
      `SELECT code, name, type FROM gl_account
       WHERE is_postable = 1 AND status = 'ACTIVE' AND type IN ('ASSET','LIABILITY','EQUITY')
       ORDER BY code`,
    ),
    one<{ code: string }>(
      `SELECT a.code FROM journal j
       JOIN journal_line jl ON jl.journal_id = j.id
       JOIN gl_account a ON a.id = jl.gl_account_id
       WHERE j.event_type = 'CLOSE_INCOME_STATEMENT' AND a.type IN ('ASSET','LIABILITY','EQUITY')
       ORDER BY j.id DESC LIMIT 1`,
    ),
    getDimensionCaptions(),
  ]);
  return {
    fiscalYears,
    defaultFiscalYearEndDate: closedYears.length ? closedYears[closedYears.length - 1].endDate : null,
    balanceSheetAccounts: accounts,
    lastRetainedEarningsAccountCode: last?.code ?? null,
    dimensionCaptions: captions,
  };
}

/** Closing journals already posted for the year ending `endDate`, newest first. */
export const listClosingRuns = (endDate: IsoDate): Promise<ClosingRun[]> =>
  all<ClosingRun>(
    `SELECT j.id AS "journalId", j.journal_no AS "journalNo", j.reference, j.description,
            j.posted_at AS "postedAt", j.posted_by AS "postedBy", j.amount,
            CASE WHEN j.reversed_by_id IS NULL THEN false ELSE true END AS reversed
     FROM journal j
     WHERE j.event_type = 'CLOSE_INCOME_STATEMENT' AND j.value_date = ? AND j.closing_entry = 1
     ORDER BY j.id DESC`,
    endDate,
  );

/* --------------------------------------------------------------------- engine */

interface NetChangeRow {
  account_id: number; code: string; name: string; type: 'INCOME' | 'EXPENSE';
  gd1: number | null; gd1_code: string | null; gd2: number | null; gd2_code: string | null;
  /** Credit-positive net change over the window, closing entries on the last day included. */
  net: Cents;
}

/**
 * Net change of every income statement account over the fiscal year, per dimension value when
 * asked. The window is inclusive of the year's last day *with* its closing entries — BC's
 * "startDate..C endDate" — so a second run after late postings yields only the difference.
 */
async function incomeStatementNetChange(
  startDate: IsoDate, endDate: IsoDate, byDim1: boolean, byDim2: boolean,
): Promise<NetChangeRow[]> {
  const gd1 = byDim1 ? 'jl.global_dimension_1_id' : 'NULL::int';
  const gd2 = byDim2 ? 'jl.global_dimension_2_id' : 'NULL::int';
  return all<NetChangeRow>(
    `SELECT a.id AS account_id, a.code, a.name, a.type,
            ${gd1} AS gd1, ${byDim1 ? 'MAX(d1.code)' : 'NULL'} AS gd1_code,
            ${gd2} AS gd2, ${byDim2 ? 'MAX(d2.code)' : 'NULL'} AS gd2_code,
            COALESCE(SUM(jl.credit_lcy - jl.debit_lcy), 0) AS net
     FROM gl_account a
     JOIN journal_line jl ON jl.gl_account_id = a.id
     JOIN journal j ON j.id = jl.journal_id
     LEFT JOIN global_dimension_1_value d1 ON d1.id = jl.global_dimension_1_id
     LEFT JOIN global_dimension_2_value d2 ON d2.id = jl.global_dimension_2_id
     WHERE a.type IN ('INCOME','EXPENSE') AND a.is_postable = 1
       AND j.value_date >= @start AND j.value_date <= @end
     GROUP BY a.id, a.code, a.name, a.type, ${gd1}, ${gd2}
     HAVING COALESCE(SUM(jl.credit_lcy - jl.debit_lcy), 0) <> 0
     ORDER BY a.code, ${gd1}, ${gd2}`,
    { start: startDate, end: endDate },
  );
}

async function assertClosableYear(endDate: IsoDate): Promise<FiscalYear & { endDate: IsoDate }> {
  const year = await findFiscalYearEnding(endDate);
  if (!year || !year.endDate) {
    throw new AppError(`${endDate} is not the last day of a fiscal year on the Accounting Periods`, 'VALIDATION');
  }
  // BC: "The fiscal year must be closed before the income statement can be closed."
  if (!year.closed) {
    throw new AppError('The fiscal year must be closed before the income statement can be closed', 'VALIDATION');
  }
  return year as FiscalYear & { endDate: IsoDate };
}

async function resolveRetainedEarnings(code: string): Promise<GlAccount> {
  const acct = await one<GlAccount>('SELECT * FROM gl_account WHERE code = ?', code.trim());
  if (!acct) throw new AppError('Retained earnings account not found', 'VALIDATION');
  if (!acct.is_postable || acct.status !== 'ACTIVE') {
    throw new AppError(`Retained earnings account ${acct.code} must be an active posting account`, 'VALIDATION');
  }
  // BC: the Retained Earnings Acc. must be a Balance Sheet account.
  if (acct.type === 'INCOME' || acct.type === 'EXPENSE') {
    throw new AppError(`Retained earnings account ${acct.code} must be a balance sheet account, not an income statement account`, 'VALIDATION');
  }
  return acct;
}

/**
 * Everything the run would post, without posting it — the review BC gives you in the journal
 * batch. The same builder feeds postCloseIncomeStatement, so what is previewed is what posts.
 */
export async function previewCloseIncomeStatement(input: CloseIncomeStatementInput): Promise<CloseIncomeStatementPreview> {
  const year = await assertClosableYear(input.fiscalYearEndDate);
  const retained = await resolveRetainedEarnings(input.retainedEarningsAccountCode);
  if (!input.documentNo?.trim()) throw new AppError('A document no. is required', 'VALIDATION');

  const rows = await incomeStatementNetChange(year.startDate, year.endDate, !!input.closeByDimension1, !!input.closeByDimension2);

  // A closed account's line reverses its net change: an income account (credit balance) is
  // debited, an expense account (debit balance) is credited.
  const lines: ClosingLine[] = rows.map((r) => ({
    accountCode: r.code, accountName: r.name, accountType: r.type,
    globalDimension1Id: r.gd1, globalDimension1Code: r.gd1_code,
    globalDimension2Id: r.gd2, globalDimension2Code: r.gd2_code,
    netChange: r.net,
    debit: r.net > 0 ? r.net : 0,
    credit: r.net < 0 ? -r.net : 0,
  }));

  // Retained earnings takes the other side. "Details": one line per closed account, so the
  // retained earnings ledger reads like the P&L. "Balance": one per dimension combination.
  const retainedLines: ClosingLine[] = [];
  const retainedLine = (net: Cents, gd1: number | null, gd1c: string | null, gd2: number | null, gd2c: string | null): ClosingLine => ({
    accountCode: retained.code, accountName: retained.name, accountType: 'RETAINED',
    globalDimension1Id: gd1, globalDimension1Code: gd1c, globalDimension2Id: gd2, globalDimension2Code: gd2c,
    netChange: net,
    debit: net < 0 ? -net : 0,
    credit: net > 0 ? net : 0,
  });
  if (input.postToRetainedEarnings === 'Details') {
    for (const l of lines) {
      retainedLines.push(retainedLine(l.netChange, l.globalDimension1Id, l.globalDimension1Code, l.globalDimension2Id, l.globalDimension2Code));
    }
  } else {
    const byCombo = new Map<string, ClosingLine>();
    for (const l of lines) {
      const key = `${l.globalDimension1Id ?? ''}|${l.globalDimension2Id ?? ''}`;
      const existing = byCombo.get(key);
      const net = (existing?.netChange ?? 0) + l.netChange;
      byCombo.set(key, retainedLine(net, l.globalDimension1Id, l.globalDimension1Code, l.globalDimension2Id, l.globalDimension2Code));
    }
    for (const l of byCombo.values()) if (l.netChange !== 0) retainedLines.push(l);
  }

  const income = lines.filter((l) => l.accountType === 'INCOME').reduce((s, l) => s + l.netChange, 0);
  const expense = lines.filter((l) => l.accountType === 'EXPENSE').reduce((s, l) => s + l.netChange, 0);
  const allLines = [...lines, ...retainedLines];
  const totals = {
    debit: allLines.reduce((s, l) => s + l.debit, 0),
    credit: allLines.reduce((s, l) => s + l.credit, 0),
    income, expense: -expense, result: income + expense,
  };

  const warnings: string[] = [];
  // BC warns when an earlier fiscal year has never had its income statement closed: its result
  // would otherwise still be sitting in the income accounts when this year's opening balance
  // is read.
  for (const earlier of (await listFiscalYears()).filter((y) => y.complete && y.endDate && y.endDate < year.endDate!)) {
    const open = await incomeStatementNetChange(earlier.startDate, earlier.endDate!, false, false);
    if (open.length) {
      warnings.push(`The income statement for the fiscal year ending ${earlier.endDate} has not been closed — its result is still in the income accounts. Close that year first so each year's result is transferred on its own closing date.`);
    }
  }
  const previous = await listClosingRuns(year.endDate);
  if (previous.some((p) => !p.reversed)) {
    warnings.push(`This year was closed before (${previous.filter((p) => !p.reversed).map((p) => p.journalNo).join(', ')}); only what has been posted into the year since then will be transferred now.`);
  }

  return {
    fiscalYear: { startDate: year.startDate, endDate: year.endDate },
    postingDate: year.endDate,
    lines: allLines,
    totals,
    warnings,
    nothingToClose: lines.length === 0,
  };
}

/**
 * Posts the closing entries — one journal, dated the closing date, flagged closing_entry. The
 * amounts are rebuilt here rather than taken from the client, so a stale preview cannot post
 * figures the ledger has moved on from.
 */
export async function postCloseIncomeStatement(input: CloseIncomeStatementInput, user: Actor): Promise<PostedJournal & { lineCount: number }> {
  return tx(async () => {
    const preview = await previewCloseIncomeStatement(input);
    if (preview.nothingToClose) {
      throw new AppError('There is nothing to close: every income statement account already stands at zero for this fiscal year', 'VALIDATION');
    }
    const description = input.postingDescription?.trim() || DEFAULT_POSTING_DESCRIPTION;
    const lines: JournalLineInput[] = preview.lines.map((l) => ({
      account: l.accountCode,
      debit: l.debit,
      credit: l.credit,
      narration: description,
      globalDimension1Id: l.globalDimension1Id,
      globalDimension2Id: l.globalDimension2Id,
    }));
    const journal = await postJournal({
      valueDate: preview.postingDate,
      closingEntry: true,
      module: 'GL',
      eventType: 'CLOSE_INCOME_STATEMENT',
      description,
      reference: input.documentNo.trim(),
      lines,
      user,
    });
    await audit(user, 'CLOSE_INCOME_STATEMENT', 'journal', journal.id, {
      fiscalYearEndDate: preview.fiscalYear.endDate,
      retainedEarningsAccount: input.retainedEarningsAccountCode,
      postToRetainedEarnings: input.postToRetainedEarnings,
      closeByDimension1: !!input.closeByDimension1,
      closeByDimension2: !!input.closeByDimension2,
      result: preview.totals.result,
      lines: lines.length,
    });
    return { ...journal, lineCount: lines.length };
  });
}
