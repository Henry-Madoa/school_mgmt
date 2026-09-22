/* action results — split out of lib/types.ts; import from '@/lib/types', never from here directly. */

/* ----------------------------------------------------------- action results */

export type ActionSuccess<T> = { ok: true; data: T };
export type ActionFailure = { ok: false; error: string; code: string };

/**
 * What every Server Action returns. Business failures come back as data because
 * an uncaught throw is replaced by an opaque digest in production.
 */
export type ActionResult<T = unknown> = ActionSuccess<T> | ActionFailure;

/** A form read into a plain object by readForm(). */
export type FormValues = Record<string, string | number>;
