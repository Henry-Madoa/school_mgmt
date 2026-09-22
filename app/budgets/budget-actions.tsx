'use client';

import { Fragment, useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useSearchParams } from 'next/navigation';
import { FormModal } from '@/components/ui/form-modal';
import { Modal } from '@/components/ui/modal';
import { useEditableCard } from '@/components/ui/editable-card';
import { Field } from '@/components/ui/field';
import { GlAccountSelect, type GlAccountSelectOption } from '@/components/ui/gl-account-select';
import { useRunAction } from '@/components/ui/run-action';
import { useToast } from '@/components/ui/toast';
import { useFormat } from '@/components/ui/format-provider';
import { useQueryWriter, DateFilterExpressionInput } from '@/components/ui/filters';
import {
  createBudgetRequest, updateBudgetRequest, deleteBudgetRequest, setBudgetCellRequest, createBudgetEntryRequest, updateBudgetEntryRequest,
  deleteBudgetEntryRequest, deleteBudgetEntriesRequest, copyGlBudgetRequest, importBudgetAction, type ImportBudgetState,
} from '@/app/actions/budgets';
import type { BudgetMatrix, GlBudgetNameView, BudgetEntryView } from '@/lib/glBudgets';
import type { DimensionValue } from '@/lib/types';

export type Dims = { caption1: string; caption2: string; dim1: DimensionValue[]; dim2: DimensionValue[] };

/* ================================================================== names */

export function NewBudgetButton({ className = 'btn' }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>New budget</button>
      {open ? (
        <FormModal title="New G/L budget" onClose={() => setOpen(false)} onSubmit={createBudgetRequest} submitLabel="Create" successTitle="Budget created"
          redirectTo={(d) => `/budgets/${encodeURIComponent(d.name)}`}>
          <Field name="name" label="Name" required uppercase placeholder="e.g. FY2027" hint="Up to 30 characters; Financial Report columns refer to the budget by this name" />
          <Field name="description" label="Description" placeholder="e.g. Board-approved budget for the 2027 financial year" />
        </FormModal>
      ) : null}
    </>
  );
}

export function EditBudgetForm({ budget }: { budget: GlBudgetNameView }) {
  const { close } = useEditableCard();
  return (
    <FormModal inline title={`Edit ${budget.name}`} onClose={close} onSubmit={(v) => updateBudgetRequest(budget.name, v)} submitLabel="Save changes" successTitle="Budget updated">
      <Field name="description" label="Description" defaultValue={budget.description ?? ''} />
      <Field name="blocked" label="Blocked — figures cannot be changed" type="checkbox" defaultValue={budget.blocked ? 1 : 0} />
    </FormModal>
  );
}

export function DeleteBudgetButton({ name, className = 'btn sm ghost' }: { name: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => deleteBudgetRequest(name), { confirm: { title: `Delete budget ${name}?`, message: 'The budget name and every figure in it are removed.', confirmLabel: 'Delete', danger: true }, successTitle: 'Budget deleted', redirectTo: '/budgets' })}>
      {busy ? 'Working…' : 'Delete budget'}
    </button>
  );
}

/* ================================================================== the options bar (BC's Budget page General/Filters FastTabs) */

export interface BudgetView {
  from: string; to: string; viewBy: string; viewAs: string; linesBy: string; scope: string; accountFilter: string; dim1: string; dim2: string; rounding: string; showAll: string;
}

