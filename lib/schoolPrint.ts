/*
 * School print documents — the Fee Statement and the Report Card — built as PrintDocuments and
 * rendered through the shared letterhead chrome in lib/documentPrint.ts, so what a parent takes
 * home matches the invoices and receipts it summarises.
 *
 * Used by /print/fee-statement/[studentId] and /print/report-card/[studentId]-[termId].
 */
import { one, all } from './db.ts';
import { formatDate } from './format.ts';
import { printBrand, documentMoney, esc } from './documentPrint.ts';
import { imageSrc } from './cloudinary.ts';
import { feeAccountSummary, feeStatement } from './fees/statement.ts';
import { buildReportCard } from './academics/assessments.ts';
import type { PrintDocument, PrintRow, PrintSection } from './documentPrint.ts';
import type { StudentListRow } from './types.ts';

const studentHeader = (studentId: number) => one<Pick<StudentListRow, 'id' | 'admission_no' | 'first_name' | 'middle_name' | 'last_name' | 'grade_level_name' | 'stream_name' | 'primary_guardian_name' | 'primary_guardian_phone'>>(
  `SELECT s.id, s.admission_no, s.first_name, s.middle_name, s.last_name, g.name AS grade_level_name, st.name AS stream_name, pg.full_name AS primary_guardian_name, pg.phone AS primary_guardian_phone
   FROM student s LEFT JOIN grade_level g ON g.id = s.current_grade_level_id LEFT JOIN stream st ON st.id = s.current_stream_id
   LEFT JOIN LATERAL (SELECT gu.full_name, gu.phone FROM student_guardian sg JOIN guardian gu ON gu.id = sg.guardian_id WHERE sg.student_id = s.id ORDER BY sg.is_primary DESC, sg.id LIMIT 1) pg ON true
   WHERE s.id = ?`, studentId,
);

export async function buildFeeStatementPrint(no: string, query: Record<string, string | string[] | undefined>): Promise<PrintDocument | null> {
  const studentId = Number(no);
  const s = await studentHeader(studentId);
  if (!s) return null;
  const brand = await printBrand();
  if (!brand) return null;
  const from = typeof query.from === 'string' && query.from ? query.from : null;
  const to = typeof query.to === 'string' && query.to ? query.to : null;
  const [summary, statement] = await Promise.all([feeAccountSummary(studentId), feeStatement(studentId, from, to).catch(() => null)]);
  if (!summary || !statement) return null;
  const money = documentMoney(brand, brand.currency_code);
  const rows: PrintRow[] = [
    { cells: { date: from ? formatDate(from) : '', doc: '', description: 'Balance brought forward', debit: '', credit: '', balance: money(statement.opening) }, strong: true },
    ...statement.lines.map((l): PrintRow => ({
      cells: {
        date: formatDate(l.posting_date), doc: `${l.document_type} ${l.document_no}`, description: l.description ?? '',
        debit: l.amount > 0 ? money(l.amount) : '', credit: l.amount < 0 ? money(-l.amount) : '', balance: money(l.running_balance),
      },
    })),
  ];
  const name = [s.first_name, s.middle_name, s.last_name].filter(Boolean).join(' ');
  return {
    brand,
    title: 'Fee Statement',
    subtitle: `${from ? formatDate(from) : 'Start'} – ${formatDate(to ?? new Date().toISOString().slice(0, 10))}`,
    status: summary.balance > 0 ? { label: summary.overdue > 0 ? 'Overdue' : 'Balance owing', tone: summary.overdue > 0 ? 'bad' : 'warn' } : { label: 'Settled', tone: 'ok' },
    parties: [{ heading: 'Student', name, lines: [`Adm. No. ${s.admission_no}`, [s.grade_level_name, s.stream_name].filter(Boolean).join(' '), s.primary_guardian_name ? `Guardian: ${s.primary_guardian_name}${s.primary_guardian_phone ? ` · ${s.primary_guardian_phone}` : ''}` : ''].filter(Boolean) }],
    meta: [
      { label: 'Fee account', value: summary.customer_no },
      { label: 'Invoiced to date', value: money(summary.invoiced) },
      { label: 'Paid to date', value: money(summary.paid) },
      ...(summary.last_payment_date ? [{ label: 'Last payment', value: formatDate(summary.last_payment_date) }] : []),
      ...(summary.next_due_date ? [{ label: 'Next due', value: formatDate(summary.next_due_date) }] : []),
      { label: 'Balance', value: money(summary.balance), strong: true },
    ],
    columns: [
      { key: 'date', label: 'Date', width: '12%' }, { key: 'doc', label: 'Document', width: '18%' }, { key: 'description', label: 'Description' },
      { key: 'debit', label: 'Charged', align: 'right', width: '13%' }, { key: 'credit', label: 'Paid', align: 'right', width: '13%' }, { key: 'balance', label: 'Balance', align: 'right', width: '14%' },
    ],
    rows,
    totals: [
      ...(summary.overdue > 0 ? [{ label: 'Of which overdue', value: money(summary.overdue) }] : []),
      { label: `Balance (${brand.currency_code})`, value: money(statement.closing), grand: true },
    ],
    notes: brand.pay_to ? [{ heading: 'How to pay', body: `${brand.pay_to}\nM-Pesa: use the admission number ${s.admission_no} as the account number.` }] : undefined,
    signatures: [{ label: 'Bursar', block: null }, { label: 'Parent / Guardian', block: null }],
    footnote: 'This statement reflects the fee account as at the date printed. Queries to the school bursar.',
  };
}

