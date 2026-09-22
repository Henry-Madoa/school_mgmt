'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type ResultKind = '' | 'ok' | 'err';
export type ResultFn = (title: string, message?: string, kind?: ResultKind) => void;

interface ResultItem {
  id: number;
  title: string;
  message?: string;
  kind: ResultKind;
  leaving?: boolean;
}

const ResultContext = createContext<ResultFn>(() => {});

let nextId = 0;

const ICON: Record<ResultKind, string> = { ok: '✓', err: '✕', '': 'ℹ' };
/** Errors linger longer: they usually carry a sentence the user needs to read. */
const DURATION: Record<ResultKind, number> = { ok: 4200, err: 7000, '': 4200 };

/**
 * An appealing, centered pop-up for workflow decisions (send for approval, approve, reject,
 * delegate, process) and document posting (deposits, withdrawals, reversals, journal entries,
 * disbursements, repayments) — deliberately more prominent than the small corner .toast
 * (components/ui/toast.tsx), which stays the default for everything else (uploads, admin
 * config saves, profile edits). Multiple calls queue: only the oldest is ever shown, so a
 * burst of actions doesn't throw several cards on top of each other.
 */
export function ResultDialogProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<ResultItem[]>([]);
  const current = queue[0] ?? null;

  const dismiss = useCallback((id: number) => {
    setQueue((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setQueue((list) => list.filter((t) => t.id !== id)), 180);
  }, []);

  const showResult = useCallback<ResultFn>((title, message, kind = '') => {
    setQueue((list) => [...list, { id: ++nextId, title, message, kind }]);
  }, []);

  // Auto-dismiss the card currently on screen — restarts cleanly whenever a new one
  // rotates in, and never fires again once a card has already started leaving.
  useEffect(() => {
    if (!current || current.leaving) return;
    const timer = setTimeout(() => dismiss(current.id), DURATION[current.kind]);
    return () => clearTimeout(timer);
  }, [current, dismiss]);

  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(current.id); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [current, dismiss]);

  return (
    <ResultContext.Provider value={showResult}>
      {children}
      {current && typeof document !== 'undefined' ? createPortal(
        <div
          className="result-back"
          onMouseDown={(e) => { if (e.target === e.currentTarget) dismiss(current.id); }}
        >
          <div
            className={`result-card ${current.kind} ${current.leaving ? 'leaving' : ''}`}
            role="alertdialog"
            aria-live="assertive"
          >
            <button type="button" className="result-close" onClick={() => dismiss(current.id)} aria-label="Close">
              &times;
            </button>
            <div className={`result-icon ${current.kind}`}>{ICON[current.kind]}</div>
            <div className="result-title">{current.title}</div>
            {current.message ? <div className="result-message">{current.message}</div> : null}
          </div>
        </div>,
        document.body,
      ) : null}
    </ResultContext.Provider>
  );
}

/** `showResult(title, message?, 'ok' | 'err' | '')` — the centered pop-up. Use for workflow
 *  decisions and document posting only; use useToast() from components/ui/toast.tsx for
 *  everything else. */
export const useResultDialog = (): ResultFn => useContext(ResultContext);
