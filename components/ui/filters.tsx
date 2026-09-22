'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { parseDateFilterExpression, formatDateFilterExpression } from '@/lib/format';
import type { SelectOption } from './field';

/**
 * Writes a value into the URL query string, which is what the page reads to
 * filter server-side. Keeping the filter in the URL means a filtered list is
 * shareable and survives a refresh — the old in-module `let q` did not.
 */
export function useQueryWriter() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const write = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.replace(`${pathname}?${next}`, { scroll: false }));
  };

  /** Same as `write`, but for two or more keys at once — needed whenever a single field maps
   *  to more than one URL param (DateFilterExpressionInput's one box driving `from`+`asOf`), so
   *  the second key's update isn't silently lost to a stale base snapshot from the first. */
  const writeMany = (entries: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(entries)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    startTransition(() => router.replace(`${pathname}?${next}`, { scroll: false }));
  };

  return { write, writeMany, pending };
}

/** Debounced free-text filter bound to a query parameter. */
export function SearchInput({ paramName = 'q', placeholder, delay = 250, disabled }: {
  paramName?: string; placeholder?: string; delay?: number; disabled?: boolean;
}) {
  const params = useSearchParams();
  const { write } = useQueryWriter();
  const urlValue = params.get(paramName) ?? '';
  const [value, setValue] = useState(urlValue);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Adopt the URL's value when the user navigates (back button, tab switch).
  useEffect(() => { setValue(urlValue); }, [urlValue]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      aria-label={placeholder}
      disabled={disabled}
      onChange={(e) => {
        const next = e.target.value;
        setValue(next);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => write(paramName, next), delay);
      }}
    />
  );
}

/** Single date input bound to a query parameter, applied immediately on change —
 *  no debounce, unlike SearchInput, since a date picker isn't typed character by character. */
export function DateFilterInput({ paramName, label, placeholder, disabled }: {
  paramName: string; label: string; placeholder?: string; disabled?: boolean;
}) {
  const params = useSearchParams();
  const { write } = useQueryWriter();

  return (
    <input
      type="date"
      aria-label={label}
      placeholder={placeholder}
      value={params.get(paramName) ?? ''}
      disabled={disabled}
      onChange={(e) => write(paramName, e.target.value)}
    />
  );
}

/** One-line Business Central-style Date Filter — `01/01/26..31/12/26`, `..T` (up to today),
 *  `01/01/26..` (open end) — parsed into the same `from`/`to` query params a two-field date
 *  range already used, so every existing reader of those params (the report itself, its Excel
 *  export, a balance drill-down opened from it) needs no change at all; only how the *user*
 *  enters the range does. See lib/format.ts's parseDateFilterExpression for the syntax. */
export function DateFilterExpressionInput({ fromParam = 'from', toParam = 'asOf', placeholder, disabled }: {
  fromParam?: string; toParam?: string; placeholder?: string; disabled?: boolean;
}) {
  const params = useSearchParams();
  const { writeMany } = useQueryWriter();
  const urlValue = formatDateFilterExpression(params.get(fromParam), params.get(toParam));
  const [value, setValue] = useState(urlValue);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => { setValue(urlValue); }, [urlValue]);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      aria-label={placeholder || 'Date filter'}
      disabled={disabled}
      onChange={(e) => {
        const next = e.target.value;
        setValue(next);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          const { from, to } = parseDateFilterExpression(next);
          writeMany({ [fromParam]: from ?? '', [toParam]: to ?? '' });
        }, 400);
      }}
    />
  );
}

/** Select bound to a query parameter, applied on change. */
export function SelectFilter({ paramName, options, allLabel = 'All', label, disabled }: {
  paramName: string; options: SelectOption[]; allLabel?: string; label?: string; disabled?: boolean;
}) {
  const params = useSearchParams();
  const { write } = useQueryWriter();

  return (
    <select
      aria-label={label || allLabel}
      value={params.get(paramName) ?? ''}
      disabled={disabled}
      onChange={(e) => write(paramName, e.target.value)}
    >
      <option value="">{allLabel}</option>
      {options.map((o) => {
        const value = typeof o === 'object' && o !== null ? o.value : o;
        const text = typeof o === 'object' && o !== null ? o.label : o;
        return <option key={String(value)} value={value ?? ''}>{text}</option>;
      })}
    </select>
  );
}
