'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHead, Toolbar, Spacer } from '@/components/ui/primitives';
import { Field, readForm } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useToast } from '@/components/ui/toast';
import { createEmployeeRequest } from '@/app/actions/employees';
import { today } from '@/lib/format';
import type { DimensionValue } from '@/lib/types';

export function NewEmployeeForm({ globalDimension1Values, globalDimension2Values, caption1, caption2 }: {
  globalDimension1Values: DimensionValue[]; globalDimension2Values: DimensionValue[]; caption1: string; caption2: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dim1Id, setDim1Id] = useState('');
  const [dim2Id, setDim2Id] = useState('');

  const create = async () => {
    const form = formRef.current;
    if (!form || !form.reportValidity()) return;
    setBusy(true);
    setError('');
    try {
      const values = readForm(form);
      const res = await createEmployeeRequest(values);
      if (!res.ok) { setError(res.error || 'Could not create employee'); return; }
      toast('Employee created', 'Add the rest of the details on the employee page.', 'ok');
      router.push(`/employees/view/${res.data.id}?edit=1`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHead title="New employee" sub="The remaining details can be filled in afterwards" />
      <form ref={formRef} onSubmit={(e) => e.preventDefault()}>
        <div className="grid g3">
          <Field name="first_name" label="First name" required />
          <Field name="middle_name" label="Middle name" />
          <Field name="last_name" label="Last name" required />
        </div>
        <div className="grid g3">
          <Field name="employment_date" label="Employment date" type="date" required defaultValue={today()} />
          <SearchableSelect name="global_dimension_1_id" label={caption1}
            items={globalDimension1Values} getValue={(d) => String(d.id)} getLabel={(d) => `${d.code} — ${d.name}`}
            value={dim1Id} onChange={setDim1Id} placeholder={`Search ${caption1.toLowerCase()}…`} emptyText="No matches" />
          <SearchableSelect name="global_dimension_2_id" label={caption2}
            items={globalDimension2Values} getValue={(d) => String(d.id)} getLabel={(d) => `${d.code} — ${d.name}`}
            value={dim2Id} onChange={setDim2Id} placeholder={`Search ${caption2.toLowerCase()}…`} emptyText="No matches" />
        </div>
      </form>
      <Toolbar>
        <Spacer />
        {error ? <div className="modal-error">{error}</div> : null}
        <button type="button" className="btn ghost" onClick={() => router.push('/employees')} disabled={busy}>Cancel</button>
        <button type="button" className="btn" onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Create employee'}</button>
      </Toolbar>
    </Card>
  );
}
