'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button, for an action that can't be walked back (e.g. rejecting outright). */
  danger?: boolean;
}

export type ConfirmFn = (options: ConfirmOptions | string) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(async () => true);

/**
 * An appealing, centered "are you sure?" gate for actions that can't be undone from the
 * screen the button sits on — processing an approved request into its real-world effect
 * (opening/deactivating/activating an account, creating a member, applying an edit).
 * `await confirm(...)` resolves `true` only once the user actually clicks through; a
 * `false` (Cancel, backdrop click, or Escape) means the caller should just return.
 */
export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    setOptions(typeof opts === 'string' ? { title: opts } : opts);
    return new Promise<boolean>((resolve) => { resolveRef.current = resolve; });
  }, []);

  const settle = useCallback((value: boolean) => {
    setOptions(null);
    resolveRef.current?.(value);
    resolveRef.current = null;
  }, []);

  useEffect(() => {
    if (!options) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') settle(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [options, settle]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && typeof document !== 'undefined' ? createPortal(
        <div className="result-back" onMouseDown={(e) => { if (e.target === e.currentTarget) settle(false); }}>
          <div className="result-card" role="alertdialog" aria-modal="true" aria-label={options.title}>
            <div className="result-icon">?</div>
            <div className="result-title">{options.title}</div>
            {options.message ? <div className="result-message">{options.message}</div> : null}
            <div className="confirm-actions">
              <button type="button" className="btn ghost" onClick={() => settle(false)}>
                {options.cancelLabel ?? 'Cancel'}
              </button>
              <button
                type="button"
                className={options.danger ? 'btn danger' : 'btn'}
                onClick={() => settle(true)}
                autoFocus
              >
                {options.confirmLabel ?? 'OK, continue'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </ConfirmContext.Provider>
  );
}

/** `const ok = await confirm('Title')` or `confirm({ title, message, confirmLabel, danger })`. */
export const useConfirm = (): ConfirmFn => useContext(ConfirmContext);
