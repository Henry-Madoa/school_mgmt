'use client';

import { useRunAction } from '@/components/ui/run-action';
import { setApplicationStatusRequest } from '@/app/actions/admissions';
import type { ApplicationStatus } from '@/lib/admissions';
import { STATUS_LABEL } from './application-card';

export function ApplicationStatusButton({ id, status, className = 'btn ghost' }: { id: number; status: ApplicationStatus; className?: string }) {
  const { run, busy } = useRunAction();
  return <button type="button" className={className} disabled={busy} onClick={() => run(() => setApplicationStatusRequest(id, status), { successTitle: `Marked ${STATUS_LABEL[status].toLowerCase()}` })}>{busy ? '…' : STATUS_LABEL[status]}</button>;
}
