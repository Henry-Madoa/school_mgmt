'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/modal';
import { DefinitionList } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import {
  deleteConfigPackageAction, getConfigPackageFilterFields, importConfigPackageAction, type ImportState,
} from '@/app/actions/configPackages';
import { CONDITION_OPERATORS } from '@/lib/workflowConstants';
import type { FilterCondition, FilterFieldDef } from '@/lib/listFilters';
import type { ConfigPackageWithFields, WorkflowConditionOperator } from '@/lib/types';

function ImportSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn sm" disabled={pending}>{pending ? 'Importing…' : 'Import'}</button>
  );
}

/** Which comparisons make sense for a filter field's type — a text field only ever offers
 *  equals/does-not-equal, same rule components/ui/dynamic-filter.tsx uses for every other list. */
const OPERATORS_FOR_TYPE: Record<FilterFieldDef['type'], WorkflowConditionOperator[]> = {
  text: ['=', '!='],
  select: ['=', '!='],
  number: ['=', '!=', '>', '>=', '<', '<=', 'BETWEEN'],
  date: ['=', '!=', '>', '>=', '<', '<=', 'BETWEEN'],
};

/**
 * The export's own filter builder — deliberately not components/ui/dynamic-filter.tsx, which
 * keeps its condition rows in the page's URL search params. This widget renders once per
 * package row on the same admin page, so sharing one URL param across every row would mean
 * filtering one package's export clobbers another's — local state instead, folded into the
 * export link's href only when it's actually clicked.
 */
