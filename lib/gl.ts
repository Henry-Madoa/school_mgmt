import {
  one, all, run, nextSequence, audit, hasAnyRow,
} from './db.ts';
import { AppError } from './errors.ts';
import { trialBalance, postJournal, reverseJournal, journalDateWindowSql } from './accounting.ts';
import { GL_ACCOUNT_TYPES, GL_ACCOUNT_STRUCTURE_TYPES, PRODUCT_STATUSES } from './constants.ts';
import { diffFields, logTableChange } from './changeLog.ts';
import { findMatchingWorkflow, startWorkflow } from './workflow.ts';
import { buildFilterClause, type FilterCondition, type FilterFieldDef } from './listFilters.ts';
import { buildOrderClause, type SortState } from './listSort.ts';
import { addDaysIso } from './format.ts';
import type {
  AccountingPeriod, Actor, BankAccount, BankAccountListRow, BankAccountLedgerEntryWithJournal,
  BankReconciliation, BankReconciliationWorksheet, Cents, GlAccount, GlAccountStructureType,
  GlAccountType, IsoDate, Journal, JournalLineInput, JournalLineWithAccount, JournalListRow,
  JournalRelatedEntries, LedgerLine, PostedJournal, TrialBalanceRow,
} from './types.ts';

export interface TrialBalanceReport {
  rows: TrialBalanceRow[];
  totals: { debit: Cents; credit: Cents };
  balanced: boolean;
}

/** Global Dimension 1/2 filters shared by the Chart of Accounts and Trial Balance screens —
 *  both narrow through journal_line's own per-line dimensions (as opposed to Journals'
 *  header-level j.global_dimension_1/2_id above). Options ship empty; the page fills them
 *  in from listActiveDimensionValues(). Reused as-is by getAccountLedger()'s drill-down so
 *  a filtered balance and the ledger entries behind it always agree. */
export const GL_DIMENSION_FILTER_FIELDS: FilterFieldDef[] = [
  { key: 'global_dimension_1_id', label: 'Global Dimension 1', type: 'select', column: 'jl.global_dimension_1_id' },
  { key: 'global_dimension_2_id', label: 'Global Dimension 2', type: 'select', column: 'jl.global_dimension_2_id' },
];

/** Trial balance's dynamic-filter registry — the account columns (a.code/a.name/a.type, safe
 *  to test in the WHERE clause ahead of the LEFT JOIN aggregation — see trialBalance()'s own
 *  TrialBalanceOptions doc) plus the Dimensional Trial Balance's own Global Dimension filter:
 *  a free-text Business-Central "Filter Totals by" expression (matchesTotaling's `|`/`..`
 *  syntax against each dimension's code, e.g. "NBI" or "NBI|HQ"), added to and removed from
 *  the same filter bar as Code/Name/Type — not the single-exact-value select
 *  GL_DIMENSION_FILTER_FIELDS uses elsewhere. The page fills in each dimension field's label
 *  from the org's own caption. */
export const TRIAL_BALANCE_FILTER_FIELDS: FilterFieldDef[] = [
  { key: 'code', label: 'Code', type: 'text', column: 'a.code' },
  { key: 'name', label: 'Account Name', type: 'text', column: 'a.name' },
  { key: 'type', label: 'Type', type: 'select', column: 'a.type', options: GL_ACCOUNT_TYPES.map((t) => ({ value: t, label: t })) },
];

export const TRIAL_BALANCE_DIMENSION_FILTER_FIELDS: FilterFieldDef[] = [
  { key: 'gd1_filter', label: 'Global Dimension 1' },
  { key: 'gd2_filter', label: 'Global Dimension 2' },
].map((f) => ({ ...f, type: 'text' as const }));

/** Pulls one field's raw value straight out of a FilterCondition[] — for a field handled
 *  outside buildFilterClause's plain column-comparison model (TRIAL_BALANCE_DIMENSION_FILTER_
 *  FIELDS' own combination/range expression, resolved via resolveDimensionFilterIds instead of
 *  a SQL operator). `!=` marks the match set for exclusion rather than inclusion. */
function textFilterValue(filters: FilterCondition[], field: string): { value: string; exclude: boolean } | null {
  const c = filters.find((f) => f.field === field && f.value !== '');
  return c ? { value: c.value, exclude: c.operator === '!=' } : null;
}

/** Builds the journal-join-scoped Global Dimension clause shared by getTrialBalance() and
 *  getAccountLedger(): the Chart of Accounts' own exact-id condition (GL_DIMENSION_FILTER_
 *  FIELDS, carried through `filters` unchanged so a balance stays consistent with whichever
 *  screen computed it) plus the Dimensional Trial Balance's own code-expression one
 *  (TRIAL_BALANCE_DIMENSION_FILTER_FIELDS, also read out of the same `filters` array). */
export async function buildDimensionJoinClause(
  filters: FilterCondition[], paramPrefix: string,
): Promise<{ clause: string; params: Record<string, unknown> }> {
  const { clause: gdIdClause, params } = buildFilterClause(GL_DIMENSION_FILTER_FIELDS, filters, paramPrefix);
  const gd1 = textFilterValue(filters, 'gd1_filter');
  const gd2 = textFilterValue(filters, 'gd2_filter');
  const [gd1Ids, gd2Ids] = await Promise.all([
    gd1 ? resolveDimensionFilterIds(1, gd1.value) : Promise.resolve(null),
    gd2 ? resolveDimensionFilterIds(2, gd2.value) : Promise.resolve(null),
  ]);
  const parts = [gdIdClause];
  if (gd1Ids !== null) {
    parts.push(`AND ${gd1!.exclude ? 'NOT ' : ''}(jl.global_dimension_1_id = ANY(@${paramPrefix}gd1Ids))`);
    params[`${paramPrefix}gd1Ids`] = gd1Ids;
  }
  if (gd2Ids !== null) {
    parts.push(`AND ${gd2!.exclude ? 'NOT ' : ''}(jl.global_dimension_2_id = ANY(@${paramPrefix}gd2Ids))`);
    params[`${paramPrefix}gd2Ids`] = gd2Ids;
  }
  return { clause: parts.filter(Boolean).join(' '), params };
}