export async function buildReportCardPrint(no: string, query: Record<string, string | string[] | undefined> = {}): Promise<PrintDocument | null> {
  const [studentId, termId] = no.split('-').map(Number);
  if (!studentId || !termId) return null;
  const [card, brand] = await Promise.all([buildReportCard(studentId, termId), printBrand()]);
  if (!card || !brand) return null;
  // From the portal, an unpublished card does not exist yet.
  if (query._portal && !card.card?.is_published) return null;
  const types = [...new Map(card.lines.flatMap((l) => l.scores).map((s) => [s.assessment_type_id, s.assessment_type_name])).entries()];
  const att = card.attendance;
  const band = (label: string | null, color: string | null) => (label ? `<span style="display:inline-block;padding:1px 8px;border-radius:12px;color:#fff;font-size:10px;font-weight:600;background:${esc(color ?? '#64748b')}">${esc(label)}</span>` : '—');
  const html = `
    <div class="rc-head">
      <div><div class="rc-name">${esc(card.student.name)}</div><div class="rc-sub">Adm. No. ${esc(card.student.admission_no)} · ${esc([card.student.grade_level_name, card.student.stream_name].filter(Boolean).join(' '))}</div>
        <div class="rc-sub">${esc(card.term.name)} ${esc(card.term.year_name)} · ${esc(formatDate(card.term.start_date))} – ${esc(formatDate(card.term.end_date))}</div></div>
      <div class="rc-overall"><div class="rc-sub">Overall average</div><div class="rc-avg">${card.overall.average ?? '—'}</div>${band(card.overall.competency_label, card.overall.band_color)}
        ${card.overall.mean_points != null ? `<div class="rc-sub">Mean grade <b>${esc(card.overall.mean_grade ?? '—')}</b> · ${card.overall.mean_points} points</div>` : ''}
        ${card.position ? `<div class="rc-sub">Position ${card.position.rank} of ${card.position.of}</div>` : ''}</div>
    </div>
    <table class="rc-table"><thead><tr><th>Subject</th>${types.map(([, n]) => `<th class="num">${esc(n)}</th>`).join('')}<th class="num">Average</th><th>Competency</th></tr></thead>
    <tbody>${card.lines.map((l) => `<tr><td><b>${esc(l.subject_name)}</b></td>${types.map(([id]) => { const sc = l.scores.find((x) => x.assessment_type_id === id); return `<td class="num">${sc ? sc.score : '—'}</td>`; }).join('')}<td class="num"><b>${l.average ?? '—'}</b></td><td>${band(l.competency_label, l.band_color)}</td></tr>`).join('') || `<tr><td colspan="${types.length + 3}">No marks recorded this term.</td></tr>`}</tbody></table>
    <div class="rc-grid">
      <div><div class="rc-cap">Attendance</div><div>${att.total ? `Present ${att.present + att.late} of ${att.total} days (${att.rate}%)${att.absent ? ` · ${att.absent} absent` : ''}${att.excused ? ` · ${att.excused} excused` : ''}` : 'No register marked this term'}</div></div>
      <div><div class="rc-cap">Published</div><div>${card.card?.is_published ? `${card.card.published_at ? esc(formatDate(card.card.published_at)) : ''} by ${esc(card.card.published_by ?? '')}` : 'Draft'}</div></div>
    </div>
    <div class="rc-cap">Class teacher's remarks</div><div class="rc-box">${esc(card.card?.class_teacher_remarks ?? '')}</div>
    <div class="rc-cap">Principal's remarks</div><div class="rc-box">${esc(card.card?.principal_remarks ?? '')}</div>
    <div class="rc-sign"><div><div class="rc-line"></div>Class teacher</div><div><div class="rc-line"></div>Principal</div><div><div class="rc-line"></div>Parent / Guardian</div></div>`;
  return {
    brand,
    title: 'Progress Report',
    subtitle: `${card.term.name} ${card.term.year_name}`,
    watermark: card.card?.is_published ? null : 'DRAFT',
    parties: [], meta: [], columns: [], rows: [], totals: [],
    custom_html: html,
    custom_css: `
      .rc-head{display:flex;justify-content:space-between;align-items:flex-start;margin:8px 0 12px}
      .rc-name{font-size:16px;font-weight:700}.rc-sub{font-size:11px;color:#555}.rc-overall{text-align:right}.rc-avg{font-size:26px;font-weight:700;line-height:1.1}
      .rc-table{width:100%;border-collapse:collapse;font-size:11.5px}.rc-table th,.rc-table td{border:1px solid #cbd5e1;padding:4px 6px;text-align:left}.rc-table th{background:#f1f5f9}.rc-table .num{text-align:right}
      .rc-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px;font-size:11.5px}.rc-cap{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#555;margin-top:10px}
      .rc-box{border:1px solid #cbd5e1;border-radius:6px;min-height:44px;padding:6px 8px;font-size:11.5px;white-space:pre-wrap}
      .rc-sign{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:28px;font-size:11px;text-align:center}.rc-line{border-bottom:1px solid #333;height:28px;margin-bottom:4px}`,
    footnote: 'Competency bands follow the school’s grading scale. Queries to the class teacher.',
  };
}

