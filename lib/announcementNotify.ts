/*
 * Sending an announcement out of the app — by SMS and e-mail through the outbox — to the people
 * it is addressed to: the guardians of the students in scope (everyone, a grade, a class, or the
 * guardian/student audiences) and/or the staff. Each recipient is messaged once even when they
 * have several children in scope.
 */
import 'server-only';
import { one, all, audit } from './db.ts';
import { AppError } from './errors.ts';
import { sendSms } from './sms.ts';
import { sendMail } from './mailer.ts';
import { getAnnouncement } from './announcements.ts';
import type { Actor } from './types.ts';

export interface NotifyResult { sms: number; email: number; recipients: number }

interface Recipient { name: string; phone: string | null; email: string | null }

async function recipientsFor(a: { audience: string; grade_level_id: number | null; stream_id: number | null }, opts: { guardians: boolean; staff: boolean }): Promise<Recipient[]> {
  const out = new Map<string, Recipient>();
  const add = (r: Recipient) => { const key = (r.phone || r.email || r.name).toLowerCase(); if (!out.has(key)) out.set(key, r); };
  const toGuardians = opts.guardians && ['ALL', 'STUDENTS', 'GUARDIANS', 'GRADE_LEVEL', 'STREAM'].includes(a.audience);
  const toStaff = opts.staff && ['ALL', 'STAFF', 'TEACHERS'].includes(a.audience);
  if (toGuardians) {
    const scope = a.audience === 'GRADE_LEVEL' ? 'AND s.current_grade_level_id = ?' : a.audience === 'STREAM' ? 'AND s.current_stream_id = ?' : '';
    const args = a.audience === 'GRADE_LEVEL' ? [a.grade_level_id] : a.audience === 'STREAM' ? [a.stream_id] : [];
    const rows = await all<Recipient>(
      `SELECT DISTINCT g.full_name AS name, g.phone, g.email FROM guardian g
       JOIN student_guardian sg ON sg.guardian_id = g.id JOIN student s ON s.id = sg.student_id
       WHERE s.status = 'ACTIVE' AND sg.is_primary ${scope}`, ...args,
    );
    rows.forEach(add);
  }
  if (toStaff) {
    const teachersOnly = a.audience === 'TEACHERS';
    const rows = await all<Recipient>(
      `SELECT e.first_name || ' ' || e.last_name AS name, e.phone, e.email FROM employee e
       ${teachersOnly ? 'JOIN teacher_profile tp ON tp.employee_id = e.id' : ''}
       WHERE e.status IN ('ACTIVE', 'ON_LEAVE')`,
    );
    rows.forEach(add);
  }
  return [...out.values()];
}

/** Queues the announcement to its audience by SMS and/or e-mail. Nothing is sent to anyone outside the audience. */
export async function notifyAnnouncement(id: number, channels: { sms: boolean; email: boolean }, opts: { guardians: boolean; staff: boolean }, user: Actor): Promise<NotifyResult> {
  const a = await getAnnouncement(id);
  if (!a) throw new AppError('Announcement not found', 'NOT_FOUND');
  if (!channels.sms && !channels.email) throw new AppError('Pick SMS, e-mail or both', 'VALIDATION');
  const org = await one<{ name: string; short_name: string | null }>('SELECT name, short_name FROM organisation WHERE id = 1');
  const school = org?.short_name || org?.name || 'The school';
  const recipients = await recipientsFor(a, opts);
  const result: NotifyResult = { sms: 0, email: 0, recipients: recipients.length };
  const smsBody = `${a.title}: ${a.body}`.replace(/\s+/g, ' ').trim();
  for (const r of recipients) {
    if (channels.sms && r.phone) {
      await sendSms({ to: r.phone, reference: { type: 'ANNOUNCEMENT', no: String(id) }, message: `${smsBody.slice(0, 280)}${smsBody.length > 280 ? '…' : ''} — ${school}` });
      result.sms += 1;
    }
    if (channels.email && r.email) {
      await sendMail({
        to: r.email, subject: `${a.title} — ${school}`, reference: { type: 'ANNOUNCEMENT', no: String(id) },
        html: `<p>Dear ${r.name},</p><p style="white-space:pre-wrap">${a.body.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p><p>${school}</p>`,
      });
      result.email += 1;
    }
  }
  await audit(user, 'ANNOUNCEMENT_NOTIFY', 'announcement', id, result);
  return result;
}
