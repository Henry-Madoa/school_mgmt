'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { initials } from '@/lib/format';
import { NAV, isSubMenu, groupInRoleCentre, type NavItem } from '@/lib/nav';
import { useNav } from './nav-context';
import { ExploreAllLink } from './role-explorer';
import type { OrgBrand, SessionUser } from '@/lib/types';

const COLLAPSED_GROUPS_KEY = 'nav-collapsed-groups';
const SCROLL_KEY = 'nav-scroll-top';

export interface SidebarProps {
  org: OrgBrand;
  user: SessionUser;
  /** Nav paths this user may see — resolved on the server so the permission
   *  list never reaches the browser. */
  allowedPaths: string[];
  badges?: Partial<Record<'pendingApprovals', number>>;
}

export function Sidebar({ org, user, allowedPaths, badges = {} }: SidebarProps) {
  const pathname = usePathname();
  const { open, close, hideDesktop } = useNav();
  const name = org.short_name || org.name || 'School';

  // Business Central: the active Profile / Role Centre defines the navigation. The Super Role
  // Centre shows every group; a specialised one shows only its own area (plus the groups every
  // centre gets). Permission filtering below still applies on top.
  const centre = user.activeProfile.role_centre;
  const visibleGroups = NAV.filter((g) => groupInRoleCentre(g, centre));

  // The header button hides the permanent column on desktop; on the mobile
  // drawer it simply closes it (the hamburger in the top bar reopens either).
  const hide = () => {
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 901px)').matches) hideDesktop();
    else close();
  };

  // One set drives both the group headers and the nested sub-menus: a key present here means the
  // user has collapsed it. Everything starts expanded (matching the server render), then this
  // reconciles from localStorage right after mount.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);
  const asideRef = useRef<HTMLElement>(null);

  // A layout effect so the remembered collapse state is applied before the first paint — this
  // column remounts on every cross-area navigation (see below), and a plain effect would show
  // every collapsed group snapping shut each time.
  useLayoutEffect(() => {
    try {
      const saved = localStorage.getItem(COLLAPSED_GROUPS_KEY);
      if (saved) setCollapsed(new Set(JSON.parse(saved)));
    } catch { /* ignore malformed/unavailable storage */ }
    setHydrated(true);
  }, []);

  // Every top-level route has its own layout wrapping AppShell, so crossing from e.g. /students to
  // /fees unmounts this column and mounts a fresh <aside> scrolled to the top. Put the scroll
  // back where the user left it, then nudge only as far as needed to keep the current page's link
  // on screen. Runs once the collapse state is in so it measures the real layout.
  useLayoutEffect(() => {
    if (!hydrated) return;
    const el = asideRef.current;
    if (!el) return;
    try {
      const saved = sessionStorage.getItem(SCROLL_KEY);
      if (saved) el.scrollTop = Number(saved);
    } catch { /* unavailable storage: still keep the active link visible */ }
    const active = el.querySelector<HTMLElement>('.nav a.active');
    if (!active) return;
    const a = active.getBoundingClientRect();
    const c = el.getBoundingClientRect();
    if (a.top < c.top) el.scrollTop -= c.top - a.top + 8;
    else if (a.bottom > c.bottom) el.scrollTop += a.bottom - c.bottom + 8;
  }, [hydrated, pathname]);

  const rememberScroll = () => {
    try { sessionStorage.setItem(SCROLL_KEY, String(asideRef.current?.scrollTop ?? 0)); } catch { /* ignore */ }
  };

  const toggleGroup = (group: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group); else next.add(group);
      localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  /**
   * Only the most specific entry lights up. A prefix match alone would leave "Customers"
   * (/receivables) highlighted on every one of its siblings (/receivables/quotes, …), so an
   * entry that is merely an ancestor of a longer matching entry stands down.
   */
  const bestMatch = useMemo(() => {
    const paths = visibleGroups.flatMap((g) => g.items.flatMap((e) => (isSubMenu(e) ? e.items : [e])))
      .map((i) => i.path)
      .filter((p) => pathname === p || pathname.startsWith(`${p}/`));
    return paths.sort((a, b) => b.length - a.length)[0] ?? null;
  }, [pathname, visibleGroups]);

  const isActive = (path: string) => path === bestMatch;

  const renderLink = (item: NavItem) => {
    const active = isActive(item.path);
    const badge = item.badge ? badges[item.badge] : 0;
    return (
      <Link key={item.path} href={item.path} className={active ? 'active' : ''}
        aria-current={active ? 'page' : undefined}>
        <span className="ico" aria-hidden="true">{item.icon}</span>
        {item.label}
        {badge ? <span className="badge">{badge}</span> : null}
      </Link>
    );
  };

  const renderSubMenu = (group: string, sub: { submenu: string; icon: string; items: NavItem[] }) => {
    const key = `sub:${group}:${sub.submenu}`;
    const hasActiveChild = sub.items.some((c) => isActive(c.path));
    // Expanded by default (like the groups); a user collapse is remembered, but an active child
    // always forces it open so the current page is never hidden.
    const open = hasActiveChild || !collapsed.has(key);
    const bodyId = `nav-sub-${key.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
    return (
      <div className="nav-submenu" key={key}>
        <button type="button" className={`nav-submenu-head ${hasActiveChild ? 'active' : ''}`}
          aria-expanded={open} aria-controls={bodyId} onClick={() => toggleGroup(key)}>
          <span className="ico" aria-hidden="true">{sub.icon}</span>
          {sub.submenu}
          <span className="chev" aria-hidden="true">›</span>
        </button>
        <div id={bodyId} className={`nav-submenu-body ${open ? '' : 'collapsed'}`}>
          <div className="nav-submenu-body-inner">
            {sub.items.map(renderLink)}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Backdrop only exists while the drawer is open, so it cannot swallow
          clicks on the desktop layout. */}
      {open ? <div className="nav-backdrop" onClick={close} aria-hidden="true" /> : null}

      <aside id="app-sidebar" ref={asideRef} onScroll={rememberScroll}
        className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-head">
          <Link href="/dashboard" className="sidebar-brand" onClick={close}>
            {org.logo ? <img src={org.logo} alt="" /> : <div className="mark">{initials(name)}</div>}
            <div>
              <div className="name">{name}</div>
              <div className="sub">Core Banking System</div>
            </div>
          </Link>
          <button type="button" className="sidebar-collapse" onClick={hide}
            aria-label="Hide sidebar" title="Hide sidebar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M13 6l-6 6 6 6M19 6l-6 6 6 6" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {user.profiles.length > 1 ? (
          <Link href="/my-settings" className="nav-role-centre" onClick={close}>
            <span className="ico" aria-hidden="true">{user.activeProfile.icon || '▤'}</span>
            <span>
              <span className="tiny muted-cell" style={{ display: 'block' }}>Role Centre</span>
              {user.activeProfile.name}
            </span>
            <span className="chev" aria-hidden="true">›</span>
          </Link>
        ) : null}

        <ExploreAllLink className="nav-explore">
          <span className="ico" aria-hidden="true">☰</span>
          Explore all
          <span className="chev" aria-hidden="true">›</span>
        </ExploreAllLink>

        <nav className="nav">
          {visibleGroups.map((group) => {
            // Keep an entry only if it (or, for a sub-menu, one of its children) is allowed.
            const entries = group.items
              .map((e) => (isSubMenu(e) ? { ...e, items: e.items.filter((c) => allowedPaths.includes(c.path)) } : e))
              .filter((e) => (isSubMenu(e) ? e.items.length : allowedPaths.includes(e.path)));
            if (!entries.length) return null;
            const isCollapsed = collapsed.has(group.group);
            const bodyId = `nav-group-${group.group.replace(/\s+/g, '-').toLowerCase()}`;
            return (
              <div key={group.group}>
                <button type="button" className="nav-group" aria-expanded={!isCollapsed} aria-controls={bodyId}
                  onClick={() => toggleGroup(group.group)}>
                  {group.group}
                </button>
                <div id={bodyId} className={`nav-group-body ${isCollapsed ? 'collapsed' : ''}`}>
                  <div className="nav-group-body-inner">
                    {entries.map((entry) => (
                      isSubMenu(entry)
                        ? renderSubMenu(group.group, entry)
                        : renderLink(entry)
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          Signed in as {user.username}<br />{user.role_name}
        </div>
      </aside>
    </>
  );
}
