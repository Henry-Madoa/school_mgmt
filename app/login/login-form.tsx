'use client';

import { useActionState, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { signIn, type SignInState } from '@/app/actions/auth';

const DEMO_USERS: [username: string, role: string][] = [
  ['admin', 'System Administrator'],
  ['manager', 'Branch Manager'],
  ['loans', 'Loans Officer'],
  ['teller', 'Teller'],
  ['finance', 'Finance Officer'],
  ['auditor', 'Auditor'],
];

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="btn block" type="submit" disabled={pending}>
      {pending ? 'Signing in…' : 'Sign in'}
    </button>
  );
}

export function LoginForm() {
  const [state, formAction] = useActionState<SignInState, FormData>(signIn, {});
  const userRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);

  const fill = (username: string) => {
    if (!userRef.current || !passRef.current) return;
    userRef.current.value = username;
    passRef.current.value = `${username}123`;
    passRef.current.focus();
  };

  return (
    <>
      <form action={formAction}>
        <div className="field">
          <label htmlFor="u">Username</label>
          <input id="u" ref={userRef} name="username" type="text" autoComplete="username" required />
        </div>
        <div className="field">
          <label htmlFor="p">Password</label>
          <input id="p" ref={passRef} name="password" type="password" autoComplete="current-password" required />
        </div>
        <SubmitButton />
        <div className="login-err">{state?.error}</div>
      </form>

      <div className="demo-users">
        <b>Demonstration accounts</b> — click to fill:
        <div>
          {DEMO_USERS.map(([username, role]) => (
            <button key={username} type="button" title={role} onClick={() => fill(username)}>
              {username}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
