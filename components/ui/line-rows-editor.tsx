'use client';

import { useState } from 'react';
import { FormModal } from './form-modal';
import { EMAIL_PATTERN, EMAIL_TITLE, PHONE_PATTERN, PHONE_TITLE } from '@/lib/validate';
import { EmptyState, TableWrap } from './primitives';
import { CollapsibleCard } from './collapsible-card';
import type { ActionResult } from '@/lib/types';

/*
 * A generic "manage a repeating list of rows" editor — in place on a card (LineRowsPanel with
 * `edit`), or in a modal (LineRowsFormButton) where a card is not the context — the pattern
 * app/member-edits/view/[no]/nok-nominee-form.tsx hand-wrote once for Next of Kin and once for
 * Nominees. Employee Management needs the same shape seven times over (next of kin,
 * beneficiaries, dependants, emergency contacts, professional bodies, work history, bank
 * accounts), each in two contexts (the live employee, and an Employee Editing request) — enough
 * repetition that a shared component earns its place instead of fourteen hand-copies.
 */

export type LineColumn<R> = {
  key: keyof R & string;
  label: string;
  type?: 'text' | 'select' | 'checkbox' | 'number' | 'date' | 'phone' | 'email';
  options?: readonly (string | { value: string | number; label: string })[];
  width?: number | string;
  /** Read-only rendering for the summary panel — defaults to the raw value. */
  render?: (row: R) => React.ReactNode;
};

export function LineRowsFormButton<R extends Record<string, any>>({
  title, wide = true, rows: initialRows, columns, emptyRow, onSave,
  submitLabel = 'Save', successTitle = 'Saved', className = 'btn', children, onSaved,
}: {
  title: string; wide?: boolean; rows: R[]; columns: LineColumn<R>[]; emptyRow: () => R;
  onSave: (rows: R[]) => Promise<ActionResult<unknown>>;
  submitLabel?: string; successTitle?: string; className?: string; children: React.ReactNode;
  onSaved?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<R[]>(() => initialRows.map((r) => ({ ...r })));

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          wide={wide} title={title} onClose={() => setOpen(false)}
          onSubmit={async () => {
            const res = await onSave(rows);
            if (res.ok) onSaved?.();
            return res;
          }}
          submitLabel={submitLabel} successTitle={successTitle}
        >
          <LineRowsGrid rows={rows} setRows={setRows} columns={columns} emptyRow={emptyRow} />
        </FormModal>
      ) : null}
    </>
  );
}

/** The editable grid itself — one row per record, a remove button per row, Add row below. */
function LineRowsGrid<R extends Record<string, any>>({ rows, setRows, columns, emptyRow }: {
  rows: R[]; setRows: React.Dispatch<React.SetStateAction<R[]>>; columns: LineColumn<R>[]; emptyRow: () => R;
}) {
  const update = (i: number, key: string, value: unknown) =>
    setRows((cur) => cur.map((r, k) => (k === i ? { ...r, [key]: value } : r)));
  const remove = (i: number) => setRows((cur) => cur.filter((_, k) => k !== i));
  return (
    <>
        {/* Seven editable columns run wider than a card; the grid scrolls sideways inside it
            rather than pushing the page out (globals.css .line-rows-grid). */}
        <div className="line-rows-grid">
          <table>
            <thead>
              <tr>
                {columns.map((c) => <th key={c.key} style={c.width ? { width: c.width } : undefined}>{c.label}</th>)}
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {columns.map((c) => {
                    const value = row[c.key];
                    if (c.type === 'checkbox') {
                      return (
                        <td key={c.key} style={{ textAlign: 'center' }}>
                          <input type="checkbox" checked={!!value} aria-label={c.label}
                            onChange={(e) => update(i, c.key, e.target.checked)} />
                        </td>
                      );
                    }
                    if (c.type === 'select') {
                      return (
                        <td key={c.key}>
                          <select value={(value as string) ?? ''} aria-label={c.label}
                            onChange={(e) => update(i, c.key, e.target.value)}>
                            {(c.options || []).map((o) => {
                              const v = typeof o === 'object' ? o.value : o;
                              const t = typeof o === 'object' ? o.label : o;
                              return <option key={String(v)} value={v}>{t || '—'}</option>;
                            })}
                          </select>
                        </td>
                      );
                    }
                    return (
                      <td key={c.key}>
                        <input
                          type={c.type === 'number' ? 'number' : c.type === 'date' ? 'date'
                            : c.type === 'phone' ? 'tel' : c.type === 'email' ? 'email' : 'text'}
                          inputMode={c.type === 'phone' ? 'tel' : undefined}
                          pattern={c.type === 'phone' ? PHONE_PATTERN : c.type === 'email' ? EMAIL_PATTERN : undefined}
                          title={c.type === 'phone' ? PHONE_TITLE : c.type === 'email' ? EMAIL_TITLE : undefined}
                          value={(value as string | number) ?? ''} aria-label={c.label}
                          onChange={(e) => update(
                            i, c.key, c.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value,
                          )}
                        />
                      </td>
                    );
                  })}
                  <td><button type="button" className="btn sm ghost" onClick={() => remove(i)} aria-label="Remove row">×</button></td>
                </tr>
              ))}
              {!rows.length ? <tr><td colSpan={columns.length + 1} className="tiny">No rows yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
          <div className="inline" style={{ marginTop: 10 }}>
            <button type="button" className="btn ghost sm" onClick={() => setRows((cur) => [...cur, emptyRow()])}>Add row</button>
          </div>
    </>
  );
}

/**
 * The saved-rows summary card. Given `edit`, the card edits itself in place — an Edit button in
 * its header swaps the read-only table for the grid with Save / Cancel beneath, the way the
 * bio-data and employment cards beside it already work — so a record is edited on its card, not
 * in a modal over it. `manageButton` remains for a caller that supplies its own control.
 */
export function LineRowsPanel<R extends Record<string, any>>({
  title, sub, rows, columns, icon = '📋', manageButton, edit,
}: {
  title: string; sub?: string; rows: R[]; columns: LineColumn<R>[]; icon?: string; manageButton?: React.ReactNode;
  edit?: {
    emptyRow: () => R;
    onSave: (rows: R[]) => Promise<ActionResult<unknown>>;
    successTitle?: string;
    /** Whether the viewer may edit — false hides the button and leaves the card read-only. */
    can: boolean;
  };
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<R[]>([]);
  const startEditing = () => { setDraft(rows.map((r) => ({ ...r }))); setEditing(true); };
  const actions = edit
    ? (edit.can && !editing ? <button type="button" className="btn sm ghost" onClick={startEditing}>Edit</button> : null)
    : manageButton;

  if (edit && editing) {
    return (
      <CollapsibleCard title={title} sub={sub}>
        <FormModal inline title={title} onClose={() => setEditing(false)} onSubmit={() => edit.onSave(draft)}
          submitLabel="Save" successTitle={edit.successTitle ?? `${title} saved`}>
          <LineRowsGrid rows={draft} setRows={setDraft} columns={columns} emptyRow={edit.emptyRow} />
        </FormModal>
      </CollapsibleCard>
    );
  }

  return (
    <CollapsibleCard title={title} sub={sub} actions={actions}>
      {rows.length ? (
        <TableWrap>
          <thead><tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.key}>{c.render ? c.render(row) : (String(row[c.key] ?? '') || '—')}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : <EmptyState icon={icon} title={`No ${title.toLowerCase()} on file`} />}
    </CollapsibleCard>
  );
}
