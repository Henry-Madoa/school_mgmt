'use client';

import {
  createContext, useCallback, useContext, useEffect, useState, type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';

interface NavState {
  /** Mobile/tablet off-canvas drawer. */
  open: boolean;
  toggle: () => void;
  close: () => void;
  /** Desktop: the permanent sidebar column is hidden. Defaults to false (shown). */
  desktopHidden: boolean;
  hideDesktop: () => void;
  showDesktop: () => void;
}

const NavContext = createContext<NavState>({
  open: false, toggle: () => {}, close: () => {},
  desktopHidden: false, hideDesktop: () => {}, showDesktop: () => {},
});

const DESKTOP_HIDDEN_KEY = 'nav-desktop-hidden';

/**
 * Drives the off-canvas sidebar on phones and tablets, and — on desktop — whether
 * the permanent sidebar column is shown or hidden.
 *
 * The mobile toggle lives in the top bar and the drawer is a sibling of it, so the
 * open flag has to sit above both. Above the breakpoint the sidebar is always
 * visible unless the user hides it with the button in its header; that preference
 * is remembered per browser and starts *shown* on every fresh render.
 */
export function NavProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [desktopHidden, setDesktopHidden] = useState(false);
  const pathname = usePathname();

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((o) => !o), []);

  const hideDesktop = useCallback(() => {
    setDesktopHidden(true);
    try { localStorage.setItem(DESKTOP_HIDDEN_KEY, '1'); } catch { /* storage unavailable */ }
  }, []);
  const showDesktop = useCallback(() => {
    setDesktopHidden(false);
    try { localStorage.setItem(DESKTOP_HIDDEN_KEY, '0'); } catch { /* storage unavailable */ }
  }, []);

  // Server render can't know a returning user's preference — it always starts
  // shown, then this reconciles from localStorage right after mount.
  useEffect(() => {
    try {
      if (localStorage.getItem(DESKTOP_HIDDEN_KEY) === '1') setDesktopHidden(true);
    } catch { /* ignore unavailable storage */ }
  }, []);

  // The sidebar column, modal centring and record-nav offsets all key off this
  // class; putting it on <body> keeps portaled elements (modals) in step.
  useEffect(() => {
    document.body.classList.toggle('nav-hidden', desktopHidden);
    return () => document.body.classList.remove('nav-hidden');
  }, [desktopHidden]);

  // Tapping a nav link should navigate *and* dismiss the drawer.
  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    // The drawer covers the page; letting the page scroll underneath it reads
    // as the whole app sliding away.
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  return (
    <NavContext.Provider value={{ open, toggle, close, desktopHidden, hideDesktop, showDesktop }}>
      {children}
    </NavContext.Provider>
  );
}

export const useNav = (): NavState => useContext(NavContext);
