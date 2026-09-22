'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/toast';
import { startTwoFactorEnrolment, confirmTwoFactorEnrolment, turnOffTwoFactor } from '@/app/actions/mySettings';

/**
 * My Settings → Two-factor authentication. Enrolment is three steps on one card: get a QR code,
 * type the code the app shows, keep the recovery codes. Switching it off needs a current code.
 */
export function TwoFactorForm({ enabled, required, recoveryLeft }: { enabled: boolean; required: boolean; recoveryLeft: number }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);

  const start = async () => {
    setBusy(true);
    try {
      const res = await startTwoFactorEnrolment();
      if (!res.ok) { toast('Could not start', res.error, 'err'); return; }
      setSetup(res.data);
    } finally { setBusy(false); }
  };
  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await confirmTwoFactorEnrolment(code);
      if (!res.ok) { toast('Not confirmed', res.error, 'err'); return; }
      setRecovery(res.data.recoveryCodes);
      setSetup(null); setCode('');
      toast('Two-factor sign-in is on', 'Keep the recovery codes somewhere safe', 'ok');
    } finally { setBusy(false); }
  };
  const turnOff = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await turnOffTwoFactor(code);
      if (!res.ok) { toast('Not switched off', res.error, 'err'); return; }
      setCode('');
      toast('Two-factor sign-in is off', undefined, 'ok');
      router.refresh();
    } finally { setBusy(false); }
  };

  if (recovery) {
    return (
      <div>
        <div className="note">These recovery codes are shown once. Each one signs you in a single time if you lose your phone. Print or save them now.</div>
        <div className="grid g2" style={{ margin: '10px 0', maxWidth: 420 }}>
          {recovery.map((c) => <code key={c} className="mono" style={{ fontSize: 15 }}>{c}</code>)}
        </div>
        <button type="button" className="btn" onClick={() => { setRecovery(null); router.push(required ? '/dashboard' : '/my-settings'); router.refresh(); }}>I have saved them</button>
      </div>
    );
  }

  if (enabled) {
    return (
      <form onSubmit={turnOff}>
        <div className="tiny muted-cell" style={{ marginBottom: 8 }}>Two-factor sign-in is <b>on</b> · {recoveryLeft} recovery code{recoveryLeft === 1 ? '' : 's'} left</div>
        {required ? <div className="note">Your permission set requires two-factor sign-in, so it cannot be switched off here — an administrator can reset it if you lose your device.</div> : (
          <div className="inline" style={{ gap: 8, alignItems: 'flex-end' }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="off_code">Current code from your app</label>
              <input id="off_code" type="text" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} required style={{ width: 140 }} />
            </div>
            <button type="submit" className="btn ghost" disabled={busy || !code}>{busy ? 'Working…' : 'Switch off'}</button>
          </div>
        )}
      </form>
    );
  }

  if (!setup) {
    return (
      <div>
        {required ? <div className="note">Your permission set requires two-factor sign-in. Enrol now to continue — you will need an authenticator app (Google Authenticator, Microsoft Authenticator, Authy…).</div>
          : <div className="tiny muted-cell" style={{ marginBottom: 8 }}>Add a six-digit code from an authenticator app to every sign-in.</div>}
        <button type="button" className="btn" disabled={busy} onClick={start}>{busy ? 'Preparing…' : 'Set up two-factor sign-in'}</button>
      </div>
    );
  }

  return (
    <form onSubmit={confirm}>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div>
          <img src={setup.qr} alt="Scan with your authenticator app" width={220} height={220} style={{ display: 'block', borderRadius: 6 }} />
          <div className="tiny muted-cell" style={{ marginTop: 6 }}>Cannot scan? Enter this key by hand:</div>
          <code className="mono" style={{ wordBreak: 'break-all' }}>{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
        </div>
        <div>
          <ol className="tiny" style={{ paddingLeft: 18, margin: '0 0 10px' }}>
            <li>Open your authenticator app and add an account by scanning the code.</li>
            <li>Type the six-digit code it shows below.</li>
          </ol>
          <div className="field">
            <label htmlFor="enrol_code">Code from the app</label>
            <input id="enrol_code" type="text" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required placeholder="123 456" style={{ width: 160 }} />
          </div>
          <div className="inline" style={{ gap: 8 }}>
            <button type="submit" className="btn" disabled={busy || code.replace(/\s/g, '').length < 6}>{busy ? 'Checking…' : 'Confirm and switch on'}</button>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => { setSetup(null); setCode(''); }}>Cancel</button>
          </div>
        </div>
      </div>
    </form>
  );
}
