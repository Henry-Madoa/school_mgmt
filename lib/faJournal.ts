/*
 * FA Journal — the Fixed Asset subledger's one maker-checker document, posting Business
 * Central's FA Posting Types (Acquisition Cost, Depreciation, Write-Down, Appreciation,
 * Disposal, Maintenance) through the shared postJournal() engine (lib/accounting.ts).
 *
 * No AL source exists for any of this: the companion AL extension never touched
 * Business Central's stock FA tables, so this module is built from Business Central domain
 * knowledge rather than ported field-for-field — closest precedent in this codebase is
 * lib/itemJournal.ts (maker-checker document -> postJournal()), whose lifecycle
 * (Open -> Pending Approval -> Approved -> Processed) and workflow wiring it mirrors exactly.
 *
 * Every posting resolves its debit and credit from the asset's FA Posting Group (BC Table 5606):
 *
 *   Acquisition Cost   Dr Acquisition Cost account          Cr Balancing account (Bank/Payables)   book value +amount
 *   Depreciation       Dr Depreciation Expense account      Cr Accum. Depreciation account         book value -amount
 *   Write-Down         Dr Write-Down Expense account        Cr Accum. Depreciation account         book value -amount
 *   Appreciation       Dr Acquisition Cost account          Cr Appreciation account                book value +amount
 *   Maintenance        Dr Maintenance Expense account       Cr Balancing account                   book value unchanged
 *   Disposal           reverse cost & accumulated depreciation, book the proceeds, net the
 *                      gain/loss to Gains/Losses Acc. on Disposal                                  book value -> 0
 */
import {
  one, all, run, tx, nextSequence, audit, hasAnyRow,
} from './db.ts';
import { AppError } from './errors.ts';
import { postJournal } from './accounting.ts';
import { getEffectivePostingRange } from './postingDates.ts';
import { getFaSetup } from './fixedAssetsSetup.ts';
import { findMatchingWorkflow, findPendingRoutedTask, pickConditionFields, startWorkflow } from './workflow.ts';
import { buildFilterClause, type FilterCondition, type FilterFieldDef } from './listFilters.ts';
import { buildOrderClause, type SortState } from './listSort.ts';
import type {
  Actor, Cents, FaJournalLine, FaJournalLineView, FaPostingType, IsoDate,
} from './types.ts';

export type FaJournalView = 'open' | 'pending' | 'approved' | 'processed';

const VIEW_CLAUSE: Record<FaJournalView, string> = {
  open: "faj.status = 'Open'",
  pending: "faj.status = 'Pending Approval'",
  approved: "faj.status = 'Approved'",
  processed: "faj.status = 'Processed'",
};

const POSTING_TYPES: FaPostingType[] = [
  'Acquisition Cost', 'Depreciation', 'Write-Down', 'Appreciation', 'Disposal', 'Maintenance',
];

/** Posting types whose balancing (offset) G/L account the user must name on the line. */
const NEEDS_BALANCING_ACCOUNT = new Set<FaPostingType>(['Acquisition Cost', 'Maintenance', 'Disposal']);

const SELECT_ROW = `
  SELECT faj.*,
         fa.no AS fixed_asset_no, fa.description AS fixed_asset_description,
         bal.code AS balancing_gl_account_code, bal.name AS balancing_gl_account_name,
         j.journal_no AS journal_no,
         COALESCE(b.book_value, 0) AS book_value,
         COALESCE(b.disposed, 0) = 1 AS disposed
  FROM fa_journal_line faj
  JOIN fixed_asset fa ON fa.id = faj.fixed_asset_id
  LEFT JOIN gl_account bal ON bal.id = faj.balancing_gl_account_id
  LEFT JOIN journal j ON j.id = faj.journal_id
  LEFT JOIN fa_depreciation_book b ON b.fixed_asset_id = faj.fixed_asset_id
    AND b.depreciation_book_code = faj.depreciation_book_code`;

