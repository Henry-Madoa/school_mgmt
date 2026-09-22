'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { Card, CardHead } from './primitives';
import { CollapsibleCard } from './collapsible-card';

const EditableCardContext = createContext<{ close: () => void } | null>(null);

/**
 * The edit form's way back to reading — for the `form` an EditableCard hosts, which hands it to
 * an inline FormModal as `onClose`.
 */
export function useEditableCard(): { close: () => void } {
  const ctx = useContext(EditableCardContext);
  if (!ctx) throw new Error('useEditableCard() must be used inside an EditableCard form');
  return ctx;
}

/**
 * A document's card, edited in place — records and documents get a card page and are edited on
 * it, with modals kept for creating. Reading shows `children`; Edit on the card's own header
 * swaps in `form` (an inline FormModal that saves through the document's server action and
 * closes through useEditableCard), and Save or Cancel put the card back.
 *
 * The server page renders both sides: the definition lists as children, and the client form
 * element as `form` — it only mounts while editing, so its state starts fresh each time.
 */
export function EditableCard({ title, sub, canEdit, form, badge, collapsible = false, defaultCollapsed = false, children }: {
  title: ReactNode;
  sub?: ReactNode;
  /** Whether Edit is offered at all — the page's own rule (Open, the creator, the right). */
  canEdit: boolean;
  /** The inline edit form, mounted only while editing. */
  form: ReactNode;
  /** A status pill or similar, kept on the header in both modes. */
  badge?: ReactNode;
  /** Render as a CollapsibleCard (the document pages that fold their sections). */
  collapsible?: boolean;
  /** With `collapsible`: start folded. */
  defaultCollapsed?: boolean;
  children: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const actions = (
    <>
      {badge}
      {canEdit && !editing
        ? <button type="button" className="btn sm ghost" onClick={() => setEditing(true)}>Edit</button>
        : null}
    </>
  );
  const body = editing
    ? <EditableCardContext.Provider value={{ close: () => setEditing(false) }}>{form}</EditableCardContext.Provider>
    : children;

  if (collapsible) {
    return <CollapsibleCard title={title} sub={sub} actions={actions} defaultCollapsed={defaultCollapsed && !editing}>{body}</CollapsibleCard>;
  }
  return (
    <Card>
      <CardHead title={title} sub={sub}>{actions}</CardHead>
      {body}
    </Card>
  );
}
