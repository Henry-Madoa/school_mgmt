/*
 * Global search — Business Central's "Tell Me" (Alt+Q): type a few letters and jump to any page
 * in the system. The index is built on the server for the signed-in user so it only ever lists
 * what they may open: the sidebar pages (lib/nav.ts, through canNav like the sidebar itself),
 * the Admin Centre and every Setup Pool screen (lib/adminNav.ts), and a few report tabs that
 * live under one sidebar entry.
 */
import { NAV, isSubMenu } from './nav.ts';
import { ADMIN_TABS, POOL_GROUPS, WORKFLOW_TABS, SECURITY_TABS, DATA_TABS, COMPANY_TABS, hasTabAccess } from './adminNav.ts';
import { canNav, canPage } from './permissions.ts';
import type { SessionUser } from './types.ts';

export interface SearchEntry {
  /** What the user is looking for — the page's label. */
  label: string;
  path: string;
  /** Where it lives, for the eye: "HR & Payroll › Organisation". */
  trail: string;
  icon?: string;
  /** Extra words the entry answers to (the AL/BC name, synonyms). */
  keywords?: string;
}

/** Sidebar-less screens worth reaching by name — each tab of a page that is one nav entry. */
const EXTRA: { path: string; label: string; trail: string; page: string; keywords?: string }[] = [
  { path: '/reports/balance-sheet', label: 'Statement of Financial Position', trail: 'Financial Reports › Financial Statements', page: 'REPORTS', keywords: 'balance sheet' },
  { path: '/reports/income', label: 'Statement of Comprehensive Income', trail: 'Financial Reports › Financial Statements', page: 'REPORTS', keywords: 'profit and loss income statement' },
  { path: '/students/new', label: 'Admit a Student', trail: 'Academics › Students', page: 'STUDENTS', keywords: 'admission new student enrol' },
  { path: '/my-settings', label: 'My Settings', trail: 'Account', page: 'DASHBOARD', keywords: 'role centre profile password' },
];

export function buildSearchIndex(user: SessionUser): SearchEntry[] {
  const out: SearchEntry[] = [];
  const seen = new Set<string>();
  const add = (e: SearchEntry) => { if (!seen.has(e.path)) { seen.add(e.path); out.push(e); } };

  // The sidebar's pages — every Role Centre's, not just the active one: search is how a user
  // reaches a page their current Role Centre doesn't list but their permissions allow.
  for (const g of NAV) {
    for (const entry of g.items) {
      if (isSubMenu(entry)) {
        for (const i of entry.items) if (canNav(user, i.page)) add({ label: i.label, path: i.path, trail: `${g.group} › ${entry.submenu}`, icon: i.icon });
      } else if (canNav(user, entry.page)) {
        add({ label: entry.label, path: entry.path, trail: g.group, icon: entry.icon });
      }
    }
  }

  // Admin Centre: its tabs, then every Setup Pool screen and the Workflow / Security sub-tabs.
  const admin = 'Admin Centre';
  for (const t of ADMIN_TABS) if (hasTabAccess(user, t)) add({ label: t.label, path: `/admin/${t.key}`, trail: admin, icon: '⚙', keywords: t.key === 'data' ? 'configuration package import export' : undefined });
  for (const g of POOL_GROUPS) {
    for (const s of g.screens) {
      if (hasTabAccess(user, s)) add({ label: s.label, path: `/admin/pool/${g.key}/${s.key}`, trail: `${admin} › Setup Pool › ${g.label}`, icon: '🗂' });
    }
  }
  for (const t of COMPANY_TABS) if (t.key !== 'information' && hasTabAccess(user, t)) add({ label: t.label, path: `/admin/company/${t.key}`, trail: `${admin} › Company Information`, icon: '🏢', keywords: 'copy company new company test company' });
  for (const t of WORKFLOW_TABS) if (hasTabAccess(user, t)) add({ label: t.label, path: `/admin/workflows/${t.key}`, trail: `${admin} › Workflow Management`, icon: '🔁' });
  for (const t of SECURITY_TABS) if (hasTabAccess(user, t)) add({ label: t.label, path: `/admin/security/${t.key}`, trail: `${admin} › System Security`, icon: '🔐' });
  for (const t of DATA_TABS) if (t.key !== 'management' && hasTabAccess(user, t)) add({ label: t.label, path: `/admin/data/${t.key}`, trail: `${admin} › Data Management`, icon: '🔌', keywords: 'integration odata soap web service api' });

  for (const e of EXTRA) if (canPage(user, e.page)) add({ label: e.label, path: e.path, trail: e.trail, keywords: e.keywords, icon: '📄' });

  return out;
}
