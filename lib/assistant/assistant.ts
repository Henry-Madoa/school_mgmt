/*
 * The assistant — Claude answering a signed-in user's questions about the school's own data,
 * within that user's permissions and nothing more.
 *
 * How the scope holds:
 *   - the model is given only the tools the user's permissions allow (lib/assistant/tools.ts),
 *     so an out-of-scope question has nothing to answer it with;
 *   - every tool re-checks the permission and validates its input before running;
 *   - the system prompt tells the model what this user can and cannot ask about, and to say so
 *     plainly — never to guess a figure, never to describe data it has not read;
 *   - every question and every tool call is written to the audit trail under the user.
 *
 * Streaming: text deltas and tool events are relayed to the browser as they happen
 * (app/api/assistant/route.ts turns them into server-sent events). The loop is the manual one
 * so the SSE relay and the permission gate sit in our own code.
 *
 * Model: claude-opus-5, adaptive thinking (its default), effort medium — this is short
 * question-answering over tool results, not long reasoning. Refusal fallbacks are on
 * (server-side-fallback, "default" routing) so a safety decline on the primary model is
 * re-run rather than shown as a blank. Those extras are optional API features: if the API
 * rejects the request shape (400) the same round is retried as a plain request and the
 * process stays in plain mode, so an account or gateway without them still gets answers.
 */
import Anthropic from '@anthropic-ai/sdk';
import { audit } from '../db.ts';
import { getOrg } from '../org.ts';
import { getActiveCompany } from '../companyContext.ts';
import { today } from '../format.ts';
import { toolsFor, toolDefinitions, runTool, scopeFor } from './tools.ts';
import type { SessionUser } from '../types.ts';

export const ASSISTANT_MODEL = 'claude-opus-5';
const MAX_TOOL_ROUNDS = 8;
const MAX_HISTORY_MESSAGES = 30;

export const assistantConfigured = (): boolean => !!process.env.ANTHROPIC_API_KEY;

let client: Anthropic | null = null;
/**
 * The client reads ANTHROPIC_API_KEY itself. An organisation-level key (one not scoped to a
 * workspace) is refused with a 400 unless every request names the workspace, so
 * ANTHROPIC_WORKSPACE_ID, when set, goes out as the `anthropic-workspace-id` header.
 */
const getClient = (): Anthropic => (client ??= new Anthropic({
  defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID } : undefined,
}));

/** Set once a 400 shows the optional request extras are not accepted here; sticks for the process. */
let plainRequests = false;

/** The API's own explanation of a 400, when the error body carries one. */
function apiErrorDetail(e: { error?: unknown }): string | null {
  const body = e.error as { error?: { message?: unknown } } | undefined;
  const m = body?.error?.message;
  return typeof m === 'string' && m.trim() ? m.trim().slice(0, 300) : null;
}

/** What the browser keeps and sends back — plain turns only; tool calls stay server-side per request. */
export interface AssistantTurn { role: 'user' | 'assistant'; content: string }

export type AssistantEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; status: 'running' | 'done' | 'failed' }
  | { type: 'done'; usage: { input: number; output: number; cached: number }; refused?: boolean }
  | { type: 'error'; message: string };

async function systemPrompt(user: SessionUser): Promise<string> {
  const [org, company] = await Promise.all([getOrg(), getActiveCompany().catch(() => null)]);
  const scope = scopeFor(user);
  const roles = [user.role_name, ...user.profiles.map((p) => p.name)].filter(Boolean);
  return [
    `You are the in-app assistant of ${org?.name ?? 'the school'}, a school, answering questions for its staff.`,
    `Today is ${today()}. Currency: ${org?.currency_code ?? 'KES'}.${company && !company.is_default ? ` The user is working in the "${company.display_name}" company (a test copy, not the live data).` : ''}`,
    ``,
    `The person asking is ${user.full_name} (username ${user.username}), role: ${roles.join(' / ')}.`,
    `They are permitted to ask about: ${scope.can.length ? scope.can.join('; ') : 'nothing beyond where screens are'}.`,
    scope.cannot.length ? `They are NOT permitted to ask about: ${scope.cannot.join('; ')}. If they ask about any of those, say plainly that their role does not include it and name what they can ask about instead. Do not hint at, estimate or reason about figures in those areas.` : '',
    ``,
    `Rules:`,
    `- Answer only from what the tools return. Never invent, estimate or arithmetically derive a money figure; quote the figures as returned. If a tool has not been called, you do not know the answer — call it or say you cannot.`,
    `- Resolve who or what the user means first (find_students) when a name or number is ambiguous; if several match, ask which.`,
    `- Be brief and specific: lead with the answer, then the two or three facts behind it. Use the document numbers and account numbers the tools return so the user can open them.`,
    `- This system is the school's own management system; do not mention any other product or vendor.`,
    `- You can only read. If asked to change, post, approve or create anything, explain where in the system they do that (find_screen) — you cannot do it for them.`,
    `- Do not include internal or system XML tags in your response.`,
  ].filter((l) => l !== undefined).join('\n');
}

