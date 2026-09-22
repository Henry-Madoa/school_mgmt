'use client';

import { useRunAction } from './run-action';
import { delegateMyTask } from '@/app/actions/workflows';
import type { DelegateTarget } from '@/lib/workflow';

/** How the delegate was arrived at, said in words — the same chain Business Central walks. */
const VIA_LABEL: Record<DelegateTarget['via'], string> = {
  substitute: 'their configured substitute',
  approver: 'their approver — no substitute was set up',
  administrator: 'an Approval Administrator — no substitute or approver was set up',
};

/**
 * Business Central's Delegate action on an approval request: hands the pending task to the
 * substitute of the approver it is currently with, falling back to that approver's own approver
 * and then to an Approval Administrator (lib/workflow.ts's resolveDelegateTarget()).
 *
 * One component for every document type — the confirmation and the outcome should read the same
 * whether you are delegating a loan, a sales invoice or an account opening. The delegate is named
 * in the result rather than the prompt, because who it resolves to depends on User Setup the
 * browser has no business guessing at.
 */
export function DelegateButton({ taskId, className = 'btn sm ghost' }: { taskId: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button
      type="button" className={className} disabled={busy}
      onClick={() => run(() => delegateMyTask(taskId), {
        confirm: {
          title: 'Delegate this approval?',
          message: 'It moves to the substitute set up for the approver it is currently with. '
            + 'You will no longer be able to decide it yourself, and the trail records the hand-off.',
          confirmLabel: 'Delegate',
        },
        successTitle: (t: DelegateTarget) => `Delegated to ${t.name}`,
        successDetail: (t: DelegateTarget) => `Resolved as ${VIA_LABEL[t.via]}. They have been notified.`,
      })}
    >
      {busy ? 'Working…' : 'Delegate'}
    </button>
  );
}
