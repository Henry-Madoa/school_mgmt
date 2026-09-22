/*
 * A generic "field + operator + value" filter builder for list pages — the same
 * shape as the Workflow condition editor (app/admin/workflow-form.tsx,
 * WorkflowConditionOperator/CONDITION_OPERATORS), generalized from "admin-defined
 * approval routing" to "any user narrowing a list before exporting it."
 *
 * Each list's lib module exports its own FilterFieldDef[] registry (the allow-list
 * of columns that may ever be filtered on) and passes it, together with the
 * FilterCondition[] parsed off the URL, into buildFilterClause() — a condition
 * naming any field outside that registry is silently dropped, so a hand-edited
 * URL can never reach an arbitrary column.
 */
import type { WorkflowConditionOperator } from './types.ts';

export type FilterFieldType = 'text' | 'number' | 'date' | 'select';

export interface FilterFieldDef {
  key: string;
  label: string;
  type: FilterFieldType;
  /** The SQL column this condition applies to — defaults to `key`. */
  column?: string;
  /** True for a full timestamp column filtered by a date-only <input type=date> value —
   *  `=`/`!=`/`<=`/`BETWEEN`'s upper bound get an end-of-day boundary appended so a
   *  whole day still matches, instead of only ever matching exact midnight. */
  datetime?: boolean;
  /** Static enum values; left undefined for a DB-driven lookup the page fills in at request time. */
  options?: { value: string | number; label: string }[];
}

export interface FilterCondition {
  field: string;
  operator: WorkflowConditionOperator;
  value: string;
  /** BETWEEN's upper bound. */
  value2?: string;
}

/** Parses the `filters` query param back into conditions — [] on anything malformed
 *  rather than throwing, since it's user-editable URL state. */
export function parseFilters(raw: string | null | undefined): FilterCondition[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((c): c is FilterCondition => (
      c && typeof c === 'object' && typeof c.field === 'string' && typeof c.operator === 'string'
      && typeof c.value === 'string'
    ));
  } catch {
    return [];
  }
}

const endOfDay = (date: string): string => `${date}T23:59:59.999`;

/** Builds a parameterized "AND ..." clause plus its named params, ready to splice into an
 *  existing named-param query (lib/db.ts's `@name` style) alongside that query's own params. */
export function buildFilterClause(
  fields: FilterFieldDef[], conditions: FilterCondition[], paramPrefix = 'df',
): { clause: string; params: Record<string, unknown> } {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const parts: string[] = [];
  const params: Record<string, unknown> = {};

  conditions.forEach((c, i) => {
    const def = byKey.get(c.field);
    if (!def || c.value === '') return;
    const column = def.column ?? def.key;
    const cast = (v: string): string | number => (def.type === 'number' ? Number(v) : v);
    const upper = (v: string): string | number => (def.datetime ? endOfDay(v) : cast(v));

    const p1 = `${paramPrefix}${i}a`;
    switch (c.operator) {
      case '=':
        if (def.datetime) {
          parts.push(`${column} >= @${p1} AND ${column} <= @${paramPrefix}${i}z`);
          params[p1] = c.value;
          params[`${paramPrefix}${i}z`] = upper(c.value);
        } else {
          parts.push(`${column} = @${p1}`);
          params[p1] = cast(c.value);
        }
        break;
      case '!=':
        parts.push(`${column} != @${p1}`);
        params[p1] = cast(c.value);
        break;
      case '>':
        parts.push(`${column} > @${p1}`);
        params[p1] = cast(c.value);
        break;
      case '>=':
        parts.push(`${column} >= @${p1}`);
        params[p1] = cast(c.value);
        break;
      case '<':
        parts.push(`${column} < @${p1}`);
        params[p1] = cast(c.value);
        break;
      case '<=':
        parts.push(`${column} <= @${p1}`);
        params[p1] = upper(c.value);
        break;
      case 'BETWEEN': {
        if (c.value2 === undefined || c.value2 === '') break;
        const p2 = `${paramPrefix}${i}b`;
        parts.push(`${column} BETWEEN @${p1} AND @${p2}`);
        params[p1] = cast(c.value);
        params[p2] = upper(c.value2);
        break;
      }
      default:
        break;
    }
  });

  return { clause: parts.length ? `AND ${parts.join(' AND ')}` : '', params };
}