export interface GetTrialBalanceOptions {
  /** Only sum activity on/after this date — see TrialBalanceOptions.from. */
  from?: IsoDate | null;
  asOf?: IsoDate | null;
  /** Every dynamic filter row from the Trial Balance's own filter bar — Code/Name/Type
   *  (TRIAL_BALANCE_FILTER_FIELDS) and the Dimensional filter
   *  (TRIAL_BALANCE_DIMENSION_FILTER_FIELDS) together, plus whatever exact-id Global Dimension
   *  condition Chart of Accounts' own filter bar passes through unchanged. */
  filters?: FilterCondition[];
}

/** Trial balance plus the totals and the in-balance assertion the screen shows. */
export async function getTrialBalance({ from, asOf, filters = [] }: GetTrialBalanceOptions = {}): Promise<TrialBalanceReport> {
  const { clause: whereClause, params: whereParams } = buildFilterClause(TRIAL_BALANCE_FILTER_FIELDS, filters, 'tb');
  const { clause: joinClause, params: joinParams } = await buildDimensionJoinClause(filters, 'tbgd');

  const rows = await trialBalance({
    from, asOf, whereClause, whereParams, joinClause, joinParams,
  });
  const totals = rows.reduce(
    (a, r) => ({ debit: a.debit + r.debit_balance, credit: a.credit + r.credit_balance }),
    { debit: 0, credit: 0 },
  );
  return { rows, totals, balanced: totals.debit === totals.credit };
}

/** Journals list's dynamic-filter registry — every meaningful column. Global dimension fields
 *  ship without `options` since they're DB-driven; the page fills them in. Excludes purely
 *  internal columns (id, reverses_id/reversed_by_id — raw
 *  ids with no friendly picker, idempotency_key — a technical dedupe token). */
export const JOURNAL_FILTER_FIELDS: FilterFieldDef[] = [
  { key: 'journal_no', label: 'Journal No.', type: 'text', column: 'j.journal_no' },
  { key: 'value_date', label: 'Value Date', type: 'date', column: 'j.value_date' },
  { key: 'posted_at', label: 'Posted At', type: 'date', column: 'j.posted_at', datetime: true },
  { key: 'source_module', label: 'Source', type: 'text', column: 'j.source_module' },
  { key: 'event_type', label: 'Event', type: 'text', column: 'j.event_type' },
  { key: 'description', label: 'Description', type: 'text', column: 'j.description' },
  { key: 'reference', label: 'Reference', type: 'text', column: 'j.reference' },
  { key: 'amount', label: 'Amount', type: 'number', column: 'j.amount' },
  { key: 'posted_by', label: 'Posted By', type: 'text', column: 'j.posted_by' },
  { key: 'global_dimension_1_id', label: 'Global Dimension 1', type: 'select', column: 'j.global_dimension_1_id' },
  { key: 'global_dimension_2_id', label: 'Global Dimension 2', type: 'select', column: 'j.global_dimension_2_id' },
];

/** Journals list's sortable columns — every column shown in the table. */
const JOURNAL_SORT_COLUMNS: Record<string, string> = {
  journal_no: 'j.journal_no',
  reference: 'j.reference',
  value_date: 'j.value_date',
  source_module: 'j.source_module',
  event_type: 'j.event_type',
  description: 'j.description',
  gd1: 'gd1.code',
  gd2: 'gd2.code',
  amount: 'j.amount',
  posted_by: 'j.posted_by',
};

export interface ListJournalsOptions {
  search?: string;
  filters?: FilterCondition[];
  sort?: SortState | null;
}

export function listJournals({ search = '', filters = [], sort = null }: ListJournalsOptions = {}): Promise<JournalListRow[]> {
  const { clause, params } = buildFilterClause(JOURNAL_FILTER_FIELDS, filters);
  const orderBy = buildOrderClause(JOURNAL_SORT_COLUMNS, sort, 'j.id DESC');
  return all<JournalListRow>(
    `SELECT j.*,
            gd1.code AS global_dimension_1_code, gd2.code AS global_dimension_2_code
     FROM journal j
     LEFT JOIN global_dimension_1_value gd1 ON gd1.id = j.global_dimension_1_id
     LEFT JOIN global_dimension_2_value gd2 ON gd2.id = j.global_dimension_2_id
     WHERE (j.journal_no ILIKE @like OR j.description ILIKE @like OR j.reference ILIKE @like)
       ${clause}
     ${orderBy} LIMIT 200`,
    { like: `%${String(search).trim()}%`, ...params },
  );
}

/** Whether any journal exists at all, ignoring search and dynamic filters — lets the page grey
 *  out its filter controls only when there's truly nothing to filter. */
export const hasAnyJournals = (): Promise<boolean> => hasAnyRow('journal j');

export interface JournalDetail {
  journal: Journal;
  lines: JournalLineWithAccount[];
}

