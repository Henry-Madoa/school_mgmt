import { requireUser } from '@/lib/session';
import { getEffectivePostingRange, getWorkDate } from '@/lib/postingDates';
import { today } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { DefinitionList } from '@/components/ui/primitives';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { WorkDateForm } from './work-date-form';
import { ProfileSwitcher } from './profile-switcher';
import { CompanySwitcherForm } from './company-switcher';
import { listCompanies } from '@/lib/companies';
import { getActiveCompany } from '@/lib/companyContext';
import { PasswordForm } from './password-form';
import { formatDateTime } from '@/lib/format';
import { TwoFactorForm } from './two-factor-form';
import { twoFactorRequiredFor, remainingRecoveryCodes } from '@/lib/totp';

/** BC's own "My Settings" — currently just the Work Date, the date a user's own new documents
 *  suggest by default instead of the real system date. Any signed-in user manages their own; no
 *  particular permission is required beyond being logged in. */
export default async function MySettingsPage({ searchParams }: { searchParams: Promise<{ password?: string; totp?: string }> }) {
  const user = await requireUser();
  const { password: passwordParam, totp: totpParam } = await searchParams;
  const passwordRequired = passwordParam === 'required' || user.must_change_password;
  const [workDate, range, companies, company, totpRequired, recoveryLeft] = await Promise.all([
    getWorkDate(user.id),
    getEffectivePostingRange(user.id),
    listCompanies(),
    getActiveCompany(),
    twoFactorRequiredFor(user.id),
    remainingRecoveryCodes(user.id),
  ]);
  const totpForced = (totpParam === 'required' || totpRequired) && !user.totp_enabled;
  const systemDate = today();

  const windowLabel = range.from || range.to
    ? `${range.from ?? 'Any date'}${range.fromTime ? ` ${range.fromTime}` : ''} – ${range.to ?? 'Any date'}${range.toTime ? ` ${range.toTime}` : ''}`
    : 'Unrestricted';

  return (
    <Page title="My Settings" crumb="Personal preferences" user={user}>
      {/* Every panel collapses on its header; the one that needs attention right now opens, the rest start closed. */}
      <CollapsibleCard title="Password" sub={passwordRequired ? 'A new password is required before you can continue' : 'Change the password you sign in with'} defaultCollapsed={!passwordRequired}>
        <DefinitionList items={[
          ['Last changed', user.password_changed_at ? formatDateTime(user.password_changed_at) : 'Never'],
          ['Last sign-in', formatDateTime(user.last_login_at)],
        ]} />
        <PasswordForm username={user.username} required={passwordRequired} />
      </CollapsibleCard>
      <CollapsibleCard title="Two-factor authentication" sub={totpForced ? 'Required by your permission set — enrol before you continue' : user.totp_enabled ? 'A code from your authenticator app is asked for at every sign-in' : 'Protect your sign-in with an authenticator app'}
        defaultCollapsed={!totpForced && !passwordRequired ? false : passwordRequired}>
        <TwoFactorForm enabled={user.totp_enabled} required={totpRequired} recoveryLeft={recoveryLeft} />
      </CollapsibleCard>
      <CollapsibleCard
        title="Role Centre"
        sub="Your home dashboard and which navigation groups your sidebar shows. It never changes your permissions — what you can view, create, edit, approve or delete is fixed by your roles."
        defaultCollapsed={passwordRequired}
      >
        <DefinitionList items={[
          ['Current Role Centre', `${user.activeProfile.icon ? `${user.activeProfile.icon} ` : ''}${user.activeProfile.name}`],
          ['Assigned to you', user.profiles.map((p) => p.name).join(', ') || '—'],
        ]} />
        <ProfileSwitcher profiles={user.profiles} activeId={user.activeProfile.id} />
      </CollapsibleCard>
      {companies.length > 1 ? (
        <div id="company">
          <CollapsibleCard title="Company" sub="Which company this browser works in. A test copy holds its own data; the live company is never affected by what you do in a copy." defaultCollapsed={passwordRequired}>
            <DefinitionList items={[
              ['Current company', <>{company.display_name} <span className="mono">({company.code})</span>{company.is_default ? ' — live' : ' — test copy'}</>],
              company.assigned ? ['Assigned by', 'An administrator has assigned you to this company; only they can change it (User card → Company).'] : null,
            ]} />
            {!company.assigned ? <CompanySwitcherForm companies={companies.map((c) => ({ code: c.code, display_name: c.display_name, is_default: c.is_default }))} activeCode={company.code} /> : null}
          </CollapsibleCard>
        </div>
      ) : null}
      <CollapsibleCard title="Work Date" sub="The date your own new documents suggest by default, in place of today's real date" defaultCollapsed={passwordRequired}>
        <DefinitionList items={[
          ['System date', systemDate],
          ['Your allowed posting window', windowLabel],
        ]} />
        <WorkDateForm workDate={workDate} systemDate={systemDate} />
        <div className="hint" style={{ marginTop: 8 }}>
          Must fall within your allowed posting window above — set by an administrator, either
          for you specifically (Admin Centre → Workflow Management → User Setup) or company-wide
          (Admin Centre → Company Information → Posting Dates).
        </div>
      </CollapsibleCard>
    </Page>
  );
}
