'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { useRunAction } from '@/components/ui/run-action';
import {
  createJobQueueEntryRequest, updateJobQueueEntryRequest, setJobQueueEntryStatusRequest,
  deleteJobQueueEntryRequest, runJobQueueEntryNowRequest,
} from '@/app/actions/jobQueue';
import { JOB_QUEUE_TYPES } from '@/lib/constants';
import type { JobQueueEntry } from '@/lib/types';

export function JobQueueEntryFormButton({ entry, className = 'btn', children }: {
  entry?: JobQueueEntry | null;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const e = entry ?? null;

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          title={e ? `Edit ${e.code}` : 'New Job Queue Entry'}
          onClose={() => setOpen(false)}
          onSubmit={(values) => (e ? updateJobQueueEntryRequest(e.id, values) : createJobQueueEntryRequest(values))}
          submitLabel={e ? 'Save changes' : 'Create'}
          successTitle={e ? 'Entry updated' : 'Entry created'}
          successDetail={() => 'It starts On Hold — switch it to Ready to let it run.'}
        >
          <Field name="code" label="Code" required placeholder="e.g. ENTRANCE-FEE" defaultValue={e?.code} disabled={!!e} uppercase />
          <Field name="description" label="Description" required placeholder="e.g. Nightly entrance fee sweep" defaultValue={e?.description} />
          <Field name="job_type" label="Job" type="select" required
            options={JOB_QUEUE_TYPES.map((t) => ({ value: t.value, label: t.label }))}
            defaultValue={e?.job_type ?? JOB_QUEUE_TYPES[0]?.value} />
          <Field name="run_every_minutes" label="Run every (minutes)" type="number" min={1} required
            defaultValue={e?.run_every_minutes ?? 60} />
          <Field name="earliest_start_date" label="Earliest start date" type="date"
            defaultValue={e?.earliest_start_date ?? ''}
            hint="Leave blank to let it become due immediately once switched to Ready" />
        </FormModal>
      ) : null}
    </>
  );
}

export function ToggleJobQueueStatusButton({ entry, className = 'btn sm' }: { entry: JobQueueEntry; className?: string }) {
  const { run, busy } = useRunAction();
  const toReady = entry.status === 'ON HOLD';
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => setJobQueueEntryStatusRequest(entry.id, toReady ? 'READY' : 'ON HOLD'), {
        successTitle: toReady ? 'Switched to Ready' : 'Switched to On Hold',
      })}>
      {busy ? 'Working…' : toReady ? 'Set Ready' : 'Set On Hold'}
    </button>
  );
}

export function RunJobQueueEntryButton({ entry, className = 'btn sm ghost' }: { entry: JobQueueEntry; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => runJobQueueEntryNowRequest(entry.id), {
        confirm: {
          title: `Run ${entry.code} now?`,
          message: 'This runs immediately, outside its normal schedule, and reschedules its next run from now.',
          confirmLabel: 'Run now',
        },
        successTitle: 'Run complete',
        successDetail: () => 'Check Last run below for the outcome.',
      })}>
      {busy ? 'Working…' : 'Run now'}
    </button>
  );
}

export function DeleteJobQueueEntryButton({ id, className = 'btn sm ghost' }: { id: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => deleteJobQueueEntryRequest(id), {
        confirm: { title: 'Delete this entry?', message: 'This cannot be undone.', confirmLabel: 'Delete' },
        successTitle: 'Deleted',
      })}>
      {busy ? 'Working…' : 'Delete'}
    </button>
  );
}
