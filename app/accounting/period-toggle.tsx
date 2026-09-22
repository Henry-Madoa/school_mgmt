'use client';

import { ActionButton } from '@/components/ui/action-button';
import { setPeriodStatus } from '@/app/actions/gl';
import type { AccountingPeriod } from '@/lib/types';

export function PeriodToggle({ period }: { period: AccountingPeriod }) {
  const next = period.status === 'OPEN' ? 'CLOSED' : 'OPEN';
  return (
    <ActionButton
      className="btn sm ghost"
      action={() => setPeriodStatus(period.code, next)}
      success={`Period ${next === 'CLOSED' ? 'closed' : 'reopened'}`}
      successDetail={period.code}
    >
      {period.status === 'OPEN' ? 'Close' : 'Reopen'}
    </ActionButton>
  );
}
