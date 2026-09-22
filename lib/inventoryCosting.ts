/*
 * Inventory costing primitives — extracted from lib/itemJournal.ts so both the Item Journal
 * (Negative Adjmt.) and a sales shipment / invoice Item line (lib/salesDocuments.ts) cost an
 * outbound movement the same way and record which inbound lot(s) it consumed.
 *
 * costOutbound() is read-only (safe for a live estimate); applyOutboundLots() does the writes
 * (item_application_entry + lot remaining_quantity/open), and is only ever called inside the
 * posting transaction that also inserted the outbound item_ledger_entry.
 */
import { one, all, run } from './db.ts';
import { AppError } from './errors.ts';
import type { Cents, IsoDate, ItemCostingMethod } from './types.ts';

export interface CostApplication { inboundEntryId: number; quantity: number }
export interface CostResult { unitCost: Cents; applications: CostApplication[] }

/** Determines an outbound line's cost per `costingMethod`, and — for every method but Standard —
 *  which open inbound lot(s) it consumes. Read-only. */
export async function costOutbound(
  itemId: number, locationId: number, costingMethod: ItemCostingMethod, baseQuantity: number,
  appliesToEntryId: number | null,
): Promise<CostResult> {
  if (costingMethod === 'Standard') {
    const item = await one<{ unit_cost: Cents }>('SELECT unit_cost FROM item WHERE id = ?', itemId);
    return { unitCost: item?.unit_cost ?? 0, applications: [] };
  }

  if (costingMethod === 'Specific') {
    if (!appliesToEntryId) throw new AppError('Pick the specific lot this outbound movement applies to', 'VALIDATION');
    const lot = await one<{
      id: number; item_id: number; location_id: number; open: boolean; remaining_quantity: number; unit_cost: Cents;
    }>(
      'SELECT id, item_id, location_id, open, remaining_quantity, unit_cost FROM item_ledger_entry WHERE id = ?',
      appliesToEntryId,
    );
    if (!lot || lot.item_id !== itemId || lot.location_id !== locationId || !lot.open) {
      throw new AppError('That lot is not an open inbound entry for this item and location', 'VALIDATION');
    }
    if (lot.remaining_quantity < baseQuantity) {
      throw new AppError(`That lot only has ${lot.remaining_quantity} unit(s) remaining`, 'VALIDATION');
    }
    return { unitCost: lot.unit_cost, applications: [{ inboundEntryId: lot.id, quantity: baseQuantity }] };
  }

  const order = costingMethod === 'LIFO' ? 'DESC' : 'ASC';
  const lots = await all<{ id: number; remaining_quantity: number; unit_cost: Cents }>(
    `SELECT id, remaining_quantity, unit_cost FROM item_ledger_entry
     WHERE item_id = ? AND location_id = ? AND open = true AND remaining_quantity > 0
     ORDER BY posting_date ${order}, id ${order}`,
    itemId, locationId,
  );
  const totalOpen = lots.reduce((s, l) => s + l.remaining_quantity, 0);
  if (totalOpen < baseQuantity) {
    throw new AppError(
      `Only ${totalOpen} unit(s) are on hand at this location — cannot post an outbound movement of ${baseQuantity}`,
      'VALIDATION',
    );
  }

  let remaining = baseQuantity;
  const applications: CostApplication[] = [];
  let consumedValue = 0;
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, lot.remaining_quantity);
    applications.push({ inboundEntryId: lot.id, quantity: take });
    consumedValue += take * lot.unit_cost;
    remaining -= take;
  }

  if (costingMethod === 'Average') {
    const totalValue = lots.reduce((s, l) => s + l.remaining_quantity * l.unit_cost, 0);
    const avg = totalOpen > 0 ? totalValue / totalOpen : 0;
    return { unitCost: Math.round(avg), applications };
  }
  const unitCost = baseQuantity > 0 ? Math.round(consumedValue / baseQuantity) : 0;
  return { unitCost, applications };
}

/**
 * Receives stock for a purchase (BC's "Purchase" Item Ledger Entry): inserts a new inbound,
 * open cost lot at `unitCost`, bumps the stockkeeping_unit + item.inventory roll-ups and stamps
 * `item.unit_cost` (BC's "Last Direct Cost"). Call inside the posting transaction of a purchase
 * receipt / invoice (lib/purchaseDocuments.ts). Returns the new item_ledger_entry id.
 */
export async function receiveItemStock(
  itemId: number, locationId: number, baseQuantity: number, unitCost: Cents,
  documentNo: string, postingDate: IsoDate,
): Promise<number> {
  const qty = Math.round(baseQuantity);
  if (qty <= 0) throw new AppError('A purchase Item line must receive a positive quantity', 'VALIDATION');
  const amount = qty * unitCost;
  const ile = await run(
    `INSERT INTO item_ledger_entry
       (item_id, location_id, posting_date, entry_type, document_no, quantity, remaining_quantity, open, unit_cost, amount, created_at)
     VALUES (?,?,?, 'Purchase', ?,?,?, true, ?, ?, ?)`,
    itemId, locationId, postingDate, documentNo, qty, qty, unitCost, amount, new Date().toISOString(),
  );
  const sku = await one<{ id: number; inventory: number }>(
    'SELECT id, inventory FROM stockkeeping_unit WHERE item_id = ? AND location_id = ?', itemId, locationId,
  );
  if (!sku) await run('INSERT INTO stockkeeping_unit (item_id, location_id, inventory) VALUES (?,?,?)', itemId, locationId, qty);
  else await run('UPDATE stockkeeping_unit SET inventory = ? WHERE id = ?', sku.inventory + qty, sku.id);
  const roll = await one<{ total: number }>('SELECT COALESCE(SUM(inventory),0) AS total FROM stockkeeping_unit WHERE item_id = ?', itemId);
  await run('UPDATE item SET inventory = ?, unit_cost = ? WHERE id = ?', roll?.total ?? qty, unitCost, itemId);
  return Number(ile.lastInsertRowid);
}

/** Writes the item_application_entry rows for `outboundEntryId` and draws down each consumed
 *  lot's remaining_quantity / open flag. Call inside the posting transaction. */
export async function applyOutboundLots(
  outboundEntryId: number, applications: CostApplication[], postingDate: IsoDate,
): Promise<void> {
  for (const app of applications) {
    await run(
      `INSERT INTO item_application_entry (outbound_entry_id, inbound_entry_id, quantity, posting_date, created_at)
       VALUES (?,?,?,?,?)`,
      outboundEntryId, app.inboundEntryId, app.quantity, postingDate, new Date().toISOString(),
    );
    const lot = await one<{ remaining_quantity: number }>(
      'SELECT remaining_quantity FROM item_ledger_entry WHERE id = ?', app.inboundEntryId,
    );
    const newRemaining = (lot?.remaining_quantity ?? 0) - app.quantity;
    await run(
      'UPDATE item_ledger_entry SET remaining_quantity = ?, open = ? WHERE id = ?',
      newRemaining, newRemaining > 0, app.inboundEntryId,
    );
  }
}