export async function getJournal(id: number): Promise<JournalDetail | null> {
  const journal = await one<Journal>('SELECT * FROM journal WHERE id = ?', id);
  if (!journal) return null;
  return {
    journal,
    lines: await all<JournalLineWithAccount>(
      `SELECT jl.*, a.code, a.name, a.type,
              gd1.code AS global_dimension_1_code, gd2.code AS global_dimension_2_code
       FROM journal_line jl
       JOIN gl_account a ON a.id = jl.gl_account_id
       LEFT JOIN global_dimension_1_value gd1 ON gd1.id = jl.global_dimension_1_id
       LEFT JOIN global_dimension_2_value gd2 ON gd2.id = jl.global_dimension_2_id
       WHERE jl.journal_id = ? ORDER BY jl.line_no`,
      id,
    ),
  };
}

export interface CreateJournalInput {
  valueDate?: IsoDate;
  description?: string;
  lines: JournalLineInput[];
}

/** Business-Central-style guard: a G/L account flagged no_direct_posting is controlled by a
 *  subledger (Bank, the receivables control account, the payables control
 *  account) and must be posted through it instead — deposit/withdraw, disburse/repay, or a
 *  Bank Reconciliation, all of which still post through postJournal() directly and are
 *  unaffected by this check. Manual-journal-only, so it belongs here rather than in
 *  postJournal() itself. */
async function assertNoDirectPosting(lines: { account: number | string }[]): Promise<void> {
  for (const l of lines) {
    const acct = typeof l.account === 'number'
      ? await one<{ code: string; no_direct_posting: number }>(
        'SELECT code, no_direct_posting FROM gl_account WHERE id = ?', l.account,
      )
      : await one<{ code: string; no_direct_posting: number }>(
        'SELECT code, no_direct_posting FROM gl_account WHERE code = ?', String(l.account),
      );
    if (acct?.no_direct_posting) {
      throw new AppError(
        `Account ${acct.code} is controlled by a subledger — post through Receivables, Payables, Cash Management or Bank Reconciliation instead of a manual journal`,
        'VALIDATION',
      );
    }
  }
}

/** The actual posting — shared by an immediate manual entry and a workflow's finalize step. */
export async function postManualJournal(input: CreateJournalInput, user: Actor): Promise<PostedJournal> {
  const clean = (input.lines || [])
    .map((l) => ({
      account: l.account,
      debit: Math.round(Number(l.debit) || 0),
      credit: Math.round(Number(l.credit) || 0),
      narration: l.narration || null,
      globalDimension1Id: l.globalDimension1Id ?? null,
      globalDimension2Id: l.globalDimension2Id ?? null,
    }))
    .filter((l) => l.account && (l.debit || l.credit));
  if (clean.length < 2) throw new AppError('A journal needs at least two lines', 'NO_LINES');
  await assertNoDirectPosting(clean);

  const j = await postJournal({
    valueDate: input.valueDate || new Date().toISOString().slice(0, 10),
    module: 'GL',
    eventType: 'MANUAL',
    description: input.description,
    lines: clean,
    user,
  });
  await audit(user, 'GL_JOURNAL_CREATE', 'journal', j.id, { amount: j.amount });
  return j;
}

export type CreateJournalResult =
  | { posted: true; journal: PostedJournal }
  | { posted: false; taskId: number };

/**
 * Entry point for the manual-entry screen: posts immediately unless an
 * admin-defined workflow matches, in which case the journal is held as a
 * pending task's payload and only actually posted once every step approves.
 */
export async function createJournal(input: CreateJournalInput, user: Actor): Promise<CreateJournalResult> {
  const amount = (input.lines || []).reduce((a, l) => a + Math.round(Number(l.debit) || 0), 0);
  const gd1 = input.lines?.find((l) => l.globalDimension1Id != null)?.globalDimension1Id ?? null;
  const gd2 = input.lines?.find((l) => l.globalDimension2Id != null)?.globalDimension2Id ?? null;

  // Keys here must match RUNTIME_FIELD_CAP.JOURNAL (lib/workflow.ts) — that cap is what stops
  // an admin from enabling a Table Relation field here that would never actually match.
  const matched = await findMatchingWorkflow('JOURNAL', {
    amount, global_dimension_1_id: gd1, global_dimension_2_id: gd2,
  });
  if (!matched) {
    return { posted: true, journal: await postManualJournal(input, user) };
  }

  // No journal exists yet to key the task on — mint a draft reference instead.
  const draftNo = await nextSequence('JOURNAL_DRAFT');
  const taskId = await startWorkflow(matched.workflow, matched.steps, {
    documentType: 'JOURNAL', entityId: draftNo, requestedBy: user.username, amount,
    payload: JSON.stringify(input),
  });
  await audit(user, 'GL_JOURNAL_SUBMIT', 'workflow_task', taskId, { amount, draftNo });
  return { posted: false, taskId };
}

export async function reverseJournalEntry(id: number, reason: string, user: Actor): Promise<PostedJournal> {
  if (!reason) throw new AppError('A reversal reason is required', 'REASON_REQUIRED');
  // The per-user "Can Reverse Journal" grant (on top of the role-based GL_JOURNAL_REVERSE
  // permission the caller already checked) is enforced centrally inside reverseJournal() —
  // see lib/accounting.ts — so every reversal path honours it, not just this one.
  const rev = await reverseJournal(Number(id), user, reason);
  await audit(user, 'GL_JOURNAL_REVERSE', 'journal', id, { reason });
  return rev;
}

export interface AccountLedger {
  account: GlAccount;
  lines: LedgerLine[];
  balance: Cents;
}

