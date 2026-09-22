'use client';

import { useFormat } from '@/components/ui/format-provider';
import { useChartTip } from './chart-tip';

/*
 * Line / area trend over a shared category axis (months, days).
 *
 * Design rules applied (dataviz skill): a single value axis, at most three series in fixed
 * --series-1..3 order, 2px lines, >=8px hover markers, recessive grid + baseline, a crosshair on
 * hover with a tooltip carrying every series' figure, a legend whenever more than one series is
 * present. The area fill (optional, single-series only) sits under a 2px line at low opacity.
 */

export interface TrendSeries {
  name: string;
  color: string;
  values: number[];
}

export interface TrendProps {
  labels: string[];
  series: TrendSeries[];
  height?: number;
  /** false when the axis counts things rather than money. */
  money?: boolean;
  /** Fill under the line — only meaningful with a single series. */
  area?: boolean;
}

const W = 900;
const PAD = { left: 62, right: 14, top: 14, bottom: 30 };

function niceStep(x: number): number {
  if (x <= 0) return 1;
  const e = 10 ** Math.floor(Math.log10(x));
  const f = x / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e;
}

export function Trend({ labels, series, height = 240, money = true, area = false }: TrendProps) {
  const { cur, curShort } = useFormat();
  const { show, hide, element } = useChartTip();

  const innerW = W - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const n = Math.max(labels.length, 1);
  const allValues = series.flatMap((s) => s.values);
  const rawMax = Math.max(1, ...allValues);
  const rawMin = Math.min(0, ...allValues);
  const ticks = 4;
  const step = niceStep((rawMax - rawMin) / ticks);
  const top = step * Math.ceil(rawMax / step || 1);
  const bottom = rawMin < 0 ? -step * Math.ceil(-rawMin / step) : 0;

  const x = (i: number) => PAD.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - ((v - bottom) / (top - bottom || 1)) * innerH;
  const axisFmt = money ? curShort : (v: number) => v.toLocaleString();
  const tipFmt = money ? (v: number) => cur(v, { decimals: 0 }) : (v: number) => v.toLocaleString();

  const path = (values: number[]) =>
    values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');

  const tipFor = (i: number) => (
    <>
      <div className="h">{labels[i]}</div>
      {series.map((s) => (
        <div className="r" key={s.name}><span>{s.name}</span><b>{tipFmt(s.values[i] ?? 0)}</b></div>
      ))}
    </>
  );

  return (
    <>
      <svg className="chart" viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none"
        style={{ height }} role="img" onMouseLeave={hide}>
        {Array.from({ length: ticks + 1 }, (_, t) => {
          const v = bottom + ((top - bottom) / ticks) * t;
          return (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth="1" />
              <text x={PAD.left - 8} y={y(v) + 4} textAnchor="end" fontSize="10.5" fill="var(--text-muted)">
                {axisFmt(v)}
              </text>
            </g>
          );
        })}
        {bottom < 0 ? (
          <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} stroke="var(--text-muted)" strokeWidth="1" opacity=".45" />
        ) : null}

        {area && series.length === 1 ? (
          <path
            d={`${path(series[0].values)} L ${x(n - 1)} ${y(bottom)} L ${x(0)} ${y(bottom)} Z`}
            fill={series[0].color} opacity="0.12"
          />
        ) : null}

        {series.map((s) => (
          <path key={s.name} d={path(s.values)} fill="none" stroke={s.color} strokeWidth="2"
            strokeLinejoin="round" strokeLinecap="round" />
        ))}

        {/* hover columns — a wide invisible hit target per category */}
        {labels.map((label, i) => (
          <g key={`${label}-${i}`}>
            <rect
              x={x(i) - innerW / n / 2} y={PAD.top} width={innerW / n} height={innerH}
              fill="transparent"
              onMouseMove={(e) => show(e, tipFor(i))}
            />
            {series.map((s) => (
              <circle key={s.name} cx={x(i)} cy={y(s.values[i] ?? 0)} r="3.5" fill={s.color} pointerEvents="none" />
            ))}
            <text x={x(i)} y={height - 9} textAnchor="middle" fontSize="10.5" fill="var(--text-muted)">{label}</text>
          </g>
        ))}
      </svg>

      {series.length > 1 ? (
        <div className="chart-legend">
          {series.map((s) => (
            <span className="key" key={s.name}><i style={{ background: s.color }} />{s.name}</span>
          ))}
        </div>
      ) : null}

      {element}
    </>
  );
}
