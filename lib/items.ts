/*
 * Items — Business Central Table 27, trimmed (see prisma/schema.prisma's model comment for what
 * was left out and why). No AL source exists for this — see lib/itemJournal.ts's header.
 */
import {
  one, all, run, tx, nextSequence, audit, hasAnyRow,
} from './db.ts';
import { AppError } from './errors.ts';
import { setItemUnitsOfMeasure, type ItemUnitOfMeasureLineInput } from './unitOfMeasureConversion.ts';
import { buildFilterClause, type FilterCondition, type FilterFieldDef } from './listFilters.ts';
import { buildOrderClause, type SortState } from './listSort.ts';
import type {
  Actor, Cents, ItemCostingMethod, ItemListRow, ItemQuantityByLocationRow, ItemReorderingPolicy, StockByLocationRow,
} from './types.ts';

const SELECT_ROW = `
  SELECT i.*,
         buom.code AS base_unit_of_measure_code,
         puom.code AS purch_unit_of_measure_code,
         suom.code AS sales_unit_of_measure_code,
         ipg.code AS inventory_posting_group_code,
         ppg.code AS product_posting_group_code,
         (i.inventory <= i.reorder_point) AS below_reorder_point
  FROM item i
  JOIN unit_of_measure buom ON buom.id = i.base_unit_of_measure_id
  LEFT JOIN unit_of_measure puom ON puom.id = i.purch_unit_of_measure_id
  LEFT JOIN unit_of_measure suom ON suom.id = i.sales_unit_of_measure_id
  JOIN inventory_posting_group ipg ON ipg.id = i.inventory_posting_group_id
  JOIN product_posting_group ppg ON ppg.id = i.product_posting_group_id`;

export const ITEM_FILTER_FIELDS: FilterFieldDef[] = [
  { key: 'no', label: 'No.', type: 'text', column: 'i.no' },
  { key: 'description', label: 'Description', type: 'text', column: 'i.description' },
  {
    key: 'status', label: 'Status', type: 'select', column: 'i.status',
    options: [{ value: 'ACTIVE', label: 'Active' }, { value: 'BLOCKED', label: 'Blocked' }],
  },
  {
    key: 'costing_method', label: 'Costing Method', type: 'select', column: 'i.costing_method',
    options: ['FIFO', 'LIFO', 'Average', 'Standard', 'Specific'].map((v) => ({ value: v, label: v })),
  },
  { key: 'inventory_posting_group_id', label: 'Inventory Posting Group', type: 'select', column: 'i.inventory_posting_group_id' },
  { key: 'product_posting_group_id', label: 'Product Posting Group', type: 'select', column: 'i.product_posting_group_id' },
];

const SORT_COLUMNS: Record<string, string> = {
  no: 'i.no',
  description: 'i.description',
  inventory: 'i.inventory',
  unit_cost: 'i.unit_cost',
  status: 'i.status',
};

export interface ListItemsOptions {
  search?: string;
  filters?: FilterCondition[];
  sort?: SortState | null;
}

export const listItems = (
  { search = '', filters = [], sort = null }: ListItemsOptions = {},
): Promise<ItemListRow[]> => {
  const { clause, params } = buildFilterClause(ITEM_FILTER_FIELDS, filters);
  const orderBy = buildOrderClause(SORT_COLUMNS, sort, 'i.no');
  return all<ItemListRow>(
    `${SELECT_ROW}
     WHERE (i.no ILIKE @like OR i.description ILIKE @like)
       ${clause}
     ${orderBy}`,
    { like: `%${String(search).trim()}%`, ...params },
  );
};

export const getItem = (no: string): Promise<ItemListRow | undefined> =>
  one<ItemListRow>(`${SELECT_ROW} WHERE i.no = ?`, no);

export const hasAnyItems = (): Promise<boolean> => hasAnyRow('item');

/** Per-location qty-on-hand (business_central Table 5700), each row's reordering fields resolved
 *  against the item's own defaults wherever no per-location override is set. */
