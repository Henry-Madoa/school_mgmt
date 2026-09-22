/*
 * Unit of Measure conversion — Business Central Table 5404 "Item Unit of Measure". Every unit an
 * item may be entered in converts to that item's own Base Unit of Measure directly (never
 * UoM-to-UoM — this is exactly Business Central's own model): 1 BOX might be 12 EACH, 1 CASE might
 * be 4 BOX, but a CASE-to-BOX conversion is never computed by chaining through EACH twice, it just
 * carries its own qty_per_unit_of_measure relative to Base. No AL source exists for any of this —
 * see lib/itemJournal.ts's header for the full design rationale.
 */
import { one, all, run, tx, audit } from './db.ts';
import { AppError } from './errors.ts';
import type { Actor, ItemUnitOfMeasureView } from './types.ts';

export const itemUnitsOfMeasure = (itemId: number): Promise<ItemUnitOfMeasureView[]> =>
  all<ItemUnitOfMeasureView>(
    `SELECT ium.*, uom.code AS unit_of_measure_code, uom.description AS unit_of_measure_description
     FROM item_unit_of_measure ium JOIN unit_of_measure uom ON uom.id = ium.unit_of_measure_id
     WHERE ium.item_id = ?
     ORDER BY uom.code`,
    itemId,
  );

/** This unit's conversion factor to `itemId`'s own Base UoM — 1 for the Base UoM itself, or
 *  whatever item_unit_of_measure has on file. Throws if the unit isn't set up for this item at
 *  all (Business Central refuses to post a line in a UoM the item doesn't recognise). */
export async function qtyPerUnitOfMeasure(itemId: number, unitOfMeasureId: number): Promise<number> {
  const item = await one<{ base_unit_of_measure_id: number }>(
    'SELECT base_unit_of_measure_id FROM item WHERE id = ?', itemId,
  );
  if (!item) throw new AppError('Item not found', 'NOT_FOUND');
  if (unitOfMeasureId === item.base_unit_of_measure_id) return 1;
  const row = await one<{ qty_per_unit_of_measure: number }>(
    'SELECT qty_per_unit_of_measure FROM item_unit_of_measure WHERE item_id = ? AND unit_of_measure_id = ?',
    itemId, unitOfMeasureId,
  );
  if (!row) throw new AppError('That unit of measure is not set up for this item', 'VALIDATION');
  return row.qty_per_unit_of_measure;
}

/** `quantity`, entered in `unitOfMeasureId`, converted to the item's Base UoM. */
export async function convertToBase(itemId: number, unitOfMeasureId: number, quantity: number): Promise<number> {
  const factor = await qtyPerUnitOfMeasure(itemId, unitOfMeasureId);
  return quantity * factor;
}

/** `baseQuantity` (already in the item's Base UoM) expressed in `unitOfMeasureId` instead — for
 *  display only (e.g. "show qty-on-hand in BOX"); may not be a whole number if it doesn't divide
 *  evenly, which is left to the caller to round or report as a fraction. */
export async function convertFromBase(itemId: number, unitOfMeasureId: number, baseQuantity: number): Promise<number> {
  const factor = await qtyPerUnitOfMeasure(itemId, unitOfMeasureId);
  return factor > 0 ? baseQuantity / factor : baseQuantity;
}

export interface ItemUnitOfMeasureLineInput {
  unitOfMeasureId: number;
  qtyPerUnitOfMeasure: number;
}

/**
 * Replaces an item's full Item Unit of Measure line set. The item's own Base UoM always gets an
 * implicit qty_per_unit_of_measure = 1 row (added here regardless of what's in `lines`); its
 * Purchase/Sales UoM (wherever set) must each resolve to one of `lines` — Business Central's own
 * validation that an item's Purch./Sales UoM is never picked from thin air.
 */
export async function setItemUnitsOfMeasure(
  itemId: number, lines: ItemUnitOfMeasureLineInput[], user: Actor,
): Promise<void> {
  const item = await one<{
    base_unit_of_measure_id: number; purch_unit_of_measure_id: number | null; sales_unit_of_measure_id: number | null;
  }>(
    'SELECT base_unit_of_measure_id, purch_unit_of_measure_id, sales_unit_of_measure_id FROM item WHERE id = ?',
    itemId,
  );
  if (!item) throw new AppError('Item not found', 'NOT_FOUND');

  for (const l of lines) {
    if (!(l.qtyPerUnitOfMeasure > 0)) {
      throw new AppError('A unit of measure conversion factor must be greater than zero', 'VALIDATION');
    }
  }
  const byUom = new Map(lines.map((l) => [l.unitOfMeasureId, l]));
  byUom.set(item.base_unit_of_measure_id, { unitOfMeasureId: item.base_unit_of_measure_id, qtyPerUnitOfMeasure: 1 });
  if (item.purch_unit_of_measure_id && !byUom.has(item.purch_unit_of_measure_id)) {
    throw new AppError('The Purchase Unit of Measure needs its own conversion line', 'VALIDATION');
  }
  if (item.sales_unit_of_measure_id && !byUom.has(item.sales_unit_of_measure_id)) {
    throw new AppError('The Sales Unit of Measure needs its own conversion line', 'VALIDATION');
  }

  await tx(async () => {
    await run('DELETE FROM item_unit_of_measure WHERE item_id = ?', itemId);
    for (const l of byUom.values()) {
      await run(
        'INSERT INTO item_unit_of_measure (item_id, unit_of_measure_id, qty_per_unit_of_measure) VALUES (?,?,?)',
        itemId, l.unitOfMeasureId, Math.round(l.qtyPerUnitOfMeasure),
      );
    }
  });
  await audit(user, 'ITEM_UOM_SET', 'item', itemId, { count: byUom.size });
}
