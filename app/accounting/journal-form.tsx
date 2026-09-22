'use client';

import { useMemo, useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field, MoneyInput } from '@/components/ui/field';
import { GlAccountSelect } from '@/components/ui/gl-account-select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useFormat } from '@/components/ui/format-provider';
import { createJournal, type JournalLineDraft } from '@/app/actions/gl';
import { toCents } from '@/lib/format';
import type { DimensionValue, GlAccount } from '@/lib/types';

const emptyLine = (): JournalLineDraft =>
  ({ account: '', narration: '', debit: '', credit: '', globalDimension1Id: '', globalDimension2Id: '' });

export interface NewJournalButtonProps {
  accounts: GlAccount[];
  globalDimension1Values: DimensionValue[];
  globalDimension2Values: DimensionValue[];
  caption1: string;
  caption2: string;
  /** The signed-in user's own Work Date (My Settings) — suggested here instead of the real
   *  system date, the same way Business Central's own Work Date drives a new journal's date. */
  workDate: string;
}

export function NewJournalButton({
  accounts, globalDimension1Values, globalDimension2Values, caption1, caption2, workDate,
}: NewJournalButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>New journal</button>
      {open ? (
        <JournalForm
          accounts={accounts}
          globalDimension1Values={globalDimension1Values}
          globalDimension2Values={globalDimension2Values}
          caption1={caption1}
          caption2={caption2}
          workDate={workDate}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function JournalForm({
  accounts, globalDimension1Values, globalDimension2Values, caption1, caption2, workDate, onClose,
}: NewJournalButtonProps & { onClose: () => void }) {
  const { cur } = useFormat();
  const [lines, setLines] = useState<JournalLineDraft[]>([emptyLine(), emptyLine()]);

  const totals = useMemo(() => {
    const debit = lines.reduce((a, l) => a + toCents(l.debit), 0);
    const credit = lines.reduce((a, l) => a + toCents(l.credit), 0);
    return { debit, credit, balanced: debit === credit && debit > 0 };
  }, [lines]);

  const update = (i: number, patch: Partial<JournalLineDraft>) =>
    setLines((cur) => cur.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  const remove = (i: number) =>
    setLines((cur) => (cur.length > 2 ? cur.filter((_, k) => k !== i) : cur));

  return (
    <FormModal
      wide
      title="New manual journal"
      onClose={onClose}
      onSubmit={(values) => createJournal(values, lines.filter((l) => l.account && (l.debit || l.credit)))}
      submitLabel="Post journal"
      successTitle="Journal submitted"
      successDetail={(r) => (r.posted ? `Posted as ${r.journal.journal_no}` : 'Submitted for approval — not yet posted')}
      resultStyle="popup"
    >
      <div className="grid g2">
        <Field name="valueDate" label="Value date" type="date" defaultValue={workDate} required />
        <Field name="description" label="Description" required />
      </div>

      <table style={{ marginTop: 'calc(var(--sp)*1.5)' }}>
        <thead>
          <tr>
            <th style={{ width: '26%' }}>Account</th>
            <th>Narration</th>
            <th style={{ width: '14%' }}>{caption1}</th>
            <th style={{ width: '14%' }}>{caption2}</th>
            <th className="num" style={{ width: 120 }}>Debit</th>
            <th className="num" style={{ width: 120 }}>Credit</th>
            <th style={{ width: 40 }} />
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => (
            <tr key={i}>
              <td>
                <GlAccountSelect name={`journalLineAccount${i}`} ariaLabel="Account" valueField="code"
                  accounts={accounts} value={line.account} onChange={(v) => update(i, { account: v })} />
              </td>
              <td>
                <input type="text" placeholder="Narration" value={line.narration} aria-label="Narration"
                  onChange={(e) => update(i, { narration: e.target.value })} />
              </td>
              <td>
                <SearchableSelect name={`journalLineDim1_${i}`} ariaLabel={caption1}
                  items={globalDimension1Values} getValue={(v) => String(v.id)} getLabel={(v) => v.name}
                  value={String(line.globalDimension1Id || '')}
                  onChange={(v) => update(i, { globalDimension1Id: v ? Number(v) : '' })} />
              </td>
              <td>
                <SearchableSelect name={`journalLineDim2_${i}`} ariaLabel={caption2}
                  items={globalDimension2Values} getValue={(v) => String(v.id)} getLabel={(v) => v.name}
                  value={String(line.globalDimension2Id || '')}
                  onChange={(v) => update(i, { globalDimension2Id: v ? Number(v) : '' })} />
              </td>
              <td>
                <MoneyInput value={line.debit} ariaLabel="Debit" className="num" min={0}
                  onChange={(v) => update(i, { debit: v })} />
              </td>
              <td>
                <MoneyInput value={line.credit} ariaLabel="Credit" className="num" min={0}
                  onChange={(v) => update(i, { credit: v })} />
              </td>
              <td>
                <button type="button" className="btn sm ghost" onClick={() => remove(i)}
                  disabled={lines.length <= 2} aria-label="Remove line">×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="inline" style={{ marginTop: 10 }}>
        <button type="button" className="btn ghost sm" onClick={() => setLines((c) => [...c, emptyLine()])}>
          Add line
        </button>
        <div className="spacer" style={{ flex: 1 }} />
        <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>
          Debits <b>{cur(totals.debit)}</b> · Credits <b>{cur(totals.credit)}</b> —{' '}
          <span className={totals.balanced ? 'pos' : 'neg'}>
            {totals.balanced ? 'in balance' : 'out of balance'}
          </span>
        </div>
      </div>
    </FormModal>
  );
}
