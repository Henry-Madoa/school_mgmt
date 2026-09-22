/*
 * Item Journal — Business Central Table 83, scoped to Positive/Negative Adjmt. only (no
 * Purchase/Sale/Transfer/Consumption/Output entry types, no serial/lot tracking, no Item
 * Charges). No AL source exists for any of this: the companion AL extension never
 * touched BC's stock Inventory tables, so this module is built from Business Central domain
 * knowledge rather than ported field-for-field, matched to this codebase's own conventions —
 * closest precedent is lib/receipts.ts (maker-checker document -> postJournal()).
 *
 * Lifecycle: Open -> Pending Approval -> Approved -> Processed.
 *
 * Costing (item.costing_method — Business Central's own five):
 *   - Standard            unit_cost is always item.unit_cost; no lot tracking at all.
 *   - FIFO / LIFO         an outbound line consumes open inbound lots oldest/newest-first and is
 *                         costed at the blended cost of exactly what it consumed.
 *   - Average             an outbound line is costed at the blended average of *every* open lot
 *                         at that item+location, but still consumes lots FIFO-order underneath so
 *                         remaining_quantity/open stay meaningful.
 *   - Specific            the caller names one open lot; the full quantity must come from it.
 * FIFO/LIFO/Average/Specific write item_application_entry rows recording which lot(s) an outbound
 * entry consumed; Standard writes none. See costOutbound() below.
 *
 * Replenishment (calculateReplenishment()) is a computed report, not a stored table — same idea
 * as getTrialBalance() in lib/gl.ts. This app has no procurement/vendor module, so it only ever
 * raises a suggestion a human turns into a normal Positive Adjmt. line; it never becomes a PO.
 */
import {
  one, all, run, tx, nextSequence, audit, hasAnyRow,
} from './db.ts';
import { AppError } from './errors.ts';
import { postJournal } from './accounting.ts';
import { costOutbound, applyOutboundLots, type CostApplication } from './inventoryCosting.ts';
import { qtyPerUnitOfMeasure } from './unitOfMeasureConversion.ts';
import { findMatchingWorkflow, findPendingRoutedTask, pickConditionFields, startWorkflow } from './workflow.ts';
import { buildFilterClause, type FilterCondition, type FilterFieldDef } from './listFilters.ts';
import { buildOrderClause, type SortState } from './listSort.ts';
import type {
  Actor, Cents, IsoDate, ItemCostingMethod, ItemJournalEntryType, ItemJournalLine, ItemJournalLineView,
  ItemLedgerEntry, ItemLedgerEntryView, ItemApplicationEntryView, ReplenishmentSuggestion, ItemReorderingPolicy,
} from './types.ts';

export type ItemJournalView = 'open' | 'pending' | 'approved' | 'processed';

const VIEW_CLAUSE: Record<ItemJournalView, string> = {
  open: "ijl.status = 'Open'",
  pending: "ijl.status = 'Pending Approval'",
  approved: "ijl.status = 'Approved'",
  processed: "ijl.status = 'Processed'",
};

const SELECT_ROW = `
  SELECT ijl.*,
         i.no AS item_no, i.description AS item_description, i.costing_method AS item_costing_method,
         l.code AS location_code,
         uom.code AS unit_of_measure_code,
         j.journal_no AS journal_no,
         COALESCE(sku.inventory, 0) AS available_quantity
  FROM item_journal_line ijl
  JOIN item i ON i.id = ijl.item_id
  JOIN location l ON l.id = ijl.location_id
  JOIN unit_of_measure uom ON uom.id = ijl.unit_of_measure_id
  LEFT JOIN journal j ON j.id = ijl.journal_id
  LEFT JOIN stockkeeping_unit sku ON sku.item_id = ijl.item_id AND sku.location_id = ijl.location_id`;

export const ITEM_JOURNAL_FILTER_FIELDS: FilterFieldDef[] = [
  { key: 'no', label: 'No.', type: 'text', column: 'ijl.no' },
  { key: 'item_id', label: 'Item', type: 'select', column: 'ijl.item_id' },
  { key: 'location_id', label: 'Location', type: 'select', column: 'ijl.location_id' },
  {
    key: 'entry_type', label: 'Entry Type', type: 'select', column: 'ijl.entry_type',
    options: [{ value: 'Positive Adjmt.', label: 'Positive Adjmt.' }, { value: 'Negative Adjmt.', label: 'Negative Adjmt.' }],
  },
  { key: 'posting_date', label: 'Posting Date', type: 'date', column: 'ijl.posting_date' },
  { key: 'created_by', label: 'Created By', type: 'text', column: 'ijl.created_by' },
];

