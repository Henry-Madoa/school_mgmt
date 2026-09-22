'use client';

import { useFormat } from '@/components/ui/format-provider';
import { useChartTip } from './chart-tip';

/*
 * A small set of single stacked columns — one per group (e.g. Assets / Funding), each split into
 * its components. dataviz skill: 2px surface gap between segments, fixed --series colour order,
 * legend present, per-segment hover tooltip, one value axis.
 */
export interface StackedSegment {
  label: string;
  color: string;
  /** values[groupIndex] */
  values: number[];
}

export function StackedBar({ groups, segments, height = 240 }: {
  groups: string[];
  segments: StackedSegment[];
  height?: number;
}) {
  const { cur, curShort } = useFormat();
  const { show, hide, element } = useChartTip();

  const W = 620;
  const PAD = { left: 66, right: 12, top: 14, bottom: 30 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const totals = groups.map((_, gi) => segments.reduce((a, s) => a + Math.max(s.values[gi] || 0, 0), 0));
  const max = Math.max(1, ...totals);
  const ticks = 4;
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const groupW = innerW / Math.max(groups.length, 1);
  const barW = Math.min(90, groupW * 0.5);

  return (
    <>
      <svg className="chart" viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" style={{ height }}
        role="img" onMouseLeave={hide}>
        {Array.from({ length: ticks + 1 }, (_, t) => {
          const v = (max / ticks) * t;
          return (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth="1" />
              <text x={PAD.left - 8} y={y(v) + 4} textAnchor="end" fontSize="10.5" fill="var(--text-muted)">{curShort(v)}</text>
            </g>
          );
        })}
        {groups.map((g, gi) => {
          const gx = PAD.left + groupW * gi + (groupW - barW) / 2;
          let acc = 0;
          return (
            <g key={g}>
              {segments.map((s) => {
                const v = Math.max(s.values[gi] || 0, 0);
                if (v <= 0) return null;
                const h = (v / max) * innerH;
                const yTop = y(acc + v) + 1;
                acc += v;
                return (
                  <rect key={s.label} x={gx} y={yTop} width={barW} height={Math.max(0, h - 2)} rx="3" fill={s.color}
                    onMouseMove={(e) => show(e, (
                      <><div className="h">{g} · {s.label}</div><div className="r"><span /><b>{cur(v, { decimals: 0 })}</b></div></>
                    ))} />
                );
              })}
              <text x={gx + barW / 2} y={height - 9} textAnchor="middle" fontSize="10.5" fill="var(--text-muted)">{g}</text>
            </g>
          );
        })}
      </svg>
      <div className="chart-legend">
        {segments.map((s) => <span className="key" key={s.label}><i style={{ background: s.color }} />{s.label}</span>)}
      </div>
      {element}
    </>
  );
}
