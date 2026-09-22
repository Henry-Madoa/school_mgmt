/*
 * School print documents — the Fee Statement and the Report Card — built as PrintDocuments and
 * rendered through the shared letterhead chrome in lib/documentPrint.ts, so what a parent takes
 * home matches the invoices and receipts it summarises.
 *
 * Used by /print/fee-statement/[studentId] and /print/report-card/[studentId]-[termId].
 */
import { one } from './db.ts';
import { formatDate } from './format.ts';
import { printBrand, documentMoney, esc } from './documentPrint.ts';
import { feeAccountSummary, feeStatement } from './fees/statement.ts';
import { buildReportCard } from './academics/assessments.ts';
import type { PrintDocument, PrintRow } from './documentPrint.ts';
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
