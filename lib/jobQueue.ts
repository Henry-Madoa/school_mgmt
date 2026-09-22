/*
 * System Automation (Job Queue) — mirrors Business Central's Job Queue Entry: an admin-managed
 * list of recurring background tasks, each dispatched by `job_type` (JOB_HANDLERS below) and
 * polled unattended by the in-process scheduler (instrumentation.ts's setInterval, since this
 * app has no separate worker process). AL's own Recurrence (a Day/Time-of-day pattern) is
 * simplified here to a plain "every N minutes" interval plus an optional earliest-start date —
 * a simplification of the DateFormula the AL uses.
 *
 * Implemented jobs: Session Purge (lib/auth.ts), Message Outbox Dispatch (lib/outbox.ts), M-Pesa
 * Payment Request Status (lib/mpesa) and Fee Balance Reminders (lib/fees/reminders.ts).
 * JOB_HANDLERS is where a future job type would register its own runner.
 */
import { one, all, run, audit } from './db.ts';
import { AppError } from './errors.ts';
import { purgeStaleSessions } from './auth.ts';
import { dispatchOutbox } from './outbox.ts';
import { chasePendingStk } from './mpesa/index.ts';
import { runFeeReminders } from './fees/reminders.ts';
// The transports register themselves with the outbox when these load — the dispatcher needs them.
import './mailer.ts';
import './sms.ts';
import { hostname } from 'node:os';
import type { Actor, JobQueueEntry, JobQueueRunStatus, JobQueueStatus, JobQueueType } from './types.ts';

/** One named runner per JobQueueType — the dispatch table both the manual "Run now" button and
 *  the unattended poller call through. A handler throws to signal failure (caught and recorded
 *  by the caller) and returns a short human-readable outcome to store as last_run_message. */
const JOB_HANDLERS: Record<JobQueueType, (user: Actor) => Promise<string>> = {
  // Expired and idle sign-in sessions (lib/auth.ts purgeStaleSessions).
  SESSION_PURGE: async () => `${await purgeStaleSessions()} stale session(s) removed`,
  // Queued e-mails and SMS (lib/outbox.ts) — retries with back-off, parks what cannot be sent.
  OUTBOX_DISPATCH: async () => {
    const r = await dispatchOutbox();
    return `${r.sent} sent, ${r.retried} to retry, ${r.failed} failed`;
  },
  // STK pushes whose callback never came (lib/mpesa chasePendingStk).
  MPESA_STK_QUERY: async () => {
    const r = await chasePendingStk();
    return `${r.checked} pending request(s) checked, ${r.settled} settled`;
  },
  // Guardians with an outstanding fee balance past its due date are reminded by SMS/e-mail (lib/fees/reminders.ts).
  FEE_REMINDERS: async (user) => {
    const r = await runFeeReminders(user);
    return `${r.reminded} guardian(s) reminded, ${r.skipped} skipped`;
  },
};

/** Human-readable names for the job types, for the Admin Centre picker. */
export const JOB_TYPE_LABELS: Record<JobQueueType, string> = {
  SESSION_PURGE: 'Session Purge',
  OUTBOX_DISPATCH: 'Message Outbox Dispatch',
  MPESA_STK_QUERY: 'M-Pesa Payment Request Status',
  FEE_REMINDERS: 'Fee Balance Reminders',
};

/** This instance's name on a lease — the host plus the process, so two replicas on one box differ. */
const INSTANCE = `${hostname()}#${process.pid}`;
/** A run may hold its lease this long before another instance may assume it died mid-run. */
const LEASE_MINUTES = 30;

export const listJobQueueEntries = (): Promise<JobQueueEntry[]> =>
  all<JobQueueEntry>('SELECT * FROM job_queue_entry ORDER BY code');

export const getJobQueueEntry = (id: number): Promise<JobQueueEntry | undefined> =>
  one<JobQueueEntry>('SELECT * FROM job_queue_entry WHERE id = ?', id);

/** now + run_every_minutes, expressed the way every other IsoDateTime in this app is: a plain
 *  ISO string, not a DB-side interval — keeps computeNextRunAt trivially testable and mirrors
 *  how the rest of the codebase (e.g. lib/format.ts's addMonths) does date arithmetic in JS. */
