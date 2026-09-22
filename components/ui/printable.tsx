/*
 * The page shell every printed document sits in.
 *
 * The document itself is an HTML string built by lib/documentPrint.ts (it is printed, not
 * interacted with, so it never needed to be JSX). This adds the one piece of chrome the paper
 * doesn't have: a screen-only "Print / Save as PDF" button, plus the auto-open of the browser's
 * print dialog that every slip in the app has always done on load.
 */
import { PrintSheets } from './print-sheets';

export function Printable({ html }: { html: string }) {
  return (
    <>
      <div className="no-print" style={{ maxWidth: '214mm', margin: '16px auto 12px', textAlign: 'right' }}>
        <button type="button" className="btn" data-print>Print / Save as PDF</button>
      </div>
      <PrintSheets style={{ paddingBottom: 24 }} html={html} />
      <script
        dangerouslySetInnerHTML={{
          __html: "document.querySelector('[data-print]')?.addEventListener('click',function(){window.print();});"
            + "window.addEventListener('load',function(){setTimeout(function(){window.print();},300);});",
        }}
      />
    </>
  );
}
