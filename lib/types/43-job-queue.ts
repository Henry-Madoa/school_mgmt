/* job queue — split out of lib/types.ts; import from '@/lib/types', never from here directly. */
import type { IsoDate, IsoDateTime } from '../types.ts';

/* --------------------------------------------------------------- job queue */

/** Which background task a Job Queue Entry runs — see lib/jobQueue.ts's JOB_HANDLERS. Currently
 *  only Entrance Fee Recovery is implemented; the type is a plain string union (not yet backed
 *  by a DB enum) so a future job type is one JOB_HANDLERS entry away, no migration required. */
export type JobQueueType = 'SESSION_PURGE' | 'OUTBOX_DISPATCH' | 'MPESA_STK_QUERY' | 'FEE_REMINDERS';

export type JobQueueStatus = 'READY' | 'ON HOLD';
export type JobQueueRunStatus = 'SUCCESS' | 'ERROR';

export interface JobQueueEntry {
  id: number;
  code: string;
  description: string;
  job_type: JobQueueType;
  run_every_minutes: number;
  earliest_start_date: IsoDate | null;
  status: JobQueueStatus;
  next_run_at: IsoDateTime | null;
  last_run_at: IsoDateTime | null;
  last_run_status: JobQueueRunStatus | null;
  last_run_message: string | null;
  locked_by: string | null;
  locked_until: IsoDateTime | null;
  created_at: IsoDateTime | null;
  created_by: string | null;
  updated_at: IsoDateTime | null;
  updated_by: string | null;
}
