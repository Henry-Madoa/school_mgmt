'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { useEditableCard } from '@/components/ui/editable-card';
import { Field, MoneyInput, toTwoDp } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { LockedEmployee } from '@/components/ui/locked-employee';
import { GlAccountSelect } from '@/components/ui/gl-account-select';
import { useRunAction } from '@/components/ui/run-action';
import { useFormat } from '@/components/ui/format-provider';
import { today } from '@/lib/format';
import {
  requestRequisition, saveRequisition, deleteRequisitionAction, submitRequisitionAction, cancelRequisitionApprovalAction, approveRequisitionAction,
  rejectRequisitionAction, reopenRequisitionAction, setQuantityApprovedAction, issueStoreItemsAction, confirmStoreReceiptAction, setLineDecisionAction,
  executeRequisitionReviewAction, closePurchaseRequisitionAction, type RequisitionLineDraft,
} from '@/app/actions/requisitions';
import type { RequisitionDetail, RequisitionLineView, RequisitionType } from '@/lib/types';

export interface RequisitionLookups {
  employees: { id: number; employee_no: string; first_name: string; last_name: string }[];
  /** Employee Self Service: every requisition is this employee's own — the picker is replaced by a locked field. */
  self?: { id: number; employee_no: string; first_name: string; last_name: string } | null;
  locations: { id: number; code: string; name: string }[];
  accounts: { id: number; code: string; name: string }[];
  fixedAssets: { no: string; description: string }[];
  vendors: { id: number; no: string; name: string }[];
  items: { id: number; no: string; description: string; base_unit_of_measure_id: number; base_uom_code: string; unit_cost: number }[];
  itemUnits: { item_id: number; unit_of_measure_id: number; code: string; qty_per_unit_of_measure: number }[];
  stock: { item_id: number; location_id: number; inventory: number }[];
  openOrders: { no: string; vendor_no: string; vendor_name: string }[];
}

const PROCUREMENT_METHODS = ['RFQ', 'RFP', 'Direct Procurement', 'Restricted Tendering', 'Open Tendering', 'Low Value Procurement'];
const LINE_TYPES = ['Item', 'G/L Account', 'Fixed Asset'];

const emptyLine = (type: RequisitionType): RequisitionLineDraft => ({ type: 'Item', no: '', description: '', unitOfMeasureId: '', quantity: '1', unitPrice: type === 'Store Requisition' ? '' : '', locationId: '' });

/** Units an item may be requested in — its base unit plus every item_unit_of_measure row. */
function unitsFor(lookups: RequisitionLookups, itemNo: string) {
  const item = lookups.items.find((i) => i.no === itemNo);
  if (!item) return [] as { id: number; code: string; factor: number }[];
  const extra = lookups.itemUnits.filter((u) => u.item_id === item.id && u.unit_of_measure_id !== item.base_unit_of_measure_id)
    .map((u) => ({ id: u.unit_of_measure_id, code: u.code, factor: u.qty_per_unit_of_measure }));
  return [{ id: item.base_unit_of_measure_id, code: item.base_uom_code, factor: 1 }, ...extra];
}

/** AL "Quantity in Store" — on hand at the location, in the unit picked. */
function inStore(lookups: RequisitionLookups, itemNo: string, locationId: string, uomId: string): number | null {
  const item = lookups.items.find((i) => i.no === itemNo);
  if (!item || !locationId) return null;
  const base = lookups.stock.find((s) => s.item_id === item.id && s.location_id === Number(locationId))?.inventory ?? 0;
  const factor = unitsFor(lookups, itemNo).find((u) => String(u.id) === uomId)?.factor ?? 1;
  return Math.floor(base / factor);
}

