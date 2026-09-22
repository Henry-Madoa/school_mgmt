'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  fetchMyNotifications, markAllNotificationsRead, markNotificationRead,
} from '@/app/actions/notifications';
import type { AppNotification } from '@/lib/types';

const POLL_MS = 30_000;

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

/** Bell icon with an unread badge and a dropdown of recent workflow notifications. */
export function NotificationBell() {
  const router = useRouter();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const res = await fetchMyNotifications();
    if (res.ok) { setItems(res.data.items); setUnread(res.data.unread); }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_MS);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(interval); window.removeEventListener('focus', onFocus); };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const openItem = async (n: AppNotification) => {
    if (!n.is_read) await markNotificationRead(n.id);
    setOpen(false);
    await load();
    if (n.link) router.push(n.link);
  };

  const markAll = async () => {
    await markAllNotificationsRead();
    await load();
  };

  return (
    <div className="notif-bell" ref={boxRef}>
      <button
        type="button"
        className="theme-toggle"
        aria-label={unread ? `${unread} unread notifications` : 'Notifications'}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">🔔</span>
        {unread ? <span className="notif-dot">{unread > 9 ? '9+' : unread}</span> : null}
      </button>
      {open ? (
        <div className="notif-panel">
          <div className="notif-panel-head">
            <span>Notifications</span>
            {unread ? <button type="button" className="btn ghost sm" onClick={markAll}>Mark all read</button> : null}
          </div>
          {items.length ? (
            <div className="notif-list">
              {items.map((n) => (
                <button type="button" key={n.id} className={`notif-item ${n.is_read ? '' : 'unread'}`} onClick={() => openItem(n)}>
                  <div className="notif-title">{n.title}</div>
                  {n.body ? <div className="notif-body">{n.body}</div> : null}
                  <div className="notif-time">{timeAgo(n.created_at)}</div>
                </button>
              ))}
            </div>
          ) : (
            <div className="notif-empty">Nothing yet</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
