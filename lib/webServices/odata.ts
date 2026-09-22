/*
 * OData V4 — Business Central's /ODataV4 endpoint over the published web services:
 *
 *   GET    /ODataV4                                   service document
 *   GET    /ODataV4/$metadata                         EDMX (CSDL) for every published page/query/codeunit
 *   GET    /ODataV4/Students                          entity set — $filter $select $orderby $top $skip $count
 *   GET    /ODataV4/Students/$count
 *   GET    /ODataV4/Students('ADM01001')              one entity (also Students(No='ADM01001'), Students(12))
 *   POST   /ODataV4/Customers                         create (JSON body of fields)
 *   PATCH  /ODataV4/Customers('C00001')               update (If-Match: the @odata.etag, or *)
 *   DELETE /ODataV4/Customers('C00001')
 *   POST   /ODataV4/SchoolIntegration_GetFeeBalance   codeunit procedure as an unbound action
 *
 * A leading Company('Name') segment is accepted and ignored (one company here), as is ?company=.
 */
import {
  resolveService, resolvePublished, assertReadable, assertWritable, assertProcedure, readRows, readOne, createRow, modifyRow, deleteRow,
  coerceArgs, etagOf, fieldSql, toSqlValue, WsError, assertKeyAllows, type Condition, type ReadOptions,
} from './index.ts';

/** Codeunit procedures named like a lookup are reads for a read-only key; anything else writes. */
const READ_LIKE = /^(Get|Read|List|Find|Is|Has|Check|Calculate|Preview)/i;
import { keyField, type WsField, type WsPage, type WsQuery, type WsCodeunit, type WsType, type WsContext } from './objects.ts';
import type { SessionUser } from '../types.ts';

const NS = 'SchoolERP';
const edmType = (t: WsType | 'Json'): string => ({
  Code: 'Edm.String', Text: 'Edm.String', Integer: 'Edm.Int32', Decimal: 'Edm.Decimal', Money: 'Edm.Decimal',
  Boolean: 'Edm.Boolean', Date: 'Edm.Date', DateTime: 'Edm.DateTimeOffset', Json: 'Edm.String',
} as Record<string, string>)[t];

/* ------------------------------------------------------------------------------ $filter */

type Tok = { t: 'id' | 'str' | 'num' | 'op' | 'lp' | 'rp' | 'comma' | 'kw'; v: string };
const KEYWORDS = new Set(['eq', 'ne', 'gt', 'ge', 'lt', 'le', 'and', 'or', 'not', 'true', 'false', 'null']);

function tokenize(s: string): Tok[] {
  const out: Tok[] = []; let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(') { out.push({ t: 'lp', v: c }); i++; continue; }
    if (c === ')') { out.push({ t: 'rp', v: c }); i++; continue; }
    if (c === ',') { out.push({ t: 'comma', v: c }); i++; continue; }
    if (c === "'") {
      let j = i + 1; let v = '';
      while (j < s.length) { if (s[j] === "'") { if (s[j + 1] === "'") { v += "'"; j += 2; continue; } break; } v += s[j++]; }
      if (j >= s.length) throw new WsError(400, 'BadRequest', 'Unterminated string in $filter');
      out.push({ t: 'str', v }); i = j + 1; continue;
    }
    // Date / date-time literals are unquoted in OData V4 (2026-01-01, 2026-01-01T10:00:00Z) —
    // tried before plain numbers so the year is not read as one.
    const d = s.slice(i).match(/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[-+]\d{2}:\d{2})?)?/);
    if (d) { out.push({ t: 'str', v: d[0] }); i += d[0].length; continue; }
    const m = s.slice(i).match(/^-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/);
    if (m) { out.push({ t: 'num', v: m[0] }); i += m[0].length; continue; }
    const w = s.slice(i).match(/^[A-Za-z_][A-Za-z0-9_./]*/);
    if (w) { const lw = w[0].toLowerCase(); out.push({ t: KEYWORDS.has(lw) ? 'kw' : 'id', v: KEYWORDS.has(lw) ? lw : w[0] }); i += w[0].length; continue; }
    throw new WsError(400, 'BadRequest', `Unexpected character '${c}' in $filter`);
  }
  return out;
}