function RequisitionFields({ type, lookups, initial, lines, setLines }: {
  type: RequisitionType; lookups: RequisitionLookups; initial?: RequisitionDetail | null; lines: RequisitionLineDraft[]; setLines: (l: RequisitionLineDraft[]) => void;
}) {
  const { cur } = useFormat();
  const isStore = type === 'Store Requisition';
  const [employeeId, setEmployeeId] = useState(String(initial?.employee_id ?? ''));
  const [locationId, setLocationId] = useState(String(initial?.location_id ?? ''));
  const [supplierId, setSupplierId] = useState(String(initial?.supplier_id ?? ''));
  const set = (i: number, patch: Partial<RequisitionLineDraft>) => setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const pickNo = (i: number, no: string) => {
    const l = lines[i];
    if (l.type === 'Item') {
      const item = lookups.items.find((x) => x.no === no);
      set(i, { no, description: item?.description ?? '', unitOfMeasureId: item ? String(item.base_unit_of_measure_id) : '', unitPrice: item && !isStore ? toTwoDp(String(item.unit_cost / 100)) : l.unitPrice });
    } else if (l.type === 'G/L Account') set(i, { no, description: lookups.accounts.find((a) => a.code === no)?.name ?? '' });
    else set(i, { no, description: lookups.fixedAssets.find((a) => a.no === no)?.description ?? '', quantity: '1' });
  };
  const total = lines.reduce((s, l) => s + Math.round((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0) * 100), 0);
  return (
    <>
      <div className="grid g3">
        {lookups.self ? <LockedEmployee employee={lookups.self} label="Requested by (employee)" />
          : <SearchableSelect id="f_employeeId" name="employeeId" label="Requested by (employee)" required items={lookups.employees}
              getValue={(e) => String(e.id)} getLabel={(e) => `${e.employee_no} — ${e.first_name} ${e.last_name}`} value={employeeId} onChange={setEmployeeId}
              placeholder="Search employee…" emptyText="No matching employees" />}
        <Field name="title" label="Title" required defaultValue={initial?.title ?? ''} placeholder={isStore ? 'e.g. Stationery for the bursar’s office' : 'e.g. Replacement office chairs'} />
        <Field name="requisitionDate" label="Requisition date" type="date" required defaultValue={initial?.requisition_date ?? today()} />
      </div>
      <div className="grid g3">
        <SearchableSelect id="f_locationId" name="locationId" label={isStore ? 'Store location' : 'Deliver to location'} required={isStore} items={lookups.locations}
          getValue={(l) => String(l.id)} getLabel={(l) => `${l.code} — ${l.name}`} value={locationId} onChange={setLocationId} placeholder="Search location…" emptyText="No locations" />
        <Field name="neededByDate" label="Needed by" type="date" defaultValue={initial?.needed_by_date ?? ''} />
        {isStore ? <Field name="requestedDeliveryDate" label="Requested delivery" type="date" defaultValue={initial?.requested_delivery_date ?? ''} />
          : <Field name="expirationDate" label="Expires on" type="date" defaultValue={initial?.expiration_date ?? ''} hint="After this the request lapses" />}
      </div>
      {!isStore ? (
        <div className="grid g3">
          <Field name="procurementMethod" label="Procurement method" type="select" defaultValue={initial?.procurement_method ?? ''}
            options={[{ value: '', label: '(not set)' }, ...PROCUREMENT_METHODS.map((m) => ({ value: m, label: m }))]} />
          <SearchableSelect id="f_supplierId" name="supplierId" label="Suggested supplier" items={lookups.vendors} getValue={(v) => String(v.id)} getLabel={(v) => `${v.no} — ${v.name}`}
            value={supplierId} onChange={setSupplierId} placeholder="Search vendor…" emptyText="No vendors" />
          <Field name="requestedDeliveryDate" label="Requested delivery" type="date" defaultValue={initial?.requested_delivery_date ?? ''} />
        </div>
      ) : null}
      <Field name="description" label={isStore ? 'Purpose' : 'Justification'} type="textarea" defaultValue={initial?.description ?? ''} />
      <div className="hint" style={{ marginTop: 'var(--sp)' }}>{isStore ? 'Items — what the store should issue' : 'Lines — what should be bought'}</div>
      <table>
        <thead>
          <tr>
            {!isStore ? <th style={{ width: 120 }}>Type</th> : null}
            <th style={{ width: '22%' }}>No. <span className="req">*</span></th><th>Description</th>
            {isStore ? <th style={{ width: 110 }}>Unit</th> : null}
            {isStore ? <th style={{ width: 150 }}>Location</th> : null}
            <th style={{ width: 80 }}>Qty <span className="req">*</span></th>
            {isStore ? <th style={{ width: 90 }} className="num">In store</th> : <th style={{ width: 120 }}>Unit price</th>}
            {!isStore ? <th style={{ width: 120 }} className="num">Amount</th> : null}
            <th style={{ width: 32 }} />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const units = l.type === 'Item' ? unitsFor(lookups, l.no) : [];
            const stock = isStore ? inStore(lookups, l.no, l.locationId || locationId, l.unitOfMeasureId) : null;
            const short = stock != null && Number(l.quantity) > stock;
            return (
              <tr key={i}>
                {!isStore ? (
                  <td><select value={l.type} onChange={(e) => set(i, { type: e.target.value, no: '', description: '', unitOfMeasureId: '', quantity: '1' })} aria-label="Line type" style={{ width: '100%' }}>
                    {LINE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select></td>
                ) : null}
                <td>
                  {l.type === 'G/L Account' ? <GlAccountSelect name={`_rq${i}`} ariaLabel="G/L account" valueField="code" accounts={lookups.accounts} value={l.no} onChange={(v) => pickNo(i, v)} />
                    : l.type === 'Fixed Asset' ? <SearchableSelect name={`_rq${i}`} ariaLabel="Fixed asset" items={lookups.fixedAssets} getValue={(a) => a.no} getLabel={(a) => `${a.no} — ${a.description}`} value={l.no} onChange={(v) => pickNo(i, v)} placeholder="Search asset…" emptyText="No fixed assets" />
                      : <SearchableSelect name={`_rq${i}`} ariaLabel="Item" items={lookups.items} getValue={(x) => x.no} getLabel={(x) => `${x.no} — ${x.description}`} value={l.no} onChange={(v) => pickNo(i, v)} placeholder="Search item…" emptyText="No items" />}
                </td>
                <td><input type="text" value={l.description} onChange={(e) => set(i, { description: e.target.value })} aria-label="Description" style={{ width: '100%' }} /></td>
                {isStore ? (
                  <td><select value={l.unitOfMeasureId} onChange={(e) => set(i, { unitOfMeasureId: e.target.value })} aria-label="Unit of measure" style={{ width: '100%' }}>
                    {units.length ? units.map((u) => <option key={u.id} value={String(u.id)}>{u.code}</option>) : <option value="">—</option>}
                  </select></td>
                ) : null}
                {isStore ? (
                  <td><select value={l.locationId} onChange={(e) => set(i, { locationId: e.target.value })} aria-label="Location" style={{ width: '100%' }}>
                    <option value="">(store location)</option>
                    {lookups.locations.map((loc) => <option key={loc.id} value={String(loc.id)}>{loc.code}</option>)}
                  </select></td>
                ) : null}
                <td><input type="number" min={1} value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} aria-label="Quantity" required disabled={l.type === 'Fixed Asset'} style={{ width: '100%' }} /></td>
                {isStore ? <td className="num" style={short ? { color: 'var(--bad)' } : undefined}>{stock == null ? '—' : stock}{short ? ' ⚠' : ''}</td>
                  : <td><MoneyInput value={l.unitPrice} onChange={(v) => set(i, { unitPrice: v })} ariaLabel="Unit price" min={0} style={{ width: '100%', textAlign: 'right' }} /></td>}
                {!isStore ? <td className="num">{cur(Math.round((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0) * 100))}</td> : null}
                <td><button type="button" className="btn sm ghost" onClick={() => setLines(lines.filter((_, idx) => idx !== i))} aria-label="Remove">×</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="inline" style={{ marginTop: 8, justifyContent: 'space-between' }}>
        <button type="button" className="btn ghost sm" onClick={() => setLines([...lines, emptyLine(type)])}>Add line</button>
        {isStore ? <span className="tiny muted-cell">A line cannot ask for more than the store has on hand</span> : <span className="tiny muted-cell">Estimated total {cur(total)}</span>}
      </div>
    </>
  );
}

export const linesOf = (r: RequisitionDetail): RequisitionLineDraft[] =>
  r.line_items.length ? r.line_items.map((l) => ({
    type: l.type, no: l.no, description: l.description, unitOfMeasureId: l.unit_of_measure_id ? String(l.unit_of_measure_id) : '',
    quantity: String(l.quantity), unitPrice: l.unit_price ? toTwoDp(String(l.unit_price / 100)) : '', locationId: l.location_id ? String(l.location_id) : '',
  })) : [emptyLine(r.requisition_type)];

export function NewRequisitionButton({ type, lookups }: { type: RequisitionType; lookups: RequisitionLookups }) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<RequisitionLineDraft[]>([emptyLine(type)]);
  const label = type === 'Store Requisition' ? 'New store requisition' : 'New purchase requisition';
  return (
    <>
      <button type="button" className="btn" onClick={() => { setLines([emptyLine(type)]); setOpen(true); }}>{label}</button>
      {open ? (
        <FormModal title={label} wide onClose={() => setOpen(false)} onSubmit={(v) => requestRequisition(type, v, lines)}
          submitLabel="Save" successTitle="Requisition captured" successDetail={(d) => `${d.no} saved — send it for approval when ready`} redirectTo={(d) => `/requisitions/view/${d.no}`}>
          <RequisitionFields type={type} lookups={lookups} lines={lines} setLines={setLines} />
        </FormModal>
      ) : null}
    </>
  );
}

