/*
 * Announcements — notices to the whole school, the staff, the teachers, the students, the
 * guardians, one grade or one class. Read by the Announcements page and both portals, each of
 * which asks for what its viewer should see (see visibleAnnouncements).
 */
import { one, all, run, audit } from './db.ts';
import { AppError } from './errors.ts';
import { ANNOUNCEMENT_AUDIENCES } from './constants.ts';
import type { Actor, Announcement, AnnouncementAudience, AnnouncementView } from './types.ts';

export const AUDIENCES = ANNOUNCEMENT_AUDIENCES;

const SELECT = `
  SELECT a.*, g.name AS grade_level_name, CASE WHEN st.id IS NULL THEN NULL ELSE sg.name || ' ' || st.name END AS stream_name
  FROM announcement a
  LEFT JOIN grade_level g ON g.id = a.grade_level_id
  LEFT JOIN stream st ON st.id = a.stream_id
  LEFT JOIN grade_level sg ON sg.id = st.grade_level_id`;

export const listAnnouncements = (limit = 200): Promise<AnnouncementView[]> =>
  all<AnnouncementView>(`${SELECT} ORDER BY a.published_at DESC LIMIT ${Math.max(1, Math.min(limit, 1000))}`);

export const getAnnouncement = (id: number): Promise<AnnouncementView | undefined> => one<AnnouncementView>(`${SELECT} WHERE a.id = ?`, id);

/** What one viewer sees: the audiences they belong to, plus their own grade and class. */
export function visibleAnnouncements(scope: { audiences: AnnouncementAudience[]; gradeLevelIds?: number[]; streamIds?: number[] }, limit = 50): Promise<AnnouncementView[]> {
  const audiences = ['ALL', ...scope.audiences];
  const grades = scope.gradeLevelIds?.length ? scope.gradeLevelIds : [-1];
  const streams = scope.streamIds?.length ? scope.streamIds : [-1];
  return all<AnnouncementView>(
    `${SELECT}
     WHERE (a.expires_at IS NULL OR a.expires_at >= @now) AND a.published_at <= @now
       AND (a.audience = ANY(@audiences) OR (a.audience = 'GRADE_LEVEL' AND a.grade_level_id = ANY(@grades)) OR (a.audience = 'STREAM' AND a.stream_id = ANY(@streams)))
     ORDER BY a.published_at DESC LIMIT ${Math.max(1, Math.min(limit, 500))}`,
    { now: new Date().toISOString(), audiences, grades, streams },
  );
}

export interface AnnouncementInput {
  title: string; body: string; audience: AnnouncementAudience;
  gradeLevelId?: number | null; streamId?: number | null; publishedAt?: string | null; expiresAt?: string | null;
}

function assertInput(i: AnnouncementInput): void {
  if (!i.title?.trim()) throw new AppError('A title is required', 'VALIDATION');
  if (!i.body?.trim()) throw new AppError('The announcement needs some text', 'VALIDATION');
  if (!AUDIENCES.some((a) => a.value === i.audience)) throw new AppError('Pick an audience', 'VALIDATION');
  if (i.audience === 'GRADE_LEVEL' && !i.gradeLevelId) throw new AppError('Pick the grade', 'VALIDATION');
  if (i.audience === 'STREAM' && !i.streamId) throw new AppError('Pick the class', 'VALIDATION');
}

export async function createAnnouncement(input: AnnouncementInput, user: Actor): Promise<{ id: number }> {
  assertInput(input);
  const now = new Date().toISOString();
  const info = await run(
    'INSERT INTO announcement (title, body, audience, grade_level_id, stream_id, published_at, expires_at, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    input.title.trim(), input.body.trim(), input.audience, input.audience === 'GRADE_LEVEL' ? input.gradeLevelId : null,
    input.audience === 'STREAM' ? input.streamId : null, input.publishedAt || now, input.expiresAt || null, user.username, now,
  );
  await audit(user, 'ANNOUNCEMENT_CREATE', 'announcement', info.lastInsertRowid, { title: input.title, audience: input.audience });
  return { id: Number(info.lastInsertRowid) };
}

export async function updateAnnouncement(id: number, input: AnnouncementInput, user: Actor): Promise<void> {
  assertInput(input);
  const before = await one<Announcement>('SELECT * FROM announcement WHERE id = ?', id);
  if (!before) throw new AppError('Announcement not found', 'NOT_FOUND');
  await run(
    'UPDATE announcement SET title=?, body=?, audience=?, grade_level_id=?, stream_id=?, published_at=?, expires_at=? WHERE id=?',
    input.title.trim(), input.body.trim(), input.audience, input.audience === 'GRADE_LEVEL' ? input.gradeLevelId : null,
    input.audience === 'STREAM' ? input.streamId : null, input.publishedAt || before.published_at, input.expiresAt || null, id,
  );
  await audit(user, 'ANNOUNCEMENT_UPDATE', 'announcement', id, { title: input.title });
}

export async function deleteAnnouncement(id: number, user: Actor): Promise<void> {
  await run('DELETE FROM announcement WHERE id = ?', id);
  await audit(user, 'ANNOUNCEMENT_DELETE', 'announcement', id, {});
}
