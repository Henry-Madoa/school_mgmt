'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHead, DefinitionList, EmptyState, Pill, TableWrap } from '@/components/ui/primitives';
import { readForm } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { Money } from '@/components/ui/money';
import { formatDate } from '@/lib/format';
import { updateReceiptRequest, type ReceiptLineDraft } from '@/app/actions/cashMgmt';
import { ReceiptFields, receiptLinesOf, type ReceiptFormProps } from './receipt-form';
import type { ReceiptDetail } from '@/lib/types';

/**
 * The receipt's own card, edited in place — no modal, the same pattern as the sales, purchase,
 * customer and vendor cards. lib/receipts.ts rewrites the header and every line on save, so this
 * stays a single form rather than a per-section save, which would blank what it did not submit.
 */
export function ReceiptCard({ receipt, lookups, canEdit }: {
  receipt: ReceiptDetail; lookups: ReceiptFormProps | null; canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lines, setLines] = useState<ReceiptLineDraft[]>(() => receiptLinesOf(receipt));

  const startEdit = () => { setLines(receiptLinesOf(receipt)); setError(''); setEditing(true); };

  const save = async () => {
    const form = formRef.current;
    if (!form || !form.reportValidity()) return;
    setBusy(true);
    setError('');
    try {
      const res = await updateReceiptRequest(receipt.no, readForm(form), lines);
      if (!res.ok) { setError(res.error || 'Could not save'); return; }
      toast('Receipt updated', undefined, 'ok');
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHead
        title={`Receipt ${receipt.no}`}
        sub={<>
          {receipt.receipt_type} · {receipt.description || '—'}
          {receipt.employee_no ? <> · {receipt.employee_no} {receipt.employee_name}</> : null}
        </>}
      >
        {receipt.posted ? <Pill status="ok">Posted</Pill> : <Pill status={receipt.status} />}
        {canEdit && lookups && !editing
          ? <button type="button" className="btn sm ghost" onClick={startEdit}>Edit</button>
          : null}
      </CardHead>

      {!editing ? (
        <>
          <div className="grid g2">
            <DefinitionList items={[
              ['Receipt type', receipt.receipt_type],
              ...(receipt.receipt_type === 'Employee'
                ? [['Employee', <>{receipt.employee_no} <span className="muted-cell">{receipt.employee_name}</span></>] as [string, React.ReactNode]]
                : []),
              ['Received from', receipt.description || '—'],
              ['Posting date', formatDate(receipt.posting_date)],
              ['Bank account', <span className="mono" key="b">{receipt.bank_account_code} — {receipt.bank_account_name}</span>],
            ]} />
            <DefinitionList items={[
              ['Payment mode', receipt.pay_mode_code || '—'],
              ['Cheque / M-Pesa ref.', receipt.external_document_no || '—'],
              ['Manual receipt no.', receipt.manual_receipt_no || '—'],
              ['Currency', `${receipt.currency_code}${receipt.currency_code === 'KES' ? '' : ` @ ${receipt.currency_factor}`}`],
              ...(receipt.received_amount
                ? [['Amount received', <Money cents={receipt.received_amount} key="ra" />] as [string, React.ReactNode]]
                : []),
              ['Amount', <Money cents={receipt.amount} key="a" />],
              ['Journal', receipt.journal_no || '—'],
            ]} />
          </div>

          {receipt.lines.length ? (
            <TableWrap>
              <thead>
                <tr>
                  <th style={{ width: '24%' }}>Account</th>
                  <th>Description</th>
                  <th style={{ width: '20%' }}>Applies to Doc. No.</th>
                  <th className="num" style={{ width: 140 }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {receipt.lines.map((l) => (
                  <tr key={l.id}>
                    {/* Every line carries a code, and the name stacks under it because a G/L name is long. */}
                    <td>
                      {l.account_no ? <span className="mono">{l.account_no}</span> : null}
                      {l.account_name
                        ? <div className={l.account_no ? 'tiny muted-cell' : ''}>{l.account_name}</div>
                        : null}
                    </td>
                    <td>{l.description || <span className="muted-cell">—</span>}</td>
                    <td>
                      {l.applies_to_doc_no
                        ? (<><span className="mono">{l.applies_to_doc_no}</span><div className="tiny muted-cell">Settles this invoice</div></>)
                        : <span className="muted-cell">— on account</span>}
                    </td>
                    <td className="num">
                      <Money cents={l.amount} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={3}>Total</td><td className="num"><b><Money cents={receipt.amount} /></b></td></tr>
              </tfoot>
            </TableWrap>
          ) : (
            <EmptyState icon="🧾" title="No lines yet" sub={canEdit ? 'Edit the card to add them' : undefined} />
          )}
        </>
      ) : (
        <>
          <form ref={formRef} onSubmit={(e) => e.preventDefault()}>
            <ReceiptFields p={lookups!} initial={receipt} lines={lines} setLines={setLines} />
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