export interface AccountLedgerOptions {
  from?: IsoDate | null;
  asOf?: IsoDate | null;
  /** Same `filters` array as GetTrialBalanceOptions — both the Chart of Accounts' exact-id
   *  Global Dimension condition and the Trial Balance's own Dimensional expression (read out of
   *  it the same way, via TRIAL_BALANCE_DIMENSION_FILTER_FIELDS' field keys), so a drill-down
   *  opened from either screen reconciles to the exact figure clicked. */
  filters?: FilterCondition[];
}

/** Drives the Chart of Accounts / Trial Balance balance drill-down. Applies the same date range
 *  and Global Dimension filters (both the Chart of Accounts' exact-id one and the Trial
 *  Balance's own combination/range expression) as the balance being drilled into, so the ledger
 *  entries shown always reconcile to the figure the user clicked rather than the account's
 *  unfiltered lifetime balance. */
export async function getAccountLedger(
  code: string, { from, asOf, filters = [] }: AccountLedgerOptions = {},
): Promise<AccountLedger | null> {
  const account = await one<GlAccount>('SELECT * FROM gl_account WHERE code = ?', code);
  if (!account) return null;

  const { clause: gdClause, params: dimParams } = await buildDimensionJoinClause(filters, 'lgd');
  const params = { id: account.id, asOf: asOf || null, from: from || null, ...dimParams };

  const [lines, tb] = await Promise.all([
    // No LIMIT here: this is a reconciliation view (its whole job is to add up to the exact
    // balance the user clicked), so a hard cap that silently truncates the oldest end of a busy
    // account's history — while trialBalance() below still sums every line — was actively
    // wrong: the listed entries stopped reconciling to the balance shown once an account passed
    // the cap. Find Entries + sorting above make an unbounded list workable to browse.
    all<LedgerLine>(
      `SELECT jl.*, j.journal_no, j.reference, j.value_date, j.closing_entry, j.description, j.source_module,
              gd1.code AS global_dimension_1_code, gd2.code AS global_dimension_2_code
       FROM journal_line jl JOIN journal j ON j.id = jl.journal_id
       LEFT JOIN global_dimension_1_value gd1 ON gd1.id = jl.global_dimension_1_id
       LEFT JOIN global_dimension_2_value gd2 ON gd2.id = jl.global_dimension_2_id
       WHERE jl.gl_account_id = @id
         ${journalDateWindowSql('j')}
         ${gdClause}
       -- A closing entry sorts after every ordinary entry of its date (the "C" closing date).
       ORDER BY j.value_date, j.closing_entry, j.id`,
      params,
    ),
    trialBalance({
      from, asOf, whereClause: 'AND a.code = @lgcode', whereParams: { lgcode: code },
      joinClause: gdClause, joinParams: dimParams,
    }),
  ]);
  return { account, lines, balance: tb[0]?.net ?? 0 };
}

/** Chart of accounts list's dynamic-filter registry — every meaningful column (id is excluded
 *  as purely internal). */
export const GL_ACCOUNT_FILTER_FIELDS: FilterFieldDef[] = [
  { key: 'code', label: 'Code', type: 'text' },
  { key: 'name', label: 'Account Name', type: 'text' },
  { key: 'type', label: 'Type', type: 'select', options: GL_ACCOUNT_TYPES.map((t) => ({ value: t, label: t })) },
  { key: 'account_type', label: 'Account Type', type: 'select', options: GL_ACCOUNT_STRUCTURE_TYPES },
  { key: 'parent_code', label: 'Parent Code', type: 'text' },
  { key: 'is_postable', label: 'Postable', type: 'select', options: [{ value: 1, label: 'Yes' }, { value: 0, label: 'Header' }] },
  { key: 'balance', label: 'Balance', type: 'number' },
  { key: 'status', label: 'Status', type: 'select', options: PRODUCT_STATUSES.map((s) => ({ value: s, label: s })) },
];

/** Chart of accounts list's sortable columns — every column shown in the table. */
const GL_ACCOUNT_SORT_COLUMNS: Record<string, string> = {
  code: 'code',
  name: 'name',
  type: 'type',
  account_type: 'account_type',
  parent_code: 'parent_code',
  is_postable: 'is_postable',
  balance: 'balance',
  status: 'status',
};

/** Parses a Business Central-style Totaling filter — `|`-separated terms, each a single
 *  account code or a `FROM..TO` inclusive range — and reports whether `code` falls in it. */
export function matchesTotaling(code: string, totaling: string | null | undefined): boolean {
  if (!totaling) return false;
  return totaling.split('|').map((t) => t.trim()).filter(Boolean).some((term) => {
    const [from, to] = term.split('..');
    return code >= from.trim() && code <= (to ?? from).trim();
  });
}

/** Resolves a Business-Central-style dimension filter expression — matchesTotaling's own
 *  `|`-separated codes/ranges syntax, e.g. "NBI|HQ" (either) or "NBI..NKR" (a range) — against
 *  one Global Dimension's master list, into the ids of every value it matches. A Dimensional
 *  Trial Balance filters journal_line.global_dimension_1/2_id by this id list rather than by
 *  code directly, since that's what's actually stored on the posted line. Returns null for a
 *  blank expression (no filter to apply), so the caller can tell "not filtering this dimension"
 *  apart from "filtered to nothing". */
