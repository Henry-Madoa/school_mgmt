'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Field } from '@/components/ui/field';
import { useResultDialog } from '@/components/ui/result-dialog';
import { today } from '@/lib/format';
import { createRemindersRequest, createFinanceChargeMemosRequest } from '@/app/actions/receivables';

export function ReminderBatchPanel({ customers, kind }: {
  customers: { id: number; no: string; name: string }[];
  kind: 'reminder' | 'finance-charge';
}) {
  const router = useRouter();
  const showResult = useResultDialog();
  const [customerId, setCustomerId] = useState('');
  const [docDate, setDocDate] = useState(today());
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const fn = kind === 'reminder' ? createRemindersRequest : createFinanceChargeMemosRequest;
      const res = await fn(customerId ? Number(customerId) : null, docDate);
      if (!res.ok) { showResult('Could not create', res.error, 'err'); return; }
      showResult(
        res.data.created ? `${res.data.created} ${kind === 'reminder' ? 'reminder(s)' : 'finance charge memo(s)'} created` : 'Nothing was due',
        res.data.skipped ? `${res.data.skipped} customer(s) skipped` : undefined, 'ok',
      );
      router.refresh();
    } finally { setBusy(false); }
  };

  return (
    <div className="grid g3 form-row">
      <Field name="customerId" label="Customer" type="select" defaultValue={customerId} onChange={(e) => setCustomerId(e.target.value)}
        options={[{ value: '', label: 'All customers' }, ...customers.map((c) => ({ value: c.id, label: `${c.no} — ${c.name}` }))]} />
      <Field name="docDate" label="Document date" type="date" defaultValue={docDate} onChange={(e) => setDocDate(e.target.value)} />
      <button type="button" className="btn" disabled={busy} onClick={run}>
        {busy ? 'Working…' : kind === 'reminder' ? 'Create reminders' : 'Create finance charge memos'}
      </button>
    </div>
  );
}
