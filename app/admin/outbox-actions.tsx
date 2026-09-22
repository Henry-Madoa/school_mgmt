'use client';

import { useRunAction } from '@/components/ui/run-action';
import { retryMessageRequest, cancelMessageRequest, dispatchNowRequest, purgeSentRequest } from '@/app/actions/outbox';

export function RetryMessageButton({ id, className = 'btn sm ghost' }: { id: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => retryMessageRequest(id), { successTitle: (d) => (d.ok ? 'Sent' : 'Still not delivered'), successDetail: (d) => d.error ?? 'Delivered on retry' })}>
      {busy ? 'Sending…' : 'Retry'}
    </button>
  );
}

export function CancelMessageButton({ id, className = 'btn sm ghost' }: { id: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => cancelMessageRequest(id), { confirm: { title: 'Cancel this message?', message: 'It will not be sent.', confirmLabel: 'Cancel message', danger: true }, successTitle: 'Cancelled' })}>
      {busy ? 'Working…' : 'Cancel'}
    </button>
  );
}

export function DispatchNowButton({ className = 'btn sm ghost' }: { className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => dispatchNowRequest(), { successTitle: 'Dispatcher run', successDetail: (d) => `${d.sent} sent, ${d.retried} to retry, ${d.failed} failed` })}>
      {busy ? 'Sending…' : 'Send queued now'}
    </button>
  );
}

export function PurgeSentButton({ className = 'btn sm ghost' }: { className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => purgeSentRequest(), { confirm: { title: 'Remove sent messages older than 90 days?', confirmLabel: 'Remove', danger: true }, successTitle: 'Purged', successDetail: (d) => `${d.removed} message(s) removed` })}>
      {busy ? 'Working…' : 'Purge old sent'}
    </button>
  );
}
