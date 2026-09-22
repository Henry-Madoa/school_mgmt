'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHead, DefinitionList, Pill } from '@/components/ui/primitives';
import { Field, readForm } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useToast } from '@/components/ui/toast';
import { Money } from '@/components/ui/money';
import { saveVendor } from '@/app/actions/payables';
import type {
  Currency, DimensionValue, PaymentMethod, PaymentTerms, VatBusinessPostingGroup, VendorListRow,
  VendorPostingGroupView,
} from '@/lib/types';
import { EmailLink, PhoneLink } from '@/components/ui/contact-link';

export interface VendorLookups {
  postingGroups: VendorPostingGroupView[];
  paymentTerms: PaymentTerms[];
  paymentMethods: PaymentMethod[];
  vatBusGroups: VatBusinessPostingGroup[];
  currencies: Currency[];
  globalDimension1Values: DimensionValue[];
  globalDimension2Values: DimensionValue[];
  caption1: string;
  caption2: string;
}

const BLOCKED = [
  { value: '', label: '(not blocked)' }, { value: 'Payment', label: 'Payment' },
  { value: 'Invoice', label: 'Invoice' }, { value: 'All', label: 'All' },
];

const codeOpts = (rows: { code: string; description: string }[], none = '(none)') =>
  [{ value: '', label: none }, ...rows.map((r) => ({ value: r.code, label: `${r.code} — ${r.description}` }))];

/**
 * Business Central's Vendor Card, edited in place — the same inline pattern as the member
 * application and employee cards. lib/vendors.ts's updateVendor() rewrites every column it knows
 * about rather than merging, so this is one form over the whole card: a per-section save would
 * blank the sections it didn't submit.
 */
