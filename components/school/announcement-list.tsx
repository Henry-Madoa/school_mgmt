import type { ReactNode } from 'react';
import { EmptyState } from '@/components/ui/primitives';
import { ANNOUNCEMENT_AUDIENCES as AUDIENCES } from '@/lib/constants';
import { formatDate } from '@/lib/format';
import type { AnnouncementView } from '@/lib/types';

const audienceLabel = (a: AnnouncementView): string =>
  a.audience === 'GRADE_LEVEL' ? a.grade_level_name ?? 'One grade' : a.audience === 'STREAM' ? a.stream_name ?? 'One class' : AUDIENCES.find((x) => x.value === a.audience)?.label ?? a.audience;

/** Notices as a feed — the office list, the portals and the dashboards all read the same way. */
export function AnnouncementList({ rows, actions, empty = 'No announcements' }: { rows: AnnouncementView[]; actions?: (a: AnnouncementView) => ReactNode; empty?: string }) {
  if (!rows.length) return <EmptyState icon="📣" title={empty} />;
  const now = new Date().toISOString();
  return (
    <div className="stack" style={{ gap: 12 }}>
      {rows.map((a) => {
        const scheduled = a.published_at > now;
        const expired = !!a.expires_at && a.expires_at < now;
        return (
          <article key={a.id} className="sub-card" style={{ padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 8, opacity: expired ? 0.6 : 1 }}>
            <div className="inline" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <b>{a.title}</b>
                <div className="tiny">
                  {audienceLabel(a)} · {scheduled ? `scheduled for ${formatDate(a.published_at)}` : formatDate(a.published_at)}
                  {a.expires_at ? ` · ${expired ? 'expired' : 'until'} ${formatDate(a.expires_at)}` : ''}{a.created_by ? ` · ${a.created_by}` : ''}
                </div>
              </div>
              {actions ? <span className="inline" style={{ gap: 4 }}>{actions(a)}</span> : null}
            </div>
            <div style={{ whiteSpace: 'pre-wrap', marginTop: 6, fontSize: 13 }}>{a.body}</div>
          </article>
        );
      })}
    </div>
  );
}
