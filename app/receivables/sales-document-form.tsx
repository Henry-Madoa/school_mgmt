'use client';

import { useState, type ReactNode } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field, MoneyInput, toTwoDp } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { today, toCents } from '@/lib/format';
import { Money } from '@/components/ui/money';
import { DocumentTotalsPanel } from '@/components/ui/document-totals';
import { computeDocumentTotals, computeLineAmounts, type DocumentLineDraft } from '@/lib/documentTotals';
import { requestSalesDocument, type SalesLineDraft } from '@/app/actions/receivables';
import { CreditMemoSourcePicker } from './credit-memo-source';
import type { CreditMemoSource } from '@/lib/salesDocuments';
import type { PaymentMethod, PaymentTerms, SalesDocumentDetail, SalesDocumentType } from '@/lib/types';

type EligibleCustomer = { id: number; no: string; name: string; blocked: string; payment_terms_code: string | null };

/** Every table-relation list the header + line fields pick from. The Receivables tab builds it
 *  once and hands the same object to the New modal and to the document card's inline editor. */
export interface SalesDocLookups {
  customers: EligibleCustomer[]; paymentTerms: PaymentTerms[]; paymentMethods: PaymentMethod[];
  accounts: { code: string; name: string }[]; items: { no: string; description: string }[];
  fixedAssets: { no: string; description: string }[]; locations: { code: string; name: string }[];
}

const LINE_TYPES = ['G/L Account', 'Item', 'Fixed Asset', 'Comment'];
export const emptyLine = (): SalesLineDraft => ({
  type: 'G/L Account', no: '', description: '', quantity: '1', unitPrice: '', lineDiscountPct: '',
  locationCode: '', faDepreciationBookCode: '',
});