const SORT_COLUMNS: Record<string, string> = {
  no: 'ijl.no',
  item: 'i.no',
  posting_date: 'ijl.posting_date',
  quantity: 'ijl.base_quantity',
  amount: 'ijl.amount',
  status: 'ijl.status',
  created_at: 'ijl.created_at',
};

export interface ListItemJournalLinesOptions {
  view?: ItemJournalView;
  search?: string;
  filters?: FilterCondition[];
  sort?: SortState | null;
}

export const listItemJournalLines = (
  { view, search = '', filters = [], sort = null }: ListItemJournalLinesOptions = {},
): Promise<ItemJournalLineView[]> => {
  const { clause, params } = buildFilterClause(ITEM_JOURNAL_FILTER_FIELDS, filters);
  const orderBy = buildOrderClause(SORT_COLUMNS, sort, 'ijl.no DESC');
  return all<ItemJournalLineView>(
    `${SELECT_ROW}
     WHERE (ijl.no ILIKE @like OR i.no ILIKE @like OR i.description ILIKE @like)
       ${view ? `AND ${VIEW_CLAUSE[view]}` : ''}
       ${clause}
     ${orderBy}`,
    { like: `%${String(search).trim()}%`, ...params },
  );
};

export const getItemJournalLine = (no: string): Promise<ItemJournalLineView | undefined> =>
  one<ItemJournalLineView>(`${SELECT_ROW} WHERE ijl.no = ?`, no);

export const hasAnyItemJournalLines = (view?: ItemJournalView): Promise<boolean> =>
  hasAnyRow('item_journal_line ijl', view ? VIEW_CLAUSE[view] : undefined);

/** Open inbound lots at an item+location — feeds the Specific-costing lot picker. */
export const openLotsForItem = (itemId: number, locationId: number): Promise<ItemLedgerEntry[]> =>
  all<ItemLedgerEntry>(
    `SELECT * FROM item_ledger_entry
     WHERE item_id = ? AND location_id = ? AND open = true AND remaining_quantity > 0
     ORDER BY posting_date, id`,
    itemId, locationId,
  );

export interface ListItemLedgerEntriesOptions {
  itemId?: number;
  locationId?: number;
}

export const listItemLedgerEntries = (
  { itemId, locationId }: ListItemLedgerEntriesOptions = {},
): Promise<ItemLedgerEntryView[]> => all<ItemLedgerEntryView>(
  `SELECT ile.*, i.no AS item_no, i.description AS item_description, l.code AS location_code
   FROM item_ledger_entry ile
   JOIN item i ON i.id = ile.item_id
   JOIN location l ON l.id = ile.location_id
   WHERE 1=1 ${itemId ? 'AND ile.item_id = @itemId' : ''} ${locationId ? 'AND ile.location_id = @locationId' : ''}
   ORDER BY ile.posting_date DESC, ile.id DESC`,
  { itemId, locationId },
);

export const listItemApplicationEntries = (outboundEntryId: number): Promise<ItemApplicationEntryView[]> =>
  all<ItemApplicationEntryView>(
    `SELECT iae.*, ile.document_no AS inbound_document_no, ile.unit_cost AS inbound_unit_cost
     FROM item_application_entry iae
     JOIN item_ledger_entry ile ON ile.id = iae.inbound_entry_id
     WHERE iae.outbound_entry_id = ?
     ORDER BY iae.id`,
    outboundEntryId,
  );

/* ------------------------------------------------------------------- create / edit */

export interface ItemJournalLineInput {
  postingDate: IsoDate;
  entryType: ItemJournalEntryType;
  itemId: number;
  locationId: number;
  description?: string | null;
  unitOfMeasureId: number;
  quantity: number;
  /** Positive Adjmt. only — overrides the item's own unit_cost for this line. */
  unitCost?: Cents | null;
  /** Negative Adjmt. + Specific costing only — which open lot this line applies to. */
  appliesToEntryId?: number | null;
}

interface ItemForJournal {
  id: number; status: string; unit_cost: Cents; costing_method: ItemCostingMethod;
}

