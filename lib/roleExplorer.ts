/*
 * Role Explorer — Business Central's "Explore all" (the ☰ button): one screen that lays out
 * every Role Centre profile in the system as an area, each with its feature groups and page
 * counts, so a user can see the whole application at once and jump anywhere. Built on the
 * server for the signed-in user: pages they cannot open are left out (same canNav rule as the
 * sidebar), and an area with nothing left is dropped.
 *
 * Areas: one per profile (its Role Centre's navigation, grouped by sidebar group), with the
 * active profile flagged as "My Role Centre"; plus System Administration — the Admin Centre's
 * screens, one group per Setup Pool category.
 */
import { NAV, isSubMenu, groupInRoleCentre, type NavItem } from './nav.ts';
import { ADMIN_TABS, POOL_GROUPS, WORKFLOW_TABS, SECURITY_TABS, DATA_TABS, COMPANY_TABS, hasTabAccess } from './adminNav.ts';
import { canNav } from './permissions.ts';
import { listProfiles } from './profiles.ts';
import type { SessionUser } from './types.ts';

export type ExplorerKind = 'page' | 'report' | 'admin';

export interface ExplorerPage {
  label: string;
  path: string;
  icon?: string;
  /** Drives the All / Reports & Analysis / Administration tabs. */
  kind: ExplorerKind;
  /** The sub-menu the page sits under, shown as a caption when a group is expanded. */
  section?: string;
}
export interface ExplorerGroup { name: string; icon?: string; pages: ExplorerPage[] }
export interface ExplorerArea {
  key: string;
  title: string;
  description?: string;
  icon?: string;
  groups: ExplorerGroup[];
  /** The user's active profile. */
  mine: boolean;
}

/** Report-and-analysis pages: everything under a Reports-style sub-menu, plus listings and
 *  statements that sit among the transaction pages. */
const REPORT_SECTIONS = new Set(['Reports', 'Financial Reports', 'VAT & WHT']);
const REPORT_PATTERN = /report|statement|analysis|listing|return|trial-balance|book-value|aged-|payslip|\/p9|ledger$|register$|organogram$/i;
function kindOf(item: NavItem, section?: string): ExplorerKind {
  if (section && REPORT_SECTIONS.has(section)) return 'report';
  return REPORT_PATTERN.test(item.path) || REPORT_PATTERN.test(item.label) ? 'report' : 'page';
}

/**
 * A Role Centre's navigation as feature groups, at Business Central's grain: a sidebar group's
 * direct pages form one group named after it, and each of its sub-menus is a group of its own
 * (General Ledger, Receivables, …). A sub-menu name that recurs within the area — every module
 * has a "Reports" — is prefixed with its module so the two stay apart. The Administration group
 * is left to its own area.
 */
function groupsForCentre(user: SessionUser, centre: string): ExplorerGroup[] {
  const raw: (ExplorerGroup & { parent: string })[] = [];
  for (const g of NAV) {
    if (g.group === 'Administration' || !groupInRoleCentre(g, centre)) continue;
    // The module's own pages lead its sub-menus.
    const direct = g.items.filter((e): e is NavItem => !isSubMenu(e) && canNav(user, e.page))
      .map((i) => ({ label: i.label, path: i.path, icon: i.icon, kind: kindOf(i) }));
    if (direct.length) raw.push({ name: g.group, pages: direct, parent: g.group });
    for (const entry of g.items) {
      if (!isSubMenu(entry)) continue;
      const pages = entry.items.filter((i) => canNav(user, i.page))
        .map((i) => ({ label: i.label, path: i.path, icon: i.icon, kind: kindOf(i, entry.submenu) }));
      if (pages.length) raw.push({ name: entry.submenu, icon: entry.icon, pages, parent: g.group });
    }
  }
  const counts = new Map<string, number>();
  for (const r of raw) counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
  return raw.map(({ parent, ...g }) => ((counts.get(g.name) ?? 0) > 1 && g.name !== parent ? { ...g, name: `${parent} › ${g.name}` } : g));
}

function administrationArea(user: SessionUser): ExplorerArea | null {
  const groups: ExplorerGroup[] = [];
  const top = ADMIN_TABS.filter((t) => t.key !== 'pool' && hasTabAccess(user, t))
    .map((t) => ({ label: t.label, path: `/admin/${t.key}`, icon: '⚙', kind: 'admin' as const }));
  if (top.length) groups.push({ name: 'Admin Centre', icon: '⚙', pages: top });
  const comp = COMPANY_TABS.filter((t) => t.key !== 'information' && hasTabAccess(user, t)).map((t) => ({ label: t.label, path: `/admin/company/${t.key}`, icon: '🏢', kind: 'admin' as const }));
  if (comp.length) groups.push({ name: 'Companies', icon: '🏢', pages: comp });
  for (const g of POOL_GROUPS) {
    const pages = g.screens.filter((s) => hasTabAccess(user, s))
      .map((s) => ({ label: s.label, path: `/admin/pool/${g.key}/${s.key}`, icon: '🗂', kind: 'admin' as const, section: 'Setup Pool' }));
    if (pages.length) groups.push({ name: g.label, icon: '🗂', pages });
  }
  const wf = WORKFLOW_TABS.filter((t) => hasTabAccess(user, t)).map((t) => ({ label: t.label, path: `/admin/workflows/${t.key}`, icon: '🔁', kind: 'admin' as const }));
  if (wf.length) groups.push({ name: 'Workflow Management', icon: '🔁', pages: wf });
  const sec = SECURITY_TABS.filter((t) => hasTabAccess(user, t)).map((t) => ({ label: t.label, path: `/admin/security/${t.key}`, icon: '🔐', kind: 'admin' as const }));
  if (sec.length) groups.push({ name: 'System Security', icon: '🔐', pages: sec });
  const integ = DATA_TABS.filter((t) => t.key !== 'management' && hasTabAccess(user, t)).map((t) => ({ label: t.label, path: `/admin/data/${t.key}`, icon: '🔌', kind: 'admin' as const }));
  if (integ.length) groups.push({ name: 'Integration', icon: '🔌', pages: integ });
  if (!groups.length) return null;
  return { key: 'administration', title: 'System Administration', description: 'Setup, security, workflows and data', icon: '⚙', groups, mine: false };
}

export async function buildRoleExplorer(user: SessionUser): Promise<ExplorerArea[]> {
  const profiles = await listProfiles();
  const areas: ExplorerArea[] = [];
  for (const p of profiles) {
    const groups = groupsForCentre(user, p.role_centre);
    if (!groups.length) continue;
    areas.push({
      key: p.code, title: p.name, description: p.description || undefined, icon: p.icon || undefined,
      groups, mine: p.code === user.activeProfile.code,
    });
  }
  // The user's own Role Centre leads, the rest keep the profile sort order.
  areas.sort((a, b) => Number(b.mine) - Number(a.mine));
  const admin = administrationArea(user);
  if (admin) areas.push(admin);
  return areas;
}
