/*
 * Fixed Asset cards — Business Central Table 5600. Modelled on lib/items.ts. The per-asset FA
 * Depreciation Book (BC Table 5612) is managed here too. A vehicle is just an asset in the
 * "Motor Vehicles" FA Class / Subclass — there is no separate asset-type flag.
 *
 * acquisition_date / disposal_date are stamped by posting (lib/faJournal.ts), never entered by
 * hand. Depreciation-affecting fields on the FA Depreciation Book lock once depreciation has
 * been posted, mirroring how updateItem() locks the Costing Method after the first movement.
 */
import { one, all, run, tx, nextSequence, audit, hasAnyRow } from './db.ts';
import { AppError } from './errors.ts';
import { buildFilterClause, type FilterCondition, type FilterFieldDef } from './listFilters.ts';
import { buildOrderClause, type SortState } from './listSort.ts';
import type {
  Actor, Cents, FaDepreciationBook, FaDepreciationBookView, FaDepreciationMethod,
  FaLedgerEntryView, FixedAsset, FixedAssetListRow, IsoDate,
} from './types.ts';

const DEPRECIATION_METHODS: FaDepreciationMethod[] = ['Straight-Line', 'Declining-Balance 1', 'DB1/SL', 'Manual'];

/* -------------------------------------------------------------------- list / read */

const SELECT_ROW = `
  SELECT fa.*,
         c.description  AS fa_class_description,
         s.description  AS fa_subclass_description,
         l.description  AS fa_location_description,
         b.depreciation_book_code AS depreciation_book_code,
         b.depreciation_method    AS depreciation_method,
         COALESCE(b.acquisition_cost, 0)         AS acquisition_cost,
         COALESCE(b.accumulated_depreciation, 0) AS accumulated_depreciation,
         COALESCE(b.book_value, 0)               AS book_value,
         COALESCE(b.disposed, 0) = 1             AS disposed
  FROM fixed_asset fa
  LEFT JOIN fa_class c    ON c.code = fa.fa_class_code
  LEFT JOIN fa_subclass s ON s.code = fa.fa_subclass_code
  LEFT JOIN fa_location l  ON l.code = fa.fa_location_code
  LEFT JOIN fa_depreciation_book b ON b.fixed_asset_id = fa.id
    AND b.depreciation_book_code = COALESCE(
      (SELECT default_depreciation_book_code FROM fa_setup WHERE id = 1),
      (SELECT MIN(depreciation_book_code) FROM fa_depreciation_book WHERE fixed_asset_id = fa.id)
    )`;

export const FA_FILTER_FIELDS: FilterFieldDef[] = [
  { key: 'no', label: 'No.', type: 'text', column: 'fa.no' },
  { key: 'description', label: 'Description', type: 'text', column: 'fa.description' },
  { key: 'fa_class_code', label: 'FA Class', type: 'select', column: 'fa.fa_class_code' },
  { key: 'fa_location_code', label: 'FA Location', type: 'select', column: 'fa.fa_location_code' },
  {
    key: 'blocked', label: 'Blocked', type: 'select', column: 'fa.blocked',
    options: [{ value: '1', label: 'Blocked' }, { value: '0', label: 'Not blocked' }],
  },
];

const SORT_COLUMNS: Record<string, string> = {
  no: 'fa.no',
  description: 'fa.description',
  class: 'fa.fa_class_code',
  location: 'fa.fa_location_code',
  acquisition_date: 'fa.acquisition_date',
  book_value: 'book_value',
};

export interface ListFixedAssetsOptions {
  search?: string;
  filters?: FilterCondition[];
  sort?: SortState | null;
}

export const listFixedAssets = (
  { search = '', filters = [], sort = null }: ListFixedAssetsOptions = {},
): Promise<FixedAssetListRow[]> => {
  const { clause, params } = buildFilterClause(FA_FILTER_FIELDS, filters);
  const orderBy = buildOrderClause(SORT_COLUMNS, sort, 'fa.no');
  return all<FixedAssetListRow>(
    `${SELECT_ROW}
     WHERE (fa.no ILIKE @like OR fa.description ILIKE @like OR fa.asset_tag ILIKE @like OR fa.serial_no ILIKE @like)
       ${clause}
     ${orderBy}`,
    { like: `%${String(search).trim()}%`, ...params },
  );
};

