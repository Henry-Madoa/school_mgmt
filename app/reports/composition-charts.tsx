'use client';

import { HBars } from '@/components/charts/hbars';
import type { ReportLine } from '@/lib/types';

/** Income or expenditure composition, sorted and shown as a share of the total. */
export function CompositionBars({ lines, total, color }: {
  lines: ReportLine[];
  total: number;
  color?: string;
}) {
  return (
    <HBars
      rows={[...lines]
        .filter((r) => r.amount > 0)
        .sort((a, b) => b.amount - a.amount)
        .map((r) => ({
          label: r.name,
          value: r.amount,
          color,
          note: `${((r.amount / (total || 1)) * 100).toFixed(0)}%`,
        }))}
    />
  );
}
