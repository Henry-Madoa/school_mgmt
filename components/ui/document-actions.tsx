'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { ExcelIcon } from './export-button';

function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path
        d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"
        stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function PrinterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path
        d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M6 14h12v7H6v-7Z"
        stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"
      />
    </svg>
  );
}

export interface DocumentActionsMenuProps {
  /** Only shown when supplied — most single-document views have no matching export route. */
  excel?: {
    href: string;
    params?: Record<string, string | undefined>;
    disabled?: boolean;
    /** Overrides the menu item's text — e.g. "Appraisal Report (.xlsx)" where a page's export
     *  is a narrower document than "the whole page", so a plain "Export to Excel" would
     *  overpromise. Defaults to "Export to Excel". */
    label?: string;
  };
  className?: string;
  label?: string;
}

/**
 * Business-Central-style "Print/Send" split action for a single document: Preview
 * (the same chrome-free layout `@media print` produces, opened read-only in a new
 * tab via PrintPreviewMode), Print (the browser's own dialog — how "print to PDF"
 * works without a server-side PDF engine), and Export to Excel where a route exists.
 */
export function DocumentActionsMenu({ excel, className = 'btn ghost', label = 'Print / Send' }: DocumentActionsMenuProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  // The menu hangs off the button's right edge. When the button sits near the left of a narrow
  // screen (the toolbar wraps on phones) that would push the menu off-screen, so it hangs off the
  // left edge instead — whichever side has the room.
  const [alignLeft, setAlignLeft] = useState(false);
  useLayoutEffect(() => {
    if (!open || !boxRef.current) return;
    const box = boxRef.current.getBoundingClientRect();
    const menu = boxRef.current.querySelector<HTMLElement>('.doc-actions-menu');
    const width = menu?.offsetWidth ?? 190;
    setAlignLeft(box.right - width < 8 && box.left + width <= window.innerWidth - 8);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const preview = () => {
    const qs = new URLSearchParams(searchParams);
    qs.set('preview', '1');
    window.open(`${pathname}?${qs}`, '_blank', 'noopener');
    setOpen(false);
  };

  const print = () => {
    setOpen(false);
    window.print();
  };

  const excelQuery = new URLSearchParams();
  for (const [key, value] of Object.entries(excel?.params ?? {})) {
    if (value) excelQuery.set(key, value);
  }
  const excelQs = excelQuery.toString();
  const excelUrl = excel ? (excelQs ? `${excel.href}?${excelQs}` : excel.href) : '';

  return (
    <div className="doc-actions" ref={boxRef}>
      <button
        type="button" className={className} onClick={() => setOpen((v) => !v)}
        aria-expanded={open} aria-haspopup="menu"
      >
        <PrinterIcon /> {label} <span className="doc-actions-caret" aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div className={`doc-actions-menu ${alignLeft ? 'align-left' : ''}`} role="menu">
          <button type="button" className="doc-actions-item" role="menuitem" onClick={preview}>
            <EyeIcon /> Preview
          </button>
          <button type="button" className="doc-actions-item" role="menuitem" onClick={print}>
            <PrinterIcon /> Print (save as PDF)
          </button>
          {excel ? (
            excel.disabled ? (
              <span className="doc-actions-item disabled" aria-disabled="true" title="Nothing to export">
                <ExcelIcon /> {excel.label ?? 'Export to Excel'}
              </span>
            ) : (
              <a className="doc-actions-item" role="menuitem" href={excelUrl} onClick={() => setOpen(false)}>
                <ExcelIcon /> {excel.label ?? 'Export to Excel'}
              </a>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
