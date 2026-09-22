/*
 * Companies — the Companies list with Copy Company and Delete Company, for testing on a full
 * copy of the live data without touching it.
 *
 * A company is a PostgreSQL schema. The default company is "public" (the live data). Copying
 * creates schema co_<code> and, for every business table in public: the table (columns,
 * defaults, check constraints, indexes, identity), its own sequences, the data, and finally the
 * foreign keys — all in one transaction, so a failed copy leaves nothing behind. Users, sessions,
 * roles, permissions and profiles are tenant-level (shared) and are never copied: with the
 * company's search_path = co_x, public those tables resolve to public.
 *
 * The copy runs over a direct (non-pooled) connection because it is DDL-heavy and long.
 */
import { Client } from 'pg';
import { one, all, run, audit, invalidateCompanyRegistry, dropCompanyClient, DEFAULT_SCHEMA } from './db.ts';
import { AppError } from './errors.ts';
import type { Actor, Company } from './types.ts';

/** Shared across companies — kept in public only. */
export const TENANT_TABLES = new Set([
  'app_user', 'session', 'role', 'permission_set_line', 'user_permission_line', 'user_permission_set',
  'profile', 'user_profile', 'company', '_prisma_migrations',
]);

/**
 * Business data as opposed to setup: what "Setup data only" leaves out. A table is transactional
 * when it holds members, customers, vendors, employees, assets, items or anything posted, issued
 * or requested about them; everything else (products, charts, series, posting groups, workflows,
 * HR/payroll rules, dimensions, setups) is setup and carries over into a production company.
 */
const TRANSACTION_PREFIXES = [
  'member', 'savings_account', 'loan', 'txn', 'journal', 'account_', 'collateral_application', 'collateral_register', 'collateral_release',
  'checkoff', 'cheque_deposit', 'bankers_cheque', 'fosa_transaction', 'inter_account_transfer', 'teller_transaction', 'cash_denomination_line',
  'standing_order', 'share_', 'dividend', 'customer', 'cust_ledger', 'detailed_cust', 'sales_header', 'sales_line', 'posted_', 'reminder_header', 'reminder_line',
  'vendor', 'purchase_header', 'purchase_line', 'receipt_header', 'receipt_line', 'payment_voucher', 'bank_account_ledger', 'bank_rec', 'vat_entry', 'wht_certificate',
  'item', 'stockkeeping', 'fixed_asset', 'fa_depreciation_book', 'fa_journal', 'fa_ledger', 'requisition', 'imprest_request', 'petty_cash', 'staff_claim', 'employee',
  'hr_leave_application', 'hr_leave_adjustment', 'hr_leave_plan', 'hr_leave_recall', 'hr_leave_ledger', 'payroll_period', 'payroll_p9', 'company_job',
  'audit_log', 'change_log_entry', 'notification', 'attachment', 'web_service_log', 'workflow_task',
];
const TRANSACTION_EXCEPTIONS = new Set([
  // Setup that happens to share a prefix with business data.
  'member_category', 'member_category_default_account', 'loan_product', 'loan_product_charge', 'loan_product_charge_scheme',
  'customer_posting_group', 'vendor_posting_group', 'item_unit_of_measure', 'dividend_param', 'account_instruction', 'fa_class', 'fa_subclass',
]);
export const isTransactionTable = (t: string): boolean =>
  !TRANSACTION_EXCEPTIONS.has(t) && TRANSACTION_PREFIXES.some((p) => t === p || t.startsWith(p));

/** BC's company creation choices: everything, setup only (production), or an empty company. */
export type CompanyDataOption = 'FULL' | 'SETUP' | 'EMPTY';

const CODE = /^[A-Z][A-Z0-9_]{1,15}$/;
const schemaFor = (code: string) => `co_${code.toLowerCase()}`;
const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

export const listCompanies = (): Promise<Company[]> =>
  all<Company>('SELECT * FROM public.company ORDER BY is_default DESC, code');

export const getCompany = (code: string): Promise<Company | undefined> =>
  one<Company>('SELECT * FROM public.company WHERE UPPER(code) = UPPER(?)', code);

export async function defaultCompany(): Promise<Company> {
  const c = await one<Company>('SELECT * FROM public.company WHERE is_default LIMIT 1');
  if (!c) throw new AppError('No default company is registered', 'NOT_FOUND');
  return c;
}

