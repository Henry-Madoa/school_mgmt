'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { verifyTwoFactor, type VerifyState } from '@/app/actions/auth';

function SubmitButton() {
  const { pending } = useFormStatus();
  return <button className="btn block" type="submit" disabled={pending}>{pending ? 'Checking…' : 'Continue'}</button>;
}

export function VerifyForm() {
  const [state, formAction] = useActionState<VerifyState, FormData>(verifyTwoFactor, {});
  return (
    <form action={formAction}>
      <div className="field">
        <label htmlFor="code">Authenticator code</label>
        <input id="code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" autoFocus required placeholder="123 456" />
      </div>
      <SubmitButton />
      <div className="login-err">{state?.error}</div>
      <p className="tiny" style={{ marginTop: 12 }}><Link href="/login">Start over</Link> · Lost your device? Use a recovery code, or ask an administrator to reset two-factor sign-in on your user card.</p>
    </form>
  );
}
