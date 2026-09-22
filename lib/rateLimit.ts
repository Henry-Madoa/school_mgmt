/*
 * Fixed-window rate limiting, in process.
 *
 * This is an always-on Node process (see instrumentation.ts), so a per-process counter is the
 * right size for it: it stops a credential-stuffing loop against /login and an integration
 * hammering /ODataV4 or /WS from one address, without a Redis to run. Behind several replicas
 * each one keeps its own window — the limit is simply that many times looser, never tighter —
 * and a restart forgets everything, which is fine for a throttle (the account lockout in
 * lib/auth.ts is the durable defence).
 *
 * Keys are bounded: a sweep drops expired windows whenever the map grows past MAX_KEYS, so a
 * flood of distinct addresses cannot grow memory without limit.
 */

interface Window { count: number; resetAt: number }

const windows = new Map<string, Window>();
const MAX_KEYS = 10_000;

export interface RateLimitResult {
  ok: boolean;
  /** Attempts left in this window (0 when refused). */
  remaining: number;
  /** Seconds until the window resets — what a 429 sends as Retry-After. */
  retryAfterSeconds: number;
}

/**
 * Count one hit against `key` and say whether it is within `limit` per `windowMs`.
 * A refused hit still counts, so a client that keeps retrying keeps waiting.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  let w = windows.get(key);
  if (!w || w.resetAt <= now) {
    if (windows.size >= MAX_KEYS) for (const [k, v] of windows) if (v.resetAt <= now) windows.delete(k);
    w = { count: 0, resetAt: now + windowMs };
    windows.set(key, w);
  }
  w.count += 1;
  const retryAfterSeconds = Math.max(1, Math.ceil((w.resetAt - now) / 1000));
  return { ok: w.count <= limit, remaining: Math.max(limit - w.count, 0), retryAfterSeconds };
}

/** The caller's address as the reverse proxy reports it, else the connection's. */
export function clientIp(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for');
  return (fwd ? fwd.split(',')[0] : headers.get('x-real-ip') ?? 'local').trim() || 'local';
}

/* The limits, in one place. */
export const LIMITS = {
  /** Sign-in attempts per address, and per address+username, per 15 minutes. */
  loginPerIp: { limit: 60, windowMs: 15 * 60_000 },
  loginPerAccount: { limit: 10, windowMs: 15 * 60_000 },
  /** Web service calls per address per minute — a paybill or USSD gateway is a single address. */
  webServicePerIp: { limit: 600, windowMs: 60_000 },
  /** Unauthenticated web service calls per address per minute — failed Basic auth is the cheap part to abuse. */
  webServiceUnauthPerIp: { limit: 30, windowMs: 60_000 },
} as const;

/** A 429 with the standard headers. */
export const tooManyRequests = (r: RateLimitResult, body: string | object = 'Too many requests'): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: 429,
    headers: {
      'Retry-After': String(r.retryAfterSeconds),
      'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