function assertMandatory(input: ItemJournalLineInput, item: ItemForJournal): void {
  if (input.entryType !== 'Positive Adjmt.' && input.entryType !== 'Negative Adjmt.') {
    throw new AppError('Invalid entry type', 'VALIDATION');
  }
  if (!input.locationId) throw new AppError('A location is required', 'VALIDATION');
  if (!input.unitOfMeasureId) throw new AppError('A unit of measure is required', 'VALIDATION');
  if (!input.postingDate) throw new AppError('A posting date is required', 'VALIDATION');
  if (!(input.quantity > 0)) throw new AppError('Quantity must be greater than zero', 'VALIDATION');
  if (input.unitCost != null && input.unitCost < 0) throw new AppError('Unit cost cannot be negative', 'VALIDATION');
  if (input.entryType === 'Negative Adjmt.' && item.costing_method === 'Specific' && !input.appliesToEntryId) {
    throw new AppError('Pick the specific lot this negative adjustment applies to', 'VALIDATION');
  }
}

/** Shared by create/update — resolves the UoM conversion and a best-effort cost estimate.
 *  Negative Adjmt. costing can legitimately fail here (not enough stock *yet* — a Positive Adjmt.
 *  further up the approval queue may still land first), so the estimate falls back to 0 rather
 *  than blocking the save; postItemJournalLine() re-runs the same engine authoritatively. */
async function computeLine(
  input: ItemJournalLineInput, item: ItemForJournal,
): Promise<{ factor: number; baseQuantity: number; unitCost: Cents; amount: Cents }> {
  const factor = await qtyPerUnitOfMeasure(item.id, input.unitOfMeasureId);
  const baseQuantity = Math.round(input.quantity * factor);

  if (input.entryType === 'Positive Adjmt.') {
    const unitCost = input.unitCost ?? item.unit_cost;
    return { factor, baseQuantity, unitCost, amount: baseQuantity * unitCost };
  }
  try {
    const costed = await costOutbound(item.id, input.locationId, item.costing_method, baseQuantity, input.appliesToEntryId ?? null);
    return { factor, baseQuantity, unitCost: costed.unitCost, amount: baseQuantity * costed.unitCost };
  } catch {
    return { factor, baseQuantity, unitCost: 0, amount: 0 };
  }
}

async function getActiveItem(itemId: number): Promise<ItemForJournal> {
  const item = await one<ItemForJournal>(
    'SELECT id, status, unit_cost, costing_method FROM item WHERE id = ?', itemId,
  );
  if (!item) throw new AppError('Item not found', 'NOT_FOUND');
  if (item.status !== 'ACTIVE') throw new AppError('This item is blocked', 'VALIDATION');
  return item;
}

async function assertActiveLocation(locationId: number): Promise<void> {
  const location = await one<{ status: string }>('SELECT status FROM location WHERE id = ?', locationId);
  if (!location) throw new AppError('Location not found', 'NOT_FOUND');
  if (location.status !== 'ACTIVE') throw new AppError('This location is not active', 'VALIDATION');
}

