'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHead, DefinitionList, Pill } from '@/components/ui/primitives';
import { Field, readForm } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useToast } from '@/components/ui/toast';
import { Money } from '@/components/ui/money';
import { saveCustomer } from '@/app/actions/receivables';
import type {
  Currency, CustomerListRow, CustomerPostingGroupView, DimensionValue, FinanceChargeTerms,
  PaymentMethod, PaymentTerms, ReminderTerms,
} from '@/lib/types';
import { EmailLink, PhoneLink } from '@/components/ui/contact-link';

export interface CustomerLookups {
  postingGroups: CustomerPostingGroupView[];
  paymentTerms: PaymentTerms[];
  paymentMethods: PaymentMethod[];
  reminderTerms: ReminderTerms[];
  finChargeTerms: FinanceChargeTerms[];
  currencies: Currency[];
  globalDimension1Values: DimensionValue[];
  globalDimension2Values: DimensionValue[];
  caption1: string;
  caption2: string;
}

const BLOCKED = [
  { value: '', label: '(not blocked)' }, { value: 'Ship', label: 'Ship' },
  { value: 'Invoice', label: 'Invoice' }, { value: 'All', label: 'All' },
];

const codeOpts = (rows: { code: string; description: string }[], none = '(none)') =>
  [{ value: '', label: none }, ...rows.map((r) => ({ value: r.code, label: `${r.code} — ${r.description}` }))];

/**
 * Business Central's Customer Card, edited in place — the same inline pattern as the member
 * application and employee cards. lib/customers.ts's updateCustomer() rewrites every column it
 * knows about rather than merging, so this is one form over the whole card: a per-section save
 * would blank the sections it didn't submit.
 */