export function BudgetOptionsBar({ view, dims }: { view: BudgetView; dims: Dims }) {
  const { write } = useQueryWriter();
  const sel = (param: keyof BudgetView, label: string, options: { value: string; label: string }[]) => (
    <label className="tiny" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span className="muted-cell">{label}</span>
      <select value={view[param]} aria-label={label} onChange={(e) => write(param, e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
  return (
    <div className="inline" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <label className="tiny" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span className="muted-cell">Date filter</span>
        <DateFilterExpressionInput fromParam="from" toParam="to" placeholder="e.g. 01/01/27..31/12/27" />
      </label>
      {sel('viewBy', 'View by', [{ value: 'DAY', label: 'Day' }, { value: 'WEEK', label: 'Week' }, { value: 'MONTH', label: 'Month' }, { value: 'QUARTER', label: 'Quarter' }, { value: 'YEAR', label: 'Year' }, { value: 'PERIOD', label: 'Accounting period' }])}
      {sel('viewAs', 'View as', [{ value: 'NET_CHANGE', label: 'Net change' }, { value: 'BALANCE_AT_DATE', label: 'Balance at date' }])}
      {sel('linesBy', 'Show as lines', [{ value: 'ACCOUNT', label: 'G/L Account' }, { value: 'DIM1', label: dims.caption1 }, { value: 'DIM2', label: dims.caption2 }])}
      {sel('scope', 'Income/Balance', [{ value: 'INCOME_STATEMENT', label: 'Income statement' }, { value: 'BALANCE_SHEET', label: 'Balance sheet' }, { value: 'ALL', label: 'All accounts' }])}
      <AccountFilterInput value={view.accountFilter} />
      {sel('dim1', `${dims.caption1} filter`, [{ value: '', label: 'All' }, ...dims.dim1.map((d) => ({ value: String(d.id), label: `${d.code} — ${d.name}` }))])}
      {sel('dim2', `${dims.caption2} filter`, [{ value: '', label: 'All' }, ...dims.dim2.map((d) => ({ value: String(d.id), label: `${d.code} — ${d.name}` }))])}
      {sel('rounding', 'Rounding factor', [{ value: 'NONE', label: 'None' }, { value: '1', label: '1' }, { value: '1000', label: '1,000' }, { value: '1000000', label: '1,000,000' }])}
      {sel('showAll', 'Lines', [{ value: '1', label: 'Every account' }, { value: '0', label: 'Only lines with figures' }])}
    </div>
  );
}

function AccountFilterInput({ value }: { value: string }) {
  const { write } = useQueryWriter();
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <label className="tiny" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span className="muted-cell">G/L Acc. filter</span>
      <input type="text" value={v} placeholder="e.g. 4000..4999|5100" aria-label="G/L account filter" style={{ width: 170 }}
        onChange={(e) => setV(e.target.value)} onBlur={() => write('accountFilter', v.trim())} onKeyDown={(e) => { if (e.key === 'Enter') write('accountFilter', v.trim()); }} />
    </label>
  );
}

/* ================================================================== the matrix */

export function BudgetGrid({ matrix, editable, rounding, dims }: { matrix: BudgetMatrix; editable: boolean; rounding: string; dims: { dim1Id: number | null; dim2Id: number | null } }) {
  const toast = useToast();
  const { cur } = useFormat();
  const params = useSearchParams();
  const factor = rounding === '1' ? 100 : rounding === '1000' ? 100_000 : rounding === '1000000' ? 100_000_000 : 1;
  const show = (c: number) => (factor === 1 ? cur(c) : (c / factor).toLocaleString('en-KE', { maximumFractionDigits: rounding === '1' ? 0 : 1 }));
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const r of matrix.rows) for (const p of matrix.periods) v[`${r.line_id}|${p.key}`] = r.cells[p.key] ? (r.cells[p.key] / 100).toFixed(2) : '';
    return v;
  });
  const [saving, setSaving] = useState<string | null>(null);
  const save = async (lineId: number, p: { key: string; start: string; end: string }) => {
    const key = `${lineId}|${p.key}`;
    const before = matrix.rows.find((r) => r.line_id === lineId)?.cells[p.key] ?? 0;
    const cents = Math.round(Number((values[key] ?? '').replace(/,/g, '') || 0) * 100);
    if (cents === before) return;
    setSaving(key);
    try {
      const res = await setBudgetCellRequest(matrix.name, lineId, { start: p.start, end: p.end }, cents / 100, dims);
      if (!res.ok) { toast('Not saved', res.error, 'err'); setValues((v) => ({ ...v, [key]: before ? (before / 100).toFixed(2) : '' })); }
    } finally { setSaving(null); }
  };
  const live = (lineId: number, key: string) => Math.round(Number((values[`${lineId}|${key}`] ?? '').replace(/,/g, '') || 0) * 100);
  const rowTotal = (lineId: number) => matrix.periods.reduce((s, p) => s + live(lineId, p.key), 0);
  const colTotal = (key: string, type?: string) => matrix.rows.filter((r) => !type || r.type === type).reduce((s, r) => s + live(r.line_id, key), 0);
  const entriesHref = (lineId: number, p: { start: string; end: string }) => {
    const q = new URLSearchParams(params.toString());
    q.set('tab', 'entries'); q.set('from', p.start); q.set('to', p.end);
    if (matrix.linesBy === 'ACCOUNT') q.set('account', String(lineId)); else q.set(matrix.linesBy === 'DIM1' ? 'dim1' : 'dim2', String(lineId));
    return `?${q}`;
  };
  const balanceMode = matrix.viewAs === 'BALANCE_AT_DATE';
  let lastType = '';
  const isPl = matrix.rows.some((r) => r.type === 'INCOME') && matrix.rows.some((r) => r.type === 'EXPENSE');
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="budget-grid">
        <thead>
          <tr><th style={{ position: 'sticky', left: 0, background: 'var(--surface)' }}>{matrix.linesBy === 'ACCOUNT' ? 'G/L account' : 'Dimension value'}</th>{matrix.periods.map((p) => <th key={p.key} className="num" title={`${p.start} – ${p.end}`}>{p.label}</th>)}<th className="num">{balanceMode ? 'At end' : 'Total'}</th></tr>
        </thead>
        <tbody>
          {matrix.rows.map((r) => {
            const header = r.type !== lastType && r.type !== 'DIMENSION' ? <tr key={`h-${r.type}`}><td colSpan={matrix.periods.length + 2}><b>{{ INCOME: 'Income', EXPENSE: 'Expenses', ASSET: 'Assets', LIABILITY: 'Liabilities', EQUITY: 'Equity' }[r.type]}</b></td></tr> : null;
            lastType = r.type;
            return (
              <Fragment key={r.line_id}>
                {header}
                <tr>
                  <td style={{ position: 'sticky', left: 0, background: 'var(--surface)', whiteSpace: 'nowrap' }}><span className="mono">{r.code}</span> {r.name}</td>
                  {matrix.periods.map((p) => {
                    const key = `${r.line_id}|${p.key}`;
                    return (
                      <td key={p.key} className="num">
                        {editable ? (
                          <input type="text" inputMode="decimal" value={values[key] ?? ''} aria-label={`${r.code} ${p.label}`} style={{ width: 92, textAlign: 'right', opacity: saving === key ? 0.5 : 1 }}
                            onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))} onBlur={() => save(r.line_id, p)}
                            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                        ) : (r.cells[p.key] ? <a href={entriesHref(r.line_id, p)} title="Budget entries behind this figure">{show(r.cells[p.key])}</a> : '')}
                      </td>
                    );
                  })}
                  <td className="num"><b>{show(balanceMode ? r.total : rowTotal(r.line_id))}</b></td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          {isPl && !balanceMode ? (
            <>
              <tr><th style={{ position: 'sticky', left: 0, background: 'var(--surface)' }}>Income</th>{matrix.periods.map((p) => <th key={p.key} className="num">{show(colTotal(p.key, 'INCOME'))}</th>)}<th className="num">{show(matrix.periods.reduce((s, p) => s + colTotal(p.key, 'INCOME'), 0))}</th></tr>
              <tr><th style={{ position: 'sticky', left: 0, background: 'var(--surface)' }}>Expenses</th>{matrix.periods.map((p) => <th key={p.key} className="num">{show(colTotal(p.key, 'EXPENSE'))}</th>)}<th className="num">{show(matrix.periods.reduce((s, p) => s + colTotal(p.key, 'EXPENSE'), 0))}</th></tr>
              <tr><th style={{ position: 'sticky', left: 0, background: 'var(--surface)' }}>Surplus / (deficit)</th>{matrix.periods.map((p) => { const v = colTotal(p.key, 'INCOME') - colTotal(p.key, 'EXPENSE'); return <th key={p.key} className={`num ${v < 0 ? 'neg' : ''}`}>{show(v)}</th>; })}<th className="num">{show(matrix.periods.reduce((s, p) => s + colTotal(p.key, 'INCOME') - colTotal(p.key, 'EXPENSE'), 0))}</th></tr>
            </>
          ) : (
            <tr><th style={{ position: 'sticky', left: 0, background: 'var(--surface)' }}>Total</th>{matrix.periods.map((p) => <th key={p.key} className="num">{show(balanceMode ? matrix.totals[p.key] : colTotal(p.key))}</th>)}<th className="num">{show(balanceMode ? matrix.rows.reduce((s, r) => s + r.total, 0) : matrix.periods.reduce((s, p) => s + colTotal(p.key), 0))}</th></tr>
          )}
        </tfoot>
      </table>
    </div>
  );
}

