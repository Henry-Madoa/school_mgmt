'use client';

import { useState, type ReactNode } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { useRunAction } from '@/components/ui/run-action';
import { Field } from '@/components/ui/field';
import { GlAccountSelect } from '@/components/ui/gl-account-select';
import {
  createVpgRequest, updateVpgRequest, deleteVpgRequest,
  requestVendor, savePurchasesPayablesSetupRequest,
} from '@/app/actions/payables';
import type {
  GlAccount, PaymentMethod, PaymentTerms, PurchasesPayablesSetup, VendorPostingGroup,
  VendorPostingGroupView,
} from '@/lib/types';

const BLOCKED = [
  { value: '', label: '(not blocked)' }, { value: 'Payment', label: 'Payment' },
  { value: 'Invoice', label: 'Invoice' }, { value: 'All', label: 'All' },
];

/* ------------------------------------------------------------------- Vendor */

/** Registering a vendor. Everything after registration is edited on the vendor's own card
 *  (app/payables/vendor-card.tsx), so this modal only ever creates. */
export function NewVendorButton({ postingGroups, paymentTerms, paymentMethods, className = 'btn', children }: {
  postingGroups: VendorPostingGroupView[]; paymentTerms: PaymentTerms[]; paymentMethods: PaymentMethod[];
  className?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const opts = (rows: { code: string; description: string }[], none = '(none)') =>
    [{ value: '', label: none }, ...rows.map((r) => ({ value: r.code, label: `${r.code} — ${r.description}` }))];
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          title="New vendor" wide
          onClose={() => setOpen(false)}
          onSubmit={requestVendor}
          submitLabel="Create"
          successTitle="Vendor created"
          successDetail={(d) => `${d.no} registered — open its card to fill in the rest`} redirectTo={(d) => `/payables/vendors/${d.no}`}
        >
          <div className="grid g2">
            <Field name="name" label="Name" required />
            <Field name="name2" label="Name 2" defaultValue="" placeholder="Optional" />
          </div>
          <div className="grid g2">
            <Field name="address" label="Address" defaultValue="" />
            <Field name="city" label="City" defaultValue="" />
          </div>
          <div className="grid g3">
            <Field name="contact" label="Contact" defaultValue="" />
            <Field name="phone" label="Phone" defaultValue="" type="phone" />
            <Field name="email" label="Email" type="email" defaultValue="" />
          </div>
          <div className="grid g2">
            <Field name="vendorPostingGroupCode" label="Vendor posting group" type="select" defaultValue="" options={opts(postingGroups)} />
            <Field name="paymentTermsCode" label="Payment terms" type="select" defaultValue="" options={opts(paymentTerms)} />
          </div>
          <div className="grid g2">
            <Field name="paymentMethodCode" label="Payment method" type="select" defaultValue="" options={opts(paymentMethods)} />
            <Field name="purchaser" label="Purchaser" defaultValue="" placeholder="Optional" />
          </div>
          <div className="grid g3">
            <Field name="ourAccountNo" label="Our Account No." defaultValue="" placeholder="Our account with the vendor" />
            <Field name="creditLimit" label="Credit limit" type="currency" defaultValue="0" />
            <Field name="blocked" label="Blocked" type="select" defaultValue="" options={BLOCKED} />
          </div>
        </FormModal>
      ) : null}
    </>
  );
}

/* ----------------------------------------------------- Vendor Posting Group */

const VPG_ACCOUNTS: { name: string; label: string }[] = [
  { name: 'payables_account_id', label: 'Payables Account' },
  { name: 'service_charge_account_id', label: 'Service Charge Account' },
  { name: 'payment_disc_debit_account_id', label: 'Payment Disc. Debit Account' },
  { name: 'payment_disc_credit_account_id', label: 'Payment Disc. Credit (Received) Account' },
  { name: 'invoice_rounding_account_id', label: 'Invoice Rounding Account' },
];

