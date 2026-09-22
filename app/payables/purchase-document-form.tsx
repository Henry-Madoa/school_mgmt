'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field, MoneyInput, toTwoDp } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { today, toCents } from '@/lib/format';
import { Money } from '@/components/ui/money';
import { DocumentTotalsPanel } from '@/components/ui/document-totals';
import {
  computeDocumentTotals, computeLineAmounts, previewVatPct,
  type DocumentLineDraft, type VatPreview,
} from '@/lib/documentTotals';
import { requestPurchaseDocument, type PurchaseLineDraft } from '@/app/actions/payables';
import { PurchaseCreditMemoSourcePicker } from './credit-memo-source';
import type { PurchaseCreditMemoSource } from '@/lib/purchaseDocuments';
import type { PaymentMethod, PaymentTerms, PurchaseDocumentDetail, PurchaseDocumentType } from '@/lib/types';

type EligibleVendor = {
  id: number; no: string; name: string; blocked: string;
  payment_terms_code: string | null; vat_bus_posting_group_code: string | null;
};

/** Every table-relation list the header + line fields pick from. The Payables tab builds it once
 *  and hands the same object to the New modal and to the document card's inline editor. */
export interface PurchaseDocLookups {
  vendors: EligibleVendor[]; paymentTerms: PaymentTerms[]; paymentMethods: PaymentMethod[];
  accounts: { code: string; name: string }[]; items: { no: string; description: string }[];
  fixedAssets: { no: string; description: string }[]; locations: { code: string; name: string }[];
  /** The VAT Posting Setup, flattened, so the totals can include VAT before the document is saved. */
  vatPreview?: VatPreview;
}

const LINE_TYPES = ['G/L Account', 'Item', 'Fixed Asset', 'Comment'];
export const emptyLine = (): PurchaseLineDraft => ({
  type: 'G/L Account', no: '', description: '', quantity: '1', directUnitCost: '', lineDiscountPct: '',
  locationCode: '', faDepreciationBookCode: '',
});

