'use client';

import { useEffect, useState } from 'react';
import { listOpenEntriesForApplication } from '@/app/actions/cashMgmt';
import { useFormat } from './format-provider';
import type { OpenLedgerEntryOption } from '@/lib/custLedger';

/**
 * The "Applies to Doc. No." cell on a Cash Management Receipt or Payment Voucher line.
 *
 * Business Central looks the open entries up rather than asking the user to type a document
 * number from memory: pick the customer/vendor first, and this offers exactly their still-open
 * invoices with what is left on each. Choosing one fills the line's amount with that remaining
 * amount — the overwhelmingly common case is settling an invoice in full — which the user can
 * still overtype for a part-payment.
 *
 * The list is fetched per party, on demand, because a receipt line's party is chosen in the same
 * modal; there is no set of entries to render server-side when the form first opens.
 */
export function AppliesToPicker({
  partyType, partyNo, value, onChange, onPickAmount, disabled,
}: {
  partyType: 'Customer' | 'Vendor' | null;
  partyNo: string;
  value: string;
  onChange: (documentNo: string) => void;
  /** Called with the picked entry's remaining amount, in major units, for the Amount cell. */
  onPickAmount: (amountMajor: string) => void;
  disabled?: boolean;
}) {
  const { cur } = useFormat();
  const [entries, setEntries] = useState<OpenLedgerEntryOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (disabled || !partyType || !partyNo) { setEntries([]); return; }
    let cancelled = false;
    setLoading(true);
    listOpenEntriesForApplication(partyType, partyNo).then((res) => {
      if (cancelled) return;
      setEntries(res.ok ? res.data : []);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [partyType, partyNo, disabled]);

  if (disabled || !partyType) {
    return (
      <input type="text" value="" disabled aria-label="Applies to doc" style={{ width: '100%' }}
        placeholder="Customer / vendor lines only" />
    );
  }
  if (!partyNo) {
    return (
      <input type="text" value="" disabled aria-label="Applies to doc" style={{ width: '100%' }}
        placeholder="Pick the party first" />
    );
  }

  const picked = entries.find((e) => e.document_no === value);
  return (
    <>
      <select style={{ width: '100%' }}
        value={value} aria-label="Applies to doc" disabled={loading}
        onChange={(e) => {
          const no = e.target.value;
          onChange(no);
          const entry = entries.find((x) => x.document_no === no);
          if (entry) onPickAmount((entry.remaining_amount / 100).toFixed(2));
        }}
      >
        <option value="">{loading ? 'Loading…' : entries.length ? '(none — on account)' : 'No open invoices'}</option>
        {/* A document number alone means nothing without the money still on it. */}
        {entries.map((e) => (
          <option key={e.document_no} value={e.document_no}>
            {e.document_no} — {cur(e.remaining_amount)}{e.due_date ? ` · due ${e.due_date}` : ''}
          </option>
        ))}
      </select>
      {picked ? <div className="tiny muted-cell">Remaining {cur(picked.remaining_amount)}</div> : null}
    </>
  );
}
