'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DefinitionList, Pill } from '@/components/ui/primitives';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { Field, MoneyInput, readForm, toTwoDp } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Money } from '@/components/ui/money';
import { useToast } from '@/components/ui/toast';
import { formatDate } from '@/lib/format';
import { PAYMENT_MODES, type ActionResult, type Cents, type FormValues, type PaymentMode, type HrSalaryScaleView } from '@/lib/types';

/** The salary-card fields, as they sit on an employee or on an Employee Editing request. */
export interface PayrollSalaryValues {
  /** Payroll Salary Card "Basic Pay" (cents) — written onto the current contract. */
  basic_pay_cents: Cents;
  /** AL "J-G Steps": the salary-scale notch (within job_grade_id) — sets basic pay and confers benefits. */
  salary_scale_id: number | null;
  job_grade_id: number | null;
  job_grade_name?: string | null;
  posting_group_id: number | null;
  posting_group_code?: string | null;
  posting_group_name?: string | null;
  payment_mode: PaymentMode;
  payroll_currency_code: string | null;
  pays_nssf: boolean;
  pays_shif: boolean;
  pays_paye: boolean;
  payslip_message: string | null;
  suspend_pay: boolean;
  suspension_date: string | null;
  suspension_reasons: string | null;
  stop_relief: boolean;
  insurance_certificate: boolean;
}

/** AL's FlowFields on the card — sums over the employee's posted payroll. */
export interface PayrollCumulatives {
  basicPay: Cents; grossPay: Cents; netPay: Cents; allowances: Cents; deductions: Cents;
}

export interface PayrollSalaryLookups {
  postingGroups: { id: number; code: string; name: string }[];
  currencies: { code: string; description?: string | null }[];
  /** Every salary-scale notch, with benefits — filtered to the chosen job grade in the picker. */
  salaryScales?: HrSalaryScaleView[];
  /** Job grades — chosen first; the notch list follows it. */
  jobGrades?: { id: number; code: string; name: string }[];
}

/**
 * AL Tab52203623 "Payroll Salary Card" as a card: how the employee is paid, the statutory
 * switches, pay suspension and relief flags, with the cumulative figures beneath. Basic pay is
 * shown from the current contract and is not edited here — Contract / Salary Changes owns it.
 *
 * Edited in place, like the cards beside it. Where it is editable is the caller's decision: on
 * a New employee record by whoever may create employees; on an Employee Editing request by HR
 * only — an employee under Self Service sees it read-only, and the server strips these fields
 * from their saves regardless (app/actions/employeeEdits.ts).
 */
