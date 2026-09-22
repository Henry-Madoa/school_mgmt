'use client';

import { useFormat } from '@/components/ui/format-provider';

export interface HBarRow {
  label: string;
  value: number;
  color?: string;
  note?: string;
}

/** Horizontal magnitude list — one hue, sorted by the caller, direct-labelled. */
export function HBars({ rows, money = true }: { rows: HBarRow[]; money?: boolean }) {
  const { cur } = useFormat();
  const max = Math.max(1, ...rows.map((r) => r.value));

  return (
    <>
      {rows.map((r) => (
        <div className="bar-row" key={r.label}>
          <div>
            <div className="head">
              <span>{r.label}</span>
              <span className="muted-cell">{money ? cur(r.value, { decimals: 0 }) : r.value.toLocaleString()}</span>
            </div>
            <div className="bar-track">
              <div className="bar-fill"
                style={{ width: `${((r.value / max) * 100).toFixed(1)}%`, background: r.color || 'var(--series-1)' }} />
            </div>
          </div>
          <div className="num tiny">{r.note || ''}</div>
        </div>
      ))}
    </>
  );
}
