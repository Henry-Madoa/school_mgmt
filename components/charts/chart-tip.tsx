'use client';

import { useCallback, useState, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface TipState {
  content: ReactNode;
  x: number;
  y: number;
}

/**
 * Hover tooltip shared by every chart.
 *
 * Returns a `show`/`hide` pair to wire onto the marks plus the tooltip element.
 * The tooltip is measured after paint and flipped when it would leave the
 * viewport, so a mark near the right edge still shows its figures.
 */
export function useChartTip() {
  const [tip, setTip] = useState<TipState | null>(null);

  const show = useCallback((event: MouseEvent, content: ReactNode) => {
    setTip({ content, x: event.clientX, y: event.clientY });
  }, []);

  const hide = useCallback(() => setTip(null), []);

  const element = tip && typeof document !== 'undefined'
    ? createPortal(<TipBox {...tip} />, document.body)
    : null;

  return { show, hide, element };
}

function TipBox({ content, x, y }: TipState) {
  const [pos, setPos] = useState<React.CSSProperties>({ left: x + 14, top: y + 14, visibility: 'hidden' });

  const measure = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const r = node.getBoundingClientRect();
    let left = x + 14;
    let top = y + 14;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
    setPos({ left, top, visibility: 'visible' });
  }, [x, y]);

  return <div className="chart-tip" ref={measure} style={pos}>{content}</div>;
}
