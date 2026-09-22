import { Page } from '@/components/layout/page';
import { Card, EmptyState } from '@/components/ui/primitives';
import type { SessionUser } from '@/lib/types';

export function NotLinked({ user, title, error }: { user: SessionUser; title: string; error: string }) {
  return (
    <Page title={title} user={user}>
      <Card><EmptyState icon="🧑‍🏫" title="Your login is not matched to teaching staff" sub={error} /></Card>
    </Page>
  );
}