export async function resolveDimensionFilterIds(dimension: 1 | 2, expression: string): Promise<number[] | null> {
  const expr = expression.trim();
  if (!expr) return null;
  const table = dimension === 1 ? 'global_dimension_1_value' : 'global_dimension_2_value';
  const values = await all<{ id: number; code: string }>(`SELECT id, code FROM ${table}`);
  return values.filter((v) => matchesTotaling(v.code, expr)).map((v) => v.id);
}

/** Sums the (already filter-aware) balances of every Posting account a Total/End-Total row's
 *  Totaling range names. Always resolved against Posting accounts specifically — a numeric
 *  range spanning a nested Heading or Total row must not double-count that row's own
 *  (separately rolled-up) figure. */
export function totalingBalance(
  accounts: GlAccount[], balanceByCode: Map<string, Cents>, totaling: string | null | undefined,
): Cents {
  return accounts
    .filter((a) => a.account_type === 'POSTING' && matchesTotaling(a.code, totaling))
    .reduce((sum, a) => sum + (balanceByCode.get(a.code) ?? 0), 0);
}

export interface ListGlAccountsOptions {
  search?: string;
  filters?: FilterCondition[];
  sort?: SortState | null;
}

export const listGlAccounts = (
  { search = '', filters = [], sort = null }: ListGlAccountsOptions = {},
): Promise<GlAccount[]> => {
  const { clause, params } = buildFilterClause(GL_ACCOUNT_FILTER_FIELDS, filters);
  const orderBy = buildOrderClause(GL_ACCOUNT_SORT_COLUMNS, sort, 'code');
  return all<GlAccount>(
    `SELECT * FROM gl_account
     WHERE (code ILIKE @like OR name ILIKE @like)
       ${clause}
     ${orderBy}`,
    { like: `%${String(search).trim()}%`, ...params },
  );
};

/** Whether any GL account exists at all, ignoring search and dynamic filters — lets the Chart
 *  of Accounts and Trial Balance tabs grey out their filter controls only when there's truly
 *  nothing to filter. */
export const hasAnyGlAccounts = (): Promise<boolean> => hasAnyRow('gl_account a');

export const listPostableAccounts = (): Promise<GlAccount[]> =>
  all<GlAccount>("SELECT * FROM gl_account WHERE is_postable = 1 AND status = 'ACTIVE' ORDER BY code");

/** account_type drives is_postable rather than the other way round: only a Posting
 *  account is ever postable, so there is exactly one place this is decided. Totaling
 *  only means anything for Total/End-Total, so it's dropped for every other type
 *  rather than left stale for a later type change to pick back up. */
function normaliseStructure(
  accountType: GlAccountStructureType, totaling: string | null | undefined,
): { isPostable: 0 | 1; totaling: string | null } {
  if (!GL_ACCOUNT_STRUCTURE_TYPES.some((t) => t.value === accountType)) {
    throw new AppError('Invalid account type', 'VALIDATION');
  }
  const needsTotaling = accountType === 'TOTAL' || accountType === 'END_TOTAL';
  if (needsTotaling && !totaling?.trim()) {
    throw new AppError('A Totaling range is required for Total and End-Total accounts', 'VALIDATION');
  }
  return { isPostable: accountType === 'POSTING' ? 1 : 0, totaling: needsTotaling ? totaling!.trim() : null };
}

export interface CreateGlAccountInput {
  code: string;
  name: string;
  type: GlAccountType;
  parent_code?: string | null;
  account_type?: GlAccountStructureType;
  totaling?: string | null;
}

export async function createGlAccount(
  { code, name, type, parent_code = null, account_type = 'POSTING', totaling = null }: CreateGlAccountInput,
  user: Actor,
): Promise<{ id: number }> {
  if (!code || !name || !type) throw new AppError('Code, name and type are required', 'VALIDATION');
  if (!GL_ACCOUNT_TYPES.includes(type)) throw new AppError('Invalid account type', 'VALIDATION');
  const { isPostable, totaling: cleanTotaling } = normaliseStructure(account_type, totaling);
  if (await one('SELECT 1 FROM gl_account WHERE code = ?', code)) {
    throw new AppError('Account code already exists', 'DUPLICATE');
  }
  const info = await run(
    'INSERT INTO gl_account (code, name, type, parent_code, is_postable, account_type, totaling) VALUES (?,?,?,?,?,?,?)',
    code, name, type, parent_code || null, isPostable, account_type, cleanTotaling,
  );
  await audit(user, 'GL_ACCOUNT_CREATE', 'gl_account', info.lastInsertRowid, { code, name, type });
  await logTableChange('gl_account', code, 'Insertion', [
    { field: 'code', oldValue: null, newValue: code },
    { field: 'name', oldValue: null, newValue: name },
    { field: 'type', oldValue: null, newValue: type },
    { field: 'parent_code', oldValue: null, newValue: parent_code || null },
    { field: 'account_type', oldValue: null, newValue: account_type },
    { field: 'totaling', oldValue: null, newValue: cleanTotaling },
  ], user);
  return { id: Number(info.lastInsertRowid) };
}

export interface UpdateGlAccountInput {
  name: string;
  type: GlAccountType;
  parent_code?: string | null;
  account_type?: GlAccountStructureType;
  totaling?: string | null;
  status?: 'ACTIVE' | 'INACTIVE';
}

/** Code is the natural key referenced throughout the ledger and by other admin
 *  screens (products' GL mappings) — it's set at creation and never renamed here. */