export function RequisitionEditForm({ requisition, lookups }: { requisition: RequisitionDetail; lookups: RequisitionLookups }) {
  const { close } = useEditableCard();
  const [lines, setLines] = useState<RequisitionLineDraft[]>(() => linesOf(requisition));
  return (
    <FormModal inline title={`Edit ${requisition.no}`} wide onClose={close} onSubmit={(v) => saveRequisition(requisition.no, requisition.requisition_type, v, lines)} submitLabel="Save changes" successTitle="Requisition updated">
      <RequisitionFields type={requisition.requisition_type} lookups={lookups} initial={requisition} lines={lines} setLines={setLines} />
    </FormModal>
  );
}

/* ------------------------------------------------------------ per-line editors */

/** Tab52203516 "Quantity Approved" — the approver trims a line, never above what was asked. */
export function QuantityApprovedCell({ no, line }: { no: string; line: RequisitionLineView }) {
  const { run, busy } = useRunAction();
  const [value, setValue] = useState(String(line.quantity_approved));
  const dirty = Number(value) !== line.quantity_approved;
  return (
    <span className="inline" style={{ justifyContent: 'flex-end', gap: 4 }}>
      <input type="number" min={line.quantity_issued} max={line.quantity} value={value} onChange={(e) => setValue(e.target.value)} aria-label="Quantity approved" style={{ width: 72, textAlign: 'right' }} />
      {dirty ? <button type="button" className="btn sm" disabled={busy} onClick={() => run(() => setQuantityApprovedAction(no, line.id, Number(value)), 'Quantity approved saved')}>{busy ? '…' : 'Save'}</button> : null}
    </span>
  );
}

