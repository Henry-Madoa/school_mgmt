import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { setDefaultResultOrder } from 'node:dns';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Actor } from './types.ts';

/*
 * Neon resolves to both IPv4 and IPv6 addresses. On networks where the IPv6
 * route is dead rather than simply refused (as seen in local dev on Windows),
 * every new connection races Node's default DNS order, loses tens of seconds
 * to the unreachable IPv6 candidates, and only then falls back to IPv4 —
 * surfacing as a spurious ETIMEDOUT on the first query of a request. Since
 * Neon is only ever reached over IPv4 here, skip the race entirely.
 */
setDefaultResultOrder('ipv4first');

/*
 * PostgreSQL access, over Prisma's raw interface.
 *
 * Prisma owns the schema and the migrations; the queries stay as SQL because
 * this is a reporting-heavy ledger and the aggregates are what the financial
 * test suite pins hardest. Two translations make the existing SQL portable:
 *
 *   - placeholders: `?` and `@named` become `$1..$n`
 *   - identity:     an INSERT gets `RETURNING id` so `lastInsertRowid` survives
 *
 * Next.js reloads server modules on edit, so the client hangs off globalThis to
 * avoid opening a new pool per reload.
 */

const globalForDb = globalThis as typeof globalThis & { __saccoPrisma?: PrismaClient; __saccoCompanyClients?: Map<string, PrismaClient> };

/*
 * Companies (lib/companies.ts): a company is a PostgreSQL schema holding its own copy of every
 * business table, while users, sessions, roles, permissions and profiles live only in "public".
 * The default company IS "public". Any other company gets its own client whose connections
 * start with search_path = <schema>, public — so every query in the application resolves the
 * business tables in the company's schema and the shared tables in public, with no SQL changed.
 * Those clients use the direct (non-pooled) endpoint: a transaction-mode pooler would not keep
 * a per-connection search_path.
 */
export const DEFAULT_SCHEMA = 'public';
export const COMPANY_COOKIE = 'school_company';
const SCHEMA_NAME = /^co_[a-z0-9_]{1,40}$/;

function directUrl(url: string): string {
  return process.env.DIRECT_DATABASE_URL ?? url.replace('-pooler.', '.');
}

function connect(schema: string = DEFAULT_SCHEMA): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set — the application cannot reach its database.');
  const company = schema !== DEFAULT_SCHEMA;
  if (company && !SCHEMA_NAME.test(schema)) throw new Error(`Invalid company schema ${schema}`);
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: company ? directUrl(url) : url,
      ...(company ? { options: `-c search_path=${schema},public` } : {}),
      // node-postgres otherwise waits indefinitely: a connection that goes
      // stale without a clean close (Neon's pooler reclaiming it, a laptop
      // sleeping through a network change) leaves a query hanging forever
      // instead of failing, wedging every request behind ensureSeeded().
      // DB_QUERY_TIMEOUT_MS lets a long-running script (the seed over a slow link) wait longer.
      query_timeout: Number(process.env.DB_QUERY_TIMEOUT_MS) || 30_000,
      statement_timeout: Number(process.env.DB_QUERY_TIMEOUT_MS) || 30_000,
      connectionTimeoutMillis: 10_000,
      keepAlive: true,
    }),
  });
}

const db: PrismaClient = globalForDb.__saccoPrisma ?? (globalForDb.__saccoPrisma = connect());
const companyClients = globalForDb.__saccoCompanyClients ?? (globalForDb.__saccoCompanyClients = new Map());

function clientFor(schema: string): PrismaClient {
  if (schema === DEFAULT_SCHEMA) return db;
  let c = companyClients.get(schema);
  if (!c) { c = connect(schema); companyClients.set(schema, c); }
  return c;
}

/** Forget a company's client (after the company is deleted). */
export async function dropCompanyClient(schema: string): Promise<void> {
  const c = companyClients.get(schema);
  if (!c) return;
  companyClients.delete(schema);
  await c.$disconnect().catch(() => undefined);
}

/**
 * Which company a call runs in: an explicit withCompany() scope (route handlers, jobs), else
 * the request's company cookie, else the default. The cookie is only honoured for a company
 * that exists — the registry is read straight from public and cached briefly.
 */
