'use client';

import { useEffect, useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useRunAction } from '@/components/ui/run-action';
import { useFormat } from '@/components/ui/format-provider';
import { today } from '@/lib/format';
import {
  requestItemJournalLine, saveItemJournalLine, deleteItemJournalLineRequest, submitItemJournalLineRequest,
  cancelItemJournalLineApprovalRequest, approveItemJournalLineRequest, rejectItemJournalLineRequest,
  reopenItemJournalLineRequest, postItemJournalLineRequest, itemUnitsOfMeasureRequest, openLotsForItemRequest,
} from '@/app/actions/inventory';
import type {
  ItemJournalLineView, ItemJournalEntryType, ItemLedgerEntry, ItemUnitOfMeasureView, Location,
} from '@/lib/types';

type EligibleItem = {
  id: number; no: string; description: string; costing_method: string; unit_cost: number;
};
type EligibleLocation = Pick<Location, 'id' | 'code' | 'name'>;

const ENTRY_TYPES: { value: ItemJournalEntryType; label: string }[] = [
  { value: 'Positive Adjmt.', label: 'Positive Adjmt. (increase stock)' },
  { value: 'Negative Adjmt.', label: 'Negative Adjmt. (decrease stock)' },
];

function LineFields({ items, locations, initial }: {
  items: EligibleItem[]; locations: EligibleLocation[]; initial?: Partial<ItemJournalLineView> | null;
}) {
  const { cur } = useFormat();
  const editing = !!initial;
  const [entryType, setEntryType] = useState<ItemJournalEntryType>(initial?.entry_type ?? 'Positive Adjmt.');
  const [itemId, setItemId] = useState(String(initial?.item_id ?? ''));
  const [locationId, setLocationId] = useState(String(initial?.location_id ?? (locations[0]?.id ?? '')));
  const [unitOfMeasureId, setUnitOfMeasureId] = useState(String(initial?.unit_of_measure_id ?? ''));
  const [uoms, setUoms] = useState<ItemUnitOfMeasureView[]>([]);
  const [appliesToEntryId, setAppliesToEntryId] = useState(String(initial?.applies_to_entry_id ?? ''));
  const [openLots, setOpenLots] = useState<ItemLedgerEntry[]>([]);

  const item = items.find((i) => String(i.id) === itemId);
  const isSpecific = entryType === 'Negative Adjmt.' && item?.costing_method === 'Specific';

  useEffect(() => {
    let cancelled = false;
    if (!itemId) { setUoms([]); return; }
    itemUnitsOfMeasureRequest(Number(itemId)).then((res) => {
      if (!cancelled && res.ok) setUoms(res.data);
    });
    return () => { cancelled = true; };
  }, [itemId]);

  useEffect(() => {
    let cancelled = false;
    if (!isSpecific || !itemId || !locationId) { setOpenLots([]); return; }
    openLotsForItemRequest(Number(itemId), Number(locationId)).then((res) => {
      if (!cancelled && res.ok) setOpenLots(res.data);
    });
    return () => { cancelled = true; };
  }, [isSpecific, itemId, locationId]);

  return (
    <>
      <div className="grid g2">
        <Field
          name="entryType" label="Entry type" type="select" required disabled={editing}
          defaultValue={entryType} options={ENTRY_TYPES}
          onChange={(e) => setEntryType(e.target.value as ItemJournalEntryType)}
        />
        <Field name="postingDate" label="Posting date" type="date" required defaultValue={initial?.posting_date ?? today()} />
      </div>

      <SearchableSelect
        name="itemId" label="Item" required items={items} value={itemId} disabled={editing}
        getValue={(i) => String(i.id)} getLabel={(i) => `${i.no} — ${i.description}`}
        onChange={(v) => { setItemId(v); setUnitOfMeasureId(''); setAppliesToEntryId(''); }}
        placeholder="Search item…" emptyText="No matching items"
      />

      <SearchableSelect
        name="locationId" label="Location" required items={locations} value={locationId}
        getValue={(l) => String(l.id)} getLabel={(l) => `${l.code} — ${l.name}`}
        onChange={(v) => { setLocationId(v); setAppliesToEntryId(''); }}
        placeholder="Search location…" emptyText="No matching locations"
      />

      <div className="grid g2">
        <SearchableSelect
          name="unitOfMeasureId" label="Unit of measure" required items={uoms} value={unitOfMeasureId}
          disabled={!itemId} getValue={(u) => String(u.unit_of_measure_id)}
          getLabel={(u) => `${u.unit_of_measure_code} (${u.qty_per_unit_of_measure} per)`}
          onChange={setUnitOfMeasureId}
          placeholder={itemId ? 'Search unit…' : 'Pick an item first'}
        />
        <Field name="quantity" label="Quantity" type="number" required min={1} step="1" defaultValue={initial?.quantity ?? ''} />
      </div>

      {entryType === 'Positive Adjmt.' ? (
        <Field
          name="unitCost" label="Unit cost" type="currency"
          defaultValue={initial?.unit_cost != null ? String(initial.unit_cost / 100) : (item ? String(item.unit_cost / 100) : '')}
          hint="Defaults to the item's own unit cost — override for this receipt if it differs"
        />
      ) : isSpecific ? (
        <SearchableSelect
          name="appliesToEntryId" label="Applies to lot" required items={openLots} value={appliesToEntryId}
          getValue={(l) => String(l.id)}
          getLabel={(l) => `${l.document_no} — ${l.remaining_quantity} remaining @ ${cur(l.unit_cost)}`}
          onChange={setAppliesToEntryId}
          placeholder="Search open lot…" emptyText="No open lots at this location"
          hint="This item's Costing Method is Specific — pick exactly which receipt this adjustment consumes"
        />
      ) : (
        <div className="note">
          {item ? `Costed on posting using ${item.costing_method} — the cost isn't final until then.` : 'Pick an item to see its costing method.'}
        </div>
      )}

      <Field name="description" label="Description" defaultValue={initial?.description ?? ''} placeholder="Optional" />
    </>
  );
}