/* ----------------------------------------------------------- family statement */

/** One statement for a guardian: every child's fee account, then the family total. */
export async function buildFamilyStatementPrint(no: string): Promise<PrintDocument | null> {
  const guardianId = Number(no);
  const g = await one<{ id: number; full_name: string; phone: string; email: string | null; address: string | null }>('SELECT id, full_name, phone, email, address FROM guardian WHERE id = ?', guardianId);
  if (!g) return null;
  const brand = await printBrand();
  if (!brand) return null;
  const money = documentMoney(brand, brand.currency_code);
  const kids = await all<{ id: number; admission_no: string; name: string; grade_level_name: string | null; stream_name: string | null }>(
    `SELECT s.id, s.admission_no, s.first_name || ' ' || s.last_name AS name, gl.name AS grade_level_name, st.name AS stream_name
     FROM student_guardian sg JOIN student s ON s.id = sg.student_id LEFT JOIN grade_level gl ON gl.id = s.current_grade_level_id LEFT JOIN stream st ON st.id = s.current_stream_id
     WHERE sg.guardian_id = ? AND s.status IN ('ACTIVE', 'SUSPENDED') ORDER BY s.first_name`, guardianId,
  );
  const sections: PrintSection[] = [];
  const rows: PrintRow[] = [];
  let family = 0; let overdue = 0;
  for (const k of kids) {
    const summary = await feeAccountSummary(k.id);
    if (!summary) continue;
    const st = await feeStatement(k.id).catch(() => null);
    family += Number(summary.balance); overdue += Number(summary.overdue);
    rows.push({ cells: { student: `${k.name} (${k.admission_no})`, cls: [k.grade_level_name, k.stream_name].filter(Boolean).join(' '), invoiced: money(summary.invoiced), paid: money(summary.paid), overdue: money(summary.overdue), balance: money(summary.balance) } });
    sections.push({
      heading: `${k.name} — ${k.admission_no}`, sub: [k.grade_level_name, k.stream_name].filter(Boolean).join(' '), badge: `Balance ${money(summary.balance)}`,
      columns: [{ key: 'date', label: 'Date', width: '14%' }, { key: 'doc', label: 'Document', width: '20%' }, { key: 'description', label: 'Description' }, { key: 'debit', label: 'Charged', align: 'right', width: '14%' }, { key: 'credit', label: 'Paid', align: 'right', width: '14%' }, { key: 'balance', label: 'Balance', align: 'right', width: '14%' }],
      rows: (st?.lines ?? []).slice(-25).map((l): PrintRow => ({ cells: { date: formatDate(l.posting_date), doc: `${l.document_type} ${l.document_no}`, description: l.description ?? '', debit: l.amount > 0 ? money(l.amount) : '', credit: l.amount < 0 ? money(-l.amount) : '', balance: money(l.running_balance) } })),
      empty: 'No activity on this account yet.',
    });
  }
  return {
    brand, title: 'Family Fee Statement', subtitle: `As at ${formatDate(new Date().toISOString().slice(0, 10))}`,
    status: family > 0 ? { label: overdue > 0 ? 'Overdue' : 'Balance owing', tone: overdue > 0 ? 'bad' : 'warn' } : { label: 'Settled', tone: 'ok' },
    parties: [{ heading: 'Guardian', name: g.full_name, lines: [g.phone, g.email ?? '', g.address ?? ''].filter(Boolean) }],
    meta: [{ label: 'Students', value: String(kids.length) }, { label: 'Overdue', value: money(overdue) }, { label: 'Family balance', value: money(family), strong: true }],
    columns: [{ key: 'student', label: 'Student' }, { key: 'cls', label: 'Class', width: '14%' }, { key: 'invoiced', label: 'Invoiced', align: 'right', width: '14%' }, { key: 'paid', label: 'Paid', align: 'right', width: '14%' }, { key: 'overdue', label: 'Overdue', align: 'right', width: '13%' }, { key: 'balance', label: 'Balance', align: 'right', width: '14%' }],
    rows, totals: [{ label: `Family balance (${brand.currency_code})`, value: money(family), grand: true }],
    sections,
    notes: brand.pay_to ? [{ heading: 'How to pay', body: `${brand.pay_to}\nM-Pesa: use each child's admission number as the account number.` }] : undefined,
    footnote: 'One statement for the family; each child’s fee account is listed separately. Queries to the school bursar.',
  };
}

