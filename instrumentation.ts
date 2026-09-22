/*
 * System Automation's unattended half — Next.js calls register() once when the server process
 * starts (https://nextjs.org/docs/app/guides/instrumentation), which is the only hook this app
 * has to start a background poller: there is no separate worker process, so "unattended" here
 * means "polled from inside the same Node process that serves requests".
 *
 * This file deliberately imports nothing from lib/ or app/. Next.js compiles instrumentation.ts
 * as its own bundle, separate from — and less capable than — the normal Route Handler/Server
 * Component pipeline: it does not honour next.config.mjs's serverExternalPackages, so pulling in
 * lib/jobQueue.ts here drags the whole app graph (down to `pg`'s optional native driver and
 * `cloudinary`'s Node-only `http`/`https` requires) into that stricter bundle and fails outright
 * in `next dev` — not a theoretical concern, this was verified by actually hitting it. The fix
 * is indirection: the poller here only pokes a normal Route Handler
 * (app/api/internal/job-queue-tick/route.ts), which compiles through the same pipeline every
 * other API route already does, and does the real work of calling lib/jobQueue.ts from there.
 *
 * Only meaningful for `next start`/`next dev` as a long-running process — a serverless deploy
 * (Vercel et al.) freezes function instances between requests, so a setInterval there would not
 * reliably keep firing. Self-hosted (this app's actual deployment shape) is a normal always-on
 * Node process, so this works as a lightweight cron replacement without a new dependency.
 */

const POLL_INTERVAL_MS = 60_000;

// Next.js reloads server modules in dev; hang the interval (and the shared secret below) off
// globalThis so a hot reload doesn't stack up a second poller running alongside the first, and
// so the token stays stable across reloads instead of locking out an in-flight tick.
const globalForPoller = globalThis as typeof globalThis & {
  __saccoJobQueuePoller?: ReturnType<typeof setInterval>;
  __saccoJobQueueToken?: string;
};

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (globalForPoller.__saccoJobQueuePoller) return;

  // A same-process shared secret (never sent anywhere else) so the tick endpoint can tell this
  // poller apart from an arbitrary internet request — see the Route Handler's own check.
  const token = (globalForPoller.__saccoJobQueueToken ??= crypto.randomUUID());
  // Self-hosted deployments run on one fixed port (PORT, defaulting to Next's own 3000); this
  // assumption only breaks in local dev if that port is already taken by something else, in
  // which case the poller simply has nothing to reach and logs a fetch failure each tick.
  const url = `http://127.0.0.1:${process.env.PORT || 3000}/api/internal/job-queue-tick`;

  const tick = () => {
    fetch(url, { method: 'POST', headers: { 'x-internal-token': token } }).catch((e) => {
      console.error('[job-queue] poll failed:', e);
    });
  };

  // Delayed first tick — right at boot the HTTP listener this fetches may not be accepting
  // connections yet.
  setTimeout(tick, 5_000);
  globalForPoller.__saccoJobQueuePoller = setInterval(tick, POLL_INTERVAL_MS);
}
