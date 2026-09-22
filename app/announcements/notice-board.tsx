'use client';

import { useState } from 'react';
import { EmptyState } from '@/components/ui/primitives';
import { ANNOUNCEMENT_AUDIENCES as AUDIENCES } from '@/lib/constants';
import { formatDate } from '@/lib/format';
import { AnnouncementInlineEditor, DeleteAnnouncementButton, NotifyAnnouncementButton } from './announcement-form';
import type { AnnouncementView, GradeLevel, StreamView } from '@/lib/types';

const audienceLabel = (a: AnnouncementView): string =>
  a.audience === 'GRADE_LEVEL' ? a.grade_level_name ?? 'One grade' : a.audience === 'STREAM' ? a.stream_name ?? 'One class' : AUDIENCES.find((x) => x.value === a.audience)?.label ?? a.audience;

/** The office's notice board — each announcement edits in place. */
export function NoticeBoard({ rows, grades, streams, canManage }: { rows: AnnouncementView[]; grades: GradeLevel[]; streams: StreamView[]; canManage: boolean }) {
  const [editing, setEditing] = useState<number | null>(null);
  if (!rows.length) return <EmptyState icon="📣" title="No announcements" />;
  const now = new Date().toISOString();
  return (
    <div className="stack" style={{ gap: 12 }}>
      {rows.map((a) => {
        const scheduled = a.published_at > now;
        const expired = !!a.expires_at && a.expires_at < now;
        return (
          <article key={a.id} className="sub-card" style={{ padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 8, opacity: expired ? 0.6 : 1 }}>
            {editing === a.id ? (
              <AnnouncementInlineEditor announcement={a} grades={grades} streams={streams} onClose={() => setEditing(null)} />
            ) : (
              <>
                <div className="inline" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <b>{a.title}</b>
                    <div className="tiny">
                      {audienceLabel(a)} · {scheduled ? `scheduled for ${formatDate(a.published_at)}` : formatDate(a.published_at)}
                      {a.expires_at ? ` · ${expired ? 'expired' : 'until'} ${formatDate(a.expires_at)}` : ''}{a.created_by ? ` · ${a.created_by}` : ''}
                    </div>
                  </div>
                  {canManage ? (
                    <span className="inline" style={{ gap: 4 }}>
                      <NotifyAnnouncementButton announcement={a} />
                      <button type="button" className="btn sm ghost" onClick={() => setEditing(a.id)}>Edit</button>
                      <DeleteAnnouncementButton id={a.id} />
                    </span>
                  ) : null}
                </div>
                <div style={{ whiteSpace: 'pre-wrap', marginTop: 6, fontSize: 13 }}>{a.body}</div>
              </>
            )}
          </article>
        );
      })}
    </div>
  );
}