/* ================================================================== entries (BC G/L Budget Entries) */

function EntryFields({ accounts, dims, initial, dateDefault }: { accounts: GlAccountSelectOption[]; dims: Dims; initial?: BudgetEntryView | null; dateDefault?: string }) {
  const [accountId, setAccountId] = useState(String(initial?.gl_account_id ?? ''));
  return (
    <>
      <div className="grid g2">
        <Field name="date" label="Date" type="date" required defaultValue={initial?.date ?? dateDefault ?? ''} />
        <Field name="amount" label="Amount" type="currency" required defaultValue={initial ? (Number(initial.amount) / 100).toFixed(2) : ''} hint="Income and expenses as positive amounts" />
      </div>
      <GlAccountSelect id="f_entry_account" name="accountId" label="G/L account" accounts={accounts} value={accountId} onChange={setAccountId} required />
      <Field name="description" label="Description" defaultValue={initial?.description ?? ''} />
      <div className="grid g2">
        <Field name="dim1Id" label={dims.caption1} type="select" defaultValue={initial?.global_dimension_1_id ?? ''} options={[{ value: '', label: '—' }, ...dims.dim1.map((d) => ({ value: String(d.id), label: `${d.code} — ${d.name}` }))]} />
        <Field name="dim2Id" label={dims.caption2} type="select" defaultValue={initial?.global_dimension_2_id ?? ''} options={[{ value: '', label: '—' }, ...dims.dim2.map((d) => ({ value: String(d.id), label: `${d.code} — ${d.name}` }))]} />
      </div>
    </>
  );
}

