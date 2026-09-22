'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHead, DefinitionList, EmptyState, Pill, TableWrap } from '@/components/ui/primitives';
import { readForm } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { Money } from '@/components/ui/money';
import { formatDate } from '@/lib/format';
import { DocumentTotalsPanel } from '@/components/ui/document-totals';
import { extractVatFromGross } from '@/lib/documentTotals';
import { savePurchaseDocument, type PurchaseLineDraft } from '@/app/actions/payables';
import { DocFields, linesOf, type PurchaseDocLookups } from './purchase-document-form';
import type { PurchaseDocumentDetail } from '@/lib/types';

/** The purchase document's own card, editable in place — the same pattern as the member
 *  application and employee cards. lib/purchaseDocuments.ts replaces the whole header and every
 *  line on save (setPurchaseLines() deletes and re-inserts), so, like the loan card, this stays a
 *  single section rather than a per-FastTab save. */
export function PurchaseDocumentCard({ doc, lookups, canEdit }: {
  doc: PurchaseDocumentDetail; lookups: PurchaseDocLookups; canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lines, setLines] = useState<PurchaseLineDraft[]>(() => linesOf(doc));

  const startEdit = () => { setLines(linesOf(doc)); setError(''); setEditing(true); };

  // Straight off the saved lines — the figures the posting routine itself worked out, so the card
  // reports what will post rather than a second opinion of it. The one derivation is the discount:
  // under "Prices Including VAT" the stored line_discount_amount is VAT-inclusive while line_amount
  // is not, so its VAT is taken back out and every row of the block stays on the same basis
  // (Subtotal − discounts = Total Excl. VAT).
  const pricesInclVat = !!lookups.vatPreview?.pricesInclVat;
  const discountTotal = doc.lines.reduce((t, l) => t + (pricesInclVat
    ? l.line_discount_amount - extractVatFromGross(l.line_discount_amount, l.vat_pct)
    : l.line_discount_amount), 0);
  const totals = {
    lineCount: doc.lines.filter((l) => l.type !== 'Comment').length,
    subtotal: doc.amount + discountTotal,
    discountTotal,
    totalExclVat: doc.amount,
    vatAmount: doc.amount_incl_vat - doc.amount,
    totalInclVat: doc.amount_incl_vat,
  };

  const save = async () => {
    const form = formRef.current;
    if (!form || !form.reportValidity()) return;
    setBusy(true);
    setError('');
    try {
      const res = await savePurchaseDocument(doc.no, readForm(form), lines);
      if (!res.ok) { setError(res.error || 'Could not save'); return; }
      toast('Document updated', undefined, 'ok');
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHead
        title={`${doc.document_type} ${doc.no}`}
        sub={<>
          Status {doc.status === 'Open' && doc.decision_reason
            ? <Pill tone="bad">Rejected</Pill>
            : <Pill status={doc.status} />} · {doc.vendor_no} {doc.vendor_name}
        </>}
      >
        {canEdit && !editing ? <button type="button" className="btn sm ghost" onClick={startEdit}>Edit</button> : null}
      </CardHead>

      {!editing ? (
        <>
          <div className="grid g2">
            <DefinitionList items={[
              ['Vendor', <>{doc.vendor_no} <span className="muted-cell">{doc.vendor_name}</span></>],
              ['Vendor invoice no.', doc.vendor_invoice_no || '—'],
              doc.applies_to_doc_no ? ['Credits invoice', <a href={`/payables/posted/${encodeURIComponent(doc.applies_to_doc_no)}`} className="mono" key="ap">{doc.applies_to_doc_no}</a>] : null,
              ['Posting date', formatDate(doc.posting_date)],
              ['Document date', formatDate(doc.document_date)],
              ['Due date', doc.due_date ? formatDate(doc.due_date) : '—'],
              doc.requisition_no ? ['Requisition', <a href={`/requisitions/view/${doc.requisition_no}`} className="mono" key="rq">{doc.requisition_no}</a>] : null,
            ]} />
            <DefinitionList items={[
              ['Payment terms', doc.payment_terms_code || '—'],
              ['Payment method', doc.payment_method_code || '—'],
              ['Currency', `${doc.currency_code}${doc.currency_code === 'KES' ? '' : ` @ ${doc.currency_factor}`}`],
              ['Amount (excl. VAT)', <Money cents={doc.amount} key="a" />],
              ['Amount (incl. VAT)', <Money cents={doc.amount_incl_vat} key="ai" />],
            ]} />
          </div>
          {doc.lines.length ? (
            <TableWrap>
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Type</th><th>No.</th><th>Description</th>
                  <th className="num">Qty</th><th className="num">Direct unit cost</th><th className="num">Disc %</th>
                  <th className="num">Line amount</th><th className="num">VAT</th>
                </tr>
              </thead>
              <tbody>
                {doc.lines.map((l) => (
                  <tr key={l.id}>
                    <td>{l.type}</td>
                    <td className="mono">{l.no ?? '—'}</td>
                    <td>{l.description ?? '—'}</td>
                    <td className="num">{l.type === 'Comment' ? '—' : l.quantity}</td>
                    <td className="num"><Money cents={l.direct_unit_cost} /></td>
                    <td className="num">{l.line_discount_pct || 0}</td>
                    <td className="num"><Money cents={l.line_amount} /></td>
                    <td className="num"><Money cents={l.vat_amount} /></td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          ) : <EmptyState icon="📄" title="No lines yet" sub={canEdit ? 'Edit the card to add them' : undefined} />}
          {doc.lines.length ? <DocumentTotalsPanel totals={totals} showVat currencyCode={doc.currency_code} /> : null}
        </>
      ) : (
        <>
          <form ref={formRef} onSubmit={(e) => e.preventDefault()}>
            <DocFields documentType={doc.document_type} {...lookups} initial={doc} lines={lines} setLines={setLines} />
          </form>
          <div className="inline" style={{ marginTop: 'var(--sp)' }}>
            {error ? <div className="modal-error">{error}</div> : null}
            <button type="button" className="btn ghost sm" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
            <button type="button" className="btn sm" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </>
      )}
    </Card>
  );
}