export const getFixedAsset = (no: string): Promise<FixedAssetListRow | undefined> =>
  one<FixedAssetListRow>(`${SELECT_ROW} WHERE fa.no = ?`, no);

export const getFixedAssetById = (id: number): Promise<FixedAsset | undefined> =>
  one<FixedAsset>('SELECT * FROM fixed_asset WHERE id = ?', id);

export const hasAnyFixedAssets = (): Promise<boolean> => hasAnyRow('fixed_asset');

/* -------------------------------------------------------------------- create / edit */

export interface FixedAssetInput {
  description: string;
  description2?: string | null;
  faClassCode?: string | null;
  faSubclassCode?: string | null;
  faLocationCode?: string | null;
  responsibleEmployee?: string | null;
  serialNo?: string | null;
  vendorName?: string | null;
  assetTag?: string | null;
  globalDimension1Id?: number | null;
  globalDimension2Id?: number | null;
  blocked: boolean;
  inactive: boolean;
}

async function assertFixedAsset(input: FixedAssetInput, _excludeId: number | null): Promise<void> {
  if (!input.description?.trim()) throw new AppError('A description is required', 'VALIDATION');
}

const assetCols = `description, description_2, fa_class_code, fa_subclass_code, fa_location_code,
  responsible_employee, serial_no, vendor_name, asset_tag,
  global_dimension_1_id, global_dimension_2_id, blocked, inactive`;

const assetValues = (input: FixedAssetInput): unknown[] => [
  input.description.trim(), input.description2?.trim() || null, input.faClassCode || null,
  input.faSubclassCode || null, input.faLocationCode || null, input.responsibleEmployee?.trim() || null,
  input.serialNo?.trim() || null, input.vendorName?.trim() || null, input.assetTag?.trim() || null,
  input.globalDimension1Id || null, input.globalDimension2Id || null,
  input.blocked ? 1 : 0, input.inactive ? 1 : 0,
];

export async function createFixedAsset(input: FixedAssetInput, user: Actor): Promise<{ no: string }> {
  await assertFixedAsset(input, null);
  const no = await nextSequence('FIXED_ASSET');
  const values = [no, ...assetValues(input), new Date().toISOString(), user.username];
  await run(
    `INSERT INTO fixed_asset (no, ${assetCols}, created_at, created_by)
     VALUES (${values.map(() => '?').join(',')})`,
    ...values,
  );
  await audit(user, 'FIXED_ASSET_CREATE', 'fixed_asset', no, { description: input.description });
  return { no };
}

export async function updateFixedAsset(no: string, input: FixedAssetInput, user: Actor): Promise<void> {
  const before = await getFixedAsset(no);
  if (!before) throw new AppError('Fixed asset not found', 'NOT_FOUND');
  await assertFixedAsset(input, before.id);
  await run(
    `UPDATE fixed_asset SET
       description = ?, description_2 = ?, fa_class_code = ?, fa_subclass_code = ?, fa_location_code = ?,
       responsible_employee = ?, serial_no = ?, vendor_name = ?, asset_tag = ?,
       global_dimension_1_id = ?, global_dimension_2_id = ?, blocked = ?, inactive = ?
     WHERE id = ?`,
    ...assetValues(input), before.id,
  );
  await audit(user, 'FIXED_ASSET_UPDATE', 'fixed_asset', no, {});
}

/* --------------------------------------------------------- FA Depreciation Book */