export async function updateGlAccount(
  code: string,
  { name, type, parent_code = null, account_type = 'POSTING', totaling = null, status = 'ACTIVE' }: UpdateGlAccountInput,
  user: Actor,
): Promise<GlAccount> {
  const before = await one<GlAccount>('SELECT * FROM gl_account WHERE code = ?', code);
  if (!before) throw new AppError('Account not found', 'NOT_FOUND');
  if (!name || !type) throw new AppError('Name and type are required', 'VALIDATION');
  if (!GL_ACCOUNT_TYPES.includes(type)) throw new AppError('Invalid account type', 'VALIDATION');
  const { isPostable, totaling: cleanTotaling } = normaliseStructure(account_type, totaling);

  if (before.account_type === 'POSTING' && account_type !== 'POSTING') {
    if (await one('SELECT 1 FROM journal_line WHERE gl_account_id = ?', before.id)) {
      throw new AppError('Cannot change a Posting account with ledger entries to a non-Posting type', 'VALIDATION');
    }
  }

  const patch = {
    name, type, parent_code: parent_code || null, is_postable: isPostable,
    account_type, totaling: cleanTotaling, status,
  };
  await run(
    `UPDATE gl_account SET name=?, type=?, parent_code=?, is_postable=?, account_type=?, totaling=?, status=?
     WHERE code=?`,
    patch.name, patch.type, patch.parent_code, patch.is_postable, patch.account_type, patch.totaling,
    patch.status, code,
  );
  const changes = diffFields(before as unknown as Record<string, unknown>, patch);
  await logTableChange('gl_account', code, 'Modification', changes, user);
  if (changes.length) {
    await audit(user, 'GL_ACCOUNT_UPDATE', 'gl_account', before.id, { code, fields: changes.map((c) => c.field) });
  }
  return (await one<GlAccount>('SELECT * FROM gl_account WHERE code = ?', code))!;
}

/** Accounting periods list's dynamic-filter registry — every meaningful column. */
export const PERIOD_FILTER_FIELDS: FilterFieldDef[] = [
  { key: 'code', label: 'Period', type: 'text' },
  { key: 'start_date', label: 'From', type: 'date' },
  { key: 'end_date', label: 'To', type: 'date' },
  { key: 'status', label: 'Status', type: 'select', options: [{ value: 'OPEN', label: 'Open' }, { value: 'CLOSED', label: 'Closed' }] },
];

/** Accounting periods list's sortable columns — every column shown in the table. */
const PERIOD_SORT_COLUMNS: Record<string, string> = {
  code: 'code',
  start_date: 'start_date',
  end_date: 'end_date',
  status: 'status',
};

export interface ListPeriodsOptions {
  search?: string;
  filters?: FilterCondition[];
  sort?: SortState | null;
}

export const listPeriods = (
  { search = '', filters = [], sort = null }: ListPeriodsOptions = {},
): Promise<AccountingPeriod[]> => {
  const { clause, params } = buildFilterClause(PERIOD_FILTER_FIELDS, filters);
  const orderBy = buildOrderClause(PERIOD_SORT_COLUMNS, sort, 'code DESC');
  return all<AccountingPeriod>(
    `SELECT * FROM accounting_period
     WHERE code ILIKE @like
       ${clause}
     ${orderBy}`,
    { like: `%${String(search).trim()}%`, ...params },
  );
};

/** Whether any accounting period exists at all, ignoring search and dynamic filters — lets the
 *  page grey out its filter controls only when there's truly nothing to filter. */
export const hasAnyPeriods = (): Promise<boolean> => hasAnyRow('accounting_period');

export async function setPeriodStatus(code: string, status: string, user: Actor): Promise<AccountingPeriod> {
  if (status !== 'OPEN' && status !== 'CLOSED') {
    throw new AppError('Status must be OPEN or CLOSED', 'VALIDATION');
  }
  const info = await run('UPDATE accounting_period SET status = ? WHERE code = ?', status, code);
  if (!info.changes) throw new AppError('Period not found', 'NOT_FOUND');
  await audit(user, status === 'CLOSED' ? 'PERIOD_CLOSE' : 'PERIOD_REOPEN', 'accounting_period', code);
  return (await one<AccountingPeriod>('SELECT * FROM accounting_period WHERE code = ?', code))!;
}

/* ------------------------------------------------------------- fiscal years */

/**
 * A fiscal year as Business Central reads it off the Accounting Periods: it runs from a period
 * flagged New Fiscal Year up to the period before the next such flag. `complete` means the next
 * year's first period exists, so this year's last day is known; `closed` is BC's "Closed" flag,
 * set on every period by Close Year.
 */
export interface FiscalYear {
  startDate: IsoDate;
  /** Last day of the year — the day before the next fiscal year starts. Null while incomplete. */
  endDate: IsoDate | null;
  periods: AccountingPeriod[];
  closed: boolean;
  complete: boolean;
}

/** Every fiscal year the periods describe, oldest first. Periods before the first New Fiscal
 *  Year flag (none, after the migration's backfill) are left out, as BC leaves them out. */
export async function listFiscalYears(): Promise<FiscalYear[]> {
  const periods = await all<AccountingPeriod>('SELECT * FROM accounting_period ORDER BY start_date');
  const years: FiscalYear[] = [];
  let current: AccountingPeriod[] | null = null;
  for (const p of periods) {
    if (Number(p.new_fiscal_year)) {
      if (current) years.push(fiscalYearOf(current, p.start_date));
      current = [p];
    } else if (current) {
      current.push(p);
    }
  }
  if (current) years.push(fiscalYearOf(current, null));
  return years;
}

function fiscalYearOf(periods: AccountingPeriod[], nextStart: IsoDate | null): FiscalYear {
  return {
    startDate: periods[0].start_date,
    endDate: nextStart ? addDaysIso(nextStart, -1) : null,
    periods,
    closed: periods.every((p) => Number(p.fiscally_closed) === 1),
    complete: nextStart !== null,
  };
}

