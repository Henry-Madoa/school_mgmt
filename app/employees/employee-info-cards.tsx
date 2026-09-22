'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DefinitionList } from '@/components/ui/primitives';
import { formatDate, codedName } from '@/lib/format';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { Field, readForm } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useToast } from '@/components/ui/toast';
import { updateEmployeeRequest } from '@/app/actions/employees';
import { GENDERS, MARITAL_STATUSES } from '@/lib/constants';
import type { EmployeeLookups } from './employee-actions';
import type { EmployeeView } from '@/lib/types';
import { EmailLink, PhoneLink } from '@/components/ui/contact-link';

/** Inline card-editing:
 *  an Edit button swaps the card's read-only DefinitionList for its own <form>, Save posts just
 *  that section's fields (lib/employees.ts's updateEmployee() only touches fields it's given). */
function useInlineEdit(id: number, startEditing = false) {
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
      const res = await updateEmployeeRequest(id, values);
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

export function BioDataCard({ employee: e, lookups, canEdit, startEditing = false }: {
  employee: EmployeeView; lookups: EmployeeLookups; canEdit: boolean; startEditing?: boolean;
}) {
  const { formRef, editing, setEditing, busy, error, save } = useInlineEdit(e.id, canEdit && startEditing);
  const [countyId, setCountyId] = useState(String(e.county_id ?? ''));
  const [subCountyId, setSubCountyId] = useState(String(e.sub_county_id ?? ''));
  const subCounties = lookups.subCounties.filter((s) => String(s.county_id) === countyId);

  return (
    <CollapsibleCard title="Bio-data" sub="Personal details and statutory numbers"
      actions={canEdit && !editing ? (
        <button type="button" className="btn sm ghost"
          onClick={() => { setCountyId(String(e.county_id ?? '')); setSubCountyId(String(e.sub_county_id ?? '')); setEditing(true); }}>
          Edit
        </button>
      ) : null}
    >
      {!editing ? (
        <div className="grid g2 dl-groups">
          <section className="dl-group">
            <div className="dl-caption">Personal &amp; statutory</div>
            <DefinitionList items={[
              ['Employee No.', <span className="mono" key="no">{e.employee_no}</span>],
              ['Gender', e.gender || '—'],
              ['Date of birth', e.date_of_birth ? formatDate(e.date_of_birth) : '—'],
              ['Marital status', e.marital_status || '—'],
              ['National ID', e.national_id ? <span className="mono" key="nid">{e.national_id}</span> : '—'],
              ['KRA PIN', e.kra_pin ? <span className="mono" key="kra">{e.kra_pin}</span> : '—'],
              ['NSSF No.', e.nssf_no ? <span className="mono" key="nssf">{e.nssf_no}</span> : '—'],
              ['SHIF No.', e.shif_no ? <span className="mono" key="shif">{e.shif_no}</span> : '—'],
            ]} />
          </section>
          <section className="dl-group">
            <div className="dl-caption">Contact &amp; address</div>
            <DefinitionList items={[
              ['Phone', <PhoneLink value={e.phone} key="phone" />],
              ['Alt. phone', <PhoneLink value={e.alt_phone} key="alt-phone" />],
              ['Email', <EmailLink value={e.email} key="email" />],
              ['Physical address', e.physical_address || '—'],
              ['County', e.county_name || '—'],
              ['Sub-county', e.sub_county_name || '—'],
            ]} />
          </section>
        </div>
      ) : (
        <>
          <form ref={formRef} onSubmit={(ev) => ev.preventDefault()}>
            <div className="grid g3">
              <Field name="first_name" label="First name" required defaultValue={e.first_name} />
              <Field name="middle_name" label="Middle name" defaultValue={e.middle_name ?? ''} />
              <Field name="last_name" label="Last name" required defaultValue={e.last_name} />
            </div>
            <div className="grid g3">
              <Field name="gender" label="Gender" type="select" options={GENDERS} defaultValue={e.gender ?? ''} />
              <Field name="date_of_birth" label="Date of birth" type="date" defaultValue={e.date_of_birth ?? ''} />
              <Field name="marital_status" label="Marital status" type="select" options={MARITAL_STATUSES} defaultValue={e.marital_status ?? ''} />
            </div>
            <div className="grid g3">
              <Field name="national_id" label="National ID" defaultValue={e.national_id ?? ''} />
              <Field name="kra_pin" label="KRA PIN" defaultValue={e.kra_pin ?? ''} />
              <Field name="nssf_no" label="NSSF No." defaultValue={e.nssf_no ?? ''} />
            </div>
            <div className="grid g2">
              <Field name="shif_no" label="SHIF No." defaultValue={e.shif_no ?? ''} />
              <Field name="phone" label="Phone" defaultValue={e.phone ?? ''} type="phone" />
            </div>
            <div className="grid g2">
              <Field name="alt_phone" label="Alternative phone" defaultValue={e.alt_phone ?? ''} type="phone" />
              <Field name="email" label="Email" defaultValue={e.email ?? ''} type="email" />
            </div>
            <Field name="physical_address" label="Physical address" defaultValue={e.physical_address ?? ''} />
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

export function EmploymentCard({ employee: e, lookups, canEdit }: { employee: EmployeeView; lookups: EmployeeLookups; canEdit: boolean }) {
  const { formRef, editing, setEditing, busy, error, save } = useInlineEdit(e.id);
  const [dim1Id, setDim1Id] = useState(String(e.global_dimension_1_id ?? ''));
  const [dim2Id, setDim2Id] = useState(String(e.global_dimension_2_id ?? ''));
  const [contractTypeId, setContractTypeId] = useState(String(e.contract_type_id ?? ''));
  const [managerId, setManagerId] = useState(String(e.manager_id ?? ''));
  const [companyJobId, setCompanyJobId] = useState(String(e.company_job_id ?? ''));
  // A full position stays pickable only when it is the one the employee already holds.
  const companyJobs = lookups.companyJobs.filter((j) => j.vacant > 0 || j.id === e.company_job_id);

  return (
    <CollapsibleCard title="Employment" sub="Job, grade, dimensions and reporting line"
      actions={canEdit && !editing ? (
        <button type="button" className="btn sm ghost"
          onClick={() => {
            setDim1Id(String(e.global_dimension_1_id ?? '')); setDim2Id(String(e.global_dimension_2_id ?? ''));

            setContractTypeId(String(e.contract_type_id ?? '')); setManagerId(String(e.manager_id ?? ''));
            setCompanyJobId(String(e.company_job_id ?? ''));
            setEditing(true);
          }}>
          Edit
        </button>
      ) : null}
    >
      {!editing ? (
        <div className="grid g2 dl-groups">
          <section className="dl-group">
            <div className="dl-caption">Position</div>
            <DefinitionList items={[
              ['Company job', e.company_job_code ? <>{e.company_job_name} <span className="mono">({e.company_job_code})</span></> : <span className="muted-cell">Not on the organogram</span>],
              ['Job title', e.job_title || '—'],
              [lookups.caption1, e.global_dimension_1_name || '—'],
              [lookups.caption2, e.global_dimension_2_name || '—'],
              ['Nature of employment', e.nature_of_employment],
              ['Employee type', e.employee_type],
            ]} />
          </section>
          <section className="dl-group">
            <div className="dl-caption">Engagement</div>
            <DefinitionList items={[
              ['Employment date', e.employment_date ? formatDate(e.employment_date) : '—'],
              ['Employment contract type', e.contract_type_name || '—'],
              ['Probation status', e.probation_status],
              ['Probation end date', e.probation_end_date ? formatDate(e.probation_end_date) : '—'],
              ['Line manager', e.manager_first_name ? `${e.manager_first_name} ${e.manager_last_name}` : '—'],
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
              hint="Only approved positions with a vacant post can take a new holder" />
            <Field name="job_title" label="Job title" defaultValue={e.job_title ?? ''} hint="Job grade and salary scale are set on the Payroll details card" />
            <SearchableSelect id="f_contract_type_id" name="contract_type_id" label="Employment contract type"
              items={lookups.contractTypes} getValue={(c) => String(c.id)} getLabel={(c) => c.name}
              value={contractTypeId} onChange={setContractTypeId} placeholder="Search contract type…" />
            <div className="grid g3">
              <Field name="employment_date" label="Employment date" type="date" required defaultValue={e.employment_date} />
              <Field name="nature_of_employment" label="Nature of employment" type="select"
                options={[{ value: 'PERMANENT', label: 'Permanent' }, { value: 'CONTRACT', label: 'Contract' }, { value: 'BOARD', label: 'Board' }, { value: 'SECONDED', label: 'Seconded' }]}
                defaultValue={e.nature_of_employment} />
              <Field name="employee_type" label="Employee type" type="select"
                options={[{ value: 'STAFF', label: 'Staff' }, { value: 'DRIVER', label: 'Driver' }, { value: 'INTERN', label: 'Intern' }, { value: 'NYSC', label: 'NYSC' }]}
                defaultValue={e.employee_type} />
            </div>
            <SearchableSelect id="f_manager_id" name="manager_id" label="Line manager"
              items={lookups.managers} getValue={(m) => String(m.id)} getLabel={(m) => `${m.first_name} ${m.last_name} (${m.employee_no})`}
              value={managerId} onChange={setManagerId} placeholder="Search employee…" />
          </form>
          <EditActions busy={busy} error={error} onCancel={() => setEditing(false)} onSave={save} />
        </>
      )}
    </CollapsibleCard>
  );
}

export function BankingCard({ employee: e, canEdit }: { employee: EmployeeView; canEdit: boolean }) {
  const { formRef, editing, setEditing, busy, error, save } = useInlineEdit(e.id);

  return (
    <CollapsibleCard title="Banking" sub="Primary bank details"
      actions={canEdit && !editing ? <button type="button" className="btn sm ghost" onClick={() => setEditing(true)}>Edit</button> : null}
    >
      {!editing ? (
        <div className="grid g2 dl-groups">
          <section className="dl-group">
            <div className="dl-caption">Bank</div>
            <DefinitionList items={[
              ['Bank code', e.bank_code ? <span className="mono" key="bc">{e.bank_code}</span> : '—'],
              ['Branch', e.bank_branch || '—'],
            ]} />
          </section>
          <section className="dl-group">
            <div className="dl-caption">Account</div>
            <DefinitionList items={[
              ['Account number', e.bank_account_no ? <span className="mono" key="ac">{e.bank_account_no}</span> : '—'],
              ['Account holder', `${e.first_name} ${e.last_name}`],
            ]} />
          </section>
        </div>
      ) : (
        <>
          <form ref={formRef} onSubmit={(ev) => ev.preventDefault()}>
            <div className="grid g3">
              <Field name="bank_code" label="Bank code" defaultValue={e.bank_code ?? ''} />
              <Field name="bank_branch" label="Branch" defaultValue={e.bank_branch ?? ''} />
              <Field name="bank_account_no" label="Account number" defaultValue={e.bank_account_no ?? ''} />
            </div>
          </form>
          <EditActions busy={busy} error={error} onCancel={() => setEditing(false)} onSave={save} />
        </>
      )}
    </CollapsibleCard>
  );
}
