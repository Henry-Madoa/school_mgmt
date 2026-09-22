'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useRunAction } from '@/components/ui/run-action';
import { applyDateFormula, isValidDateFormula } from '@/lib/dateFormula';
import {
  runPayrollForEmployeeRequest, runPayrollForPeriodRequest, addEmployeeTransactionRequest,
  removeEmployeeTransactionRequest, stopEmployeeTransactionRequest,
} from '@/app/actions/payroll';
import type { PayrollTransactionCode } from '@/lib/types';

export function RunForEmployeeButton({ periodId, employeeId, className = 'btn sm' }: { periodId: number; employeeId: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => runPayrollForEmployeeRequest(periodId, employeeId), {
        confirm: { title: 'Run payroll for this employee?', message: 'Re-computes their payslip lines for the open period. Safe to re-run.', confirmLabel: 'Run' },
        successTitle: 'Payroll computed',
      })}>
      {busy ? 'Working…' : 'Process'}
    </button>
  );
}

export function RunForPeriodButton({ periodId, className = 'btn' }: { periodId: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => runPayrollForPeriodRequest(periodId), {
        confirm: { title: 'Process payroll for every eligible employee?', message: 'Re-computes payslip lines for every Active/On Leave employee with a posting group set.', confirmLabel: 'Process payroll' },
        successTitle: (d) => `Processed ${d.processed} employee(s)`,
        successDetail: (d) => (d.failed.length ? `${d.failed.length} failed — check each employee's card for details` : undefined),
      })}>
      {busy ? 'Working…' : 'Process payroll'}
    </button>
  );
}

