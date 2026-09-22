'use client';

import { useMemo, useState, type ReactNode } from 'react';

export type SortDir = 'asc' | 'desc';
export interface SortState<K extends string> { key: K; dir: SortDir }

/**
 * Click-to-sort for a list table: `sort` is the current column and direction, `toggle(key)`
 * cycles a column asc → desc (a new column starts asc), and `rows` come back ordered. Strings
 * compare case-insensitively and numerically where they look like numbers ("10" after "9");
 * booleans put Yes before No on asc; null/undefined always sink to the bottom.
 */
export function useSortedRows<T, K extends string>(
  rows: T[],
  pick: (row: T, key: K) => string | number | boolean | null | undefined,
  initial: SortState<K>,
): { rows: T[]; sort: SortState<K>; toggle: (key: K) => void } {
  const [sort, setSort] = useState<SortState<K>>(initial);
  const sorted = useMemo(() => {
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = pick(a, sort.key); const vb = pick(b, sort.key);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'boolean' || typeof vb === 'boolean') return (Number(vb) - Number(va)) * dir;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return collator.compare(String(va), String(vb)) * dir;
    });
  }, [rows, pick, sort]);
  const toggle = (key: K) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));
  return { rows: sorted, sort, toggle };
}

/** A sortable column header — the whole cell is the button; the arrow shows the active direction. */
export function SortTh<K extends string>({ col, sort, onToggle, children, className }: {
  col: K; sort: SortState<K>; onToggle: (key: K) => void; children: ReactNode; className?: string;
}) {
  const active = sort.key === col;
  return (
    <th className={[className, 'th-sort', active ? 'is-sorted' : ''].filter(Boolean).join(' ')}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onToggle(col)}>
        <span>{children}</span>
        <span className="th-sort-arrow" aria-hidden="true">{active ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>
      </button>
    </th>
  );
}
