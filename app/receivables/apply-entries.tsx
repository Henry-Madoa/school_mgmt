'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { Money } from '@/components/ui/money';
import { TableWrap, EmptyState } from '@/components/ui/primitives';
import { useRunAction } from '@/components/ui/run-action';
import { today } from '@/lib/format';
import { customerLedgerEntriesRequest, applyEntriesRequest, unapplyEntryRequest } from '@/app/actions/receivables';
import type { CustLedgerEntryView } from '@/lib/types';

export function ApplyEntriesButton({ entry, className = 'btn sm ghost' }: { entry: CustLedgerEntryView; className?: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<CustLedgerEntryView[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const { run } = useRunAction();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    customerLedgerEntriesRequest(entry.customer_id).then((res) => {
      if (!cancelled && res.ok) setRows(res.data.filter((e) => e.open === 1 && e.id !== entry.id && e.positive !== entry.positive));
    });
    return () => { cancelled = true; };
  }, [open, entry.customer_id, entry.id, entry.positive]);

  const toggle = (id: number) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Apply</button>
      {open ? (
        <Modal wide title={`Apply ${entry.document_type} ${entry.document_no}`} onClose={() => setOpen(false)}
          footer={
            <div className="inline" style={{ gap: 8 }}>
              <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Close</button>
              <button type="button" className="btn" onClick={() => run(() => applyEntriesRequest(entry.id, picked.size ? [...picked] : 'auto', today()), {
                confirm: { title: 'Apply?', message: picked.size ? `Apply against ${picked.size} entr${picked.size === 1 ? 'y' : 'ies'}.` : 'Apply oldest-open-first.', confirmLabel: 'Apply' },
                successTitle: (d) => `${d.closedEntryNos.length} entr${d.closedEntryNos.length === 1 ? 'y' : 'ies'} closed`,
              })}>Apply {picked.size ? `(${picked.size})` : '(auto)'}</button>
            </div>
          }>
          <div className="card-sub" style={{ marginBottom: 'calc(var(--sp)*1)' }}>
            Remaining on this entry: <Money cents={Math.abs(entry.remaining_amount)} />
          </div>
          {rows === null ? <EmptyState title="Loading…" /> : rows.length ? (
            <TableWrap>
              <thead><tr><th /><th>Document</th><th>Type</th><th>Due</th><th className="num">Remaining</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Pick ${r.document_no}`} /></td>
                    <td className="mono">{r.document_no}</td>
                    <td>{r.document_type}</td>
                    <td>{r.due_date ?? '—'}</td>
                    <td className="num"><Money cents={Math.abs(r.remaining_amount)} /></td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          ) : <EmptyState icon="✅" title="Nothing open to apply against" />}
        </Modal>
      ) : null}
    </>
  );
}

export function UnapplyButton({ entryId, className = 'btn sm ghost' }: { entryId: number; className?: string }) {
  const { run } = useRunAction();
  return (
    <button type="button" className={className} onClick={() => run(() => unapplyEntryRequest(entryId), {
      confirm: { title: 'Unapply this entry?', message: 'Every application on it is reversed and the affected entries reopen.', confirmLabel: 'Unapply' },
      successTitle: 'Unapplied',
    })}>Unapply</button>
  );
}