export async function createItemJournalLine(input: ItemJournalLineInput, user: Actor): Promise<{ no: string }> {
  const item = await getActiveItem(input.itemId);
  assertMandatory(input, item);
  await assertActiveLocation(input.locationId);
  const c = await computeLine(input, item);

  const no = await nextSequence('ITEM_JOURNAL');
  await run(
    `INSERT INTO item_journal_line
       (no, posting_date, entry_type, item_id, location_id, description, unit_of_measure_id,
        qty_per_unit_of_measure, quantity, base_quantity, applies_to_entry_id, unit_cost, amount,
        created_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    no, input.postingDate, input.entryType, item.id, input.locationId, input.description?.trim() || null,
    input.unitOfMeasureId, c.factor, Math.round(input.quantity), c.baseQuantity, input.appliesToEntryId ?? null,
    Math.round(c.unitCost), Math.round(c.amount), new Date().toISOString(), user.username,
  );
  await audit(user, 'ITEM_JOURNAL_CREATE', 'item_journal_line', no, { itemId: item.id, entryType: input.entryType });
  return { no };
}

export async function updateItemJournalLine(no: string, input: ItemJournalLineInput, user: Actor): Promise<void> {
  const before = await one<ItemJournalLine>('SELECT * FROM item_journal_line WHERE no = ?', no);
  if (!before) throw new AppError('Item journal line not found', 'NOT_FOUND');
  if (before.status !== 'Open') throw new AppError('Only an open line can be edited', 'VALIDATION');
  if (before.created_by !== user.username) throw new AppError('Only the person who created this can edit it', 'NOT_CREATOR');

  const item = await getActiveItem(input.itemId);
  assertMandatory(input, item);
  await assertActiveLocation(input.locationId);
  const c = await computeLine(input, item);

  await run(
    `UPDATE item_journal_line
     SET posting_date = ?, entry_type = ?, item_id = ?, location_id = ?, description = ?, unit_of_measure_id = ?,
         qty_per_unit_of_measure = ?, quantity = ?, base_quantity = ?, applies_to_entry_id = ?, unit_cost = ?, amount = ?
     WHERE no = ?`,
    input.postingDate, input.entryType, item.id, input.locationId, input.description?.trim() || null,
    input.unitOfMeasureId, c.factor, Math.round(input.quantity), c.baseQuantity, input.appliesToEntryId ?? null,
    Math.round(c.unitCost), Math.round(c.amount), no,
  );
  await audit(user, 'ITEM_JOURNAL_UPDATE', 'item_journal_line', no, {});
}

export async function deleteItemJournalLine(no: string, user: Actor): Promise<void> {
  const before = await one<Pick<ItemJournalLine, 'status' | 'created_by'>>(
    'SELECT status, created_by FROM item_journal_line WHERE no = ?', no,
  );
  if (!before) throw new AppError('Item journal line not found', 'NOT_FOUND');
  if (before.status !== 'Open') throw new AppError('Only an open line can be deleted', 'VALIDATION');
  if (before.created_by !== user.username) throw new AppError('Only the person who created this can delete it', 'NOT_CREATOR');
  await run('DELETE FROM item_journal_line WHERE no = ?', no);
  await audit(user, 'ITEM_JOURNAL_DELETE', 'item_journal_line', no, {});
}

/* -------------------------------------------------------------- maker-checker */

export async function submitItemJournalLine(no: string, user: Actor): Promise<{ autoApproved: boolean }> {
  const req = await one<ItemJournalLine>('SELECT * FROM item_journal_line WHERE no = ?', no);
  if (!req) throw new AppError('Item journal line not found', 'NOT_FOUND');
  if (req.status !== 'Open') throw new AppError('Only an open line can be submitted for approval', 'VALIDATION');

  const matched = await findMatchingWorkflow('ITEM_JOURNAL', await pickConditionFields('ITEM_JOURNAL', req));
  if (!matched) throw new AppError('There is no enabled workflow for this document', 'NO_WORKFLOW');

  await tx(async () => {
    await run("UPDATE item_journal_line SET status = 'Pending Approval' WHERE no = ?", no);
    await startWorkflow(matched.workflow, matched.steps, {
      documentType: 'ITEM_JOURNAL', entityId: no, requestedBy: user.username, amount: Number(req.amount),
    });
  });

  const after = await one<{ status: string }>('SELECT status FROM item_journal_line WHERE no = ?', no);
  return { autoApproved: after?.status === 'Approved' };
}

export async function cancelItemJournalLineApproval(no: string, user: Actor): Promise<void> {
  const req = await one<Pick<ItemJournalLine, 'status' | 'created_by'>>(
    'SELECT status, created_by FROM item_journal_line WHERE no = ?', no,
  );
  if (!req) throw new AppError('Item journal line not found', 'NOT_FOUND');
  if (req.status !== 'Pending Approval') throw new AppError('Only a line pending approval can be recalled', 'VALIDATION');
  const routed = await findPendingRoutedTask('ITEM_JOURNAL', no);
  const requestedBy = routed?.requested_by ?? req.created_by;
  if (requestedBy !== user.username) throw new AppError('Only the person who submitted this can recall it', 'NOT_REQUESTER');
  await run("UPDATE item_journal_line SET status = 'Open' WHERE no = ?", no);
  await audit(user, 'ITEM_JOURNAL_CANCEL_APPROVAL', 'item_journal_line', no, {});
}

export async function approveItemJournalLine(no: string, user: Actor): Promise<void> {
  const req = await one<ItemJournalLine>('SELECT * FROM item_journal_line WHERE no = ?', no);
  if (!req) throw new AppError('Item journal line not found', 'NOT_FOUND');
  if (req.status !== 'Pending Approval') throw new AppError('Only a line pending approval can be approved', 'VALIDATION');
  await run("UPDATE item_journal_line SET status = 'Approved', decision_reason = NULL WHERE no = ?", no);
  await audit(user, 'ITEM_JOURNAL_APPROVE', 'item_journal_line', no, {});
}

export async function rejectItemJournalLine(no: string, reason: string | null, user: Actor): Promise<void> {
  if (!reason || !reason.trim()) throw new AppError('A reason is required to reject an item journal line', 'VALIDATION');
  const req = await one<ItemJournalLine>('SELECT * FROM item_journal_line WHERE no = ?', no);
  if (!req) throw new AppError('Item journal line not found', 'NOT_FOUND');
  if (req.status !== 'Pending Approval') throw new AppError('Only a line pending approval can be rejected', 'VALIDATION');
  await run("UPDATE item_journal_line SET status = 'Open', decision_reason = ? WHERE no = ?", reason, no);
  await audit(user, 'ITEM_JOURNAL_REJECT', 'item_journal_line', no, { reason });
}

export async function reopenItemJournalLine(no: string, user: Actor): Promise<void> {
  const req = await one<ItemJournalLine>('SELECT * FROM item_journal_line WHERE no = ?', no);
  if (!req) throw new AppError('Item journal line not found', 'NOT_FOUND');
  if (req.status !== 'Approved' || req.posted) {
    throw new AppError('Only an approved line that has not been posted can be reopened', 'VALIDATION');
  }
  await run("UPDATE item_journal_line SET status = 'Open' WHERE no = ?", no);
  await audit(user, 'ITEM_JOURNAL_REOPEN', 'item_journal_line', no, {});
}

/* ------------------------------------------------------------------- posting */

export async function postItemJournalLine(
  no: string, user: Actor,
): Promise<{ journalNo: string | null; itemInventory: number }> {
  return tx(async () => {
    const line = await one<ItemJournalLine>('SELECT * FROM item_journal_line WHERE no = ?', no);
    if (!line) throw new AppError('Item journal line not found', 'NOT_FOUND');
    if (line.posted) throw new AppError('This line has already been posted', 'VALIDATION');
    if (line.status !== 'Approved') throw new AppError('Only an approved line can be posted', 'VALIDATION');

    const item = await one<{
      id: number; no: string; status: string; costing_method: ItemCostingMethod;
      inventory_posting_group_id: number; product_posting_group_id: number;
    }>('SELECT id, no, status, costing_method, inventory_posting_group_id, product_posting_group_id FROM item WHERE id = ?', line.item_id);
    if (!item) throw new AppError('Item not found', 'NOT_FOUND');
    if (item.status !== 'ACTIVE') throw new AppError('This item is blocked', 'VALIDATION');

    let unitCost: Cents;
    let amount: Cents;
    let applications: CostApplication[] = [];

    if (line.entry_type === 'Positive Adjmt.') {
      unitCost = line.unit_cost;
      amount = line.base_quantity * unitCost;
    } else {
      const sku = await one<{ inventory: number }>(
        'SELECT inventory FROM stockkeeping_unit WHERE item_id = ? AND location_id = ?', item.id, line.location_id,
      );
      const available = sku?.inventory ?? 0;
      if (available < line.base_quantity) {
        throw new AppError(`Only ${available} unit(s) are on hand at this location`, 'VALIDATION');
      }
      const costed = await costOutbound(item.id, line.location_id, item.costing_method, line.base_quantity, line.applies_to_entry_id);
      unitCost = costed.unitCost;
      amount = line.base_quantity * unitCost;
      applications = costed.applications;
    }

    const vd = line.posting_date;
    let journalNo: string | null = null;
    let journalId: number | null = null;

    if (amount !== 0) {
      const postingGroup = await one<{ inventory_gl_account_id: number }>(
        'SELECT inventory_gl_account_id FROM inventory_posting_group WHERE id = ?', item.inventory_posting_group_id,
      );
      const productGroup = await one<{ adjustment_gl_account_id: number }>(
        'SELECT adjustment_gl_account_id FROM product_posting_group WHERE id = ?', item.product_posting_group_id,
      );
      const narration = `${line.entry_type} ${no} — ${item.no}${line.description ? ` (${line.description})` : ''}`.slice(0, 250);
      const glLines = line.entry_type === 'Positive Adjmt.'
        ? [
          { account: postingGroup!.inventory_gl_account_id, debit: amount, credit: 0, narration },
          { account: productGroup!.adjustment_gl_account_id, debit: 0, credit: amount, narration },
        ]
        : [
          { account: productGroup!.adjustment_gl_account_id, debit: amount, credit: 0, narration },
          { account: postingGroup!.inventory_gl_account_id, debit: 0, credit: amount, narration },
        ];
      const j = await postJournal({
        valueDate: vd, module: 'INVENTORY',
        eventType: line.entry_type === 'Positive Adjmt.' ? 'ITEM_POSITIVE_ADJMT' : 'ITEM_NEGATIVE_ADJMT',
        description: narration, reference: no, user,
        idempotencyKey: `ITEM_JOURNAL-${no}`,
        lines: glLines,
      });
      journalNo = j.journal_no;
      journalId = j.id;
    }

    const ileInfo = await run(
      `INSERT INTO item_ledger_entry
         (item_id, location_id, posting_date, entry_type, document_no, quantity, remaining_quantity, open,
          unit_cost, amount, item_journal_line_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      item.id, line.location_id, vd, line.entry_type, no,
      line.entry_type === 'Positive Adjmt.' ? line.base_quantity : -line.base_quantity,
      line.entry_type === 'Positive Adjmt.' ? line.base_quantity : 0,
      line.entry_type === 'Positive Adjmt.',
      unitCost, amount, line.id, new Date().toISOString(),
    );
    const outboundEntryId = Number(ileInfo.lastInsertRowid);

    await applyOutboundLots(outboundEntryId, applications, vd);

    const delta = line.entry_type === 'Positive Adjmt.' ? line.base_quantity : -line.base_quantity;
    const sku = await one<{ id: number; inventory: number }>(
      'SELECT id, inventory FROM stockkeeping_unit WHERE item_id = ? AND location_id = ?', item.id, line.location_id,
    );
    if (!sku) {
      await run('INSERT INTO stockkeeping_unit (item_id, location_id, inventory) VALUES (?,?,?)', item.id, line.location_id, delta);
    } else {
      await run('UPDATE stockkeeping_unit SET inventory = ? WHERE id = ?', sku.inventory + delta, sku.id);
    }

    const rollup = await one<{ total: number }>(
      'SELECT COALESCE(SUM(inventory),0) AS total FROM stockkeeping_unit WHERE item_id = ?', item.id,
    );
    const itemInventory = rollup?.total ?? 0;
    await run('UPDATE item SET inventory = ? WHERE id = ?', itemInventory, item.id);

    await run(
      `UPDATE item_journal_line
       SET status = 'Processed', posted = true, unit_cost = ?, amount = ?, journal_id = ?, posted_at = ?, posted_by = ?
       WHERE no = ?`,
      unitCost, amount, journalId, new Date().toISOString(), user.username, no,
    );
    await audit(user, 'ITEM_JOURNAL_POST', 'item_journal_line', no, { journalNo, amount });
    return { journalNo, itemInventory };
  });
}