export function NewEntryButton({ name, accounts, dims, dateDefault, className = 'btn sm' }: { name: string; accounts: GlAccountSelectOption[]; dims: Dims; dateDefault: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>New entry</button>
      {open ? (
        <FormModal title="New budget entry" onClose={() => setOpen(false)} onSubmit={(v) => createBudgetEntryRequest(name, v)} submitLabel="Add" successTitle="Entry added">
          <EntryFields accounts={accounts} dims={dims} dateDefault={dateDefault} />
        </FormModal>
      ) : null}
    </>
  );
}

export function EntryRow({ name, entry, accounts, dims, canEdit }: { name: string; entry: BudgetEntryView; accounts: GlAccountSelectOption[]; dims: Dims; canEdit: boolean }) {
  const { run, busy } = useRunAction();
  const { cur } = useFormat();
  const [editing, setEditing] = useState(false);
  return (
    <>
      <tr>
        <td>{entry.date}</td>
        <td><span className="mono">{entry.account_code}</span> {entry.account_name}</td>
        <td>{entry.description ?? ''}</td>
        <td className="mono tiny">{entry.dim1_code ?? ''}</td>
        <td className="mono tiny">{entry.dim2_code ?? ''}</td>
        <td className="num">{cur(Number(entry.amount))}</td>
        <td className="tiny muted-cell">{entry.created_by ?? ''}</td>
        <td className="num">{canEdit ? (
          <div className="inline" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn sm ghost" onClick={() => setEditing(true)}>Edit</button>
            <button type="button" className="btn sm ghost" disabled={busy} onClick={() => run(() => deleteBudgetEntryRequest(name, entry.id), { confirm: { title: 'Delete this budget entry?', confirmLabel: 'Delete', danger: true }, successTitle: 'Deleted' })}>Delete</button>
          </div>) : null}</td>
      </tr>
      {editing ? (
        <Modal title={`Edit budget entry ${entry.id}`} onClose={() => setEditing(false)}>
          <FormModal inline title="" onClose={() => setEditing(false)} onSubmit={(v) => updateBudgetEntryRequest(name, entry.id, v)} submitLabel="Save" successTitle="Entry updated">
            <EntryFields accounts={accounts} dims={dims} initial={entry} />
          </FormModal>
        </Modal>
      ) : null}
    </>
  );
}