/** Size and a few headline counts of a company's data, for the list. */
export async function companyStats(c: Company): Promise<{ sizeBytes: number; tables: number; members: number; loans: number; journals: number }> {
  const s = await one<{ size: number; tables: number }>(
    `SELECT COALESCE(SUM(pg_total_relation_size(quote_ident(table_schema) || '.' || quote_ident(table_name))), 0) AS size, COUNT(*) AS tables
     FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE'`, c.schema_name);
  const n = async (t: string) => Number((await one<{ n: number }>(`SELECT COUNT(*) AS n FROM ${q(c.schema_name)}.${q(t)}`))?.n ?? 0);
  return { sizeBytes: Number(s?.size ?? 0), tables: Number(s?.tables ?? 0), members: await n('member'), loans: await n('loan'), journals: await n('journal') };
}

function directConnectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new AppError('DATABASE_URL is not set', 'CONFIG');
  return process.env.DIRECT_DATABASE_URL ?? url.replace('-pooler.', '.');
}

export interface CopyCompanyInput {
  sourceCode: string;
  newCode: string;
  displayName: string;
  /** FULL: everything (a test copy). SETUP: setup and reference data only, balances and
   *  numbering reset — the way to prepare a production company. EMPTY: structure only. */
  dataOption?: CompanyDataOption;
  /** Rename the organisation inside the copy so screens and printouts show the company's name. */
  renameOrganisation?: boolean;
}

export interface CopyCompanyResult { code: string; schema: string; tables: number; rows: number; ms: number }

/**
 * New company from `sourceCode`: the structure of every business table, then — per data option —
 * all of its data (Copy Company), only its setup, or nothing.
 */
