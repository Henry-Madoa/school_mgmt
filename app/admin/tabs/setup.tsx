/* Admin Centre tabs — setup. Rendered by app/admin/[[...tab]]/page.tsx; moved out of it so each area reads on its own. */
import { getOrg, getTheme, themePresets, TOKEN_GROUPS } from '@/lib/org';
import { listConfigPackages, listConfigPackageTables } from '@/lib/configPackages';
import { listPostableAccounts, listActiveBankAccounts } from '@/lib/gl';
import { imageSrc, isConfigured } from '@/lib/cloudinary';
import { Card, CardHead, EmptyState, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { SchoolSetupForm } from '../school-setup-form';
import { GeneralLedgerSetupForm } from '../gl-setup-form';
import { CompanyForm } from '../company-form';
import { AppearanceEditor } from '../appearance-editor';
import { ConfigPackageFormButton } from '../config-package-form';
import { ConfigPackageCard, DeleteConfigPackageButton } from '../config-package-io';

export async function SchoolSetupTab() {
  const [org, glAccounts, bankAccounts] = await Promise.all([getOrg(), listPostableAccounts(), listActiveBankAccounts()]);
  return <SchoolSetupForm org={org!} glAccounts={glAccounts} bankAccounts={bankAccounts.map((b) => ({ id: b.id, code: b.code, name: b.name }))} />;
}

export async function GeneralLedgerSetupTab() {
  const [org, accounts] = await Promise.all([getOrg(), listPostableAccounts()]);
  return <GeneralLedgerSetupForm org={org!} accounts={accounts.map((a) => ({ id: a.id, code: a.code, name: a.name }))} />;
}

export async function CompanyTab() {
  const org = (await getOrg())!;
  // The delivery URL is built server-side so the browser never needs the
  // Cloudinary cloud name, and legacy data-URL logos still resolve.
  return (
    <CompanyForm
      org={org}
      logoSrc={imageSrc(org.logo, { width: 128, height: 128, crop: 'fit' })}
      signatureSrc={imageSrc(org.ceo_signature, { width: 240, height: 90, crop: 'fit' })}
      mediaEnabled={isConfigured()}
    />
  );
}

export async function AppearanceTab() {
  return <AppearanceEditor theme={await getTheme()} presets={themePresets()} groups={TOKEN_GROUPS} />;
}

/**
 * Configuration Packages — modeled on Business Central's Configuration Packages/RapidStart:
 * an admin picks a table and a set of its columns, then exports that data to CSV and
 * re-imports a CSV to bulk insert/update rows, straight into the base table for data
 * migration, bypassing whatever approval workflow that entity normally goes through.
 */
export async function DataManagementTab() {
  const [packages, tables] = await Promise.all([listConfigPackages(), listConfigPackageTables()]);

  return (
    <>
      <Toolbar>
        <Spacer />
        <ConfigPackageFormButton tables={tables}>New package</ConfigPackageFormButton>
      </Toolbar>
      <Card>
        <CardHead
          title="Configuration packages"
          sub="Export a table's data to CSV, edit it, and re-import to bulk create or update records — for data migration, not day-to-day entry"
        />
        {packages.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th>Code</th><th>Name</th><th>Table</th><th className="num">Fields</th>
                <th>Key field</th><th className="num" />
              </tr>
            </thead>
            <tbody>
              {packages.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{p.code}</td>
                  <td><b>{p.name}</b></td>
                  <td className="mono tiny">{p.table_name}</td>
                  <td className="num">{p.fields.length}</td>
                  <td className="tiny">{p.key_field || '—'}</td>
                  <td className="num">
                    <div className="inline" style={{ gap: 4, justifyContent: 'flex-end' }}>
                      <ConfigPackageCard pkg={p} />
                      <ConfigPackageFormButton pkg={p} tables={tables} className="btn sm ghost">Edit</ConfigPackageFormButton>
                      <DeleteConfigPackageButton code={p.code} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="📦" title="No configuration packages yet" sub="Create one to bulk export or import a table's data" />}
      </Card>
    </>
  );
}