const companyStore = new AsyncLocalStorage<string>();
export function withCompany<T>(schema: string, fn: () => Promise<T>): Promise<T> {
  return companyStore.run(schema, fn);
}

interface CompanyRow { code: string; schema_name: string }
let registryCache: { at: number; rows: CompanyRow[] } | null = null;
export async function companyRegistry(): Promise<CompanyRow[]> {
  if (registryCache && Date.now() - registryCache.at < 15_000) return registryCache.rows;
  try {
    const rows = normalise<CompanyRow[]>(await db.$queryRawUnsafe('SELECT code, schema_name FROM public.company'));
    registryCache = { at: Date.now(), rows };
    return rows;
  } catch {
    // Before the companies migration has run there is only the default company.
    return [{ code: 'MAIN', schema_name: DEFAULT_SCHEMA }];
  }
}
export function invalidateCompanyRegistry(): void { registryCache = null; }

/** The company an administrator pinned the signed-in user to, by session token (cached briefly). */
const assignedCache = new Map<string, { at: number; code: string | null }>();
async function assignedCompanyCode(sessionToken: string): Promise<string | null> {
  const hit = assignedCache.get(sessionToken);
  if (hit && Date.now() - hit.at < 15_000) return hit.code;
  let code: string | null = null;
  try {
    const rows = normalise<{ company_code: string | null }[]>(await db.$queryRawUnsafe(
      // The table holds the token's SHA-256 (lib/auth.ts hashSessionToken); this module cannot import auth.ts (cycle).
      'SELECT u.company_code FROM public.session s JOIN public.app_user u ON u.id = s.user_id WHERE s.token = $1',
      createHash('sha256').update(sessionToken).digest('hex')));
    code = rows[0]?.company_code ?? null;
  } catch { /* before the migration — nobody is assigned */ }
  if (assignedCache.size > 5000) assignedCache.clear();
  assignedCache.set(sessionToken, { at: Date.now(), code });
  return code;
}
export function invalidateAssignedCompanies(): void { assignedCache.clear(); }

async function cookieSchema(): Promise<string | null> {
  try {
    const { cookies } = await import('next/headers');
    const store = await cookies();
    // A user pinned to a company by an administrator always works there, whatever the cookie says.
    const session = store.get('school_session')?.value;
    const assigned = session ? await assignedCompanyCode(session) : null;
    const code = assigned ?? store.get(COMPANY_COOKIE)?.value;
    if (!code) return null;
    const row = (await companyRegistry()).find((r) => r.code.toUpperCase() === code.toUpperCase());
    return row?.schema_name ?? null;
  } catch {
    return null; // outside a request (scripts, the job queue) — the default company
  }
}

export async function currentSchema(): Promise<string> {
  return companyStore.getStore() ?? (await cookieSchema()) ?? DEFAULT_SCHEMA;
}

/** The client for the current call: the open transaction if there is one, else the company's. */
type RawClient = Pick<PrismaClient, '$queryRawUnsafe' | '$executeRawUnsafe'>;
const txStore = new AsyncLocalStorage<RawClient>();
async function client(): Promise<RawClient> {
  return txStore.getStore() ?? clientFor(await currentSchema());
}

/* ------------------------------------------------------------- translation */

const NO_IDENTITY = /\binto\s+"?(session|sequence|member_application|member_edit_request|change_log_setup|account_opening_request|account_deactivation_request|account_activation_request|member_activation_request|member_readmission_request|standing_order|member_charging|collateral_application|collateral_register|collateral_release|loan_guarantor_change|member_exit|checkoff_batch|member_fixed_deposit|fosa_transaction|teller_transaction|member_lien|inter_account_transfer|bankers_cheque|cheque_deposit|economic_sector|no_series|no_series_setup|employee_edit_request|employee_contract_change|employee_exit|hr_leave_application|hr_leave_adjustment|hr_leave_recall|hr_leave_plan|share_trading_window|share_floating|imprest_request|imprest_purpose|petty_cash|staff_claim|requisition|loan_repayment|loan_moratorium|defaulter_notice|loan_recovery|loan_write_off|till_closing|gl_budget_name)"?\b/i;

