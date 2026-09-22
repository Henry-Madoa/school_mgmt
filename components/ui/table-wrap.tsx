'use client';

import { Children, cloneElement, isValidElement, useMemo, useState, type ReactElement, type ReactNode } from 'react';

/*
 * TableWrap — every list table in the app, and every one of them sortable by clicking a column
 * header. The rows arrive already rendered (links, pills, money, buttons and all), so instead of
 * asking each screen to describe its columns, the wrapper reads a sort value straight out of
 * each cell's React tree: text, numbers (with thousands separators), formatted dates, a Money
 * component's cents, a Pill's status. Nothing about the page changes — the rows are simply
 * re-ordered, keeping their keys.
 *
 * Opt-outs: `sortable={false}` on the table, `data-nosort` on a header cell (an actions column
 * is skipped automatically when its header is empty) or on a row (a totals row stays at the
 * bottom; rows whose class mentions "total" are pinned too). Tables with grouped headers
 * (colSpan) or rows that are not plain <tr> elements are left in their natural order.
 */

type SortDir = 'asc' | 'desc';
type Primitive = string | number | boolean | null;

const DATE_RE = /^\d{1,2} [A-Za-z]{3} \d{4}(?: \d{2}:\d{2})?$/;
const NUM_RE = /^\(?-?[\d,]+(?:\.\d+)?\)?%?$/;

/** The sortable value of one cell — see the notes above on where it is read from. */
function cellValue(node: ReactNode): Primitive {
  const raw = collect(node);
  if (raw.number != null) return raw.number;
  const text = raw.text.replace(/\s+/g, ' ').trim();
  if (!text || text === '—' || text === '-') return null;
  if (NUM_RE.test(text)) {
    const n = Number(text.replace(/[(),%]/g, '')) * (text.startsWith('(') ? -1 : 1);
    if (Number.isFinite(n)) return n;
  }
  if (DATE_RE.test(text)) {
    const t = Date.parse(text);
    if (!Number.isNaN(t)) return t;
  }
  return text;
}

function collect(node: ReactNode): { text: string; number: number | null } {
  if (node == null || typeof node === 'boolean') return { text: '', number: null };
  if (typeof node === 'string' || typeof node === 'number') return { text: String(node), number: null };
  if (Array.isArray(node)) {
    const parts = node.map(collect);
    const num = parts.find((p) => p.number != null)?.number ?? null;
    return { text: parts.map((p) => p.text).join(' '), number: num };
  }
  if (isValidElement(node)) {
    const props = node.props as Record<string, unknown>;
    if (props['data-sort'] != null) {
      const v = props['data-sort'];
      return typeof v === 'number' ? { text: '', number: v } : { text: String(v), number: null };
    }
    // <Money cents={…}> and friends: the amount itself, not its formatting.
    if (typeof props.cents === 'number' || typeof props.cents === 'bigint') return { text: '', number: Number(props.cents) };
    if (typeof props.value === 'number' && props.children == null) return { text: '', number: props.value };
    if (props.children != null) return collect(props.children as ReactNode);
    // <Pill status="…"> with no children shows the status.
    if (typeof props.status === 'string') return { text: props.status, number: null };
    if (typeof props.value === 'string') return { text: props.value, number: null };
    return { text: '', number: null };
  }
  return { text: '', number: null };
}

type Row = ReactElement<Record<string, unknown>>;

/** Rows re-ordered by column `col`: pinned rows (totals, data-nosort, spanning cells) keep to
 *  the bottom in their own order; blanks sink; ties keep their original order. */
export function orderRows(rows: Row[], col: number, dir: SortDir): Row[] {
  const pinned = (r: Row) => {
    if (r.props['data-nosort'] != null || hasClass(r.props, 'total') || hasClass(r.props, 'subtotal')) return true;
    const cells = Children.toArray(r.props.children as ReactNode);
    return cells.some((c) => isValidElement(c) && Number((c.props as Record<string, unknown>).colSpan ?? 1) > 1);
  };
  const valueAt = (r: Row): Primitive => {
    const cells = Children.toArray(r.props.children as ReactNode).filter((c) => isTag(c, 'td') || isTag(c, 'th')) as Row[];
    const cell = cells[col];
    return cell ? cellValue(cell.props.children as ReactNode) : null;
  };
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const sign = dir === 'asc' ? 1 : -1;
  const data = rows.filter((r) => !pinned(r)).map((r, i) => ({ r, i, v: valueAt(r) }));
  data.sort((a, b) => {
    if (a.v == null && b.v == null) return a.i - b.i;
    if (a.v == null) return 1;
    if (b.v == null) return -1;
    let c: number;
    if (typeof a.v === 'number' && typeof b.v === 'number') c = a.v - b.v;
    else if (typeof a.v === 'boolean' && typeof b.v === 'boolean') c = Number(b.v) - Number(a.v);
    else c = collator.compare(String(a.v), String(b.v));
    return c === 0 ? a.i - b.i : c * sign;
  });
  return [...data.map((d) => d.r), ...rows.filter(pinned)];
}

