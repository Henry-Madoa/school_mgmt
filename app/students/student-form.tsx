'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHead, Toolbar, Spacer } from '@/components/ui/primitives';
import { Field, readForm } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useToast } from '@/components/ui/toast';
import { useEditableCard } from '@/components/ui/editable-card';
import { admitStudentRequest, updateStudentRequest } from '@/app/actions/students';
import type { GuardianDraft } from '@/lib/students';
import { GENDERS, RELATIONSHIPS } from '@/lib/constants';
import { today } from '@/lib/format';
import type { County, StreamView, StudentGuardianView, StudentView, SubCounty } from '@/lib/types';

export interface StudentLookups {
  streams: StreamView[];
  counties: County[];
  subCounties: SubCounty[];
}

const GUARDIAN_RELATIONSHIPS = ['Mother', 'Father', 'Guardian', ...RELATIONSHIPS.filter((r) => r && !['Mother', 'Father', 'Guardian', 'Son', 'Daughter', 'Spouse'].includes(r))];

const blankGuardian = (isPrimary: boolean): GuardianDraft => ({ fullName: '', phone: '', email: '', nationalId: '', relationship: 'Mother', occupation: '', address: '', isPrimary });
const fromView = (g: StudentGuardianView): GuardianDraft => ({
  id: g.id, fullName: g.full_name, phone: g.phone, email: g.email ?? '', nationalId: g.national_id ?? '', relationship: g.relationship,
  occupation: g.occupation ?? '', address: g.address ?? '', isPrimary: g.is_primary,
});

/** The guardian rows — at least one, exactly one primary. Controlled state, posted alongside the form. */
export function GuardiansEditor({ rows, onChange }: { rows: GuardianDraft[]; onChange: (rows: GuardianDraft[]) => void }) {
  const set = (i: number, patch: Partial<GuardianDraft>) => onChange(rows.map((g, idx) => (idx === i ? { ...g, ...patch } : g)));
  return (
    <div className="stack" style={{ gap: 12 }}>
      {rows.map((g, i) => (
        <div key={i} className="sub-card" style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 8 }}>
          <div className="inline" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <label className="inline" style={{ gap: 6, cursor: 'pointer' }}>
              <input type="radio" name="_primary_guardian" checked={!!g.isPrimary} onChange={() => onChange(rows.map((x, idx) => ({ ...x, isPrimary: idx === i })))} />
              <b>{g.isPrimary ? 'Primary guardian' : 'Make primary'}</b>
              <span className="tiny muted-cell">— receipts and fee reminders go to the primary guardian</span>
            </label>
            {rows.length > 1 ? <button type="button" className="btn sm ghost" onClick={() => {
              const next = rows.filter((_, idx) => idx !== i);
              if (!next.some((x) => x.isPrimary)) next[0] = { ...next[0], isPrimary: true };
              onChange(next);
            }}>Remove</button> : null}
          </div>
          <div className="grid g3">
            <div className="field"><label>Full name *</label><input type="text" required value={g.fullName} onChange={(e) => set(i, { fullName: e.target.value })} /></div>
            <div className="field"><label>Phone *</label><input type="tel" required value={g.phone} onChange={(e) => set(i, { phone: e.target.value })} placeholder="07XX XXX XXX" /></div>
            <div className="field"><label>Relationship</label>
              <select value={g.relationship ?? ''} onChange={(e) => set(i, { relationship: e.target.value })}>
                {GUARDIAN_RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          <div className="grid g3">
            <div className="field"><label>Email</label><input type="email" value={g.email ?? ''} onChange={(e) => set(i, { email: e.target.value })} /></div>
            <div className="field"><label>National ID</label><input type="text" value={g.nationalId ?? ''} onChange={(e) => set(i, { nationalId: e.target.value })} /></div>
            <div className="field"><label>Occupation</label><input type="text" value={g.occupation ?? ''} onChange={(e) => set(i, { occupation: e.target.value })} /></div>
          </div>
        </div>
      ))}
      <div><button type="button" className="btn ghost sm" onClick={() => onChange([...rows, blankGuardian(rows.length === 0)])}>Add another guardian</button></div>
    </div>
  );
}