/**
 * Rewrite the legacy `?` and `@named` placeholders into PostgreSQL's positional form.
 *
 * Both styles are in use: positional `?` with spread arguments, and `@named`
 * with a single object. A named parameter may appear more than once in one
 * statement and must reuse the same position.
 */
function bind(sql: string, args: unknown[]): { text: string; values: unknown[] } {
  const named = args.length === 1 && args[0] !== null
    && typeof args[0] === 'object' && !Array.isArray(args[0]);

  if (named) {
    const source = args[0] as Record<string, unknown>;
    const values: unknown[] = [];
    const seen = new Map<string, number>();
    const text = sql.replace(/@([a-zA-Z_][a-zA-Z0-9_]*)/g, (_m, key: string) => {
      let pos = seen.get(key);
      if (pos === undefined) {
        values.push(source[key] ?? null);
        pos = values.length;
        seen.set(key, pos);
      }
      return `$${pos}`;
    });
    return { text, values };
  }

  let i = 0;
  const text = sql.replace(/\?/g, () => `$${++i}`);
  return { text, values: args.map((v) => v ?? null) };
}

/**
 * Postgres hands back two numeric shapes this application does not want:
 *
 *   - `bigint` columns, and COUNT(), arrive as JavaScript BigInt
 *   - SUM()/AVG() over a bigint column are `numeric`, which the driver returns
 *     as a Decimal object — not a primitive
 *
 * Both must be flattened here. A Decimal that escapes this boundary reaches a
 * Server Component's props and React refuses to serialise it ("Only plain
 * objects can be passed to Client Components"), and `+` on one silently
 * concatenates instead of adding. Money is integer cents well inside 2^53, so
 * coercing to a plain number is lossless and lets the rest of the application
 * keep working in ordinary arithmetic.
 */
type DecimalLike = { toNumber: () => number };

const isDecimal = (v: unknown): v is DecimalLike =>
  typeof v === 'object' && v !== null && typeof (v as Partial<DecimalLike>).toNumber === 'function';

function scalar(v: unknown): unknown {
  if (typeof v === 'bigint') return Number(v);
  if (isDecimal(v)) return v.toNumber();
  return v;
}

function normalise<T>(rows: unknown): T {
  if (typeof rows === 'bigint' || isDecimal(rows)) return scalar(rows) as T;
  if (Array.isArray(rows)) return rows.map((r) => normalise(r)) as T;
  // Dates and Buffers are values, not row shapes — pass them through intact.
  if (rows && typeof rows === 'object' && !(rows instanceof Date) && !ArrayBuffer.isView(rows)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rows as Record<string, unknown>)) {
      out[k] = scalar(v);
    }
    return out as T;
  }
  return rows as T;
}

/* ----------------------------------------------------------------- queries */

export async function all<T>(sql: string, ...args: unknown[]): Promise<T[]> {
  const { text, values } = bind(sql, args);
  return normalise<T[]>(await (await client()).$queryRawUnsafe(text, ...values));
}

export async function one<T>(sql: string, ...args: unknown[]): Promise<T | undefined> {
  return (await all<T>(sql, ...args))[0];
}

/**
 * Whether `from` (e.g. `"member m"`) has any row matching `where`, ignoring search text and
 * dynamic filters entirely — this is what tells a genuinely empty list apart from a search or
 * filter that simply matched nothing, so a list page can grey out its filter controls only in
 * the former case instead of trapping a user who searched a non-empty list into zero results.
 * `where` takes this module's own `?`/`@name` placeholders, bound against `args` exactly like
 * `all`/`one` — never interpolate a caller-supplied value straight into it.
 */
