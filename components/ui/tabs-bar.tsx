'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';

const SCROLL_KEY_PREFIX = 'tabs-scroll-left:';

/**
 * The scrollable strip behind every horizontal tab bar. A server-rendered bar is replaced on each
 * navigation and comes back scrolled to its first tab, so this puts the strip back where the user
 * left it and then nudges only as far as needed to keep the active tab in view — the bar stays
 * parked on what was just clicked. `id` keys the remembered position (one per bar); a bar without
 * one only gets the keep-visible behaviour.
 */
export function TabsBar({ id, active, children }: { id?: string; active: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (id) {
      try {
        const saved = sessionStorage.getItem(SCROLL_KEY_PREFIX + id);
        if (saved) el.scrollLeft = Number(saved);
      } catch { /* unavailable storage: still keep the active tab visible */ }
    }
    const current = el.querySelector<HTMLElement>('.active');
    if (!current) return;
    const a = current.getBoundingClientRect();
    const c = el.getBoundingClientRect();
    if (a.left < c.left) el.scrollLeft -= c.left - a.left + 8;
    else if (a.right > c.right) el.scrollLeft += a.right - c.right + 8;
  }, [id, active]);

  const remember = () => {
    if (!id) return;
    try { sessionStorage.setItem(SCROLL_KEY_PREFIX + id, String(ref.current?.scrollLeft ?? 0)); } catch { /* ignore */ }
  };

  return (
    <div className="tabs" ref={ref} onScroll={remember}>
      {children}
    </div>
  );
}
