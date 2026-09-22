'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

/*
 * The in-app assistant: a floating button that opens a chat panel. The conversation lives in this
 * component (and sessionStorage, so a page change keeps it); every question is sent with the
 * history to /api/assistant, which streams the answer back as server-sent events. What the
 * assistant may look up is decided server-side from the signed-in user's permissions — this
 * panel only renders what comes back.
 */

interface Turn { role: 'user' | 'assistant'; content: string; tools?: string[]; error?: string }
type Event =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; status: 'running' | 'done' | 'failed' }
  | { type: 'done'; usage: { input: number; output: number; cached: number }; refused?: boolean }
  | { type: 'error'; message: string };

const STORE_KEY = 'school_assistant_turns';
const TOOL_LABELS: Record<string, string> = {
  find_students: 'Looking up students', get_student: 'Reading the student', fee_statement: 'Reading the fee statement', fee_balances: 'Summarising fee balances',
  report_card: 'Reading the report card', attendance: 'Reading attendance', school_snapshot: 'Reading the school snapshot', gl_account_balances: 'Reading ledger balances',
  trial_balance: 'Reading the trial balance', financial_statements: 'Reading the financial statements', my_pending_approvals: 'Checking your approvals',
  find_screen: 'Finding the screen', school_info: 'Reading school details',
};

export function AssistantPanel({ enabled, scope }: { enabled: boolean; scope: string[] }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    try { const raw = sessionStorage.getItem(STORE_KEY); if (raw) setTurns(JSON.parse(raw)); } catch { /* storage unavailable */ }
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(turns.slice(-40))); } catch { /* storage unavailable */ }
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [turns]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); if ((e.ctrlKey || e.metaKey) && e.key === '/') { e.preventDefault(); setOpen((o) => !o); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    const history: Turn[] = [...turns, { role: 'user', content: q }];
    setTurns([...history, { role: 'assistant', content: '', tools: [] }]);
    setInput('');
    setBusy(true);
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const res = await fetch('/api/assistant', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.signal,
        body: JSON.stringify({ messages: history.map((t) => ({ role: t.role, content: t.content })) }),
      });
      if (!res.ok || !res.body) {
        const err = res.status === 429 ? 'Too many questions in a short time — try again shortly.'
          : res.status === 503 ? 'The assistant is not configured on this server.' : `The assistant could not answer (${res.status}).`;
        setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 ? { ...t, error: err } : t)));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const patchLast = (fn: (t: Turn) => Turn) => setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 ? fn(t) : t)));
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf('\n\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 2);
          if (!line.startsWith('data: ')) continue;
          const ev = JSON.parse(line.slice(6)) as Event;
          if (ev.type === 'text') patchLast((t) => ({ ...t, content: t.content + ev.delta }));
          else if (ev.type === 'tool') {
            setActiveTool(ev.status === 'running' ? ev.name : null);
            if (ev.status !== 'running') patchLast((t) => ({ ...t, tools: [...(t.tools ?? []), ev.name] }));
          } else if (ev.type === 'error') patchLast((t) => ({ ...t, error: ev.message }));
          else if (ev.type === 'done' && ev.refused) patchLast((t) => ({ ...t, error: t.content ? undefined : 'The assistant declined to answer that.' }));
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 ? { ...t, error: 'Connection lost — try again.' } : t)));
    } finally {
      setBusy(false);
      setActiveTool(null);
      abortRef.current = null;
    }
  };

  const suggestions = [
    scope.includes('students, their guardians and classes') ? 'Find student Mwangi and show their guardians' : null,
    scope.includes('fee balances, invoices and statements') ? 'Which students have overdue fees in Grade 4?' : null,
    scope.includes('attendance registers') ? 'What was attendance like this week?' : null,
    scope.includes('the general ledger and account balances') ? 'What is the cash in hand balance?' : null,
    scope.includes('financial statements') ? 'Summarise this year’s income statement' : null,
    scope.includes('their own pending approvals') ? 'What is waiting for my approval?' : null,
    'Where do I receipt a fee payment?',
  ].filter((s): s is string => !!s).slice(0, 4);

  if (!enabled) return null;
  if (pathname?.startsWith('/print/')) return null;

  return (
    <>
      <button type="button" className="assistant-fab" onClick={() => setOpen((o) => !o)} aria-label={open ? 'Close assistant' : 'Ask the assistant'} title="Ask the assistant (Ctrl+/)">
        {open ? '✕' : '✦'}
      </button>
      {open ? (
        <div className="assistant-panel" role="dialog" aria-label="Assistant">
          <div className="assistant-head">
            <div>
              <b>Assistant</b>
              <div className="tiny muted-cell">Answers from the system, within your permissions</div>
            </div>
            <div className="inline" style={{ gap: 6 }}>
              {turns.length ? <button type="button" className="btn sm ghost" onClick={() => { abortRef.current?.abort(); setTurns([]); }}>Clear</button> : null}
              <button type="button" className="btn sm ghost" onClick={() => setOpen(false)}>Close</button>
            </div>
          </div>
          <div className="assistant-list" ref={listRef}>
            {!turns.length ? (
              <div className="assistant-empty">
                <div className="tiny muted-cell" style={{ marginBottom: 8 }}>You can ask about: {scope.length ? scope.join('; ') : 'where screens are'}.</div>
                <div className="assistant-suggest">
                  {suggestions.map((s) => <button key={s} type="button" className="btn sm ghost" onClick={() => ask(s)}>{s}</button>)}
                </div>
              </div>
            ) : null}
            {turns.map((t, i) => (
              <div key={i} className={`assistant-turn ${t.role}`}>
                {t.role === 'assistant' && t.tools?.length ? (
                  <div className="tiny muted-cell assistant-tools">{[...new Set(t.tools)].map((n) => TOOL_LABELS[n] ?? n).join(' · ')}</div>
                ) : null}
                <div className="assistant-bubble">
                  {t.content ? <Markdownish text={t.content} /> : t.role === 'assistant' && busy && i === turns.length - 1
                    ? <span className="muted-cell">{activeTool ? `${TOOL_LABELS[activeTool] ?? activeTool}…` : 'Thinking…'}</span> : null}
                  {t.error ? <div className="tiny" style={{ color: 'var(--danger)', marginTop: 4 }}>{t.error}</div> : null}
                </div>
              </div>
            ))}
          </div>
          <form className="assistant-input" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
            <input type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask a question…" disabled={busy} autoFocus aria-label="Question" />
            {busy
              ? <button type="button" className="btn sm ghost" onClick={() => abortRef.current?.abort()}>Stop</button>
              : <button type="submit" className="btn sm" disabled={!input.trim()}>Ask</button>}
          </form>
        </div>
      ) : null}
    </>
  );
}

/** Just enough formatting for answers: paragraphs, bullet lists, **bold** and `code`. */
function Markdownish({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split('\n');
        const isList = lines.every((l) => /^\s*([-*•]|\d+\.)\s+/.test(l));
        if (isList) {
          return <ul key={i}>{lines.map((l, j) => <li key={j}><Inline text={l.replace(/^\s*([-*•]|\d+\.)\s+/, '')} /></li>)}</ul>;
        }
        return <p key={i}>{lines.map((l, j) => <span key={j}>{j ? <br /> : null}<Inline text={l} /></span>)}</p>;
      })}
    </>
  );
}

function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) => p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b>
        : p.startsWith('`') ? <code key={i}>{p.slice(1, -1)}</code> : <span key={i}>{p}</span>)}
    </>
  );
}
