import type { ReactNode } from 'react';
import { getOrgBrand } from '@/lib/org';
import { requireUser } from '@/lib/session';
import { canPage, canNav } from '@/lib/permissions';
import { myPendingWorkflowTaskCount } from '@/lib/workflow';
import { NAV, isSubMenu } from '@/lib/nav';
import { Sidebar } from '@/components/layout/sidebar';
import { NavProvider } from '@/components/layout/nav-context';
import { PrintPreviewMode } from '@/components/ui/print-preview-mode';
import { GlobalSearchProvider } from '@/components/layout/global-search';
import { buildSearchIndex } from '@/lib/globalSearch';
import { RoleExplorerProvider } from '@/components/layout/role-explorer';
import { buildRoleExplorer } from '@/lib/roleExplorer';
import { AssistantPanel } from '@/components/layout/assistant-panel';
import { assistantConfigured } from '@/lib/assistant/assistant';
import { scopeFor } from '@/lib/assistant/tools';

export async function AppShell({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const org = (await getOrgBrand())!;

  // Resolve navigation visibility here so the browser only ever learns which
  // links to draw, not the permission list that produced them. canNav() is stricter than
  // canPage(): a screen with a read/view action (e.g. LOANS -> LOAN_READ) is only listed when the
  // user can actually read its data, not just reach the page shell.
  const allowedPaths = NAV
    .flatMap((g) => g.items.flatMap((i) => (isSubMenu(i) ? i.items : [i])))
    .filter((i) => canNav(user, i.page))
    .map((i) => i.path);

  // The badge is what this user personally has to act on, not an org-wide pending count —
  // otherwise it stops meaning "you have something to do" the moment anyone else has a backlog.
  const badges = canPage(user, 'APPROVALS')
    ? { pendingApprovals: await myPendingWorkflowTaskCount(user.id, user.username) }
    : {};

  // Business Central "Tell Me": every page this user may open, searchable from the top bar (Alt+Q).
  const searchIndex = buildSearchIndex(user);
  // Business Central "Explore all" (the ☰ button): every Role Centre profile as an area.
  const explorerAreas = await buildRoleExplorer(user);
  // The assistant (bottom-right): what this user may ask it about is decided here, server-side.
  const assistantScope = scopeFor(user).can;

  return (
    <NavProvider>
      <PrintPreviewMode />
      <GlobalSearchProvider entries={searchIndex}>
        <RoleExplorerProvider areas={explorerAreas} orgName={org.short_name || org.name || 'School'}>
          <div className="shell">
            <Sidebar org={org} user={user} allowedPaths={allowedPaths} badges={badges} />
            <div className="main">{children}</div>
          </div>
          <AssistantPanel enabled={assistantConfigured()} scope={assistantScope} />
        </RoleExplorerProvider>
      </GlobalSearchProvider>
    </NavProvider>
  );
}
