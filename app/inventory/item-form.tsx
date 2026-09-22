'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Modal } from '@/components/ui/modal';
import { Field } from '@/components/ui/field';
import { Money } from '@/components/ui/money';
import { Pill, TableWrap, EmptyState } from '@/components/ui/primitives';
import { formatDate } from '@/lib/format';
import {
  requestItem, saveItem, itemUnitsOfMeasureRequest, itemStockByLocationRequest, listItemLedgerEntriesRequest,
  type UomLineDraft,
} from '@/app/actions/inventory';
import type {
  InventoryPostingGroupView, ItemLedgerEntryView, ItemListRow, ProductPostingGroupView, StockByLocationRow, UnitOfMeasure,
} from '@/lib/types';

const COSTING_METHODS = ['FIFO', 'LIFO', 'Average', 'Standard', 'Specific'];
const REORDERING_POLICIES = ['Fixed Reorder Qty.', 'Maximum Qty.'];
const STATUSES = [{ value: 'ACTIVE', label: 'Active' }, { value: 'BLOCKED', label: 'Blocked' }];

const emptyLine = (): UomLineDraft => ({ unitOfMeasureId: '', qtyPerUnitOfMeasure: '' });

function ItemFields({ unitsOfMeasure, inventoryPostingGroups, productPostingGroups, initial, lines, setLines }: {
  unitsOfMeasure: UnitOfMeasure[];
  inventoryPostingGroups: InventoryPostingGroupView[];
  productPostingGroups: ProductPostingGroupView[];
  initial?: ItemListRow | null;
  lines: UomLineDraft[];
  setLines: (lines: UomLineDraft[]) => void;
}) {
  const editing = !!initial;
  const [baseUomId, setBaseUomId] = useState(String(initial?.base_unit_of_measure_id ?? (unitsOfMeasure[0]?.id ?? '')));

  const update = (i: number, patch: Partial<UomLineDraft>) =>
    setLines(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const remove = (i: number) => setLines(lines.filter((_, k) => k !== i));

  const otherUoms = unitsOfMeasure.filter((u) => String(u.id) !== baseUomId);

  return (
    <>
      <div className="grid g2">
        <Field name="description" label="Description" required defaultValue={initial?.description} />
        <Field name="description2" label="Description 2" defaultValue={initial?.description_2 ?? ''} placeholder="Optional" />
      </div>

      <div className="grid g2">
        <Field
          name="baseUnitOfMeasureId" label="Base unit of measure" type="select" required
          disabled={editing} defaultValue={baseUomId}
          options={unitsOfMeasure.map((u) => ({ value: u.id, label: `${u.code} — ${u.description}` }))}
          onChange={(e) => setBaseUomId(e.target.value)}
        />
        <Field
          name="costingMethod" label="Costing method" type="select" required
          defaultValue={initial?.costing_method ?? 'FIFO'}
          options={COSTING_METHODS.map((m) => ({ value: m, label: m }))}
        />
      </div>

      <div className="grid g2">
        <Field
          name="purchUnitOfMeasureId" label="Purchase unit of measure" type="select"
          defaultValue={initial?.purch_unit_of_measure_id ?? ''}
          options={[{ value: '', label: '(same as base)' }, ...unitsOfMeasure.map((u) => ({ value: u.id, label: u.code }))]}
        />
        <Field
          name="salesUnitOfMeasureId" label="Sales unit of measure" type="select"
          defaultValue={initial?.sales_unit_of_measure_id ?? ''}
          options={[{ value: '', label: '(same as base)' }, ...unitsOfMeasure.map((u) => ({ value: u.id, label: u.code }))]}
        />
      </div>

      <div className="hint" style={{ marginBottom: 'calc(var(--sp)*0.5)' }}>
        Conversion to the base unit — the Purchase/Sales unit above must have its own line here (skip it if it's the
        same as the base unit).
      </div>
      <table>
        <thead>
          <tr><th>Unit</th><th style={{ width: 140 }}>= how many base units</th><th style={{ width: 40 }} /></tr>
        </thead>
        <tbody>
          {lines.map((line, i) => (
            <tr key={i}>
              <td>
                <select value={line.unitOfMeasureId} aria-label="Unit" onChange={(e) => update(i, { unitOfMeasureId: e.target.value })}>
                  <option value="">Pick a unit…</option>
                  {otherUoms.map((u) => <option key={u.id} value={u.id}>{u.code} — {u.description}</option>)}
                </select>
              </td>
              <td>
                <input type="number" min={1} step="1" aria-label="Conversion factor" value={line.qtyPerUnitOfMeasure}
                  onChange={(e) => update(i, { qtyPerUnitOfMeasure: e.target.value })} />
              </td>
              <td>
                <button type="button" className="btn sm ghost" onClick={() => remove(i)} aria-label="Remove line">×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setLines([...lines, emptyLine()])}>
        Add unit of measure
      </button>

      <div className="grid g2" style={{ marginTop: 'calc(var(--sp)*1.5)' }}>
        <Field name="unitCost" label="Unit cost" type="currency" defaultValue={initial ? String(initial.unit_cost / 100) : ''} />
        <Field name="unitPrice" label="Unit price" type="currency" defaultValue={initial ? String(initial.unit_price / 100) : ''} />
      </div>

      <div className="grid g2">
        <Field
          name="inventoryPostingGroupId" label="Inventory posting group" type="select" required
          defaultValue={initial?.inventory_posting_group_id ?? ''}
          options={inventoryPostingGroups.map((g) => ({ value: g.id, label: `${g.code} — ${g.description}` }))}
          hint="Names the G/L Inventory account this item posts to"
        />
        <Field
          name="productPostingGroupId" label="Product posting group" type="select" required
          defaultValue={initial?.product_posting_group_id ?? ''}
          options={productPostingGroups.map((g) => ({ value: g.id, label: `${g.code} — ${g.description}` }))}
          hint="Names the G/L Adjustment account an adjustment offsets against"
        />
      </div>

      <div className="grid g2">
        <Field
          name="reorderingPolicy" label="Reordering policy" type="select" required
          defaultValue={initial?.reordering_policy ?? 'Fixed Reorder Qty.'}
          options={REORDERING_POLICIES.map((p) => ({ value: p, label: p }))}
        />
        {editing ? <Field name="status" label="Status" type="select" options={STATUSES} defaultValue={initial!.status} /> : null}
      </div>

      <div className="grid g3">
        <Field name="reorderPoint" label="Reorder point" type="number" min={0} step="1" defaultValue={initial?.reorder_point ?? 0} />
        <Field name="reorderQuantity" label="Reorder quantity" type="number" min={0} step="1" defaultValue={initial?.reorder_quantity ?? 0} />
        <Field name="maximumInventory" label="Maximum inventory" type="number" min={0} step="1" defaultValue={initial?.maximum_inventory ?? 0} />
      </div>
    </>
  );
}

export function NewItemButton({ unitsOfMeasure, inventoryPostingGroups, productPostingGroups, className = 'btn' }: {
  unitsOfMeasure: UnitOfMeasure[]; inventoryPostingGroups: InventoryPostingGroupView[]; productPostingGroups: ProductPostingGroupView[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<UomLineDraft[]>([]);
  return (
    <>
      <button type="button" className={className} onClick={() => { setLines([]); setOpen(true); }}>Add item</button>
      {open ? (
        <FormModal
          title="New item" wide
          onClose={() => setOpen(false)}
          onSubmit={(values) => requestItem(values, lines)}
          submitLabel="Create"
          successTitle="Item created"
          successDetail={(d) => `${d.no} saved`}
        >
          <ItemFields
            unitsOfMeasure={unitsOfMeasure} inventoryPostingGroups={inventoryPostingGroups}
            productPostingGroups={productPostingGroups} lines={lines} setLines={setLines}
          />
        </FormModal>
      ) : null}
    </>
  );
}

export function EditItemButton({ item, unitsOfMeasure, inventoryPostingGroups, productPostingGroups, className = 'btn ghost sm' }: {
  item: ItemListRow; unitsOfMeasure: UnitOfMeasure[]; inventoryPostingGroups: InventoryPostingGroupView[];
  productPostingGroups: ProductPostingGroupView[]; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<UomLineDraft[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    itemUnitsOfMeasureRequest(item.id).then((res) => {
      if (cancelled || !res.ok) return;
      setLines(
        res.data
          .filter((u) => u.unit_of_measure_id !== item.base_unit_of_measure_id)
          .map((u) => ({ unitOfMeasureId: String(u.unit_of_measure_id), qtyPerUnitOfMeasure: String(u.qty_per_unit_of_measure) })),
      );
    });
    return () => { cancelled = true; };
  }, [open, item.id, item.base_unit_of_measure_id]);

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Edit</button>
      {open ? (
        <FormModal
          title={`Edit ${item.no}`} wide
          onClose={() => setOpen(false)}
          onSubmit={(values) => saveItem(item.no, values, lines)}
          submitLabel="Save changes"
          successTitle="Item updated"
        >
          <ItemFields
            unitsOfMeasure={unitsOfMeasure} inventoryPostingGroups={inventoryPostingGroups}
            productPostingGroups={productPostingGroups} initial={item} lines={lines} setLines={setLines}
          />
        </FormModal>
      ) : null}
    </>
  );
}

/** Per-location qty-on-hand breakdown for one item — a read-only drill-down, not a form. */
export function StockByLocationButton({ item, className = 'btn ghost sm' }: { item: ItemListRow; className?: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<StockByLocationRow[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    itemStockByLocationRequest(item.no).then((res) => {
      if (!cancelled && res.ok) setRows(res.data);
    });
    return () => { cancelled = true; };
  }, [open, item.no]);

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Stock</button>
      {open ? (
        <Modal title={`Stock by location — ${item.no}`} onClose={() => setOpen(false)}>
          {rows === null ? (
            <div className="hint">Loading…</div>
          ) : rows.length ? (
            <TableWrap>
              <thead>
                <tr><th>Location</th><th className="num">On hand</th><th className="num">Reorder point</th><th className="num">Reorder qty</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.location_code} — {r.location_name}</td>
                    <td className="num">{r.inventory}</td>
                    <td className="num">{r.effective_reorder_point}</td>
                    <td className="num">{r.effective_reorder_quantity}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          ) : <EmptyState icon="📦" title="No stock movements at any location yet" />}
        </Modal>
      ) : null}
    </>
  );
}

/** Wraps an item's "on hand" quantity — clicking it (Business Central's own "Navigate" idea,
 *  same UX as LedgerLink's clickable Trial Balance figure) opens that item's full Item Ledger
 *  Entry history: every Positive/Negative Adjmt. that ever moved its stock. */
export function ItemMovementsLink({ item, children }: { item: ItemListRow; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="linklike" onClick={() => setOpen(true)}>{children}</button>
      {open ? <ItemMovementsModal item={item} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ItemMovementsModal({ item, onClose }: { item: ItemListRow; onClose: () => void }) {
  const [rows, setRows] = useState<ItemLedgerEntryView[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listItemLedgerEntriesRequest({ itemId: item.id }).then((res) => {
      if (!cancelled && res.ok) setRows(res.data);
    });
    return () => { cancelled = true; };
  }, [item.id]);

  return (
    <Modal
      wide title={`Item movements — ${item.no}`} onClose={onClose}
      footer={<button type="button" className="btn ghost" onClick={onClose}>Close</button>}
    >
      <div className="card-sub" style={{ marginBottom: 'calc(var(--sp)*1.5)' }}>
        {item.description} · {item.inventory} {item.base_unit_of_measure_code} on hand
      </div>
      {rows === null ? (
        <EmptyState title="Loading…" />
      ) : rows.length ? (
        <TableWrap>
          <thead>
            <tr>
              <th>Document</th><th>Date</th><th>Type</th><th>Location</th>
              <th className="num">Quantity</th><th className="num">Unit cost</th><th className="num">Amount</th><th className="num">Remaining</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td className="mono">{e.document_no}</td>
                <td>{formatDate(e.posting_date)}</td>
                <td><Pill status={e.entry_type === 'Positive Adjmt.' ? 'ok' : 'warn'}>{e.entry_type}</Pill></td>
                <td className="mono muted-cell">{e.location_code}</td>
                <td className="num">{e.quantity}</td>
                <td className="num"><Money cents={e.unit_cost} /></td>
                <td className="num"><Money cents={e.amount} /></td>
                <td className="num">{e.open ? e.remaining_quantity : '—'}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : <EmptyState icon="📄" title="No movements posted yet" sub="Post a Positive or Negative Adjmt. from the Item Journal to move this item's stock." />}
    </Modal>
  );
}

