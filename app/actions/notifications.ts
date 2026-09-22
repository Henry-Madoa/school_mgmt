'use server';

import { requireUser } from '@/lib/session';
import { actionResult } from '@/lib/errors';
import * as notifications from '@/lib/notifications';
import type { ActionResult, AppNotification } from '@/lib/types';

export async function fetchMyNotifications(): Promise<ActionResult<{ items: AppNotification[]; unread: number }>> {
  return actionResult(async () => {
    const user = await requireUser();
    const [items, unread] = await Promise.all([
      notifications.listMyNotifications(user.id),
      notifications.unreadCount(user.id),
    ]);
    return { items, unread };
  });
}

export async function markNotificationRead(id: number): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const user = await requireUser();
    await notifications.markRead(id, user.id);
    return { updated: true };
  });
}

export async function markAllNotificationsRead(): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const user = await requireUser();
    await notifications.markAllRead(user.id);
    return { updated: true };
  });
}