export function PayrollSalaryCard({ values: v, basicPay, cumulative, lookups, canEdit, onSave, title = 'Payroll details', sub }: {
  values: PayrollSalaryValues;
  /** The current contract's basic pay, or null when there is no contract yet. */
  basicPay: Cents | null;
  cumulative?: PayrollCumulatives | null;
  lookups: PayrollSalaryLookups;
  canEdit: boolean;
  onSave: (values: FormValues) => Promise<ActionResult<unknown>>;
  title?: string;
  sub?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [postingGroupId, setPostingGroupId] = useState(String(v.posting_group_id ?? ''));
  const [scaleId, setScaleId] = useState(String(v.salary_scale_id ?? ''));
  const [gradeId, setGradeId] = useState(String(v.job_grade_id ?? ''));
  // Basic pay follows the notch the moment one is picked (AL: Salary Scale Pointers → Payroll
  // Salary Card "Basic Pay"); HR may still overtype it before saving.
  const [basicPayRaw, setBasicPayRaw] = useState(((basicPay ?? v.basic_pay_cents) / 100).toFixed(2));
  const [basicFromScale, setBasicFromScale] = useState(false);
  const pickScale = (id: string) => {
    setScaleId(id);
    const s = (lookups.salaryScales ?? []).find((x) => String(x.id) === id);
    if (s) { setBasicPayRaw(toTwoDp(String(Number(s.basic_pay_cents) / 100))); setBasicFromScale(true); }
  };
  // Grade first, then the notch: the notch list is the chosen grade's, and a change of grade
  // drops the notch (a notch belongs to exactly one grade).
  const pickGrade = (id: string) => { setGradeId(id); setScaleId(''); setBasicFromScale(false); };
  const gradeScales = (lookups.salaryScales ?? []).filter((s) => String(s.job_grade_id) === gradeId && (s.status === 'ACTIVE' || s.id === v.salary_scale_id));
  const pickedGrade = (lookups.jobGrades ?? []).find((g) => String(g.id) === gradeId) ?? null;
  const currentScale = (lookups.salaryScales ?? []).find((s) => s.id === v.salary_scale_id) ?? null;
  const pickedScale = (lookups.salaryScales ?? []).find((s) => String(s.id) === scaleId) ?? null;
  const scaleChanged = (pickedScale?.id ?? null) !== (v.salary_scale_id ?? null);
  const [currency, setCurrency] = useState(v.payroll_currency_code ?? '');
  const [suspend, setSuspend] = useState(v.suspend_pay);

  const save = async () => {
    const form = formRef.current;
    if (!form || !form.reportValidity()) return;
    setBusy(true);
    setError('');
    try {
      const res = await onSave(readForm(form));
      if (!res.ok) { setError(res.error || 'Could not save'); return; }
      toast('Payroll details saved', undefined, 'ok');
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const yesNo = (b: boolean) => (b ? <Pill tone="ok">Yes</Pill> : <Pill tone="">No</Pill>);

  return (
    <CollapsibleCard title={title} sub={sub ?? 'Payroll Salary Card — posting group, payment mode, statutory deductions and pay status'}
      actions={canEdit && !editing ? (
        <button type="button" className="btn sm ghost"
          onClick={() => { setPostingGroupId(String(v.posting_group_id ?? '')); setGradeId(String(v.job_grade_id ?? '')); setScaleId(String(v.salary_scale_id ?? '')); setBasicPayRaw(((basicPay ?? v.basic_pay_cents) / 100).toFixed(2)); setBasicFromScale(false); setCurrency(v.payroll_currency_code ?? ''); setSuspend(v.suspend_pay); setEditing(true); }}>
          Edit
        </button>
      ) : null}
    >
      {!editing ? (
        <div className="grid g2 dl-groups">
          <section className="dl-group">
            <div className="dl-caption">Pay &amp; salary scale</div>
            <DefinitionList items={[
              ['Basic pay', <span className="dl-emphasis" key="bp"><Money cents={basicPay ?? v.basic_pay_cents} /> <span className="tiny">per period</span></span>],
              ['Job grade', v.job_grade_name || <span className="tiny muted-cell" key="jg">Not set</span>],
              ['Salary scale', currentScale
                ? <><span className="mono">{currentScale.job_grade_code}.{currentScale.code}</span>{currentScale.name ? ` — ${currentScale.name}` : ''} <span className="tiny">· {currentScale.benefits.length} benefit{currentScale.benefits.length === 1 ? '' : 's'} conferred</span></>
                : <span className="tiny muted-cell">{v.job_grade_id ? 'Off-scale — basic pay and benefits set by hand' : 'No job grade'}</span>],
              ['Payment mode', <span key="pm">{v.payment_mode}</span>],
              ['Currency', v.payroll_currency_code || 'Base currency'],
            ]} />
          </section>
          <section className="dl-group">
            <div className="dl-caption">Posting &amp; statutory</div>
            <DefinitionList items={[
              ['Payroll posting group', v.posting_group_code ? <><span className="mono">{v.posting_group_code}</span>{v.posting_group_name ? ` — ${v.posting_group_name}` : ''}</> : <Pill tone="warn" key="pg">Not set</Pill>],
              ['Statutory deductions', <span className="inline" style={{ flexWrap: 'wrap', gap: 6 }} key="st">
                <Pill tone={v.pays_nssf ? 'ok' : ''}>NSSF {v.pays_nssf ? '✓' : '✗'}</Pill>
                <Pill tone={v.pays_shif ? 'ok' : ''}>SHIF {v.pays_shif ? '✓' : '✗'}</Pill>
                <Pill tone={v.pays_paye ? 'ok' : ''}>PAYE {v.pays_paye ? '✓' : '✗'}</Pill>
              </span>],
              ['Insurance certificate on file', yesNo(v.insurance_certificate)],
              ['Stop personal relief', yesNo(v.stop_relief)],
              ['Payslip message', v.payslip_message || <span className="tiny muted-cell" key="pmsg">None</span>],
              ['Pay suspended', v.suspend_pay ? <Pill tone="bad" key="sp">Suspended{v.suspension_date ? ` since ${formatDate(v.suspension_date)}` : ''}</Pill> : <Pill tone="ok" key="sp">No — included in payroll runs</Pill>],
              v.suspend_pay ? ['Suspension reasons', v.suspension_reasons || '—'] : null,
            ]} />
          </section>
          {cumulative ? (
            <section className="dl-group" style={{ gridColumn: '1 / -1' }}>
              <div className="dl-caption">Cumulative (posted payroll)</div>
              <DefinitionList items={[
                ['Cumulative basic pay', <Money cents={cumulative.basicPay} key="c1" />],
                ['Cumulative gross pay', <Money cents={cumulative.grossPay} key="c2" />],
                ['Cumulative allowances', <Money cents={cumulative.allowances} key="c3" />],
                ['Cumulative deductions', <Money cents={cumulative.deductions} key="c4" />],
                ['Cumulative net pay', <Money cents={cumulative.netPay} key="c5" />],
              ]} />
            </section>
          ) : null}
        </div>
      ) : (
        <>
          <form ref={formRef} onSubmit={(ev) => ev.preventDefault()}>
            <div className="grid g3">
              <SearchableSelect id="f_job_grade_id" name="job_grade_id" label="1. Job grade" items={lookups.jobGrades ?? []}
                getValue={(g) => String(g.id)} getLabel={(g) => `${g.code} — ${g.name}`} value={gradeId} onChange={pickGrade}
                placeholder="Search job grade…" emptyText="No job grades" hint="Choose the grade first" />
              <div className="field">
                <label htmlFor="f_salary_scale_id">2. Salary scale notch</label>
                <select id="f_salary_scale_id" name="salary_scale_id" value={scaleId} onChange={(e) => pickScale(e.target.value)} disabled={!gradeId}>
                  <option value="">{!gradeId ? 'Choose the job grade first' : gradeScales.length ? 'Off-scale — set pay by hand' : `No scale defined on ${pickedGrade?.code ?? 'this grade'}`}</option>
                  {gradeScales.map((s) => (
                    <option key={s.id} value={s.id}>{s.job_grade_code}.{s.code}{s.name ? ` — ${s.name}` : ''} · basic {(Number(s.basic_pay_cents) / 100).toLocaleString()}</option>
                  ))}
                </select>
                <div className="hint">
                  {pickedScale && scaleChanged
                    ? `Inherits basic pay ${(Number(pickedScale.basic_pay_cents) / 100).toLocaleString()} and ${pickedScale.benefits.length} benefit${pickedScale.benefits.length === 1 ? '' : 's'}; lines the previous notch conferred are replaced.`
                    : 'Sets basic pay and confers the notch\'s earnings and deductions — HR can still adjust afterwards.'}
                </div>
              </div>
              <div className="field">
                <label htmlFor="f_basic_pay_cents">Basic pay (per period)<span className="req"> *</span></label>
                <MoneyInput id="f_basic_pay_cents" value={basicPayRaw} onChange={(raw) => { setBasicPayRaw(raw); setBasicFromScale(false); }} required />
                <input type="hidden" name="basic_pay_cents" value={basicPayRaw} />
                <div className="hint">
                  {basicFromScale && pickedScale
                    ? <>Filled from notch {pickedScale.job_grade_code}.{pickedScale.code} — overtype to set a different figure</>
                    : pickedScale && scaleChanged ? 'This figure overrides the notch\'s basic pay' : 'Written onto the current contract, which the payroll run reads'}
                </div>
              </div>
            </div>
            {pickedScale && scaleChanged && pickedScale.benefits.length ? (
              <div className="card inset" style={{ marginBottom: 12 }}>
                <div className="tiny" style={{ marginBottom: 6 }}>Benefits notch {pickedScale.job_grade_code}.{pickedScale.code} will confer:</div>
                <div className="inline" style={{ flexWrap: 'wrap', gap: 6 }}>
                  {pickedScale.benefits.map((b) => (
                    <Pill key={b.id} tone={b.transaction_type === 'INCOME' ? 'ok' : 'warn'}>{b.transaction_name} {(Number(b.amount_cents) / 100).toLocaleString()}</Pill>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="grid g3">
              <Field name="payment_mode" label="Payment mode" type="select" defaultValue={v.payment_mode}
                options={PAYMENT_MODES.map((m) => ({ value: m, label: m }))} />
              <SearchableSelect id="f_posting_group_id" name="posting_group_id" label="Payroll posting group" required
                items={lookups.postingGroups} getValue={(g) => String(g.id)} getLabel={(g) => `${g.code} — ${g.name}`}
                value={postingGroupId} onChange={setPostingGroupId} placeholder="Search posting group…" emptyText="No posting groups" />
              <SearchableSelect id="f_payroll_currency_code" name="payroll_currency_code" label="Currency"
                items={lookups.currencies} getValue={(c) => c.code} getLabel={(c) => `${c.code}${c.description ? ` — ${c.description}` : ''}`}
                value={currency} onChange={setCurrency} placeholder="Base currency" emptyText="No currencies" />
            </div>
            <div className="grid g3">
              <Field name="pays_nssf" label="Pays NSSF" type="checkbox" defaultValue={v.pays_nssf ? 1 : 0} />
              <Field name="pays_shif" label="Pays SHIF" type="checkbox" defaultValue={v.pays_shif ? 1 : 0} />
              <Field name="pays_paye" label="Pays PAYE" type="checkbox" defaultValue={v.pays_paye ? 1 : 0} />
              <Field name="insurance_certificate" label="Insurance certificate on file (insurance relief)" type="checkbox" defaultValue={v.insurance_certificate ? 1 : 0} />
              <Field name="stop_relief" label="Stop personal relief" type="checkbox" defaultValue={v.stop_relief ? 1 : 0} />
            </div>
            <Field name="payslip_message" label="Payslip message" maxLength={100} defaultValue={v.payslip_message ?? ''} placeholder="Printed on the payslip (optional)" />
            <div className="note" style={{ marginTop: 4, marginBottom: 4 }}>Pay suspension</div>
            <Field name="suspend_pay" label="Suspend pay — leave this employee out of payroll runs" type="checkbox" defaultValue={v.suspend_pay ? 1 : 0}
              onChange={(e) => setSuspend((e.target as HTMLInputElement).checked)} />
            {suspend ? (
              <div className="grid g2">
                <Field name="suspension_date" label="Suspension date" type="date" defaultValue={v.suspension_date ?? ''} required />
                <Field name="suspension_reasons" label="Suspension reasons" maxLength={200} defaultValue={v.suspension_reasons ?? ''} required />
              </div>
            ) : null}
          </form>
          <div className="inline" style={{ marginTop: 'var(--sp)' }}>
            {error ? <div className="modal-error">{error}</div> : null}
            <button type="button" className="btn ghost sm" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
            <button type="button" className="btn sm" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </>
      )}
    </CollapsibleCard>
  );
}
