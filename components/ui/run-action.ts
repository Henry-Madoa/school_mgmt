'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useResultDialog } from './result-dialog';
import { useConfirm, type ConfirmOptions } from './confirm-dialog';

export interface RunActionOptions<T> {
  /** Shown before the action runs; the action is skipped entirely if the user cancels. Omit
   *  for an action that doesn't warrant an "are you sure?" gate. */
  confirm?: ConfirmOptions;
  successTitle: string | ((data: T) => string);
  successDetail?: string | ((data: T) => string | undefined);
  /** Where to go once the action succeeds. Needed when the action leaves the current page with
   *  nothing to show — posting a sales document deletes the source header, so refreshing in
   *  place would 404; the posted document is what the user should land on instead. Deleting a
   *  document from its card is the same story, and lands on the list it came from. Return
   *  null/undefined to stay put and just refresh. A target that is already the current page
   *  refreshes instead, so a button shared between a list and a card behaves on both. */
  redirectTo?: string | ((data: T) => string | null | undefined);
}

/**
 * Shared shape for the simple one-click workflow actions — send for approval, approve,
 * reject, cancel approval, delegate. Reports the outcome via the centered pop-up
 * (components/ui/result-dialog.tsx) rather than the small corner toast, since these are
 * workflow decisions, and optionally gates the action behind an "are you sure?" pop-up
 * (components/ui/confirm-dialog.tsx) first.
 */
export function useRunAction() {
  const showResult = useResultDialog();
  const askConfirm = useConfirm();
  const router = useRouter();
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);

  const run = async <T,>(
    fn: () => Promise<{ ok: boolean; error?: string; data?: T }>,
    options: RunActionOptions<T> | string,
  ) => {
    const opts: RunActionOptions<T> = typeof options === 'string' ? { successTitle: options } : options;
    if (opts.confirm) {
      const proceed = await askConfirm(opts.confirm);
      if (!proceed) return;
    }

    setBusy(true);
    try {
      const res = await fn();
      if (!res.ok) {
        showResult('Could not complete', res.error, 'err');
        return;
      }
      const data = res.data as T;
      const title = typeof opts.successTitle === 'function' ? opts.successTitle(data) : opts.successTitle;
      const detail = typeof opts.successDetail === 'function' ? opts.successDetail(data) : opts.successDetail;
      showResult(title, detail, 'ok');
      const to = typeof opts.redirectTo === 'function' ? opts.redirectTo(data) : opts.redirectTo;
      if (to && to !== pathname) router.push(to);
      else router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return { run, busy };
}