export const FA_JOURNAL_FILTER_FIELDS: FilterFieldDef[] = [
  { key: 'no', label: 'No.', type: 'text', column: 'faj.no' },
  { key: 'fixed_asset_id', label: 'Fixed Asset', type: 'select', column: 'faj.fixed_asset_id' },
  {
    key: 'fa_posting_type', label: 'FA Posting Type', type: 'select', column: 'faj.fa_posting_type',
    options: POSTING_TYPES.map((v) => ({ value: v, label: v })),
  },
  { key: 'posting_date', label: 'Posting Date', type: 'date', column: 'faj.posting_date' },
  { key: 'created_by', label: 'Created By', type: 'text', column: 'faj.created_by' },
];

const SORT_COLUMNS: Record<string, string> = {
  no: 'faj.no',
  asset: 'fa.no',
  posting_date: 'faj.posting_date',
  amount: 'faj.amount',
  status: 'faj.status',
  created_at: 'faj.created_at',
};

export interface ListFaJournalLinesOptions {
  view?: FaJournalView;
  search?: string;
  filters?: FilterCondition[];
  sort?: SortState | null;
}

export const listFaJournalLines = (
  { view, search = '', filters = [], sort = null }: ListFaJournalLinesOptions = {},
): Promise<FaJournalLineView[]> => {
  const { clause, params } = buildFilterClause(FA_JOURNAL_FILTER_FIELDS, filters);
  const orderBy = buildOrderClause(SORT_COLUMNS, sort, 'faj.no DESC');
  return all<FaJournalLineView>(
    `${SELECT_ROW}
     WHERE (faj.no ILIKE @like OR fa.no ILIKE @like OR fa.description ILIKE @like)
       ${view ? `AND ${VIEW_CLAUSE[view]}` : ''}
       ${clause}
     ${orderBy}`,
    { like: `%${String(search).trim()}%`, ...params },
  );
};

export const getFaJournalLine = (no: string): Promise<FaJournalLineView | undefined> =>
  one<FaJournalLineView>(`${SELECT_ROW} WHERE faj.no = ?`, no);

export const hasAnyFaJournalLines = (view?: FaJournalView): Promise<boolean> =>
  hasAnyRow('fa_journal_line faj', view ? VIEW_CLAUSE[view] : undefined);

/* -------------------------------------------------------------------- validation */

export interface FaJournalLineInput {
  postingDate: IsoDate;
  documentNo?: string | null;
  fixedAssetId: number;
  depreciationBookCode: string;
  faPostingType: FaPostingType;
  amount: Cents;
  balancingGlAccountId?: number | null;
  maintenanceCode?: string | null;
  description?: string | null;
}

interface AssetForJournal {
  id: number; no: string; blocked: 0 | 1; inactive: 0 | 1;
}

interface BookForJournal {
  id: number; fa_posting_group_code: string; disposed: 0 | 1; disposal_calculation_method: 'Net' | 'Gross';
  acquisition_cost: Cents; accumulated_depreciation: Cents; write_down_amount: Cents;
  appreciation_amount: Cents; book_value: Cents; salvage_value: Cents;
}

async function loadAsset(id: number): Promise<AssetForJournal> {
  const a = await one<AssetForJournal>('SELECT id, no, blocked, inactive FROM fixed_asset WHERE id = ?', id);
  if (!a) throw new AppError('Fixed asset not found', 'NOT_FOUND');
  if (a.blocked) throw new AppError('This fixed asset is blocked', 'VALIDATION');
  return a;
}

async function loadBook(assetId: number, bookCode: string): Promise<BookForJournal> {
  const b = await one<BookForJournal>(
    `SELECT id, fa_posting_group_code, disposed, disposal_calculation_method, acquisition_cost,
            accumulated_depreciation, write_down_amount, appreciation_amount, book_value, salvage_value
     FROM fa_depreciation_book WHERE fixed_asset_id = ? AND depreciation_book_code = ?`,
    assetId, bookCode,
  );
  if (!b) throw new AppError('This asset has no FA Depreciation Book for that book — set one up on the asset card first', 'VALIDATION');
  return b;
}

