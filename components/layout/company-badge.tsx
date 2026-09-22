import Link from 'next/link';
import { listCompanies } from '@/lib/companies';
import { getActiveCompany } from '@/lib/companyContext';

/**
 * The top bar's company badge — shown once there is more than one company (or whenever the
 * browser is in a copy), so a tester always sees which company they are working in. A user
 * pinned to a company by an administrator sees a plain badge; anyone else can change company
 * on My Settings, so the badge links there.
 */
export async function CompanyBadge() {
  const [companies, active] = await Promise.all([listCompanies().catch(() => []), getActiveCompany().catch(() => null)]);
  if (!active || (companies.length < 2 && active.is_default)) return null;
  const inner = (
    <>
      <span aria-hidden="true">🏢</span>
      <span className="company-badge-name">{active.display_name}</span>
      {!active.is_default ? <span className="company-badge-tag">TEST</span> : null}
    </>
  );
  const cls = `company-badge ${active.is_default ? '' : 'test'}`;
  if (active.assigned) {
    return <span className={cls} title={`You are assigned to ${active.display_name}`}>{inner}</span>;
  }
  return <Link href="/my-settings#company" className={cls} title="Change company on My Settings">{inner}</Link>;
}
