'use client';

import { useState } from 'react';
import { Field } from '@/components/ui/field';
import { Money } from '@/components/ui/money';
import { TableWrap, EmptyState } from '@/components/ui/primitives';
import { ExportButton } from '@/components/ui/export-button';
import { formatDate, today } from '@/lib/format';
import { customerStatementRequest } from '@/app/actions/receivables';
import type { CustomerStatementReport } from '@/lib/types';

export function CustomerStatementPanel({ customers, customerNo, from, to }: {
  customers: { no: string; name: string }[]; customerNo?: string; from?: string; to?: string;
}) {
  const [no, setNo] = useState(customerNo ?? customers[0]?.no ?? '');
  const [fromDate, setFromDate] = useState(from ?? `${today().slice(0, 4)}-01-01`);
  const [toDate, setToDate] = useState(to ?? today());
  const [report, setReport] = useState<CustomerStatementReport | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!no) return;
    setBusy(true);
    try {
      const res = await customerStatementRequest({ customerNo: no, from: fromDate, to: toDate });
      if (res.ok) setReport(res.data);
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="grid g3 form-row">
        <Field name="customer" label="Customer" type="select" defaultValue={no} onChange={(e) => setNo(e.target.value)}
          options={customers.map((c) => ({ value: c.no, label: `${c.no} — ${c.name}` }))} />
        <Field name="from" label="From" type="date" defaultValue={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        <div className="inline">
          <Field name="to" label="To" type="date" defaultValue={toDate} onChange={(e) => setToDate(e.target.value)} />
          <button type="button" className="btn" disabled={busy || !no} onClick={load}>{busy ? 'Loading…' : 'Show'}</button>
          <ExportButton href="/api/export/customer-statement" params={{ customer: no, from: fromDate, to: toDate }} disabled={!no} />
        </div>
      </div>

      {report ? (
        <>
          <div className="card-sub" style={{ margin: 'calc(var(--sp)*1) 0' }}>
            {report.customer_no} — {report.customer_name} · {formatDate(report.from)} to {formatDate(report.to)} ·
            Opening <Money cents={report.opening_balance} /> → Closing <Money cents={report.closing_balance} />
          </div>
          {report.lines.length ? (
            <TableWrap>
              <thead><tr><th>Date</th><th>Type</th><th>Document</th><th>Due</th><th className="num">Amount</th><th className="num">Balance</th></tr></thead>
              <tbody>
                {report.lines.map((l, i) => (
                  <tr key={i}>
                    <td>{formatDate(l.posting_date)}</td>
                    <td>{l.document_type}</td>
                    <td className="mono">{l.document_no}</td>
                    <td>{l.due_date ? formatDate(l.due_date) : '—'}</td>
                    <td className="num"><Money cents={l.amount} /></td>
                    <td className="num"><Money cents={l.running_balance} /></td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          ) : <EmptyState icon="📄" title="No activity in this period" />}
        </>
      ) : null}
    </>
  );
}
