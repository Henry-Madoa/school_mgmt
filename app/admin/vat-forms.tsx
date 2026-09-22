'use client';

import { useState, type ReactNode } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { GlAccountField } from '@/components/ui/gl-account-select';
import {
  saveVatBusinessGroupRequest, saveVatProductGroupRequest, saveVatPostingSetupRequest, deleteVatPostingSetupRequest,
} from '@/app/actions/cashMgmt';
import type {
  GlAccount, VatBusinessPostingGroup, VatPostingSetupView, VatProductPostingGroup,
} from '@/lib/types';

export function VatBusinessGroupButton({ row, className = 'btn', children }: { row?: VatBusinessPostingGroup | null; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const r = row ?? null;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal title={r ? `Edit ${r.code}` : 'New VAT business group'} onClose={() => setOpen(false)}
          onSubmit={(v) => saveVatBusinessGroupRequest(r?.id ?? null, v)} submitLabel={r ? 'Save' : 'Create'} successTitle="Saved">
          <Field name="code" label="Code" required defaultValue={r?.code} disabled={!!r} />
          <Field name="description" label="Description" defaultValue={r?.description ?? ''} />
        </FormModal>
      ) : null}
    </>
  );
}

export function VatProductGroupButton({ row, className = 'btn', children }: { row?: VatProductPostingGroup | null; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const r = row ?? null;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal title={r ? `Edit ${r.code}` : 'New VAT product group'} onClose={() => setOpen(false)}
          onSubmit={(v) => saveVatProductGroupRequest(r?.id ?? null, v)} submitLabel={r ? 'Save' : 'Create'} successTitle="Saved">
          <Field name="code" label="Code" required defaultValue={r?.code} disabled={!!r} />
          <Field name="description" label="Description" defaultValue={r?.description ?? ''} />
          <Field name="taxType" label="Type" type="select" defaultValue={r?.tax_type ?? 'VAT'} options={[{ value: 'VAT', label: 'VAT' }, { value: 'WHT', label: 'Withholding Tax' }]} />
        </FormModal>
      ) : null}
    </>
  );
}

export function VatPostingSetupRowButton({ row, busGroups, prodGroups, accounts, className = 'btn', children }: {
  row?: VatPostingSetupView | null; busGroups: VatBusinessPostingGroup[]; prodGroups: VatProductPostingGroup[];
  accounts: GlAccount[]; className?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const r = row ?? null;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal title={r ? `Edit ${r.vat_bus_posting_group_code} × ${r.vat_prod_posting_group_code}` : 'New VAT posting setup'} wide
          onClose={() => setOpen(false)} onSubmit={(v) => saveVatPostingSetupRequest(v)} submitLabel="Save" successTitle="VAT posting setup saved">
          <div className="grid g2">
            <Field name="vatBusPostingGroupCode" label="VAT business group" type="select" required defaultValue={r?.vat_bus_posting_group_code ?? ''}
              options={[{ value: '', label: '…' }, ...busGroups.map((g) => ({ value: g.code, label: g.code }))]} />
            <Field name="vatProdPostingGroupCode" label="VAT product group" type="select" required defaultValue={r?.vat_prod_posting_group_code ?? ''}
              options={[{ value: '', label: '…' }, ...prodGroups.map((g) => ({ value: g.code, label: `${g.code} (${g.tax_type})` }))]} />
          </div>
          <div className="grid g3">
            <Field name="vatPct" label="Rate %" type="number" defaultValue={String(r?.vat_pct ?? 0)} />
            <Field name="vatCalculationType" label="Calculation type" type="select" defaultValue={r?.vat_calculation_type ?? 'Normal'}
              options={['Normal', 'Zero VAT', 'Exempt'].map((t) => ({ value: t, label: t }))} />
            <Field name="whtBase" label="WHT base" type="select" defaultValue={r?.wht_base ?? 'Net'} options={[{ value: 'Net', label: 'Net of VAT' }, { value: 'Gross', label: 'Gross' }]} />
          </div>
          <GlAccountField name="taxAccountId" label="Tax G/L account (input VAT or tax-payable)" accounts={accounts} defaultValue={r?.tax_account_id ?? ''} placeholder="Search account… (blank = none)" />
          <Field name="blocked" label="Blocked" type="checkbox" defaultValue={r?.blocked ? '1' : '0'} />
          {r ? (
            <p className="tiny muted-cell" style={{ marginTop: 8 }}>
              To remove this row entirely, use the delete link on the list after closing this dialog.
            </p>
          ) : null}
        </FormModal>
      ) : null}
    </>
  );
}

export function DeleteVatSetupButton({ busCode, prodCode }: { busCode: string; prodCode: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className="btn sm ghost danger" disabled={busy}
      onClick={async () => { setBusy(true); await deleteVatPostingSetupRequest(busCode, prodCode); setBusy(false); location.reload(); }}>×</button>
  );
}