async function assertFaPostingDateAllowed(date: IsoDate, user: Actor): Promise<void> {
  const setup = await getFaSetup();
  if (setup.allow_fa_posting_from && date < setup.allow_fa_posting_from) {
    throw new AppError(`FA posting is not allowed before ${setup.allow_fa_posting_from}`, 'VALIDATION');
  }
  if (setup.allow_fa_posting_to && date > setup.allow_fa_posting_to) {
    throw new AppError(`FA posting is not allowed after ${setup.allow_fa_posting_to}`, 'VALIDATION');
  }
  // Also honour the user's own General Ledger posting range (postJournal enforces it again).
  const range = await getEffectivePostingRange(user.id);
  if (range.from && date < range.from) throw new AppError(`Posting date ${date} is before your earliest allowed date (${range.from})`, 'VALIDATION');
  if (range.to && date > range.to) throw new AppError(`Posting date ${date} is after your latest allowed date (${range.to})`, 'VALIDATION');
}

async function assertMandatory(input: FaJournalLineInput, book: BookForJournal): Promise<void> {
  if (!POSTING_TYPES.includes(input.faPostingType)) throw new AppError('Invalid FA posting type', 'VALIDATION');
  if (!input.postingDate) throw new AppError('A posting date is required', 'VALIDATION');
  if (!(input.amount >= 0)) throw new AppError('Amount cannot be negative', 'VALIDATION');
  if (input.faPostingType !== 'Disposal' && !(input.amount > 0)) {
    throw new AppError('Amount must be greater than zero', 'VALIDATION');
  }

  if (NEEDS_BALANCING_ACCOUNT.has(input.faPostingType) && !input.balancingGlAccountId) {
    throw new AppError(`A balancing G/L account is required for an ${input.faPostingType} line`, 'VALIDATION');
  }
  if (input.faPostingType === 'Maintenance') {
    if (!input.maintenanceCode) throw new AppError('A maintenance code is required for a Maintenance line', 'VALIDATION');
    if (!(await hasAnyRow('maintenance', 'code = ?', input.maintenanceCode))) {
      throw new AppError('Unknown maintenance code', 'VALIDATION');
    }
  }

  if (book.disposed) throw new AppError('This asset has been disposed — no further FA entries can be posted for this book', 'VALIDATION');

  const hasAcquisition = book.acquisition_cost > 0;
  if (input.faPostingType !== 'Acquisition Cost' && !hasAcquisition) {
    throw new AppError('Post an Acquisition Cost for this asset before any other FA entry', 'VALIDATION');
  }
}

/* ------------------------------------------------------------------- create / edit */