const minutesFromNow = (minutes: number): string => new Date(Date.now() + minutes * 60_000).toISOString();

export interface JobQueueEntryInput {
  code: string;
  description: string;
  job_type: JobQueueType;
  run_every_minutes: number;
  earliest_start_date?: string | null;
}

/** Shared by create and update. Code is deliberately not checked here — the edit form disables
 *  its Code field (immutable once created), and a disabled <input> is omitted from FormData
 *  entirely, so requiring it here would reject every edit. createJobQueueEntry() checks it
 *  separately, since only creation actually needs one. */
function assertValid(input: JobQueueEntryInput): void {
  if (!input.description?.trim()) throw new AppError('Description is required', 'VALIDATION');
  if (!JOB_HANDLERS[input.job_type]) throw new AppError('Invalid job type', 'VALIDATION');
  if (!Number.isFinite(input.run_every_minutes) || input.run_every_minutes < 1) {
    throw new AppError('Run every (minutes) must be at least 1', 'VALIDATION');
  }
}

/** New entries start ON HOLD — the same "an admin must deliberately switch this on" default a
 *  freshly seeded system automation should have, rather than silently moving money the moment
 *  it's created. next_run_at is still seeded to now so it is immediately due the moment the
 *  admin flips it to Ready, instead of waiting a full run_every_minutes first. */
export async function createJobQueueEntry(input: JobQueueEntryInput, user: Actor): Promise<{ id: number }> {
  if (!input.code?.trim()) throw new AppError('Code is required', 'VALIDATION');
  assertValid(input);
  const code = input.code.trim().toUpperCase();
  if (await one('SELECT 1 FROM job_queue_entry WHERE code = ?', code)) {
    throw new AppError('Job Queue Entry code already exists', 'DUPLICATE');
  }
  const now = new Date().toISOString();
  const info = await run(
    `INSERT INTO job_queue_entry
       (code, description, job_type, run_every_minutes, earliest_start_date, status, next_run_at,
        created_at, created_by)
     VALUES (?,?,?,?,?,'ON HOLD',?,?,?)`,
    code, input.description.trim(), input.job_type, Math.round(input.run_every_minutes),
    input.earliest_start_date || null, now, now, user.username,
  );
  await audit(user, 'JOB_QUEUE_ENTRY_CREATE', 'job_queue_entry', info.lastInsertRowid, { code, jobType: input.job_type });
  return { id: Number(info.lastInsertRowid) };
}

export async function updateJobQueueEntry(
  id: number, input: JobQueueEntryInput, user: Actor,
): Promise<JobQueueEntry> {
  const before = await getJobQueueEntry(id);
  if (!before) throw new AppError('Job Queue Entry not found', 'NOT_FOUND');
  assertValid(input);
  await run(
    `UPDATE job_queue_entry
     SET description = ?, job_type = ?, run_every_minutes = ?, earliest_start_date = ?, updated_at = ?, updated_by = ?
     WHERE id = ?`,
    input.description.trim(), input.job_type, Math.round(input.run_every_minutes),
    input.earliest_start_date || null, new Date().toISOString(), user.username, id,
  );
  await audit(user, 'JOB_QUEUE_ENTRY_UPDATE', 'job_queue_entry', id, { fields: Object.keys(input) });
  return (await getJobQueueEntry(id))!;
}

/** Ready <-> On Hold — flipping to Ready also seeds next_run_at to now, the same "immediately
 *  due" treatment createJobQueueEntry gives a brand new entry, so re-enabling a long-dormant
 *  entry doesn't silently wait out a full interval before its first run. */
export async function setJobQueueEntryStatus(id: number, status: JobQueueStatus, user: Actor): Promise<void> {
  const before = await getJobQueueEntry(id);
  if (!before) throw new AppError('Job Queue Entry not found', 'NOT_FOUND');
  await run(
    'UPDATE job_queue_entry SET status = ?, next_run_at = ?, updated_at = ?, updated_by = ? WHERE id = ?',
    status, status === 'READY' ? new Date().toISOString() : before.next_run_at,
    new Date().toISOString(), user.username, id,
  );
  await audit(user, 'JOB_QUEUE_ENTRY_SET_STATUS', 'job_queue_entry', id, { status });
}