/**
 * Answer the latest user message given the browser-held history. Events are pushed to `emit` as
 * they happen; the returned promise resolves when the turn is complete.
 */
export async function runAssistant(user: SessionUser, history: AssistantTurn[], emit: (e: AssistantEvent) => void): Promise<void> {
  if (!assistantConfigured()) { emit({ type: 'error', message: 'The assistant is not configured on this server.' }); return; }
  const tools = toolsFor(user);
  const definitions = toolDefinitions(tools);
  const system = await systemPrompt(user);
  const question = history.filter((t) => t.role === 'user').at(-1)?.content ?? '';
  const messages: Anthropic.Beta.BetaMessageParam[] = history.slice(-MAX_HISTORY_MESSAGES)
    .filter((t) => t.content.trim())
    .map((t) => ({ role: t.role, content: t.content }));
  if (!messages.length || messages[messages.length - 1].role !== 'user') { emit({ type: 'error', message: 'Nothing to answer.' }); return; }

  const toolsUsed: string[] = [];
  const usage = { input: 0, output: 0, cached: 0 };
  let refused = false;
  const api = getClient();

  const streamRound = (plain: boolean) => {
    const base = {
      model: ASSISTANT_MODEL,
      max_tokens: 4096,
      system: [{ type: 'text' as const, text: system, cache_control: { type: 'ephemeral' as const } }],
      tools: definitions,
      messages,
    };
    return plain
      ? api.beta.messages.stream(base)
      : api.beta.messages.stream({ ...base, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', output_config: { effort: 'medium' } });
  };

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      let message: Anthropic.Beta.BetaMessage;
      try {
        const stream = streamRound(plainRequests);
        stream.on('text', (delta) => emit({ type: 'text', delta }));
        message = await stream.finalMessage();
      } catch (e) {
        // The optional extras are the usual reason for a 400 — drop them and try the round again.
        if (plainRequests || !(e instanceof Anthropic.BadRequestError)) throw e;
        console.warn('[assistant] request extras rejected, switching to plain requests:', apiErrorDetail(e) ?? e.message);
        plainRequests = true;
        const stream = streamRound(true);
        stream.on('text', (delta) => emit({ type: 'text', delta }));
        message = await stream.finalMessage();
      }
      usage.input += message.usage.input_tokens;
      usage.output += message.usage.output_tokens;
      usage.cached += message.usage.cache_read_input_tokens ?? 0;

      if (message.stop_reason === 'refusal') { refused = true; break; }
      if (message.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: message.content }); continue; }
      const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (message.stop_reason !== 'tool_use' || !toolUses.length) break;
      if (round === MAX_TOOL_ROUNDS) { emit({ type: 'text', delta: '\n\nI stopped after several lookups without a final answer — try a narrower question.' }); break; }

      messages.push({ role: 'assistant', content: message.content });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const use of toolUses) {
        emit({ type: 'tool', name: use.name, status: 'running' });
        const r = await runTool(tools, use.name, use.input, user);
        toolsUsed.push(use.name);
        emit({ type: 'tool', name: use.name, status: r.ok ? 'done' : 'failed' });
        results.push({ type: 'tool_result', tool_use_id: use.id, content: r.content, is_error: !r.ok });
      }
      messages.push({ role: 'user', content: results });
    }
    emit({ type: 'done', usage, refused });
  } catch (e) {
    const message = e instanceof Anthropic.RateLimitError ? 'The assistant is busy — try again in a moment.'
      : e instanceof Anthropic.AuthenticationError ? 'The assistant’s API key is not valid.'
        : e instanceof Anthropic.BadRequestError ? `The assistant could not answer (400${apiErrorDetail(e) ? `: ${apiErrorDetail(e)}` : ''}).`
          : e instanceof Anthropic.APIError ? `The assistant could not answer (${e.status}).`
          : 'The assistant could not answer.';
    console.error('[assistant]', e);
    emit({ type: 'error', message });
  } finally {
    await audit(user, 'ASSISTANT_ASK', 'app_user', user.id, {
      question: question.slice(0, 500), tools: toolsUsed, refused, usage,
    }).catch(() => undefined);
  }
}