export const getFaDepreciationBooks = (fixedAssetId: number): Promise<FaDepreciationBookView[]> =>
  all<FaDepreciationBookView>(
    `SELECT b.*, fa.no AS fixed_asset_no, fa.description AS fixed_asset_description,
            g.description AS fa_posting_group_description
     FROM fa_depreciation_book b
     JOIN fixed_asset fa ON fa.id = b.fixed_asset_id
     JOIN fa_posting_group g ON g.code = b.fa_posting_group_code
     WHERE b.fixed_asset_id = ?
     ORDER BY b.depreciation_book_code`,
    fixedAssetId,
  );

export const getFaDepreciationBook = (
  fixedAssetId: number, bookCode: string,
): Promise<FaDepreciationBook | undefined> =>
  one<FaDepreciationBook>(
    'SELECT * FROM fa_depreciation_book WHERE fixed_asset_id = ? AND depreciation_book_code = ?',
    fixedAssetId, bookCode,
  );

export interface FaDepreciationBookInput {
  depreciationBookCode: string;
  faPostingGroupCode: string;
  depreciationMethod: FaDepreciationMethod;
  depreciationStartingDate: IsoDate | null;
  depreciationEndingDate: IsoDate | null;
  noOfDepreciationYears: number | null;
  straightLinePct: number;
  decliningBalancePct: number;
  salvageValue: Cents;
  disposalCalculationMethod: 'Net' | 'Gross';
}

function assertBookInput(input: FaDepreciationBookInput): void {
  if (!input.depreciationBookCode) throw new AppError('A depreciation book is required', 'VALIDATION');
  if (!input.faPostingGroupCode) throw new AppError('An FA posting group is required', 'VALIDATION');
  if (!DEPRECIATION_METHODS.includes(input.depreciationMethod)) throw new AppError('Invalid depreciation method', 'VALIDATION');
  if (input.salvageValue < 0) throw new AppError('Salvage value cannot be negative', 'VALIDATION');

  if (input.depreciationMethod !== 'Manual') {
    if (!input.depreciationStartingDate) throw new AppError('A Depreciation Starting Date is required', 'VALIDATION');
    if (input.depreciationEndingDate && input.depreciationStartingDate
      && input.depreciationEndingDate <= input.depreciationStartingDate) {
      throw new AppError('The Depreciation Ending Date must be after the Starting Date', 'VALIDATION');
    }
    if (input.depreciationMethod === 'Straight-Line'
      && !input.straightLinePct && !input.noOfDepreciationYears && !input.depreciationEndingDate) {
      throw new AppError('Straight-Line depreciation needs a Straight-Line %, a No. of Depreciation Years, or an Ending Date', 'VALIDATION');
    }
    if ((input.depreciationMethod === 'Declining-Balance 1' || input.depreciationMethod === 'DB1/SL')
      && !(input.decliningBalancePct > 0)) {
      throw new AppError('A Declining-Balance % greater than zero is required for this method', 'VALIDATION');
    }
  }
}

