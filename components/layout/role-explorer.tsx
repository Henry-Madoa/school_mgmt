'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import Link from 'next/link';
import type { ExplorerArea, ExplorerGroup, ExplorerKind } from '@/lib/roleExplorer';

/*
 * Business Central's Role Explorer ("Explore all"): the ☰ button opens a full-screen map of the
 * application — every Role Centre profile as an area, its feature groups with page counts,
 * "› Explore" to open a whole area, a group heading to open just that group, and the user's own
 * Role Centre highlighted. The All / Reports & Analysis / Administration tabs and the Find box
 * narrow what is shown, as in BC. Data arrives from the server already permission-filtered
 * (lib/roleExplorer.ts). Provider lives in the AppShell; buttons anywhere inside open it.
 */

interface ExplorerState { open: () => void }
const ExplorerContext = createContext<ExplorerState | null>(null);

export function RoleExplorerProvider({ areas, orgName, children }: { areas: ExplorerArea[]; orgName: string; children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const open = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  return (
    <ExplorerContext.Provider value={{ open }}>
      {children}
      {isOpen ? <RoleExplorer areas={areas} orgName={orgName} onClose={close} /> : null}
    </ExplorerContext.Provider>
  );
}

/** The three-bar button in the top bar. Renders nothing outside the shell. */
export function RoleExplorerButton({ className = 'explore-btn' }: { className?: string }) {
  const ctx = useContext(ExplorerContext);
  if (!ctx) return null;
  return (
    <button type="button" className={className} onClick={ctx.open} aria-label="Explore all pages" title="Explore all">
      <span className="bars" aria-hidden="true"><i /><i /><i /></span>
    </button>
  );
}

/** A text link for the sidebar and Role Centre pages ("Explore all"). */
export function ExploreAllLink({ className, children }: { className?: string; children: ReactNode }) {
  const ctx = useContext(ExplorerContext);
  if (!ctx) return null;
  return <button type="button" className={className} onClick={ctx.open}>{children}</button>;
}

/* ------------------------------------------------------------------------ the explorer */

type Tab = 'all' | 'reports' | 'admin';
const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'reports', label: 'Reports & Analysis' }, { key: 'admin', label: 'Administration' },
];
const tabAccepts = (tab: Tab, kind: ExplorerKind) => tab === 'all' || (tab === 'reports' ? kind === 'report' : kind === 'admin');

const norm = (s: string) => s.toLowerCase();