export function NewAdjustmentButton({ items, locations, prefill }: {
  items: EligibleItem[]; locations: EligibleLocation[];
  prefill?: { itemId: number; locationId: number; quantity: number } | null;
}) {
  const [open, setOpen] = useState(false);
  const initial: Partial<ItemJournalLineView> | null = prefill ? {
    entry_type: 'Positive Adjmt.', item_id: prefill.itemId, location_id: prefill.locationId,
    quantity: prefill.quantity, unit_cost: items.find((i) => i.id === prefill.itemId)?.unit_cost ?? 0,
  } : null;
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>New adjustment</button>
      {open ? (
        <FormModal
          title="New item journal line" wide
          onClose={() => setOpen(false)}
          onSubmit={requestItemJournalLine}
          submitLabel="Save"
          successTitle="Item journal line captured"
          successDetail={(d) => `${d.no} saved — send it for approval when ready`}
        >
          <LineFields items={items} locations={locations} initial={initial} />
        </FormModal>
      ) : null}
    </>
  );
}

export function EditButton({ line, items, locations, className = 'btn ghost' }: {
  line: ItemJournalLineView; items: EligibleItem[]; locations: EligibleLocation[]; className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Edit</button>
      {open ? (
        <FormModal
          title={`Edit ${line.no}`} wide
          onClose={() => setOpen(false)}
          onSubmit={(values) => saveItemJournalLine(line.no, values)}
          submitLabel="Save changes"
          successTitle="Item journal line updated"
        >
          <LineFields items={items} locations={locations} initial={line} />
        </FormModal>
      ) : null}
    </>
  );
}

export function SubmitButton({ no, className = 'btn sm ghost' }: { no: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => submitItemJournalLineRequest(no), {
        confirm: { title: 'Send this line for approval?', message: 'It can no longer be edited while pending.', confirmLabel: 'Send for approval' },
        successTitle: (d) => (d.autoApproved ? 'Approved — ready to post' : 'Sent for approval'),
      })}>
      {busy ? 'Working…' : 'Send for approval'}
    </button>
  );
}

export function CancelApprovalButton({ no, className = 'btn sm ghost' }: { no: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => cancelItemJournalLineApprovalRequest(no), {
        confirm: { title: 'Recall this line?', message: 'It goes back to Open so you can amend and resubmit it.', confirmLabel: 'Recall' },
        successTitle: 'Recalled — back to Open',
      })}>
      {busy ? 'Working…' : 'Cancel approval request'}
    </button>
  );
}

export { DelegateButton } from '@/components/ui/delegate-button';

export function ApproveButton({ no, className = 'btn sm' }: { no: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => approveItemJournalLineRequest(no), {
        confirm: { title: 'Approve this line?', message: 'It becomes ready to post. Nothing moves until it is posted.', confirmLabel: 'Approve' },
        successTitle: 'Approved — ready to post',
      })}>
      {busy ? 'Working…' : 'Approve'}
    </button>
  );
}

export function RejectButton({ no, className = 'btn sm ghost' }: { no: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Reject</button>
      {open ? (
        <FormModal
          title="Reject item journal line"
          onClose={() => setOpen(false)}
          onSubmit={(values) => rejectItemJournalLineRequest(no, String(values.reason || ''))}
          submitLabel="Reject" submitClass="btn danger"
          successTitle="Rejected — back to Open" resultStyle="popup"
        >
          <Field name="reason" label="Reason" type="textarea" required />
        </FormModal>
      ) : null}
    </>
  );
}

export function ReopenButton({ no, className = 'btn sm ghost' }: { no: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => reopenItemJournalLineRequest(no), {
        confirm: { title: 'Reopen this line?', message: 'It goes back to Open for amendment. It must be approved again before posting.', confirmLabel: 'Reopen' },
        successTitle: 'Reopened — back to Open',
      })}>
      {busy ? 'Working…' : 'Reopen'}
    </button>
  );
}

export function PostButton({ no, className = 'btn sm' }: { no: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => postItemJournalLineRequest(no), {
        confirm: {
          title: 'Post this item journal line?',
          message: 'Stock and the G/L move immediately. This cannot be undone from here.',
          confirmLabel: 'Post',
        },
        successTitle: 'Item journal line posted',
        successDetail: (d) => (d.journalNo ? `Journal ${d.journalNo} posted` : 'Posted — no G/L entry (zero cost)'),
      })}>
      {busy ? 'Working…' : 'Post'}
    </button>
  );
}

export function DeleteButton({ no, className = 'btn sm ghost' }: { no: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => deleteItemJournalLineRequest(no), {
        confirm: { title: 'Delete this line?', message: 'It is removed permanently. Only an open line can be deleted.', confirmLabel: 'Delete' },
        successTitle: 'Deleted',
      })}>
      {busy ? 'Working…' : 'Delete'}
    </button>
  );
}
