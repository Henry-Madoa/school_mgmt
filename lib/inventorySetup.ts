/*
 * Inventory setup masters — no AL source exists for any of this (see lib/itemJournal.ts's header
 * for the full rationale). Four small masters an Item picks from:
 *
 *   - location                — Business Central Table 14. Where stock physically sits.
 *   - unit_of_measure         — Business Central Table 204. EACH/BOX/KG/… — see
 *                                lib/unitOfMeasureConversion.ts for the per-item conversion.
 *   - inventory_posting_group — Business Central's Inventory Posting Group. The ledger side of an
 *                                item's ledger-subledger mapping: which G/L account carries its
 *                                stock value.
 *   - product_posting_group   — Business Central's Gen. Prod. Posting Group. The subledger side:
 *                                which P&L account a Positive/Negative Adjmt. offsets against.
 *
 * None of these support a hard delete — like bank_account/cheque_type elsewhere in this app, an
 * unwanted row is set INACTIVE instead, so history that references it (an Item, a posted line)
 * never dangles.
 */
import { one, all, run, audit } from './db.ts';
import { AppError } from './errors.ts';
import type {
  Actor, Location, UnitOfMeasure, InventoryPostingGroup, InventoryPostingGroupView,
  ProductPostingGroup, ProductPostingGroupView,
} from './types.ts';

/* --------------------------------------------------------------------- location */

export const listLocations = (): Promise<Location[]> =>
  all<Location>('SELECT * FROM location ORDER BY code');

export const listActiveLocations = (): Promise<Location[]> =>
  all<Location>("SELECT * FROM location WHERE status = 'ACTIVE' ORDER BY code");

export const getLocation = (id: number): Promise<Location | undefined> =>
  one<Location>('SELECT * FROM location WHERE id = ?', id);

export interface LocationInput {
  code: string;
  name: string;
  address: string | null;
  status: 'ACTIVE' | 'INACTIVE';
}

function assertLocation(input: LocationInput): void {
  if (!input.code.trim()) throw new AppError('A code is required', 'VALIDATION');
  if (!input.name.trim()) throw new AppError('A name is required', 'VALIDATION');
}

export async function createLocation(input: LocationInput, user: Actor): Promise<{ id: number }> {
  assertLocation(input);
  const dup = await one<{ id: number }>('SELECT id FROM location WHERE code = ?', input.code.trim());
  if (dup) throw new AppError('A location with this code already exists', 'DUPLICATE');
  const info = await run(
    'INSERT INTO location (code, name, address, status, created_at, created_by) VALUES (?,?,?,?,?,?)',
    input.code.trim(), input.name.trim(), input.address?.trim() || null, input.status,
    new Date().toISOString(), user.username,
  );
  await audit(user, 'LOCATION_CREATE', 'location', info.lastInsertRowid, { code: input.code });
  return { id: Number(info.lastInsertRowid) };
}

export async function updateLocation(id: number, input: LocationInput, user: Actor): Promise<void> {
  assertLocation(input);
  const before = await getLocation(id);
  if (!before) throw new AppError('Location not found', 'NOT_FOUND');
  const dup = await one<{ id: number }>('SELECT id FROM location WHERE code = ? AND id <> ?', input.code.trim(), id);
  if (dup) throw new AppError('A location with this code already exists', 'DUPLICATE');
  await run(
    'UPDATE location SET code = ?, name = ?, address = ?, status = ? WHERE id = ?',
    input.code.trim(), input.name.trim(), input.address?.trim() || null, input.status, id,
  );
  await audit(user, 'LOCATION_UPDATE', 'location', id, {});
}

/* ---------------------------------------------------------------- unit of measure */

export const listUnitsOfMeasure = (): Promise<UnitOfMeasure[]> =>
  all<UnitOfMeasure>('SELECT * FROM unit_of_measure ORDER BY code');

export const getUnitOfMeasure = (id: number): Promise<UnitOfMeasure | undefined> =>
  one<UnitOfMeasure>('SELECT * FROM unit_of_measure WHERE id = ?', id);

export interface UnitOfMeasureInput {
  code: string;
  description: string;
  symbol: string | null;
}

