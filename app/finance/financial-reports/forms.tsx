'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import {
  saveColumnLayoutNameRequest, deleteColumnLayoutNameRequest, saveColumnLayoutLineRequest,
  deleteColumnLayoutLineRequest, duplicateColumnLayoutRequest,
  saveAccScheduleNameRequest, deleteAccScheduleNameRequest, saveAccScheduleLineRequest,
  deleteAccScheduleLineRequest, duplicateAccScheduleNameRequest,
  saveFinancialReportRequest, deleteFinancialReportRequest,
} from '@/app/actions/financialReports';
import type {
  AccScheduleLine, AccScheduleName, ColumnLayout, ColumnLayoutName, FinancialReport, GlAccount,
} from '@/lib/types';

const TOTALING_TYPES = [
  { value: 'POSTING_ACCOUNTS', label: 'Posting Accounts' },
  { value: 'TOTAL_ACCOUNTS', label: 'Total Accounts' },
  { value: 'FORMULA', label: 'Formula' },
  { value: 'SET_BASE_FOR_PERCENT', label: 'Set Base For Percent' },
];
const ROW_TYPES = [
  { value: 'NET_CHANGE', label: 'Net Change (inherit column)' },
  { value: 'BALANCE_AT_DATE', label: 'Balance at Date' },
  { value: 'BEGINNING_BALANCE', label: 'Beginning Balance' },
];
const AMOUNT_TYPES = [
  { value: 'NET_AMOUNT', label: 'Net Amount' },
  { value: 'DEBIT_AMOUNT', label: 'Debit Amount' },
  { value: 'CREDIT_AMOUNT', label: 'Credit Amount' },
];
const ROW_SHOW = [
  { value: 'YES', label: 'Yes' },
  { value: 'NO', label: 'No (compute but hide)' },
  { value: 'IF_ANY_NOT_ZERO', label: 'If any column is non-zero' },
  { value: 'IF_ALL_ZERO', label: 'If every column is zero' },
];
const COLUMN_TYPES = [
  { value: 'NET_CHANGE', label: 'Net Change' },
  { value: 'BALANCE_AT_DATE', label: 'Balance at Date' },
  { value: 'BEGINNING_BALANCE', label: 'Beginning Balance' },
  { value: 'YEAR_TO_DATE', label: 'Year to Date' },
  { value: 'ENTIRE_FISCAL_YEAR', label: 'Entire Fiscal Year' },
  { value: 'FORMULA', label: 'Formula' },
];
const COLUMN_SHOW = [
  { value: 'ALWAYS', label: 'Always' },
  { value: 'NEVER', label: 'Never (hide column)' },
  { value: 'WHEN_POSITIVE', label: 'When positive' },
  { value: 'WHEN_NEGATIVE', label: 'When negative' },
];
const ROUNDING = [
  { value: 'NONE', label: 'None' },
  { value: '1', label: 'Whole units' },
  { value: '1000', label: 'Thousands' },
  { value: '1000000', label: 'Millions' },
];

/** Business Central "A..B|C" account-filter match — a client mirror of lib/gl.ts matchesTotaling,
 *  for the live "N accounts match" hint on the row-line form. */
function matchesTotaling(code: string, totaling: string): boolean {
  if (!totaling) return false;
  return totaling.split('|').map((t) => t.trim()).filter(Boolean).some((term) => {
    const [from, to] = term.split('..');
    return code >= from.trim() && code <= (to ?? from).trim();
  });
}

/** A `<select>` that writes its value to a URL query param and navigates — the run page's
 *  column-layout override. */
export function QuerySelect({ param, value, options, ariaLabel }: {
  param: string;
  value: string;
  options: { value: string; label: string }[];
  ariaLabel: string;
}) {
  const router = useRouter();
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => {
        const url = new URL(window.location.href);
        if (e.target.value) url.searchParams.set(param, e.target.value);
        else url.searchParams.delete(param);
        router.push(`${url.pathname}${url.search}`);
      }}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function DeleteButton({ onConfirm, label = '×', confirmText }: {
  onConfirm: () => Promise<{ ok: boolean; error?: string }>; label?: ReactNode; confirmText: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button" className="btn sm ghost danger" disabled={busy}
      onClick={async () => {
        if (!window.confirm(confirmText)) return;
        setBusy(true);
        const res = await onConfirm();
        setBusy(false);
        if (!res.ok) window.alert(res.error || 'Could not delete');
        else router.refresh();
      }}
    >
      {busy ? '…' : label}
    </button>
  );
}

