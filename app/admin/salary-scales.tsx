'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { useRunAction } from '@/components/ui/run-action';
import { useFormat } from '@/components/ui/format-provider';
import { Card, CardHead, EmptyState, Pill, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { Money } from '@/components/ui/money';
import {
  saveSalaryScaleRequest, deleteSalaryScaleRequest, saveScaleBenefitRequest, deleteScaleBenefitRequest, copyScaleBenefitsRequest,
} from '@/app/actions/salaryScales';
import type { HrJobGrade, HrSalaryScaleView, HrSalaryScaleBenefitView, PayrollTransactionCode } from '@/lib/types';

/**
 * Setup Pool → HR & Payroll → Salary Scales (AL Employee Payroll Scales → Salary Scale Pointers →
 * Income/Deduction Configuration). Left: the grades, each with how many notches and employees.
 * Right: the selected grade's ladder — one card per notch showing its Basic Pay, headcount and
 * the earnings/deductions it confers, with the gross package totted up — so a whole grade can be
 * read at a glance and built quickly (define a notch, copy its benefits to the next, adjust).
 */
export function SalaryScalesScreen({ grades, scales, codes, canManage, selectedGradeId }: {
  grades: HrJobGrade[]; scales: HrSalaryScaleView[]; codes: PayrollTransactionCode[]; canManage: boolean; selectedGradeId: number | null;
}) {
  const { cur } = useFormat();
  const gradeId = selectedGradeId && grades.some((g) => g.id === selectedGradeId) ? selectedGradeId : (grades[0]?.id ?? null);
  const grade = grades.find((g) => g.id === gradeId) ?? null;
  const ladder = useMemo(() => scales.filter((s) => s.job_grade_id === gradeId), [scales, gradeId]);
  const packageOf = (s: HrSalaryScaleView) => Number(s.basic_pay_cents)
    + s.benefits.filter((b) => b.transaction_type === 'INCOME').reduce((t, b) => t + Number(b.amount_cents), 0);

  if (!grades.length) {
    return (
      <Card>
        <EmptyState icon="🪜" title="No job grades yet"
          sub={<>Salary scales hang off job grades — create them under <Link href="/admin/pool/hr-payroll/job-grades">Job Grades</Link> first.</>} />
      </Card>
    );
  }

  return (
    <div className="grid split-side-sm">
      <Card>
        <CardHead title="Job grades" sub="Pick a grade to see its salary scale" />
        <TableWrap>
          <tbody>
            {grades.map((g) => {
              const notches = scales.filter((s) => s.job_grade_id === g.id);
              const heads = notches.reduce((t, s) => t + s.employee_count, 0);
              const active = g.id === gradeId;
              return (
                <tr key={g.id} style={active ? { background: 'var(--brand-primary-soft)' } : undefined}>
                  <td>
                    <Link href={`/admin/pool/hr-payroll/salary-scales?grade=${g.id}`} style={{ fontWeight: active ? 600 : 400 }}>
                      <span className="mono">{g.code}</span> {g.name}
                    </Link>
                    <div className="tiny">{notches.length ? `${notches.length} notch${notches.length === 1 ? '' : 'es'} · ${heads} employee${heads === 1 ? '' : 's'}` : 'No scale yet'}</div>
                  </td>
                  <td className="num tiny">{notches.length ? `${cur(Math.min(...notches.map((s) => Number(s.basic_pay_cents))))} – ${cur(Math.max(...notches.map((s) => Number(s.basic_pay_cents))))}` : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Card>

      <div>
        <Toolbar>
          <div>
            <div style={{ fontWeight: 600 }}>{grade ? <><span className="mono">{grade.code}</span> {grade.name}</> : null}</div>
            <div className="tiny">Grade allowances (leave {cur(grade?.leave_allowance_amount ?? 0)} · training {cur(grade?.training_allowance_amount ?? 0)} · overtime {cur(grade?.overtime_allowance_amount ?? 0)}) apply on top of every notch — see Job Grades.</div>
          </div>
          <Spacer />
          {canManage && grade ? <ScaleFormButton gradeId={grade.id} nextSequence={ladder.length + 1}>Add notch</ScaleFormButton> : null}
        </Toolbar>

        {ladder.length ? ladder.map((s) => (
          <Card key={s.id}>
            <CardHead
              title={<><span className="mono">{grade?.code}.{s.code}</span>{s.name ? ` — ${s.name}` : ''}{s.status !== 'ACTIVE' ? <> <Pill tone="warn">Inactive</Pill></> : null}</>}
              sub={`${s.employee_count} employee${s.employee_count === 1 ? '' : 's'} on this notch · gross package ${cur(packageOf(s))} per period`}
            >
              {canManage ? (
                <span className="inline" style={{ gap: 6, flex: 'none', flexWrap: 'nowrap', whiteSpace: 'nowrap', alignSelf: 'center' }}>
                  <BenefitFormButton scale={s} codes={codes} className="btn sm">Add benefit</BenefitFormButton>
                  {ladder.length > 1 ? <CopyBenefitsButton target={s} sources={ladder.filter((x) => x.id !== s.id && x.benefits.length)} /> : null}
                  <ScaleFormButton gradeId={s.job_grade_id} scale={s} className="btn sm ghost">Edit</ScaleFormButton>
                  <DeleteScaleButton id={s.id} disabled={s.employee_count > 0} />
                </span>
              ) : null}
            </CardHead>
            <TableWrap>
              <thead><tr><th>Benefit</th><th>Type</th><th className="num">Amount per period</th><th className="num" /></tr></thead>
              <tbody>
                <tr style={{ fontWeight: 600 }}>
                  <td>Basic pay</td><td><Pill tone="info">Basic</Pill></td>
                  <td className="num"><Money cents={s.basic_pay_cents} /></td>
                  <td className="num tiny muted-cell">from the notch</td>
                </tr>
                {s.benefits.map((b) => (
                  <tr key={b.id}>
                    <td>{b.transaction_name} <span className="tiny mono muted-cell">{b.transaction_code}</span>{b.notes ? <div className="tiny">{b.notes}</div> : null}</td>
                    <td>{b.transaction_type === 'INCOME' ? <Pill tone="ok">Earning</Pill> : <Pill tone="warn">Deduction</Pill>}</td>
                    <td className="num"><Money cents={b.amount_cents} /></td>
                    <td className="num">
                      {canManage ? <>
                        <BenefitFormButton scale={s} codes={codes} benefit={b} className="btn sm ghost">Edit</BenefitFormButton>{' '}
                        <DeleteBenefitButton id={b.id} />
                      </> : null}
                    </td>
                  </tr>
                ))}
                {!s.benefits.length ? <tr><td colSpan={4} className="tiny muted-cell">No earnings or deductions on this notch yet — Add benefit, or copy another notch's.</td></tr> : null}
              </tbody>
            </TableWrap>
          </Card>
        )) : (
          <Card>
            <EmptyState icon="🪜" title={`No salary scale on ${grade?.code ?? 'this grade'} yet`}
              sub="Add the first notch with its basic pay, then the earnings and deductions everyone on it receives. Employees placed on the notch inherit the lot — HR can still adjust an individual afterwards." />
          </Card>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ forms */

function ScaleFormButton({ gradeId, scale, nextSequence, className = 'btn', children }: {
  gradeId: number; scale?: HrSalaryScaleView | null; nextSequence?: number; className?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const s = scale ?? null;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal title={s ? `Edit notch ${s.code}` : 'Add a notch to the scale'} onClose={() => setOpen(false)}
          onSubmit={(v) => saveSalaryScaleRequest({ ...v, id: s?.id ?? '', job_grade_id: gradeId })}
          submitLabel={s ? 'Save changes' : 'Add notch'} successTitle={s ? 'Notch updated' : 'Notch added'}
          successDetail={s ? 'Everyone on the notch now carries the new basic pay.' : undefined}>
          <div className="grid g3">
            <Field name="code" label="Notch" required placeholder="1, 2 … or A, B" defaultValue={s?.code} uppercase
              hint="The step within the grade — printed as GRADE.NOTCH" />
            <Field name="name" label="Name (optional)" placeholder="e.g. Entry, Mid, Senior" defaultValue={s?.name ?? ''} />
            <Field name="sequence" label="Order" type="number" defaultValue={s?.sequence ?? nextSequence ?? 1} hint="Position on the ladder" />
          </div>
          <div className="grid g2">
            <Field name="basic_pay" label="Basic pay per period" type="currency" required defaultValue={s ? (Number(s.basic_pay_cents) / 100).toFixed(2) : ''}
              hint="Set on every employee placed on this notch (and their contract)" />
            <Field name="status" label="Status" type="select" defaultValue={s?.status ?? 'ACTIVE'}
              options={[{ value: 'ACTIVE', label: 'Active — can be assigned' }, { value: 'INACTIVE', label: 'Inactive — kept for history' }]} />
          </div>
        </FormModal>
      ) : null}
    </>
  );
}

function DeleteScaleButton({ id, disabled }: { id: number; disabled: boolean }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className="btn sm ghost" disabled={busy || disabled} title={disabled ? 'Move the employees off this notch first' : undefined}
      onClick={() => run(() => deleteSalaryScaleRequest(id), {
        confirm: { title: 'Delete this notch?', message: 'Its benefits go with it. Refused while any employee is on it.', confirmLabel: 'Delete', danger: true },
        successTitle: 'Notch deleted',
      })}>
      {busy ? 'Working…' : 'Delete'}
    </button>
  );
}

function BenefitFormButton({ scale, codes, benefit, className = 'btn sm', children }: {
  scale: HrSalaryScaleView; codes: PayrollTransactionCode[]; benefit?: HrSalaryScaleBenefitView | null; className?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const b = benefit ?? null;
  const taken = new Set(scale.benefits.map((x) => x.transaction_code_id));
  const choices = codes.filter((c) => c.id === b?.transaction_code_id || !taken.has(c.id));
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal title={b ? `${b.transaction_name} on notch ${scale.code}` : `Add a benefit to notch ${scale.code}`} onClose={() => setOpen(false)}
          onSubmit={(v) => saveScaleBenefitRequest(scale.id, b ? { ...v, transaction_code_id: b.transaction_code_id } : v)}
          submitLabel={b ? 'Save amount' : 'Add benefit'} successTitle={b ? 'Benefit updated' : 'Benefit added'}
          successDetail="Applied to every employee on the notch in the open payroll period.">
          {b ? (
            <div className="field"><label>Benefit</label><input type="text" readOnly value={`${b.transaction_code} — ${b.transaction_name}`} /></div>
          ) : (
            <Field name="transaction_code_id" label="Earning / deduction" type="select" required
              options={[{ value: '', label: 'Choose a transaction code…' }, ...choices.map((c) => ({ value: c.id, label: `${c.code} — ${c.name} (${c.type === 'INCOME' ? 'earning' : 'deduction'})` }))]}
              hint="Statutory and system codes are not offered — the payroll run computes those" />
          )}
          <div className="grid g2">
            <Field name="amount" label="Amount per period" type="currency" required defaultValue={b ? (Number(b.amount_cents) / 100).toFixed(2) : ''} />
            <Field name="notes" label="Notes (optional)" defaultValue={b?.notes ?? ''} placeholder="e.g. Per CBA 2026" />
          </div>
        </FormModal>
      ) : null}
    </>
  );
}

function DeleteBenefitButton({ id }: { id: number }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className="btn sm ghost" disabled={busy}
      onClick={() => run(() => deleteScaleBenefitRequest(id), {
        confirm: { title: 'Remove this benefit from the notch?', message: 'It is also removed from every employee on the notch in the open payroll period.', confirmLabel: 'Remove', danger: true },
        successTitle: 'Benefit removed',
      })}>
      {busy ? 'Working…' : 'Remove'}
    </button>
  );
}

function CopyBenefitsButton({ target, sources }: { target: HrSalaryScaleView; sources: HrSalaryScaleView[] }) {
  const [open, setOpen] = useState(false);
  if (!sources.length) return null;
  return (
    <>
      <button type="button" className="btn sm ghost" onClick={() => setOpen(true)}>Copy benefits from…</button>
      {open ? (
        <FormModal title={`Copy benefits onto notch ${target.code}`} onClose={() => setOpen(false)}
          onSubmit={(v) => copyScaleBenefitsRequest(Number(v.from), target.id)}
          submitLabel="Copy" successTitle="Benefits copied" successDetail="Adjust the amounts that differ on this notch.">
          <Field name="from" label="Copy from notch" type="select" required
            options={[{ value: '', label: 'Choose…' }, ...sources.map((s) => ({ value: s.id, label: `${s.code}${s.name ? ` — ${s.name}` : ''} · ${s.benefits.length} benefit${s.benefits.length === 1 ? '' : 's'}` }))]} />
          <div className="note">Replaces whatever notch {target.code} has now{target.benefits.length ? ` (${target.benefits.length} benefit${target.benefits.length === 1 ? '' : 's'})` : ''}. Employees on the notch follow it.</div>
        </FormModal>
      ) : null}
    </>
  );
}
