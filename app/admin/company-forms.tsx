'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { useRunAction } from '@/components/ui/run-action';
import { copyCompanyRequest, deleteCompanyRequest, renameCompanyRequest } from '@/app/actions/companies';
import type { Company } from '@/lib/types';

export function CopyCompanyButton({ companies, defaultSource, className = 'btn', children }: {
  companies: Pick<Company, 'code' | 'display_name'>[]; defaultSource: string; className?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          title="New company"
          onClose={() => setOpen(false)}
          onSubmit={(values) => copyCompanyRequest(values)}
          submitLabel="Create company"
          successTitle="Company created"
          successDetail={(d) => `${d.code}: ${d.tables} tables, ${d.rows.toLocaleString()} rows in ${(d.ms / 1000).toFixed(1)} s. Switch to it on My Settings, or assign users to it on the User card.`}
          resultStyle="popup"
        >
          <p className="tiny muted-cell" style={{ marginTop: 0 }}>
            A new company is an independent set of business data. Users, roles and permissions are shared by all companies; the
            company you take the structure from is never modified.
          </p>
          <Field name="data_option" label="Data to include" type="select" required defaultValue="FULL" options={[
            { value: 'FULL', label: 'Copy company — everything (a test copy of the source)' },
            { value: 'SETUP', label: 'Setup data only — products, chart of accounts, series, posting groups, workflows (preparing for production)' },
            { value: 'EMPTY', label: 'No data — an empty company' },
          ]} hint="Setup data only starts every balance and number series afresh; no members, customers, vendors, employees, assets or postings come across" />
          <Field name="source" label="Take structure and data from" type="select" required options={companies.map((c) => ({ value: c.code, label: `${c.display_name} (${c.code})` }))} defaultValue={defaultSource} />
          <div className="grid g2">
            <Field name="code" label="New company code" required uppercase placeholder="e.g. TEST" maxLength={16} hint="Letters, digits and underscores" />
            <Field name="display_name" label="Display name" required placeholder="e.g. Test Company — September" />
          </div>
          <Field name="rename_organisation" label="Show the display name as the organisation name in the copy" type="checkbox" defaultValue={1}
            hint="Recommended — every screen and printout then says which company you are in (always done for setup-only and empty companies)" />
        </FormModal>
      ) : null}
    </>
  );
}

export function RenameCompanyButton({ company, className = 'btn sm ghost' }: { company: Company; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Rename</button>
      {open ? (
        <FormModal title={`Rename ${company.code}`} onClose={() => setOpen(false)} onSubmit={(values) => renameCompanyRequest(company.code, values)} submitLabel="Save" successTitle="Company renamed">
          <Field name="display_name" label="Display name" required defaultValue={company.display_name} />
        </FormModal>
      ) : null}
    </>
  );
}

export function DeleteCompanyButton({ company, blockedReason, className = 'btn sm ghost' }: { company: Company; blockedReason?: string | null; className?: string }) {
  const { run, busy } = useRunAction();
  if (blockedReason) return <button type="button" className={className} disabled title={blockedReason}>Delete</button>;
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => deleteCompanyRequest(company.code), {
        confirm: { title: `Delete company ${company.display_name}?`, message: `Every table of ${company.code} is dropped permanently. The live company is not affected.`, confirmLabel: 'Delete company', danger: true },
        successTitle: `${company.code} deleted`,
      })}>
      {busy ? 'Deleting…' : 'Delete'}
    </button>
  );
}
