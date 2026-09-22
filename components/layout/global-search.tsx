'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import type { SearchEntry } from '@/lib/globalSearch';

/*
 * Business Central's "Tell Me": Alt+Q (or Ctrl+K, or the top-bar button) opens a palette; type
 * a few letters of any page's name and Enter opens it. The index arrives from the server
 * already filtered to what this user may open (lib/globalSearch.ts), so nothing here decides
 * permissions. Provider sits in the AppShell; the button sits in each page's top bar.
 */

interface SearchState { open: () => void }
const SearchContext = createContext<SearchState | null>(null);

const RECENT_KEY = 'tell-me-recent';
const RECENT_MAX = 6;

export function GlobalSearchProvider({ entries, children }: { entries: SearchEntry[]; children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const open = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.altKey && e.key.toLowerCase() === 'q') || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <SearchContext.Provider value={{ open }}>
      {children}
      {isOpen ? <SearchPalette entries={entries} onClose={close} /> : null}
    </SearchContext.Provider>
  );
}

/** The top-bar trigger — renders nothing on pages outside the shell (no provider). */
export function GlobalSearchButton() {
  const ctx = useContext(SearchContext);
  if (!ctx) return null;
  return (
    <button type="button" className="tell-me-btn" onClick={ctx.open} aria-label="Search pages (Alt+Q)" title="Search pages (Alt+Q)">
      <span aria-hidden="true">🔍</span>
      <span className="tell-me-btn-label">Search pages…</span>
      <kbd className="tell-me-kbd" aria-hidden="true">Alt+Q</kbd>
    </button>
  );
}

/* --------------------------------------------------------------------------- matching */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Every typed word must appear in the label, trail or keywords. Rank: whole-label prefix, then
 * a word-start match in the label, then anywhere in the label, then a trail/keyword-only hit —
 * so "mem app" puts Member Application above Member Applications' cousins.
 */
function score(entry: SearchEntry, words: string[]): number {
  const label = norm(entry.label);
  const rest = norm(`${entry.trail} ${entry.keywords ?? ''}`);
  let total = 0;
  for (const w of words) {
    if (label.startsWith(w)) total += 4;
    else if (label.split(' ').some((p) => p.startsWith(w))) total += 3;
    else if (label.includes(w)) total += 2;
    else if (rest.split(' ').some((p) => p.startsWith(w)) || rest.includes(w)) total += 1;
    else return 0;
  }
  return total;
}

function readRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}
function pushRecent(path: string) {
  try {
    const next = [path, ...readRecent().filter((p) => p !== path)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* ignore */ }
}

/* --------------------------------------------------------------------------- the palette */

function SearchPalette({ entries, onClose }: { entries: SearchEntry[]; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setRecent(readRecent()); inputRef.current?.focus(); }, []);

  const results = useMemo(() => {
    const words = norm(q).split(' ').filter(Boolean);
    if (!words.length) {
      // Nothing typed: the pages the user went to last, then the rest in sidebar order.
      const byPath = new Map(entries.map((e) => [e.path, e]));
      const rec = recent.map((p) => byPath.get(p)).filter((e): e is SearchEntry => !!e);
      return [...rec, ...entries.filter((e) => !recent.includes(e.path))].slice(0, 12);
    }
    return entries
      .map((e) => ({ e, s: score(e, words) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s || a.e.label.localeCompare(b.e.label))
      .slice(0, 30)
      .map((r) => r.e);
  }, [q, entries, recent]);

  useEffect(() => { setCursor(0); }, [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const go = (entry: SearchEntry) => {
    pushRecent(entry.path);
    onClose();
    router.push(entry.path);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (results[cursor]) go(results[cursor]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  const showingRecent = !norm(q) && recent.length > 0;

  return (
    <div className="tell-me-back" onClick={onClose} role="presentation">
      <div className="tell-me" role="dialog" aria-modal="true" aria-label="Search pages" onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="tell-me-input">
          <span aria-hidden="true">🔍</span>
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search for a page or setup screen…"
            aria-label="Search pages" autoComplete="off" spellCheck={false} />
          <button type="button" className="btn ghost sm" onClick={onClose} aria-label="Close">Esc</button>
        </div>
        <div className="tell-me-list" ref={listRef} role="listbox">
          {showingRecent ? <div className="tell-me-caption">Recently opened</div> : null}
          {results.length ? results.map((r, i) => (
            <button type="button" key={r.path} data-index={i} role="option" aria-selected={i === cursor}
              className={`tell-me-row ${i === cursor ? 'active' : ''}`}
              onMouseEnter={() => setCursor(i)} onClick={() => go(r)}>
              <span className="tell-me-ico" aria-hidden="true">{r.icon || '▫'}</span>
              <span className="tell-me-text">
                <span className="tell-me-label">{r.label}</span>
                <span className="tell-me-trail">{r.trail}</span>
              </span>
              {showingRecent && i < recent.length && recent.includes(r.path) ? <span className="tiny muted-cell">recent</span> : null}
            </button>
          )) : <div className="tell-me-empty">No page matches “{q}”</div>}
        </div>
        <div className="tell-me-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>Enter</kbd> open</span>
          <span><kbd>Esc</kbd> close</span>
          <span className="spacer" />
          <span>{entries.length} pages</span>
        </div>
      </div>
    </div>
  );
}