/* -------------------------------------------------------------- replenishment */

/** BC-style reorder-point replenishment, computed live (nothing persists until a suggestion is
 *  turned into a real Positive Adjmt. line). Scoped to item+location combinations that already
 *  have a stockkeeping_unit row — a location an item has never posted at has nothing to suggest. */
export async function calculateReplenishment(): Promise<ReplenishmentSuggestion[]> {
  const rows = await all<{
    item_id: number; item_no: string; item_description: string; location_id: number; location_code: string;
    reordering_policy: ItemReorderingPolicy; inventory: number; reorder_point: number;
    reorder_quantity: number; maximum_inventory: number;
  }>(
    `SELECT i.id AS item_id, i.no AS item_no, i.description AS item_description,
            l.id AS location_id, l.code AS location_code,
            COALESCE(sku.reordering_policy, i.reordering_policy) AS reordering_policy,
            sku.inventory AS inventory,
            COALESCE(sku.reorder_point, i.reorder_point) AS reorder_point,
            COALESCE(sku.reorder_quantity, i.reorder_quantity) AS reorder_quantity,
            COALESCE(sku.maximum_inventory, i.maximum_inventory) AS maximum_inventory
     FROM stockkeeping_unit sku
     JOIN item i ON i.id = sku.item_id
     JOIN location l ON l.id = sku.location_id
     WHERE i.status = 'ACTIVE' AND sku.inventory <= COALESCE(sku.reorder_point, i.reorder_point)
     ORDER BY i.no, l.code`,
  );
  return rows
    .map((r) => ({
      ...r,
      suggested_quantity: r.reordering_policy === 'Maximum Qty.'
        ? Math.max(r.maximum_inventory - r.inventory, 0)
        : r.reorder_quantity,
    }))
    .filter((r) => r.suggested_quantity > 0);
}
