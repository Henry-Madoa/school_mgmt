import type { ReactNode } from 'react';
import { Card, CardHead, EmptyState, Stat } from '@/components/ui/primitives';
import { Sparkline } from '@/components/charts/sparkline';

/**
 * A Role Centre widget the current user's permission set does not unlock. Profiles grant no
 * rights, so a user landed on a Role Centre they lack permissions for sees these in place of the
 * data ("assigned a profile without permission you can't see anything").
 */
export function LockedCard({ title }: { title: string }) {
  return (
    <Card>
      <CardHead title={title} />
      <EmptyState icon="🔒" title="Not in your permission set"
        sub="Your Role Centre shows this, but your permission set does not grant access to the data behind it." />
    </Card>
  );
}

/** A KPI tile with an optional sparkline underneath the value. */
export function KpiTile({ label, value, foot, spark, sparkColor, accent = true }: {
  label: ReactNode;
  value: ReactNode;
  foot?: ReactNode;
  spark?: number[];
  sparkColor?: string;
  accent?: boolean;
}) {
  return (
    <Stat
      accent={accent}
      label={label}
      value={value}
      foot={
        <>
          {spark && spark.length > 1 ? (
            <span style={{ display: 'block', marginTop: 4 }}>
              <Sparkline values={spark} color={sparkColor} width={140} height={30} />
            </span>
          ) : null}
          {foot}
        </>
      }
    />
  );
}

/** A section wrapper: renders `children` when `can`, else a LockedCard. */
export function Gated({ can, title, children }: { can: boolean; title: string; children: ReactNode }) {
  return can ? <>{children}</> : <LockedCard title={title} />;
}
