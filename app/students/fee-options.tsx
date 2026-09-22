'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { useRunAction } from '@/components/ui/run-action';
import { useToast } from '@/components/ui/toast';
import { Money } from '@/components/ui/money';
import { Pill } from '@/components/ui/primitives';
import { setStudentFeeOptionsRequest, saveStudentFeeDiscountRequest, deleteStudentFeeDiscountRequest } from '@/app/actions/students';
import type { AcademicTermWithYear, FeeItem, StudentFeeDiscountView } from '@/lib/types';

/** The opt-in fee items (transport, clubs, lunch…) a student takes — tick and save, on the card. */
export function FeeOptionsForm({ studentId, items, selected, canEdit }: { studentId: number; items: FeeItem[]; selected: number[]; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [picked, setPicked] = useState<number[]>(selected);
  const [busy, setBusy] = useState(false);
  const dirty = picked.length !== selected.length || picked.some((id) => !selected.includes(id));
  if (!items.length) return <div className="tiny muted-cell">No opt-in fee items are set up (Admin Centre → Academics → Fee Items, “Billed to: students who opt in”).</div>;
  const save = async () => {
    setBusy(true);
    try {
      const res = await setStudentFeeOptionsRequest(studentId, picked);
      if (!res.ok) { toast('Could not save', res.error, 'err'); return; }
      toast('Fee options saved', undefined, 'ok');
      router.refresh();
    } finally { setBusy(false); }
  };
  return (
    <div>
      {items.map((i) => (
        <div key={i.id} className="checkline">
          <input type="checkbox" id={`opt_${i.id}`} checked={picked.includes(i.id)} disabled={!canEdit}
            onChange={(e) => setPicked(e.target.checked ? [...picked, i.id] : picked.filter((x) => x !== i.id))} />
          <label htmlFor={`opt_${i.id}`}>{i.name}</label>
        </div>
      ))}
      {canEdit ? <button type="button" className={`btn sm ${dirty ? '' : 'ghost'}`} disabled={busy || !dirty} onClick={save} style={{ marginTop: 6 }}>{busy ? 'Saving…' : 'Save options'}</button> : null}
    </div>
  );
}

function DiscountFields({ d, feeItems, terms, mode, setMode }: { d?: StudentFeeDiscountView | null; feeItems: FeeItem[]; terms: AcademicTermWithYear[]; mode: 'percent' | 'amount'; setMode: (m: 'percent' | 'amount') => void }) {
  const termOpts = [{ value: '', label: 'Open-ended' }, ...terms.map((t) => ({ value: t.id, label: `${t.name} ${t.year_name}` }))];
  return (
    <>
      <div className="grid g3">
        <Field name="description" label="Description" required defaultValue={d?.description} placeholder="e.g. Sibling discount, BoM bursary, Sports scholarship" />
        <Field name="fee_item_id" label="On" type="select" defaultValue={d?.fee_item_id ?? ''} options={[{ value: '', label: 'The whole invoice' }, ...feeItems.map((i) => ({ value: i.id, label: i.name }))]} />
        <Field name="_mode" label="Kind" type="select" defaultValue={mode} options={[{ value: 'percent', label: 'Percentage' }, { value: 'amount', label: 'Fixed amount per term' }]} onChange={(e) => setMode(e.target.value as 'percent' | 'amount')} />
      </div>
      <div className="grid g4">
        {mode === 'percent'
          ? <Field name="percent" label="Percent off" type="number" step="0.5" min={0} max={100} required defaultValue={d?.percent || ''} />
          : <Field name="amount" label="Amount off per term" type="currency" required defaultValue={d?.amount ? d.amount / 100 : ''} />}
        <Field name="from_term_id" label="From term" type="select" defaultValue={d?.from_term_id ?? ''} options={termOpts} />
        <Field name="to_term_id" label="To term" type="select" defaultValue={d?.to_term_id ?? ''} options={termOpts} />
        <Field name="status" label="Status" type="select" defaultValue={d?.status ?? 'ACTIVE'} options={['ACTIVE', 'INACTIVE']} />
      </div>
    </>
  );
}

function DiscountForm({ studentId, d, feeItems, terms, onClose }: { studentId: number; d?: StudentFeeDiscountView | null; feeItems: FeeItem[]; terms: AcademicTermWithYear[]; onClose: () => void }) {
  const [mode, setMode] = useState<'percent' | 'amount'>(d && d.amount > 0 ? 'amount' : 'percent');
  return (
    <FormModal inline title="" onClose={onClose} submitLabel={d ? 'Save' : 'Add discount'} successTitle="Discount saved" successDetail="Applied by the next fee invoice run for the term(s) it covers"
      onSubmit={(v) => saveStudentFeeDiscountRequest(studentId, { ...v, id: d?.id ?? '', percent: mode === 'percent' ? v.percent : 0, amount: mode === 'amount' ? v.amount : 0 })}>
      <DiscountFields d={d} feeItems={feeItems} terms={terms} mode={mode} setMode={setMode} />
    </FormModal>
  );
}

/** Bursaries, scholarships and sibling discounts — added and edited inline in the table. */
export function DiscountsTable({ studentId, rows, feeItems, terms, canEdit }: { studentId: number; rows: StudentFeeDiscountView[]; feeItems: FeeItem[]; terms: AcademicTermWithYear[]; canEdit: boolean }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const { run, busy } = useRunAction();
  return (
    <>
      <div className="inline" style={{ justifyContent: 'space-between', margin: '12px 0 6px' }}>
        <div className="hint">Discounts, bursaries and scholarships</div>
        {canEdit && !adding ? <button type="button" className="btn sm" onClick={() => { setEditing(null); setAdding(true); }}>Add discount / bursary</button> : null}
      </div>
      {adding ? (
        <div className="sub-card" style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 8, marginBottom: 12 }}>
          <DiscountForm studentId={studentId} feeItems={feeItems} terms={terms} onClose={() => setAdding(false)} />
          <div className="note">Posts as a negative line to the bursaries / discounts account on each fee invoice, so gross fees and what was waived both stay visible.</div>
        </div>
      ) : null}
      {rows.length ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Description</th><th>On</th><th className="num">Per term</th><th>From</th><th>To</th><th>Status</th><th className="num" /></tr></thead>
            <tbody>
              {rows.map((d) => (
                editing === d.id ? (
                  <tr key={d.id}><td colSpan={7}><DiscountForm studentId={studentId} d={d} feeItems={feeItems} terms={terms} onClose={() => setEditing(null)} /></td></tr>
                ) : (
                  <tr key={d.id} className={d.status === 'ACTIVE' ? undefined : 'muted'}>
                    <td><b>{d.description}</b></td>
                    <td>{d.fee_item_name ?? 'Whole invoice'}</td>
                    <td className="num">{d.percent > 0 ? `${d.percent}%` : <Money cents={d.amount} />}</td>
                    <td>{d.from_term_name ?? '—'}</td>
                    <td>{d.to_term_name ?? 'Open-ended'}</td>
                    <td><Pill status={d.status} /></td>
                    <td className="num">{canEdit ? (
                      <span className="inline" style={{ gap: 4, justifyContent: 'flex-end' }}>
                        <button type="button" className="btn sm ghost" onClick={() => { setAdding(false); setEditing(d.id); }}>Edit</button>
                        <button type="button" className="btn sm ghost" disabled={busy} onClick={() => run(() => deleteStudentFeeDiscountRequest(d.id, studentId), { confirm: { title: 'Delete this discount?', message: 'Invoices already posted with it are unchanged.', confirmLabel: 'Delete', danger: true }, successTitle: 'Discount deleted' })}>Delete</button>
                      </span>
                    ) : null}</td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="tiny muted-cell">None — the student is billed the full structure.</div>}
    </>
  );
}
