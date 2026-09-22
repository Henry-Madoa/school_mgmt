/*
 * Web Services — registrations (BC Page 810), Web Service Access Keys, the call log, and the
 * request-time pieces both protocols share: authentication, the published-service lookup, the
 * permission checks and the generic read/write engine over lib/webServices/objects.ts.
 */
import crypto from 'node:crypto';
import { one, all, run, audit } from '../db.ts';
import { AppError, translateDbError } from '../errors.ts';
import { sessionUserById } from '../auth.ts';
import { userFromToken, SESSION_COOKIE } from '../auth.ts';
import { canTable, canAction } from '../permissions.ts';
import { ALL_OBJECTS, findObject, keyField, type WsObject, type WsPage, type WsQuery, type WsField, type WsProcedure, type WsContext } from './objects.ts';
import type { Actor, SessionUser, WebService, WebServiceAccessKey, WebServiceAccessKeyView, WebServiceKeyScope, WebServiceKeyScopeKind, WebServiceLogEntry, WebServiceObjectType } from '../types.ts';

/* ------------------------------------------------------------------------- registrations */

export const listWebServices = (): Promise<WebService[]> =>
  all<WebService>('SELECT * FROM web_service ORDER BY object_type, service_name');

export const getWebService = (id: number): Promise<WebService | undefined> =>
  one<WebService>('SELECT * FROM web_service WHERE id = ?', id);

/** A published service by its URL name (case-insensitive, as BC treats service names). */
export const findPublishedService = (serviceName: string): Promise<WebService | undefined> =>
  one<WebService>('SELECT * FROM web_service WHERE LOWER(service_name) = LOWER(?) AND published = true', serviceName);

export const listPublishedServices = (): Promise<WebService[]> =>
  all<WebService>('SELECT * FROM web_service WHERE published = true ORDER BY object_type, service_name');

const SERVICE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;

export interface WebServiceInput { objectType: WebServiceObjectType; objectId: number; serviceName: string; published: boolean; description?: string | null }

export async function createWebService(input: WebServiceInput, user: Actor): Promise<{ id: number }> {
  const obj = findObject(input.objectType, Number(input.objectId));
  if (!obj) throw new AppError('Pick an object to publish', 'VALIDATION');
  const name = input.serviceName.trim();
  if (!SERVICE_NAME.test(name)) throw new AppError('Service Name must start with a letter and contain only letters, digits and underscores (max 80)', 'VALIDATION');
  if (await one('SELECT 1 FROM web_service WHERE LOWER(service_name) = LOWER(?)', name)) throw new AppError(`Service Name ${name} is already in use`, 'DUPLICATE');
  if (await one('SELECT 1 FROM web_service WHERE object_type = ? AND object_id = ?', obj.kind, obj.id)) throw new AppError(`${obj.name} is already registered — edit that entry instead`, 'DUPLICATE');
  const info = await run(
    'INSERT INTO web_service (object_type, object_id, object_name, service_name, published, description, created_at, created_by) VALUES (?,?,?,?,?,?,?,?)',
    obj.kind, obj.id, obj.name, name, !!input.published, input.description?.trim() || null, new Date().toISOString(), user.username,
  );
  const id = Number(info.lastInsertRowid);
  await audit(user, 'WEB_SERVICE_CREATE', 'web_service', id, { serviceName: name, object: `${obj.kind} ${obj.id}` });
  return { id };
}

export async function updateWebService(id: number, input: Pick<WebServiceInput, 'serviceName' | 'published' | 'description'>, user: Actor): Promise<void> {
  const cur = await getWebService(id);
  if (!cur) throw new AppError('Web service not found', 'NOT_FOUND');
  const name = input.serviceName.trim();
  if (!SERVICE_NAME.test(name)) throw new AppError('Service Name must start with a letter and contain only letters, digits and underscores (max 80)', 'VALIDATION');
  if (await one('SELECT 1 FROM web_service WHERE LOWER(service_name) = LOWER(?) AND id <> ?', name, id)) throw new AppError(`Service Name ${name} is already in use`, 'DUPLICATE');
  await run('UPDATE web_service SET service_name = ?, published = ?, description = ? WHERE id = ?', name, !!input.published, input.description?.trim() || null, id);
  await audit(user, 'WEB_SERVICE_UPDATE', 'web_service', id, { serviceName: name, published: !!input.published });
}