export async function hasAnyRow(from: string, where?: string, ...args: unknown[]): Promise<boolean> {
  const row = await one<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM ${from} ${where ? `WHERE ${where}` : ''}) AS "exists"`,
    ...args,
  );
  return row?.exists ?? false;
}

export interface RunResult {
  changes: number;
  /** Named for continuity with the previous driver; it is the RETURNING id. */
  lastInsertRowid: number;
}

export async function run(sql: string, ...args: unknown[]): Promise<RunResult> {
  const isInsert = /^\s*insert\b/i.test(sql);
  const wantsId = isInsert && !/\breturning\b/i.test(sql) && !NO_IDENTITY.test(sql);
  const { text, values } = bind(wantsId ? `${sql} RETURNING id` : sql, args);

  // An INSERT with RETURNING is a query, not a command — $executeRaw discards
  // the row and would lose the new id.
  const c = await client();
  if (wantsId || /\breturning\b/i.test(sql)) {
    const rows = normalise<{ id?: number }[]>(await c.$queryRawUnsafe(text, ...values));
    return { changes: rows.length, lastInsertRowid: Number(rows[0]?.id ?? 0) };
  }
  const changes = await c.$executeRawUnsafe(text, ...values);
  return { changes, lastInsertRowid: 0 };
}

/**
 * Run `fn` atomically.
 *
 * PostgreSQL has no nested transactions, so a nested call joins the one already
 * open rather than starting a second — the semantics the services rely on when
 * openAccount() calls deposit(), or the seed wraps thousands of postings.
 *
 * The transaction client is threaded through AsyncLocalStorage so nested
 * services need no extra argument.
 */
export interface TxOptions {
  /** Milliseconds the transaction may run for. Defaults to two minutes, which covers every
   *  ordinary document posting; a whole-membership run (a dividend calculation over every
   *  savings account) is legitimately longer and passes its own. */
  timeout?: number;
}

let savepointSeq = 0;

export async function tx<T>(fn: () => Promise<T>, options: TxOptions = {}): Promise<T> {
  const outer = txStore.getStore();
  if (outer) {
    // Nested: a SAVEPOINT, so a failure inside this unit rolls back only its own writes and the
    // outer transaction stays usable — otherwise Postgres aborts the whole transaction on the
    // first SQL error and every later statement fails with 25P02. This is what lets a fee invoice
    // run (one nested tx per student) report one bad student and carry on, even inside the seed.
    const sp = `sp_${++savepointSeq}`;
    await outer.$executeRawUnsafe(`SAVEPOINT ${sp}`);
    try {
      const result = await fn();
      await outer.$executeRawUnsafe(`RELEASE SAVEPOINT ${sp}`);
      return result;
    } catch (err) {
      await outer.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${sp}`);
      throw err;
    }
  }
  const base = clientFor(await currentSchema());
  return base.$transaction(
    (client) => txStore.run(client as RawClient, fn),
    // The seed posts thousands of journals inside one transaction.
    { timeout: options.timeout ?? 120_000, maxWait: 15_000 },
  );
}

/* --------------------------------------------------------------- sequences */

/**
 * The next document number for `name`.
 *
 * Delegates to the No. Series engine (lib/noSeries.ts) — a Business-Central-style
 * series with a configurable Starting No./Date, Increment-by and Ending No. that
 * an admin manages from the Admin Centre. Any code not yet placed on a series
 * falls through to the legacy flat `sequence` counter, so numbering never breaks
 * mid-migration. Loaded lazily to keep this module free of a cycle.
 */
export async function nextSequence(name: string): Promise<string> {
  const { nextSequence: fromSeries } = await import('./noSeries.ts');
  return fromSeries(name);
}

/** N consecutive document numbers in one round trip — see noSeries.nextSequenceBatch(). */
export async function nextSequenceBatch(name: string, count: number): Promise<string[]> {
  const { nextSequenceBatch: fromSeries } = await import('./noSeries.ts');
  return fromSeries(name, count);
}

export async function audit(
  user: Actor | null | undefined,
  action: string,
  entity?: string | null,
  entityId?: string | number | bigint | null,
  detail?: unknown,
): Promise<void> {
  await run(
    `INSERT INTO audit_log (at, user_id, username, action, entity, entity_id, detail)
     VALUES (?,?,?,?,?,?,?)`,
    new Date().toISOString(),
    user ? user.id : null,
    user ? user.username : 'system',
    action,
    entity ?? null,
    entityId != null ? String(entityId) : null,
    typeof detail === 'string' ? detail : detail ? JSON.stringify(detail) : null,
  );
}
