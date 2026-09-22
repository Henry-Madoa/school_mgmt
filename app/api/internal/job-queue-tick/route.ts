/*
 * System Automation's own poller (instrumentation.ts) calls this once a minute rather than
 * importing lib/jobQueue.ts directly from instrumentation.ts — see that file's header comment
 * for why. This route runs through the normal Route Handler bundling pipeline, same as every
 * other route under app/api, so it has none of instrumentation.ts's bundling restrictions.
 *
 * Not a user-facing endpoint: it authenticates with a same-process shared secret
 * (instrumentation.ts's crypto.randomUUID(), read back off globalThis — both live in the one
 * Node process this app runs as) rather than a signed-in session, since nothing about "is it
 * time to run a background job" is a person's action to authorize.
 */
import { runDueJobQueueEntries } from '@/lib/jobQueue';

export async function POST(request: Request): Promise<Response> {
  const expected = (globalThis as { __saccoJobQueueToken?: string }).__saccoJobQueueToken;
  const given = request.headers.get('x-internal-token');
  if (!expected || given !== expected) {
    return new Response('Forbidden', { status: 403 });
  }
  await runDueJobQueueEntries();
  return Response.json({ ok: true });
}
