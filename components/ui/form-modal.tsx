'use client';

import { useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from './modal';
import { readForm } from './field';
import { useToast } from './toast';
import { useResultDialog } from './result-dialog';
import type { ActionResult, FormValues } from '@/lib/types';

export interface FormModalProps<T> {
  title: string;
  wide?: boolean;
  onClose: () => void;
  onSubmit: (values: FormValues) => Promise<ActionResult<T>>;
  submitLabel?: string;
  submitClass?: string;
  successTitle?: string | ((data: T) => string);
  successDetail?: string | ((data: T) => string);
  /**
   * Where to go once the action succeeds — a document's own card straight after "New", so the
   * person lands on what they just created rather than back on the list. A string, or a
   * function of the action's result (for the number/id it minted).
   */
  redirectTo?: string | ((data: T) => string);
  /** 'popup' for a workflow decision or document posting (deposit, withdrawal, reversal,
   *  journal, disbursement, repayment, approve/reject) — the appealing centered card via
   *  useResultDialog(). Defaults to 'toast', the small corner notification, for everything
   *  else (uploads, admin config saves, profile edits). */
  resultStyle?: 'toast' | 'popup';
  extraFooter?: ReactNode;
  /**
   * Render the form as the body of the card it belongs to rather than in a modal — how a document
   * is edited on its own card (see EditableCard). Everything else is the same: `onClose` puts the
   * card back to reading, `title` and `wide` are not shown.
   */
  inline?: boolean;
  children: ReactNode;
}

/**
 * Modal wrapping a form that submits to a Server Action.
 *
 * A failure keeps the modal open with the message in place, so the user does
 * not lose what they typed — the old modal closed and fired a toast, which
 * meant re-keying an entire loan application.
 */
export function FormModal<T>({
  title, wide, onClose, onSubmit, submitLabel = 'Save', submitClass = 'btn',
  successTitle, successDetail, redirectTo, resultStyle = 'toast', extraFooter, inline = false, children,
}: FormModalProps<T>) {
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const toast = useToast();
  const showResult = useResultDialog();
  const notify = resultStyle === 'popup' ? showResult : toast;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const form = formRef.current;
    if (!form || !form.reportValidity()) return;
    setBusy(true);
    setError('');
    try {
      const res = await onSubmit(readForm(form));
      if (!res?.ok) {
        setError(res?.error || 'Could not complete');
        return;
      }
      if (successTitle) {
        notify(typeof successTitle === 'function' ? successTitle(res.data) : successTitle, typeof successDetail === 'function' ? successDetail(res.data) : successDetail, 'ok');
      }
      onClose();
      const target = typeof redirectTo === 'function' ? redirectTo(res.data) : redirectTo;
      if (target) router.push(target);
      else router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const footer = (
    <>
      {error ? <div className="modal-error">{error}</div> : null}
      <button type="button" className={inline ? 'btn ghost sm' : 'btn ghost'} onClick={onClose} disabled={busy}>Cancel</button>
      {extraFooter}
      <button type="button" className={inline ? `${submitClass} sm` : submitClass} onClick={() => submit()} disabled={busy}>
        {busy ? 'Working…' : submitLabel}
      </button>
    </>
  );

  if (inline) {
    return (
      <>
        <form ref={formRef} onSubmit={submit}>{children}</form>
        <div className="inline" style={{ marginTop: 'var(--sp)' }}>{footer}</div>
      </>
    );
  }

  return (
    <Modal title={title} wide={wide} onClose={onClose} footer={footer}>
      <form ref={formRef} onSubmit={submit}>{children}</form>
    </Modal>
  );
}
