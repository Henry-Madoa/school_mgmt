'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Modal } from '@/components/ui/modal';
import { Field } from '@/components/ui/field';
import { Money } from '@/components/ui/money';
import { Pill, TableWrap, EmptyState, DefinitionList } from '@/components/ui/primitives';
import { formatDate } from '@/lib/format';
import {
  requestFixedAsset, saveFixedAsset, getFaDepreciationBooksRequest, saveFaDepreciationBook,
  listFaLedgerEntriesRequest,
} from '@/app/actions/fixedAssets';
import type {
  DepreciationBook, FaClass, FaDepreciationBookView, FaLedgerEntryView, FaPostingGroupView, FaSubclass,
  FaLocation, FixedAssetListRow,
} from '@/lib/types';

const DEPR_METHODS = ['Straight-Line', 'Declining-Balance 1', 'DB1/SL', 'Manual'].map((m) => ({ value: m, label: m }));

interface Masters {
  classes: FaClass[];
  subclasses: FaSubclass[];
  locations: FaLocation[];
  books: DepreciationBook[];
  postingGroups: FaPostingGroupView[];
  defaultBookCode: string | null;
  defaultPostingGroupCode: string | null;
}

function AssetFields({ masters, initial }: { masters: Masters; initial?: FixedAssetListRow | null }) {
  const editing = !!initial;

  return (
    <>
      <div className="grid g2">
        <Field name="description" label="Description" required defaultValue={initial?.description} />
        <Field name="description2" label="Description 2" defaultValue={initial?.description_2 ?? ''} placeholder="Optional" />
      </div>

      <div className="grid g2">
        <Field name="assetTag" label="Asset tag" defaultValue={initial?.asset_tag ?? ''} placeholder="Optional" />
        <Field name="serialNo" label="Serial no." defaultValue={initial?.serial_no ?? ''} placeholder="Optional" />
      </div>

      <div className="grid g2">
        <Field
          name="faClassCode" label="FA class" type="select" defaultValue={initial?.fa_class_code ?? ''}
          options={[{ value: '', label: '(none)' }, ...masters.classes.map((c) => ({ value: c.code, label: `${c.code} — ${c.description}` }))]}
        />
        <Field
          name="faSubclassCode" label="FA subclass" type="select" defaultValue={initial?.fa_subclass_code ?? ''}
          options={[{ value: '', label: '(none)' }, ...masters.subclasses.map((c) => ({ value: c.code, label: `${c.code} — ${c.description}` }))]}
        />
      </div>

      <div className="grid g2">
        <Field
          name="faLocationCode" label="FA location" type="select" defaultValue={initial?.fa_location_code ?? ''}
          options={[{ value: '', label: '(none)' }, ...masters.locations.map((l) => ({ value: l.code, label: `${l.code} — ${l.description}` }))]}
        />
        <Field name="responsibleEmployee" label="Responsible employee" defaultValue={initial?.responsible_employee ?? ''} placeholder="Optional" />
      </div>

      <Field name="vendorName" label="Acquired from" defaultValue={initial?.vendor_name ?? ''} placeholder="Supplier name (optional)" />

      {editing ? (
        <div className="grid g2">
          <Field name="blocked" label="Blocked" type="checkbox" defaultValue={initial!.blocked ? 'on' : ''} />
          <Field name="inactive" label="Inactive" type="checkbox" defaultValue={initial!.inactive ? 'on' : ''} />
        </div>
      ) : null}
    </>
  );
}

export function NewAssetButton({ masters, className = 'btn' }: { masters: Masters; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Add asset</button>
      {open ? (
        <FormModal
          title="New fixed asset" wide
          onClose={() => setOpen(false)}
          onSubmit={requestFixedAsset}
          submitLabel="Create"
          successTitle="Fixed asset created"
          successDetail={(d) => `${d.no} created — set up its Depreciation Book, then post an Acquisition Cost`}
        >
          <AssetFields masters={masters} />
        </FormModal>
      ) : null}
    </>
  );
}

export function EditAssetButton({ asset, masters, className = 'btn ghost sm' }: {
  asset: FixedAssetListRow; masters: Masters; className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Edit</button>
      {open ? (
        <FormModal
          title={`Edit ${asset.no}`} wide
          onClose={() => setOpen(false)}
          onSubmit={(v) => saveFixedAsset(asset.no, v)}
          submitLabel="Save changes"
          successTitle="Fixed asset updated"
        >
          <AssetFields masters={masters} initial={asset} />
        </FormModal>
      ) : null}
    </>
  );
}

/* --------------------------------------------------------- FA Depreciation Book */