/** The fiscal year whose last day is `endDate`, if the periods describe one. */
export async function findFiscalYearEnding(endDate: IsoDate): Promise<FiscalYear | undefined> {
  return (await listFiscalYears()).find((y) => y.endDate === endDate);
}

/**
 * Business Central's "Close Year" (Accounting Periods → Close Year): closes the earliest fiscal
 * year still open — every one of its periods is marked Closed and Date Locked — and, like BC,
 * cannot be undone. BC refuses unless the following fiscal year exists, since the year's last day
 * is only defined by the next year's first; the same check applies here. Closing the year does
 * not stop postings into it (that is the periods' own OPEN/CLOSED status, BC's Allow Posting
 * gate); it is the precondition Close Income Statement insists on.
 */
export async function closeFiscalYear(user: Actor): Promise<FiscalYear> {
  const years = await listFiscalYears();
  const year = years.find((y) => !y.closed);
  if (!year) throw new AppError('Every fiscal year is already closed', 'VALIDATION');
  if (!year.complete) {
    throw new AppError(
      `The fiscal year starting ${year.startDate} cannot be closed until the following fiscal year has been created (Create Fiscal Year)`,
      'VALIDATION',
    );
  }
  const codes = year.periods.map((p) => p.code);
  await run(
    `UPDATE accounting_period SET fiscally_closed = 1, date_locked = 1 WHERE code IN (${codes.map(() => '?').join(',')})`,
    ...codes,
  );
  await audit(user, 'FISCAL_YEAR_CLOSE', 'accounting_period', codes[0], { startDate: year.startDate, endDate: year.endDate, periods: codes });
  return { ...year, closed: true, periods: year.periods.map((p) => ({ ...p, fiscally_closed: 1, date_locked: 1 })) };
}

/**
 * Business Central's "Create Fiscal Year" batch job with its defaults — twelve one-month periods
 * following the last period on file (or starting on the organisation's fiscal-year start in the
 * current year when there are none), the first flagged New Fiscal Year. Periods here are always
 * calendar months, so the starting date is always the first of a month.
 */