/* ============================================================ financial report */

export function FinancialReportButton({ report, rowDefs, columnLayouts, className = 'btn', children }: {
  report?: FinancialReport | null;
  rowDefs: AccScheduleName[];
  columnLayouts: ColumnLayoutName[];
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const r = report ?? null;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          title={r ? `Edit ${r.name}` : 'New financial report'}
          onClose={() => setOpen(false)}
          onSubmit={(v) => saveFinancialReportRequest(r?.id ?? null, v)}
          submitLabel={r ? 'Save' : 'Create'} successTitle="Saved"
        >
          <Field name="name" label="Name" required defaultValue={r?.name} disabled={!!r} uppercase
            hint="A short code, e.g. STMT-FIN-POSITION" />
          <Field name="description" label="Description" defaultValue={r?.description ?? ''} />
          <div className="grid g2">
            <Field name="rowGroup" label="Row definition" type="select" required defaultValue={r?.row_group ?? ''}
              options={[{ value: '', label: '…' }, ...rowDefs.map((d) => ({ value: d.name, label: `${d.name} — ${d.description}` }))]} />
            <Field name="columnGroup" label="Column layout" type="select" required defaultValue={r?.column_group ?? ''}
              options={[{ value: '', label: '…' }, ...columnLayouts.map((c) => ({ value: c.name, label: `${c.name} — ${c.description}` }))]} />
          </div>
        </FormModal>
      ) : null}
    </>
  );
}

export function DeleteFinancialReportButton({ name }: { name: string }) {
  return (
    <DeleteButton
      confirmText={`Delete financial report ${name}? The row definition and column layout it uses are kept.`}
      onConfirm={() => deleteFinancialReportRequest(name)}
    />
  );
}

/* ============================================================ row definition (Acc. Schedule Name) */

export function AccScheduleNameButton({ row, columnLayouts, className = 'btn', children }: {
  row?: AccScheduleName | null;
  columnLayouts: ColumnLayoutName[];
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const r = row ?? null;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          title={r ? `Edit ${r.name}` : 'New row definition'}
          onClose={() => setOpen(false)}
          onSubmit={(v) => saveAccScheduleNameRequest(r?.id ?? null, v)}
          submitLabel={r ? 'Save' : 'Create'} successTitle="Saved"
        >
          <Field name="name" label="Name" required defaultValue={r?.name} disabled={!!r} uppercase />
          <Field name="description" label="Description" defaultValue={r?.description ?? ''} />
          <Field name="defaultColumnLayoutName" label="Default column layout" type="select"
            defaultValue={r?.default_column_layout_name ?? ''}
            options={[{ value: '', label: '(none)' }, ...columnLayouts.map((c) => ({ value: c.name, label: c.name }))]} />
        </FormModal>
      ) : null}
    </>
  );
}

export function DeleteAccScheduleNameButton({ name }: { name: string }) {
  return (
    <DeleteButton
      confirmText={`Delete row definition ${name} and all its lines?`}
      onConfirm={() => deleteAccScheduleNameRequest(name)}
    />
  );
}

export function DuplicateAccScheduleNameButton({ name, className = 'btn sm ghost' }: { name: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Duplicate</button>
      {open ? (
        <FormModal title={`Duplicate ${name}`} onClose={() => setOpen(false)}
          onSubmit={(v) => duplicateAccScheduleNameRequest(name, v)} submitLabel="Duplicate" successTitle="Duplicated">
          <Field name="newName" label="New name" required uppercase defaultValue={`${name}-COPY`} />
        </FormModal>
      ) : null}
    </>
  );
}

