'use client';

import { useFormStatus } from 'react-dom';
import { signOut } from '@/app/actions/auth';

function Button() {
  const { pending } = useFormStatus();
  return (
    <button className="btn ghost sm" type="submit" disabled={pending}>
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}

export function SignOutButton() {
  return <form action={signOut}><Button /></form>;
}