export async function createFiscalYear(user: Actor, noOfPeriods = 12): Promise<AccountingPeriod[]> {
  if (!Number.isInteger(noOfPeriods) || noOfPeriods < 1 || noOfPeriods > 24) {
    throw new AppError('Number of periods must be between 1 and 24', 'VALIDATION');
  }
  const last = await one<AccountingPeriod>('SELECT * FROM accounting_period ORDER BY start_date DESC LIMIT 1');
  const org = await one<{ fy_start_month: number | null }>('SELECT fy_start_month FROM organisation WHERE id = 1');
  const fyMonth = org?.fy_start_month ?? 1;
  let start: Date;
  if (last) {
    start = new Date(`${last.end_date}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() + 1);
  } else {
    start = new Date(Date.UTC(new Date().getUTCFullYear(), fyMonth - 1, 1));
  }
  const created: AccountingPeriod[] = [];
  for (let i = 0; i < noOfPeriods; i++) {
    const s = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const e = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 0));
    const startDate = s.toISOString().slice(0, 10);
    const endDate = e.toISOString().slice(0, 10);
    const code = startDate.slice(0, 7);
    const newFy = s.getUTCMonth() + 1 === fyMonth ? 1 : 0;
    await run(
      'INSERT INTO accounting_period (code, start_date, end_date, status, new_fiscal_year) VALUES (?,?,?,?,?)',
      code, startDate, endDate, 'OPEN', newFy,
    );
    created.push({ id: 0, code, start_date: startDate, end_date: endDate, status: 'OPEN', new_fiscal_year: newFy, fiscally_closed: 0, date_locked: 0 });
  }
  await audit(user, 'FISCAL_YEAR_CREATE', 'accounting_period', created[0].code, { from: created[0].code, to: created[created.length - 1].code });
  return created;
}

/* ------------------------------------------------- find entries / navigate */

/** Business Central's "Navigate": every entry across every subledger that shares this
 *  journal — the G/L lines themselves (already available via getJournal), plus whichever
 *  source document(s) posted it, resolved through each module's own journal_id link
 *  (cust_ledger_entry, vendor_ledger_entry, bank_account_ledger_entry). */
export async function getJournalRelatedEntries(journalId: number): Promise<JournalRelatedEntries> {
  const [glLines, customerEntries, vendorEntries, bankEntries] = await Promise.all([
    all<{ id: number }>('SELECT id FROM journal_line WHERE journal_id = ?', journalId),
    all<{ id: number; document_type: string; document_no: string; amount: Cents; no: string; name: string }>(
      `SELECT cle.id, cle.document_type, cle.document_no, cle.amount, c.no, c.name
       FROM cust_ledger_entry cle JOIN customer c ON c.id = cle.customer_id
       WHERE cle.journal_id = ?`,
      journalId,
    ),
    all<{ id: number; document_type: string; document_no: string; amount: Cents; no: string; name: string }>(
      `SELECT vle.id, vle.document_type, vle.document_no, vle.amount, v.no, v.name
       FROM vendor_ledger_entry vle JOIN vendor v ON v.id = vle.vendor_id
       WHERE vle.journal_id = ?`,
      journalId,
    ),
    all<{ id: number; amount: Cents; code: string; name: string }>(
      `SELECT bale.id, bale.amount, ba.code, ba.name
       FROM bank_account_ledger_entry bale JOIN bank_account ba ON ba.id = bale.bank_account_id
       WHERE bale.journal_id = ?`,
      journalId,
    ),
  ]);

  return {
    glLineCount: glLines.length,
    customer: {
      entries: customerEntries.map((e) => ({
        label: `${e.no} ${e.name} · ${e.document_type} ${e.document_no}`, amount: e.amount, href: `/receivables/customers/${e.no}`,
      })),
    },
    vendor: {
      entries: vendorEntries.map((e) => ({
        label: `${e.no} ${e.name} · ${e.document_type} ${e.document_no}`, amount: e.amount, href: `/payables/vendors/${e.no}`,
      })),
    },
    bank: {
      entries: bankEntries.map((b) => ({ label: `${b.code} — ${b.name}`, amount: b.amount, href: '' })),
    },
  };
}

/* --------------------------------------------------- bank accounts (moved to lib/bankMgmt.ts) */

export {
  listBankAccounts, getBankAccount, getBankAccountByCode, listActiveBankAccounts, hasAnyBankAccounts,
  createBankAccount, updateBankAccount, listBankAccountLedgerEntries, listBankReconciliations,
  startBankReconciliation, suggestBankRecLines, matchBankRecLine, addBankRecGlAdjustmentLine,
  deleteBankRecLine, getBankReconciliationDetail, postBankReconciliation,
  type BankAccountInput, type ListBankLedgerOptions, type BankRecAdjustmentInput,
} from './bankMgmt.ts';

/* ------------------------------------------------------- indent chart of accounts */

export interface IndentChartResult {
  /** How many accounts had their indentation or totaling changed. */
  updated: number;
  /** End-Total accounts whose Totaling range was filled in from their Begin-Total. */
  totalingSet: number;
  /** Begin-Totals left open at the end of the chart — a structure error worth reporting. */
  unclosed: string[];
}

/**
 * Business Central's "Indent Chart of Accounts" (Codeunit 2, G/L Account-Indent).
 *
 * Walks the chart in code order keeping a stack of open Begin-Totals. Every account is stamped
 * with the current depth; a Begin-Total opens a level after stamping itself, an End-Total closes
 * one before stamping, so a pair sits at the same indentation with its members indented inside.
 * Closing a pair also writes the End-Total's Totaling as `<begin>..<end>` — the part that cannot
 * be derived when the list renders, and the reason this is an action rather than a view concern.
 *
 * Idempotent: running it twice changes nothing the second time.
 */
export async function indentChartOfAccounts(user: Actor): Promise<IndentChartResult> {
  const accounts = await all<Pick<GlAccount, 'id' | 'code' | 'account_type' | 'indentation' | 'totaling' | 'parent_code'>>(
    'SELECT id, code, account_type, indentation, totaling, parent_code FROM gl_account ORDER BY code',
  );

  // A chart that uses parent_code instead of Begin-Total / End-Total brackets would otherwise
  // indent to nothing, so depth comes from the parent chain when there is no bracketing at all.
  const bracketed = accounts.some((a) => a.account_type === 'BEGIN_TOTAL' || a.account_type === 'END_TOTAL');
  if (!bracketed) return indentByParentChain(accounts, user);

  const open: { code: string }[] = [];
  let depth = 0;
  let updated = 0;
  let totalingSet = 0;

  for (const a of accounts) {
    let totaling = a.totaling;
    if (a.account_type === 'END_TOTAL') {
      depth = Math.max(0, depth - 1);
      const begin = open.pop();
      if (begin) {
        const range = `${begin.code}..${a.code}`;
        if (range !== a.totaling) { totaling = range; totalingSet += 1; }
      }
    }

    if (a.indentation !== depth || totaling !== a.totaling) {
      await run('UPDATE gl_account SET indentation = ?, totaling = ? WHERE id = ?', depth, totaling, a.id);
      updated += 1;
    }

    if (a.account_type === 'BEGIN_TOTAL') {
      open.push({ code: a.code });
      depth += 1;
    }
  }

  const result: IndentChartResult = { updated, totalingSet, unclosed: open.map((o) => o.code) };
  await audit(user, 'GL_CHART_INDENT', 'gl_account', null, result);
  return result;
}

/** Depth from the parent_code chain, for a chart that nests by parent rather than by
 *  Begin-Total / End-Total brackets. A cycle stops at the depth already walked rather than
 *  looping forever. */
async function indentByParentChain(
  accounts: Pick<GlAccount, 'id' | 'code' | 'account_type' | 'indentation' | 'totaling' | 'parent_code'>[],
  user: Actor,
): Promise<IndentChartResult> {
  const parentByCode = new Map(accounts.map((a) => [a.code, a.parent_code]));
  const depthOf = (code: string): number => {
    const seen = new Set<string>([code]);
    let depth = 0;
    let parent = parentByCode.get(code) ?? null;
    while (parent && !seen.has(parent) && parentByCode.has(parent)) {
      seen.add(parent);
      depth += 1;
      parent = parentByCode.get(parent) ?? null;
    }
    return depth;
  };

  let updated = 0;
  for (const a of accounts) {
    const depth = depthOf(a.code);
    if (a.indentation !== depth) {
      await run('UPDATE gl_account SET indentation = ? WHERE id = ?', depth, a.id);
      updated += 1;
    }
  }
  const result: IndentChartResult = { updated, totalingSet: 0, unclosed: [] };
  await audit(user, 'GL_CHART_INDENT', 'gl_account', null, { ...result, by: 'parent_code' });
  return result;
}
