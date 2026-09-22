'use client';

import { useFormat } from '@/components/ui/format-provider';
import { useChartTip } from './chart-tip';

/*
 * Design rules applied: a single value axis (never dual), at most three
 * categorical series drawn in fixed slot order, 2px surface gaps between
 * adjacent fills, 4px rounded data-ends anchored to the baseline, recessive
 * grid and axes, a legend whenever more than one series is present, and a
 * hover tooltip on every mark. Series colours come from theme tokens
 * --series-1..3, which are validated for colour-vision separation.
 */

export interface Series {
  name: string;
  color: string;
  values: number[];
}

export interface GroupedBarsProps {
  labels: string[];
  series: Series[];
  height?: number;
  /** false when the axis counts things rather than money. */
  money?: boolean;
}

function niceStep(x: number): number {
  if (x <= 0) return 1;
  const e = 10 ** Math.floor(Math.log10(x));
  const f = x / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e;
}

const W = 900;
const PAD = { left: 62, right: 12, top: 14, bottom: 30 };

/** Grouped vertical bars over a shared category axis. */
export function GroupedBars({ labels, series, height = 230, money = true }: GroupedBarsProps) {
  const { cur, curShort } = useFormat();
  const { show, hide, element } = useChartTip();

  const innerW = W - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const ticks = 4;
  const step = niceStep(max / ticks);
  const top = Math.max(step * ticks, step * Math.ceil(max / step));
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;

  const groupW = innerW / Math.max(labels.length, 1);
  const gap = 2; // surface gap between adjacent fills
  const barW = Math.max(3, (groupW * 0.68 - gap * (series.length - 1)) / series.length);
  const axisFmt = money ? curShort : (v: number) => v.toLocaleString();
  const tipFmt = money ? (v: number) => cur(v, { decimals: 0 }) : (v: number) => v.toLocaleString();

  const tipFor = (label: string, i: number) => (
    <>
      <div className="h">{label}</div>
      {series.map((s) => (
        <div className="r" key={s.name}>
          <span>{s.name}</span><b>{tipFmt(s.values[i] || 0)}</b>
        </div>
      ))}
    </>
  );

  return (
    <>
      <svg className="chart" viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none"
        style={{ height }} role="img" onMouseLeave={hide}>
        {Array.from({ length: ticks + 1 }, (_, t) => {
          const v = (top / ticks) * t;
          return (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth="1" />
              <text x={PAD.left - 8} y={y(v) + 4} textAnchor="end" fontSize="10.5" fill="var(--text-muted)">
                {axisFmt(v)}
              </text>
            </g>
          );
        })}

        <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + innerH} y2={PAD.top + innerH}
          stroke="var(--text-muted)" strokeWidth="1" opacity=".45" />

        {labels.map((label, i) => {
          const groupX = PAD.left + groupW * i
            + (groupW - (barW * series.length + gap * (series.length - 1))) / 2;
          return (
            <g key={`${label}-${i}`}>
              {series.map((s, k) => {
                const v = s.values[i] || 0;
                const h = Math.max(v > 0 ? 2 : 0, PAD.top + innerH - y(v));
                return (
                  <rect
                    key={s.name}
                    x={groupX + k * (barW + gap)}
                    y={PAD.top + innerH - h}
                    width={barW}
                    height={h}
                    rx="4"
                    fill={s.color}
                    onMouseMove={(e) => show(e, tipFor(label, i))}
                  />
                );
              })}
              <text x={PAD.left + groupW * i + groupW / 2} y={height - 9} textAnchor="middle"
                fontSize="10.5" fill="var(--text-muted)">{label}</text>
            </g>
          );
        })}
      </svg>

      {series.length > 1 ? (
        <div className="chart-legend">
          {series.map((s) => (
            <span className="key" key={s.name}>
              <i style={{ background: s.color }} />{s.name}
            </span>
          ))}
        </div>
      ) : null}

      {element}
    </>
  );
}
