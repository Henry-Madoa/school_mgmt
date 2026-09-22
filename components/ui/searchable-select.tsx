'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

/**
 * A generic searchable picker for any table-relation dropdown — a text input that filters a list
 * by its rendered label as you type, backed by a hidden `name`-field input so it drops into
 * readForm()'s FormData-based forms exactly like a native <select> (and slots into a controlled
 * row's own value/onChange state just as easily). Same shape as components/ui/member-select.tsx
 * and components/ui/gl-account-select.tsx, generalised for every other table-relation dropdown
 * (Charges, Savings/Loan Products, Employers, Bank Accounts, Roles, Dimension values, …) so each
 * one doesn't need its own bespoke copy of this same combobox logic.
 *
 * Nothing here defaults to the first row — the field opens empty (or showing whatever was already
 * picked) until the user actually searches, same as every other combobox in this app.
 *
 * `label` is optional: omit it for a compact, unlabelled instance dropped into a table cell — pass
 * `ariaLabel` there instead of a visible label.
 */
export function SearchableSelect<T>({
  id, name, label, items, getValue, getLabel, getKey, value, onChange, required, disabled,
  placeholder = 'Search…', hint, ariaLabel, className, style, emptyText = 'No matches',
}: {
  id?: string;
  name: string;
  label?: string;
  items: T[];
  /** The string this item is identified by in `value`/`onChange` (usually a stringified id, or a
   *  code) — '' is reserved for "nothing picked". */
  getValue: (item: T) => string;
  /** What's shown in the input and the dropdown list (e.g. `${code} — ${name}`). */
  getLabel: (item: T) => string;
  /** React list key — defaults to getValue(item). */
  getKey?: (item: T) => string | number;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  hint?: string;
  /** Accessible name when rendered without a visible `label` (compact table usage). */
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
  /** Shown when a search matches nothing (e.g. "No matching employers"). */
  emptyText?: string;
}) {
  const selected = items.find((it) => getValue(it) === value) ?? null;
  const [query, setQuery] = useState(selected ? getLabel(selected) : '');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldId = id ?? `f_${name}`;

  // Keeps the visible text in sync when the selected value changes from outside this component
  // (Edit forms initialising `value` from an existing record) — including the case where `items`
  // arrive asynchronously *after* `value` is already set, which otherwise leaves a required field
  // looking empty and unsubmittable. Skipped while the field is open so it never fights the user's
  // own typing.
  useEffect(() => {
    if (open) return;
    const it = items.find((x) => getValue(x) === value) ?? null;
    setQuery(it ? getLabel(it) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, items, open]);

  const needle = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!needle) return items;
    return items.filter((it) => getLabel(it).toLowerCase().includes(needle));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, needle]);

  useEffect(() => { setHighlight(0); }, [needle, open]);

  const pick = (it: T) => {
    onChange(getValue(it));
    setQuery(getLabel(it));
    setOpen(false);
  };

  const revert = () => setQuery(selected ? getLabel(selected) : '');

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
          {filtered.map((it, i) => (
            <li
              key={getKey ? getKey(it) : getValue(it)} role="option" aria-selected={i === highlight}
              className={i === highlight ? 'active' : undefined}
              onMouseDown={(e) => { e.preventDefault(); pick(it); }}
              onMouseEnter={() => setHighlight(i)}
            >
              {getLabel(it)}
            </li>
          ))}
        </ul>
      ) : null}
      {open && needle && !filtered.length ? (
        <ul className="combobox-list"><li className="tiny combobox-empty">{emptyText}</li></ul>
      ) : null}
    </>
  );

  if (!label) {
    return <div className={`combobox${className ? ` ${className}` : ''}`} style={style}>{input}</div>;
  }

  return (
    <div className={`field combobox${className ? ` ${className}` : ''}`} style={style}>
      <label htmlFor={fieldId}>{label}{required ? <span className="req"> *</span> : null}</label>
      {input}
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}
