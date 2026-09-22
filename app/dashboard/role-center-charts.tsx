'use client';

import { Trend, type TrendSeries } from '@/components/charts/trend';
import { Sparkline } from '@/components/charts/sparkline';
import { Gauge } from '@/components/charts/gauge';
import { StackedBar } from '@/components/charts/stacked-bar';
import { Donut } from '@/components/charts/donut';
import { HBars } from '@/components/charts/hbars';
import { useFormat } from '@/components/ui/format-provider';
import { formatMonth } from '@/lib/format';
import type { Cents } from '@/lib/types';

const S = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'];
const SLICE = [...S, 'var(--brand-accent)', 'var(--info)', 'var(--text-muted)'];

export { Sparkline, Gauge };

/** A month-keyed trend. `series` values are already ordered oldest→newest to match `months`. */
export function MonthTrend({ months, series, money = true, area = false, height }: {
  months: string[];
  series: { name: string; values: number[] }[];
  money?: boolean;
  area?: boolean;
  height?: number;
}) {
  const s: TrendSeries[] = series.map((x, i) => ({ name: x.name, color: S[i % S.length], values: x.values }));
  return <Trend labels={months.map(formatMonth)} series={s} money={money} area={area} height={height} />;
}

export function MixDonut({ rows, total, centerLabel = 'total' }: {
  rows: { name: string; amount: Cents }[];
  total: Cents;
  centerLabel?: string;
}) {
  const { curShort } = useFormat();
  return (
    <Donut
      segments={rows.filter((r) => r.amount > 0).map((r, i) => ({ label: r.name, value: r.amount, color: SLICE[i % SLICE.length] }))}
      centerValue={curShort(total)}
      centerLabel={centerLabel}
    />
  );
}

export function StatusDonut({ rows, centerLabel }: {
  rows: { label: string; value: number }[];
  centerLabel?: string;
}) {
  const total = rows.reduce((a, r) => a + Math.max(r.value, 0), 0);
  return (
    <Donut
      money={false}
      segments={rows.filter((r) => r.value > 0).map((r, i) => ({ label: r.label, value: r.value, color: SLICE[i % SLICE.length] }))}
      centerValue={String(total)}
      centerLabel={centerLabel ?? 'total'}
    />
  );
}

/** Horizontal magnitude list (one hue — sequential job). */
export function MagnitudeBars({ rows, money = true }: {
  rows: { label: string; value: number; note?: string }[];
  money?: boolean;
}) {
  return <HBars rows={rows.map((r) => ({ ...r, color: 'var(--series-1)' }))} money={money} />;
}

export function BalanceSheetBar({ assets, liabilities, equity, surplus }: {
  assets: Cents; liabilities: Cents; equity: Cents; surplus: Cents;
}) {
  return (
    <StackedBar
      groups={['Assets', 'Funded by']}
      segments={[
        { label: 'Assets', color: S[0], values: [assets, 0] },
        { label: 'Liabilities', color: S[1], values: [0, liabilities] },
        { label: 'Equity', color: S[2], values: [0, equity] },
        { label: 'Surplus', color: 'var(--brand-accent)', values: [0, surplus] },
      ]}
    />
  );
}

export function RatioGauges({ ratios }: {
  ratios: { label: string; value: number; threshold: number; higherIsWorse?: boolean }[];
}) {
  return (
    <div className="grid g4 stack-2">
      {ratios.map((r) => (
        <Gauge key={r.label} label={r.label} value={r.value} threshold={r.threshold} higherIsWorse={r.higherIsWorse} />
      ))}
    </div>
  );
}