/* ------------------------------------------------------------------ class list */

/** A class list / blank register sheet — the roll with columns to tick for a week. */
export async function buildClassListPrint(no: string, query: Record<string, string | string[] | undefined>): Promise<PrintDocument | null> {
  const streamId = Number(no);
  const st = await one<{ id: number; name: string; grade_level_name: string; year_name: string; class_teacher_name: string | null }>(
    `SELECT s.id, s.name, g.name AS grade_level_name, y.name AS year_name, CASE WHEN e.id IS NULL THEN NULL ELSE e.first_name || ' ' || e.last_name END AS class_teacher_name
     FROM stream s JOIN grade_level g ON g.id = s.grade_level_id JOIN academic_year y ON y.id = s.academic_year_id LEFT JOIN employee e ON e.id = s.class_teacher_id WHERE s.id = ?`, streamId,
  );
  if (!st) return null;
  const brand = await printBrand();
  if (!brand) return null;
  const roster = await all<{ admission_no: string; name: string; gender: string | null; boarding_status: string; guardian: string | null; phone: string | null }>(
    `SELECT s.admission_no, s.first_name || ' ' || s.last_name AS name, s.gender, s.boarding_status, pg.full_name AS guardian, pg.phone
     FROM student s LEFT JOIN LATERAL (SELECT gu.full_name, gu.phone FROM student_guardian sg JOIN guardian gu ON gu.id = sg.guardian_id WHERE sg.student_id = s.id ORDER BY sg.is_primary DESC LIMIT 1) pg ON true
     WHERE s.current_stream_id = ? AND s.status = 'ACTIVE' ORDER BY s.last_name, s.first_name`, streamId,
  );
  const register = query.register === '1';
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  return {
    brand, title: register ? 'Class Register' : 'Class List', subtitle: `${st.grade_level_name} ${st.name} — ${st.year_name}`, landscape: register,
    parties: [{ heading: 'Class', name: `${st.grade_level_name} ${st.name}`, lines: [`Class teacher: ${st.class_teacher_name ?? '—'}`, `${roster.length} students`] }],
    meta: [{ label: 'Boys', value: String(roster.filter((r) => r.gender === 'MALE').length) }, { label: 'Girls', value: String(roster.filter((r) => r.gender === 'FEMALE').length) }, { label: 'Boarders', value: String(roster.filter((r) => r.boarding_status === 'BOARDER').length) }, ...(register ? [{ label: 'Week of', value: '____________' }] : [])],
    columns: register
      ? [{ key: 'n', label: '#', width: '4%' }, { key: 'adm', label: 'Adm. No.', width: '11%' }, { key: 'name', label: 'Name' }, ...days.map((d) => ({ key: d, label: d, width: '7%', align: 'center' as const }))]
      : [{ key: 'n', label: '#', width: '4%' }, { key: 'adm', label: 'Adm. No.', width: '12%' }, { key: 'name', label: 'Name' }, { key: 'gender', label: 'Sex', width: '6%' }, { key: 'board', label: 'Boarding', width: '10%' }, { key: 'guardian', label: 'Guardian', width: '22%' }, { key: 'phone', label: 'Phone', width: '14%' }],
    rows: roster.map((r, i): PrintRow => ({ cells: { n: String(i + 1), adm: r.admission_no, name: r.name, gender: r.gender ? r.gender[0] : '', board: r.boarding_status === 'BOARDER' ? 'Boarder' : 'Day', guardian: r.guardian ?? '', phone: r.phone ?? '', ...Object.fromEntries(days.map((d) => [d, ''])) } })),
    totals: [], empty: 'No students placed in this class.',
    signatures: register ? [{ label: 'Class teacher', block: null }, { label: 'Checked by', block: null }] : undefined,
  };
}