const isTag = (n: ReactNode, tag: string): n is ReactElement<Record<string, unknown>> => isValidElement(n) && n.type === tag;
const hasClass = (props: Record<string, unknown>, word: string) => typeof props.className === 'string' && new RegExp(`\\b${word}\\b`, 'i').test(props.className);

export function TableWrap({ children, className = '', sortable = true }: { children: ReactNode; className?: string; sortable?: boolean }) {
  const [sort, setSort] = useState<{ col: number; dir: SortDir } | null>(null);

  const body = useMemo(() => {
    if (!sortable) return null;
    // Find the <thead> and the <tbody>; anything else (a <tfoot>, a caption) is kept as is.
    const kids = Children.toArray(children);
    const thead = kids.find((k) => isTag(k, 'thead'));
    const tbody = kids.find((k) => isTag(k, 'tbody'));
    if (!thead || !tbody) return null;
    const headRows = Children.toArray(thead.props.children as ReactNode).filter((r) => isTag(r, 'tr'));
    if (headRows.length !== 1) return null;
    const headRow = headRows[0] as ReactElement<Record<string, unknown>>;
    const ths = Children.toArray(headRow.props.children as ReactNode);
    if (!ths.every((t) => isTag(t, 'th')) || ths.some((t) => Number((t as ReactElement<Record<string, unknown>>).props.colSpan ?? 1) > 1)) return null;
    if (ths.some((t) => hasClass((t as ReactElement<Record<string, unknown>>).props, 'th-sort'))) return null;
    const rows = Children.toArray(tbody.props.children as ReactNode);
    if (!rows.every((r) => isTag(r, 'tr'))) return null;
    return { kids, thead, tbody, headRow, ths: ths as ReactElement<Record<string, unknown>>[], rows: rows as ReactElement<Record<string, unknown>>[] };
  }, [children, sortable]);

  if (!body) return <div className={`table-wrap ${className}`}><table>{children}</table></div>;

  const { kids, thead, tbody, headRow, ths, rows } = body;
  // A header that is itself a control (a select-all checkbox, a button) is not a sort handle.
  const interactive = (n: ReactNode): boolean => {
    if (Array.isArray(n)) return n.some(interactive);
    if (!isValidElement(n)) return false;
    if (typeof n.type === 'string' && ['input', 'button', 'select', 'label', 'a'].includes(n.type)) return true;
    if (typeof n.type !== 'string') return true;
    return interactive((n.props as Record<string, unknown>).children as ReactNode);
  };
  const sortableCol = (th: ReactElement<Record<string, unknown>>) =>
    th.props['data-nosort'] == null && !interactive(th.props.children as ReactNode) && collect(th.props.children as ReactNode).text.trim() !== '';

  const toggle = (col: number) => setSort((s) => (s && s.col === col ? (s.dir === 'asc' ? { col, dir: 'desc' } : null) : { col, dir: 'asc' }));

  const head = cloneElement(thead, undefined, cloneElement(headRow, undefined, ths.map((th, i) => {
    if (!sortableCol(th)) return th;
    const active = sort?.col === i;
    const cls = [typeof th.props.className === 'string' ? th.props.className : '', 'th-sort', active ? 'is-sorted' : ''].filter(Boolean).join(' ');
    return cloneElement(th, {
      className: cls,
      'aria-sort': active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none',
      title: active ? (sort!.dir === 'asc' ? 'Sorted ascending — click for descending' : 'Sorted descending — click to clear') : 'Click to sort',
    }, (
      <button type="button" onClick={() => toggle(i)}>
        <span>{th.props.children as ReactNode}</span>
        <span className="th-sort-arrow" aria-hidden="true">{active ? (sort!.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>
      </button>
    ));
  })));

  const ordered = sort ? orderRows(rows, sort.col, sort.dir) : rows;
  const tail = kids.filter((k) => k !== thead && k !== tbody);

  return (
    <div className={`table-wrap ${className}`}>
      <table>
        {head}
        {cloneElement(tbody, undefined, ordered)}
        {tail}
      </table>
    </div>
  );
}
