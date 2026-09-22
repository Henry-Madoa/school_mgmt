/*
 * Seeds the database the same way the first request does (lib/bootstrap.ts), from the command
 * line — for a fresh deployment, or a CI database created with `prisma migrate deploy`.
 *
 *   npm run seed                         # setup + the demonstration school (outside production)
 *   SEED_DEMO_DATA=false npm run seed    # setup data only
 */
import fs from 'node:fs';
import path from 'node:path';

for (const line of fs.existsSync('.env') ? fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8').split(/\r?\n/) : []) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
}

// One long transaction: go to the direct endpoint (not PgBouncer) and allow slow statements.
if (process.env.DATABASE_URL && !process.env.DIRECT_DATABASE_URL) process.env.DATABASE_URL = process.env.DATABASE_URL.replace('-pooler.', '.');
else if (process.env.DIRECT_DATABASE_URL) process.env.DATABASE_URL = process.env.DIRECT_DATABASE_URL;
process.env.DB_QUERY_TIMEOUT_MS ??= '600000';

const { seedIfEmpty } = await import('../lib/seed.ts');
const started = Date.now();
const result = await seedIfEmpty();
if (!result.seeded) console.log('Already seeded — nothing to do.');
else if (result.demo) console.log(`Seeded the demonstration school: ${result.students} students, ${result.teachers} teachers, in ${Date.now() - started} ms.`);
else console.log(`Initialised setup data in ${Date.now() - started} ms.${result.adminPassword ? ` Administrator password: ${result.adminPassword}` : ''}`);
process.exit(0);