/** Recursive-descent parser: or → and → not → comparison / function / parenthesised. */
export function parseFilter(filter: string, fields: WsField[]): Condition {
  const toks = tokenize(filter); let p = 0;
  const peek = () => toks[p]; const next = () => toks[p++];
  const field = (name: string): WsField => {
    const f = fields.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!f) throw new WsError(400, 'BadRequest', `Unknown property ${name} in $filter`);
    return f;
  };
  const literal = (f: WsField): { sql: string; args: unknown[] } => {
    const t = next();
    if (!t) throw new WsError(400, 'BadRequest', 'Missing value in $filter');
    if (t.t === 'kw' && t.v === 'null') return { sql: 'NULL', args: [] };
    if (t.t === 'kw' && (t.v === 'true' || t.v === 'false')) return { sql: '?', args: [toSqlValue(f, t.v === 'true')] };
    if (t.t === 'str' || t.t === 'num') return { sql: '?', args: [toSqlValue(f, t.v)] };
    throw new WsError(400, 'BadRequest', `Unexpected ${t.v} in $filter`);
  };
  const primary = (): Condition => {
    const t = peek();
    if (!t) throw new WsError(400, 'BadRequest', 'Incomplete $filter');
    if (t.t === 'lp') { next(); const c = orExpr(); if (next()?.t !== 'rp') throw new WsError(400, 'BadRequest', 'Missing ) in $filter'); return c; }
    if (t.t === 'kw' && t.v === 'not') { next(); const c = primary(); return { sql: `NOT (${c.sql})`, args: c.args }; }
    if (t.t === 'id') {
      next();
      const fn = t.v.toLowerCase();
      if (['contains', 'startswith', 'endswith'].includes(fn) && peek()?.t === 'lp') {
        next(); const f = field(next().v); if (next()?.t !== 'comma') throw new WsError(400, 'BadRequest', `${fn} needs two arguments`);
        const s = next(); if (!s || s.t !== 'str') throw new WsError(400, 'BadRequest', `${fn} needs a string`); if (next()?.t !== 'rp') throw new WsError(400, 'BadRequest', 'Missing )');
        const esc = s.v.replace(/[%_\\]/g, (m) => `\\${m}`);
        const pat = fn === 'contains' ? `%${esc}%` : fn === 'startswith' ? `${esc}%` : `%${esc}`;
        return { sql: `CAST(${fieldSql(f)} AS TEXT) ILIKE ? ESCAPE '\\'`, args: [pat] };
      }
      const f = field(t.v);
      const op = next();
      if (!op || op.t !== 'kw' || !['eq', 'ne', 'gt', 'ge', 'lt', 'le'].includes(op.v)) throw new WsError(400, 'BadRequest', `Expected a comparison after ${t.v}`);
      const rhs = literal(f);
      if (rhs.sql === 'NULL') return { sql: `${fieldSql(f)} IS ${op.v === 'ne' ? 'NOT ' : ''}NULL`, args: [] };
      const sqlOp = { eq: '=', ne: '<>', gt: '>', ge: '>=', lt: '<', le: '<=' }[op.v]!;
      return { sql: `${fieldSql(f)} ${sqlOp} ${rhs.sql}`, args: rhs.args };
    }
    throw new WsError(400, 'BadRequest', `Unexpected ${t.v} in $filter`);
  };
  const andExpr = (): Condition => {
    let left = primary();
    while (peek()?.t === 'kw' && peek().v === 'and') { next(); const r = primary(); left = { sql: `(${left.sql}) AND (${r.sql})`, args: [...left.args, ...r.args] }; }
    return left;
  };
  const orExpr = (): Condition => {
    let left = andExpr();
    while (peek()?.t === 'kw' && peek().v === 'or') { next(); const r = andExpr(); left = { sql: `(${left.sql}) OR (${r.sql})`, args: [...left.args, ...r.args] }; }
    return left;
  };
  const c = orExpr();
  if (p < toks.length) throw new WsError(400, 'BadRequest', `Unexpected ${toks[p].v} in $filter`);
  return c;
}

