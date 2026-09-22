import { redirect } from 'next/navigation';
import { getOrgBrand } from '@/lib/org';
import { getCurrentUser } from '@/lib/session';
import { LoginForm } from './login-form';
import { ThemeToggle } from '@/components/layout/theme-toggle';

export default async function LoginPage() {
  if (await getCurrentUser()) redirect('/dashboard');
  const org = await getOrgBrand();

  return (
    <div className="login-wrap">
      <div className="login-mode-toggle"><ThemeToggle /></div>
      <div className="login-brand">
        {org?.logo ? <img className="login-logo" src={org.logo} alt="" /> : null}
        <h1>{org?.name || 'School Management System'}</h1>
        {org?.motto ? <div className="motto">{org.motto}</div> : null}
        <div className="meta">
          {org?.licence_no ? <>Reg. No. {org.licence_no}<br /></> : null}
          {org?.phone_primary ? <>{org.phone_primary}<br /></> : null}
          {org?.email}
        </div>
      </div>
      <div className="login-form">
        <div className="login-card">
          <h2>Sign in</h2>
          <p className="sub">School Management System</p>
          <LoginForm showDemo={process.env.NODE_ENV !== 'production' || process.env.SEED_DEMO_DATA === 'true'} />
        </div>
      </div>
    </div>
  );
}