export async function deleteJobQueueEntry(id: number, user: Actor): Promise<void> {
  const before = await getJobQueueEntry(id);
  if (!before) throw new AppError('Job Queue Entry not found', 'NOT_FOUND');
  await run('DELETE FROM job_queue_entry WHERE id = ?', id);
  await audit(user, 'JOB_QUEUE_ENTRY_DELETE', 'job_queue_entry', id, { code: before.code });
}

/** Guards against the poller and a manual "Run now" click overlapping on the same entry — this
 *  is a single Node process (no separate worker), so an in-memory set is enough; it resets on
 *  every restart, which is fine since nothing is "in flight" across a restart anyway. */
const running = new Set<number>();

/**
 * Take the entry's lease in the database — one atomic UPDATE that only succeeds while nobody
 * else holds a live lease — so two application instances polling the same table (or the poller
 * and a "Run now" click on another instance) cannot both run it. A lease left behind by an
 * instance that died mid-run lapses after LEASE_MINUTES.
 */
async function acquireLease(entryId: number): Promise<boolean> {
  const now = new Date().toISOString();
  const res = await run(
    `UPDATE job_queue_entry SET locked_by = ?, locked_until = ?
     WHERE id = ? AND (locked_until IS NULL OR locked_until < ?)`,
    INSTANCE, minutesFromNow(LEASE_MINUTES), entryId, now,
  );
  return res.changes === 1;
}

async function execute(entry: JobQueueEntry, user: Actor): Promise<void> {
  if (running.has(entry.id)) return;
  if (!(await acquireLease(entry.id))) return;
  running.add(entry.id);
  const startedAt = new Date().toISOString();
  try {
    const message = await JOB_HANDLERS[entry.job_type](user);
    await run(
      `UPDATE job_queue_entry
       SET last_run_at = ?, last_run_status = 'SUCCESS', last_run_message = ?, next_run_at = ?, locked_by = NULL, locked_until = NULL
       WHERE id = ?`,
      startedAt, message, minutesFromNow(entry.run_every_minutes), entry.id,
    );
  } catch (e) {
    const message = (e as Error).message || 'Run failed';
    await run(
      `UPDATE job_queue_entry
       SET last_run_at = ?, last_run_status = 'ERROR', last_run_message = ?, next_run_at = ?, locked_by = NULL, locked_until = NULL
       WHERE id = ?`,
      startedAt, message, minutesFromNow(entry.run_every_minutes), entry.id,
    );
    await audit(user, 'JOB_QUEUE_ENTRY_RUN_ERROR', 'job_queue_entry', entry.id, { message });
  } finally {
    running.delete(entry.id);
  }
}

/** Runs one entry immediately regardless of next_run_at or status — the admin screen's "Run
 *  now". Still reschedules next_run_at from this run, so a manual run doesn't leave the next
 *  unattended run due sooner than run_every_minutes after it. */
export async function runJobQueueEntryNow(id: number, user: Actor): Promise<void> {
  const entry = await getJobQueueEntry(id);
  if (!entry) throw new AppError('Job Queue Entry not found', 'NOT_FOUND');
  if (running.has(id) || (entry.locked_until && entry.locked_until > new Date().toISOString())) {
    throw new AppError(`This entry is already running${entry.locked_by ? ` on ${entry.locked_by}` : ''}`, 'VALIDATION');
  }
  await execute(entry, user);
}

/** The unattended poller's own entry point — called on an interval by instrumentation.ts.
 *  Picks up every READY entry whose earliest_start_date has arrived (or is unset) and whose
 *  next_run_at is due (or unset), and runs each as the system actor. Entries run sequentially:
 *  this is a lightly loaded background sweep, not a high-throughput queue, so there is no
 *  benefit to parallelising it and every extra concurrent job is one more thing that could
 *  contend with interactive requests for a DB connection. */
export async function runDueJobQueueEntries(): Promise<void> {
  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10);
  const due = await all<JobQueueEntry>(
    `SELECT * FROM job_queue_entry
     WHERE status = 'READY'
       AND (earliest_start_date IS NULL OR earliest_start_date <= ?)
       AND (next_run_at IS NULL OR next_run_at <= ?)
     ORDER BY id`,
    today, nowIso,
  );
  const system: Actor = { id: 1, username: 'system' };
  for (const entry of due) {
    await execute(entry, system);
  }
}
