/*
 * Splits the combined "Student / Parent Portal" profile into two Role Centres — Student Portal and
 * Parent Portal — on a school that was seeded before they were separate.
 *
 * A parent and a child want different landing pages: the parent's is about fees, attendance and
 * what the school has said; the child's is about today's lessons, their results and the books they
 * owe the library. This script creates the two profiles, moves every login to the right one (by
 * what the login is actually linked to in User Setup — a student_id makes it a pupil, a
 * guardian_id a parent), and leaves the old profile behind only if something still points at it.
 *
 *   node --conditions=react-server scripts/split-student-parent-profiles.ts
 */
import fs from 'node:fs';
import path from 'node:path';

for (const line of fs.existsSync('.env') ? fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8').split(/\r?\n/) : []) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
}
if (process.env.DATABASE_URL && !process.env.DIRECT_DATABASE_URL) process.env.DATABASE_URL = process.env.DATABASE_URL.replace('-pooler.', '.');

const { one, all, run } = await import('../lib/db.ts');

const ensure = async (code: string, name: string, description: string, icon: string, sort: number): Promise<number> => {
  const existing = await one<{ id: number }>('SELECT id FROM profile WHERE code = ?', code);
  if (existing) {
    await run('UPDATE profile SET name = ?, description = ?, role_centre = ?, icon = ?, sort = ?, is_system = 1 WHERE id = ?', name, description, code, icon, sort, existing.id);
    return existing.id;
  }
  const info = await run(
    'INSERT INTO profile (code, name, description, role_centre, icon, sort, is_default, is_system) VALUES (?,?,?,?,?,?,0,1)',
    code, name, description, code, icon, sort,
  );
  return Number(info.lastInsertRowid);
};

const student = await ensure('STUDENT', 'Student Portal', 'Your timetable, results, attendance, library books and school bus.', '🎒', 40);
const parent = await ensure('PARENT', 'Parent Portal', 'Your children: fees and payments, attendance, report cards and notices from the school.', '👪', 45);
console.log(`profiles: STUDENT=${student} PARENT=${parent}`);

const old = await one<{ id: number }>("SELECT id FROM profile WHERE code = 'STUDENT_PARENT'");
if (!old) {
  console.log('No combined profile to split — nothing else to do.');
  process.exit(0);
}

/* Who is who: User Setup says whether a login is a pupil or a guardian. */
const holders = await all<{ user_id: number; username: string; student_id: number | null; guardian_id: number | null }>(
  `SELECT up.user_id, u.username, s.student_id, s.guardian_id
   FROM user_profile up
   JOIN app_user u ON u.id = up.user_id
   LEFT JOIN approval_user_setup s ON s.user_id = up.user_id
   WHERE up.profile_id = ?`, old.id,
);

let moved = 0;
for (const h of holders) {
  const target = h.student_id ? student : h.guardian_id ? parent : parent;
  await run('INSERT INTO user_profile (user_id, profile_id) VALUES (?,?) ON CONFLICT (user_id, profile_id) DO NOTHING', h.user_id, target);
  await run('DELETE FROM user_profile WHERE user_id = ? AND profile_id = ?', h.user_id, old.id);
  await run('UPDATE app_user SET active_profile_id = ? WHERE id = ? AND active_profile_id = ?', target, h.user_id, old.id);
  console.log(`  ${h.username} → ${target === student ? 'Student Portal' : 'Parent Portal'}${!h.student_id && !h.guardian_id ? ' (not linked in User Setup; parent assumed)' : ''}`);
  moved += 1;
}

/* An administrator who could see the combined portal should be able to see both. */
const admins = await all<{ id: number }>('SELECT u.id FROM app_user u JOIN role r ON r.id = u.role_id WHERE r.is_system = 1');
for (const a of admins) {
  for (const p of [student, parent]) await run('INSERT INTO user_profile (user_id, profile_id) VALUES (?,?) ON CONFLICT (user_id, profile_id) DO NOTHING', a.id, p);
}

const stillUsed = (await one<{ n: number }>('SELECT COUNT(*)::int n FROM user_profile WHERE profile_id = ?', old.id))!.n
  + (await one<{ n: number }>('SELECT COUNT(*)::int n FROM app_user WHERE active_profile_id = ?', old.id))!.n;
if (stillUsed === 0) {
  await run('DELETE FROM profile WHERE id = ?', old.id);
  console.log('Combined profile removed.');
} else {
  console.log(`Combined profile kept — ${stillUsed} reference(s) remain.`);
}

console.log(`Done: ${moved} login(s) moved.`);
process.exit(0);