function readOptions(o: WsPage | WsQuery, params: URLSearchParams): ReadOptions {
  const opts: ReadOptions = {};
  const filter = params.get('$filter'); if (filter) opts.where = [parseFilter(filter, o.fields)];
  const select = params.get('$select');
  if (select) {
    opts.select = select.split(',').map((s) => s.trim()).filter(Boolean).map((name) => {
      const f = o.fields.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (!f) throw new WsError(400, 'BadRequest', `Unknown property ${name} in $select`);
      return f;
    });
  }
  const orderby = params.get('$orderby');
  if (orderby) {
    opts.orderBy = orderby.split(',').map((part) => {
      const [name, dir] = part.trim().split(/\s+/);
      const f = o.fields.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (!f) throw new WsError(400, 'BadRequest', `Unknown property ${name} in $orderby`);
      return { field: f, desc: (dir ?? '').toLowerCase() === 'desc' };
    });
  }
  const top = params.get('$top'); if (top != null) { opts.top = Number(top); if (Number.isNaN(opts.top) || opts.top < 0) throw new WsError(400, 'BadRequest', '$top must be a non-negative integer'); }
  const skip = params.get('$skip'); if (skip != null) { opts.skip = Number(skip); if (Number.isNaN(opts.skip) || opts.skip < 0) throw new WsError(400, 'BadRequest', '$skip must be a non-negative integer'); }
  if (params.get('$count') === 'true') opts.count = true;
  // Server-side paging cap, as BC applies one (its default is 20,000; ours is 5,000).
  if (opts.top == null || opts.top > 5000) opts.top = 5000;
  return opts;
}

/* ------------------------------------------------------------------------------ $metadata */

const xml = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function metadataXml(): Promise<string> {
  const published = await resolvePublished();
  const types: string[] = []; const sets: string[] = []; const actions: string[] = []; const imports: string[] = [];
  for (const { service, object } of published) {
    if (object.kind === 'CODEUNIT') {
      for (const p of object.procedures) {
        const name = `${service.service_name}_${p.name}`;
        actions.push(`    <Action Name="${xml(name)}">\n${p.params.map((prm) => `      <Parameter Name="${xml(prm.name)}" Type="${edmType(prm.type)}" Nullable="${prm.required ? 'false' : 'true'}"/>`).join('\n')}${p.params.length ? '\n' : ''}      <ReturnType Type="${edmType(p.returns)}"/>\n    </Action>`);
        imports.push(`      <ActionImport Name="${xml(name)}" Action="${NS}.${xml(name)}"/>`);
      }
      continue;
    }
    const key = keyField(object);
    const typeName = service.service_name;
    types.push(`    <EntityType Name="${xml(typeName)}">\n      <Key><PropertyRef Name="${xml(key.name)}"/></Key>\n${object.fields.map((f) => `      <Property Name="${xml(f.name)}" Type="${edmType(f.type)}" Nullable="${f.key ? 'false' : 'true'}"${f.type === 'Money' || f.type === 'Decimal' ? ' Scale="Variable"' : ''}/>`).join('\n')}\n      <Annotation Term="Org.OData.Core.V1.Description" String="${xml(object.caption)} (${object.kind} ${object.id} ${xml(object.name)})"/>\n    </EntityType>`);
    sets.push(`      <EntitySet Name="${xml(service.service_name)}" EntityType="${NS}.${xml(typeName)}">\n        <Annotation Term="Org.OData.Capabilities.V1.InsertRestrictions"><Record><PropertyValue Property="Insertable" Bool="${object.kind === 'PAGE' && !!object.insert}"/></Record></Annotation>\n        <Annotation Term="Org.OData.Capabilities.V1.UpdateRestrictions"><Record><PropertyValue Property="Updatable" Bool="${object.kind === 'PAGE' && !!object.modify}"/></Record></Annotation>\n        <Annotation Term="Org.OData.Capabilities.V1.DeleteRestrictions"><Record><PropertyValue Property="Deletable" Bool="${object.kind === 'PAGE' && !!object.delete}"/></Record></Annotation>\n      </EntitySet>`);
  }
  return `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="${NS}" xmlns="http://docs.oasis-open.org/odata/ns/edm">
${types.join('\n')}
${actions.join('\n')}
    <EntityContainer Name="${NS}">
${sets.join('\n')}
${imports.join('\n')}
    </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`;
}