/* ------------------------------------------------------------------ ID card */

/** A student ID card — credit-card sized, two per sheet width; the photo, name, class and admission number. */
export async function buildStudentIdPrint(no: string): Promise<PrintDocument | null> {
  const s = await one<{ id: number; admission_no: string; name: string; grade_level_name: string | null; stream_name: string | null; photo: string | null; date_of_birth: string | null; boarding_status: string; house: string | null; guardian: string | null; phone: string | null }>(
    `SELECT s.id, s.admission_no, s.first_name || ' ' || s.last_name AS name, g.name AS grade_level_name, st.name AS stream_name, s.photo, s.date_of_birth, s.boarding_status, s.house, pg.full_name AS guardian, pg.phone
     FROM student s LEFT JOIN grade_level g ON g.id = s.current_grade_level_id LEFT JOIN stream st ON st.id = s.current_stream_id
     LEFT JOIN LATERAL (SELECT gu.full_name, gu.phone FROM student_guardian sg JOIN guardian gu ON gu.id = sg.guardian_id WHERE sg.student_id = s.id ORDER BY sg.is_primary DESC LIMIT 1) pg ON true
     WHERE s.id = ?`, Number(no),
  );
  if (!s) return null;
  const brand = await printBrand();
  if (!brand) return null;
  const photo = imageSrc(s.photo, { width: 300, height: 300, crop: 'fill' });
  const year = await one<{ name: string }>('SELECT name FROM academic_year WHERE is_current LIMIT 1');
  const card = (back: boolean) => `
    <div class="idc">
      <div class="idc-head">${brand.logo ? `<img src="${esc(brand.logo)}" alt="" />` : ''}<div><b>${esc(brand.name)}</b><div class="idc-sub">${back ? 'If found, please return to the school' : `Student Identity Card · ${esc(year?.name ?? '')}`}</div></div></div>
      ${back ? `<div class="idc-back">${brand.address_lines.map(esc).join('<br/>')}<br/>${brand.contact_lines.map(esc).join('<br/>')}<br/><br/>Guardian: ${esc(s.guardian ?? '—')} · ${esc(s.phone ?? '')}<br/>This card remains the property of the school.</div>`
      : `<div class="idc-body">${photo ? `<img class="idc-photo" src="${esc(photo)}" alt="" />` : '<div class="idc-photo idc-blank"></div>'}
        <div><div class="idc-name">${esc(s.name)}</div><div>Adm. No. <b>${esc(s.admission_no)}</b></div><div>${esc([s.grade_level_name, s.stream_name].filter(Boolean).join(' '))}</div>
        <div class="idc-sub">${s.boarding_status === 'BOARDER' ? 'Boarder' : 'Day scholar'}${s.house ? ` · ${esc(s.house)}` : ''}${s.date_of_birth ? ` · DOB ${esc(formatDate(s.date_of_birth))}` : ''}</div></div></div>`}
    </div>`;
  return {
    brand, title: 'Student ID Card', subtitle: `${s.name} · ${s.admission_no}`, parties: [], meta: [], columns: [], rows: [], totals: [],
    custom_html: `<div class="idc-sheet">${card(false)}${card(true)}</div><p class="tiny">Front and back — print, cut along the edge and laminate.</p>`,
    custom_css: `
      .idc-sheet{display:flex;gap:12mm;flex-wrap:wrap;margin:8mm 0}
      .idc{width:85.6mm;height:54mm;border:1px solid #999;border-radius:3mm;padding:4mm;box-sizing:border-box;font-size:10px;display:flex;flex-direction:column;gap:3mm;background:#fff}
      .idc-head{display:flex;gap:3mm;align-items:center;border-bottom:1px solid #ddd;padding-bottom:2mm}.idc-head img{height:10mm}.idc-sub{color:#555;font-size:9px}
      .idc-body{display:flex;gap:4mm;align-items:center}.idc-photo{width:24mm;height:30mm;object-fit:cover;border:1px solid #ccc;border-radius:2mm}.idc-blank{background:#f3f4f6}
      .idc-name{font-size:13px;font-weight:700}.idc-back{font-size:9px;line-height:1.5;color:#333}`,
  };
}