export async function itemStockByLocation(no: string): Promise<StockByLocationRow[]> {
  const item = await getItem(no);
  if (!item) throw new AppError('Item not found', 'NOT_FOUND');
  return all<StockByLocationRow>(
    `SELECT sku.*, l.code AS location_code, l.name AS location_name,
            COALESCE(sku.reordering_policy, @defPolicy) AS effective_reordering_policy,
            COALESCE(sku.reorder_point, @defPoint) AS effective_reorder_point,
            COALESCE(sku.reorder_quantity, @defQty) AS effective_reorder_quantity,
            COALESCE(sku.maximum_inventory, @defMax) AS effective_maximum_inventory
     FROM stockkeeping_unit sku JOIN location l ON l.id = sku.location_id
     WHERE sku.item_id = @itemId
     ORDER BY l.code`,
    {
      itemId: item.id, defPolicy: item.reordering_policy, defPoint: item.reorder_point,
      defQty: item.reorder_quantity, defMax: item.maximum_inventory,
    },
  );
}

/** "Item Quantities per Location" report — every item+location combination with a stockkeeping_unit
 *  row (i.e. anywhere the item has ever moved), its qty-on-hand, and its value at the item's
 *  current unit cost. */
export const ITEM_QUANTITY_FILTER_FIELDS: FilterFieldDef[] = [
  { key: 'item_id', label: 'Item', type: 'select', column: 'sku.item_id' },
  { key: 'location_id', label: 'Location', type: 'select', column: 'sku.location_id' },
];

const ITEM_QUANTITY_SORT_COLUMNS: Record<string, string> = {
  item: 'i.no',
  location: 'l.code',
  inventory: 'sku.inventory',
  value: '(sku.inventory * i.unit_cost)',
};

export interface ListItemQuantitiesByLocationOptions {
  search?: string;
  filters?: FilterCondition[];
  sort?: SortState | null;
}

export const hasAnyItemQuantities = (): Promise<boolean> => hasAnyRow('stockkeeping_unit');

export const listItemQuantitiesByLocation = (
  { search = '', filters = [], sort = null }: ListItemQuantitiesByLocationOptions = {},
): Promise<ItemQuantityByLocationRow[]> => {
  const { clause, params } = buildFilterClause(ITEM_QUANTITY_FILTER_FIELDS, filters);
  const orderBy = buildOrderClause(ITEM_QUANTITY_SORT_COLUMNS, sort, 'i.no, l.code');
  return all<ItemQuantityByLocationRow>(
    `SELECT i.id AS item_id, i.no AS item_no, i.description AS item_description,
            buom.code AS base_unit_of_measure_code,
            l.id AS location_id, l.code AS location_code, l.name AS location_name,
            sku.inventory AS inventory, i.unit_cost AS unit_cost,
            (sku.inventory * i.unit_cost) AS value,
            (sku.inventory <= COALESCE(sku.reorder_point, i.reorder_point)) AS below_reorder_point
     FROM stockkeeping_unit sku
     JOIN item i ON i.id = sku.item_id
     JOIN unit_of_measure buom ON buom.id = i.base_unit_of_measure_id
     JOIN location l ON l.id = sku.location_id
     WHERE (i.no ILIKE @like OR i.description ILIKE @like OR l.code ILIKE @like)
       ${clause}
     ${orderBy}`,
    { like: `%${String(search).trim()}%`, ...params },
  );
};

const COSTING_METHODS: ItemCostingMethod[] = ['FIFO', 'LIFO', 'Average', 'Standard', 'Specific'];
const REORDERING_POLICIES: ItemReorderingPolicy[] = ['Fixed Reorder Qty.', 'Maximum Qty.'];

export interface ItemInput {
  description: string;
  description2?: string | null;
  baseUnitOfMeasureId: number;
  purchUnitOfMeasureId?: number | null;
  salesUnitOfMeasureId?: number | null;
  inventoryPostingGroupId: number;
  productPostingGroupId: number;
  costingMethod: ItemCostingMethod;
  unitCost: Cents;
  unitPrice: Cents;
  reorderingPolicy: ItemReorderingPolicy;
  reorderPoint: number;
  reorderQuantity: number;
  maximumInventory: number;
  status: 'ACTIVE' | 'BLOCKED';
  unitsOfMeasure: ItemUnitOfMeasureLineInput[];
}

