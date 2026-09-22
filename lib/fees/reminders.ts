/*
 * Fee balance reminders — guardians of students with an overdue fee balance are told by SMS
 * and e-mail how much is owed and by when it was due. Runs unattended from the job queue
 * (FEE_REMINDERS, lib/jobQueue.ts) and on demand from Fees → Fee Balances. Never throws for
 * one bad number: the gateway result is recorded per guardian and the run carries on.
 */
import 'server-only';
import { one, all, audit } from '../db.ts';
import { sendSms } from '../sms.ts';
import { sendMail } from '../mailer.ts';
import { formatDate, formatMoney } from '../format.ts';
import { listFeeBalances, type FeeBalanceRow } from './invoices.ts';
import type { Actor } from '../types.ts';

export interface ReminderResult { reminded: number; skipped: number; details: { admission_no: string; sent: ('SMS' | 'EMAIL')[] }[] }

/** Reminds the guardians of one set of students (default: everyone overdue). */
export async function sendFeeReminders(user: Actor, opts: { studentIds?: number[]; streamId?: number | null; gradeLevelId?: number | null } = {}): Promise<ReminderResult> {
  const org = await one<{ name: string; short_name: string | null; paybill_no: string | null; currency_symbol: string | null }>(
    'SELECT name, short_name, paybill_no, currency_symbol FROM organisation LIMIT 1',
  );
  const school = org?.short_name || org?.name || 'the school';
  let rows: FeeBalanceRow[] = await listFeeBalances({ onlyOverdue: true, streamId: opts.streamId, gradeLevelId: opts.gradeLevelId });
  if (opts.studentIds?.length) {
    const wanted = new Set(opts.studentIds);
    rows = rows.filter((r) => wanted.has(r.student_id));
  }
  const result: ReminderResult = { reminded: 0, skipped: 0, details: [] };
  for (const r of rows) {
    if (r.overdue <= 0) { result.skipped += 1; continue; }
    const guardians = await all<{ full_name: string; phone: string; email: string | null }>(
      `SELECT g.full_name, g.phone, g.email FROM student_guardian sg JOIN guardian g ON g.id = sg.guardian_id
       WHERE sg.student_id = ? ORDER BY sg.is_primary DESC, sg.id LIMIT 2`, r.student_id,
    );
    if (!guardians.length) { result.skipped += 1; continue; }
    const owed = formatMoney(r.overdue, { symbol: org?.currency_symbol ?? 'KSh' });
    const balance = formatMoney(r.balance, { symbol: org?.currency_symbol ?? 'KSh' });
    const due = r.oldest_due_date ? formatDate(r.oldest_due_date) : 'now';
    const paybill = org?.paybill_no ? ` Pay via M-Pesa paybill ${org.paybill_no}, account ${r.admission_no}.` : '';
    const sent: ('SMS' | 'EMAIL')[] = [];
    for (const g of guardians) {
      if (g.phone) {
        await sendSms({
          to: g.phone, source: 'FEES', reference: { type: 'FEE_REMINDER', no: r.admission_no },
          message: `Dear ${g.full_name}, ${r.student_name} (${r.admission_no}) has fees of ${owed} that were due on ${due}; total balance ${balance}.${paybill} Thank you — ${school}.`,
        });
        if (!sent.includes('SMS')) sent.push('SMS');
      }
      if (g.email) {
        await sendMail({
          to: g.email, subject: `Fee balance reminder — ${r.student_name} (${r.admission_no})`,
          reference: { type: 'FEE_REMINDER', no: r.admission_no },
          html: `<p>Dear ${g.full_name},</p>`
            + `<p>${r.student_name} (${r.admission_no}, ${r.grade_level_name ?? ''}${r.stream_name ? ` ${r.stream_name}` : ''}) has fees of <b>${owed}</b> that were due on ${due}. `
            + `The total balance on the fee account is <b>${balance}</b>.</p>`
            + (org?.paybill_no ? `<p>You can pay via M-Pesa paybill <b>${org.paybill_no}</b>, account number <b>${r.admission_no}</b>.</p>` : '')
            + `<p>Thank you,<br/>${school}</p>`,
        });
        if (!sent.includes('EMAIL')) sent.push('EMAIL');
      }
    }
    if (sent.length) { result.reminded += 1; result.details.push({ admission_no: r.admission_no, sent }); } else result.skipped += 1;
  }
  await audit(user, 'FEE_REMINDERS_SENT', 'student', null, { reminded: result.reminded, skipped: result.skipped });
  return result;
}

/** The job queue's entry point. */
export async function runFeeReminders(user: Actor): Promise<{ reminded: number; skipped: number }> {
  const r = await sendFeeReminders(user);
  return { reminded: r.reminded, skipped: r.skipped };
}