function ExportFilterBar({ code }: { code: string }) {
  const [expanded, setExpanded] = useState(false);
  const [fields, setFields] = useState<FilterFieldDef[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<FilterCondition[]>([]);

  useEffect(() => {
    if (!expanded || fields !== null || loadError) return;
    let cancelled = false;
    getConfigPackageFilterFields(code)
      .then((res) => {
        if (cancelled) return;
        if (res.ok) setFields(res.data);
        else setLoadError(res.error);
      })
      // The server action call itself can reject (a stale action reference after a deploy/dev
      // restart, a network blip) without ever reaching actionResult()'s own try/catch — without
      // this, that left `fields` stuck at null forever, i.e. "Loading fields…" that never
      // resolves, which is exactly what looked like the fields never fetching at all.
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Could not load fields');
      });
    return () => { cancelled = true; };
  }, [expanded, code, fields, loadError]);

  const addRow = () => setRows((r) => [...r, { field: fields?.[0]?.key ?? '', operator: '=', value: '' }]);
  const removeRow = (i: number) => setRows((r) => r.filter((_, k) => k !== i));
  const updateRow = (i: number, patch: Partial<FilterCondition>) =>
    setRows((r) => r.map((row, k) => (k === i ? { ...row, ...patch } : row)));

  const active = rows.filter((r) => r.field && r.value !== '');
  const href = `/api/config-packages/${code}/export${active.length ? `?filters=${encodeURIComponent(JSON.stringify(active))}` : ''}`;

  return (
    <div className="inline" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <a className="btn sm ghost" href={href}>
        ⬇ Export CSV{active.length ? ` (${active.length} filter${active.length === 1 ? '' : 's'})` : ''}
      </a>
      <button type="button" className="btn sm ghost" onClick={() => setExpanded((v) => !v)}>
        {expanded ? 'Hide filters' : 'Filter export ▾'}
      </button>

      {expanded ? (
        <div className="inline" style={{ gap: 4, flexWrap: 'wrap' }}>
          {!fields && !loadError ? <span className="tiny">Loading fields…</span> : null}
          {loadError ? (
            <span className="tiny" style={{ color: 'var(--danger)' }}>
              Could not load fields: {loadError}{' '}
              <button type="button" className="link-btn tiny" onClick={() => setLoadError(null)}>Retry</button>
            </span>
          ) : null}
          {fields && !fields.length ? <span className="tiny">This package has no fields to filter on.</span> : null}
          {rows.map((row, i) => {
            const def = fields?.find((f) => f.key === row.field);
            const operators = def ? OPERATORS_FOR_TYPE[def.type] : (['='] as WorkflowConditionOperator[]);
            const inputType = def?.type === 'date' ? 'date' : def?.type === 'number' ? 'number' : 'text';
            return (
              <span key={i} className="inline" style={{ gap: 4 }}>
                <select aria-label="Filter field" value={row.field}
                  onChange={(e) => updateRow(i, { field: e.target.value, operator: '=', value: '', value2: '' })}>
                  {(fields ?? []).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
                <select aria-label="Filter operator" value={row.operator}
                  onChange={(e) => updateRow(i, { operator: e.target.value as WorkflowConditionOperator })}>
                  {CONDITION_OPERATORS.filter((o) => operators.includes(o.value)).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <input type={inputType} aria-label="Filter value" value={row.value}
                  onChange={(e) => updateRow(i, { value: e.target.value })} />
                {row.operator === 'BETWEEN' ? (
                  <input type={inputType} aria-label="Filter value (upper bound)" value={row.value2 ?? ''}
                    onChange={(e) => updateRow(i, { value2: e.target.value })} />
                ) : null}
                <button type="button" className="btn sm ghost" onClick={() => removeRow(i)} aria-label="Remove filter">×</button>
              </span>
            );
          })}
          {fields?.length ? (
            <button type="button" className="btn sm ghost" onClick={addRow}>+ Add filter</button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The package code, clickable to open its card — export (with the filter builder above),
 * import, and a summary of what the package is configured against. None of that lives on the
 * list row itself anymore: a table of packages with an inline export/filter/import strip per
 * row got cramped fast, and every one of those actions is squarely about *this* package, not
 * something you'd want to compare across rows.
 */
export function ConfigPackageCard({ pkg }: { pkg: ConfigPackageWithFields }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ImportState, FormData>(importConfigPackageAction, {});
  const fileRef = useRef<HTMLInputElement>(null);

  // Clear the picked file once an import completes, successfully or not, so re-choosing the
  // same file for a retry still fires a change (and the form doesn't silently resubmit it).
  useEffect(() => {
    if ((state.result || state.error) && fileRef.current) fileRef.current.value = '';
  }, [state]);

  return (
    <>
      <button type="button" className="btn sm ghost" onClick={() => setOpen(true)}>Export / Import</button>
      {open ? (
        <Modal wide title={pkg.name} onClose={() => setOpen(false)}>
          <DefinitionList items={[
            ['Code', <span className="mono" key="code">{pkg.code}</span>],
            ['Table', <span className="mono tiny" key="table">{pkg.table_name}</span>],
            ['Key field', pkg.key_field || '— (every import row inserts as new)'],
            ['Fields', pkg.fields.map((f) => f.field_name).join(', ') || '—'],
          ]} />

          <div className="card-sub" style={{ marginTop: 'calc(var(--sp) * 2)' }}>Export</div>
          <ExportFilterBar code={pkg.code} />

          <div className="card-sub" style={{ marginTop: 'calc(var(--sp) * 2)' }}>Import</div>
          <form action={formAction} className="inline" style={{ gap: 6, flexWrap: 'wrap' }}>
            <input type="hidden" name="code" value={pkg.code} />
            <input ref={fileRef} type="file" name="file" accept=".csv,text/csv" aria-label="CSV file to import" required />
            <ImportSubmitButton />
          </form>

          {state.error ? <div className="pill bad">{state.error}</div> : null}
          {state.result ? (
            <div className="tiny" style={{ marginTop: 8 }}>
              {state.result.inserted} inserted · {state.result.updated} updated · {state.result.errors} error(s)
              {state.result.errors ? (
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {state.result.rows.filter((r) => r.status === 'ERROR').slice(0, 20).map((r) => (
                    <li key={r.row}>Row {r.row}: {r.message}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </Modal>
      ) : null}
    </>
  );
}

export function DeleteConfigPackageButton({ code }: { code: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  const remove = () => startTransition(async () => {
    const res = await deleteConfigPackageAction(code);
    if (!res.ok) { toast('Could not delete package', res.error, 'err'); return; }
    toast('Configuration package deleted', code, 'ok');
    router.refresh();
  });

  if (!confirming) {
    return <button type="button" className="btn sm ghost" onClick={() => setConfirming(true)}>Delete</button>;
  }
  return (
    <span className="inline" style={{ gap: 4 }}>
      <span className="tiny">Delete {code}?</span>
      <button type="button" className="btn sm" disabled={busy} onClick={remove}>{busy ? 'Working…' : 'Confirm'}</button>
      <button type="button" className="btn sm ghost" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
    </span>
  );
}
