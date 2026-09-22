/*
 * Emits the permission_set_line backfill SQL for the six role-centre permission sets, from the
 * exact same ACTION lists lib/seed.ts uses for a fresh database — so the migration and the seed
 * can never drift. Run once, paste the output into
 * prisma/migrations/20260910000000_add_role_centers/migration.sql in place of the
 * @@GENERATED_PERMISSION_LINES@@ marker.
 *
 *   node --conditions=react-server scripts/gen-role-center-perms.ts
 */
import { expandActionsToLines } from '../lib/permissions.ts';
import { ROLES } from '../lib/seed.ts';

const NEW_ROLE_NAMES = [
  'Super Role Centre', 'CRM Officer', 'Credit Officer', 'FOSA Officer', 'Finance Manager', 'Accountant',
];

const rows: string[] = [];
for (const role of ROLES) {
  if (!NEW_ROLE_NAMES.includes(role.name)) continue;
  // roleId is irrelevant here — we join by name in SQL.
  for (const line of expandActionsToLines(0, role.actions)) {
    rows.push(
      `  ('${role.name.replace(/'/g, "''")}', '${line.object_type}', '${line.object_name}', `
      + `${line.read ? 1 : 0}, ${line.insert ? 1 : 0}, ${line.modify ? 1 : 0}, ${line.delete ? 1 : 0}, ${line.execute ? 1 : 0})`,
    );
  }
}

console.log(`-- ${rows.length} permission_set_line rows across ${NEW_ROLE_NAMES.length} role-centre permission sets.
INSERT INTO "permission_set_line"
  ("role_id", "object_type", "object_name", "read_perm", "insert_perm", "modify_perm", "delete_perm", "execute_perm")
SELECT r.id, g.object_type, g.object_name, g.r, g.i, g.m, g.d, g.e
FROM "role" r
JOIN (VALUES
${rows.join(',\n')}
) AS g(role_name, object_type, object_name, r, i, m, d, e) ON g.role_name = r.name
WHERE EXISTS (SELECT 1 FROM "organisation")
ON CONFLICT ("role_id", "object_type", "object_name") DO NOTHING;`);