function StudentFields({ student, lookups, countyId, setCountyId, subCountyId, setSubCountyId }: {
  student?: StudentView | null; lookups: StudentLookups;
  countyId: string; setCountyId: (v: string) => void; subCountyId: string; setSubCountyId: (v: string) => void;
}) {
  const subs = lookups.subCounties.filter((s) => !countyId || String(s.county_id) === countyId);
  return (
    <>
      <div className="grid g3">
        <Field name="first_name" label="First name" required defaultValue={student?.first_name} />
        <Field name="middle_name" label="Middle name" defaultValue={student?.middle_name} />
        <Field name="last_name" label="Last name" required defaultValue={student?.last_name} />
      </div>
      <div className="grid g3">
        <Field name="gender" label="Gender" type="select" defaultValue={student?.gender ?? ''} options={GENDERS.map((g) => ({ value: g, label: g ? g[0] + g.slice(1).toLowerCase() : '—' }))} />
        <Field name="date_of_birth" label="Date of birth" type="date" defaultValue={student?.date_of_birth} />
        <Field name="religion" label="Religion" defaultValue={student?.religion} />
      </div>
      <div className="grid g3">
        <Field name="birth_certificate_no" label="Birth certificate no." defaultValue={student?.birth_certificate_no} />
        <Field name="nemis_upi" label="NEMIS UPI" defaultValue={student?.nemis_upi} uppercase />
        <Field name="admission_date" label="Admission date" type="date" required defaultValue={student?.admission_date ?? today()} />
      </div>
      <div className="grid g3">
        <SearchableSelect name="county_id" label="County" items={lookups.counties} getValue={(c) => String(c.id)} getLabel={(c) => c.name}
          value={countyId} onChange={(v) => { setCountyId(v); setSubCountyId(''); }} placeholder="Search county…" />
        <SearchableSelect name="sub_county_id" label="Sub-county" items={subs} getValue={(c) => String(c.id)} getLabel={(c) => c.name}
          value={subCountyId} onChange={setSubCountyId} placeholder={countyId ? 'Search sub-county…' : 'Pick a county first'} disabled={!countyId} />
        <Field name="address" label="Home address" defaultValue={student?.address} />
      </div>
      <Field name="medical_notes" label="Medical notes / allergies" type="textarea" rows={2} defaultValue={student?.medical_notes} />
    </>
  );
}

/** The admission form — bio-data, placement and guardians in one go; the fee account opens on save. */
export function AdmitStudentForm({ lookups }: { lookups: StudentLookups }) {
  const router = useRouter();
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [countyId, setCountyId] = useState('');
  const [subCountyId, setSubCountyId] = useState('');
  const [streamId, setStreamId] = useState('');
  const [guardians, setGuardians] = useState<GuardianDraft[]>([blankGuardian(true)]);

  const submit = async () => {
    const form = formRef.current;
    if (!form || !form.reportValidity()) return;
    if (!guardians.length) { setError('Add at least one guardian'); return; }
    setBusy(true);
    setError('');
    try {
      const res = await admitStudentRequest(readForm(form), guardians);
      if (!res.ok) { setError(res.error || 'Could not admit the student'); return; }
      toast('Student admitted', `Admission No. ${res.data.admissionNo} — fee account opened.`, 'ok');
      router.push(`/students/view/${res.data.id}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form ref={formRef} onSubmit={(e) => e.preventDefault()}>
      <Card>
        <CardHead title="Student" sub="Bio-data — the Admission No. is issued from the STUDENT No. Series unless you key one" />
        <div className="grid g3">
          <Field name="admission_no" label="Admission no." placeholder="Leave blank to auto-number" uppercase />
          <SearchableSelect name="stream_id" label="Place in class" required items={lookups.streams}
            getValue={(s) => String(s.id)} getLabel={(s) => `${s.grade_level_name} ${s.name} (${s.year_name})`}
            value={streamId} onChange={setStreamId} placeholder="Search grade / class…" emptyText="No classes opened for this year" />
          <div />
        </div>
        <StudentFields lookups={lookups} countyId={countyId} setCountyId={setCountyId} subCountyId={subCountyId} setSubCountyId={setSubCountyId} />
      </Card>
      <Card>
        <CardHead title="Guardians" sub="A guardian already on file with the same name and phone is linked, not duplicated — siblings share a parent" />
        <GuardiansEditor rows={guardians} onChange={setGuardians} />
      </Card>
      <Toolbar>
        <Spacer />
        {error ? <div className="modal-error">{error}</div> : null}
        <button type="button" className="btn ghost" onClick={() => router.push('/students')} disabled={busy}>Cancel</button>
        <button type="button" className="btn" onClick={submit} disabled={busy}>{busy ? 'Admitting…' : 'Admit student'}</button>
      </Toolbar>
    </form>
  );
}

/** The inline edit form on the Student 360's bio-data card. */
export function EditStudentForm({ student, lookups }: { student: StudentView; lookups: StudentLookups }) {
  const { close } = useEditableCard();
  const router = useRouter();
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [countyId, setCountyId] = useState(student.county_id ? String(student.county_id) : '');
  const [subCountyId, setSubCountyId] = useState(student.sub_county_id ? String(student.sub_county_id) : '');
  const [guardians, setGuardians] = useState<GuardianDraft[]>(student.guardians.length ? student.guardians.map(fromView) : [blankGuardian(true)]);

  const submit = async () => {
    const form = formRef.current;
    if (!form || !form.reportValidity()) return;
    setBusy(true);
    setError('');
    try {
      const res = await updateStudentRequest(student.id, readForm(form), guardians);
      if (!res.ok) { setError(res.error || 'Could not save'); return; }
      toast('Student updated', `${student.first_name} ${student.last_name}`, 'ok');
      close();
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form ref={formRef} onSubmit={(e) => e.preventDefault()}>
      <StudentFields student={student} lookups={lookups} countyId={countyId} setCountyId={setCountyId} subCountyId={subCountyId} setSubCountyId={setSubCountyId} />
      <div className="hint" style={{ margin: '12px 0 6px' }}>Guardians</div>
      <GuardiansEditor rows={guardians} onChange={setGuardians} />
      <Toolbar>
        <Spacer />
        {error ? <div className="modal-error">{error}</div> : null}
        <button type="button" className="btn ghost" onClick={close} disabled={busy}>Cancel</button>
        <button type="button" className="btn" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
      </Toolbar>
    </form>
  );
}
