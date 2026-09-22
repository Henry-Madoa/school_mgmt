'use client';

import type { ReactNode } from 'react';
import { useFormat } from '@/components/ui/format-provider';
import { useChartTip } from './chart-tip';
import type { Cents } from '@/lib/types';

export interface DonutSegment {
  label: string;
  value: Cents;
  color: string;
}

export interface DonutProps {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
  /** false when the slices count things rather than money — the legend/tooltip then show a
   *  plain number instead of a currency amount. */
  money?: boolean;
}

/** Donut for a small composition (≤6 slices), with a direct-labelled legend. */
export function Donut({ segments, size = 190, thickness = 26, centerLabel, centerValue, money = true }: DonutProps) {
  const { cur: curMoney } = useFormat();
  const cur = money ? curMoney : (v: number, _opts?: unknown) => Math.round(v).toLocaleString();
  const { show, hide, element } = useChartTip();

  const total = segments.reduce((a, s) => a + Math.max(s.value, 0), 0);
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;

  const arcs: { key: string; color: string; d: string; tip: ReactNode }[] = [];
  let angle = -Math.PI / 2;
  for (const s of segments) {
    const frac = Math.max(s.value, 0) / (total || 1);
    if (total <= 0 || frac <= 0) continue;
    const sweep = frac * Math.PI * 2;
    const pad = Math.min(0.02, sweep / 6); // 2px-equivalent surface gap
    const a0 = angle + pad / 2;
    const a1 = angle + sweep - pad / 2;
    arcs.push({
      key: s.label,
      color: s.color,
      d: `M ${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} A ${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)}`,
      tip: (
        <>
          <div className="h">{s.label}</div>
          <div className="r"><span>{(frac * 100).toFixed(1)}%</span><b>{cur(s.value, { decimals: 0 })}</b></div>
        </>
      ),
    });
    angle += sweep;
  }

  return (
    <div className="donut-wrap">
      <svg viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size, flex: 'none' }}
        role="img" onMouseLeave={hide}>
        {arcs.length ? arcs.map((a) => (
          <path key={a.key} d={a.d} fill="none" stroke={a.color} strokeWidth={thickness} strokeLinecap="butt"
            onMouseMove={(e) => show(e, a.tip)} />
        )) : (
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={thickness} />
        )}
        {centerValue ? (
          <text x={cx} y={cy - 2} textAnchor="middle" fontSize="17" fontWeight="650" fill="var(--text)">
            {centerValue}
          </text>
        ) : null}
        {centerLabel ? (
          <text x={cx} y={cy + 15} textAnchor="middle" fontSize="10.5" fill="var(--text-muted)">
            {centerLabel}
          </text>
        ) : null}
      </svg>

      <div className="donut-legend">
        {segments.map((s) => (
          <div className="bar-row" key={s.label}>
            <i style={{ background: s.color }} />
            <span>{s.label}</span>
            <b className="num">{cur(s.value, { decimals: 0 })}</b>
          </div>
        ))}
      </div>

      {element}
    </div>
  );
}
