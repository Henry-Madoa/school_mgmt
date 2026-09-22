'use client';

import { useState, type ReactNode } from 'react';
import { Card } from './primitives';

export interface CollapsibleCardProps {
  title: ReactNode;
  sub?: ReactNode;
  /** Collapsed on first render — the default is expanded. */
  defaultCollapsed?: boolean;
  className?: string;
  /** An optional header-right control (e.g. an Edit button) — rendered next to the toggle
   *  button rather than nested inside it (a button can't nest another button), with its own
   *  click stopped from bubbling up to the toggle. */
  actions?: ReactNode;
  children: ReactNode;
}

/** A Card whose header toggles the body open/closed on click — no separate chevron control.
 *
 * The open/close animation sizes `.collapsible-body` via `grid-template-rows: 1fr` (see
 * globals.css), which needs `overflow: hidden` on the inner wrapper to actually clip content
 * while the row is mid-shrink or fully collapsed. Left on permanently, though, that same
 * `overflow: hidden` becomes a trap: `1fr` sizing a track around a `<table>` isn't always exact
 * (sub-pixel rounding, a wide table's own intrinsic-size quirks), and card content can also grow
 * after the initial paint from further client-side state updates — either way, a track sized a
 * few pixels short of the true content height would then permanently clip the excess with no
 * visible sign anything was cut off. `settled` lifts that constraint (`overflow: visible`) once a
 * card is fully open and has stopped animating, so nothing this component ever shows can be
 * silently hidden — it only re-arms right when a collapse starts, exactly when clipping is
 * actually wanted. Every real card here defaults to expanded and is rarely toggled at all, so
 * `settled` starts `true` for the overwhelming majority of cards from the very first paint.
 */
export function CollapsibleCard({ title, sub, defaultCollapsed = false, className, actions, children }: CollapsibleCardProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [settled, setSettled] = useState(!defaultCollapsed);

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      if (next) setSettled(false);
      return next;
    });
  };

  return (
    <Card className={className}>
      <div className="card-head">
        <button type="button" className="card-head-toggle" style={{ flex: 1 }} aria-expanded={!collapsed}
          onClick={toggle}>
          <div>
            <h3>{title}</h3>
            {sub ? <div className="card-sub">{sub}</div> : null}
          </div>
        </button>
        {actions ? <div onClick={(e) => e.stopPropagation()}>{actions}</div> : null}
      </div>
      <div className={`collapsible-body ${collapsed ? 'collapsed' : ''}`}
        onTransitionEnd={(e) => { if (e.target === e.currentTarget && !collapsed) setSettled(true); }}>
        <div className={`collapsible-body-inner${settled ? ' settled' : ''}`}>{children}</div>
      </div>
    </Card>
  );
}