export function AddTransactionButton({ employeeId, periodId, periodStart, codes, className = 'btn sm' }: {
  employeeId: number; periodId: number;
  /** The open period's first day — where a window with no start date begins. */
  periodStart?: string;
  codes: PayrollTransactionCode[]; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  // BC date formula ("1M", "4W", "10D", "1Y", "6M-1D" …): the end date is worked out from the
  // start date (or the open period's first day) and lands in the End date field, which the user
  // can still overtype. Blank clears nothing typed by hand.
  const [duration, setDuration] = useState('');
  const durationValid = !duration.trim() || isValidDateFormula(duration.trim());
  const applyDuration = (formula: string, from: string) => {
    setDuration(formula);
    const base = from || periodStart || '';
    if (!formula.trim() || !base || !isValidDateFormula(formula.trim())) return;
    // "1M" from the 1st reaches the 1st of next month; the window closes the day before, so a
    // one-month line runs exactly one period.
    const end = applyDateFormula(applyDateFormula(base, formula.trim()), '-1D');
    setEndDate(end >= base ? end : base);
  };
  // Mirrors lib/payroll.ts periodsInWindow: months from the effective start to the end, inclusive.
  const autoPeriods = (() => {
    if (!endDate) return null;
    const from = startDate && (!periodStart || startDate > periodStart) ? startDate : (periodStart || startDate || endDate);
    const a = new Date(from + 'T00:00:00Z'); const b = new Date(endDate + 'T00:00:00Z');
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return null;
    return Math.max(1, (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + 1);
  })();
  const [codeId, setCodeId] = useState('');
  const pickedCode = codes.find((c) => String(c.id) === codeId) ?? null;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Add line</button>
      {open ? (
        <FormModal
          title="Add earnings / deduction line" wide
          onClose={() => setOpen(false)}
          onSubmit={(values) => addEmployeeTransactionRequest({
            employeeId, periodId, transactionCodeId: Number(values.transactionCodeId),
            amountCents: Math.round(Number(values.amountCents || 0) * 100),
            originalAmountCents: values.originalAmountCents ? Math.round(Number(values.originalAmountCents) * 100) : undefined,
            temporary: !!Number(values.temporary), notes: values.notes ? String(values.notes) : undefined,
            startDate: values.startDate ? String(values.startDate) : null, endDate: values.endDate ? String(values.endDate) : null,
          })}
          submitLabel="Add"
          successTitle="Line added"
        >
          <h4 className="section-title" style={{ marginTop: 0 }}>What</h4>
          <div className="grid g3">
            {/* One line per code per period (AL's key) — codes already on the employee are not offered. */}
            <SearchableSelect id="f_transactionCodeId" name="transactionCodeId" label="Transaction code" required
              items={codes} getValue={(c) => String(c.id)} getLabel={(c) => `${c.code} — ${c.name}${c.type === 'INCOME' ? ' · earning' : c.type === 'DEDUCTION' ? ' · deduction' : ' · company deduction'}${c.is_formula ? ' (formula)' : ''}`}
              value={codeId} onChange={setCodeId} placeholder="Search by code or name…" emptyText="No matching codes — or the employee already has them all" />
            {/* A formula code's amount is the run's to compute — the field is locked (a disabled Field
                still posts its value). Only a Higher/Lower preference needs a figure to compare with. */}
            {pickedCode?.is_formula && pickedCode.amount_preference === 'FORMULA' ? (
              <Field key="amount-formula" name="amountCents" label="Amount per period" type="currency" disabled defaultValue={0}
                placeholder="Computed by formula" hint={`Computed each run as ${pickedCode.formula}`} />
            ) : (
              <Field key="amount-typed" name="amountCents" label={pickedCode?.is_formula ? `Amount to compare (${pickedCode.amount_preference === 'HIGHER' ? 'higher' : 'lower'} of the two applies)` : 'Amount per period'}
                type="currency" required
                hint={pickedCode?.is_formula ? `The run computes ${pickedCode.formula} and takes the ${pickedCode.amount_preference === 'HIGHER' ? 'higher' : 'lower'} of that and this amount` : undefined} />
            )}
            <Field name="originalAmountCents" label="Original amount" type="currency" hint="Reducing-balance codes only (e.g. a loan's principal)" />
          </div>

          <h4 className="section-title">When</h4>
          <div className="note" style={{ marginBottom: 10 }}>
            Leave both dates blank and the line runs every period until it is stopped. Give an end date — or a
            start date and a duration — and it runs for that window only, ceasing after the end date.
          </div>
          <div className="grid g3">
            <Field name="startDate" label="Start date" type="date" placeholder="From this period"
              hint="Blank — from this period"
              onChange={(e) => { setStartDate(e.target.value); if (duration) applyDuration(duration, e.target.value); }} />
            <div className="field">
              <label htmlFor="f_duration">Duration</label>
              <input id="f_duration" type="text" value={duration} placeholder="1M · 4W · 10D · 1Y"
                onChange={(e) => applyDuration(e.target.value, startDate)}
                style={!durationValid ? { borderColor: 'var(--danger)' } : undefined} />
              <div className="hint">{durationValid ? 'Date formula — sets the end date' : 'Use D, W, M, Q or Y — e.g. 6M'}</div>
            </div>
            <div className="field">
              <label htmlFor="f_endDate">End date</label>
              <input id="f_endDate" type="date" name="endDate" value={endDate} onChange={(e) => { setEndDate(e.target.value); setDuration(''); }} />
              <div className="hint">Blank — until stopped</div>
            </div>
          </div>
          <div className="grid g2">
            {/* Derived from the dates, never typed: an end date fixes it, no end date means indefinite. */}
            <div className="field">
              <label htmlFor="f_noOfPeriods">Runs for</label>
              <input id="f_noOfPeriods" type="text" readOnly
                value={autoPeriods != null ? `${autoPeriods} period${autoPeriods === 1 ? '' : 's'}` : 'Indefinite — until stopped'} />
              <div className="hint">Worked out from the dates</div>
            </div>
            <div className="field">
              <label>Roll-forward</label>
              <Field name="temporary" label="One-off — this period only, does not roll forward" type="checkbox" />
            </div>
          </div>

          <h4 className="section-title">Notes</h4>
          <Field name="notes" label="Notes" placeholder="Optional — why this line exists" />
        </FormModal>
      ) : null}
    </>
  );
}

export function StopTransactionButton({ id, stopped, className = 'btn sm ghost' }: { id: number; stopped: boolean; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => stopEmployeeTransactionRequest(id, !stopped), {
        confirm: { title: stopped ? 'Resume this line?' : 'Stop this line?', confirmLabel: stopped ? 'Resume' : 'Stop' },
        successTitle: stopped ? 'Resumed' : 'Stopped',
      })}>
      {busy ? '…' : (stopped ? 'Resume' : 'Stop')}
    </button>
  );
}

export function RemoveTransactionButton({ id, className = 'btn sm ghost' }: { id: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => removeEmployeeTransactionRequest(id), {
        confirm: { title: 'Remove this line?', message: 'Only while the period is Open.', confirmLabel: 'Remove' },
        successTitle: 'Removed',
      })}>
      {busy ? '…' : 'Remove'}
    </button>
  );
}