export async function setWebServicePublished(id: number, published: boolean, user: Actor): Promise<void> {
  const res = await run('UPDATE web_service SET published = ? WHERE id = ?', published, id);
  if (!res.changes) throw new AppError('Web service not found', 'NOT_FOUND');
  await audit(user, published ? 'WEB_SERVICE_PUBLISH' : 'WEB_SERVICE_UNPUBLISH', 'web_service', id, {});
}

export async function deleteWebService(id: number, user: Actor): Promise<void> {
  const cur = await getWebService(id);
  if (!cur) throw new AppError('Web service not found', 'NOT_FOUND');
  await run('DELETE FROM web_service WHERE id = ?', id);
  await audit(user, 'WEB_SERVICE_DELETE', 'web_service', id, { serviceName: cur.service_name });
}

/** Every object not yet registered — what the "New" form offers. */
export async function listUnregisteredObjects(): Promise<WsObject[]> {
  const taken = new Set((await listWebServices()).map((w) => `${w.object_type}:${w.object_id}`));
  return ALL_OBJECTS.filter((o) => !taken.has(`${o.kind}:${o.id}`));
}

/* ------------------------------------------------------------------------- access keys */

const hashKey = (key: string) => crypto.createHash('sha256').update(key).digest('hex');

export const listAccessKeys = (): Promise<WebServiceAccessKeyView[]> =>
  all<WebServiceAccessKeyView>(
    `SELECT k.*, u.username, u.full_name, u.status AS user_status FROM web_service_access_key k JOIN app_user u ON u.id = k.user_id
     ORDER BY k.revoked_at IS NOT NULL, u.username`,
  );

/**
 * Issue (or replace) a user's key — BC's "Change Web Service Key". The plain key is returned once
 * and never stored; only its hash and the last four characters are kept.
 */
export interface AccessKeyOptions {
  expiresAt?: string | null;
  scope?: WebServiceKeyScopeKind | null;
  /** Service names; empty/null = every published service. */
  services?: string[] | null;
  ratePerMinute?: number | null;
}

export async function generateAccessKey(userId: number, options: AccessKeyOptions, user: Actor): Promise<{ key: string; hint: string }> {
  const u = await one<{ id: number; username: string; status: string }>('SELECT id, username, status FROM app_user WHERE id = ?', userId);
  if (!u) throw new AppError('User not found', 'NOT_FOUND');
  if (u.status !== 'ACTIVE') throw new AppError('Only an active user can hold a web service key', 'VALIDATION');
  const expiresAt = options.expiresAt || null;
  if (expiresAt && Number.isNaN(Date.parse(expiresAt))) throw new AppError('Invalid expiry date', 'VALIDATION');
  const scope: WebServiceKeyScopeKind = options.scope === 'READ_ONLY' ? 'READ_ONLY' : 'READ_WRITE';
  const services = (options.services ?? []).map((s) => s.trim()).filter(Boolean);
  if (services.length) {
    const published = new Set((await listWebServices()).filter((s) => s.published).map((s) => s.service_name.toLowerCase()));
    const unknown = services.filter((s) => !published.has(s.toLowerCase()));
    if (unknown.length) throw new AppError(`Not a published service: ${unknown.join(', ')}`, 'VALIDATION');
  }
  const rate = options.ratePerMinute ? Math.max(1, Math.round(options.ratePerMinute)) : null;
  const key = crypto.randomBytes(32).toString('base64url');
  const now = new Date().toISOString();
  await run('UPDATE web_service_access_key SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', now, userId);
  await run(
    'INSERT INTO web_service_access_key (user_id, key_hash, key_hint, scope, services, rate_limit_per_minute, expires_at, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?)',
    userId, hashKey(key), key.slice(-4), scope, services.length ? services.join(',') : null, rate, expiresAt, now, user.username,
  );
  await audit(user, 'WEB_SERVICE_KEY_ISSUE', 'app_user', userId, { username: u.username, expiresAt, scope, services, rate });
  return { key, hint: key.slice(-4) };
}

/** The scope a key row grants, as the request handlers read it. */
export const keyScopeOf = (k: WebServiceAccessKey): WebServiceKeyScope => ({
  id: k.id,
  scope: k.scope === 'READ_ONLY' ? 'READ_ONLY' : 'READ_WRITE',
  services: k.services ? k.services.split(',').map((s) => s.trim()).filter(Boolean) : null,
  ratePerMinute: k.rate_limit_per_minute ?? null,
});

/**
 * What a key may do on top of the user's permissions: a READ_ONLY key never writes, and a key
 * limited to named services never touches another. A session (no key) passes through.
 */
