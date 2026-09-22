'use client';

/*
 * A bare trend for a KPI tile — no axes, no labels, no legend (the tile's number and label carry
 * the meaning). One 2px line in a single colour, optional faint area fill. dataviz skill: a
 * sparkline is the "change is context, not the headline" form.
 */
export function Sparkline({ values, color = 'var(--series-1)', width = 120, height = 34, area = true }: {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
  area?: boolean;
}) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pad = 3;
  const x = (i: number) => pad + (i / (values.length - 1)) * (width - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);
  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width, height, display: 'block' }} aria-hidden="true">
      {area ? <path d={`${line} L ${x(values.length - 1)} ${height - pad} L ${x(0)} ${height - pad} Z`} fill={color} opacity="0.12" /> : null}
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r="2.5" fill={color} />
    </svg>
  );
}
