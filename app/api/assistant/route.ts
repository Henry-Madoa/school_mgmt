/*
 * POST /api/assistant — the in-app assistant, as a server-sent event stream.
 *
 * Body: { messages: [{ role: 'user' | 'assistant', content }] } — the browser-held conversation,
 * last entry the new question. Response: text/event-stream, one JSON event per line
 * (`text` deltas, `tool` running/done, then `done` or `error`).
 *
 * The signed-in session is required; the user's permissions decide which tools the model gets
 * (lib/assistant/tools.ts). Throttled per user so a runaway client cannot spend the API budget.
 */
import { getCurrentUser } from '@/lib/session';
import { runAssistant, assistantConfigured, type AssistantTurn } from '@/lib/assistant/assistant';
import { rateLimit, tooManyRequests } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

const PER_USER = { limit: 40, windowMs: 10 * 60_000 };

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return new Response('Sign in first', { status: 401 });
  if (!assistantConfigured()) return Response.json({ error: 'The assistant is not configured on this server (ANTHROPIC_API_KEY).' }, { status: 503 });
  const limit = rateLimit(`assistant:${user.id}`, PER_USER.limit, PER_USER.windowMs);
  if (!limit.ok) return tooManyRequests(limit, { error: 'Too many questions in a short time — try again shortly.' });

  let body: { messages?: unknown };
  try { body = await request.json(); } catch { return new Response('Bad request', { status: 400 }); }
  const raw = Array.isArray(body.messages) ? body.messages : [];
  const history: AssistantTurn[] = raw
    .filter((m): m is { role: string; content: string } => !!m && typeof m === 'object' && typeof (m as { content?: unknown }).content === 'string')
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 4000) }));
  if (!history.length) return new Response('Bad request', { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      try {
        await runAssistant(user, history, send);
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
  });
}