export function assertKeyAllows(user: SessionUser, serviceName: string | null, write: boolean): void {
  const k = user.webServiceKey;
  if (!k) return;
  if (write && k.scope === 'READ_ONLY') throw new WsError(403, 'Forbidden', 'This access key is read-only');
  if (serviceName && k.services && !k.services.some((s) => s.toLowerCase() === serviceName.toLowerCase())) {
    throw new WsError(403, 'Forbidden', `This access key is not allowed to call ${serviceName}`);
  }
}

export async function revokeAccessKey(id: number, user: Actor): Promise<void> {
  const k = await one<WebServiceAccessKey>('SELECT * FROM web_service_access_key WHERE id = ?', id);
  if (!k) throw new AppError('Key not found', 'NOT_FOUND');
  if (k.revoked_at) return;
  await run('UPDATE web_service_access_key SET revoked_at = ? WHERE id = ?', new Date().toISOString(), id);
  await audit(user, 'WEB_SERVICE_KEY_REVOKE', 'app_user', k.user_id, { keyId: id });
}

/* ------------------------------------------------------------------------- authentication */

/**
 * Who is calling: HTTP Basic `username:accessKey` (BC's web service access key), or — so a user
 * can try an OData URL in the browser they are signed in to — the ordinary session cookie.
 * Returns null when neither identifies an active user.
 */
export async function authenticateRequest(request: Request): Promise<SessionUser | null> {
  const auth = request.headers.get('authorization') ?? '';
  if (/^basic\s+/i.test(auth)) {
    let decoded = '';
    try { decoded = Buffer.from(auth.replace(/^basic\s+/i, '').trim(), 'base64').toString('utf8'); } catch { return null; }
    const idx = decoded.indexOf(':');
    if (idx < 0) return null;
    const username = decoded.slice(0, idx).trim(); const key = decoded.slice(idx + 1);
    const u = await one<{ id: number }>('SELECT id FROM app_user WHERE LOWER(username) = LOWER(?)', username);
    if (!u) return null;
    const k = await one<WebServiceAccessKey>(
      'SELECT * FROM web_service_access_key WHERE user_id = ? AND key_hash = ? AND revoked_at IS NULL', u.id, hashKey(key),
    );
    if (!k) return null;
    if (k.expires_at && new Date(k.expires_at) < new Date()) return null;
    run('UPDATE web_service_access_key SET last_used_at = ? WHERE id = ?', new Date().toISOString(), k.id).catch(() => undefined);
    const su = await sessionUserById(u.id);
    return su ? { ...su, webServiceKey: keyScopeOf(k) } : null;
  }
  const cookie = request.headers.get('cookie') ?? '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  if (m) return userFromToken(decodeURIComponent(m[1]));
  return null;
}

export const actorOf = (user: SessionUser): Actor => ({ id: user.id, username: user.username });

/* ------------------------------------------------------------------------- log */

export interface LogInput {
  protocol: 'ODATA' | 'SOAP'; method: string; serviceName: string | null; operation: string | null; path: string;
  username: string | null; status: number; durationMs: number; ip: string | null; error: string | null;
}
export function logCall(l: LogInput): void {
  run(
    'INSERT INTO web_service_log (at, protocol, method, service_name, operation, path, username, status, duration_ms, ip, error) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    new Date().toISOString(), l.protocol, l.method, l.serviceName, l.operation, l.path.slice(0, 1000), l.username, l.status, Math.round(l.durationMs), l.ip, l.error?.slice(0, 1000) ?? null,
  ).catch(() => undefined);
}

export const listWebServiceLog = (limit = 300): Promise<WebServiceLogEntry[]> =>
  all<WebServiceLogEntry>('SELECT * FROM web_service_log ORDER BY id DESC LIMIT ?', limit);

export async function clearWebServiceLog(user: Actor): Promise<void> {
  await run('DELETE FROM web_service_log');
  await audit(user, 'WEB_SERVICE_LOG_CLEAR', 'web_service_log', 0, {});
}

/* ------------------------------------------------------------------------- resolved services */

export interface ResolvedService { service: WebService; object: WsObject }

/** A published service and its object, by URL name. */
export async function resolveService(serviceName: string): Promise<ResolvedService | null> {
  const service = await findPublishedService(serviceName);
  if (!service) return null;
  const object = findObject(service.object_type, service.object_id);
  return object ? { service, object } : null;
}

export async function resolvePublished(): Promise<ResolvedService[]> {
  return (await listPublishedServices())
    .map((service) => ({ service, object: findObject(service.object_type, service.object_id) }))
    .filter((r): r is ResolvedService => !!r.object);
}