/* ---------------------------------------------------------- leaving certificate */

/** A leaving / transfer certificate for a student who has left (or is leaving). */
export async function buildLeavingCertificatePrint(no: string): Promise<PrintDocument | null> {
  const s = await one<{ id: number; admission_no: string; name: string; gender: string | null; date_of_birth: string | null; admission_date: string; status: string; grade_level_name: string | null; updated_at: string | null }>(
    `SELECT s.id, s.admission_no, s.first_name || ' ' || COALESCE(s.middle_name || ' ', '') || s.last_name AS name, s.gender, s.date_of_birth, s.admission_date, s.status, g.name AS grade_level_name, s.updated_at
     FROM student s LEFT JOIN grade_level g ON g.id = s.current_grade_level_id WHERE s.id = ?`, Number(no),
  );
  if (!s) return null;
  const brand = await printBrand();
  if (!brand) return null;
  const enrol = await all<{ year_name: string; grade_level_name: string; status: string }>(
    'SELECT y.name AS year_name, g.name AS grade_level_name, e.status FROM enrollment e JOIN academic_year y ON y.id = e.academic_year_id JOIN grade_level g ON g.id = e.grade_level_id WHERE e.student_id = ? ORDER BY y.start_date', s.id,
  );
  const balance = await feeAccountSummary(s.id);
  const left = s.status === 'GRADUATED' || s.status === 'TRANSFERRED';
  return {
    brand, title: 'Leaving Certificate', subtitle: `${s.name} · ${s.admission_no}`, watermark: left ? null : 'STILL ON THE ROLL',
    parties: [{ heading: 'Student', name: s.name, lines: [`Admission No. ${s.admission_no}`, s.gender ? (s.gender === 'MALE' ? 'Male' : 'Female') : '', s.date_of_birth ? `Born ${formatDate(s.date_of_birth)}` : ''].filter(Boolean) }],
    meta: [
      { label: 'Admitted', value: formatDate(s.admission_date) }, { label: 'Last grade', value: s.grade_level_name ?? '—' },
      { label: 'Status', value: s.status === 'GRADUATED' ? 'Completed' : s.status === 'TRANSFERRED' ? 'Transferred' : s.status },
      { label: 'Fees', value: balance && Number(balance.balance) > 0 ? `Balance ${documentMoney(brand, brand.currency_code)(balance.balance)}` : 'Cleared', strong: true },
    ],
    columns: [{ key: 'year', label: 'Year', width: '20%' }, { key: 'grade', label: 'Grade' }, { key: 'outcome', label: 'Outcome', width: '25%' }],
    rows: enrol.map((e): PrintRow => ({ cells: { year: e.year_name, grade: e.grade_level_name, outcome: e.status === 'PROMOTED' ? 'Promoted' : e.status === 'REPEATED' ? 'Repeated' : e.status === 'GRADUATED' ? 'Completed' : e.status === 'TRANSFERRED_OUT' ? 'Transferred out' : 'Current' } })),
    totals: [], empty: 'No enrolment history.',
    notes: [{ heading: 'Certification', body: `This is to certify that ${s.name}, Admission No. ${s.admission_no}, was a student of ${brand.name} from ${formatDate(s.admission_date)}${left && s.updated_at ? ` to ${formatDate(s.updated_at.slice(0, 10))}` : ''}, and ${s.status === 'GRADUATED' ? 'completed the programme' : s.status === 'TRANSFERRED' ? 'left on transfer' : 'is on the roll'}${balance && Number(balance.balance) > 0 ? '. The fee account is not yet cleared' : ' with the fee account cleared'}.` }],
    signatures: [{ label: 'Principal / Head Teacher', block: null }, { label: 'Registrar', block: null }],
    footnote: 'Issued at the request of the guardian. Valid with the school stamp.',
  };
}