/* ------------------------------------------------------------------------------ dispatch */

export interface ODataResult { status: number; body?: unknown; headers?: Record<string, string>; serviceName?: string | null; operation?: string | null; raw?: string; contentType?: string }

const json = (status: number, body: unknown, extra: Partial<ODataResult> = {}): ODataResult => ({ status, body, ...extra });
export const odataError = (status: number, code: string, message: string): ODataResult => json(status, { error: { code, message } });

/** `Students('ADM01001')` / `Students(No='ADM01001')` / `Students(12)` → { set, key }. */
function parseSegment(seg: string): { set: string; key: string | null } {
  const m = seg.match(/^([A-Za-z_][A-Za-z0-9_]*)\((.*)\)$/);
  if (!m) return { set: seg, key: null };
  let k = m[2].trim();
  const named = k.match(/^[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.*)$/); if (named) k = named[1].trim();
  if (k.startsWith("'") && k.endsWith("'")) k = k.slice(1, -1).replace(/''/g, "'");
  return { set: m[1], key: decodeURIComponent(k) };
}

export async function handleOData(request: Request, segments: string[], user: SessionUser, baseUrl: string): Promise<ODataResult> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const segs = segments.filter(Boolean).map((s) => decodeURIComponent(s));
  // Company('X') / Company("X") prefix — one company here, so it is accepted and dropped.
  if (segs[0] && /^Company\(/i.test(segs[0])) segs.shift();

  if (!segs.length) {
    if (method !== 'GET') return odataError(405, 'MethodNotAllowed', 'Only GET on the service document');
    const published = await resolvePublished();
    return json(200, {
      '@odata.context': `${baseUrl}/$metadata`,
      value: published.filter((p) => p.object.kind !== 'CODEUNIT').map((p) => ({ name: p.service.service_name, kind: 'EntitySet', url: p.service.service_name })),
    }, { operation: 'ServiceDocument' });
  }
  if (segs[0] === '$metadata') {
    if (method !== 'GET') return odataError(405, 'MethodNotAllowed', 'Only GET on $metadata');
    return { status: 200, raw: await metadataXml(), contentType: 'application/xml; charset=utf-8', operation: '$metadata' };
  }

  const { set, key } = parseSegment(segs[0]);
  const wantCount = segs[1] === '$count';
  const ctx: WsContext = { user, actor: { id: user.id, username: user.username } };

  // Unbound action: ServiceName_Procedure (a published codeunit).
  const us = set.indexOf('_');
  if (us > 0 && method === 'POST' && !key) {
    const svcName = set.slice(0, us); const procName = set.slice(us + 1);
    const resolved = await resolveService(svcName);
    if (resolved && resolved.object.kind === 'CODEUNIT') {
      const cu = resolved.object as WsCodeunit;
      const proc = cu.procedures.find((p) => p.name.toLowerCase() === procName.toLowerCase());
      if (!proc) return odataError(404, 'NotFound', `Procedure ${procName} is not defined on ${svcName}`);
      assertKeyAllows(user, resolved.service.service_name, !READ_LIKE.test(proc.name));
      assertProcedure(user, proc);
      const body = await readJson(request);
      const args = coerceArgs(proc, body);
      const value = await proc.run(args, ctx);
      return json(200, { '@odata.context': `${baseUrl}/$metadata#${edmType(proc.returns)}`, value: value ?? null }, { serviceName: resolved.service.service_name, operation: proc.name });
    }
  }

  const resolved = await resolveService(set);
  if (!resolved) return odataError(404, 'NotFound', `Resource not found for the segment '${set}'.`);
  const { service, object } = resolved;
  if (object.kind === 'CODEUNIT') return odataError(400, 'BadRequest', `${service.service_name} is a codeunit — call its procedures with POST ${service.service_name}_<Procedure>`);
  assertKeyAllows(user, service.service_name, method !== 'GET');
  const o = object as WsPage | WsQuery;
  const base = { serviceName: service.service_name };
  const context = `${baseUrl}/$metadata#${service.service_name}`;

  if (method === 'GET') {
    assertReadable(user, o);
    if (key != null) {
      const opts = readOptions(o, url.searchParams);
      const row = await readOne(o, key, opts.select);
      if (!row) return odataError(404, 'NotFound', `${o.entityName} '${key}' not found`);
      return json(200, { '@odata.context': `${context}/$entity`, '@odata.etag': etagOf(row), ...row }, { ...base, operation: 'Read', headers: { ETag: etagOf(row) } });
    }
    if (wantCount) {
      const opts = readOptions(o, url.searchParams);
      const { count } = await readRows(o, { where: opts.where, top: 0, count: true });
      return { status: 200, raw: String(count ?? 0), contentType: 'text/plain', ...base, operation: '$count' };
    }
    const opts = readOptions(o, url.searchParams);
    const { rows, count } = await readRows(o, opts);
    const out: Record<string, unknown> = { '@odata.context': context };
    if (opts.count) out['@odata.count'] = count;
    out.value = rows.map((r) => ({ '@odata.etag': etagOf(r), ...r }));
    if (rows.length === opts.top) {
      const nextUrl = new URL(url.toString()); nextUrl.searchParams.set('$skip', String((opts.skip ?? 0) + opts.top!));
      out['@odata.nextLink'] = nextUrl.toString();
    }
    return json(200, out, { ...base, operation: 'ReadMultiple' });
  }

  if (o.kind !== 'PAGE') return odataError(405, 'MethodNotAllowed', 'Queries are read-only');
  const page = o as WsPage;

  if (method === 'POST') {
    if (key != null) return odataError(405, 'MethodNotAllowed', 'POST to the entity set, not to an entity');
    assertWritable(user, page, 'insert');
    const row = await createRow(page, await readJson(request), ctx);
    return json(201, { '@odata.context': `${context}/$entity`, '@odata.etag': etagOf(row), ...row }, { ...base, operation: 'Create', headers: { ETag: etagOf(row), Location: `${baseUrl}/${service.service_name}('${encodeURIComponent(String(row[keyField(o).name]))}')` } });
  }
  if (method === 'PATCH' || method === 'PUT') {
    if (key == null) return odataError(400, 'BadRequest', 'An entity key is required for PATCH');
    assertWritable(user, page, 'modify');
    const ifMatch = request.headers.get('if-match');
    if (ifMatch && ifMatch !== '*') {
      const cur = await readOne(page, key);
      if (!cur) return odataError(404, 'NotFound', `${o.entityName} '${key}' not found`);
      if (etagOf(cur) !== ifMatch.trim()) return odataError(412, 'PreconditionFailed', 'The record has been modified by another user — read it again and retry');
    }
    const row = await modifyRow(page, key, await readJson(request), ctx);
    return json(200, { '@odata.context': `${context}/$entity`, '@odata.etag': etagOf(row), ...row }, { ...base, operation: 'Update', headers: { ETag: etagOf(row) } });
  }
  if (method === 'DELETE') {
    if (key == null) return odataError(400, 'BadRequest', 'An entity key is required for DELETE');
    assertWritable(user, page, 'delete');
    await deleteRow(page, key, ctx);
    return { status: 204, ...base, operation: 'Delete' };
  }
  return odataError(405, 'MethodNotAllowed', `${method} is not supported`);
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
    return v as Record<string, unknown>;
  } catch {
    throw new WsError(400, 'BadRequest', 'The request body must be a JSON object');
  }
}