/* ================================================================== Copy G/L Budget (BC Report 96) */

export function CopyBudgetButton({ target, budgets, view, dims, className = 'btn ghost' }: { target: string; budgets: string[]; view: BudgetView; dims: Dims; className?: string }) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<'GL_ENTRY' | 'GL_BUDGET_ENTRY'>('GL_BUDGET_ENTRY');
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Copy budget…</button>
      {open ? (
        <FormModal title="Copy G/L Budget" wide onClose={() => setOpen(false)} onSubmit={(v) => copyGlBudgetRequest({ ...v, targetBudget: target })}
          submitLabel="Copy" successTitle="Budget copied" successDetail={(d) => `${d.entries} entr${d.entries === 1 ? 'y' : 'ies'} written into ${target}`}>
          <h4 style={{ margin: '0 0 6px' }}>Copy from</h4>
          <div className="grid g2">
            <Field name="source" label="Source" type="select" defaultValue={source} options={[{ value: 'GL_BUDGET_ENTRY', label: 'G/L Budget entries' }, { value: 'GL_ENTRY', label: 'G/L entries (actual figures)' }]}
              onChange={(e) => setSource(e.target.value as 'GL_ENTRY' | 'GL_BUDGET_ENTRY')} />
            {source === 'GL_BUDGET_ENTRY'
              ? <Field name="sourceBudget" label="Source budget name" type="select" required defaultValue={budgets.find((b) => b !== target) ?? target} options={budgets.map((b) => ({ value: b, label: b }))} />
              : <div className="tiny muted-cell" style={{ alignSelf: 'end' }}>Posted actuals, one budget entry per account per month, in the account&apos;s natural sign.</div>}
          </div>
          <div className="grid g2">
            <Field name="sourceFrom" label="Date filter — from" type="date" required defaultValue={view.from} />
            <Field name="sourceTo" label="Date filter — to" type="date" required defaultValue={view.to} />
          </div>
          <Field name="accountFilter" label="G/L account filter" defaultValue={view.accountFilter} placeholder="blank = every account · e.g. 4000..4999|5100" />
          <div className="grid g2">
            <Field name="sourceDim1Id" label={`${dims.caption1} filter`} type="select" defaultValue={view.dim1} options={[{ value: '', label: 'All' }, ...dims.dim1.map((d) => ({ value: String(d.id), label: `${d.code} — ${d.name}` }))]} />
            <Field name="sourceDim2Id" label={`${dims.caption2} filter`} type="select" defaultValue={view.dim2} options={[{ value: '', label: 'All' }, ...dims.dim2.map((d) => ({ value: String(d.id), label: `${d.code} — ${d.name}` }))]} />
          </div>
          <h4 style={{ margin: '12px 0 6px' }}>Copy to — {target}</h4>
          <div className="grid g3">
            <Field name="adjustmentFactor" label="Adjustment factor" type="number" step="0.0001" min={0.0001} defaultValue={1} required hint="1 = as is · 1.1 = plus 10%" />
            <Field name="roundingMethod" label="Rounding method" type="select" defaultValue="NONE" options={[{ value: 'NONE', label: 'None' }, { value: '1', label: 'Nearest 1' }, { value: '10', label: 'Nearest 10' }, { value: '100', label: 'Nearest 100' }, { value: '1000', label: 'Nearest 1,000' }]} />
            <Field name="dateChangeFormula" label="Date change formula" placeholder="e.g. +1Y" hint="Shifts every copied date: +1Y moves last year's figures into this year" />
          </div>
          <Field name="copyDimensions" label="Keep the source dimensions on the copied entries" type="checkbox" defaultValue={1} />
          <Field name="replace" label="Replace what the target already holds for the copied date range" type="checkbox" defaultValue={0} />
        </FormModal>
      ) : null}
    </>
  );
}

/* ================================================================== Delete Budget (entries within the filter) */

