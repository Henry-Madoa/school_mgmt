import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

/*
 * Prisma 7 takes the connection URL here rather than in schema.prisma.
 *
 * Neon serves two endpoints. The `-pooler` host is PgBouncer in transaction
 * mode, which is right for the application but cannot run DDL or advisory
 * locks — so migrations go to the direct endpoint, derived by dropping
 * `-pooler` unless DIRECT_DATABASE_URL says otherwise.
 */
function loadEnv(): void {
  const file = path.join(process.cwd(), '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const pooled = process.env.DATABASE_URL ?? '';

/*
 * Prisma's migration engine is a separate Rust client and does not understand
 * Neon's `channel_binding` parameter — it reports the host as unreachable
 * rather than as a handshake failure, which is a misleading error. node-postgres
 * connects to the same endpoint happily, so the parameter is simply dropped for
 * the migration connection.
 */
function forMigrations(url: string): string {
  if (!url) return url;
  const u = new URL(url.replace('-pooler.', '.'));
  u.searchParams.delete('channel_binding');
  u.searchParams.set('sslmode', 'require');
  return u.toString();
}

const direct = process.env.DIRECT_DATABASE_URL ?? forMigrations(pooled);

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: { path: path.join('prisma', 'migrations') },
  datasource: { url: direct },
});
