'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQueryWriter } from './filters';
import { CONDITION_OPERATORS } from '@/lib/workflowConstants';
import type { FilterCondition, FilterFieldDef } from '@/lib/listFilters';
import { parseFilters } from '@/lib/listFilters';
import type { WorkflowConditionOperator } from '@/lib/types';

/** Comparisons only make sense for a number/date field — a text/select field only ever
 *  offers equals/does-not-equal. */
const OPERATORS_FOR_TYPE: Record<FilterFieldDef['type'], WorkflowConditionOperator[]> = {
  text: ['=', '!='],
  select: ['=', '!='],
  number: ['=', '!=', '>', '>=', '<', '<=', 'BETWEEN'],
  date: ['=', '!=', '>', '>=', '<', '<=', 'BETWEEN'],
};

const emptyRow = (fields: FilterFieldDef[]): FilterCondition => ({ field: fields[0]?.key ?? '', operator: '=', value: '' });

const inputType = (type: FilterFieldDef['type']): string => (type === 'date' ? 'date' : type === 'number' ? 'number' : 'text');

function ValueControl({ def, value, onChange, label, disabled }: {
  def: FilterFieldDef | undefined; value: string; onChange: (v: string) => void; label: string; disabled?: boolean;
}) {
  if (def?.type === 'select') {
    return (
      <select aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select…</option>
        {(def.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  return (
    <input
      type={inputType(def?.type ?? 'text')} aria-label={label} value={value} disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/**
 * A "field + operator + value" filter builder — any number of AND-combined condition rows,
 * the value control adapting to the picked field's data type. Modeled directly on the
 * Workflow condition editor (app/admin/workflow-form.tsx), generalized from admin-defined
 * approval routing to filtering any list before viewing/exporting it.
 *
 * The whole row array is kept as one query param (JSON-encoded) rather than one param per
 * row/field, since the row count is open-ended.
 */
export function DynamicFilterBar({ fields, paramName = 'filters', disabled }: {
  fields: FilterFieldDef[];
  paramName?: string;
  disabled?: boolean;
}) {
  const params = useSearchParams();
  const { write } = useQueryWriter();
  const urlValue = params.get(paramName);
  const [rows, setRows] = useState<FilterCondition[]>(() => parseFilters(urlValue));
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Adopt the URL's value when the user navigates (back button, tab switch) rather than
  // fighting it with stale local state.
  useEffect(() => { setRows(parseFilters(urlValue)); }, [urlValue]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const commit = (next: FilterCondition[], debounce: boolean) => {
    setRows(next);
    clearTimeout(timer.current);
    const value = next.length ? JSON.stringify(next) : '';
    if (debounce) timer.current = setTimeout(() => write(paramName, value), 400);
    else write(paramName, value);
  };

  const addRow = () => commit([...rows, emptyRow(fields)], false);
  const removeRow = (i: number) => commit(rows.filter((_, k) => k !== i), false);
  const updateRow = (i: number, patch: Partial<FilterCondition>, debounce = false) =>
    commit(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)), debounce);

  if (!fields.length) return null;

  return (
    <div className="inline" style={{ gap: 8, flexWrap: 'wrap' }}>
      {rows.map((row, i) => {
        const def = fields.find((f) => f.key === row.field);
        const operators = def ? OPERATORS_FOR_TYPE[def.type] : (['='] as WorkflowConditionOperator[]);
        return (
          <span key={i} className="inline" style={{ gap: 4 }}>
            <select
              aria-label="Filter field" value={row.field} disabled={disabled}
              onChange={(e) => updateRow(i, { field: e.target.value, operator: '=', value: '', value2: '' })}
            >
              {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
            <select
              aria-label="Filter operator" value={row.operator} disabled={disabled}
              onChange={(e) => updateRow(i, { operator: e.target.value as WorkflowConditionOperator })}
            >
              {CONDITION_OPERATORS.filter((o) => operators.includes(o.value)).map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <ValueControl
              def={def} value={row.value} label="Filter value" disabled={disabled}
              onChange={(v) => updateRow(i, { value: v }, def?.type === 'text')}
            />
            {row.operator === 'BETWEEN' ? (
              <ValueControl
                def={def} value={row.value2 ?? ''} label="Filter value (upper bound)" disabled={disabled}
                onChange={(v) => updateRow(i, { value2: v }, def?.type === 'text')}
              />
            ) : null}
            <button
              type="button" className="btn sm ghost" onClick={() => removeRow(i)}
              aria-label="Remove filter" disabled={disabled}
            >×</button>
          </span>
        );
      })}
      <button type="button" className="btn sm ghost" onClick={addRow} disabled={disabled}>+ Add filter</button>
    </div>
  );
}