/** Pag52203805 issue — Quantity To Issue per line, then Post (Cod52203477.IssueStoreItems). */
export function IssueStoreForm({ requisition }: { requisition: RequisitionDetail }) {
  const { run, busy } = useRunAction();
  const open = requisition.line_items.filter((l) => l.quantity_approved - l.quantity_issued > 0);
  const [qty, setQty] = useState<Record<number, string>>(() => Object.fromEntries(open.map((l) => [l.id, String(l.quantity_to_issue || (l.quantity_approved - l.quantity_issued))])));
  const quantities = open.map((l) => ({ lineId: l.id, quantity: Number(qty[l.id]) || 0 }));
  const total = quantities.reduce((s, q) => s + q.quantity, 0);
  return (
    <>
      <table>
        <thead><tr><th>Item</th><th>Description</th><th>Unit</th><th>Location</th><th className="num">Approved</th><th className="num">Issued</th><th className="num">In store</th><th className="num" style={{ width: 110 }}>To issue</th></tr></thead>
        <tbody>
          {open.map((l) => {
            const left = l.quantity_approved - l.quantity_issued;
            const over = Number(qty[l.id]) > left || Number(qty[l.id]) > l.quantity_in_store;
            return (
              <tr key={l.id}>
                <td className="mono">{l.no}</td><td>{l.description}</td><td>{l.unit_of_measure_code || '—'}</td><td className="mono">{l.location_code || '—'}</td>
                <td className="num">{l.quantity_approved}</td><td className="num">{l.quantity_issued}</td>
                <td className="num" style={l.quantity_in_store < left ? { color: 'var(--bad)' } : undefined}>{l.quantity_in_store}</td>
                <td className="num"><input type="number" min={0} max={Math.min(left, l.quantity_in_store)} value={qty[l.id] ?? ''} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })}
                  aria-label="Quantity to issue" style={{ width: '100%', textAlign: 'right', ...(over ? { borderColor: 'var(--bad)' } : {}) }} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="inline" style={{ marginTop: 8, justifyContent: 'space-between' }}>
        <span className="tiny muted-cell">Each line issued posts a Negative Adjmt. item journal line at its location · {total} unit{total === 1 ? '' : 's'} to issue</span>
        <button type="button" className="btn" disabled={busy || !total} onClick={() => run(() => issueStoreItemsAction(requisition.no, quantities), {
          confirm: { title: 'Issue these items?', message: `${total} unit(s) leave the store and post to inventory now.`, confirmLabel: 'Issue' },
          successTitle: (d: { issued: number; complete: boolean; journalLines: string[] }) => (d.complete ? `Issued in full — ${d.issued} unit(s)` : `Issued ${d.issued} unit(s) — more to come`),
          successDetail: (d: { journalLines: string[] }) => `Item journal ${d.journalLines.join(', ')}`,
        })}>{busy ? 'Issuing…' : 'Issue items'}</button>
      </div>
    </>
  );
}

/** Pag52203556 Requisitions Review — Decision + Target per line, then Execute. */
export function ReviewLineRow({ no, line, lookups }: { no: string; line: RequisitionLineView; lookups: RequisitionLookups }) {
  const { run, busy } = useRunAction();
  const [decision, setDecision] = useState<string>(line.decision);
  const [target, setTarget] = useState<string>(line.target_no ?? '');
  const dirty = decision !== line.decision || target !== (line.target_no ?? '');
  if (line.processed) return <span className="tiny muted-cell">{line.decision} → <span className="mono">{line.order_no}</span></span>;
  return (
    <span className="inline" style={{ gap: 6, flexWrap: 'nowrap' }}>
      <select value={decision} onChange={(e) => { setDecision(e.target.value); setTarget(''); }} aria-label="Decision" style={{ width: 150 }}>
        <option value="">(undecided)</option><option value="RFQ">RFQ → Purchase Quote</option><option value="Order">Order → Purchase Order</option><option value="Append to Order">Append to open order</option>
      </select>
      {decision === 'Append to Order' ? (
        <SearchableSelect name={`_t${line.id}`} ariaLabel="Purchase order" items={lookups.openOrders} getValue={(o) => o.no} getLabel={(o) => `${o.no} — ${o.vendor_name}`} value={target} onChange={setTarget} placeholder="Open order…" emptyText="No open purchase orders" style={{ width: 240 }} />
      ) : decision ? (
        <SearchableSelect name={`_t${line.id}`} ariaLabel="Vendor" items={lookups.vendors} getValue={(v) => v.no} getLabel={(v) => `${v.no} — ${v.name}`} value={target} onChange={setTarget} placeholder="Vendor…" emptyText="No vendors" style={{ width: 240 }} />
      ) : null}
      {dirty ? <button type="button" className="btn sm" disabled={busy} onClick={() => run(() => setLineDecisionAction(no, line.id, decision, target), 'Decision saved')}>{busy ? '…' : 'Save'}</button> : null}
    </span>
  );
}

/* --------------------------------------------------------------- buttons */

const simple = (label: string, action: (no: string) => Promise<{ ok: boolean; error?: string; data?: unknown }>,
  confirm: { title: string; message: string; confirmLabel: string; danger?: boolean }, successTitle: string | ((d: never) => string), defaultClass = 'btn sm ghost') =>
  function Button({ no, className = defaultClass }: { no: string; className?: string }) {
    const { run, busy } = useRunAction();
    return <button type="button" className={className} disabled={busy} onClick={() => run(() => action(no) as never, { confirm, successTitle: successTitle as never })}>{busy ? 'Working…' : label}</button>;
  };

export const SubmitRequisitionButton = simple('Send for approval', submitRequisitionAction, { title: 'Send this requisition for approval?', message: 'It can no longer be edited while pending.', confirmLabel: 'Send for approval' },
  ((d: { autoApproved: boolean }) => (d.autoApproved ? 'Approved' : 'Sent for approval')) as never);
export const CancelRequisitionApprovalButton = simple('Cancel approval request', cancelRequisitionApprovalAction, { title: 'Recall this requisition?', message: 'It goes back to Open.', confirmLabel: 'Recall' }, 'Recalled — back to Open');
export const ReopenRequisitionButton = simple('Re-open', reopenRequisitionAction, { title: 'Re-open this requisition?', message: 'It goes back to Open for amendment and must be approved again.', confirmLabel: 'Re-open' }, 'Re-opened');
/** Deleting from the card leaves nothing to show, so it lands on the list the card came from —
 *  store or purchase requisitions, which the card knows and this button does not. */
export function DeleteRequisitionButton({ no, listHref, className = 'btn sm ghost' }: { no: string; listHref: string; className?: string }) {
  const { run, busy } = useRunAction();
  return <button type="button" className={className} disabled={busy} onClick={() => run(() => deleteRequisitionAction(no), {
    confirm: { title: 'Delete this requisition?', message: 'It is removed permanently.', confirmLabel: 'Delete', danger: true }, successTitle: 'Deleted', redirectTo: listHref,
  })}>{busy ? 'Working…' : 'Delete'}</button>;
}
export const ConfirmReceiptButton = simple('Confirm receipt', confirmStoreReceiptAction, { title: 'Confirm you have received the items?', message: 'The requisition is marked as received.', confirmLabel: 'I have received them' }, 'The requisition has been marked as received', 'btn sm');
export const ExecuteReviewButton = simple('Execute — raise documents', executeRequisitionReviewAction, { title: 'Raise the purchase documents?', message: 'Every decided line becomes a purchase quote or order (one per vendor), or is appended to the open order chosen.', confirmLabel: 'Execute' },
  ((d: { documents: { no: string; documentType: string; appended: boolean }[]; closed: boolean }) => `${d.documents.map((x) => `${x.appended ? 'Appended to' : 'Raised'} ${x.documentType} ${x.no}`).join(' · ')}${d.closed ? ' — PR closed' : ''}`) as never, 'btn sm');
export { DelegateButton } from '@/components/ui/delegate-button';

export function ApproveRequisitionButton({ no, type, className = 'btn sm' }: { no: string; type: RequisitionType; className?: string }) {
  const { run, busy } = useRunAction();
  return <button type="button" className={className} disabled={busy} onClick={() => run(() => approveRequisitionAction(no, type), { confirm: { title: 'Approve this requisition?', message: type === 'Store Requisition' ? 'The store can then issue the items.' : 'Procurement can then raise the purchase documents.', confirmLabel: 'Approve' }, successTitle: 'Approved' })}>{busy ? 'Working…' : 'Approve'}</button>;
}

export function RejectRequisitionButton({ no, type, className = 'btn sm ghost' }: { no: string; type: RequisitionType; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Send back</button>
      {open ? (
        <FormModal title="Send back to the requester" onClose={() => setOpen(false)} onSubmit={(v) => rejectRequisitionAction(no, type, String(v.reason || ''))} submitLabel="Send back" submitClass="btn danger" successTitle="Sent back — Open again" resultStyle="popup">
          <Field name="reason" label="Reason" type="textarea" required />
        </FormModal>
      ) : null}
    </>
  );
}

/** AL "PR Closed By" Direct Receipt of Goods/Services | Rejection. */
export function ClosePrButton({ no, className = 'btn sm ghost' }: { no: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('Direct Receipt of Goods/Services');
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Close PR</button>
      {open ? (
        <FormModal title="Close purchase requisition" onClose={() => setOpen(false)} onSubmit={(v) => closePurchaseRequisitionAction(no, v)} submitLabel="Close PR" submitClass="btn danger" successTitle="Purchase requisition closed">
          <Field name="reason" label="Closed by" type="select" defaultValue={reason} onChange={(e) => setReason(e.target.value)}
            options={[{ value: 'Direct Receipt of Goods/Services', label: 'Direct receipt of goods / services — bought without a PO' }, { value: 'Rejection', label: 'Rejection — will not be procured' }]} />
          <Field name="note" label={reason === 'Rejection' ? 'Reason' : 'Note'} type="textarea" required={reason === 'Rejection'} />
        </FormModal>
      ) : null}
    </>
  );
}
