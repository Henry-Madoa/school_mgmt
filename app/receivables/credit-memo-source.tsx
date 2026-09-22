'use client';

import { useEffect, useState } from 'react';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useFormat } from '@/components/ui/format-provider';
import {
  listPostedInvoicesForCreditRequest, getInvoiceForCreditMemoRequest,
} from '@/app/actions/receivables';
import type { CreditMemoSource, PostedInvoiceOption } from '@/lib/salesDocuments';

/**
 * "Copy from posted invoice" on a sales credit memo — Business Central's Copy Document /
 * Create Corrective Credit Memo.
 *
 * The customer is chosen first; this picker then offers only that customer's open invoices, the
 * way BC's Applies-to Doc. No. lookup does. Picking one fills the memo in: the payment terms and
 * reference the invoice carried, and every line at the same quantity, price and discount.
 * Quantities come across positive — a credit memo is negative by virtue of its document type,
 * not by carrying negative lines — and the invoice number is remembered as the Applies-to Doc.
 * No., so posting settles that invoice instead of leaving an open invoice beside an open credit
 * note.
 *
 * Nothing is forced: the copied lines are ordinary drafts, so a partial credit is just a matter
 * of deleting or editing lines before saving.
 */
export function CreditMemoSourcePicker({ customerId, onCopy }: {
  /** The memo's customer; the list is empty and the control disabled until one is picked. */
  customerId: string;
  onCopy: (source: CreditMemoSource) => void;
}) {
  const { cur, fdate } = useFormat();
  const [invoices, setInvoices] = useState<PostedInvoiceOption[]>([]);
  const [picked, setPicked] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A different customer means a different invoice list — and an invoice already picked no
  // longer belongs to this memo, so the Applies-to Doc. No. is dropped along with it.
  useEffect(() => {
    let cancelled = false;
    setPicked('');
    setError(null);
    if (!customerId) { setInvoices([]); return; }
    listPostedInvoicesForCreditRequest(Number(customerId)).then((res) => {
      if (!cancelled) setInvoices(res.ok ? res.data : []);
    });
    return () => { cancelled = true; };
  }, [customerId]);

  const copy = async (no: string) => {
    setPicked(no);
    setError(null);
    if (!no) return;
    setBusy(true);
    try {
      const res = await getInvoiceForCreditMemoRequest(no);
      if (!res.ok) { setError(res.error ?? 'Could not read that invoice'); return; }
      onCopy(res.data);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card inset" style={{ marginBottom: 'calc(var(--sp)*1.5)' }}>
      <SearchableSelect
        name="appliesToDocNo" label="Credit against open invoice" items={invoices}
        getValue={(i) => i.no} value={picked} onChange={copy} disabled={busy || !customerId}
        getLabel={(i) => `${i.no} · ${fdate(i.posting_date)} · ${cur(i.amount)} · ${cur(i.remaining_amount)} open`}
        placeholder={busy ? 'Copying…' : customerId ? 'Search invoice no.…' : 'Select a customer first'}
        emptyText="No open invoices for this customer"
        hint="Optional — picking one copies the invoice's lines, and the memo settles that invoice when posted."
      />
      {error ? <div className="tiny" style={{ color: 'var(--danger)' }}>{error}</div> : null}
    </div>
  );
}
