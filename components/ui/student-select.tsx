'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Student } from '@/lib/types';

export type StudentSelectOption = Pick<Student, 'id' | 'admission_no' | 'first_name' | 'last_name'>;

const labelFor = (m: StudentSelectOption): string => `${m.admission_no} — ${m.first_name} ${m.last_name}`;

/**
 * A searchable Student picker — a text input that filters the student list by number or name as
 * you type, backed by a hidden `name`-field input so it drops into readForm()'s FormData-based
 * forms exactly like a native <select>. Built instead of a plain <select> because a school roll
 * runs to hundreds of rows: scrolling a native dropdown to find one by eye doesn't scale, and
 * (unlike a <select>) nothing here defaults to the first row in the list — the field opens empty
 * until the user actually picks someone.
 */
export function StudentSelect({
  id, name, label = 'Student', students, value, onChange, required, disabled, placeholder = 'Search admission no. or name…',
}: {
  id: string;
  name: string;
  label?: string;
  students: StudentSelectOption[];
  value: string;
  onChange: (studentId: string) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const selected = students.find((m) => String(m.id) === value) ?? null;
  const [query, setQuery] = useState(selected ? labelFor(selected) : '');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keeps the visible text in sync whenever the selected id changes from outside this
  // component (e.g. Edit forms initialising `value` from an existing record).
  useEffect(() => {
    const m = students.find((mm) => String(mm.id) === value) ?? null;
    setQuery(m ? labelFor(m) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const needle = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!needle) return students;
    return students.filter((m) => labelFor(m).toLowerCase().includes(needle));
  }, [students, needle]);

  useEffect(() => { setHighlight(0); }, [needle, open]);

  const pick = (m: StudentSelectOption) => {
    onChange(String(m.id));
    setQuery(labelFor(m));
    setOpen(false);
  };

  const revert = () => setQuery(selected ? labelFor(selected) : '');

  return (
    <div className="field combobox">
      <label htmlFor={id}>{label}{required ? <span className="req"> *</span> : null}</label>
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
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
      <input type="hidden" name={name} value={value} />
      {open && filtered.length ? (
        <ul className="combobox-list" role="listbox">
          {filtered.map((m, i) => (
            <li
              key={m.id} role="option" aria-selected={i === highlight}
              className={i === highlight ? 'active' : undefined}
              onMouseDown={(e) => { e.preventDefault(); pick(m); }}
              onMouseEnter={() => setHighlight(i)}
            >
              {labelFor(m)}
            </li>
          ))}
        </ul>
      ) : null}
      {open && needle && !filtered.length ? (
        <ul className="combobox-list"><li className="tiny combobox-empty">No matching students</li></ul>
      ) : null}
    </div>
  );
}