export function DocFields({ documentType, vendors, paymentTerms, paymentMethods, accounts, items, fixedAssets, locations, vatPreview, initial, lines, setLines }: PurchaseDocLookups & {
  documentType: PurchaseDocumentType;
  initial?: PurchaseDocumentDetail | null; lines: PurchaseLineDraft[]; setLines: (l: PurchaseLineDraft[]) => void;
}) {
  const editing = !!initial;
  const [vendorId, setVendorId] = useState(String(initial?.vendor_id ?? ''));
  // VAT follows the vendor's VAT Bus. Posting Group, so the totals move when the vendor changes.
  const vatBus = initial?.vat_bus_posting_group_code
    ?? vendors.find((v) => String(v.id) === vendorId)?.vat_bus_posting_group_code
    ?? null;
  const drafts = lines.map((l) => asDraft(l, vatPreview, vatBus));
  const totals = computeDocumentTotals(drafts, { pricesInclVat: !!vatPreview?.pricesInclVat });
  const set = (i: number, k: keyof PurchaseLineDraft, v: string) => setLines(lines.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));
  const patch = (i: number, p: Partial<PurchaseLineDraft>) => setLines(lines.map((l, idx) => (idx === i ? { ...l, ...p } : l)));

  /** What the posting routine would name this line if the description were left blank — the
   *  master record's own name (lib/purchaseDocuments.ts's resolveLine). */
  const masterName = (type: string, no: string): string => {
    if (!no) return '';
    if (type === 'G/L Account') return accounts.find((a) => a.code === no)?.name ?? '';
    if (type === 'Item') return items.find((a) => a.no === no)?.description ?? '';
    if (type === 'Fixed Asset') return fixedAssets.find((a) => a.no === no)?.description ?? '';
    return '';
  };
  /** Picking a No. fills the description with that record's name, but never overwrites wording
   *  the user typed themselves. */
  const pickNo = (i: number, l: PurchaseLineDraft, no: string) => {
    const wasAuto = !l.description || l.description === masterName(l.type, l.no);
    patch(i, { no, description: wasAuto ? masterName(l.type, no) : l.description });
  };
  const pickType = (i: number, l: PurchaseLineDraft, type: string) => {
    const wasAuto = !l.description || l.description === masterName(l.type, l.no);
    patch(i, { type, no: '', description: wasAuto ? '' : l.description });
  };

  // Copying a posted invoice replaces the whole line set — the memo is being raised *for* that
  // invoice, so a half-copied document would be the confusing outcome. The vendor is already
  // the invoice's: the picker only ever lists the chosen vendor's invoices.
  const copyFromInvoice = (src: PurchaseCreditMemoSource) => {
    setLines(src.lines.map((l) => ({
      type: l.type, no: l.no ?? '', description: l.description ?? '',
      quantity: String(l.quantity), directUnitCost: (l.directUnitCost / 100).toFixed(2),
      lineDiscountPct: l.lineDiscountPct ? String(l.lineDiscountPct) : '',
      locationCode: '', faDepreciationBookCode: '',
    })));
  };

  return (
    <>
      <input type="hidden" name="documentType" value={documentType} />
      {documentType === 'Credit Memo' && editing && initial?.applies_to_doc_no
        ? <input type="hidden" name="appliesToDocNo" value={initial.applies_to_doc_no} /> : null}
      <div className="grid g2">
        <SearchableSelect
          name={editing ? 'vendorPick' : 'vendorId'} label="Vendor" required items={vendors} value={vendorId} disabled={editing}
          getValue={(c) => String(c.id)} getLabel={(c) => `${c.no} — ${c.name}${c.blocked ? ` (blocked: ${c.blocked})` : ''}`}
          onChange={setVendorId} placeholder="Search vendor…" emptyText="No matching vendors"
        />
        {/* A disabled control is left out of FormData, so an edit still has to submit the vendor
            it was created against — the document keeps its vendor once lines exist. */}
        {editing ? <input type="hidden" name="vendorId" value={vendorId} /> : null}
        <Field name="postingDate" label="Posting date" type="date" required defaultValue={initial?.posting_date ?? today()} />
      </div>
      {/* Vendor first, then the invoice: the picker below lists only that vendor's open
          invoices, so it sits under the Vendor field rather than above it. */}
      {documentType === 'Credit Memo' && !editing
        ? <PurchaseCreditMemoSourcePicker vendorId={vendorId} onCopy={copyFromInvoice} /> : null}
      <div className="grid g3">
        <Field name="documentDate" label="Document date" type="date" defaultValue={initial?.document_date ?? today()} />
        <Field name="paymentTermsCode" label="Payment terms" type="select" defaultValue={initial?.payment_terms_code ?? ''}
          options={[{ value: '', label: '(from vendor)' }, ...paymentTerms.map((p) => ({ value: p.code, label: p.code }))]} />
        <Field name="paymentMethodCode" label="Payment method" type="select" defaultValue={initial?.payment_method_code ?? ''}
          options={[{ value: '', label: '(none)' }, ...paymentMethods.map((p) => ({ value: p.code, label: p.code }))]} />
      </div>
      <Field name="vendorInvoiceNo" label="Vendor invoice no." defaultValue={initial?.vendor_invoice_no ?? ''} placeholder="Required to post an Invoice / Credit Memo" />

      <div className="hint" style={{ marginTop: 'calc(var(--sp)*1)' }}>Lines</div>
      <table>
        <thead>
          <tr>
            <th style={{ width: 110 }}>Type</th><th>No.</th><th>Description <span className="req">*</span></th>
            <th style={{ width: 70 }}>Qty</th><th style={{ width: 120 }}>Direct unit cost</th>
            <th style={{ width: 60 }}>Disc %</th>
            <th className="num" style={{ width: 120 }}>Line Amount</th>
            <th style={{ width: 40 }} />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>
                <select value={l.type} onChange={(e) => pickType(i, l, e.target.value)} aria-label="Line type">
                  {LINE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </td>
              <td>
                {/* Searchable, as on the sales side and the journal: these lists run too long to
                    scroll by eye. The hidden input's name is per-row scratch — lines travel as
                    state, not form fields. */}
                {l.type === 'Comment' ? null
                  : l.type === 'G/L Account'
                    ? <SearchableSelect name={`_lineNo${i}`} ariaLabel="Account" items={accounts} value={l.no} onChange={(v) => pickNo(i, l, v)}
                        getValue={(a) => a.code} getLabel={(a) => `${a.code} — ${a.name}`} placeholder="Search account…" emptyText="No matching accounts" />
                    : l.type === 'Item'
                      ? <SearchableSelect name={`_lineNo${i}`} ariaLabel="Item" items={items} value={l.no} onChange={(v) => pickNo(i, l, v)}
                          getValue={(a) => a.no} getLabel={(a) => `${a.no} — ${a.description}`} placeholder="Search item…" emptyText="No matching items" />
                      : <SearchableSelect name={`_lineNo${i}`} ariaLabel="Fixed asset" items={fixedAssets} value={l.no} onChange={(v) => pickNo(i, l, v)}
                          getValue={(a) => a.no} getLabel={(a) => `${a.no} — ${a.description}`} placeholder="Search fixed asset…" emptyText="No matching fixed assets" />}
              </td>
              <td>
                <input type="text" value={l.description} required maxLength={100}
                  onChange={(e) => set(i, 'description', e.target.value)} aria-label="Description"
                  placeholder={l.type === 'Comment' ? 'Comment text' : masterName(l.type, l.no) || 'What is being bought'} />
              </td>
              <td><input type="number" step="0.01" min={0} value={l.quantity} onChange={(e) => set(i, 'quantity', e.target.value)} aria-label="Quantity" disabled={l.type === 'Comment' || l.type === 'Fixed Asset'} /></td>
              <td><MoneyInput value={l.directUnitCost} onChange={(v) => set(i, 'directUnitCost', v)} className="num" min={0} ariaLabel="Direct unit cost" disabled={l.type === 'Comment'} placeholder={l.type === 'Fixed Asset' ? 'acquisition cost' : ''} /></td>
              <td><input type="number" step="0.01" min={0} max={100} value={l.lineDiscountPct} onChange={(e) => set(i, 'lineDiscountPct', e.target.value)} aria-label="Discount %" disabled={l.type === 'Comment'} /></td>
              <td className="num">
                {l.type === 'Comment' ? <span className="muted-cell">—</span>
                  : <Money cents={computeLineAmounts(drafts[i], { pricesInclVat: !!vatPreview?.pricesInclVat }).lineAmount} />}
              </td>
              <td><button type="button" className="btn sm ghost" onClick={() => setLines(lines.filter((_, idx) => idx !== i))} aria-label="Remove">×</button></td>
            </tr>
          ))}
          {lines.some((l) => l.type === 'Item') ? (
            <tr>
              <td colSpan={8} className="tiny">
                Item lines need a location:{' '}
                {lines.map((l, i) => (l.type === 'Item' ? (
                  <span key={i}>
                    line {i + 1}:{' '}
                    <select value={l.locationCode} onChange={(e) => set(i, 'locationCode', e.target.value)} aria-label="Location">
                      <option value="">…</option>{locations.map((loc) => <option key={loc.code} value={loc.code}>{loc.code}</option>)}
                    </select>{' '}
                  </span>
                ) : null))}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <button type="button" className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setLines([...lines, emptyLine()])}>Add line</button>
      <DocumentTotalsPanel
        totals={totals} showVat currencyCode={initial?.currency_code}
        note={vatPreview?.pricesInclVat ? 'unit costs include VAT' : 'VAT added to the net'}
      />
    </>
  );
}

