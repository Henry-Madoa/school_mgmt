'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { saveUser, unlockUserRequest, resetTwoFactorRequest } from '@/app/actions/admin';
import { useRunAction } from '@/components/ui/run-action';
import { USER_STATUSES } from '@/lib/constants';
import { PASSWORD_RULES } from '@/lib/password';
import type { Profile, RoleWithUsage, UserListRow } from '@/lib/types';

export function UserFormButton({ user, roles, profiles, companies = [], className = 'btn', children }: {
  user?: UserListRow | null;
  roles: RoleWithUsage[];
  profiles: Profile[];
  /** The companies an administrator may pin this user to. */
  companies?: { code: string; display_name: string; is_default: boolean }[];
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const u = user ?? null;
  const [username, setUsername] = useState(u?.username ?? '');
  const [password, setPassword] = useState('');
  const [roleId, setRoleId] = useState(String(u?.role_id ?? ''));
  const [selectedProfiles, setSelectedProfiles] = useState<Set<number>>(
    () => new Set(profiles.filter((p) => (u?.profile_codes ?? []).includes(p.code)).map((p) => p.id)),
  );
  const [selectedSets, setSelectedSets] = useState<Set<number>>(
    () => new Set(roles.filter((r) => (u?.extra_permission_set_names ?? []).includes(r.name)).map((r) => r.id)),
  );
  // A System role grants everything implicitly and can't be a meaningful "extra" set.
  const assignableSets = roles.filter((r) => !r.is_system);

  const toggle = (set: React.Dispatch<React.SetStateAction<Set<number>>>, id: number) => {
    set((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const primaryId = Number(roleId) || 0;

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          wide
          title={u ? `Edit ${u.full_name}` : 'Add a system user'}
          onClose={() => setOpen(false)}
          onSubmit={(values) => saveUser(u ? u.id : null, {
            ...values,
            profileIds: [...selectedProfiles].join(','),
            permissionSetIds: [...selectedSets].filter((id) => id !== primaryId).join(','),
          })}
          submitLabel={u ? 'Save' : 'Create user'}
          successTitle={u ? 'User updated' : 'User created'}
        >
          <div className="grid g2">
            <Field name="full_name" label="Full name" defaultValue={u?.full_name} required />
            <Field name="username" label="Username" defaultValue={u?.username} required disabled={!!u}
              onChange={(e) => setUsername(e.target.value)} />
            <Field name="email" label="Email" type="email" defaultValue={u?.email} />
            <Field name="phone" label="Phone" defaultValue={u?.phone} type="phone" />
            {companies.length > 1 ? (
              <Field name="company_code" label="Company" type="select" defaultValue={u?.company_code ?? ''}
                options={[{ value: '', label: 'Not assigned — the user chooses on My Settings' }, ...companies.map((c) => ({ value: c.code, label: `${c.display_name} (${c.code})${c.is_default ? '' : ' — test copy'}` }))]}
                hint="An assigned user always works in that company and cannot switch" />
            ) : null}
            <SearchableSelect name="role_id" label="Primary role (permission set)" required
              items={roles} getValue={(r) => String(r.id)} getLabel={(r) => r.name}
              value={roleId} onChange={setRoleId} placeholder="Search role…" emptyText="No matching roles" />
            <Field name="password" type="password" required={!u}
              label={u ? 'Reset password (leave blank to keep)' : 'Password'}
              onChange={(e) => setPassword(e.target.value)} />
            {u ? (
              <Field name="status" label="Status" type="select"
                defaultValue={u.status} options={USER_STATUSES} />
            ) : null}
          </div>

          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Additional roles (extra permission sets — the user gets the union of all)</label>
            <div className="chip-row" style={{ marginTop: 4 }}>
              {assignableSets.filter((r) => r.id !== primaryId).map((r) => {
                const on = selectedSets.has(r.id);
                return (
                  <button type="button" key={r.id}
                    className={`pill chip ${on ? 'info' : ''}`} aria-pressed={on}
                    onClick={() => toggle(setSelectedSets, r.id)} style={{ cursor: 'pointer' }}>
                    {on ? '✓ ' : ''}{r.name}
                  </button>
                );
              })}
            </div>
            <div className="hint">
              Effective rights = the primary role plus every additional role, unioned. Use the
              per-user <b>Permissions</b> editor on the Users list to restrict or fine-tune beyond that.
            </div>
          </div>

          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Role Centres (landing dashboards this user can switch between in My Settings)</label>
            <div className="chip-row" style={{ marginTop: 4 }}>
              {profiles.map((p) => {
                const on = selectedProfiles.has(p.id);
                return (
                  <button type="button" key={p.id}
                    className={`pill chip ${on ? 'info' : ''}`} aria-pressed={on}
                    onClick={() => toggle(setSelectedProfiles, p.id)} style={{ cursor: 'pointer' }}>
                    <span aria-hidden="true">{on ? '✓ ' : ''}{p.icon || ''}</span> {p.name}
                  </button>
                );
              })}
            </div>
            <div className="hint">A Role Centre chooses the home dashboard and which sidebar groups show — it grants no permissions.</div>
          </div>

          {!u || password ? (
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>Password requirements</label>
              <ul className="pw-checklist">
                {PASSWORD_RULES.map((rule) => {
                  const pass = rule.test(password, { username });
                  return (
                    <li key={rule.id}>
                      <span className={pass ? 'factor-ok' : 'factor-no'}>{pass ? '✔' : '✖'}</span> {rule.label}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </FormModal>
      ) : null}
    </>
  );
}

/** Clears two-factor enrolment for a user who lost their device — shown only while it is on. */
export function ResetTwoFactorButton({ user, className = 'btn sm ghost' }: { user: UserListRow; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => resetTwoFactorRequest(user.id), {
        confirm: { title: `Reset two-factor sign-in for ${user.username}?`, message: 'Their authenticator enrolment and recovery codes are removed. They sign in with the password alone until they enrol again.', confirmLabel: 'Reset', danger: true },
        successTitle: 'Two-factor sign-in reset',
      })}>
      {busy ? 'Working…' : 'Reset 2FA'}
    </button>
  );
}

/** Clears a sign-in lockout (lib/auth.ts) — shown only while the account is locked. */
export function UnlockUserButton({ user, className = 'btn sm ghost' }: { user: UserListRow; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => unlockUserRequest(user.id), {
        confirm: { title: `Unlock ${user.username}?`, message: 'The failed sign-in count is cleared and they can sign in again immediately.', confirmLabel: 'Unlock' },
        successTitle: 'Account unlocked',
      })}>
      {busy ? 'Working…' : 'Unlock'}
    </button>
  );
}
