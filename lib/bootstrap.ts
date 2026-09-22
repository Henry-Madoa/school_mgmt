import 'server-only';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { seedIfEmpty } from './seed.ts';
import { all } from './db.ts';

/**
 * The one failure that turns every page into "Something went wrong": code that is newer than the
 * database. Named in the server log at first request so it is not a mystery digest. The health
 * route (/api/health) reports the same as migrations: 'pending'.
 */
async function warnIfMigrationsPending(): Promise<void> {
  try {
    const onDisk = readdirSync(join(process.cwd(), 'prisma', 'migrations'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    const applied = new Set((await all<{ migration_name: string }>(
      'SELECT migration_name FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
    )).map((m) => m.migration_name));
    const pending = onDisk.filter((m) => !applied.has(m));
    if (pending.length) {
      console.error(`\n  DATABASE IS BEHIND THE CODE: ${pending.length} migration(s) not applied — pages that touch the new tables/columns will fail.\n  Run "npm run db:migrate" (prisma migrate deploy) against this database. Pending: ${pending.join(', ')}\n`);
    }
  } catch {
    // No migrations folder in this build, or no _prisma_migrations table yet — nothing to say.
  }
}

/*
 * Seeding used to live in instrumentation.ts, but Next.js also compiles that
 * file for the edge runtime, where the database driver's node built-ins cannot
 * resolve — and that build failure takes down every route. Running it from the
 * root layout instead keeps the native module confined to the Node server
 * bundle, where `serverExternalPackages` applies.
 */
/*
 * The in-flight promise is what is memoised, not a boolean: the seed is now
 * asynchronous, and both generateMetadata() and the layout body call this while
 * rendering the same request. Caching the promise makes the later callers wait
 * for the first seed instead of racing past a flag that is set before the work
 * has actually finished.
 */
const globalForBootstrap = globalThis as typeof globalThis & { __schoolSeeding?: Promise<void> };

export function ensureSeeded(): Promise<void> {
  globalForBootstrap.__schoolSeeding ??= (async () => {
    const started = Date.now();
    try {
      await warnIfMigrationsPending();
      const result = await seedIfEmpty();
      if (result.seeded && result.demo) {
        console.log(`  Seeded ${result.students} students and ${result.teachers} teachers in ${Date.now() - started} ms.`);
        console.log('  Sign in as admin/admin123, principal/principal123, registrar/registrar123, teacher/teacher123, bursar/bursar123, accountant/accountant123, hr/hr123, parent/parent123, student/student123 or auditor/auditor123.');
      } else if (result.seeded) {
        console.log(`  Initialised setup data (no demonstration records) in ${Date.now() - started} ms.`);
        if (result.adminPassword) {
          console.log(`  Administrator sign-in: admin / ${result.adminPassword}  — change it immediately; it is not shown again.`);
        } else {
          console.log('  Administrator sign-in: admin, with the password from ADMIN_INITIAL_PASSWORD.');
        }
      }
    } catch (err) {
      // A transient failure (e.g. a cold-start timeout) must not wedge every
      // later request behind the same cached rejection — clear it so the next
      // call retries instead of replaying this one forever.
      globalForBootstrap.__schoolSeeding = undefined;
      throw err;
    }
  })();
  return globalForBootstrap.__schoolSeeding;
}
