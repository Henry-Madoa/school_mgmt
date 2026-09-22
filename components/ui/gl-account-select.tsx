'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { GlAccount } from '@/lib/types';

export type GlAccountSelectOption = Pick<GlAccount, 'id' | 'code' | 'name'>;

const labelFor = (a: GlAccountSelectOption): string => `${a.code} — ${a.name}`;

/**
 * A searchable Chart of Accounts picker — a text input that filters the account list by code or
 * name as you type, backed by a hidden `name`-field input so it drops into readForm()'s
 * FormData-based forms exactly like a native <select> (and slots into a controlled row's own
 * value/onChange state just as easily). Built the same way components/ui/member-select.tsx is,
 * for the same reason: a chart of accounts runs long enough that scrolling a native dropdown to
 * find one by eye doesn't scale, and nothing here defaults to the first row — the field opens
 * empty (or showing whatever was already picked) until the officer actually searches.
 *
 * `label` is optional: omit it for a compact, unlabelled instance dropped into a table cell (the
 * charge/product line-item pattern) — pass `ariaLabel` there instead of a visible label.
 */
export function GlAccountSelect({
  id, name, label, accounts, value, onChange, required, disabled, placeholder = 'Search account code or name…',
  hint, valueField = 'id', ariaLabel, className,
}: {
  id?: string;
  name: string;
  label?: string;
  accounts: GlAccountSelectOption[];
  /** The account's id or code (per `valueField`), stringified; '' = nothing picked. */
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  hint?: string;
  /** Which field of the account identifies it in `value`/`onChange` — most callers key by id;
   *  a manual journal line keys by code instead (accounting.ts's own posting lines do). */
  valueField?: 'id' | 'code';
  /** Accessible name when rendered without a visible `label` (compact table usage). */
  ariaLabel?: string;
  className?: string;
}) {
  const keyOf = (a: GlAccountSelectOption): string => String(valueField === 'code' ? a.code : a.id);
  const selected = accounts.find((a) => keyOf(a) === value) ?? null;
  const [query, setQuery] = useState(selected ? labelFor(selected) : '');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldId = id ?? `f_${name}`;

  // Keeps the visible text in sync whenever the selected value changes from outside this
  // component (e.g. Edit forms initialising `value` from an existing record).
  useEffect(() => {
    const a = accounts.find((aa) => keyOf(aa) === value) ?? null;
    setQuery(a ? labelFor(a) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const needle = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!needle) return accounts;
    return accounts.filter((a) => labelFor(a).toLowerCase().includes(needle));
  }, [accounts, needle]);

  useEffect(() => { setHighlight(0); }, [needle, open]);

  const pick = (a: GlAccountSelectOption) => {
    onChange(keyOf(a));
    setQuery(labelFor(a));
    setOpen(false);
  };

  const revert = () => setQuery(selected ? labelFor(selected) : '');

  const input = (
    <>
      <input
        ref={inputRef}
        id={fieldId}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-label={label ? undefined : ariaLabel}
        autoComplete="off"
        required={required}
        disabled={disabled}
        placeholder={placeholder}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (value) onChange(''); // typing invalidates whatever was previously picked
        }}
        onBlur={() => { setOpen(false); revert(); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setHighlight((h) => Math.min(h + 1, filtered.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter') {
            if (open && filtered[highlight]) { e.preventDefault(); pick(filtered[highlight]); }
          } else if (e.key === 'Escape') {
            setOpen(false); revert();
          }
        }}
      />
      <input type="hidden" name={name} value={value} disabled={disabled} />
      {open && filtered.length ? (
        <ul className="combobox-list" role="listbox">
          {filtered.map((a, i) => (
            <li
              key={a.id} role="option" aria-selected={i === highlight}
              className={i === highlight ? 'active' : undefined}
              onMouseDown={(e) => { e.preventDefault(); pick(a); }}
              onMouseEnter={() => setHighlight(i)}
            >
              {labelFor(a)}
            </li>
          ))}
        </ul>
      ) : null}
      {open && needle && !filtered.length ? (
        <ul className="combobox-list"><li className="tiny combobox-empty">No matching accounts</li></ul>
      ) : null}
    </>
  );

  if (!label) {
    return <div className={`combobox${className ? ` ${className}` : ''}`}>{input}</div>;
  }

  return (
    <div className={`field combobox${className ? ` ${className}` : ''}`}>
      <label htmlFor={fieldId}>{label}{required ? <span className="req"> *</span> : null}</label>
      {input}
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

/**
 * GlAccountSelect for an uncontrolled, FormData-read form (a FormModal or an inline card): it
 * keeps its own picked value, seeded from `defaultValue`, so it drops in wherever a
 * `<Field type="select">` of accounts used to sit — same `name`, same posted value.
 */
export function GlAccountField({ defaultValue = '', ...rest }: Omit<Parameters<typeof GlAccountSelect>[0], 'value' | 'onChange'> & {
  defaultValue?: string | number | null;
}) {
  const [value, setValue] = useState(defaultValue == null ? '' : String(defaultValue));
  return <GlAccountSelect {...rest} value={value} onChange={setValue} />;
}
