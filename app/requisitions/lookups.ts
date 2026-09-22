import { all } from '@/lib/db';
import { listActiveEmployees } from '@/lib/employees';
import { listActiveLocations } from '@/lib/inventorySetup';
import { listPostableAccounts } from '@/lib/gl';
import { listFixedAssets } from '@/lib/fixedAssets';
import { listActiveVendors } from '@/lib/vendors';
import { listOpenPurchaseOrders } from '@/lib/requisitions';
import type { RequisitionLookups } from './requisition-actions';

/** The table-relation lists the requisition forms pick from — built once per page and shared by
 *  the New modal, the card's inline editor, the issue form and the review form. */
export async function requisitionLookups(): Promise<RequisitionLookups> {
  const [employees, locations, accounts, fixedAssets, vendors, items, itemUnits, stock, openOrders] = await Promise.all([
    listActiveEmployees(), listActiveLocations(), listPostableAccounts(), listFixedAssets(), listActiveVendors(),
    all<{ id: number; no: string; description: string; base_unit_of_measure_id: number; base_uom_code: string; unit_cost: number }>(
      `SELECT i.id, i.no, i.description, i.base_unit_of_measure_id, u.code AS base_uom_code, i.unit_cost
       FROM item i JOIN unit_of_measure u ON u.id = i.base_unit_of_measure_id WHERE i.status = 'ACTIVE' ORDER BY i.no`),
    all<{ item_id: number; unit_of_measure_id: number; code: string; qty_per_unit_of_measure: number }>(
      `SELECT ium.item_id, ium.unit_of_measure_id, u.code, ium.qty_per_unit_of_measure
       FROM item_unit_of_measure ium JOIN unit_of_measure u ON u.id = ium.unit_of_measure_id ORDER BY u.code`),
    all<{ item_id: number; location_id: number; inventory: number }>('SELECT item_id, location_id, inventory FROM stockkeeping_unit'),
    listOpenPurchaseOrders(),
  ]);
  return {
    employees,
    locations: locations.map((l) => ({ id: l.id, code: l.code, name: l.name })),
    accounts: accounts.map((a) => ({ id: a.id, code: a.code, name: a.name })),
    fixedAssets: fixedAssets.filter((a) => !a.disposed).map((a) => ({ no: a.no, description: a.description })),
    vendors: vendors.filter((v) => !v.blocked).map((v) => ({ id: v.id, no: v.no, name: v.name })),
    items: items.map((i) => ({ ...i, unit_cost: Number(i.unit_cost) })),
    itemUnits: itemUnits.map((u) => ({ ...u, qty_per_unit_of_measure: Number(u.qty_per_unit_of_measure) })),
    stock: stock.map((s) => ({ ...s, inventory: Number(s.inventory) })),
    openOrders: openOrders.map((o) => ({ no: o.no, vendor_no: o.vendor_no, vendor_name: o.vendor_name })),
  };
}
