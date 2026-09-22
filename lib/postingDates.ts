/*
 * BC-style posting-date control — General Ledger Setup's "Allow Posting From"/"Allow Posting To"
 * (organisation.allow_posting_from/to), narrowable per user in User Setup
 * (approval_user_setup.allow_posting_from/to — blank falls back to the organisation's), plus a
 * per-user "Work Date" (My Settings) that must itself fall inside that same effective range.
 *
 * The one addition beyond stock BC: a time-of-day refinement on the two boundary dates only
 * (allow_posting_from_time/allow_posting_to_time) — a posting dated exactly the From date must be
 * at/after that time of day, dated exactly the To date, at/before it; every date strictly between
 * the two boundaries is never time-restricted. "Now" is plain `new Date()`, the same UTC
 * simplification format.ts's own today() already makes everywhere else in this app — this isn't
 * the place to introduce organisation.timezone-aware wall-clock handling that doesn't exist
 * anywhere else yet.
 *
 * Enforced once, centrally, in accounting.ts's postJournal() — the one choke point every posting
 * in the system already goes through — the same pattern canReverseJournal()'s own per-user grant
 * already uses.
 */
import { one, run, audit } from './db.ts';
import { AppError, PostingError } from './errors.ts';
import { getOrg } from './org.ts';
import { today } from './format.ts';
import type { Actor, IsoDate } from './types.ts';

export interface EffectivePostingRange {
  from: IsoDate | null;
  to: IsoDate | null;
  /** Only meaningful paired with `from`/`to` respectively — see the module doc comment. */
  fromTime: string | null;
  toTime: string | null;
}

/** Resolves the posting-date window that applies to one user: their own User Setup override if
 *  either bound is set, else the organisation's global range, else unrestricted. */
export async function getEffectivePostingRange(userId: number): Promise<EffectivePostingRange> {
  const userRow = await one<{
    allow_posting_from: string | null; allow_posting_to: string | null;
    allow_posting_from_time: string | null; allow_posting_to_time: string | null;
  }>(
    `SELECT allow_posting_from, allow_posting_to, allow_posting_from_time, allow_posting_to_time
     FROM approval_user_setup WHERE user_id = ?`,
    userId,
  );
  if (userRow && (userRow.allow_posting_from || userRow.allow_posting_to)) {
    return {
      from: userRow.allow_posting_from, to: userRow.allow_posting_to,
      fromTime: userRow.allow_posting_from_time, toTime: userRow.allow_posting_to_time,
    };
  }
  const org = await getOrg();
  return { from: org?.allow_posting_from ?? null, to: org?.allow_posting_to ?? null, fromTime: null, toTime: null };
}

/** BC's own SUPER permission set bypasses Allow Posting From/To entirely — this port's closest
 *  equivalent is a system role (canTable()/canAction()'s own blanket bypass), so it gets the same
 *  exemption here rather than letting a misconfigured range lock an administrator out. */
async function isExemptFromPostingDateChecks(userId: number): Promise<boolean> {
  const row = await one<{ is_system: number }>(
    'SELECT r.is_system FROM app_user u JOIN role r ON r.id = u.role_id WHERE u.id = ?', userId,
  );
  return !!row?.is_system;
}

/** Every job-queue-driven background posting (interest accrual, entrance fee recovery, standing
 *  orders, checkoff, ...) runs as this exact synthetic actor (see jobQueue.ts/seed.ts) — its `id`
 *  happens to collide with a real app_user row in a freshly seeded database, so this has to be
 *  checked by username, not id, or a background job would silently inherit whichever human
 *  happens to occupy user id 1's own Work Date and posting restrictions. */
const isSystemActor = (actor: Actor | null | undefined): boolean => !actor || actor.username === 'system';

/** Throws unless `valueDate` falls within `actor`'s effective posting range. Called from
 *  postJournal() for every real posting; a null or system actor (background jobs) is never
 *  subject to this at all, the same way canReverseJournal()'s own check is skipped for a null
 *  user. */