export class WsError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) { super(message); this.name = 'WsError'; this.status = status; this.code = code; }
}

export function assertReadable(user: SessionUser, o: WsPage | WsQuery): void {
  for (const t of o.readTables) if (!canTable(user, t, 'read')) throw new WsError(403, 'Forbidden', `You do not have Read permission on ${t}`);
}
export function assertWritable(user: SessionUser, o: WsPage, right: 'insert' | 'modify' | 'delete'): void {
  const fn = right === 'insert' ? o.insert : right === 'modify' ? o.modify : o.delete;
  if (!fn) throw new WsError(405, 'MethodNotAllowed', `${o.caption} does not support ${right}`);
  if (o.writeTable && !canTable(user, o.writeTable, right)) throw new WsError(403, 'Forbidden', `You do not have ${right} permission on ${o.writeTable}`);
}
export function assertProcedure(user: SessionUser, p: WsProcedure): void {
  if (p.action && !canAction(user, p.action)) throw new WsError(403, 'Forbidden', `Procedure ${p.name} requires the ${p.action} permission`);
}

/* ------------------------------------------------------------------------- data engine */

/** One condition on a field — the protocol layers translate $filter / SOAP criteria to these. */
export interface Condition { sql: string; args: unknown[] }

export interface ReadOptions {
  where?: Condition[];
  orderBy?: { field: WsField; desc: boolean }[];
  top?: number;
  skip?: number;
  select?: WsField[];
  count?: boolean;
}

/** SQL expression for a field — a bare column is qualified with the FROM alias. */
export const fieldSql = (f: WsField): string => (/^[a-z_][a-z0-9_]*$/i.test(f.column) ? `t.${f.column}` : `(${f.column})`);

/** A literal from the wire, typed for the column it is compared to. Money comes in as a decimal
 *  and is compared in cents. */
export function toSqlValue(f: WsField, v: unknown): unknown {
  if (v == null) return null;
  switch (f.type) {
    case 'Money': return Math.round(Number(v) * 100);
    case 'Integer': return Math.trunc(Number(v));
    case 'Decimal': return Number(v);
    case 'Boolean': return v === true || v === 'true' || v === 1 || v === '1' ? 1 : 0;
    default: return String(v);
  }
}

/** A DB value as it goes out on the wire. */
export function fromDb(f: WsField, v: unknown): unknown {
  if (v == null) return null;
  switch (f.type) {
    case 'Money': return Number(v) / 100;
    case 'Integer': return Number(v);
    case 'Decimal': return Number(v);
    case 'Boolean': return v === true || Number(v) === 1;
    case 'Date': return String(v).slice(0, 10);
    case 'DateTime': return new Date(String(v)).toISOString();
    default: return String(v);
  }
}

