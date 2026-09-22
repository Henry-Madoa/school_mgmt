import { Fragment, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { statusTone, humanise, type Tone } from '@/lib/format';
import { TabsBar } from './tabs-bar';

/* These render identically on the server and the client and hold no state, so
 * they carry no 'use client' directive and stay out of the browser bundle when
 * a Server Component uses them. */

export function Card({ children, className = '', style, id }: {
  children: ReactNode; className?: string; style?: CSSProperties;
  /** Anchor target, so a stat tile or a toolbar button can jump straight to this card. */
  id?: string;
}) {
  return <div id={id} className={`card ${className}`} style={style}>{children}</div>;
}

export function CardHead({ title, sub, children }: {
  title: ReactNode; sub?: ReactNode; children?: ReactNode;
}) {
  return (
    <div className="card-head">
      <div>
        <h3>{title}</h3>
        {sub ? <div className="card-sub">{sub}</div> : null}
      </div>
      {children ? <><div className="spacer" />{children}</> : null}
    </div>
  );
}

export function Stat({ label, value, foot, accent = true, small }: {
  label: ReactNode; value: ReactNode; foot?: ReactNode; accent?: boolean; small?: boolean;
}) {
  return (
    <div className={`stat ${accent ? 'accent' : ''}`}>
      <div className="label">{label}</div>
      <div className={`value ${small ? 'sm' : ''}`}>{value}</div>
      {foot ? <div className="foot">{foot}</div> : null}
    </div>
  );
}

/** Status chip. Tone is derived from the status word unless overridden. */
export function Pill({ status, tone, children }: {
  status?: string | null; tone?: Tone; children?: ReactNode;
}) {
  return <span className={`pill ${tone ?? statusTone(status)}`}>{children ?? humanise(status)}</span>;
}

export function EmptyState({ icon = '·', title, sub }: {
  icon?: ReactNode; title?: ReactNode; sub?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="big">{icon}</div>
      {title ? <div className="title">{title}</div> : null}
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

/** Horizontally scrollable table shell — wide ledgers must not stretch the page. */
// Every list table is sortable by its column headers — see components/ui/table-wrap.tsx.
export { TableWrap } from './table-wrap';

export interface TabDefinition {
  key: string;
  label: string;
  /** Gives this tab its own accent colour, sourced from the org's active Theme & Appearance
   *  tokens (Admin Centre → Appearance & Theme) rather than a hardcoded colour — e.g. a
   *  document's Open/Pending/Approved/Processed lifecycle stages. Omit for a plain tab. */
  tone?: Tone;
}

export function Tabs({ tabs, active, hrefFor }: {
  tabs: TabDefinition[]; active: string; hrefFor: (key: string) => string;
}) {
  // The first tab's href identifies this bar so its scroll position survives the navigation
  // that replaces it (see TabsBar).
  return (
    <TabsBar id={tabs.length ? hrefFor(tabs[0].key) : undefined} active={active}>
      {tabs.map((t) => (
        <Link
          key={t.key} href={hrefFor(t.key)} data-tone={t.tone || undefined}
          className={t.key === active ? 'active' : ''}
        >
          {t.label}
        </Link>
      ))}
    </TabsBar>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="toolbar">{children}</div>;
}

export const Spacer = () => <div className="spacer" />;

/**
 * Term/value rows. Falsy entries are dropped so a caller can inline a
 * conditional row.
 *
 * The pairs are keyed Fragments rather than wrapper elements — `.dl` is a
 * two-column grid and any real wrapper would become the grid item instead.
 */
export type DefinitionItem = [term: ReactNode, value: ReactNode] | null | false | undefined;

export function DefinitionList({ items }: { items: DefinitionItem[] }) {
  return (
    <dl className="dl">
      {items.filter((i): i is [ReactNode, ReactNode] => Boolean(i)).map(([term, value], i) => (
        <Fragment key={i}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
