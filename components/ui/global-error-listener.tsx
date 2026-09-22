'use client';

import { useEffect } from 'react';
import { useToast } from './toast';

// Errors that are routine noise, not something a teller needs to see.
const IGNORED_NAMES = new Set(['AbortError']);

/**
 * Safety net for errors that never reach a React error boundary — a rejected
 * promise nobody awaited (e.g. a `.then()` with no `.catch()`), or an
 * exception thrown from an event handler or timer. Without this, those fail
 * silently: the console gets a line nobody reads, and the user just sees a
 * button that did nothing.
 *
 * Rendering failures are already handled by error.tsx / global-error.tsx —
 * this only covers what happens outside the render cycle.
 */
export function GlobalErrorListener() {
  const toast = useToast();

  useEffect(() => {
    let lastMessage = '';
    let lastAt = 0;

    const report = (message: string) => {
      const now = Date.now();
      if (message === lastMessage && now - lastAt < 4000) return;
      lastMessage = message;
      lastAt = now;
      toast('Something went wrong', message, 'err');
    };

    const onError = (event: ErrorEvent) => {
      if (event.error?.name && IGNORED_NAMES.has(event.error.name)) return;
      report(event.error?.message || event.message || 'Unexpected error');
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      if (reason?.name && IGNORED_NAMES.has(reason.name)) return;
      const message = reason instanceof Error ? reason.message
        : typeof reason === 'string' ? reason : 'Unexpected error';
      report(message);
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, [toast]);

  return null;
}