export async function copyCompany(input: CopyCompanyInput, user: Actor): Promise<CopyCompanyResult> {
  const code = input.newCode.trim().toUpperCase();
  if (!CODE.test(code)) throw new AppError('Company code must be 2–16 characters: letters, digits and underscores, starting with a letter', 'VALIDATION');
  const displayName = input.displayName.trim();
  if (!displayName) throw new AppError('Display name is required', 'VALIDATION');
  if (await getCompany(code)) throw new AppError(`Company ${code} already exists`, 'DUPLICATE');
  const source = await getCompany(input.sourceCode);
  if (!source) throw new AppError(`Source company ${input.sourceCode} not found`, 'NOT_FOUND');
  const src = source.schema_name; const dst = schemaFor(code);
  const dataOption: CompanyDataOption = input.dataOption ?? 'FULL';
  const started = Date.now();

  const pg = new Client({ connectionString: directConnectionString(), statement_timeout: 0, query_timeout: 0 });
  await pg.connect();
  let tables = 0; let rows = 0;
  try {
    await pg.query('BEGIN');
    await pg.query(`CREATE SCHEMA ${q(dst)}`);

    const tableRows = await pg.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name`, [src]);
    const names = tableRows.rows.map((r) => r.table_name).filter((t) => !TENANT_TABLES.has(t));

    // Each step is a few round trips of many statements: the database is remote and a copy is
    // some 1,500 statements — one at a time that takes minutes, batched it takes seconds.
    const batch = async (statements: string[]) => {
      for (let i = 0; i < statements.length; i += 200) await pg.query(statements.slice(i, i + 200).join(';\n'));
    };
    const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;

    // 1. Tables — structure with defaults, check constraints, indexes (incl. PK/unique) and identity columns.
    await batch(names.map((t) => `CREATE TABLE ${q(dst)}.${q(t)} (LIKE ${q(src)}.${q(t)} INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES INCLUDING IDENTITY INCLUDING GENERATED)`));
    tables = names.length;

    // 2. Sequences — a serial column's default still points at the source schema's sequence, which
    //    the copy must not share. Give each such column its own sequence in the new schema.
    const serials = await pg.query<{ table_name: string; column_name: string; column_default: string }>(
      `SELECT table_name, column_name, column_default FROM information_schema.columns
       WHERE table_schema = $1 AND column_default LIKE 'nextval(%'`, [src]);
    const seqStatements: string[] = [];
    for (const r of serials.rows) {
      if (TENANT_TABLES.has(r.table_name)) continue;
      const m = r.column_default.match(/nextval\('(?:[^.']+\.)?"?([^"']+)"?'::regclass\)/);
      if (!m) continue;
      const seq = m[1];
      seqStatements.push(
        `CREATE SEQUENCE IF NOT EXISTS ${q(dst)}.${q(seq)}`,
        `ALTER TABLE ${q(dst)}.${q(r.table_name)} ALTER COLUMN ${q(r.column_name)} SET DEFAULT nextval(${lit(`${q(dst)}.${q(seq)}`)}::regclass)`,
        `ALTER SEQUENCE ${q(dst)}.${q(seq)} OWNED BY ${q(dst)}.${q(r.table_name)}.${q(r.column_name)}`,
      );
    }
    await batch(seqStatements);

    // 3. Data — the row counts come from the source in the same round trip. Setup-only skips the
    //    business tables; an empty company gets just the organisation record and its theme
    //    (the application needs an organisation row to open a company at all).
    let dataTables = dataOption === 'FULL' ? names
      : dataOption === 'SETUP' ? names.filter((t) => !isTransactionTable(t))
        : names.filter((t) => t === 'organisation' || t === 'theme');
    if (dataOption === 'SETUP') {
      // Setup rows must not point at business rows that are not coming across: a table with a
      // foreign key to an excluded table is excluded too, until the set is closed.
      const refs = await pg.query<{ child: string; parent: string }>(
        `SELECT c.relname AS child, p.relname AS parent FROM pg_constraint k
         JOIN pg_class c ON c.oid = k.conrelid JOIN pg_class p ON p.oid = k.confrelid JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE k.contype = 'f' AND n.nspname = $1 AND c.relname <> p.relname`, [src]);
      const keep = new Set(dataTables);
      let changed = true;
      while (changed) {
        changed = false;
        for (const r of refs.rows) {
          if (keep.has(r.child) && !keep.has(r.parent) && !TENANT_TABLES.has(r.parent)) { keep.delete(r.child); changed = true; }
        }
      }
      dataTables = names.filter((t) => keep.has(t));
    }
    for (let i = 0; i < dataTables.length; i += 50) {
      const chunk = dataTables.slice(i, i + 50);
      const counts = await pg.query<{ n: string }>(chunk.map((t) => `SELECT COUNT(*)::text AS n FROM ${q(src)}.${q(t)}`).join(' UNION ALL '));
      await pg.query(chunk.map((t) => `INSERT INTO ${q(dst)}.${q(t)} SELECT * FROM ${q(src)}.${q(t)}`).join(';\n'));
      rows += counts.rows.reduce((s, r) => s + Number(r.n), 0);
    }

    // 3b. Rows that came across but point at tables that did not (an empty company's
    //     organisation record names G/L accounts and charges): those references are cleared so
    //     the company opens, and the administrator sets them up again.
    if (dataOption !== 'FULL') {
      const included = new Set(dataTables);
      const dangling = await pg.query<{ child: string; parent: string; column: string }>(
        `SELECT c.relname AS child, p.relname AS parent, a.attname AS column FROM pg_constraint k
         JOIN pg_class c ON c.oid = k.conrelid JOIN pg_class p ON p.oid = k.confrelid JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY (k.conkey)
         WHERE k.contype = 'f' AND n.nspname = $1 AND array_length(k.conkey, 1) = 1`, [src]);
      await batch(dangling.rows
        .filter((r) => included.has(r.child) && !included.has(r.parent) && !TENANT_TABLES.has(r.parent))
        .map((r) => `UPDATE ${q(dst)}.${q(r.child)} SET ${q(r.column)} = NULL`));
    }

    // 4. Sequences and identities continue from the copied data.
    const seqCols = await pg.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = $1 AND (is_identity = 'YES' OR column_default LIKE 'nextval(%')`, [dst]);
    await batch(seqCols.rows.map((r) =>
      `SELECT setval(pg_get_serial_sequence(${lit(`${q(dst)}.${q(r.table_name)}`)}, ${lit(r.column_name)}),
                     GREATEST((SELECT COALESCE(MAX(${q(r.column_name)}), 0) FROM ${q(dst)}.${q(r.table_name)}), 1),
                     (SELECT MAX(${q(r.column_name)}) IS NOT NULL FROM ${q(dst)}.${q(r.table_name)}))`));

    // 5. Foreign keys — rendered unqualified from the source and re-created with the copy's
    //    search_path, so references land on the copied tables (or on public for tenant tables).
    const fks = await pg.query<{ table_name: string; conname: string; def: string }>(
      `SELECT c.relname AS table_name, k.conname, pg_get_constraintdef(k.oid) AS def
       FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE k.contype = 'f' AND n.nspname = $1`, [src]);
    await batch([
      `SET LOCAL search_path TO ${q(dst)}, public`,
      ...fks.rows.filter((fk) => !TENANT_TABLES.has(fk.table_name)).map((fk) => `ALTER TABLE ${q(dst)}.${q(fk.table_name)} ADD CONSTRAINT ${q(fk.conname)} ${fk.def}`),
      'SET LOCAL search_path TO public',
    ]);

    // 6. Setup-only: balances and numbering start afresh, as in a new production company.
    if (dataOption === 'SETUP') {
      await batch([
        `UPDATE ${q(dst)}.gl_account SET balance = 0`,
        `UPDATE ${q(dst)}.bank_account SET balance = 0, balance_lcy = 0, balance_last_statement = 0`,
        `UPDATE ${q(dst)}.no_series_line SET last_no_used = NULL, last_date_used = NULL`,
        `UPDATE ${q(dst)}.sequence SET next_no = 1`,
      ]);
    }

    // 7. The new company announces itself on every screen and printout.
    if (input.renameOrganisation !== false || dataOption !== 'FULL') {
      await pg.query(`UPDATE ${q(dst)}.organisation SET name = $1, short_name = $1`, [displayName]);
    }

    await pg.query(
      'INSERT INTO public.company (code, schema_name, display_name, is_default, copied_from, created_at, created_by) VALUES ($1, $2, $3, false, $4, $5, $6)',
      [code, dst, displayName, dataOption === 'FULL' ? source.code : `${source.code} (${dataOption === 'SETUP' ? 'setup only' : 'empty'})`, new Date().toISOString(), user.username]);
    await pg.query('COMMIT');
  } catch (e) {
    await pg.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await pg.end().catch(() => undefined);
  }
  invalidateCompanyRegistry();
  await audit(user, dataOption === 'FULL' ? 'COMPANY_COPY' : 'COMPANY_CREATE', 'company', code, { from: source.code, dataOption, tables, rows, ms: Date.now() - started });
  return { code, schema: dst, tables, rows, ms: Date.now() - started };
}

