import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import { getOrgBrand } from '@/lib/org';
import { getCurrentUser } from '@/lib/session';
import { TWO_FACTOR_TICKET_COOKIE } from '@/lib/auth';
import { readPendingTicket } from '@/lib/totp';
import { clientIp } from '@/lib/rateLimit';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { VerifyForm } from './verify-form';

/** The second sign-in screen: the authenticator code, reached only with a pending ticket from the password step. */
export default async function VerifyPage() {
  if (await getCurrentUser()) redirect('/dashboard');
  const store = await cookies();
  const userId = readPendingTicket(store.get(TWO_FACTOR_TICKET_COOKIE)?.value, clientIp(await headers()));
  if (!userId) redirect('/login');
  const org = await getOrgBrand();
  return (
    <div className="login-wrap">
      <div className="login-mode-toggle"><ThemeToggle /></div>
      <div className="login-brand">
        {org?.logo ? <img className="login-logo" src={org.logo} alt="" /> : null}
        <h1>{org?.name || 'School Management System'}</h1>
      </div>
      <div className="login-form">
        <div className="login-card">
          <h2>Enter your code</h2>
          <p className="sub">Open your authenticator app and type the six-digit code for this account, or use one of your recovery codes.</p>
          <VerifyForm />
        </div>
      </div>
    </div>
  );
}