function assertItem(input: ItemInput): void {
  if (!input.description.trim()) throw new AppError('A description is required', 'VALIDATION');
  if (!input.baseUnitOfMeasureId) throw new AppError('A Base Unit of Measure is required', 'VALIDATION');
  if (!input.inventoryPostingGroupId) throw new AppError('An Inventory Posting Group is required', 'VALIDATION');
  if (!input.productPostingGroupId) throw new AppError('A Product Posting Group is required', 'VALIDATION');
  if (!COSTING_METHODS.includes(input.costingMethod)) throw new AppError('Invalid costing method', 'VALIDATION');
  if (!REORDERING_POLICIES.includes(input.reorderingPolicy)) throw new AppError('Invalid reordering policy', 'VALIDATION');
  if (input.unitCost < 0 || input.unitPrice < 0) throw new AppError('Unit cost/price cannot be negative', 'VALIDATION');
  if (input.reorderPoint < 0 || input.reorderQuantity < 0 || input.maximumInventory < 0) {
    throw new AppError('Reorder Point/Quantity/Maximum Inventory cannot be negative', 'VALIDATION');
  }
}

export async function createItem(input: ItemInput, user: Actor): Promise<{ no: string }> {
  assertItem(input);
  return tx(async () => {
    const no = await nextSequence('ITEM');
    const info = await run(
      `INSERT INTO item
         (no, description, description_2, base_unit_of_measure_id, purch_unit_of_measure_id,
          sales_unit_of_measure_id, inventory_posting_group_id, product_posting_group_id, costing_method,
          unit_cost, unit_price, reordering_policy, reorder_point, reorder_quantity, maximum_inventory,
          status, created_at, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      no, input.description.trim(), input.description2?.trim() || null, input.baseUnitOfMeasureId,
      input.purchUnitOfMeasureId || null, input.salesUnitOfMeasureId || null, input.inventoryPostingGroupId,
      input.productPostingGroupId, input.costingMethod, Math.round(input.unitCost), Math.round(input.unitPrice),
      input.reorderingPolicy, Math.round(input.reorderPoint), Math.round(input.reorderQuantity),
      Math.round(input.maximumInventory), input.status, new Date().toISOString(), user.username,
    );
    await setItemUnitsOfMeasure(Number(info.lastInsertRowid), input.unitsOfMeasure, user);
    await audit(user, 'ITEM_CREATE', 'item', no, { description: input.description });
    return { no };
  });
}

export async function updateItem(no: string, input: ItemInput, user: Actor): Promise<void> {
  assertItem(input);
  const before = await getItem(no);
  if (!before) throw new AppError('Item not found', 'NOT_FOUND');

  const hasEntries = await hasAnyRow('item_ledger_entry', 'item_id = ?', before.id);
  if (hasEntries && input.costingMethod !== before.costing_method) {
    throw new AppError('The Costing Method cannot change once stock movements have been posted against this item', 'VALIDATION');
  }
  if (hasEntries && input.baseUnitOfMeasureId !== before.base_unit_of_measure_id) {
    throw new AppError('The Base Unit of Measure cannot change once stock movements have been posted against this item', 'VALIDATION');
  }

  await tx(async () => {
    await run(
      `UPDATE item SET
         description = ?, description_2 = ?, base_unit_of_measure_id = ?, purch_unit_of_measure_id = ?,
         sales_unit_of_measure_id = ?, inventory_posting_group_id = ?, product_posting_group_id = ?,
         costing_method = ?, unit_cost = ?, unit_price = ?, reordering_policy = ?, reorder_point = ?,
         reorder_quantity = ?, maximum_inventory = ?, status = ?
       WHERE id = ?`,
      input.description.trim(), input.description2?.trim() || null, input.baseUnitOfMeasureId,
      input.purchUnitOfMeasureId || null, input.salesUnitOfMeasureId || null, input.inventoryPostingGroupId,
      input.productPostingGroupId, input.costingMethod, Math.round(input.unitCost), Math.round(input.unitPrice),
      input.reorderingPolicy, Math.round(input.reorderPoint), Math.round(input.reorderQuantity),
      Math.round(input.maximumInventory), input.status, before.id,
    );
    await setItemUnitsOfMeasure(before.id, input.unitsOfMeasure, user);
  });
  await audit(user, 'ITEM_UPDATE', 'item', no, {});
}