/** The work ticket the driver carries: bus, driver, route, odometer out — closed by hand on return if the office is offline. */
export async function buildWorkTicketPrint(no: string): Promise<PrintDocument | null> {
  const t = await one<{ no: string; date: string; purpose: string; destination: string | null; odometer_start: number | null; odometer_end: number | null; fuel_litres: number; fuel_cost: number; status: string; remarks: string | null; authorised_by: string | null; closed_at: string | null;
    registration_no: string; make_model: string | null; capacity: number; fixed_asset_no: string; insurance_expiry: string | null; driver_name: string; employee_no: string; licence_no: string; licence_expiry: string | null; psv_badge_no: string | null; route_name: string | null; route_code: string | null }>(
    `SELECT t.no, t.date, t.purpose, t.destination, t.odometer_start, t.odometer_end, t.fuel_litres, t.fuel_cost, t.status, t.remarks, t.authorised_by, t.closed_at,
            b.registration_no, b.make_model, b.capacity, b.fixed_asset_no, b.insurance_expiry,
            e.first_name || ' ' || e.last_name AS driver_name, e.employee_no, d.licence_no, d.licence_expiry, d.psv_badge_no, r.name AS route_name, r.code AS route_code
     FROM bus_work_ticket t JOIN school_bus b ON b.id = t.bus_id JOIN employee e ON e.id = t.driver_employee_id
     LEFT JOIN driver_profile d ON d.employee_id = e.id LEFT JOIN transport_route r ON r.id = t.route_id WHERE t.no = ?`, no,
  );
  if (!t) return null;
  const brand = await printBrand();
  if (!brand) return null;
  const stops = t.route_code ? await all<{ name: string; pickup_time: string | null; dropoff_time: string | null }>('SELECT s.name, s.pickup_time, s.dropoff_time FROM transport_stop s JOIN transport_route r ON r.id = s.route_id WHERE r.code = ? ORDER BY s.sort', t.route_code) : [];
  const money = documentMoney(brand, brand.currency_code);
  const purpose = t.purpose === 'ROUTE_RUN' ? 'Route run' : t.purpose === 'TRIP' ? 'Trip / outing' : 'Workshop / maintenance';
  const distance = t.odometer_start !== null && t.odometer_end !== null ? t.odometer_end - t.odometer_start : null;
  return {
    brand, title: 'Bus Work Ticket', subtitle: `${t.no} · ${t.registration_no}`, watermark: t.status === 'CANCELLED' ? 'CANCELLED' : null,
    status: t.status === 'OPEN' ? { label: 'Open — on the road', tone: 'warn' } : t.status === 'CLOSED' ? { label: 'Closed', tone: 'ok' } : { label: 'Cancelled', tone: 'bad' },
    parties: [
      { heading: 'Vehicle', name: t.registration_no, lines: [t.make_model ?? '', `${t.capacity} seats`, `Fixed asset ${t.fixed_asset_no}`, t.insurance_expiry ? `Insurance to ${formatDate(t.insurance_expiry)}` : ''].filter(Boolean) },
      { heading: 'Driver', name: t.driver_name, lines: [`Employee No. ${t.employee_no}`, `Licence ${t.licence_no}${t.licence_expiry ? ` (to ${formatDate(t.licence_expiry)})` : ''}`, t.psv_badge_no ? `PSV badge ${t.psv_badge_no}` : ''].filter(Boolean) },
    ],
    meta: [
      { label: 'Ticket No.', value: t.no, strong: true }, { label: 'Date', value: formatDate(t.date) }, { label: 'Purpose', value: purpose },
      { label: 'Route / destination', value: t.route_name ? `${t.route_code} — ${t.route_name}` : t.destination ?? '—' },
      { label: 'Odometer out', value: t.odometer_start !== null ? `${t.odometer_start.toLocaleString()} km` : '________ km' },
      { label: 'Odometer in', value: t.odometer_end !== null ? `${t.odometer_end.toLocaleString()} km` : '________ km' },
      { label: 'Distance', value: distance !== null ? `${distance.toLocaleString()} km` : '________ km' },
      { label: 'Fuel', value: Number(t.fuel_litres) ? `${t.fuel_litres} L · ${money(t.fuel_cost)}` : '________ L' },
      { label: 'Authorised by', value: t.authorised_by ?? '—' },
    ],
    columns: [{ key: 'n', label: '#', width: '8%' }, { key: 'stop', label: 'Stop' }, { key: 'pick', label: 'Pick-up', width: '18%' }, { key: 'drop', label: 'Drop-off', width: '18%' }],
    rows: stops.map((s, i): PrintRow => ({ cells: { n: String(i + 1), stop: s.name, pick: s.pickup_time ?? '', drop: s.dropoff_time ?? '' } })),
    totals: [], empty: t.purpose === 'ROUTE_RUN' ? 'No stops on this route.' : `Destination: ${t.destination ?? '—'}`,
    notes: t.remarks ? [{ heading: 'Remarks', body: t.remarks }] : [],
    signatures: [{ label: 'Driver', block: null }, { label: 'Transport officer', block: null }, { label: 'Security (gate out / in)', block: null }],
    footnote: 'The driver carries this ticket. Defects, incidents and fuel receipts are noted on the back and handed in with the ticket on return.',
  };
}