function RoleExplorer({ areas, orgName, onClose }: { areas: ExplorerArea[]; orgName: string; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('all');
  const [find, setFind] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const findRef = useRef<HTMLInputElement>(null);

  // Esc closes; the page underneath stops scrolling while the explorer is up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  // The tab and the Find box narrow the tree; a group or area with nothing left disappears.
  const visible = useMemo(() => {
    const q = norm(find.trim());
    const out: ExplorerArea[] = [];
    for (const a of areas) {
      if (tab === 'admin' && a.key !== 'administration') continue;
      if (tab === 'reports' && a.key === 'administration') continue;
      const groups: ExplorerGroup[] = [];
      for (const g of a.groups) {
        const pages = g.pages.filter((p) => tabAccepts(tab, p.kind)
          && (!q || norm(p.label).includes(q) || norm(g.name).includes(q) || norm(a.title).includes(q) || norm(p.section ?? '').includes(q)));
        if (pages.length) groups.push({ ...g, pages });
      }
      if (groups.length) out.push({ ...a, groups });
    }
    return out;
  }, [areas, tab, find]);

  const searching = find.trim().length > 0;
  const keyOf = (a: ExplorerArea, g: ExplorerGroup) => `${a.key}::${g.name}`;
  const isOpen = (a: ExplorerArea, g: ExplorerGroup) => searching || expanded.has(keyOf(a, g));
  const toggleGroup = (a: ExplorerArea, g: ExplorerGroup) => setExpanded((prev) => {
    const next = new Set(prev); const k = keyOf(a, g);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });
  const setArea = (a: ExplorerArea, open: boolean) => setExpanded((prev) => {
    const next = new Set(prev);
    for (const g of a.groups) { const k = keyOf(a, g); if (open) next.add(k); else next.delete(k); }
    return next;
  });
  const setAll = (open: boolean) => setExpanded(open ? new Set(visible.flatMap((a) => a.groups.map((g) => keyOf(a, g)))) : new Set());

  const totalPages = visible.reduce((n, a) => n + a.groups.reduce((m, g) => m + g.pages.length, 0), 0);

  return (
    <div className="rx-back" role="dialog" aria-modal="true" aria-label="Explore all pages">
      <header className="rx-head">
        <div className="rx-brand">
          <span className="bars" aria-hidden="true"><i /><i /><i /></span>
          <Link href="/dashboard" className="rx-org" onClick={onClose} title="Go to my Role Centre">{orgName}</Link>
        </div>
        <nav className="rx-tabs" aria-label="Explorer views">
          {TABS.map((t) => (
            <button type="button" key={t.key} className={t.key === tab ? 'active' : ''} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </nav>
        <label className="rx-find">
          <span aria-hidden="true">🔍</span>
          <input ref={findRef} value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find" aria-label="Find a page" autoComplete="off" />
          {find ? <button type="button" className="rx-clear" onClick={() => { setFind(''); findRef.current?.focus(); }} aria-label="Clear">✕</button> : null}
        </label>
        <div className="rx-tools">
          <button type="button" className="btn ghost sm" onClick={() => setAll(true)}>Expand all</button>
          <button type="button" className="btn ghost sm" onClick={() => setAll(false)}>Collapse all</button>
          <button type="button" className="rx-close" onClick={onClose} aria-label="Close explorer" title="Close (Esc)">✕</button>
        </div>
      </header>

      <div className="rx-body">
        {visible.length ? (
          <div className="rx-columns">
            {visible.map((a) => {
              const allOpen = a.groups.every((g) => isOpen(a, g));
              const anyOpen = a.groups.some((g) => isOpen(a, g));
              return (
                <section className={`rx-area ${a.mine ? 'mine' : ''}`} key={a.key}>
                  {a.mine ? <div className="rx-mine">My Role Centre</div> : null}
                  <h3 className="rx-title">{a.icon ? <span className="rx-title-ico" aria-hidden="true">{a.icon}</span> : null}{a.title}</h3>
                  {a.description ? <div className="rx-desc">{a.description}</div> : null}
                  <button type="button" className="rx-explore" onClick={() => setArea(a, !allOpen)} aria-expanded={allOpen}>
                    <span className="chev" aria-hidden="true">›</span> {allOpen ? 'Collapse' : 'Explore'}
                  </button>
                  {a.groups.map((g) => {
                    const open = isOpen(a, g);
                    return (
                      <div className={`rx-group ${open ? 'open' : ''}`} key={g.name}>
                        <button type="button" className="rx-group-head" onClick={() => toggleGroup(a, g)} aria-expanded={open}>
                          {g.name} <span className="rx-count">({g.pages.length})</span>
                        </button>
                        {open ? <GroupPages group={g} onNavigate={onClose} /> : null}
                      </div>
                    );
                  })}
                  {anyOpen && !searching ? (
                    <button type="button" className="rx-collapse" onClick={() => setArea(a, false)} aria-label={`Collapse ${a.title}`} title="Collapse">⌃</button>
                  ) : null}
                </section>
              );
            })}
          </div>
        ) : (
          <div className="rx-empty">No page matches “{find}”{tab !== 'all' ? ' in this view' : ''}.</div>
        )}
      </div>

      <footer className="rx-foot">
        <span>{visible.length} area{visible.length === 1 ? '' : 's'} · {totalPages} page{totalPages === 1 ? '' : 's'}</span>
        <span className="spacer" />
        <span><kbd>Esc</kbd> close</span>
      </footer>
    </div>
  );
}

/** A group's pages, with each sub-menu's name as a caption over its run of pages. */
function GroupPages({ group, onNavigate }: { group: ExplorerGroup; onNavigate: () => void }) {
  const rows: ReactNode[] = [];
  let lastSection: string | undefined;
  for (const p of group.pages) {
    if (p.section && p.section !== lastSection) {
      rows.push(<li className="rx-section" key={`s:${p.section}:${p.path}`}>{p.section}</li>);
    }
    lastSection = p.section;
    rows.push(
      <li key={p.path}>
        <Link href={p.path} onClick={onNavigate}>
          <span className="rx-ico" aria-hidden="true">{p.icon || '▫'}</span>{p.label}
        </Link>
      </li>,
    );
  }
  return <ul className="rx-pages">{rows}</ul>;
}