async function insertOrUpdate(
  no: string | null, input: FaJournalLineInput, user: Actor,
): Promise<{ no: string }> {
  const asset = await loadAsset(input.fixedAssetId);
  const book = await loadBook(asset.id, input.depreciationBookCode);
  await assertMandatory(input, book);
  await assertFaPostingDateAllowed(input.postingDate, user);

  if (input.balancingGlAccountId) {
    const acct = await one<{ is_postable: number; status: string }>(
      'SELECT is_postable, status FROM gl_account WHERE id = ?', input.balancingGlAccountId,
    );
    if (!acct || !acct.is_postable || acct.status !== 'ACTIVE') {
      throw new AppError('The balancing G/L account must be an active posting account', 'VALIDATION');
    }
  }

  const cols = [
    input.postingDate, input.documentNo?.trim() || null, asset.id, input.depreciationBookCode,
    input.faPostingType, Math.round(input.amount),
    NEEDS_BALANCING_ACCOUNT.has(input.faPostingType) ? input.balancingGlAccountId : null,
    input.faPostingType === 'Maintenance' ? input.maintenanceCode : null,
    input.description?.trim() || null,
  ];

  if (no) {
    await run(
      `UPDATE fa_journal_line SET posting_date = ?, document_no = ?, fixed_asset_id = ?, depreciation_book_code = ?,
         fa_posting_type = ?, amount = ?, balancing_gl_account_id = ?, maintenance_code = ?, description = ?
       WHERE no = ?`,
      ...cols, no,
    );
    await audit(user, 'FA_JOURNAL_UPDATE', 'fa_journal_line', no, {});
    return { no };
  }
  const newNo = await nextSequence('FA_JOURNAL');
  await run(
    `INSERT INTO fa_journal_line
      (no, posting_date, document_no, fixed_asset_id, depreciation_book_code, fa_posting_type, amount,
       balancing_gl_account_id, maintenance_code, description, created_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    newNo, ...cols, new Date().toISOString(), user.username,
  );
  await audit(user, 'FA_JOURNAL_CREATE', 'fa_journal_line', newNo, { faPostingType: input.faPostingType });
  return { no: newNo };
}

export const createFaJournalLine = (input: FaJournalLineInput, user: Actor): Promise<{ no: string }> =>
  insertOrUpdate(null, input, user);

export async function updateFaJournalLine(no: string, input: FaJournalLineInput, user: Actor): Promise<void> {
  const before = await one<Pick<FaJournalLine, 'status' | 'created_by' | 'source'>>(
    'SELECT status, created_by, source FROM fa_journal_line WHERE no = ?', no,
  );
  if (!before) throw new AppError('FA journal line not found', 'NOT_FOUND');
  if (before.status !== 'Open') throw new AppError('Only an open line can be edited', 'VALIDATION');
  if (before.created_by !== user.username) throw new AppError('Only the person who created this can edit it', 'NOT_CREATOR');
  await insertOrUpdate(no, input, user);
}

export async function deleteFaJournalLine(no: string, user: Actor): Promise<void> {
  const before = await one<Pick<FaJournalLine, 'status' | 'created_by'>>(
    'SELECT status, created_by FROM fa_journal_line WHERE no = ?', no,
  );
  if (!before) throw new AppError('FA journal line not found', 'NOT_FOUND');
  if (before.status !== 'Open') throw new AppError('Only an open line can be deleted', 'VALIDATION');
  if (before.created_by !== user.username) throw new AppError('Only the person who created this can delete it', 'NOT_CREATOR');
  await run('DELETE FROM fa_journal_line WHERE no = ?', no);
  await audit(user, 'FA_JOURNAL_DELETE', 'fa_journal_line', no, {});
}

/* -------------------------------------------------------------- maker-checker */

export async function submitFaJournalLine(no: string, user: Actor): Promise<{ autoApproved: boolean }> {
  const req = await one<FaJournalLine>('SELECT * FROM fa_journal_line WHERE no = ?', no);
  if (!req) throw new AppError('FA journal line not found', 'NOT_FOUND');
  if (req.status !== 'Open') throw new AppError('Only an open line can be submitted for approval', 'VALIDATION');

  const matched = await findMatchingWorkflow('FA_JOURNAL', await pickConditionFields('FA_JOURNAL', req));
  if (!matched) throw new AppError('There is no enabled workflow for this document', 'NO_WORKFLOW');

  await tx(async () => {
    await run("UPDATE fa_journal_line SET status = 'Pending Approval' WHERE no = ?", no);
    await startWorkflow(matched.workflow, matched.steps, {
      documentType: 'FA_JOURNAL', entityId: no, requestedBy: user.username, amount: Number(req.amount),
    });
  });

  const after = await one<{ status: string }>('SELECT status FROM fa_journal_line WHERE no = ?', no);
  return { autoApproved: after?.status === 'Approved' };
}

export async function cancelFaJournalLineApproval(no: string, user: Actor): Promise<void> {
  const req = await one<Pick<FaJournalLine, 'status' | 'created_by'>>(
    'SELECT status, created_by FROM fa_journal_line WHERE no = ?', no,
  );
  if (!req) throw new AppError('FA journal line not found', 'NOT_FOUND');
  if (req.status !== 'Pending Approval') throw new AppError('Only a line pending approval can be recalled', 'VALIDATION');
  const routed = await findPendingRoutedTask('FA_JOURNAL', no);
  const requestedBy = routed?.requested_by ?? req.created_by;
  if (requestedBy !== user.username) throw new AppError('Only the person who submitted this can recall it', 'NOT_REQUESTER');
  await run("UPDATE fa_journal_line SET status = 'Open' WHERE no = ?", no);
  await audit(user, 'FA_JOURNAL_CANCEL_APPROVAL', 'fa_journal_line', no, {});
}

export async function approveFaJournalLine(no: string, user: Actor): Promise<void> {
  const req = await one<FaJournalLine>('SELECT * FROM fa_journal_line WHERE no = ?', no);
  if (!req) throw new AppError('FA journal line not found', 'NOT_FOUND');
  if (req.status !== 'Pending Approval') throw new AppError('Only a line pending approval can be approved', 'VALIDATION');
  await run("UPDATE fa_journal_line SET status = 'Approved', decision_reason = NULL WHERE no = ?", no);
  await audit(user, 'FA_JOURNAL_APPROVE', 'fa_journal_line', no, {});
}

export async function rejectFaJournalLine(no: string, reason: string | null, user: Actor): Promise<void> {
  if (!reason || !reason.trim()) throw new AppError('A reason is required to reject an FA journal line', 'VALIDATION');
  const req = await one<FaJournalLine>('SELECT * FROM fa_journal_line WHERE no = ?', no);
  if (!req) throw new AppError('FA journal line not found', 'NOT_FOUND');
  if (req.status !== 'Pending Approval') throw new AppError('Only a line pending approval can be rejected', 'VALIDATION');
  await run("UPDATE fa_journal_line SET status = 'Open', decision_reason = ? WHERE no = ?", reason, no);
  await audit(user, 'FA_JOURNAL_REJECT', 'fa_journal_line', no, { reason });
}

export async function reopenFaJournalLine(no: string, user: Actor): Promise<void> {
  const req = await one<FaJournalLine>('SELECT * FROM fa_journal_line WHERE no = ?', no);
  if (!req) throw new AppError('FA journal line not found', 'NOT_FOUND');
  if (req.status !== 'Approved' || req.posted) {
    throw new AppError('Only an approved line that has not been posted can be reopened', 'VALIDATION');
  }
  await run("UPDATE fa_journal_line SET status = 'Open' WHERE no = ?", no);
  await audit(user, 'FA_JOURNAL_REOPEN', 'fa_journal_line', no, {});
}

/* ------------------------------------------------------------------- posting */

interface GlLine { account: number; debit: Cents; credit: Cents; narration: string }

const EVENT_TYPE: Record<FaPostingType, string> = {
  'Acquisition Cost': 'FA_ACQUISITION',
  Depreciation: 'FA_DEPRECIATION',
  'Write-Down': 'FA_WRITE_DOWN',
  Appreciation: 'FA_APPRECIATION',
  Disposal: 'FA_DISPOSAL',
  Maintenance: 'FA_MAINTENANCE',
};

export async function postFaJournalLine(
  no: string, user: Actor,
): Promise<{ journalNo: string | null; bookValue: Cents; disposed: boolean }> {
  return tx(async () => {
    const line = await one<FaJournalLine>('SELECT * FROM fa_journal_line WHERE no = ?', no);
    if (!line) throw new AppError('FA journal line not found', 'NOT_FOUND');
    if (line.posted) throw new AppError('This line has already been posted', 'VALIDATION');
    if (line.status !== 'Approved') throw new AppError('Only an approved line can be posted', 'VALIDATION');

    const asset = await loadAsset(line.fixed_asset_id);
    const book = await loadBook(asset.id, line.depreciation_book_code);
    if (book.disposed) throw new AppError('This asset has already been disposed for this book', 'VALIDATION');
    if (line.fa_posting_type !== 'Acquisition Cost' && book.acquisition_cost <= 0) {
      throw new AppError('No Acquisition Cost has been posted for this asset', 'VALIDATION');
    }

    const pg = await one<{
      acquisition_cost_account_id: number; accum_depreciation_account_id: number;
      depreciation_expense_account_id: number; write_down_expense_account_id: number;
      appreciation_account_id: number; maintenance_expense_account_id: number;
      gains_acc_on_disposal_id: number; losses_acc_on_disposal_id: number;
    }>('SELECT * FROM fa_posting_group WHERE code = ?', book.fa_posting_group_code);
    if (!pg) throw new AppError('The asset\'s FA posting group is missing its account setup', 'VALIDATION');

    const amount = Math.round(line.amount);
    const vd = line.posting_date;
    const tag = `${line.fa_posting_type} ${no} — ${asset.no}${line.description ? ` (${line.description})` : ''}`.slice(0, 250);

    let glLines: GlLine[] = [];
    let bookValueDelta = 0;
    let acquisitionDelta = 0;
    let accumDeprDelta = 0;
    let writeDownDelta = 0;
    let appreciationDelta = 0;
    let maintenanceDelta = 0;
    let partOfBookValue = 1;
    let ledgerAmount = 0;
    let disposed = false;
    let proceeds = 0;
    let gainLoss = 0;

    switch (line.fa_posting_type) {
      case 'Acquisition Cost':
        glLines = [
          { account: pg.acquisition_cost_account_id, debit: amount, credit: 0, narration: tag },
          { account: line.balancing_gl_account_id!, debit: 0, credit: amount, narration: tag },
        ];
        bookValueDelta = amount; acquisitionDelta = amount; ledgerAmount = amount;
        break;
      case 'Depreciation':
        glLines = [
          { account: pg.depreciation_expense_account_id, debit: amount, credit: 0, narration: tag },
          { account: pg.accum_depreciation_account_id, debit: 0, credit: amount, narration: tag },
        ];
        bookValueDelta = -amount; accumDeprDelta = -amount; ledgerAmount = -amount;
        break;
      case 'Write-Down':
        glLines = [
          { account: pg.write_down_expense_account_id, debit: amount, credit: 0, narration: tag },
          { account: pg.accum_depreciation_account_id, debit: 0, credit: amount, narration: tag },
        ];
        bookValueDelta = -amount; writeDownDelta = -amount; ledgerAmount = -amount;
        break;
      case 'Appreciation':
        glLines = [
          { account: pg.acquisition_cost_account_id, debit: amount, credit: 0, narration: tag },
          { account: pg.appreciation_account_id, debit: 0, credit: amount, narration: tag },
        ];
        bookValueDelta = amount; appreciationDelta = amount; ledgerAmount = amount;
        break;
      case 'Maintenance':
        glLines = [
          { account: pg.maintenance_expense_account_id, debit: amount, credit: 0, narration: tag },
          { account: line.balancing_gl_account_id!, debit: 0, credit: amount, narration: tag },
        ];
        partOfBookValue = 0; maintenanceDelta = amount; ledgerAmount = amount;
        break;
      case 'Disposal': {
        proceeds = amount;
        const costToReverse = book.acquisition_cost + book.appreciation_amount; // both credited to the cost account
        const accumToReverse = -(book.accumulated_depreciation + book.write_down_amount); // stored negative -> positive here
        gainLoss = proceeds - book.book_value;
        glLines = [];
        if (proceeds > 0 && line.balancing_gl_account_id) {
          glLines.push({ account: line.balancing_gl_account_id, debit: proceeds, credit: 0, narration: tag });
        }
        if (costToReverse > 0) {
          glLines.push({ account: pg.acquisition_cost_account_id, debit: 0, credit: costToReverse, narration: `${tag} — reverse cost` });
        }
        if (accumToReverse > 0) {
          glLines.push({ account: pg.accum_depreciation_account_id, debit: accumToReverse, credit: 0, narration: `${tag} — reverse accum. depreciation` });
        }
        if (gainLoss > 0) {
          glLines.push({ account: pg.gains_acc_on_disposal_id, debit: 0, credit: gainLoss, narration: `${tag} — gain on disposal` });
        } else if (gainLoss < 0) {
          glLines.push({ account: pg.losses_acc_on_disposal_id, debit: -gainLoss, credit: 0, narration: `${tag} — loss on disposal` });
        }
        bookValueDelta = -book.book_value;
        acquisitionDelta = -book.acquisition_cost;
        accumDeprDelta = -book.accumulated_depreciation;
        writeDownDelta = -book.write_down_amount;
        appreciationDelta = -book.appreciation_amount;
        ledgerAmount = -book.book_value;
        disposed = true;
        break;
      }
      default:
        throw new AppError('Invalid FA posting type', 'VALIDATION');
    }

    // A journal must have >= 2 lines and balance; a zero-proceeds disposal of a fully-depreciated
    // asset (cost == accum. depreciation, book value 0) produces exactly two offsetting lines.
    let journalNo: string | null = null;
    let journalId: number | null = null;
    const totalDebit = glLines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = glLines.reduce((s, l) => s + l.credit, 0);
    if (glLines.length >= 2 && totalDebit === totalCredit && totalDebit > 0) {
      const j = await postJournal({
        valueDate: vd, module: 'FIXED_ASSETS', eventType: EVENT_TYPE[line.fa_posting_type],
        description: tag, reference: no, user, idempotencyKey: `FA_JOURNAL-${no}`,
        globalDimension1Id: null, globalDimension2Id: null,
        lines: glLines.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit, narration: l.narration })),
      });
      journalNo = j.journal_no;
      journalId = j.id;
    } else if (glLines.length && totalDebit !== totalCredit) {
      throw new AppError('Internal error: the FA journal did not balance', 'POSTING_ERROR');
    }

    // FA Ledger Entry.
    await run(
      `INSERT INTO fa_ledger_entry
        (fixed_asset_id, depreciation_book_code, fa_posting_date, fa_posting_type, document_no, description,
         amount, no_of_depreciation_days, journal_id, fa_journal_line_id, part_of_book_value, maintenance_code, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      asset.id, line.depreciation_book_code, vd, line.fa_posting_type, line.document_no || no,
      line.description || null, ledgerAmount, line.no_of_depreciation_days ?? null, journalId, line.id,
      partOfBookValue, line.maintenance_code || null, new Date().toISOString(),
    );

    // Roll-ups on the FA Depreciation Book.
    await run(
      `UPDATE fa_depreciation_book SET
         acquisition_cost = acquisition_cost + ?,
         accumulated_depreciation = accumulated_depreciation + ?,
         write_down_amount = write_down_amount + ?,
         appreciation_amount = appreciation_amount + ?,
         maintenance_total = maintenance_total + ?,
         book_value = book_value + ?,
         proceeds_on_disposal = proceeds_on_disposal + ?,
         gain_loss_on_disposal = gain_loss_on_disposal + ?,
         disposed = ?,
         last_depreciation_date = CASE WHEN ? = 'Depreciation' THEN ? ELSE last_depreciation_date END
       WHERE id = ?`,
      acquisitionDelta, accumDeprDelta, writeDownDelta, appreciationDelta, maintenanceDelta,
      bookValueDelta, disposed ? proceeds : 0, disposed ? gainLoss : 0, disposed ? 1 : 0,
      line.fa_posting_type, vd, book.id,
    );

    // Stamp the asset's acquisition / disposal date.
    if (line.fa_posting_type === 'Acquisition Cost') {
      await run(
        'UPDATE fixed_asset SET acquisition_date = COALESCE(acquisition_date, ?) WHERE id = ?', vd, asset.id,
      );
    }
    if (disposed) {
      await run('UPDATE fixed_asset SET disposal_date = ? WHERE id = ?', vd, asset.id);
    }

    await run(
      `UPDATE fa_journal_line SET status = 'Processed', posted = true, journal_id = ?, posted_at = ?, posted_by = ?
       WHERE no = ?`,
      journalId, new Date().toISOString(), user.username, no,
    );

    const after = await one<{ book_value: Cents; disposed: 0 | 1 }>(
      'SELECT book_value, disposed FROM fa_depreciation_book WHERE id = ?', book.id,
    );
    await audit(user, 'FA_JOURNAL_POST', 'fa_journal_line', no, { journalNo, faPostingType: line.fa_posting_type, amount });
    return { journalNo, bookValue: after?.book_value ?? 0, disposed: !!after?.disposed };
  });
}

/** Post every Approved FA journal line (optionally scoped to one book) in one pass — the
 *  convenience the Calculate Depreciation batch feeds into. */
export async function postAllApprovedFaJournalLines(
  bookCode: string | null, user: Actor,
): Promise<{ posted: number; total: Cents; failures: { no: string; error: string }[] }> {
  const rows = await all<{ no: string }>(
    `SELECT no FROM fa_journal_line WHERE status = 'Approved' AND posted = false
       ${bookCode ? 'AND depreciation_book_code = @bookCode' : ''}
     ORDER BY posting_date, no`,
    { bookCode },
  );
  let posted = 0;
  let total = 0;
  const failures: { no: string; error: string }[] = [];
  for (const r of rows) {
    try {
      const line = await one<{ amount: Cents }>('SELECT amount FROM fa_journal_line WHERE no = ?', r.no);
      await postFaJournalLine(r.no, user);
      posted += 1;
      total += Number(line?.amount ?? 0);
    } catch (e) {
      failures.push({ no: r.no, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { posted, total, failures };
}
