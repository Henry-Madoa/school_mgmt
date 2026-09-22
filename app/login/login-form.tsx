'use client';

import { useActionState, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { signIn, type SignInState } from '@/app/actions/auth';

// The demonstration logins lib/seed.ts creates (password = username + '123'). Hidden in production,
// where the seed disables every account but admin.
const DEMO_USERS: [username: string, role: string][] = [
  ['admin', 'System Administrator'],
  ['principal', 'Principal'],
  ['registrar', 'Academics Officer'],
  ['teacher', 'Teacher — Teacher Portal'],
  ['bursar', 'Bursar — fees and receipts'],
  ['accountant', 'Accountant'],
  ['hr', 'HR & Payroll Officer'],
  ['parent', 'Parent — Parent Portal'],
  ['student', 'Student — Student Portal'],
  ['auditor', 'Internal Auditor'],
];

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="btn block" type="submit" disabled={pending}>
      {pending ? 'Signing in…' : 'Sign in'}
    </button>
  );
}

export function LoginForm({ showDemo = true }: { showDemo?: boolean }) {
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

      {showDemo ? (
        <div className="demo-users">
          <b>Demonstration accounts</b> — click to fill (password is the username + 123):
          <div>
            {DEMO_USERS.map(([username, role]) => (
              <button key={username} type="button" title={role} onClick={() => fill(username)}>
                {username}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