/** Users an administrator has pinned to a company. */
export const usersAssignedTo = (code: string): Promise<{ username: string; full_name: string }[]> =>
  all('SELECT username, full_name FROM public.app_user WHERE UPPER(company_code) = UPPER(?) ORDER BY username', code);

/**
 * Delete Company — drops the schema and everything in it. Not the default company, not the
 * company the caller is working in right now, and not one users are still pinned to.
 */
export async function deleteCompany(code: string, user: Actor, activeCode?: string | null): Promise<void> {
  const c = await getCompany(code);
  if (!c) throw new AppError(`Company ${code} not found`, 'NOT_FOUND');
  if (c.is_default || c.schema_name === DEFAULT_SCHEMA) throw new AppError('The default company cannot be deleted', 'VALIDATION');
  if (activeCode && activeCode.toUpperCase() === c.code.toUpperCase()) throw new AppError('You cannot delete the company that you are currently working in. Switch to another company first.', 'VALIDATION');
  const pinned = await usersAssignedTo(c.code);
  if (pinned.length) throw new AppError(`${pinned.length} user${pinned.length === 1 ? ' is' : 's are'} assigned to this company (${pinned.map((u) => u.username).join(', ')}) — reassign them on the User card first`, 'VALIDATION');
  if (!/^co_[a-z0-9_]+$/.test(c.schema_name)) throw new AppError('Refusing to drop an unexpected schema', 'VALIDATION');
  await dropCompanyClient(c.schema_name);
  const pg = new Client({ connectionString: directConnectionString(), statement_timeout: 0, query_timeout: 0 });
  await pg.connect();
  try {
    await pg.query('BEGIN');
    await pg.query(`DROP SCHEMA IF EXISTS ${q(c.schema_name)} CASCADE`);
    await pg.query('DELETE FROM public.company WHERE id = $1', [c.id]);
    await pg.query('COMMIT');
  } catch (e) {
    await pg.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await pg.end().catch(() => undefined);
  }
  invalidateCompanyRegistry();
  await audit(user, 'COMPANY_DELETE', 'company', c.code, { schema: c.schema_name });
}

export async function renameCompany(code: string, displayName: string, user: Actor): Promise<void> {
  const name = displayName.trim();
  if (!name) throw new AppError('Display name is required', 'VALIDATION');
  const res = await run('UPDATE public.company SET display_name = ? WHERE UPPER(code) = UPPER(?)', name, code);
  if (!res.changes) throw new AppError(`Company ${code} not found`, 'NOT_FOUND');
  invalidateCompanyRegistry();
  await audit(user, 'COMPANY_RENAME', 'company', code, { displayName: name });
}