export async function setFaDepreciationBook(
  fixedAssetId: number, input: FaDepreciationBookInput, user: Actor,
): Promise<void> {
  assertBookInput(input);
  const asset = await getFixedAssetById(fixedAssetId);
  if (!asset) throw new AppError('Fixed asset not found', 'NOT_FOUND');
  if (!(await hasAnyRow('depreciation_book', 'code = ?', input.depreciationBookCode))) {
    throw new AppError('Unknown depreciation book', 'VALIDATION');
  }
  if (!(await hasAnyRow('fa_posting_group', 'code = ?', input.faPostingGroupCode))) {
    throw new AppError('Unknown FA posting group', 'VALIDATION');
  }

  const existing = await getFaDepreciationBook(fixedAssetId, input.depreciationBookCode);
  if (existing) {
    const hasDepr = await hasAnyRow(
      'fa_ledger_entry',
      "fixed_asset_id = ? AND depreciation_book_code = ? AND fa_posting_type = 'Depreciation'",
      fixedAssetId, input.depreciationBookCode,
    );
    if (hasDepr && input.depreciationMethod !== existing.depreciation_method) {
      throw new AppError('The Depreciation Method cannot change once depreciation has been posted for this asset', 'VALIDATION');
    }
    await run(
      `UPDATE fa_depreciation_book SET
         fa_posting_group_code = ?, depreciation_method = ?, depreciation_starting_date = ?,
         depreciation_ending_date = ?, no_of_depreciation_years = ?, straight_line_pct = ?,
         declining_balance_pct = ?, salvage_value = ?, disposal_calculation_method = ?
       WHERE id = ?`,
      input.faPostingGroupCode, input.depreciationMethod, input.depreciationStartingDate || null,
      input.depreciationEndingDate || null, input.noOfDepreciationYears ?? null,
      input.straightLinePct || 0, input.decliningBalancePct || 0, Math.round(input.salvageValue),
      input.disposalCalculationMethod, existing.id,
    );
  } else {
    await run(
      `INSERT INTO fa_depreciation_book
        (fixed_asset_id, depreciation_book_code, fa_posting_group_code, depreciation_method,
         depreciation_starting_date, depreciation_ending_date, no_of_depreciation_years,
         straight_line_pct, declining_balance_pct, salvage_value, disposal_calculation_method)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      fixedAssetId, input.depreciationBookCode, input.faPostingGroupCode, input.depreciationMethod,
      input.depreciationStartingDate || null, input.depreciationEndingDate || null,
      input.noOfDepreciationYears ?? null, input.straightLinePct || 0, input.decliningBalancePct || 0,
      Math.round(input.salvageValue), input.disposalCalculationMethod,
    );
  }
  await audit(user, 'FA_DEPRECIATION_BOOK_SAVE', 'fixed_asset', asset.no, { book: input.depreciationBookCode });
}

/* --------------------------------------------------------------- ledger drill-down */

export const listFaLedgerEntries = (
  { fixedAssetId, bookCode, postingType }: { fixedAssetId?: number; bookCode?: string; postingType?: string } = {},
): Promise<FaLedgerEntryView[]> => all<FaLedgerEntryView>(
  `SELECT e.*, fa.no AS fixed_asset_no, fa.description AS fixed_asset_description
   FROM fa_ledger_entry e
   JOIN fixed_asset fa ON fa.id = e.fixed_asset_id
   WHERE 1=1
     ${fixedAssetId ? 'AND e.fixed_asset_id = @fixedAssetId' : ''}
     ${bookCode ? 'AND e.depreciation_book_code = @bookCode' : ''}
     ${postingType ? 'AND e.fa_posting_type = @postingType' : ''}
   ORDER BY e.fa_posting_date DESC, e.id DESC`,
  { fixedAssetId, bookCode, postingType },
);

export const hasAnyFaLedgerEntries = (): Promise<boolean> => hasAnyRow('fa_ledger_entry');

/* -------------------------------------------------------- disposal via a Sales Document */

export interface FaDisposalLegs {
  glLines: { account: number; debit: Cents; credit: Cents; narration: string }[];
  gainLoss: Cents;
  faLedgerEntryId: number;
  bookValue: Cents;
}

/**
 * Disposes a fixed asset as a **Sales Document Fixed Asset line** (Business Central Sales Line
 * Type = Fixed Asset). Builds the balanced *non-proceeds* G/L legs (the caller's Sales journal
 * already debits Receivables for the proceeds), writes the `fa_ledger_entry` (Disposal), resets
 * the `fa_depreciation_book` roll-ups (`book_value → 0`, `disposed = 1`), and stamps
 * `fixed_asset.disposal_date`. Call inside the sales-posting transaction; does NOT post a
 * journal or touch `fa_journal_line`.
 *
 * Keep the leg / roll-up maths in step with `postFaJournalLine`'s own Disposal branch
 * (lib/faJournal.ts) — the two implement the same Business Central FA disposal.
 */
export async function disposeFixedAssetForSale(
  fixedAssetId: number, bookCode: string, proceeds: Cents, postingDate: IsoDate,
  documentNo: string, description: string | null, user: Actor,
): Promise<FaDisposalLegs> {
  const asset = await one<{ id: number; no: string; blocked: 0 | 1 }>(
    'SELECT id, no, blocked FROM fixed_asset WHERE id = ?', fixedAssetId,
  );
  if (!asset) throw new AppError('Fixed asset not found', 'NOT_FOUND');
  if (asset.blocked) throw new AppError(`Fixed asset ${asset.no} is blocked`, 'VALIDATION');

  const book = await one<{
    id: number; fa_posting_group_code: string; disposed: 0 | 1;
    acquisition_cost: Cents; accumulated_depreciation: Cents; write_down_amount: Cents;
    appreciation_amount: Cents; book_value: Cents;
  }>(
    `SELECT id, fa_posting_group_code, disposed, acquisition_cost, accumulated_depreciation,
            write_down_amount, appreciation_amount, book_value
     FROM fa_depreciation_book WHERE fixed_asset_id = ? AND depreciation_book_code = ?`,
    fixedAssetId, bookCode,
  );
  if (!book) throw new AppError(`Asset ${asset.no} has no FA Depreciation Book for ${bookCode}`, 'VALIDATION');
  if (book.disposed) throw new AppError(`Asset ${asset.no} has already been disposed for ${bookCode}`, 'VALIDATION');
  if (book.acquisition_cost <= 0) throw new AppError(`Asset ${asset.no} has no acquisition cost posted`, 'VALIDATION');

  const pg = await one<{
    acquisition_cost_account_id: number; accum_depreciation_account_id: number;
    gains_acc_on_disposal_id: number; losses_acc_on_disposal_id: number;
  }>('SELECT * FROM fa_posting_group WHERE code = ?', book.fa_posting_group_code);
  if (!pg) throw new AppError(`Asset ${asset.no}'s FA posting group is missing its account setup`, 'VALIDATION');

  const tag = `Disposal ${documentNo} — ${asset.no}${description ? ` (${description})` : ''}`.slice(0, 250);
  const costToReverse = book.acquisition_cost + book.appreciation_amount;
  const accumToReverse = -(book.accumulated_depreciation + book.write_down_amount);
  const gainLoss = proceeds - book.book_value;

  const glLines: FaDisposalLegs['glLines'] = [];
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

  const ile = await run(
    `INSERT INTO fa_ledger_entry
       (fixed_asset_id, depreciation_book_code, fa_posting_date, fa_posting_type, document_no, description,
        amount, journal_id, fa_journal_line_id, part_of_book_value, created_at)
     VALUES (?,?,?, 'Disposal', ?,?,?, NULL, NULL, 1, ?)`,
    fixedAssetId, bookCode, postingDate, documentNo, description || tag, -book.book_value, new Date().toISOString(),
  );

  await run(
    `UPDATE fa_depreciation_book SET
       acquisition_cost = acquisition_cost - ?,
       accumulated_depreciation = accumulated_depreciation - ?,
       write_down_amount = write_down_amount - ?,
       appreciation_amount = appreciation_amount - ?,
       book_value = 0,
       proceeds_on_disposal = proceeds_on_disposal + ?,
       gain_loss_on_disposal = gain_loss_on_disposal + ?,
       disposed = 1
     WHERE id = ?`,
    book.acquisition_cost, book.accumulated_depreciation, book.write_down_amount, book.appreciation_amount,
    proceeds, gainLoss, book.id,
  );
  await run('UPDATE fixed_asset SET disposal_date = ? WHERE id = ?', postingDate, fixedAssetId);
  await audit(user, 'FA_DISPOSAL_VIA_SALES', 'fixed_asset', asset.no, { documentNo, proceeds, gainLoss });

  return { glLines, gainLoss, faLedgerEntryId: Number(ile.lastInsertRowid), bookValue: book.book_value };
}

/* ------------------------------------------------- acquisition via a Purchase Document */

export interface FaAcquisitionLegs {
  glLines: { account: number; debit: Cents; credit: Cents; narration: string }[];
  faLedgerEntryId: number;
}

/**
 * Acquires a fixed asset as a **Purchase Document Fixed Asset line** (Business Central Purchase
 * Line Type = Fixed Asset). The mirror of `disposeFixedAssetForSale()`: builds the single Dr
 * **Acquisition Cost account** leg (the Cr Payables is in the purchase invoice header), writes an
 * `fa_ledger_entry` (Acquisition Cost, `part_of_book_value = 1`), adds `cost` to the
 * `fa_depreciation_book` roll-ups (`acquisition_cost` + `book_value`) and stamps
 * `fixed_asset.acquisition_date`. Call inside the purchase-posting transaction; does NOT post a
 * journal or touch `fa_journal_line`.
 *
 * Keep in step with `postFaJournalLine`'s own Acquisition Cost branch (lib/faJournal.ts).
 */
export async function acquireFixedAssetForPurchase(
  fixedAssetId: number, bookCode: string, cost: Cents, postingDate: IsoDate,
  documentNo: string, description: string | null, user: Actor,
): Promise<FaAcquisitionLegs> {
  if (!(cost > 0)) throw new AppError('A Fixed Asset purchase line needs an acquisition cost greater than zero', 'VALIDATION');
  const asset = await one<{ id: number; no: string; blocked: 0 | 1 }>(
    'SELECT id, no, blocked FROM fixed_asset WHERE id = ?', fixedAssetId,
  );
  if (!asset) throw new AppError('Fixed asset not found', 'NOT_FOUND');
  if (asset.blocked) throw new AppError(`Fixed asset ${asset.no} is blocked`, 'VALIDATION');

  const book = await one<{ id: number; fa_posting_group_code: string; disposed: 0 | 1; acquisition_cost: Cents }>(
    `SELECT id, fa_posting_group_code, disposed, acquisition_cost
     FROM fa_depreciation_book WHERE fixed_asset_id = ? AND depreciation_book_code = ?`,
    fixedAssetId, bookCode,
  );
  if (!book) throw new AppError(`Asset ${asset.no} has no FA Depreciation Book for ${bookCode}`, 'VALIDATION');
  if (book.disposed) throw new AppError(`Asset ${asset.no} has already been disposed for ${bookCode}`, 'VALIDATION');
  if (book.acquisition_cost > 0) {
    throw new AppError(`Asset ${asset.no} already has an acquisition cost posted for ${bookCode} — post further additions through the FA Journal`, 'VALIDATION');
  }

  const pg = await one<{ acquisition_cost_account_id: number }>(
    'SELECT acquisition_cost_account_id FROM fa_posting_group WHERE code = ?', book.fa_posting_group_code,
  );
  if (!pg) throw new AppError(`Asset ${asset.no}'s FA posting group is missing its account setup`, 'VALIDATION');

  const tag = `Acquisition ${documentNo} — ${asset.no}${description ? ` (${description})` : ''}`.slice(0, 250);
  const glLines: FaAcquisitionLegs['glLines'] = [
    { account: pg.acquisition_cost_account_id, debit: cost, credit: 0, narration: tag },
  ];

  const ile = await run(
    `INSERT INTO fa_ledger_entry
       (fixed_asset_id, depreciation_book_code, fa_posting_date, fa_posting_type, document_no, description,
        amount, journal_id, fa_journal_line_id, part_of_book_value, created_at)
     VALUES (?,?,?, 'Acquisition Cost', ?,?,?, NULL, NULL, 1, ?)`,
    fixedAssetId, bookCode, postingDate, documentNo, description || tag, cost, new Date().toISOString(),
  );
  await run(
    'UPDATE fa_depreciation_book SET acquisition_cost = acquisition_cost + ?, book_value = book_value + ? WHERE id = ?',
    cost, cost, book.id,
  );
  await run('UPDATE fixed_asset SET acquisition_date = COALESCE(acquisition_date, ?) WHERE id = ?', postingDate, fixedAssetId);
  await audit(user, 'FA_ACQUISITION_VIA_PURCHASE', 'fixed_asset', asset.no, { documentNo, cost });

  return { glLines, faLedgerEntryId: Number(ile.lastInsertRowid) };
}
