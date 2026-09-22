import type { ReactNode } from 'react';
import { Page } from '@/components/layout/page';
import { Card, EmptyState, Toolbar, Spacer } from '@/components/ui/primitives';
import { ChildPicker } from './child-picker';
import type { PortalScope } from './context';
import type { SessionUser } from '@/lib/types';

/** Every portal page: the title, the child picker (when a parent has more than one) and the body. */
export function PortalShell({ user, title, crumb, scope, extra, children }: {
  user: SessionUser; title: string; crumb?: string; scope: PortalScope | { error: string }; extra?: ReactNode; children?: ReactNode;
}) {
  if ('error' in scope) {
    return (
      <Page title={title} user={user}>
        <Card><EmptyState icon="🎒" title="Your login is not linked yet" sub={scope.error} /></Card>
      </Page>
    );
  }
  const s = scope.student;
  return (
    <Page title={title} crumb={crumb ?? `${s.first_name} ${s.last_name} · ${s.admission_no} · ${s.grade_level_name ?? ''} ${s.stream_name ?? ''}`} user={user}>
      {scope.students.length > 1 || extra ? (
        <Toolbar>
          {scope.students.length > 1 ? <ChildPicker students={scope.students} value={String(s.id)} /> : null}
          <Spacer />
          {extra}
        </Toolbar>
      ) : null}
      {children}
    </Page>
  );
}