export function AccScheduleLineButton({ scheduleName, line, rowNos, accounts, className = 'btn', children }: {
  scheduleName: string;
  line?: AccScheduleLine | null;
  rowNos: string[];
  accounts: Pick<GlAccount, 'code' | 'name' | 'account_type'>[];
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const l = line ?? null;
  const [totalingType, setTotalingType] = useState<string>(l?.totaling_type ?? 'POSTING_ACCOUNTS');
  const [totaling, setTotaling] = useState(l?.totaling ?? '');

  const isFormula = totalingType === 'FORMULA';
  const matched = isFormula || !totaling
    ? null
    : accounts.filter((a) => a.account_type === 'POSTING' && matchesTotaling(a.code, totaling));

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          title={l ? `Edit row ${l.row_no}` : 'New row'} wide
          onClose={() => setOpen(false)}
          onSubmit={(v) => saveAccScheduleLineRequest(l?.id ?? null, { ...v, scheduleName })}
          submitLabel={l ? 'Save' : 'Add'} successTitle="Saved"
        >
          <div className="grid g3">
            <Field name="rowNo" label="Row No." required uppercase defaultValue={l?.row_no}
              hint="Identifier for formulas" />
            <Field name="totalingType" label="Totaling type" type="select" defaultValue={totalingType}
              options={TOTALING_TYPES} onChange={(e) => setTotalingType(e.target.value)} />
            <Field name="indentation" label="Indent" type="number" min={0} max={6} defaultValue={String(l?.indentation ?? 0)} />
          </div>
          <Field name="description" label="Description" required defaultValue={l?.description ?? ''} />
          <Field
            name="totaling"
            label={isFormula ? 'Formula (over the other rows, e.g. TINC-TEXP or CORE/TA*100)' : 'Totaling (account filter, e.g. 4000..4099|4110)'}
            defaultValue={l?.totaling ?? ''}
            onChange={(e) => setTotaling(e.target.value)}
            hint={
              isFormula
                ? `Rows available: ${rowNos.filter((r) => r !== l?.row_no).join(', ') || '—'}`
                : matched
                  ? `${matched.length} posting account${matched.length === 1 ? '' : 's'} match${matched.length === 1 ? 'es' : ''}${matched.length ? `: ${matched.slice(0, 6).map((a) => `${a.code} ${a.name}`).join(' · ')}` : ''}`
                  : 'Leave blank for a caption line'
            }
          />
          <div className="grid g3">
            <Field name="rowType" label="Row type" type="select" defaultValue={l?.row_type ?? 'NET_CHANGE'} options={ROW_TYPES} />
            <Field name="amountType" label="Amount type" type="select" defaultValue={l?.amount_type ?? 'NET_AMOUNT'} options={AMOUNT_TYPES} />
            <Field name="show" label="Show" type="select" defaultValue={l?.show ?? 'YES'} options={ROW_SHOW} />
          </div>
          <div className="grid g2">
            <Field name="dimension1Totaling" label="Dimension 1 totaling" defaultValue={l?.dimension_1_totaling ?? ''}
              hint="Global Dimension 1 code filter, e.g. NBI|HQ" />
            <Field name="dimension2Totaling" label="Dimension 2 totaling" defaultValue={l?.dimension_2_totaling ?? ''} />
          </div>
          <div className="inline" style={{ gap: 14, flexWrap: 'wrap' }}>
            <Field name="bold" label="Bold" type="checkbox" defaultValue={l?.bold ? '1' : '0'} />
            <Field name="italic" label="Italic" type="checkbox" defaultValue={l?.italic ? '1' : '0'} />
            <Field name="underline" label="Underline" type="checkbox" defaultValue={l?.underline ? '1' : '0'} />
            <Field name="doubleUnderline" label="Double underline" type="checkbox" defaultValue={l?.double_underline ? '1' : '0'} />
            <Field name="showOppositeSign" label="Opposite sign" type="checkbox" defaultValue={l?.show_opposite_sign ? '1' : '0'} />
            <Field name="newPage" label="New page" type="checkbox" defaultValue={l?.new_page ? '1' : '0'} />
          </div>
        </FormModal>
      ) : null}
    </>
  );
}

export function DeleteAccScheduleLineButton({ id }: { id: number }) {
  return <DeleteButton confirmText="Delete this row?" onConfirm={() => deleteAccScheduleLineRequest(id)} />;
}

/* ============================================================ column layout */

export function ColumnLayoutNameButton({ row, className = 'btn', children }: {
  row?: ColumnLayoutName | null; className?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const r = row ?? null;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          title={r ? `Edit ${r.name}` : 'New column layout'}
          onClose={() => setOpen(false)}
          onSubmit={(v) => saveColumnLayoutNameRequest(r?.id ?? null, v)}
          submitLabel={r ? 'Save' : 'Create'} successTitle="Saved"
        >
          <Field name="name" label="Name" required defaultValue={r?.name} disabled={!!r} uppercase />
          <Field name="description" label="Description" defaultValue={r?.description ?? ''} />
        </FormModal>
      ) : null}
    </>
  );
}

