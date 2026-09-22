'use client';

import { useRunAction } from '@/components/ui/run-action';
import { closeFiscalYearRequest, createFiscalYearRequest } from '@/app/actions/gl';
import type { FiscalYear } from '@/lib/gl';

/**
 * Business Central's "Close Year" on the Accounting Periods list. Closes the earliest fiscal
 * year still open — BC names the year in its confirmation, so the button is handed the year it
 * will close — and cannot be undone, hence the red confirm.
 */
export function CloseYearButton({ year }: { year: { startDate: string; endDate: string | null } }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className="btn sm" disabled={busy} onClick={() => run(() => closeFiscalYearRequest(), {
      confirm: {
        title: `Close the fiscal year ${year.startDate} – ${year.endDate ?? '…'}?`,
        message: 'Every period of the year is marked Closed and Date Locked. This cannot be undone. Postings into the year are still governed by each period\'s Open/Closed status; run Close Income Statement afterwards to transfer the year\'s result to retained earnings.',
        confirmLabel: 'Close year', danger: true,
      },
      successTitle: (y: FiscalYear) => `Fiscal year ${y.startDate} – ${y.endDate} closed`,
      successDetail: 'Close Income Statement is now available for it.',
    })}>
      {busy ? 'Working…' : 'Close year'}
    </button>
  );
}

/** Business Central's "Create Fiscal Year" batch job with its defaults: twelve one-month periods
 *  after the last period on file. */
export function CreateFiscalYearButton({ after }: { after: string | null }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className="btn sm ghost" disabled={busy} onClick={() => run(() => createFiscalYearRequest(12), {
      confirm: {
        title: 'Create the next fiscal year?',
        message: after
          ? `Twelve monthly periods are added after ${after}, the first of the organisation's fiscal-year start month flagged New Fiscal Year.`
          : 'Twelve monthly periods are created from the organisation\'s fiscal-year start in the current year.',
        confirmLabel: 'Create periods',
      },
      successTitle: (p: { code: string }[]) => `Periods ${p[0]?.code} to ${p[p.length - 1]?.code} created`,
    })}>
      {busy ? 'Working…' : 'Create fiscal year'}
    </button>
  );
}
