import { one, all, run } from './db.ts';
import type { AppNotification, NotificationType } from './types.ts';

export const listMyNotifications = (userId: number, limit = 30): Promise<AppNotification[]> =>
  all<AppNotification>(
    'SELECT * FROM notification WHERE user_id = ? ORDER BY id DESC LIMIT ?', userId, limit,
  );

export const unreadCount = async (userId: number): Promise<number> =>
  (await one<{ c: number }>(
    'SELECT COUNT(*) c FROM notification WHERE user_id = ? AND is_read = 0', userId,
  ))!.c;

export async function notify(
  userId: number, type: NotificationType, title: string, body: string | null, link: string | null,
): Promise<void> {
  await run(
    'INSERT INTO notification (user_id, type, title, body, link, created_at) VALUES (?,?,?,?,?,?)',
    userId, type, title, body, link, new Date().toISOString(),
  );
}

export async function markRead(id: number, userId: number): Promise<void> {
  await run('UPDATE notification SET is_read = 1 WHERE id = ? AND user_id = ?', id, userId);
}

export async function markAllRead(userId: number): Promise<void> {
  await run('UPDATE notification SET is_read = 1 WHERE user_id = ? AND is_read = 0', userId);
}