export function DeleteColumnLayoutNameButton({ name }: { name: string }) {
  return (
    <DeleteButton
      confirmText={`Delete column layout ${name} and all its columns?`}
      onConfirm={() => deleteColumnLayoutNameRequest(name)}
    />
  );
}

export function DuplicateColumnLayoutButton({ name, className = 'btn sm ghost' }: { name: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Duplicate</button>
      {open ? (
        <FormModal title={`Duplicate ${name}`} onClose={() => setOpen(false)}
          onSubmit={(v) => duplicateColumnLayoutRequest(name, v)} submitLabel="Duplicate" successTitle="Duplicated">
          <Field name="newName" label="New name" required uppercase defaultValue={`${name}-COPY`} />
        </FormModal>
      ) : null}
    </>
  );
}

export function ColumnLayoutLineButton({ layoutName, line, columnNos, budgets = [], className = 'btn', children }: {
  layoutName: string;
  line?: ColumnLayout | null;
  columnNos: string[];
  /** Budget names a Budget Entries column can read (Finance → Budgets). */
  budgets?: string[];
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const l = line ?? null;
  const [columnType, setColumnType] = useState<string>(l?.column_type ?? 'NET_CHANGE');
  const [ledgerEntryType, setLedgerEntryType] = useState<string>(l?.ledger_entry_type ?? 'ENTRIES');
  const isFormula = columnType === 'FORMULA';
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          title={l ? `Edit column ${l.column_no}` : 'New column'} wide
          onClose={() => setOpen(false)}
          onSubmit={(v) => saveColumnLayoutLineRequest(l?.id ?? null, { ...v, layoutName })}
          submitLabel={l ? 'Save' : 'Add'} successTitle="Saved"
        >
          <div className="grid g2">
            <Field name="columnNo" label="Column No." required uppercase defaultValue={l?.column_no}
              hint="Identifier for formulas" />
            <Field name="columnHeader" label="Header" defaultValue={l?.column_header ?? ''} />
          </div>
          <div className="grid g2">
            <Field name="columnType" label="Column type" type="select" defaultValue={columnType}
              options={COLUMN_TYPES} onChange={(e) => setColumnType(e.target.value)} />
            <Field name="amountType" label="Amount type" type="select" defaultValue={l?.amount_type ?? 'NET_AMOUNT'} options={AMOUNT_TYPES} />
          </div>
          {!isFormula ? (
            <div className="grid g2">
              <Field name="ledgerEntryType" label="Ledger entry type" type="select" defaultValue={l?.ledger_entry_type ?? 'ENTRIES'}
                options={[{ value: 'ENTRIES', label: 'Entries (actuals)' }, { value: 'BUDGET_ENTRIES', label: 'Budget entries' }]}
                onChange={(e) => setLedgerEntryType(e.target.value)} />
              {ledgerEntryType === 'BUDGET_ENTRIES' ? (
                <Field name="budgetName" label="Budget" type="select" required defaultValue={l?.budget_name ?? ''}
                  options={[{ value: '', label: 'Select…' }, ...budgets.map((b) => ({ value: b, label: b }))]} hint="Finance → Budgets" />
              ) : null}
            </div>
          ) : null}
          {isFormula ? (
            <Field name="formula" label="Formula (over the other columns)" required defaultValue={l?.formula ?? ''}
              hint={`Columns available: ${columnNos.filter((c) => c !== l?.column_no).join(', ') || '—'} — e.g. (TY-LY)/LY*100`} />
          ) : (
            <Field name="comparisonDateFormula" label="Comparison date formula" defaultValue={l?.comparison_date_formula ?? ''}
              hint="Date formula — e.g. -1Y for a prior-year column, -1M for prior month" />
          )}
          <div className="grid g2">
            <Field name="show" label="Show" type="select" defaultValue={l?.show ?? 'ALWAYS'} options={COLUMN_SHOW} />
            <Field name="roundingFactor" label="Rounding" type="select" defaultValue={l?.rounding_factor ?? 'NONE'} options={ROUNDING} />
          </div>
        </FormModal>
      ) : null}
    </>
  );
}

export function DeleteColumnLayoutLineButton({ id }: { id: number }) {
  return <DeleteButton confirmText="Delete this column?" onConfirm={() => deleteColumnLayoutLineRequest(id)} />;
}
