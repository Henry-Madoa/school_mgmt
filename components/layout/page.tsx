import type { ReactNode } from 'react';
import { NavToggle } from './nav-toggle';
import { UserMenu } from './user-menu';
import { NotificationBell } from './notification-bell';
import { GlobalSearchButton } from './global-search';
import { RoleExplorerButton } from './role-explorer';
import { CompanyBadge } from './company-badge';
import type { SessionUser } from '@/lib/types';

export interface PageProps {
  title: ReactNode;
  crumb?: ReactNode;
  user: SessionUser;
  children: ReactNode;
}

/**
 * The top bar plus the content well.
 *
 * Every route renders its own <Page>, which is what lets the heading carry
 * route-specific detail (a student's name, an invoice number) without the shell
 * having to know about routes — the old app poked at #page-title imperatively.
 */
export function Page({ title, crumb, user, children }: PageProps) {
  return (
    <>
      <header className="topbar">
        <NavToggle />
        <div className="titles">
          <h1>{title}</h1>
          {crumb ? <div className="crumb">{crumb}</div> : null}
        </div>
        <div className="spacer" />
        <div className="usermenu">
          <CompanyBadge />
          <GlobalSearchButton />
          <NotificationBell />
          <UserMenu fullName={user.full_name} roleName={user.role_name} />
          <RoleExplorerButton />
        </div>
      </header>
      <main className="content">{children}</main>
    </>
  );
}