export async function readRows(o: WsPage | WsQuery, opts: ReadOptions = {}): Promise<{ rows: Record<string, unknown>[]; count?: number }> {
  const fields = opts.select?.length ? Array.from(new Set([keyField(o), ...opts.select])) : o.fields;
  const cols = fields.map((f) => `${fieldSql(f)} AS "${f.name}"`).join(', ');
  const where = opts.where?.length ? ` WHERE ${opts.where.map((c) => `(${c.sql})`).join(' AND ')}` : '';
  const args = opts.where?.flatMap((c) => c.args) ?? [];
  const order = (opts.orderBy?.length ? opts.orderBy : [{ field: keyField(o), desc: false }])
    .map((ob) => `${fieldSql(ob.field)} ${ob.desc ? 'DESC' : 'ASC'}`).join(', ');
  const limit = opts.top != null ? ` LIMIT ${Math.max(0, Math.trunc(opts.top))}` : '';
  const offset = opts.skip ? ` OFFSET ${Math.max(0, Math.trunc(opts.skip))}` : '';
  const raw = await all<Record<string, unknown>>(`SELECT ${cols} FROM ${o.from}${where} ORDER BY ${order}${limit}${offset}`, ...args);
  const rows = raw.map((r) => Object.fromEntries(fields.map((f) => [f.name, fromDb(f, r[f.name])])));
  let count: number | undefined;
  if (opts.count) {
    const c = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM ${o.from}${where}`, ...args);
    count = Number(c?.n ?? 0);
  }
  return { rows, count };
}

export async function readOne(o: WsPage | WsQuery, key: string, select?: WsField[]): Promise<Record<string, unknown> | null> {
  const k = keyField(o);
  const { rows } = await readRows(o, { where: [{ sql: `${fieldSql(k)} = ?`, args: [toSqlValue(k, key)] }], top: 1, select });
  return rows[0] ?? null;
}

/** Weak ETag over the row's current values — what OData clients send back in If-Match. */
export const etagOf = (row: Record<string, unknown>): string => `W/"${crypto.createHash('sha1').update(JSON.stringify(row)).digest('base64url').slice(0, 27)}"`;

/** Only known, writable fields reach the object's hooks; the key is never in the body. */
export function pickWritable(o: WsPage, values: Record<string, unknown>, forInsert: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, v] of Object.entries(values)) {
    if (name.startsWith('@')) continue;
    const f = o.fields.find((x) => x.name === name);
    if (!f) throw new WsError(400, 'BadRequest', `Unknown field ${name}`);
    if (f.key) { if (forInsert) continue; else throw new WsError(400, 'BadRequest', `The key field ${name} cannot be changed`); }
    if (f.readOnly) throw new WsError(400, 'BadRequest', `Field ${name} is read-only`);
    out[name] = v;
  }
  if (forInsert) for (const f of o.fields) if (f.required && (out[f.name] == null || out[f.name] === '')) throw new WsError(400, 'BadRequest', `Field ${f.name} is required`);
  return out;
}

export async function createRow(o: WsPage, values: Record<string, unknown>, ctx: WsContext): Promise<Record<string, unknown>> {
  const key = await o.insert!(pickWritable(o, values, true), ctx);
  const row = await readOne(o, String(key));
  if (!row) throw new WsError(500, 'Internal', 'The record was created but could not be read back');
  return row;
}
export async function modifyRow(o: WsPage, key: string, values: Record<string, unknown>, ctx: WsContext): Promise<Record<string, unknown>> {
  if (!(await readOne(o, key))) throw new WsError(404, 'NotFound', `${o.entityName} ${key} not found`);
  await o.modify!(key, pickWritable(o, values, false), ctx);
  return (await readOne(o, key))!;
}
export async function deleteRow(o: WsPage, key: string, ctx: WsContext): Promise<void> {
  if (!(await readOne(o, key))) throw new WsError(404, 'NotFound', `${o.entityName} ${key} not found`);
  await o.delete!(key, ctx);
}

/** Coerce a procedure's arguments to their declared types; missing required ones are an error. */
export function coerceArgs(p: WsProcedure, raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lower = new Map(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v]));
  for (const prm of p.params) {
    const v = raw[prm.name] ?? lower.get(prm.name.toLowerCase());
    if (v == null || v === '') {
      if (prm.required) throw new WsError(400, 'BadRequest', `Parameter ${prm.name} is required`);
      continue;
    }
    switch (prm.type) {
      case 'Integer': out[prm.name] = Math.trunc(Number(v)); break;
      case 'Decimal': case 'Money': out[prm.name] = Number(v); break;
      case 'Boolean': out[prm.name] = v === true || v === 'true' || v === 1 || v === '1'; break;
      default: out[prm.name] = String(v);
    }
    if ((prm.type === 'Integer' || prm.type === 'Decimal' || prm.type === 'Money') && Number.isNaN(out[prm.name])) throw new WsError(400, 'BadRequest', `Parameter ${prm.name} must be a number`);
  }
  return out;
}

/** Turn an application error into the status the protocol layers report. */
export function statusOfError(e: unknown): { status: number; code: string; message: string } {
  if (e instanceof WsError) return { status: e.status, code: e.code, message: e.message };
  if (e instanceof AppError) {
    const status = e.code === 'NOT_FOUND' ? 404 : e.code === 'DUPLICATE' ? 409 : e.code === 'FORBIDDEN' ? 403 : 400;
    return { status, code: e.code, message: e.message };
  }
  const anyE = e as { name?: string; message?: string; code?: string };
  if (anyE?.name === 'PostingError') return { status: 400, code: anyE.code ?? 'PostingError', message: anyE.message ?? 'Posting failed' };
  // Integrity failures are a 409 the integrator can act on; anything else is logged (the
  // call log keeps the reference) and answered without the driver's text.
  const translated = translateDbError(e);
  if (translated) return { status: 409, code: translated.code, message: translated.message };
  const ref = Math.random().toString(36).slice(2, 10).toUpperCase();
  console.error(`[web-services] ${ref}`, e);
  return { status: 500, code: 'Internal', message: `Internal error (ref ${ref})` };
}
