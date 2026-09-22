'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHead, DefinitionList, EmptyState, Pill, TableWrap } from '@/components/ui/primitives';
import { readForm } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { Money } from '@/components/ui/money';
import { formatDate } from '@/lib/format';
import { DocumentTotalsPanel } from '@/components/ui/document-totals';
import { saveSalesDocument, type SalesLineDraft } from '@/app/actions/receivables';
import { DocFields, linesOf, type SalesDocLookups } from './sales-document-form';
import type { SalesDocumentDetail } from '@/lib/types';

/** The sales document's own card, editable in place — the same pattern as the member application
 *  and employee cards. lib/salesDocuments.ts replaces the whole header and every line on save,
 *  so, like the loan card, this stays a single section rather than a per-FastTab save. */
export function SalesDocumentCard({ doc, lookups, canEdit }: {
  doc: SalesDocumentDetail; lookups: SalesDocLookups; canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lines, setLines] = useState<SalesLineDraft[]>(() => linesOf(doc));

  const startEdit = () => { setLines(linesOf(doc)); setError(''); setEditing(true); };

  // Straight off the saved lines. A sales line carries no VAT columns in this system, so the
  // block stops at the document total.
  const totals = {
    lineCount: doc.lines.filter((l) => l.type !== 'Comment').length,
    subtotal: doc.lines.reduce((t, l) => t + l.line_amount + l.line_discount_amount, 0),
    discountTotal: doc.lines.reduce((t, l) => t + l.line_discount_amount, 0),
    totalExclVat: doc.amount,
    vatAmount: 0,
    totalInclVat: doc.amount,
  };

  const save = async () => {
    const form = formRef.current;
    if (!form || !form.reportValidity()) return;
    setBusy(true);
    setError('');
    try {
      const res = await saveSalesDocument(doc.no, readForm(form), lines);
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
            : <Pill status={doc.status} />} · {doc.customer_no} {doc.customer_name}
        </>}
      >
        {canEdit && !editing ? <button type="button" className="btn sm ghost" onClick={startEdit}>Edit</button> : null}
      </CardHead>

      {!editing ? (
        <>
          <div className="grid g2">
            <DefinitionList items={[
              ['Customer', <>{doc.customer_no} <span className="muted-cell">{doc.customer_name}</span></>],
              ['Your reference', doc.your_reference || '—'],
              ['Posting date', formatDate(doc.posting_date)],
              ['Document date', formatDate(doc.document_date)],
              ['Due date', doc.due_date ? formatDate(doc.due_date) : '—'],
            ]} />
            <DefinitionList items={[
              ['Payment terms', doc.payment_terms_code || '—'],
              ['Payment method', doc.payment_method_code || '—'],
              ['Currency', `${doc.currency_code}${doc.currency_code === 'KES' ? '' : ` @ ${doc.currency_factor}`}`],
              ['Salesperson', doc.salesperson || '—'],
              ['Amount', <Money cents={doc.amount} key="a" />],
            ]} />
          </div>
          {doc.lines.length ? (
            <TableWrap>
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Type</th><th>No.</th><th>Description</th>
                  <th className="num">Qty</th><th className="num">Unit price</th><th className="num">Disc %</th>
                  <th className="num">Line amount</th>
                </tr>
              </thead>
              <tbody>
                {doc.lines.map((l) => (
                  <tr key={l.id}>
                    <td>{l.type}</td>
                    <td className="mono">{l.no ?? '—'}</td>
                    <td>{l.description ?? '—'}</td>
                    <td className="num">{l.type === 'Comment' ? '—' : l.quantity}</td>
                    <td className="num"><Money cents={l.unit_price} /></td>
                    <td className="num">{l.line_discount_pct || 0}</td>
                    <td className="num"><Money cents={l.line_amount} /></td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          ) : <EmptyState icon="📄" title="No lines yet" sub={canEdit ? 'Edit the card to add them' : undefined} />}
          {doc.lines.length ? <DocumentTotalsPanel totals={totals} currencyCode={doc.currency_code} /> : null}
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