function assertUnitOfMeasure(input: UnitOfMeasureInput): void {
  if (!input.code.trim()) throw new AppError('A code is required', 'VALIDATION');
  if (!input.description.trim()) throw new AppError('A description is required', 'VALIDATION');
}

export async function createUnitOfMeasure(input: UnitOfMeasureInput, user: Actor): Promise<{ id: number }> {
  assertUnitOfMeasure(input);
  const dup = await one<{ id: number }>('SELECT id FROM unit_of_measure WHERE code = ?', input.code.trim());
  if (dup) throw new AppError('A unit of measure with this code already exists', 'DUPLICATE');
  const info = await run(
    'INSERT INTO unit_of_measure (code, description, symbol, created_at, created_by) VALUES (?,?,?,?,?)',
    input.code.trim().toUpperCase(), input.description.trim(), input.symbol?.trim() || null,
    new Date().toISOString(), user.username,
  );
  await audit(user, 'UNIT_OF_MEASURE_CREATE', 'unit_of_measure', info.lastInsertRowid, { code: input.code });
  return { id: Number(info.lastInsertRowid) };
}

export async function updateUnitOfMeasure(id: number, input: UnitOfMeasureInput, user: Actor): Promise<void> {
  assertUnitOfMeasure(input);
  const before = await getUnitOfMeasure(id);
  if (!before) throw new AppError('Unit of measure not found', 'NOT_FOUND');
  const dup = await one<{ id: number }>('SELECT id FROM unit_of_measure WHERE code = ? AND id <> ?', input.code.trim(), id);
  if (dup) throw new AppError('A unit of measure with this code already exists', 'DUPLICATE');
  await run(
    'UPDATE unit_of_measure SET code = ?, description = ?, symbol = ? WHERE id = ?',
    input.code.trim().toUpperCase(), input.description.trim(), input.symbol?.trim() || null, id,
  );
  await audit(user, 'UNIT_OF_MEASURE_UPDATE', 'unit_of_measure', id, {});
}

/* ---------------------------------------------------------- inventory posting group */

const IPG_SELECT = `
  SELECT ipg.*, g.code AS inventory_gl_account_code, g.name AS inventory_gl_account_name,
         (SELECT COUNT(*) FROM item WHERE item.inventory_posting_group_id = ipg.id) AS items_using
  FROM inventory_posting_group ipg
  JOIN gl_account g ON g.id = ipg.inventory_gl_account_id`;

export const listInventoryPostingGroups = (): Promise<InventoryPostingGroupView[]> =>
  all<InventoryPostingGroupView>(`${IPG_SELECT} ORDER BY ipg.code`);

export const getInventoryPostingGroup = (id: number): Promise<InventoryPostingGroup | undefined> =>
  one<InventoryPostingGroup>('SELECT * FROM inventory_posting_group WHERE id = ?', id);

export interface InventoryPostingGroupInput {
  code: string;
  description: string;
  inventoryGlAccountId: number;
}

function assertInventoryPostingGroup(input: InventoryPostingGroupInput): void {
  if (!input.code.trim()) throw new AppError('A code is required', 'VALIDATION');
  if (!input.description.trim()) throw new AppError('A description is required', 'VALIDATION');
  if (!input.inventoryGlAccountId) throw new AppError('An Inventory G/L account is required', 'VALIDATION');
}

export async function createInventoryPostingGroup(
  input: InventoryPostingGroupInput, user: Actor,
): Promise<{ id: number }> {
  assertInventoryPostingGroup(input);
  const dup = await one<{ id: number }>('SELECT id FROM inventory_posting_group WHERE code = ?', input.code.trim());
  if (dup) throw new AppError('An inventory posting group with this code already exists', 'DUPLICATE');
  const info = await run(
    'INSERT INTO inventory_posting_group (code, description, inventory_gl_account_id, created_at, created_by) VALUES (?,?,?,?,?)',
    input.code.trim(), input.description.trim(), input.inventoryGlAccountId, new Date().toISOString(), user.username,
  );
  await audit(user, 'INVENTORY_POSTING_GROUP_CREATE', 'inventory_posting_group', info.lastInsertRowid, { code: input.code });
  return { id: Number(info.lastInsertRowid) };
}

