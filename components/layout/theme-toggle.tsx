'use client';

import { useEffect, useState } from 'react';

type Mode = 'light' | 'dark';

const STORAGE_KEY = 'theme-mode';

/**
 * Per-user light/dark toggle, independent of the admin's brand preset.
 *
 * `document.documentElement.dataset.mode` is already set before hydration by
 * the inline script in the root layout, so the initial render here always
 * matches the server ('light') and the real mode is picked up in an effect —
 * that keeps hydration consistent instead of guessing at render time.
 */
export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>('light');

  useEffect(() => {
    setMode((document.documentElement.dataset.mode as Mode) || 'light');
  }, []);

  const toggle = () => {
    const next: Mode = mode === 'dark' ? 'light' : 'dark';
    setMode(next);
    document.documentElement.dataset.mode = next;
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* private mode etc. */ }
  };

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      title={mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      <span aria-hidden="true">{mode === 'dark' ? '☀️' : '🌙'}</span>
    </button>
  );
}
