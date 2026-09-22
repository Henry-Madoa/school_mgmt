'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/toast';
import { PASSWORD_RULES } from '@/lib/password';
import { changePassword } from '@/app/actions/mySettings';

/** My Settings → Password. The live checklist mirrors the server policy in lib/password.ts, so
 *  what the form accepts is exactly what the action will. */
export function PasswordForm({ username, required }: { username: string; required: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const results = PASSWORD_RULES.map((r) => ({ id: r.id, label: r.label, ok: r.test(next, { username }) }));
  const ready = current && next && confirm === next && results.every((r) => r.ok);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    try {
      const res = await changePassword(current, next, confirm);
      if (!res.ok) { toast('Could not change password', res.error, 'err'); return; }
      toast('Password changed', 'Any other signed-in sessions of yours have been signed out', 'ok');
      setCurrent(''); setNext(''); setConfirm('');
      router.push(required ? '/dashboard' : '/my-settings');
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} style={{ marginTop: 'calc(var(--sp)*1.5)' }}>
      {required ? (
        <div className="note" style={{ color: 'var(--danger)', marginBottom: 10 }}>
          Your password must be changed before you continue — an administrator reset it, or this is the first sign-in.
        </div>
      ) : null}
      <div className="grid g2">
        <div className="field">
          <label htmlFor="f_currentPassword">Current password</label>
          <input id="f_currentPassword" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required disabled={busy} />
        </div>
        <div />
        <div className="field">
          <label htmlFor="f_newPassword">New password</label>
          <input id="f_newPassword" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required disabled={busy} />
        </div>
        <div className="field">
          <label htmlFor="f_confirmPassword">Confirm new password</label>
          <input id="f_confirmPassword" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required disabled={busy} />
          {confirm && confirm !== next ? <div className="hint" style={{ color: 'var(--danger)' }}>Does not match</div> : null}
        </div>
      </div>
      <ul className="tiny" style={{ listStyle: 'none', padding: 0, margin: '6px 0 10px', display: 'grid', gap: 2 }}>
        {results.map((r) => (
          <li key={r.id} style={{ color: r.ok ? 'var(--ok, inherit)' : 'var(--text-muted)' }}>{r.ok ? '✓' : '·'} {r.label}</li>
        ))}
      </ul>
      <button type="submit" className="btn" disabled={busy || !ready}>{busy ? 'Saving…' : 'Change password'}</button>
    </form>
  );
}
