'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQueryWriter } from './filters';

export interface MultiSelectOption { value: string; label: string; }

const parseIds = (raw: string | null): string[] => (raw ? raw.split(',').filter(Boolean) : []);

/**
 * A searchable, multi-value picker bound to a comma-joined query parameter — the Member
 * Statement's Member/Account/Loan filters, each independently multi-selectable and shareable
 * via URL exactly like every other filter on this app. Modelled on MemberSelect's combobox, but
 * accumulating a set of ids as removable chips instead of replacing a single value.
 */
export function MultiSelectFilter({
  paramName, label, options, placeholder = 'Search…', required, disabled,
}: {
  paramName: string;
  label: string;
  options: MultiSelectOption[];
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const params = useSearchParams();
  const { write } = useQueryWriter();
  const selected = parseIds(params.get(paramName));
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const byValue = useMemo(() => new Map(options.map((o) => [o.value, o])), [options]);
  const needle = query.trim().toLowerCase();
  const filtered = useMemo(
    () => options.filter((o) => !selected.includes(o.value) && (!needle || o.label.toLowerCase().includes(needle))),
    [options, needle, selected],
  );

  const commit = (next: string[]) => write(paramName, next.join(','));
  const add = (value: string) => { commit([...selected, value]); setQuery(''); };
  const remove = (value: string) => commit(selected.filter((v) => v !== value));

  return (
    <div className="field combobox multi" ref={boxRef}>
      <label>{label}{required ? <span className="req"> *</span> : null}</label>
      {selected.length ? (
        <div className="chip-row">
          {selected.map((v) => (
            <span key={v} className="pill info chip">
              {byValue.get(v)?.label ?? v}
              <button
                type="button" onClick={() => remove(v)} disabled={disabled}
                aria-label={`Remove ${byValue.get(v)?.label ?? v}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <input
        type="text"
        value={query}
        placeholder={disabled ? 'Select a member first' : placeholder}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
      />
      {open && !disabled && filtered.length ? (
        <ul className="combobox-list" role="listbox">
          {filtered.slice(0, 50).map((o) => (
            <li key={o.value} onMouseDown={(e) => { e.preventDefault(); add(o.value); }}>
              {o.label}
            </li>
          ))}
        </ul>
      ) : null}
      {open && !disabled && needle && !filtered.length ? (
        <ul className="combobox-list"><li className="tiny combobox-empty">No matches</li></ul>
      ) : null}
    </div>
  );
}

/** Boolean filter, applied immediately — the Statement's "Show Accounts"/"Show Loans" toggles,
 *  independent of each other and of the Loan filter (an intentional, documented behaviour change
 *  from the source report — see the design doc's §4.2). Absent from the URL means "on". */
export function BoolToggle({ paramName, label, disabled }: {
  paramName: string; label: string; disabled?: boolean;
}) {
  const params = useSearchParams();
  const { write } = useQueryWriter();
  const raw = params.get(paramName);
  const checked = raw !== '0';

  return (
    <div className="checkline">
      <input
        type="checkbox" checked={checked} disabled={disabled}
        onChange={(e) => write(paramName, e.target.checked ? '' : '0')}
      />
      <label>{label}</label>
    </div>
  );
}
