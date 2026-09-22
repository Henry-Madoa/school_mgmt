'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DefinitionList } from '@/components/ui/primitives';
import { formatDate, codedName } from '@/lib/format';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { Field, readForm } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useToast } from '@/components/ui/toast';
import { updateEmployeeEditRequestAction } from '@/app/actions/employeeEdits';
import { GENDERS, MARITAL_STATUSES } from '@/lib/constants';
import type { EditLookups } from './edit-actions';
import type { EmployeeEditRequestView } from '@/lib/types';
import { EmailLink, PhoneLink } from '@/components/ui/contact-link';

/** The inline-editable card pattern: an Edit
 *  button swaps the card's read-only view for its own <form>; Save posts just that section's
 *  fields (lib/employeeEdits.ts's updateEmployeeEditRequest() only touches fields it's given). */
function useInlineEdit(no: string, startEditing = false) {
  const router = useRouter();
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [editing, setEditing] = useState(startEditing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const form = formRef.current;
    if (!form || !form.reportValidity()) return;
    setBusy(true);
    setError('');
    try {
      const values = readForm(form);
      const res = await updateEmployeeEditRequestAction(no, values);
      if (!res.ok) { setError(res.error || 'Could not save'); return; }
      toast('Changes saved', undefined, 'ok');
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return { formRef, editing, setEditing, busy, error, save };
}

function EditActions({ busy, error, onCancel, onSave }: { busy: boolean; error: string; onCancel: () => void; onSave: () => void }) {
  return (
    <div className="inline" style={{ marginTop: 'var(--sp)' }}>
      {error ? <div className="modal-error">{error}</div> : null}
      <button type="button" className="btn ghost sm" onClick={onCancel} disabled={busy}>Cancel</button>
      <button type="button" className="btn sm" onClick={onSave} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
    </div>
  );
}

export function EditBioDataCard({ request: r, lookups, canEdit, startEditing = false }: {
  request: EmployeeEditRequestView; lookups: EditLookups; canEdit: boolean; startEditing?: boolean;
}) {
  const { formRef, editing, setEditing, busy, error, save } = useInlineEdit(r.no, canEdit && startEditing);
  const [countyId, setCountyId] = useState(String(r.county_id ?? ''));
  const [subCountyId, setSubCountyId] = useState(String(r.sub_county_id ?? ''));
  const subCounties = lookups.subCounties.filter((s) => String(s.county_id) === countyId);

  return (
    <CollapsibleCard title="Proposed bio-data" sub="Values that will replace the live employee record on Apply"
      actions={canEdit && !editing ? (
        <button type="button" className="btn sm ghost"
          onClick={() => { setCountyId(String(r.county_id ?? '')); setSubCountyId(String(r.sub_county_id ?? '')); setEditing(true); }}>
          Edit
        </button>
      ) : null}
    >
      {!editing ? (
        <div className="grid g2 dl-groups">
          <section className="dl-group">
            <div className="dl-caption">Personal &amp; statutory</div>
            <DefinitionList items={[
              ['Full name', <span className="dl-emphasis" key="nm">{[r.first_name, r.middle_name, r.last_name].filter(Boolean).join(' ') || '—'}</span>],
              ['Gender', r.gender || '—'],
              ['Date of birth', r.date_of_birth ? formatDate(r.date_of_birth) : '—'],
              ['Marital status', r.marital_status || '—'],
              ['National ID', r.national_id ? <span className="mono" key="nid">{r.national_id}</span> : '—'],
              ['KRA PIN', r.kra_pin ? <span className="mono" key="kra">{r.kra_pin}</span> : '—'],
              ['NSSF No.', r.nssf_no ? <span className="mono" key="nssf">{r.nssf_no}</span> : '—'],
              ['SHIF No.', r.shif_no ? <span className="mono" key="shif">{r.shif_no}</span> : '—'],
            ]} />
          </section>
          <section className="dl-group">
            <div className="dl-caption">Contact &amp; address</div>
            <DefinitionList items={[
              ['Phone', <PhoneLink value={r.phone} key="phone" />],
              ['Alt. phone', <PhoneLink value={r.alt_phone} key="alt-phone" />],
              ['Email', <EmailLink value={r.email} key="email" />],
              ['Physical address', r.physical_address || '—'],
              ['County', r.county_name || '—'],
              ['Sub-county', r.sub_county_name || '—'],
            ]} />
          </section>
        </div>
      ) : (
        <>
          <form ref={formRef} onSubmit={(ev) => ev.preventDefault()}>
            <div className="grid g3">
              <Field name="first_name" label="First name" required defaultValue={r.first_name ?? ''} />
              <Field name="middle_name" label="Middle name" defaultValue={r.middle_name ?? ''} />
              <Field name="last_name" label="Last name" required defaultValue={r.last_name ?? ''} />
            </div>
            <div className="grid g3">
              <Field name="gender" label="Gender" type="select" options={GENDERS} defaultValue={r.gender ?? ''} />
              <Field name="date_of_birth" label="Date of birth" type="date" defaultValue={r.date_of_birth ?? ''} />
              <Field name="marital_status" label="Marital status" type="select" options={MARITAL_STATUSES} defaultValue={r.marital_status ?? ''} />
            </div>
            <div className="grid g3">
              <Field name="national_id" label="National ID" defaultValue={r.national_id ?? ''} />
              <Field name="kra_pin" label="KRA PIN" defaultValue={r.kra_pin ?? ''} />
              <Field name="nssf_no" label="NSSF No." defaultValue={r.nssf_no ?? ''} />
            </div>
            <div className="grid g2">
              <Field name="shif_no" label="SHIF No." defaultValue={r.shif_no ?? ''} />
              <Field name="phone" label="Phone" defaultValue={r.phone ?? ''} type="phone" />
            </div>
            <div className="grid g2">
              <Field name="alt_phone" label="Alternative phone" defaultValue={r.alt_phone ?? ''} type="phone" />
              <Field name="email" label="Email" defaultValue={r.email ?? ''} type="email" />
            </div>
            <Field name="physical_address" label="Physical address" defaultValue={r.physical_address ?? ''} />
            <div className="grid g2">
              <SearchableSelect id="f_county_id" name="county_id" label="County"
                items={lookups.counties} getValue={(c) => String(c.id)} getLabel={codedName}
                value={countyId} onChange={(v) => { setCountyId(v); setSubCountyId(''); }} placeholder="Search county…" />
              <SearchableSelect id="f_sub_county_id" name="sub_county_id" label="Sub-county"
                items={subCounties} getValue={(s) => String(s.id)} getLabel={codedName}
                value={subCountyId} onChange={setSubCountyId} disabled={!countyId}
                placeholder={countyId ? 'Search sub-county…' : 'Pick a county first'} />
            </div>
          </form>
          <EditActions busy={busy} error={error} onCancel={() => setEditing(false)} onSave={save} />
        </>
      )}
    </CollapsibleCard>
  );
}

export function EditEmploymentBankingCard({ request: r, lookups, canEdit }: {
  request: EmployeeEditRequestView; lookups: EditLookups; canEdit: boolean;
}) {
  const { formRef, editing, setEditing, busy, error, save } = useInlineEdit(r.no);
  const [dim1Id, setDim1Id] = useState(String(r.global_dimension_1_id ?? ''));
  const [dim2Id, setDim2Id] = useState(String(r.global_dimension_2_id ?? ''));
  const [companyJobId, setCompanyJobId] = useState(String(r.company_job_id ?? ''));
  // A full position stays pickable only when it is the one already proposed / held.
  const companyJobs = lookups.companyJobs.filter((j) => j.vacant > 0 || j.id === r.company_job_id);

  return (
    <CollapsibleCard title="Proposed employment &amp; banking" sub="Dimensions, job title, grade and bank details"
      actions={canEdit && !editing ? (
        <button type="button" className="btn sm ghost"
          onClick={() => {
            setDim1Id(String(r.global_dimension_1_id ?? '')); setDim2Id(String(r.global_dimension_2_id ?? ''));
            setCompanyJobId(String(r.company_job_id ?? ''));
            setEditing(true);
          }}>
          Edit
        </button>
      ) : null}
    >
      {!editing ? (
        <div className="grid g2 dl-groups">
          <section className="dl-group">
            <div className="dl-caption">Employment</div>
            <DefinitionList items={[
              ['Company job', r.company_job_code ? <>{r.company_job_name} <span className="mono">({r.company_job_code})</span></> : <span className="muted-cell">Not on the organogram</span>],
              ['Job title', r.job_title || '—'],
              [lookups.caption1, r.global_dimension_1_name || '—'],
              [lookups.caption2, r.global_dimension_2_name || '—'],
            ]} />
          </section>
          <section className="dl-group">
            <div className="dl-caption">Banking</div>
            <DefinitionList items={[
              ['Bank code', r.bank_code ? <span className="mono" key="bc">{r.bank_code}</span> : '—'],
              ['Branch', r.bank_branch || '—'],
              ['Account number', r.bank_account_no ? <span className="mono" key="ac">{r.bank_account_no}</span> : '—'],
            ]} />
          </section>
        </div>
      ) : (
        <>
          <form ref={formRef} onSubmit={(ev) => ev.preventDefault()}>
            <div className="grid g2">
              <SearchableSelect id="f_gd1" name="global_dimension_1_id" label={lookups.caption1}
                items={lookups.globalDimension1Values} getValue={(d) => String(d.id)} getLabel={(d) => `${d.code} — ${d.name}`}
                value={dim1Id} onChange={setDim1Id} placeholder={`Search ${lookups.caption1.toLowerCase()}…`} emptyText="No matches" />
              <SearchableSelect id="f_gd2" name="global_dimension_2_id" label={lookups.caption2}
                items={lookups.globalDimension2Values} getValue={(d) => String(d.id)} getLabel={(d) => `${d.code} — ${d.name}`}
                value={dim2Id} onChange={setDim2Id} placeholder={`Search ${lookups.caption2.toLowerCase()}…`} emptyText="No matches" />
            </div>
            <SearchableSelect id="f_company_job_id" name="company_job_id" label="Company job (position on the organogram)"
              items={companyJobs} getValue={(j) => String(j.id)} getLabel={(j) => `${j.job_id} — ${j.name}${j.vacant > 0 ? ` (${j.vacant} vacant)` : ' (full)'}`}
              value={companyJobId} onChange={setCompanyJobId} placeholder="Search approved position…" emptyText="No approved position with a vacant post"
              hint="The move takes effect when the request is applied; the post must still be free then" />
            <Field name="job_title" label="Job title" defaultValue={r.job_title ?? ''} hint="Job grade and salary scale are proposed on the Payroll details card (HR)" />
            <div className="note" style={{ marginTop: 4, marginBottom: 4 }}>Banking</div>
            <div className="grid g3">
              <Field name="bank_code" label="Bank code" defaultValue={r.bank_code ?? ''} />
              <Field name="bank_branch" label="Branch" defaultValue={r.bank_branch ?? ''} />
              <Field name="bank_account_no" label="Account number" defaultValue={r.bank_account_no ?? ''} />
            </div>
          </form>
          <EditActions busy={busy} error={error} onCancel={() => setEditing(false)} onSave={save} />
        </>
      )}
    </CollapsibleCard>
  );
}