export function DocFields({ documentType, customers, paymentTerms, paymentMethods, accounts, items, fixedAssets, locations, initial, lines, setLines }: SalesDocLookups & {
  documentType: SalesDocumentType;
  initial?: SalesDocumentDetail | null; lines: SalesLineDraft[]; setLines: (l: SalesLineDraft[]) => void;
}) {
  const editing = !!initial;
  const [customerId, setCustomerId] = useState(String(initial?.customer_id ?? ''));
  const set = (i: number, k: keyof SalesLineDraft, v: string) => setLines(lines.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));
  const drafts = lines.map(asDraft);
  const totals = computeDocumentTotals(drafts);
  const patch = (i: number, p: Partial<SalesLineDraft>) => setLines(lines.map((l, idx) => (idx === i ? { ...l, ...p } : l)));

  /** What the posting routine would name this line if the description were left blank — the
   *  master record's own name (lib/salesDocuments.ts's resolveLine). */
  const masterName = (type: string, no: string): string => {
    if (!no) return '';
    if (type === 'G/L Account') return accounts.find((a) => a.code === no)?.name ?? '';
    if (type === 'Item') return items.find((a) => a.no === no)?.description ?? '';
    if (type === 'Fixed Asset') return fixedAssets.find((a) => a.no === no)?.description ?? '';
    return '';
  };
  /** Picking a No. fills the description with that record's name, but never overwrites wording
   *  the user typed themselves. */
  const pickNo = (i: number, l: SalesLineDraft, no: string) => {
    const wasAuto = !l.description || l.description === masterName(l.type, l.no);
    patch(i, { no, description: wasAuto ? masterName(l.type, no) : l.description });
  };
  const pickType = (i: number, l: SalesLineDraft, type: string) => {
    const wasAuto = !l.description || l.description === masterName(l.type, l.no);
    patch(i, { type, no: '', description: wasAuto ? '' : l.description });
  };

  // Copying a posted invoice replaces the whole line set — the memo is being raised *for* that
  // invoice, so a half-copied document would be the confusing outcome. The customer is already
  // the invoice's: the picker only ever lists the chosen customer's invoices.
  const copyFromInvoice = (src: CreditMemoSource) => {
    setLines(src.lines.map((l) => ({
      type: l.type, no: l.no ?? '', description: l.description ?? '',
      quantity: String(l.quantity), unitPrice: (l.unitPrice / 100).toFixed(2),
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
          name={editing ? 'customerPick' : 'customerId'} label="Customer" required items={customers} value={customerId} disabled={editing}
          getValue={(c) => String(c.id)} getLabel={(c) => `${c.no} — ${c.name}${c.blocked ? ` (blocked: ${c.blocked})` : ''}`}
          onChange={setCustomerId} placeholder="Search customer…" emptyText="No matching customers"
        />
        {/* A disabled control is left out of FormData, so an edit still has to submit the customer
            it was created against — the document keeps its customer once lines exist. */}
        {editing ? <input type="hidden" name="customerId" value={customerId} /> : null}
        <Field name="postingDate" label="Posting date" type="date" required defaultValue={initial?.posting_date ?? today()} />
      </div>
      {/* Customer first, then the invoice: the picker below lists only that customer's open
          invoices, so it sits under the Customer field rather than above it. */}
      {documentType === 'Credit Memo' && !editing
        ? <CreditMemoSourcePicker customerId={customerId} onCopy={copyFromInvoice} /> : null}
      <div className="grid g3">
        <Field name="documentDate" label="Document date" type="date" defaultValue={initial?.document_date ?? today()} />
        <Field name="paymentTermsCode" label="Payment terms" type="select" defaultValue={initial?.payment_terms_code ?? ''}
          options={[{ value: '', label: '(from customer)' }, ...paymentTerms.map((p) => ({ value: p.code, label: p.code }))]} />
        <Field name="paymentMethodCode" label="Payment method" type="select" defaultValue={initial?.payment_method_code ?? ''}
          options={[{ value: '', label: '(none)' }, ...paymentMethods.map((p) => ({ value: p.code, label: p.code }))]} />
      </div>
      <Field name="yourReference" label="Your reference" defaultValue={initial?.your_reference ?? ''} placeholder="External document no. (optional)" />

      <div className="hint" style={{ marginTop: 'calc(var(--sp)*1)' }}>Lines</div>
      <table>
        <thead>
          <tr>
            <th style={{ width: 110 }}>Type</th><th>No.</th><th>Description <span className="req">*</span></th>
            <th style={{ width: 70 }}>Qty</th><th style={{ width: 110 }}>Unit price</th>
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
                {/* Searchable, as the journal's account picker is: a chart of accounts or an item
                    list runs too long to scroll a native dropdown by eye. The hidden input's name
                    is per-row scratch — the lines themselves travel as state, not form fields. */}
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
                  placeholder={l.type === 'Comment' ? 'Comment text' : masterName(l.type, l.no) || 'What is being sold'} />
              </td>
              <td><input type="number" step="0.01" min={0} value={l.quantity} onChange={(e) => set(i, 'quantity', e.target.value)} aria-label="Quantity" disabled={l.type === 'Comment' || l.type === 'Fixed Asset'} /></td>
              <td><MoneyInput value={l.unitPrice} onChange={(v) => set(i, 'unitPrice', v)} className="num" min={0} ariaLabel="Unit price" disabled={l.type === 'Comment'} placeholder={l.type === 'Fixed Asset' ? 'proceeds' : ''} /></td>
              <td><input type="number" step="0.01" min={0} max={100} value={l.lineDiscountPct} onChange={(e) => set(i, 'lineDiscountPct', e.target.value)} aria-label="Discount %" disabled={l.type === 'Comment'} /></td>
              <td className="num">
                {l.type === 'Comment' ? <span className="muted-cell">—</span>
                  : <Money cents={computeLineAmounts(drafts[i]).lineAmount} />}
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
      <DocumentTotalsPanel totals={totals} currencyCode={initial?.currency_code} />
    </>
  );
}

/** The saved document's lines as editable drafts — cents back to a plain '1234.00' string. */
/** A draft row in the shape lib/documentTotals.ts adds up. A sales line carries no VAT columns
 *  in this system (output VAT is not modelled), so no rate is resolved for it. */
const asDraft = (l: SalesLineDraft): DocumentLineDraft => ({
  type: l.type, no: l.no, quantity: Number(l.quantity) || 0, unitAmount: toCents(l.unitPrice),
  lineDiscountPct: Number(l.lineDiscountPct) || 0,
});

export const linesOf = (doc: SalesDocumentDetail): SalesLineDraft[] => (doc.lines.length
  ? doc.lines.map((l) => ({
    type: l.type, no: l.no ?? '', description: l.description ?? '', quantity: String(l.quantity),
    unitPrice: toTwoDp(String(l.unit_price / 100)), lineDiscountPct: String(l.line_discount_pct),
    locationCode: l.location_code ?? '', faDepreciationBookCode: l.fa_depreciation_book_code ?? '',
  }))
  : [emptyLine()]);

export function NewSalesDocumentButton({ documentType, ...rest }: SalesDocLookups & {
  documentType: SalesDocumentType;
}) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<SalesLineDraft[]>([emptyLine()]);
  return (
    <>
      <button type="button" className="btn" onClick={() => { setLines([emptyLine()]); setOpen(true); }}>New {documentType.toLowerCase()}</button>
      {open ? (
        <FormModal
          title={`New sales ${documentType.toLowerCase()}`} wide
          onClose={() => setOpen(false)}
          onSubmit={(v) => requestSalesDocument(v, lines)}
          submitLabel="Create" successTitle="Sales document created"
          successDetail={(d) => `${d.no} created — submit it for approval`} redirectTo={(d) => `/receivables/documents/${d.no}`}
        >
          <DocFields documentType={documentType} {...rest} lines={lines} setLines={setLines} />
        </FormModal>
      ) : null}
    </>
  );
}