export function DepreciationBookButton({ asset, masters, className = 'btn ghost sm' }: {
  asset: FixedAssetListRow; masters: Masters; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [existing, setExisting] = useState<FaDepreciationBookView[] | null>(null);
  const [method, setMethod] = useState('Straight-Line');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getFaDepreciationBooksRequest(asset.id).then((res) => {
      if (cancelled || !res.ok) return;
      setExisting(res.data);
      if (res.data[0]) setMethod(res.data[0].depreciation_method);
    });
    return () => { cancelled = true; };
  }, [open, asset.id]);

  const current = existing?.find((b) => b.depreciation_book_code === (masters.defaultBookCode ?? existing[0]?.depreciation_book_code));
  const needsDb = method === 'Declining-Balance 1' || method === 'DB1/SL';
  const needsSl = method === 'Straight-Line' || method === 'DB1/SL';

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Depr. book</button>
      {open ? (
        <FormModal
          title={`Depreciation Book — ${asset.no}`} wide
          onClose={() => setOpen(false)}
          onSubmit={(v) => saveFaDepreciationBook(asset.id, v)}
          submitLabel="Save"
          successTitle="Depreciation book saved"
        >
          {existing === null ? <div className="hint">Loading…</div> : (
            <>
              <div className="grid g2">
                <Field
                  name="depreciationBookCode" label="Depreciation book" type="select" required
                  defaultValue={current?.depreciation_book_code ?? masters.defaultBookCode ?? masters.books[0]?.code ?? ''}
                  options={masters.books.map((b) => ({ value: b.code, label: `${b.code} — ${b.description}` }))}
                />
                <Field
                  name="faPostingGroupCode" label="FA posting group" type="select" required
                  defaultValue={current?.fa_posting_group_code ?? masters.defaultPostingGroupCode ?? masters.postingGroups[0]?.code ?? ''}
                  options={masters.postingGroups.map((g) => ({ value: g.code, label: `${g.code} — ${g.description}` }))}
                />
              </div>
              <div className="grid g2">
                <Field
                  name="depreciationMethod" label="Depreciation method" type="select" required
                  defaultValue={current?.depreciation_method ?? 'Straight-Line'} options={DEPR_METHODS}
                  onChange={(e) => setMethod(e.target.value)}
                />
                <Field
                  name="disposalCalculationMethod" label="Disposal calculation" type="select"
                  defaultValue={current?.disposal_calculation_method ?? 'Net'}
                  options={[{ value: 'Net', label: 'Net' }, { value: 'Gross', label: 'Gross' }]}
                />
              </div>
              {method !== 'Manual' ? (
                <>
                  <div className="grid g2">
                    <Field name="depreciationStartingDate" label="Depreciation starting date" type="date" required defaultValue={current?.depreciation_starting_date ?? ''} />
                    <Field name="depreciationEndingDate" label="Depreciation ending date" type="date" defaultValue={current?.depreciation_ending_date ?? ''} hint="Optional — or set No. of Depreciation Years below" />
                  </div>
                  <div className="grid g3">
                    <Field name="noOfDepreciationYears" label="No. of depreciation years" type="number" step="0.5" min={0} defaultValue={current?.no_of_depreciation_years ?? ''} />
                    {needsSl ? <Field name="straightLinePct" label="Straight-Line %" type="number" step="0.01" min={0} defaultValue={current?.straight_line_pct ?? ''} hint="Optional — overrides the useful life" /> : null}
                    {needsDb ? <Field name="decliningBalancePct" label="Declining-Balance %" type="number" step="0.01" min={0} required defaultValue={current?.declining_balance_pct ?? ''} /> : null}
                  </div>
                </>
              ) : (
                <div className="note">Manual — you post Depreciation lines by hand; the Calculate Depreciation batch skips this asset.</div>
              )}
              <Field name="salvageValue" label="Salvage value" type="currency" defaultValue={current ? String(current.salvage_value / 100) : '0'} />

              {current ? (
                <DefinitionList
                  items={[
                    ['Acquisition cost', <Money key="a" cents={current.acquisition_cost} />],
                    ['Accumulated depreciation', <Money key="d" cents={current.accumulated_depreciation} />],
                    ['Book value', <Money key="b" cents={current.book_value} />],
                    current.disposed ? ['Status', <Pill key="s" tone="warn">Disposed</Pill>] : null,
                  ]}
                />
              ) : null}
            </>
          )}
        </FormModal>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------- ledger drill-down */

export function AssetLedgerButton({ asset, className = 'btn ghost sm' }: { asset: FixedAssetListRow; className?: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<FaLedgerEntryView[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listFaLedgerEntriesRequest({ fixedAssetId: asset.id }).then((res) => {
      if (!cancelled && res.ok) setRows(res.data);
    });
    return () => { cancelled = true; };
  }, [open, asset.id]);

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Ledger</button>
      {open ? (
        <Modal wide title={`FA ledger — ${asset.no}`} onClose={() => setOpen(false)}
          footer={<button type="button" className="btn ghost" onClick={() => setOpen(false)}>Close</button>}>
          {rows === null ? <EmptyState title="Loading…" /> : rows.length ? (
            <TableWrap>
              <thead>
                <tr><th>Date</th><th>Type</th><th>Document</th><th>Description</th><th className="num">Amount</th></tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td>{formatDate(e.fa_posting_date)}</td>
                    <td>{e.fa_posting_type}</td>
                    <td className="mono">{e.document_no}</td>
                    <td className="tiny muted-cell">{e.description ?? '—'}</td>
                    <td className="num"><Money cents={e.amount} /></td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          ) : <EmptyState icon="📄" title="No FA ledger entries yet" sub="Post an Acquisition Cost from the FA Journal." />}
        </Modal>
      ) : null}
    </>
  );
}
