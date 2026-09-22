'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from './toast';
import type { ActionResult } from '@/lib/types';

export interface RunActionOptions<T> {
  success?: string;
  successDetail?: string | ((data: T) => string);
  onSuccess?: (data: T) => void;
}

/**
 * Runs a Server Action, then reports the outcome and refreshes the route.
 *
 * Server Actions return `{ ok, … }` rather than throwing (see lib/errors.ts), so
 * the failure path here is the same shape everywhere and a business rule such
 * as "you cannot approve a loan you captured" reaches the user verbatim.
 */
function useAction() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const runAction = async <T,>(
    fn: () => Promise<ActionResult<T>>,
    { success, successDetail, onSuccess }: RunActionOptions<T> = {},
  ): Promise<T | null> => {
    setBusy(true);
    try {
      const res = await fn();
      if (!res?.ok) {
        toast(res?.code === 'FORBIDDEN' ? 'Not permitted' : 'Could not complete', res?.error, 'err');
        return null;
      }
      if (success) {
        toast(success, typeof successDetail === 'function' ? successDetail(res.data) : successDetail, 'ok');
      }
      onSuccess?.(res.data);
      router.refresh();
      return res.data;
    } finally {
      setBusy(false);
    }
  };

  return { runAction, busy };
}

export interface ActionButtonProps<T> extends RunActionOptions<T> {
  action: () => Promise<ActionResult<T>>;
  children: ReactNode;
  className?: string;
}

/** Button that runs a Server Action and disables itself while it is in flight. */
export function ActionButton<T>({ action, children, className = 'btn', ...opts }: ActionButtonProps<T>) {
  const { runAction, busy } = useAction();
  return (
    <button type="button" className={className} disabled={busy} onClick={() => runAction(action, opts)}>
      {children}
    </button>
  );
}
