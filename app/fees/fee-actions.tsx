'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FormModal } from '@/components/ui/form-modal';
import { Field, MoneyInput } from '@/components/ui/field';
import { useRunAction } from '@/components/ui/run-action';
import { useToast } from '@/components/ui/toast';
import { Money } from '@/components/ui/money';
import {
  saveGradeFeeStructureRequest, copyFeeStructureRequest, createFeeInvoiceRunRequest, postFeeInvoiceRunRequest, deleteFeeInvoiceRunRequest, sendFeeRemindersRequest,
} from '@/app/actions/fees';
import { today } from '@/lib/format';
import type { AcademicTermWithYear, FeeItem, FeeStructureView, GradeLevel } from '@/lib/types';

/* ------------------------------------------------------------ fee structure */

/**
 * The term's fee structure as a grid — one row per fee item, one column per grade, amounts in
 * major units. Each grade column saves on its own (the server replaces that grade's rows), so a
 * half-done grid never overwrites what another grade already had.
 */
export function FeeStructureGrid({ termId, grades, items, rows, canEdit }: {
  termId: number; grades: GradeLevel[]; items: FeeItem[]; rows: FeeStructureView[]; canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const initial = (): Record<string, string> => {
    const m: Record<string, string> = {};
    for (const r of rows) m[`${r.grade_level_id}:${r.fee_item_id}`] = String(Number(r.amount) / 100);
    return m;
  };
  const [amounts, setAmounts] = useState<Record<string, string>>(initial);
  const [dirty, setDirty] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<number | null>(null);
  const key = (g: number, i: number) => `${g}:${i}`;
  const set = (g: number, i: number, v: string) => { setAmounts({ ...amounts, [key(g, i)]: v }); setDirty(new Set(dirty).add(g)); };
  const colTotal = (g: number) => items.reduce((s, i) => s + Math.round((Number(amounts[key(g, i.id)]) || 0) * 100), 0);

  const save = async (g: GradeLevel) => {
    setBusy(g.id);
    try {
      const payload: Record<string, string> = {};
      for (const i of items) payload[String(i.id)] = amounts[key(g.id, i.id)] ?? '';
      const res = await saveGradeFeeStructureRequest(g.id, termId, payload);
      if (!res.ok) { toast(`Could not save ${g.name}`, res.error, 'err'); return; }
      toast('Fee structure saved', g.name, 'ok');
      const d = new Set(dirty); d.delete(g.id); setDirty(d);
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Fee item</th>
            {grades.map((g) => <th key={g.id} className="num">{g.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id}>
              <td><b>{i.name}</b><div className="tiny mono">{i.code}</div></td>
              {grades.map((g) => (
                <td key={g.id} className="num">
                  {canEdit
                    ? <MoneyInput ariaLabel={`${i.name} ${g.name}`} value={amounts[key(g.id, i.id)] ?? ''} onChange={(v) => set(g.id, i.id, v)} style={{ width: 110, textAlign: 'right' }} placeholder="0.00" />
                    : <Money cents={Math.round((Number(amounts[key(g.id, i.id)]) || 0) * 100)} />}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th>Total per student</th>
            {grades.map((g) => <th key={g.id} className="num"><Money cents={colTotal(g.id)} /></th>)}
          </tr>
          {canEdit ? (
            <tr>
              <td />
              {grades.map((g) => (
                <td key={g.id} className="num">
                  <button type="button" className={`btn sm ${dirty.has(g.id) ? '' : 'ghost'}`} disabled={busy !== null || !dirty.has(g.id)} onClick={() => save(g)}>
                    {busy === g.id ? 'Saving…' : 'Save'}
                  </button>
                </td>
              ))}
            </tr>
          ) : null}
        </tfoot>
      </table>
    </div>
  );
}

export function CopyStructureButton({ toTermId, terms, className = 'btn ghost' }: { toTermId: number; terms: AcademicTermWithYear[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const sources = terms.filter((t) => t.id !== toTermId);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Copy from another term</button>
      {open ? (
        <FormModal title="Copy a fee structure" onClose={() => setOpen(false)} onSubmit={(v) => copyFeeStructureRequest(Number(v.from_term_id), toTermId)}
          submitLabel="Copy" successTitle="Fee structure copied" successDetail={(d) => `${d.copied} line${d.copied === 1 ? '' : 's'} copied — adjust any that changed`}>
          <Field name="from_term_id" label="Copy from" type="select" required defaultValue={sources[0]?.id ?? ''} options={sources.map((t) => ({ value: t.id, label: `${t.name} ${t.year_name}` }))} />
          <div className="note">Only works into a term with no structure yet, so nothing already keyed is overwritten.</div>
        </FormModal>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------- invoice runs */

export function NewInvoiceRunButton({ terms, grades, defaultTermId, className = 'btn' }: {
  terms: AcademicTermWithYear[]; grades: GradeLevel[]; defaultTermId?: number | null; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [split, setSplit] = useState(false);
  const [instalments, setInstalments] = useState<{ pct: string; due_date: string }[]>([{ pct: '60', due_date: today() }, { pct: '40', due_date: '' }]);
  const setInst = (i: number, k: 'pct' | 'due_date', v: string) => setInstalments(instalments.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  const pctSum = instalments.reduce((a, r) => a + (Number(r.pct) || 0), 0);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>New invoice run</button>
      {open ? (
        <FormModal title="New fee invoice run" onClose={() => setOpen(false)} onSubmit={(v) => createFeeInvoiceRunRequest(v, split ? instalments : [])}
          submitLabel="Create run" successTitle="Invoice run created" successDetail={(d) => `${d.no} — review the students billed, then post it`}
          redirectTo={(d) => `/fees/invoice-runs/${encodeURIComponent(d.no)}`}>
          <div className="grid g2">
            <Field name="term_id" label="Term" type="select" required defaultValue={defaultTermId ?? terms[0]?.id ?? ''} options={terms.map((t) => ({ value: t.id, label: `${t.name} ${t.year_name}` }))} />
            <Field name="grade_level_id" label="Grade" type="select" defaultValue="" options={[{ value: '', label: 'All grades' }, ...grades.map((g) => ({ value: g.id, label: g.name }))]} />
          </div>
          <div className="grid g2">
            <Field name="posting_date" label="Posting date" type="date" required defaultValue={today()} />
            {!split ? <Field name="due_date" label="Due date" type="date" required defaultValue={today()} hint="Balances become overdue after this date" /> : <input type="hidden" name="due_date" value={instalments[0]?.due_date || today()} />}
          </div>
          <div className="checkline">
            <input type="checkbox" id="f_split" checked={split} onChange={(e) => setSplit(e.target.checked)} />
            <label htmlFor="f_split">Bill in instalments (one invoice per instalment, each with its own due date)</label>
          </div>
          {split ? (
            <>
              <table>
                <thead><tr><th style={{ width: 60 }}>#</th><th style={{ width: 120 }}>Percent</th><th>Due date</th><th style={{ width: 32 }} /></tr></thead>
                <tbody>
                  {instalments.map((r, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td><input type="number" min={1} max={100} value={r.pct} onChange={(e) => setInst(i, 'pct', e.target.value)} aria-label="Percent" style={{ width: '100%' }} /></td>
                      <td><input type="date" value={r.due_date} onChange={(e) => setInst(i, 'due_date', e.target.value)} aria-label="Due date" required /></td>
                      <td>{instalments.length > 2 ? <button type="button" className="btn sm ghost" aria-label="Remove" onClick={() => setInstalments(instalments.filter((_, idx) => idx !== i))}>×</button> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="inline" style={{ gap: 8, marginTop: 6 }}>
                <button type="button" className="btn ghost sm" onClick={() => setInstalments([...instalments, { pct: '', due_date: '' }])}>Add instalment</button>
                <span className={`tiny ${pctSum === 100 ? '' : 'muted-cell'}`}>{pctSum}% of 100%</span>
              </div>
            </>
          ) : null}
          <div className="note">Every Active student in the grade(s) is billed the term's fee structure for their grade — the items that apply to them, less their discounts. Students already invoiced for the term are skipped.</div>
        </FormModal>
      ) : null}
    </>
  );
}

export function PostRunButton({ no, students, className = 'btn' }: { no: string; students: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy} onClick={() => run(() => postFeeInvoiceRunRequest(no), {
      confirm: { title: `Post ${no}?`, message: `Raises and posts a Sales Invoice on each of the ${students} students' fee accounts — the income and the receivable hit the G/L.`, confirmLabel: 'Post invoices' },
      successTitle: 'Invoice run posted',
      successDetail: (d) => `${d.posted} invoice${d.posted === 1 ? '' : 's'} posted${d.skipped ? `, ${d.skipped} skipped` : ''}${d.failures.length ? ` — ${d.failures.length} failed: ${d.failures.slice(0, 3).map((f) => `${f.admission_no} (${f.error})`).join('; ')}` : ''}`,
    })}>{busy ? 'Posting…' : 'Post invoices'}</button>
  );
}

export function DeleteRunButton({ no, className = 'btn ghost' }: { no: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy} onClick={() => run(() => deleteFeeInvoiceRunRequest(no), {
      confirm: { title: `Delete ${no}?`, message: 'The unposted run and its draft invoices are removed. Nothing has reached the G/L.', confirmLabel: 'Delete', danger: true },
      successTitle: 'Invoice run deleted', redirectTo: '/fees/invoice-runs',
    })}>{busy ? 'Deleting…' : 'Delete'}</button>
  );
}

/* ---------------------------------------------------------------- reminders */

export function SendReminderButton({ studentIds, streamId, gradeLevelId, label = 'Send fee reminder', className = 'btn' }: {
  studentIds?: number[]; streamId?: number | null; gradeLevelId?: number | null; label?: string; className?: string;
}) {
  const { run, busy } = useRunAction();
  const scope = studentIds?.length ? `${studentIds.length} student${studentIds.length === 1 ? '' : 's'}` : streamId ? 'this class' : gradeLevelId ? 'this grade' : 'every student with a balance';
  return (
    <button type="button" className={className} disabled={busy} onClick={() => run(() => sendFeeRemindersRequest({ studentIds, streamId, gradeLevelId }), {
      confirm: { title: 'Send fee reminders?', message: `An SMS and e-mail (where on file) goes to the primary guardian of ${scope} with a balance owing.`, confirmLabel: 'Send' },
      successTitle: 'Reminders queued', successDetail: (d) => `${d.reminded} sent${d.skipped ? `, ${d.skipped} skipped (no balance or no contact)` : ''}`,
    })}>{busy ? 'Sending…' : label}</button>
  );
}