export async function assertPostingDateAllowed(valueDate: IsoDate, actor: Actor | null | undefined): Promise<void> {
  if (isSystemActor(actor)) return;
  const userId = actor!.id;
  const range = await getEffectivePostingRange(userId);
  if (!range.from && !range.to) return;
  if (await isExemptFromPostingDateChecks(userId)) return;

  if (range.from && valueDate < range.from) {
    throw new PostingError(
      `Posting date ${valueDate} is before the earliest date you're allowed to post (${range.from})`,
      'POSTING_DATE_NOT_ALLOWED',
    );
  }
  if (range.to && valueDate > range.to) {
    throw new PostingError(
      `Posting date ${valueDate} is after the latest date you're allowed to post (${range.to})`,
      'POSTING_DATE_NOT_ALLOWED',
    );
  }
  const nowTime = new Date().toISOString().slice(11, 16);
  if (range.from && range.fromTime && valueDate === range.from && nowTime < range.fromTime) {
    throw new PostingError(`You may only post on ${range.from} at or after ${range.fromTime}`, 'POSTING_DATE_NOT_ALLOWED');
  }
  if (range.to && range.toTime && valueDate === range.to && nowTime > range.toTime) {
    throw new PostingError(`You may only post on ${range.to} at or before ${range.toTime}`, 'POSTING_DATE_NOT_ALLOWED');
  }
}

/** The date a posting should actually use when nothing more specific was chosen — every
 *  "process"/"post" function that used to hardcode `today()` for its ledger valueDate now calls
 *  this instead, so Posting Date follows the acting user's Work Date exactly like BC's own
 *  General Journal does, while whatever separate "Document Date"/created_at timestamp that
 *  function also records keeps using the real today()/now() untouched — those two are meant to
 *  read differently (when the paperwork is dated vs. when it actually posted). A null or system
 *  actor (background jobs) always gets the real today() — there is no human Work Date to resolve. */
export async function resolvePostingDate(actor: Actor | null | undefined): Promise<IsoDate> {
  return isSystemActor(actor) ? today() : getWorkDate(actor!.id);
}

/** This user's own suggested default date (BC's "Work Date", set via My Settings), falling back
 *  to the real system date if unset — or if an admin has since narrowed the effective range so
 *  the saved value no longer fits it, silently, rather than surfacing a stale date to whatever
 *  form just wants a sensible default. */
export async function getWorkDate(userId: number): Promise<IsoDate> {
  const row = await one<{ work_date: string | null }>('SELECT work_date FROM app_user WHERE id = ?', userId);
  if (!row?.work_date) return today();
  const range = await getEffectivePostingRange(userId);
  if (range.from && row.work_date < range.from) return today();
  if (range.to && row.work_date > range.to) return today();
  return row.work_date;
}

/** Sets or clears (empty date) this user's own Work Date — validated against their own effective
 *  posting range (their own User Setup override, else the organisation's), same as a real posting
 *  would be. */
export async function setWorkDate(userId: number, date: string, actor: Actor): Promise<void> {
  const trimmed = date.trim();
  if (!trimmed) {
    await run('UPDATE app_user SET work_date = NULL WHERE id = ?', userId);
    await audit(actor, 'WORK_DATE_CLEAR', 'app_user', userId, {});
    return;
  }
  const range = await getEffectivePostingRange(userId);
  if (range.from && trimmed < range.from) {
    throw new AppError(`Work date cannot be before ${range.from}, your earliest allowed posting date`, 'VALIDATION');
  }
  if (range.to && trimmed > range.to) {
    throw new AppError(`Work date cannot be after ${range.to}, your latest allowed posting date`, 'VALIDATION');
  }
  await run('UPDATE app_user SET work_date = ? WHERE id = ?', trimmed, userId);
  await audit(actor, 'WORK_DATE_SET', 'app_user', userId, { date: trimmed });
}