export function VendorCard({ vendor: v, lookups, canEdit }: {
  vendor: VendorListRow; lookups: VendorLookups; canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dim1Id, setDim1Id] = useState(String(v.global_dimension_1_id ?? ''));
  const [dim2Id, setDim2Id] = useState(String(v.global_dimension_2_id ?? ''));

  const startEdit = () => {
    setDim1Id(String(v.global_dimension_1_id ?? ''));
    setDim2Id(String(v.global_dimension_2_id ?? ''));
    setError(''); setEditing(true);
  };

  const save = async () => {
    const form = formRef.current;
    if (!form || !form.reportValidity()) return;
    setBusy(true);
    setError('');
    try {
      const res = await saveVendor(v.no, readForm(form));
      if (!res.ok) { setError(res.error || 'Could not save'); return; }
      toast('Vendor updated', undefined, 'ok');
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const dimName = (values: DimensionValue[], id: number | null) => {
    const d = values.find((x) => x.id === id);
    return d ? `${d.code} — ${d.name}` : '—';
  };

  return (
    <Card>
      <CardHead title="Vendor card" sub={<>No. <span className="mono">{v.no}</span> · {v.blocked ? <Pill tone="bad">Blocked: {v.blocked}</Pill> : <Pill status="ok">Active</Pill>}</>}>
        {canEdit && !editing ? <button type="button" className="btn sm ghost" onClick={startEdit}>Edit</button> : null}
      </CardHead>

      {!editing ? (
        <div className="grid g2">
          <DefinitionList items={[
            ['Name', v.name],
            ['Name 2', v.name_2 || '—'],
            ['Address', v.address || '—'],
            ['Address 2', v.address_2 || '—'],
            ['City', v.city || '—'],
            ['Post code', v.post_code || '—'],
            ['Country', v.country || '—'],
            ['Contact', v.contact || '—'],
            ['Phone', <PhoneLink value={v.phone} key="phone" />],
            ['Email', <EmailLink value={v.email} key="email" />],
          ]} />
          <DefinitionList items={[
            ['Vendor posting group', v.vendor_posting_group_code || '—'],
            ['VAT bus. posting group', v.vat_bus_posting_group_code || '—'],
            ['KRA PIN', v.pin_no || '—'],
            ['Withholding tax', v.wht_exempt ? 'Exempt' : 'Withheld at the standard rate'],
            ['Payment terms', v.payment_terms_code || '—'],
            ['Payment method', v.payment_method_code || '—'],
            ['Currency', v.currency_code || 'KES (base)'],
            ['Purchaser', v.purchaser || '—'],
            ['Our account no.', v.our_account_no || '—'],
            ['Credit limit', <Money cents={v.credit_limit} key="cl" />],
            [lookups.caption1, dimName(lookups.globalDimension1Values, v.global_dimension_1_id)],
            [lookups.caption2, dimName(lookups.globalDimension2Values, v.global_dimension_2_id)],
          ]} />
        </div>
      ) : (
        <>
          <form ref={formRef} onSubmit={(e) => e.preventDefault()}>
            <div className="grid g2">
              <Field name="name" label="Name" required defaultValue={v.name} />
              <Field name="name2" label="Name 2" defaultValue={v.name_2 ?? ''} placeholder="Optional" />
            </div>
            <div className="grid g2">
              <Field name="address" label="Address" defaultValue={v.address ?? ''} />
              <Field name="address2" label="Address 2" defaultValue={v.address_2 ?? ''} />
            </div>
            <div className="grid g3">
              <Field name="city" label="City" defaultValue={v.city ?? ''} />
              <Field name="postCode" label="Post code" defaultValue={v.post_code ?? ''} />
              <Field name="country" label="Country" defaultValue={v.country ?? ''} />
            </div>
            <div className="grid g3">
              <Field name="contact" label="Contact" defaultValue={v.contact ?? ''} />
              <Field name="phone" label="Phone" defaultValue={v.phone ?? ''} type="phone" />
              <Field name="email" label="Email" type="email" defaultValue={v.email ?? ''} />
            </div>
            <div className="grid g2">
              <Field name="vendorPostingGroupCode" label="Vendor posting group" type="select"
                defaultValue={v.vendor_posting_group_code ?? ''} options={codeOpts(lookups.postingGroups)}
                hint="Locked once ledger entries have been posted" />
              <Field name="vatBusPostingGroupCode" label="VAT bus. posting group" type="select"
                defaultValue={v.vat_bus_posting_group_code ?? ''} options={codeOpts(lookups.vatBusGroups)} />
            </div>
            <div className="grid g3">
              <Field name="pinNo" label="KRA PIN" defaultValue={v.pin_no ?? ''} placeholder="Needed on a WHT certificate" />
              <Field name="currencyCode" label="Currency" type="select" defaultValue={v.currency_code ?? ''}
                options={[{ value: '', label: '(base — KES)' }, ...lookups.currencies.map((c) => ({ value: c.code, label: `${c.code} — ${c.description}` }))]} />
              <Field name="whtExempt" label="Exempt from withholding tax" type="checkbox" defaultValue={v.wht_exempt ? 1 : 0} />
            </div>
            <div className="grid g2">
              <Field name="paymentTermsCode" label="Payment terms" type="select" defaultValue={v.payment_terms_code ?? ''} options={codeOpts(lookups.paymentTerms)} />
              <Field name="paymentMethodCode" label="Payment method" type="select" defaultValue={v.payment_method_code ?? ''} options={codeOpts(lookups.paymentMethods)} />
            </div>
            <div className="grid g3">
              <Field name="purchaser" label="Purchaser" defaultValue={v.purchaser ?? ''} placeholder="Optional" />
              <Field name="ourAccountNo" label="Our Account No." defaultValue={v.our_account_no ?? ''} placeholder="Our account with the vendor" />
              <Field name="creditLimit" label="Credit limit" type="currency" defaultValue={String(v.credit_limit / 100)} />
            </div>
            <div className="grid g3">
              <SearchableSelect id="f_globalDimension1Id" name="globalDimension1Id" label={lookups.caption1}
                items={lookups.globalDimension1Values} getValue={(d) => String(d.id)} getLabel={(d) => `${d.code} — ${d.name}`}
                value={dim1Id} onChange={setDim1Id} placeholder={`Search ${lookups.caption1.toLowerCase()}…`} />
              <SearchableSelect id="f_globalDimension2Id" name="globalDimension2Id" label={lookups.caption2}
                items={lookups.globalDimension2Values} getValue={(d) => String(d.id)} getLabel={(d) => `${d.code} — ${d.name}`}
                value={dim2Id} onChange={setDim2Id} placeholder={`Search ${lookups.caption2.toLowerCase()}…`} />
              <Field name="blocked" label="Blocked" type="select" defaultValue={v.blocked ?? ''} options={BLOCKED} />
            </div>
          </form>
          <div className="inline" style={{ marginTop: 'var(--sp)' }}>
            {error ? <div className="modal-error">{error}</div> : null}
            <button type="button" className="btn ghost sm" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
            <button type="button" className="btn sm" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </>
      )}
    </Card>
  );
}
