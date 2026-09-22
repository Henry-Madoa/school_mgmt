import { currentCanAction } from '@/lib/session';
import { listOutbox, outboxStats } from '@/lib/outbox';
import { formatDateTime } from '@/lib/format';
import { Card, CardHead, EmptyState, Pill, Stat, TableWrap, Tabs, Toolbar, Spacer, type TabDefinition } from '@/components/ui/primitives';
import { SearchInput } from '@/components/ui/filters';
import { RetryMessageButton, CancelMessageButton, DispatchNowButton, PurgeSentButton } from './outbox-actions';
import type { OutboxStatus } from '@/lib/types';

const STATUSES: TabDefinition[] = [
  { key: 'FAILED', label: 'Failed', tone: 'warn' }, { key: 'QUEUED', label: 'Queued', tone: 'info' }, { key: 'SENT', label: 'Sent', tone: 'ok' }, { key: 'CANCELLED', label: 'Cancelled' }, { key: 'ALL', label: 'All' },
];

/**
 * Admin Centre → Data Management → Message Outbox: every outbound e-mail and SMS with its delivery
 * state (lib/outbox.ts). Failed sends can be retried or cancelled here; the dispatcher can be run
 * on demand.
 */
export async function OutboxTab({ status, search = '' }: { status?: string; search?: string }) {
  const active = (STATUSES.some((s) => s.key === status) ? status : 'FAILED') as OutboxStatus | 'ALL';
  const [rows, stats, canManage] = await Promise.all([listOutbox(active, search), outboxStats(), currentCanAction('OUTBOX_MANAGE')]);
  const toneFor = (s: OutboxStatus) => (s === 'SENT' ? 'ok' : s === 'FAILED' ? 'bad' : s === 'CANCELLED' ? 'info' : 'warn');
  return (
    <>
      <div className="grid g3 stack-2">
        <Stat label="Waiting to send" value={stats.queued} foot="queued or being sent now" />
        <Stat label="Failed" value={<span className={stats.failed ? 'neg' : undefined}>{stats.failed}</span>} foot="gave up, or the channel is not configured" />
        <Stat label="Sent today" value={stats.sent_today} foot="e-mails and texts delivered since midnight" />
      </div>
      <Tabs tabs={STATUSES} active={active} hrefFor={(k) => `/admin/data/outbox?status=${k}${search ? `&q=${encodeURIComponent(search)}` : ''}`} />
      <Toolbar>
        <SearchInput placeholder="Search recipient, subject or document…" />
        <Spacer />
        {canManage ? <DispatchNowButton /> : null}
        {canManage ? <PurgeSentButton /> : null}
      </Toolbar>
      <Card>
        <CardHead title="Message Outbox" sub="Outbound e-mail and SMS — recorded before delivery, retried with back-off, parked here when a gateway keeps refusing or is not configured" />
        {rows.length ? (
          <TableWrap>
            <thead><tr><th>Queued</th><th>Channel</th><th>To</th><th>Subject / text</th><th>About</th><th>Status</th><th className="num">Attempts</th><th>Last error / sent</th><th className="num" /></tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td className="tiny">{formatDateTime(m.created_at)}</td>
                  <td>{m.channel === 'EMAIL' ? '✉ E-mail' : '📱 SMS'}</td>
                  <td className="mono tiny" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.recipient}>{m.recipient}</td>
                  <td style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.subject ?? m.body}>{m.subject ?? m.body}</td>
                  <td className="tiny">{m.reference_no ? <>{m.reference_type?.replace(/_/g, ' ').toLowerCase()} <span className="mono">{m.reference_no}</span></> : '—'}</td>
                  <td><Pill tone={toneFor(m.status)}>{m.status.toLowerCase()}</Pill></td>
                  <td className="num">{m.attempts}/{m.max_attempts}</td>
                  <td className="tiny" style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.last_error ?? undefined}>
                    {m.status === 'SENT' ? formatDateTime(m.sent_at) : m.last_error ? <span style={{ color: 'var(--danger)' }}>{m.last_error}</span> : m.next_attempt_at ? `next try ${formatDateTime(m.next_attempt_at)}` : '—'}
                  </td>
                  <td className="num">
                    {canManage && m.status !== 'SENT' ? (
                      <div className="inline" style={{ justifyContent: 'flex-end' }}>
                        <RetryMessageButton id={m.id} />
                        {m.status !== 'CANCELLED' ? <CancelMessageButton id={m.id} /> : null}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="📮" title={active === 'FAILED' ? 'Nothing has failed' : 'No messages here'} sub={active === 'FAILED' ? 'Every e-mail and text went out, or nothing has been sent yet.' : undefined} />}
      </Card>
    </>
  );
}
