/**
 * Hand-rolled RFC4180 CSV read/write — Configuration Packages' import/export
 * format. No dependency needed: quoting rules are the only real complexity,
 * and both directions fit in a screenful.
 */

function quoteCell(value: string | number | null): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const lines = [headers.map(quoteCell).join(',')];
  for (const row of rows) lines.push(row.map(quoteCell).join(','));
  return lines.join('\r\n');
}

/** Parses RFC4180 text (quoted fields, embedded commas/newlines, "" escapes) into rows of raw strings. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const source = text.replace(/^﻿/, ''); // strip a UTF-8 BOM if Excel added one

  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (inQuotes) {
      if (c === '"') {
        if (source[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}
