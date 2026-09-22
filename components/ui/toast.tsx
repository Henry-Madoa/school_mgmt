'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { GlobalErrorListener } from './global-error-listener';

export type ToastKind = '' | 'ok' | 'err';
export type ToastFn = (title: string, message?: string, kind?: ToastKind) => void;

interface ToastItem {
  id: number;
  title: string;
  message?: string;
  kind: ToastKind;
  leaving?: boolean;
}

const ToastContext = createContext<ToastFn>(() => {});

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 300);
  }, []);

  const toast = useCallback<ToastFn>((title, message, kind = '') => {
    const id = ++nextId;
    setToasts((list) => [...list, { id, title, message, kind }]);
    // Errors linger: they usually carry a sentence the user needs to read.
    setTimeout(() => dismiss(id), kind === 'err' ? 6500 : 3800);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={toast}>
      <GlobalErrorListener />
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind} ${t.leaving ? 'leaving' : ''}`}>
            <div className="t">{t.title}</div>
            {t.message ? <div className="m">{t.message}</div> : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** `toast(title, message?, 'ok' | 'err' | '')` */
export const useToast = (): ToastFn => useContext(ToastContext);
