'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useFormStatus } from 'react-dom';
import { initials } from '@/lib/format';
import { signOut } from '@/app/actions/auth';

type Mode = 'light' | 'dark';
const STORAGE_KEY = 'theme-mode';

/* The usual sign-out mark: you step out through the door frame, so the arrow points away from it. */
function SignOutIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

function SignOutItem() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="doc-actions-item sign-out-item" role="menuitem" disabled={pending}>
      <SignOutIcon /> {pending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}

/**
 * The avatar at the right of the top bar, and the menu under it: who is signed in, My Settings,
 * the light/dark switch and Sign out. One control instead of four keeps the bar readable on a
 * laptop screen. `document.documentElement.dataset.mode` is set before hydration by the root
 * layout's inline script, so the mode is read in an effect to keep hydration consistent.
 */
export function UserMenu({ fullName, roleName }: { fullName: string; roleName: string }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('light');
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMode((document.documentElement.dataset.mode as Mode) || 'light'); }, []);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const toggleTheme = () => {
    const next: Mode = mode === 'dark' ? 'light' : 'dark';
    setMode(next);
    document.documentElement.dataset.mode = next;
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* private mode etc. */ }
  };

  return (
    <div className="user-menu" ref={boxRef}>
      <button type="button" className="user-menu-btn" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}
        title={`${fullName} — ${roleName}`}>
        <span className="whoami">
          <span className="who">{fullName}</span>
          <span className="role">{roleName}</span>
        </span>
        <span className="avatar" aria-hidden="true">{initials(fullName)}</span>
      </button>
      {open ? (
        <div className="user-menu-panel" role="menu">
          <div className="user-menu-head">
            <div className="who">{fullName}</div>
            <div className="role">{roleName}</div>
          </div>
          <Link href="/my-settings" className="doc-actions-item" role="menuitem" onClick={() => setOpen(false)}>
            <span aria-hidden="true">⚙️</span> My Settings
          </Link>
          <button type="button" className="doc-actions-item" role="menuitem" onClick={toggleTheme}>
            <span aria-hidden="true">{mode === 'dark' ? '☀️' : '🌙'}</span> {mode === 'dark' ? 'Light theme' : 'Dark theme'}
          </button>
          <div className="user-menu-sep" />
          <form action={signOut}><SignOutItem /></form>
        </div>
      ) : null}
    </div>
  );
}
