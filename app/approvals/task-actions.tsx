'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useResultDialog } from '@/components/ui/result-dialog';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { decideMyTask, delegateMyTask } from '@/app/actions/workflows';

/** Inline approve/reject/delegate for a task assigned to me — no modal, just a comment box.
 *  Approve/Reject already gate behind their own inline two-step confirm (Approve/Reject reveals
 *  a "Confirm approve"/"Confirm reject" step with a Cancel available), so only Delegate — a
 *  single click today — gets the pop-up confirm. */
export function TaskActions({ taskId }: { taskId: number }) {
  const router = useRouter();
  const showResult = useResultDialog();
  const confirm = useConfirm();
  const [mode, setMode] = useState<'approve' | 'reject' | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const decide = async (approve: boolean) => {
    if (!approve && !comment.trim()) return;
    setBusy(true);
    try {
      const res = await decideMyTask(taskId, approve, comment);
      if (!res.ok) { showResult(approve ? 'Could not approve' : 'Could not reject', res.error, 'err'); return; }
      showResult(approve ? 'Approved' : 'Rejected', undefined, 'ok');
      setMode(null);
      setComment('');
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const delegate = async () => {
    const ok = await confirm({
      title: 'Delegate to your substitute?',
      message: 'Your configured substitute will be asked to decide this instead of you.',
      confirmLabel: 'Delegate',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await delegateMyTask(taskId);
      if (!res.ok) { showResult('Could not delegate', res.error, 'err'); return; }
      showResult('Delegated to your substitute', undefined, 'ok');
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  if (!mode) {
    return (
      <div className="inline" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn sm ghost" disabled={busy} onClick={delegate}>Delegate</button>
        <button type="button" className="btn sm ghost" onClick={() => setMode('reject')}>Reject</button>
        <button type="button" className="btn sm" onClick={() => setMode('approve')}>Approve</button>
      </div>
    );
  }

  return (
    <div className="inline" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
      <input
        type="text"
        placeholder={mode === 'approve' ? 'Comment (optional)' : 'Reason (required)'}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        style={{ width: 160 }}
      />
      <button type="button" className="btn sm ghost" onClick={() => setMode(null)} disabled={busy}>Cancel</button>
      <button
        type="button"
        className={mode === 'approve' ? 'btn sm' : 'btn sm danger'}
        onClick={() => decide(mode === 'approve')}
        disabled={busy || (mode === 'reject' && !comment.trim())}
      >
        {busy ? 'Working…' : mode === 'approve' ? 'Confirm approve' : 'Confirm reject'}
      </button>
    </div>
  );
}
