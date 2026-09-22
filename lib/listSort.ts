/**
 * Click-a-column-header sorting for list pages — one `sort=field.dir` URL param,
 * paired with an allow-list of {key: column} per list so a client-supplied field
 * name can never reach the query as a raw SQL identifier (same defense-in-depth
 * as lib/listFilters.ts's buildFilterClause).
 */

export interface SortState {
  field: string;
  dir: 'asc' | 'desc';
}

export function parseSort(raw: string | null | undefined): SortState | null {
  if (!raw) return null;
  const [field, dir] = raw.split('.');
  if (!field) return null;
  return { field, dir: dir === 'desc' ? 'desc' : 'asc' };
}

export function encodeSort(field: string, dir: 'asc' | 'desc'): string {
  return `${field}.${dir}`;
}

/** A safe `ORDER BY ...` clause: `sort.field` must name a key in `columns` — anything else
 *  (including a hand-edited URL) falls back to `fallback` rather than touching the query. */
export function buildOrderClause(
  columns: Record<string, string>, sort: SortState | null, fallback: string,
): string {
  const column = sort && columns[sort.field];
  if (!column) return `ORDER BY ${fallback}`;
  return `ORDER BY ${column} ${sort.dir === 'desc' ? 'DESC' : 'ASC'}`;
}
