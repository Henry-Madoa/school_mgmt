'use client';

import { useRunAction } from '@/components/ui/run-action';
import { reapplySalaryScaleRequest } from '@/app/actions/salaryScales';

/** Re-confers the employee's salary-scale notch — basic pay and benefits as the scale defines
 *  them now, replacing lines the notch conferred before; HR's hand-added lines are kept. */
export function ReapplyScaleButton({ employeeId, notch, className = 'btn sm ghost' }: { employeeId: number; notch: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => reapplySalaryScaleRequest(employeeId), {
        confirm: {
          title: `Re-apply notch ${notch}?`,
          message: 'Basic pay is reset to the notch\'s and the benefit lines it confers are rebuilt for the open period from the scale as it stands now. Lines HR added by hand are left alone.',
          confirmLabel: 'Re-apply',
        },
        successTitle: (d: { benefits: number }) => `Notch re-applied — ${d.benefits} benefit line${d.benefits === 1 ? '' : 's'} conferred`,
      })}>
      {busy ? 'Working…' : 'Re-apply scale'}
    </button>
  );
}