export async function updateInventoryPostingGroup(
  id: number, input: InventoryPostingGroupInput, user: Actor,
): Promise<void> {
  assertInventoryPostingGroup(input);
  const before = await getInventoryPostingGroup(id);
  if (!before) throw new AppError('Inventory posting group not found', 'NOT_FOUND');
  const dup = await one<{ id: number }>('SELECT id FROM inventory_posting_group WHERE code = ? AND id <> ?', input.code.trim(), id);
  if (dup) throw new AppError('An inventory posting group with this code already exists', 'DUPLICATE');
  await run(
    'UPDATE inventory_posting_group SET code = ?, description = ?, inventory_gl_account_id = ? WHERE id = ?',
    input.code.trim(), input.description.trim(), input.inventoryGlAccountId, id,
  );
  await audit(user, 'INVENTORY_POSTING_GROUP_UPDATE', 'inventory_posting_group', id, {});
}

/* ------------------------------------------------------------ product posting group */

const PPG_SELECT = `
  SELECT ppg.*, g.code AS adjustment_gl_account_code, g.name AS adjustment_gl_account_name,
         (SELECT COUNT(*) FROM item WHERE item.product_posting_group_id = ppg.id) AS items_using
  FROM product_posting_group ppg
  JOIN gl_account g ON g.id = ppg.adjustment_gl_account_id`;

export const listProductPostingGroups = (): Promise<ProductPostingGroupView[]> =>
  all<ProductPostingGroupView>(`${PPG_SELECT} ORDER BY ppg.code`);

export const getProductPostingGroup = (id: number): Promise<ProductPostingGroup | undefined> =>
  one<ProductPostingGroup>('SELECT * FROM product_posting_group WHERE id = ?', id);

export interface ProductPostingGroupInput {
  code: string;
  description: string;
  adjustmentGlAccountId: number;
}

function assertProductPostingGroup(input: ProductPostingGroupInput): void {
  if (!input.code.trim()) throw new AppError('A code is required', 'VALIDATION');
  if (!input.description.trim()) throw new AppError('A description is required', 'VALIDATION');
  if (!input.adjustmentGlAccountId) throw new AppError('An Adjustment G/L account is required', 'VALIDATION');
}

export async function createProductPostingGroup(
  input: ProductPostingGroupInput, user: Actor,
): Promise<{ id: number }> {
  assertProductPostingGroup(input);
  const dup = await one<{ id: number }>('SELECT id FROM product_posting_group WHERE code = ?', input.code.trim());
  if (dup) throw new AppError('A product posting group with this code already exists', 'DUPLICATE');
  const info = await run(
    'INSERT INTO product_posting_group (code, description, adjustment_gl_account_id, created_at, created_by) VALUES (?,?,?,?,?)',
    input.code.trim(), input.description.trim(), input.adjustmentGlAccountId, new Date().toISOString(), user.username,
  );
  await audit(user, 'PRODUCT_POSTING_GROUP_CREATE', 'product_posting_group', info.lastInsertRowid, { code: input.code });
  return { id: Number(info.lastInsertRowid) };
}

export async function updateProductPostingGroup(
  id: number, input: ProductPostingGroupInput, user: Actor,
): Promise<void> {
  assertProductPostingGroup(input);
  const before = await getProductPostingGroup(id);
  if (!before) throw new AppError('Product posting group not found', 'NOT_FOUND');
  const dup = await one<{ id: number }>('SELECT id FROM product_posting_group WHERE code = ? AND id <> ?', input.code.trim(), id);
  if (dup) throw new AppError('A product posting group with this code already exists', 'DUPLICATE');
  await run(
    'UPDATE product_posting_group SET code = ?, description = ?, adjustment_gl_account_id = ? WHERE id = ?',
    input.code.trim(), input.description.trim(), input.adjustmentGlAccountId, id,
  );
  await audit(user, 'PRODUCT_POSTING_GROUP_UPDATE', 'product_posting_group', id, {});
}
