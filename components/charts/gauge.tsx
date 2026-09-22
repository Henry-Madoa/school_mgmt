'use client';

/*
 * A radial gauge for a single ratio against a regulatory threshold (capital adequacy %,
 * liquidity %, PAR %). Semicircle sweep, one value arc over a recessive track, a threshold tick,
 * and a status colour + word (never colour alone — dataviz skill: status is reserved and always
 * labelled). Not a chart with many marks, so no hover layer.
 */
export interface GaugeProps {
  /** The measured value, already a percentage (e.g. 17.4 for 17.4%). */
  value: number;
  /** The regulatory minimum (or, when higherIsWorse, maximum). */
  threshold: number;
  /** The end of the dial. Defaults to max(threshold * 2, value * 1.2). */
  max?: number;
  label: string;
  /** true for ratios where a HIGH number is bad (PAR%). Default: low is bad. */
  higherIsWorse?: boolean;
  unit?: string;
}

export function Gauge({ value, threshold, max, label, higherIsWorse = false, unit = '%' }: GaugeProps) {
  const dialMax = max ?? Math.max(threshold * 2, Math.abs(value) * 1.2, 1);
  const clamp = Math.max(0, Math.min(value, dialMax));
  const ok = higherIsWorse ? value <= threshold : value >= threshold;
  const near = !ok && (higherIsWorse ? value <= threshold * 1.15 : value >= threshold * 0.85);
  const status = ok ? { tone: 'var(--success)', word: 'Compliant', icon: '✔' }
    : near ? { tone: 'var(--warning)', word: 'Marginal', icon: '!' }
      : { tone: 'var(--danger)', word: 'Below limit', icon: '✕' };

  const W = 220;
  const H = 128;
  const cx = W / 2;
  const cy = H - 12;
  const r = 92;
  const a = (frac: number) => Math.PI + frac * Math.PI; // 180° → 360°
  const pt = (frac: number, rad = r) => `${(cx + rad * Math.cos(a(frac))).toFixed(1)} ${(cy + rad * Math.sin(a(frac))).toFixed(1)}`;
  const arc = (f0: number, f1: number, rad = r) =>
    `M ${pt(f0, rad)} A ${rad} ${rad} 0 ${f1 - f0 > 0.5 ? 1 : 0} 1 ${pt(f1, rad)}`;

  const valFrac = clamp / dialMax;
  const thrFrac = Math.max(0, Math.min(threshold / dialMax, 1));

  return (
    <div style={{ textAlign: 'center' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W }} role="img" aria-label={`${label}: ${value.toFixed(2)}${unit}`}>
        <path d={arc(0, 1)} fill="none" stroke="var(--surface-2)" strokeWidth="12" strokeLinecap="round" />
        {valFrac > 0 ? (
          <path d={arc(0, valFrac)} fill="none" stroke={status.tone} strokeWidth="12" strokeLinecap="round" />
        ) : null}
        <line
          x1={cx + (r - 10) * Math.cos(a(thrFrac))} y1={cy + (r - 10) * Math.sin(a(thrFrac))}
          x2={cx + (r + 10) * Math.cos(a(thrFrac))} y2={cy + (r + 10) * Math.sin(a(thrFrac))}
          stroke="var(--text)" strokeWidth="2"
        />
        <text x={cx} y={cy - 26} textAnchor="middle" fontSize="26" fontWeight="650" fill="var(--text)">
          {value.toFixed(value >= 100 ? 0 : 1)}{unit}
        </text>
        <text x={cx} y={cy - 8} textAnchor="middle" fontSize="10.5" fill="var(--text-muted)">
          min {threshold}{unit}
        </text>
      </svg>
      <div style={{ marginTop: 2, fontSize: 12.5 }}>
        <span style={{ color: status.tone, fontWeight: 600 }}>{status.icon} {status.word}</span>
        <span className="muted-cell"> · {label}</span>
      </div>
    </div>
  );
}
