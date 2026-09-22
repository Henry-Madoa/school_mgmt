'use client';

import { useLayoutEffect, useRef, type CSSProperties } from 'react';

/**
 * Shows printout sheets (lib/documentPrint.ts markup) on screen the way a PDF viewer does:
 * each sheet keeps its paper layout — A4 is ~809px wide, a slip ~378px — and is scaled down
 * to fit the container when the screen is narrower, instead of its header, parties and line
 * tables being squeezed into each other. Uses CSS `zoom`, which scales layout as well as paint,
 * so the page below the sheet flows correctly; the sheet's own `@media print` rules reset it,
 * so paper output is untouched.
 */
export function PrintSheets({ html, className, style }: { html: string; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const fit = () => {
      const available = box.clientWidth;
      if (!available) return;
      for (const sheet of box.querySelectorAll<HTMLElement>('.dp')) {
        // The sheet's design width is its max-width (set in mm; computed in px). Reset first so
        // the measurement is of the unscaled sheet, then scale only when there is not enough room.
        sheet.style.zoom = '';
        sheet.style.width = '';
        const design = parseFloat(getComputedStyle(sheet).maxWidth);
        if (!Number.isFinite(design) || design <= available) continue;
        sheet.style.width = `${design}px`;
        sheet.style.zoom = String(available / design);
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
  }, [html]);

  return <div ref={ref} className={className} style={style} dangerouslySetInnerHTML={{ __html: html }} />;
}