/** The saved document's lines as editable drafts — cents back to a plain '1234.00' string. */
/** A draft row in the shape lib/documentTotals.ts adds up, with its VAT % resolved the way the
 *  save will resolve it (lib/vatEngine.ts's resolveVatSetup, via the flattened matrix). */
const asDraft = (
  l: PurchaseLineDraft, vatPreview: VatPreview | undefined, vatBus: string | null,
): DocumentLineDraft => ({
  type: l.type, no: l.no, quantity: Number(l.quantity) || 0, unitAmount: toCents(l.directUnitCost),
  lineDiscountPct: Number(l.lineDiscountPct) || 0,
  vatPct: previewVatPct(vatPreview, vatBus, l.type, l.no),
});

export const linesOf = (doc: PurchaseDocumentDetail): PurchaseLineDraft[] => (doc.lines.length
  ? doc.lines.map((l) => ({
    type: l.type, no: l.no ?? '', description: l.description ?? '', quantity: String(l.quantity),
    directUnitCost: toTwoDp(String(l.direct_unit_cost / 100)), lineDiscountPct: String(l.line_discount_pct),
    locationCode: l.location_code ?? '', faDepreciationBookCode: l.fa_depreciation_book_code ?? '',
  }))
  : [emptyLine()]);

export function NewPurchaseDocumentButton({ documentType, ...rest }: PurchaseDocLookups & {
  documentType: PurchaseDocumentType;
}) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<PurchaseLineDraft[]>([emptyLine()]);
  return (
    <>
      <button type="button" className="btn" onClick={() => { setLines([emptyLine()]); setOpen(true); }}>New {documentType.toLowerCase()}</button>
      {open ? (
        <FormModal
          title={`New purchase ${documentType.toLowerCase()}`} wide
          onClose={() => setOpen(false)}
          onSubmit={(v) => requestPurchaseDocument(v, lines)}
          submitLabel="Create" successTitle="Purchase document created"
          successDetail={(d) => `${d.no} created — submit it for approval`} redirectTo={(d) => `/payables/documents/${d.no}`}
        >
          <DocFields documentType={documentType} {...rest} lines={lines} setLines={setLines} />
        </FormModal>
      ) : null}
    </>
  );
}
