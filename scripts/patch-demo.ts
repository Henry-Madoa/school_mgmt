/*
 * Brings a demonstration database seeded by an earlier build in line with the current one —
 * the fields and records lib/seed.ts now creates on a fresh seed (fee-item applicability, the
 * bursaries account, boarding statuses, electives, the letter-grade scale, sample applications,
 * incidents, teacher flags). Idempotent: safe to run more than once. Apply the migrations first
 * (npm run db:migrate).
 *
 *   node --conditions=react-server scripts/patch-demo.ts
 */
import fs from 'node:fs';
import path from 'node:path';

for (const line of fs.existsSync('.env') ? fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8').split(/\r?\n/) : []) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
}
if (process.env.DATABASE_URL && !process.env.DIRECT_DATABASE_URL) process.env.DATABASE_URL = process.env.DATABASE_URL.replace('-pooler.', '.');
process.env.DB_QUERY_TIMEOUT_MS ??= '600000';

const { one, all, run, tx, nextSequence, hasAnyRow } = await import('../lib/db.ts');
const now = new Date().toISOString();
const todayIso = now.slice(0, 10);
const K = (n: number) => Math.round(n * 100);
let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];

await tx(async () => {
  // Teacher flag on every login whose employee has a teaching profile.
  const t = await run('UPDATE approval_user_setup s SET is_teacher = 1 FROM teacher_profile tp WHERE tp.employee_id = s.employee_id AND s.is_teacher = 0');
  console.log(`teacher flags: ${t.changes}`);

  // Fee items: who each is billed to.
  for (const [code, appliesTo] of [['BOARDING', 'BOARDER'], ['LUNCH', 'DAY'], ['TRANSPORT', 'OPT_IN'], ['ADMISSION', 'OPT_IN']]) {
    await run('UPDATE fee_item SET applies_to = ? WHERE code = ?', appliesTo, code);
  }
  // The bursaries / discounts contra-income account and the School Setup pointer.
  if (!(await hasAnyRow('gl_account', "code = '4090'"))) {
    await run("INSERT INTO gl_account (code, name, type, parent_code, is_postable, account_type, status) VALUES ('4090', 'Bursaries, Scholarships and Discounts (contra)', 'INCOME', '4000', 1, 'POSTING', 'ACTIVE')");
  }
  await run("UPDATE organisation SET fee_discount_account_id = (SELECT id FROM gl_account WHERE code = '4090') WHERE id = 1 AND fee_discount_account_id IS NULL");
  // Boarding, transport and houses — only where nothing has been set yet.
  const students = await all<{ id: number; level: string }>(
    `SELECT s.id, el.name AS level FROM student s JOIN grade_level g ON g.id = s.current_grade_level_id JOIN education_level el ON el.id = g.education_level_id WHERE s.status = 'ACTIVE' ORDER BY s.id`,
  );
  if (!(await hasAnyRow('student', "boarding_status = 'BOARDER'"))) {
    for (const s of students) {
      const boarder = ['Upper Primary', 'Junior Secondary'].includes(s.level) && rnd() < 0.35;
      await run('UPDATE student SET boarding_status = ?, house = COALESCE(house, ?) WHERE id = ?', boarder ? 'BOARDER' : 'DAY', pick(['Kilimanjaro', 'Elgon', 'Kenya', 'Longonot']), s.id);
      if (!boarder && rnd() < 0.33) {
        await run("INSERT INTO student_fee_option (student_id, fee_item_id, note, created_at, created_by) SELECT ?, id, ?, ?, 'system' FROM fee_item WHERE code = 'TRANSPORT' ON CONFLICT DO NOTHING", s.id, pick(['Route A — Kiambu Rd', 'Route B — Thika Rd', 'Route C — Ruaka']), now);
      }
    }
    console.log('boarding statuses and transport options set');
  }
  // Boarding and transport in the fee structure of every term.
  const terms = await all<{ id: number }>('SELECT id FROM academic_term');
  const grades = await all<{ id: number; level: string }>('SELECT g.id, el.name AS level FROM grade_level g JOIN education_level el ON el.id = g.education_level_id');
  for (const term of terms) {
    for (const g of grades) {
      const boarding = g.level === 'Pre-Primary' || g.level === 'Lower Primary' ? 0 : K(21000);
      for (const [code, amount] of [['BOARDING', boarding], ['TRANSPORT', K(12000)]] as const) {
        if (!amount) continue;
        await run(
          `INSERT INTO fee_structure (grade_level_id, term_id, fee_item_id, amount, applies_to) SELECT ?, ?, id, ?, 'ALL' FROM fee_item WHERE code = ? ON CONFLICT DO NOTHING`, g.id, term.id, amount, code,
        );
      }
    }
  }
  // A few bursaries and sibling discounts.
  if (!(await hasAnyRow('student_fee_discount'))) {
    const tuition = (await one<{ id: number }>("SELECT id FROM fee_item WHERE code = 'TUITION'"))!.id;
    for (const [i, s] of students.filter((_, k) => k % 23 === 0).slice(0, 6).entries()) {
      await run(
        'INSERT INTO student_fee_discount (student_id, fee_item_id, percent, amount, description, status, created_at, created_by) VALUES (?,?,?,?,?,?,?,?)',
        s.id, i % 2 ? tuition : null, i % 3 ? 25 : 0, i % 3 ? 0 : K(5000), i % 2 ? 'Sibling discount' : 'Board of Management bursary', 'ACTIVE', now, 'system',
      );
    }
    console.log('discounts added');
  }
  // Letter-grade scale for Junior Secondary.
  if (!(await hasAnyRow('grading_scale', 'education_level_id IS NOT NULL'))) {
    const level = await one<{ id: number }>("SELECT id FROM education_level WHERE name = 'Junior Secondary'");
    const letters = await run('INSERT INTO grading_scale (name, is_default, education_level_id) VALUES (?, false, ?)', 'Letter Grades (A–E, 12–1 points)', level?.id ?? null);
    const bands: [string, number, number, number][] = [
      ['A', 80, 100, 12], ['A-', 75, 79.99, 11], ['B+', 70, 74.99, 10], ['B', 65, 69.99, 9], ['B-', 60, 64.99, 8], ['C+', 55, 59.99, 7],
      ['C', 50, 54.99, 6], ['C-', 45, 49.99, 5], ['D+', 40, 44.99, 4], ['D', 35, 39.99, 3], ['D-', 30, 34.99, 2], ['E', 0, 29.99, 1],
    ];
    for (const [i, [label, min, max, points]] of bands.entries()) {
      await run('INSERT INTO assessment_band (grading_scale_id, label, min_score, max_score, sort, color_hex, points) VALUES (?,?,?,?,?,?,?)', letters.lastInsertRowid, label, min, max, i + 1, points >= 8 ? '#1a7f37' : points >= 5 ? '#1d6fb8' : '#c0392b', points);
    }
    console.log('letter-grade scale added');
  }
  // Electives: the non-core subjects a student already has marks in, else one or two at random.
  if (!(await hasAnyRow('student_subject'))) {
    const year = (await one<{ id: number }>('SELECT id FROM academic_year WHERE is_current'))!;
    const marked = await all<{ student_id: number; subject_id: number }>(
      `SELECT DISTINCT ar.student_id, ar.subject_id FROM assessment_record ar JOIN subject s ON s.id = ar.subject_id WHERE NOT s.is_core AND ar.academic_year_id = ?`, year.id,
    );
    for (const m of marked) await run('INSERT INTO student_subject (student_id, subject_id, academic_year_id, created_at, created_by) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING', m.student_id, m.subject_id, year.id, now, 'system');
    console.log(`electives: ${marked.length}`);
  }
  // Sample applications and incidents.
  if (!(await hasAnyRow('admission_application'))) {
    const year = (await one<{ id: number }>('SELECT id FROM academic_year WHERE is_current'))!;
    const gradeId = async (name: string) => (await one<{ id: number }>('SELECT id FROM grade_level WHERE name = ?', name))?.id ?? grades[0].id;
    const rows: [string, string, string, string, string, string][] = [
      ['Zawadi', 'Njoroge', 'Grade 1', 'ENQUIRY', 'Mercy Njoroge', '0722001001'], ['Ethan', 'Kamau', 'Grade 4', 'APPLIED', 'Anne Kamau', '0722001002'],
      ['Amani', 'Odhiambo', 'Grade 7', 'OFFERED', 'Tom Odhiambo', '0722001003'], ['Neema', 'Wanjala', 'PP2', 'APPLIED', 'Grace Wanjala', '0722001004'],
      ['Kevin', 'Mutiso', 'Grade 5', 'DECLINED', 'Paul Mutiso', '0722001005'],
    ];
    for (const [first, last, grade, status, gName, gPhone] of rows) {
      await run(
        `INSERT INTO admission_application (no, first_name, last_name, gender, grade_level_id, academic_year_id, boarding_status, guardian_name, guardian_phone, guardian_email, guardian_relationship, notes, status, applied_at, decided_at, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        await nextSequence('ADMISSION_APPLICATION'), first, last, rnd() < 0.5 ? 'FEMALE' : 'MALE', await gradeId(grade), year.id, grade === 'Grade 7' ? 'BOARDER' : 'DAY',
        gName, gPhone, `${gName.split(' ')[0].toLowerCase()}@mail.co.ke`, 'Mother', status === 'OFFERED' ? 'Interview done; offer letter sent' : status === 'DECLINED' ? 'Family relocated' : null,
        status, now, status === 'DECLINED' ? now : null, 'registrar',
      );
    }
    console.log('applications added');
  }
  if (!(await hasAnyRow('student_incident'))) {
    for (const [i, s] of students.filter((_, k) => k % 17 === 3).slice(0, 8).entries()) {
      const kind = ['DISCIPLINE', 'MEDICAL', 'EXEAT', 'NOTE'][i % 4];
      await run(
        'INSERT INTO student_incident (student_id, kind, date, title, details, action_taken, follow_up, status, recorded_by, recorded_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        s.id, kind, todayIso, kind === 'DISCIPLINE' ? 'Late for morning prep' : kind === 'MEDICAL' ? 'Sick bay — fever and headache' : kind === 'EXEAT' ? 'Weekend exeat — family function' : 'Counselling follow-up',
        kind === 'MEDICAL' ? 'Temperature 38.2°C; paracetamol given; rested in sick bay' : null, kind === 'DISCIPLINE' ? 'Guardian called; detention Friday' : kind === 'EXEAT' ? 'Signed out by guardian' : null,
        kind === 'EXEAT' || kind === 'MEDICAL' ? todayIso : null, i % 3 === 0 ? 'CLOSED' : 'OPEN', 'registrar', now,
      );
    }
    console.log('incidents added');
  }
  // Permission lines the current seed grants that an earlier one did not (expanded the way lib/seed.ts does).
  const { expandActionsToLines } = await import('../lib/permissions.ts');
  const grant = async (roleName: string, keys: Parameters<typeof expandActionsToLines>[1]) => {
    const role = await one<{ id: number }>('SELECT id FROM role WHERE name = ?', roleName);
    if (!role) return;
    for (const l of expandActionsToLines(role.id, keys)) {
      await run(
        `INSERT INTO permission_set_line (role_id, object_type, object_name, read_perm, insert_perm, modify_perm, delete_perm, execute_perm) VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT (role_id, object_type, object_name) DO UPDATE SET read_perm = GREATEST(permission_set_line.read_perm, EXCLUDED.read_perm), insert_perm = GREATEST(permission_set_line.insert_perm, EXCLUDED.insert_perm),
           modify_perm = GREATEST(permission_set_line.modify_perm, EXCLUDED.modify_perm), delete_perm = GREATEST(permission_set_line.delete_perm, EXCLUDED.delete_perm), execute_perm = GREATEST(permission_set_line.execute_perm, EXCLUDED.execute_perm)`,
        l.role_id, l.object_type, l.object_name, l.read ? 1 : 0, l.insert ? 1 : 0, l.modify ? 1 : 0, l.delete ? 1 : 0, l.execute ? 1 : 0,
      );
    }
  };
  const school = ['ADMISSIONS_READ', 'ADMISSIONS_MANAGE', 'INCIDENTS_READ', 'INCIDENTS_MANAGE', 'STUDENTS_SUBJECTS_MANAGE',
    'TRANSPORT_READ', 'TRANSPORT_MANAGE', 'TRANSPORT_WORK_TICKETS', 'HOSTEL_READ', 'HOSTEL_MANAGE', 'LIBRARY_READ', 'LIBRARY_MANAGE', 'LIBRARY_SETUP_MANAGE'] as const;
  await grant('Principal', [...school, 'SELF_SERVICE_P9_READ']);
  await grant('Academics Officer', [...school, 'SELF_SERVICE_P9_READ']);
  for (const r of ['Teacher', 'Bursar', 'Accountant', 'HR & Payroll Officer', 'Employee Self Service']) await grant(r, ['SELF_SERVICE_P9_READ']);
  await grant('Bursar', ['TRANSPORT_READ', 'HOSTEL_READ', 'LIBRARY_READ', 'LIBRARY_SETUP_MANAGE']);
  await grant('Teacher', ['LIBRARY_READ', 'HOSTEL_READ', 'TRANSPORT_READ']);
  console.log('permission lines granted');

  // Transport, hostel and library demo data (idempotent — skips whatever is already there).
  const { seedSchoolServices } = await import('../lib/seed.ts');
  await seedSchoolServices(new Date().toISOString(), new Date().toISOString().slice(0, 10));
  console.log('school services seeded');
}, { timeout: 3_600_000 });
console.log('done');
process.exit(0);