export function CustomerCard({ customer: c, lookups, canEdit }: {
  customer: CustomerListRow; lookups: CustomerLookups; canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dim1Id, setDim1Id] = useState(String(c.global_dimension_1_id ?? ''));
  const [dim2Id, setDim2Id] = useState(String(c.global_dimension_2_id ?? ''));

  const startEdit = () => {
    setDim1Id(String(c.global_dimension_1_id ?? ''));
    setDim2Id(String(c.global_dimension_2_id ?? ''));
    setError(''); setEditing(true);
  };

  const save = async () => {
    const form = formRef.current;
    if (!form || !form.reportValidity()) return;
    setBusy(true);
    setError('');
    try {
      const res = await saveCustomer(c.no, readForm(form));
      if (!res.ok) { setError(res.error || 'Could not save'); return; }
      toast('Customer updated', undefined, 'ok');
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
      <CardHead title="Customer card" sub={<>No. <span className="mono">{c.no}</span> · {c.blocked ? <Pill tone="bad">Blocked: {c.blocked}</Pill> : c.credit_limit_exceeded ? <Pill tone="warn">Over limit</Pill> : <Pill status="ok">Active</Pill>}</>}>
        {canEdit && !editing ? <button type="button" className="btn sm ghost" onClick={startEdit}>Edit</button> : null}
      </CardHead>

      {!editing ? (
        <div className="grid g2">
          <DefinitionList items={[
            ['Name', c.name],
            ['Name 2', c.name_2 || '—'],
            ['Address', c.address || '—'],
            ['Address 2', c.address_2 || '—'],
            ['City', c.city || '—'],
            ['Post code', c.post_code || '—'],
            ['Country', c.country || '—'],
            ['Contact', c.contact || '—'],
            ['Phone', <PhoneLink value={c.phone} key="phone" />],
            ['Email', <EmailLink value={c.email} key="email" />],
          ]} />
          <DefinitionList items={[
            ['Customer posting group', c.customer_posting_group_code || '—'],
            ['Payment terms', c.payment_terms_code || '—'],
            ['Payment method', c.payment_method_code || '—'],
            ['Reminder terms', c.reminder_terms_code || '—'],
            ['Fin. charge terms', c.fin_charge_terms_code || '—'],
            ['Currency', c.currency_code || 'KES (base)'],
            ['Salesperson', c.salesperson || '—'],
            ['Credit limit', <Money cents={c.credit_limit} key="cl" />],
            [lookups.caption1, dimName(lookups.globalDimension1Values, c.global_dimension_1_id)],
            [lookups.caption2, dimName(lookups.globalDimension2Values, c.global_dimension_2_id)],
          ]} />
        </div>
      ) : (
        <>
          <form ref={formRef} onSubmit={(e) => e.preventDefault()}>
            <div className="grid g2">
              <Field name="name" label="Name" required defaultValue={c.name} />
              <Field name="name2" label="Name 2" defaultValue={c.name_2 ?? ''} placeholder="Optional" />
            </div>
            <div className="grid g2">
              <Field name="address" label="Address" defaultValue={c.address ?? ''} />
              <Field name="address2" label="Address 2" defaultValue={c.address_2 ?? ''} />
            </div>
            <div className="grid g3">
              <Field name="city" label="City" defaultValue={c.city ?? ''} />
              <Field name="postCode" label="Post code" defaultValue={c.post_code ?? ''} />
              <Field name="country" label="Country" defaultValue={c.country ?? ''} />
            </div>
            <div className="grid g3">
              <Field name="contact" label="Contact" defaultValue={c.contact ?? ''} />
              <Field name="phone" label="Phone" defaultValue={c.phone ?? ''} type="phone" />
              <Field name="email" label="Email" type="email" defaultValue={c.email ?? ''} />
            </div>
            <div className="grid g2">
              <Field name="customerPostingGroupCode" label="Customer posting group" type="select"
                defaultValue={c.customer_posting_group_code ?? ''} options={codeOpts(lookups.postingGroups)}
                hint="Locked once ledger entries have been posted" />
              <Field name="currencyCode" label="Currency" type="select" defaultValue={c.currency_code ?? ''}
                options={[{ value: '', label: '(base — KES)' }, ...lookups.currencies.map((cur) => ({ value: cur.code, label: `${cur.code} — ${cur.description}` }))]} />
            </div>
            <div className="grid g2">
              <Field name="paymentTermsCode" label="Payment terms" type="select" defaultValue={c.payment_terms_code ?? ''} options={codeOpts(lookups.paymentTerms)} />
              <Field name="paymentMethodCode" label="Payment method" type="select" defaultValue={c.payment_method_code ?? ''} options={codeOpts(lookups.paymentMethods)} />
            </div>
            <div className="grid g2">
              <Field name="reminderTermsCode" label="Reminder terms" type="select" defaultValue={c.reminder_terms_code ?? ''} options={codeOpts(lookups.reminderTerms)} />
              <Field name="finChargeTermsCode" label="Fin. charge terms" type="select" defaultValue={c.fin_charge_terms_code ?? ''} options={codeOpts(lookups.finChargeTerms)} />
            </div>
            <div className="grid g3">
              <Field name="salesperson" label="Salesperson" defaultValue={c.salesperson ?? ''} placeholder="Optional" />
              <Field name="creditLimit" label="Credit limit" type="currency" defaultValue={String(c.credit_limit / 100)} />
              <Field name="blocked" label="Blocked" type="select" defaultValue={c.blocked ?? ''} options={BLOCKED} />
            </div>
            <div className="grid g2">
              <SearchableSelect id="f_globalDimension1Id" name="globalDimension1Id" label={lookups.caption1}
                items={lookups.globalDimension1Values} getValue={(d) => String(d.id)} getLabel={(d) => `${d.code} — ${d.name}`}
                value={dim1Id} onChange={setDim1Id} placeholder={`Search ${lookups.caption1.toLowerCase()}…`} />
              <SearchableSelect id="f_globalDimension2Id" name="globalDimension2Id" label={lookups.caption2}
                items={lookups.globalDimension2Values} getValue={(d) => String(d.id)} getLabel={(d) => `${d.code} — ${d.name}`}
                value={dim2Id} onChange={setDim2Id} placeholder={`Search ${lookups.caption2.toLowerCase()}…`} />
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
