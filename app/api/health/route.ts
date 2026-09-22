/*
 * Liveness / readiness for an orchestrator or an uptime monitor: the process is up, the database
 * answers within a short timeout, and every migration on disk has been applied. Unauthenticated
 * by design — it reveals nothing beyond up/down and, on a failure, which of the two checks it was.
 *
 *   200 { ok: true,  db: 'up', migrations: 'current', version }
 *   503 { ok: false, db: 'down' | 'up', migrations: 'pending' | 'unknown', error? }
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { all } from '@/lib/db';

export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 5_000;

async function withTimeout<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('database timed out')), TIMEOUT_MS); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(): Promise<Response> {
  const version = process.env.npm_package_version ?? process.env.APP_VERSION ?? null;
  let db: 'up' | 'down' = 'down';
  let migrations: 'current' | 'pending' | 'unknown' = 'unknown';
  let error: string | undefined;
  try {
    const applied = await withTimeout(all<{ migration_name: string }>(
      'SELECT migration_name FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
    ));
    db = 'up';
    try {
      const onDisk = readdirSync(join(process.cwd(), 'prisma', 'migrations'), { withFileTypes: true })
        .filter((d) => d.isDirectory()).map((d) => d.name);
      const have = new Set(applied.map((m) => m.migration_name));
      migrations = onDisk.every((m) => have.has(m)) ? 'current' : 'pending';
    } catch {
      migrations = 'unknown'; // migrations folder not shipped with the build — not a failure
    }
  } catch (e) {
    error = (e as Error).message;
  }
  const ok = db === 'up' && migrations !== 'pending';
  return Response.json({ ok, db, migrations, version, at: new Date().toISOString(), ...(error ? { error } : {}) }, {
    status: ok ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