export function DeleteEntriesButton({ name, view, dims, className = 'btn ghost' }: { name: string; view: BudgetView; dims: Dims; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Delete figures…</button>
      {open ? (
        <FormModal title="Delete budget figures" onClose={() => setOpen(false)} onSubmit={(v) => deleteBudgetEntriesRequest(name, v)} submitLabel="Delete" submitClass="btn danger"
          successTitle="Figures deleted" successDetail={(d) => `${d.deleted} entr${d.deleted === 1 ? 'y' : 'ies'} removed`} resultStyle="popup">
          <div className="note">Removes every entry of {name} inside these filters. The budget name stays. Leave the dates blank to clear the whole budget.</div>
          <div className="grid g2">
            <Field name="from" label="Date — from" type="date" defaultValue={view.from} />
            <Field name="to" label="Date — to" type="date" defaultValue={view.to} />
          </div>
          <Field name="accountFilter" label="G/L account filter" defaultValue={view.accountFilter} placeholder="blank = every account" />
          <div className="grid g2">
            <Field name="dim1Id" label={`${dims.caption1} filter`} type="select" defaultValue={view.dim1} options={[{ value: '', label: 'All' }, ...dims.dim1.map((d) => ({ value: String(d.id), label: `${d.code} — ${d.name}` }))]} />
            <Field name="dim2Id" label={`${dims.caption2} filter`} type="select" defaultValue={view.dim2} options={[{ value: '', label: 'All' }, ...dims.dim2.map((d) => ({ value: String(d.id), label: `${d.code} — ${d.name}` }))]} />
          </div>
        </FormModal>
      ) : null}
    </>
  );
}

/* ================================================================== Import Budget from Excel (BC Report 81) */

function ImportSubmit() {
  const { pending } = useFormStatus();
  return <button type="submit" className="btn" disabled={pending}>{pending ? 'Importing…' : 'Import'}</button>;
}

export function ImportBudgetButton({ name, dims, className = 'btn ghost' }: { name: string; dims: Dims; className?: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ImportBudgetState, FormData>(importBudgetAction, {});
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if ((state.result || state.error) && fileRef.current) fileRef.current.value = ''; }, [state]);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Import from Excel…</button>
      {open ? (
        <Modal title={`Import budget from Excel — ${name}`} onClose={() => setOpen(false)}>
          <div className="note">The sheet layout is the one Export writes: column A the G/L account no., column B its name, then one column per period headed by the period&apos;s first day (2027-01-01) or month (2027-01). Amounts in currency units, income and expenses positive.</div>
          <form action={formAction}>
            <input type="hidden" name="name" value={name} />
            <div className="field"><label htmlFor="imp_file">Excel file</label><input id="imp_file" ref={fileRef} type="file" name="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required /></div>
            <Field name="mode" label="Import option" type="select" defaultValue="REPLACE" options={[{ value: 'REPLACE', label: 'Replace entries — clear each imported account for the sheet’s dates first' }, { value: 'ADD', label: 'Add entries — keep what is there and add the sheet’s figures' }]} />
            <Field name="description" label="Description for the entries" defaultValue="Imported from Excel" />
            <div className="grid g2">
              <Field name="dim1Id" label={`${dims.caption1} on the entries`} type="select" defaultValue="" options={[{ value: '', label: '—' }, ...dims.dim1.map((d) => ({ value: String(d.id), label: `${d.code} — ${d.name}` }))]} />
              <Field name="dim2Id" label={`${dims.caption2} on the entries`} type="select" defaultValue="" options={[{ value: '', label: '—' }, ...dims.dim2.map((d) => ({ value: String(d.id), label: `${d.code} — ${d.name}` }))]} />
            </div>
            <div className="inline" style={{ justifyContent: 'flex-end', marginTop: 8 }}><ImportSubmit /></div>
          </form>
          {state.error ? <div className="pill bad" style={{ marginTop: 8 }}>{state.error}</div> : null}
          {state.result ? (
            <div className="tiny" style={{ marginTop: 8 }}>
              {state.result.inserted} figure(s) imported · {state.result.replaced} replaced · {state.result.skipped.length} row(s) skipped
              {state.result.skipped.length ? <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{state.result.skipped.slice(0, 20).map((s) => <li key={s.row}>Row {s.row}: {s.reason}</li>)}</ul> : null}
            </div>
          ) : null}
        </Modal>
      ) : null}
    </>
  );
}
