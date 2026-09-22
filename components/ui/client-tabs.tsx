'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { TabsBar } from './tabs-bar';

export interface ClientTabDefinition {
  key: string;
  label: string;
}

/** Returns false to keep Next from advancing (e.g. a failed save) — anything else lets it through. */
type BeforeNext = () => Promise<boolean>;

interface TabFlow {
  setBeforeNext: (fn: BeforeNext | null) => void;
  goNext: () => Promise<void>;
  /** Reads (and clears) whether the panel now mounting should open already in edit mode. */
  consumeContinueEditing: () => boolean;
}

const TabFlowContext = createContext<TabFlow | null>(null);

/**
 * Lets whichever panel is currently showing intercept the tab bar's "Next" button —
 * an inline-editable card registers this while it's mid-edit so Next saves first and
 * only advances once that save succeeds. Pass null while there's nothing to save.
 */
export function useBeforeNext(fn: BeforeNext | null): void {
  const flow = useContext(TabFlowContext);
  useEffect(() => {
    flow?.setBeforeNext(fn);
    return () => flow?.setBeforeNext(null);
  }, [flow, fn]);
}

/**
 * The same save-then-advance action the footer's "Next" button runs — an inline-editable
 * card's own Save button calls this too, so saving also moves on to the next tab instead
 * of just sitting on the current one.
 */
export function useGoNext(): () => Promise<void> {
  const flow = useContext(TabFlowContext);
  return flow?.goNext ?? (async () => {});
}

/**
 * True exactly once, for the panel that just mounted as the result of a Save-triggered
 * advance off another editing panel — so an inline-editable card can open straight into
 * edit mode and keep a multi-tab edit session going without an extra click each time.
 * Clicking a tab directly or Back never sets this.
 */
export function useContinueEditing(): boolean {
  const flow = useContext(TabFlowContext);
  const [continueEditing] = useState(() => flow?.consumeContinueEditing() ?? false);
  return continueEditing;
}

/**
 * In-page tab switcher for Server Component content, with a Next/Back footer that
 * steps through `tabs` in order — Next defers to whatever the active panel registered
 * via useBeforeNext() before it's allowed to advance.
 */
export function ClientTabs({ tabs, initial, panels }: {
  tabs: ClientTabDefinition[];
  initial: string;
  panels: Record<string, ReactNode>;
}) {
  const [active, setActive] = useState(initial);
  const [advancing, setAdvancing] = useState(false);
  const beforeNextRef = useRef<BeforeNext | null>(null);
  const continueEditingRef = useRef(false);
  const index = tabs.findIndex((t) => t.key === active);

  const goNext = async () => {
    // Runs whatever the active panel needs to save even with no tab left to advance
    // to — a card's own Save button relies on that, not just the footer's Next.
    const beforeNext = beforeNextRef.current;
    if (beforeNext) {
      setAdvancing(true);
      let ok = false;
      try {
        ok = await beforeNext();
      } finally {
        setAdvancing(false);
      }
      if (!ok) return;
    }
    if (index >= 0 && index < tabs.length - 1) {
      // A registered beforeNext means the tab we're leaving was mid-edit — carry that
      // into the next tab so a Save chain doesn't need an Edit click at every stop.
      continueEditingRef.current = !!beforeNext;
      setActive(tabs[index + 1].key);
    }
  };

  const goTo = (key: string) => {
    continueEditingRef.current = false;
    setActive(key);
  };

  const back = () => {
    if (index > 0) goTo(tabs[index - 1].key);
  };

  const flow: TabFlow = {
    setBeforeNext: (fn) => { beforeNextRef.current = fn; },
    goNext,
    consumeContinueEditing: () => {
      const v = continueEditingRef.current;
      continueEditingRef.current = false;
      return v;
    },
  };

  return (
    <>
      <TabsBar active={active}>
        {tabs.map((t) => (
          <button key={t.key} type="button" className={t.key === active ? 'active' : ''}
            onClick={() => goTo(t.key)}>
            {t.label}
          </button>
        ))}
      </TabsBar>
      <TabFlowContext.Provider value={flow}>
        {panels[active]}
      </TabFlowContext.Provider>
      <div className="inline" style={{ marginTop: 'calc(var(--sp) * 2)', justifyContent: 'flex-end' }}>
        <button type="button" className="btn ghost sm" aria-label="Previous tab" onClick={back} disabled={index <= 0}>
          ← Back
        </button>
        <button type="button" className="btn sm" aria-label="Next tab" onClick={goNext}
          disabled={index < 0 || index >= tabs.length - 1 || advancing}>
          {advancing ? 'Saving…' : 'Next →'}
        </button>
      </div>
    </>
  );
}
