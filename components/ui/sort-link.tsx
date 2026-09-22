'use client';

import { useSearchParams } from 'next/navigation';
import { useQueryWriter } from './filters';

/**
 * A clickable table-header label that sorts the list by `sortKey` — click once for
 * ascending, again to reverse. State lives in one `sort=field.dir` URL param (like
 * `filters` and `q`), so it's shareable, survives a refresh, and composes with
 * whatever search/filter is already applied.
 */
export function SortLink({ sortKey, children, paramName = 'sort' }: {
  sortKey: string;
  children: React.ReactNode;
  paramName?: string;
}) {
  const params = useSearchParams();
  const { write } = useQueryWriter();
  const raw = params.get(paramName);
  const [activeField, activeDir] = raw ? raw.split('.') : [null, null];
  const isActive = activeField === sortKey;
  const nextDir = isActive && activeDir === 'asc' ? 'desc' : 'asc';

  return (
    <button
      type="button"
      className="sort-link"
      aria-label={`Sort by ${typeof children === 'string' ? children : sortKey}`}
      onClick={() => write(paramName, `${sortKey}.${nextDir}`)}
    >
      {children}
      {isActive ? <span className="arrow">{activeDir === 'desc' ? '▼' : '▲'}</span> : null}
    </button>
  );
}