export function VendorPostingGroupFormButton({ row, accounts, className = 'btn', children }: {
  row?: VendorPostingGroupView | null; accounts: GlAccount[]; className?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const r = row ?? null;
  const [ids, setIds] = useState<Record<string, string>>(() =>
    Object.fromEntries(VPG_ACCOUNTS.map((a) => [a.name, r ? String((r as unknown as Record<string, number>)[a.name] ?? '') : ''])));
  return (
    <>
      <button type="button" className={className} onClick={() => {
        setIds(Object.fromEntries(VPG_ACCOUNTS.map((a) => [a.name, r ? String((r as unknown as Record<string, number>)[a.name] ?? '') : ''])));
        setOpen(true);
      }}>{children}</button>
      {open ? (
        <FormModal
          title={r ? `Edit ${r.code}` : 'New vendor posting group'} wide
          onClose={() => setOpen(false)}
          onSubmit={(v) => (r ? updateVpgRequest(r.id, v) : createVpgRequest(v))}
          submitLabel={r ? 'Save changes' : 'Create'}
          successTitle={r ? 'Posting group updated' : 'Posting group created'}
        >
          <div className="grid g2">
            <Field name="code" label="Code" required uppercase defaultValue={r?.code} disabled={!!r} placeholder="e.g. TRADE" />
            <Field name="description" label="Description" required defaultValue={r?.description} />
          </div>
          {VPG_ACCOUNTS.map((a) => (
            <GlAccountSelect key={a.name} name={a.name} label={a.label} required accounts={accounts}
              value={ids[a.name] ?? ''} onChange={(val) => setIds((p) => ({ ...p, [a.name]: val }))} />
          ))}
        </FormModal>
      ) : null}
    </>
  );
}

/* --------------------------------------------------- Purchases & Payables Setup */

export function PurchasesPayablesSetupButton({ setup, postingGroups, paymentTerms, className = 'btn', children }: {
  setup: PurchasesPayablesSetup; postingGroups: VendorPostingGroup[]; paymentTerms: PaymentTerms[];
  className?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const opts = (rows: { code: string; description: string }[]) => [{ value: '', label: '(none)' }, ...rows.map((r) => ({ value: r.code, label: `${r.code} — ${r.description}` }))];
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal title="Purchases & Payables Setup" onClose={() => setOpen(false)} onSubmit={savePurchasesPayablesSetupRequest} submitLabel="Save" successTitle="Setup saved">
          <div className="grid g2">
            <Field name="default_vendor_posting_group_code" label="Default vendor posting group" type="select" defaultValue={setup.default_vendor_posting_group_code ?? ''} options={opts(postingGroups)} />
            <Field name="default_payment_terms_code" label="Default payment terms" type="select" defaultValue={setup.default_payment_terms_code ?? ''} options={opts(paymentTerms)} />
          </div>
          <div className="grid g2">
            <Field name="receipt_on_invoice" label="Receipt on Invoice" type="checkbox" defaultValue={setup.receipt_on_invoice ? 'on' : ''} hint="Auto-receive stock when posting a Purchase Invoice" />
            <Field name="exact_cost_reversing_mandatory" label="Exact Cost Reversing Mandatory" type="checkbox" defaultValue={setup.exact_cost_reversing_mandatory ? 'on' : ''} />
          </div>
          <div className="grid g2">
            <Field name="allow_payables_posting_from" label="Allow Posting From" type="date" defaultValue={setup.allow_payables_posting_from ?? ''} />
            <Field name="allow_payables_posting_to" label="Allow Posting To" type="date" defaultValue={setup.allow_payables_posting_to ?? ''} />
          </div>
        </FormModal>
      ) : null}
    </>
  );
}

/** Removable only while no vendor still names it — see receivables-forms.tsx for the pattern. */
export function DeleteVendorPostingGroupButton({ id, className = 'btn sm ghost' }: { id: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => deleteVpgRequest(id), {
        confirm: {
          title: 'Delete this posting group?',
          message: 'Refused while any vendor still names it.',
          confirmLabel: 'Delete', danger: true,
        },
        successTitle: 'Posting group deleted',
      })}>
      {busy ? 'Working…' : 'Delete'}
    </button>
  );
}
