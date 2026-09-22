'use client';

import { useState, type ReactNode } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { GlAccountSelect } from '@/components/ui/gl-account-select';
import {
  createFaClassRequest, updateFaClassRequest,
  createFaSubclassRequest, updateFaSubclassRequest,
  createFaLocationRequest, updateFaLocationRequest,
  createMaintenanceRequest, updateMaintenanceRequest,
  createDepreciationBookRequest, updateDepreciationBookRequest,
  createFaPostingGroupRequest, updateFaPostingGroupRequest,
  saveFaSetupRequest,
} from '@/app/actions/fixedAssets';
import type {
  DepreciationBook, FaClass, FaLocation, FaPostingGroupView, FaSetup, FaSubclass, GlAccount, Maintenance,
} from '@/lib/types';

const STATUSES = [{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }];

/* --------------------------------------------------------------------- FA Class */

export function FaClassFormButton({ row, className = 'btn', children }: {
  row?: FaClass | null; className?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const r = row ?? null;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          title={r ? `Edit ${r.code}` : 'Add an FA class'}
          onClose={() => setOpen(false)}
          onSubmit={(v) => (r ? updateFaClassRequest(r.id, v) : createFaClassRequest(v))}
          submitLabel={r ? 'Save changes' : 'Create'}
          successTitle={r ? 'FA class updated' : 'FA class created'}
        >
          <Field name="code" label="Code" required uppercase defaultValue={r?.code} disabled={!!r} placeholder="e.g. EQUIPMENT" />
          <Field name="description" label="Description" required defaultValue={r?.description} />
          {r ? <Field name="status" label="Status" type="select" options={STATUSES} defaultValue={r.status} /> : null}
        </FormModal>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ FA Subclass */

export function FaSubclassFormButton({ row, classes, className = 'btn', children }: {
  row?: FaSubclass | null; classes: FaClass[]; className?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const r = row ?? null;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          title={r ? `Edit ${r.code}` : 'Add an FA subclass'}
          onClose={() => setOpen(false)}
          onSubmit={(v) => (r ? updateFaSubclassRequest(r.id, v) : createFaSubclassRequest(v))}
          submitLabel={r ? 'Save changes' : 'Create'}
          successTitle={r ? 'FA subclass updated' : 'FA subclass created'}
        >
          <Field name="code" label="Code" required uppercase defaultValue={r?.code} disabled={!!r} />
          <Field name="description" label="Description" required defaultValue={r?.description} />
          <Field
            name="fa_class_code" label="FA class" type="select" defaultValue={r?.fa_class_code ?? ''}
            options={[{ value: '', label: '(none)' }, ...classes.map((c) => ({ value: c.code, label: `${c.code} — ${c.description}` }))]}
          />
          {r ? <Field name="status" label="Status" type="select" options={STATUSES} defaultValue={r.status} /> : null}
        </FormModal>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ FA Location */

export function FaLocationFormButton({ row, className = 'btn', children }: {
  row?: FaLocation | null; className?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const r = row ?? null;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          title={r ? `Edit ${r.code}` : 'Add an FA location'}
          onClose={() => setOpen(false)}
          onSubmit={(v) => (r ? updateFaLocationRequest(r.id, v) : createFaLocationRequest(v))}
          submitLabel={r ? 'Save changes' : 'Create'}
          successTitle={r ? 'FA location updated' : 'FA location created'}
        >
          <Field name="code" label="Code" required uppercase defaultValue={r?.code} disabled={!!r} placeholder="e.g. HQ" />
          <Field name="description" label="Description" required defaultValue={r?.description} />
          {r ? <Field name="status" label="Status" type="select" options={STATUSES} defaultValue={r.status} /> : null}
        </FormModal>
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------- Maintenance */

export function MaintenanceFormButton({ row, className = 'btn', children }: {
  row?: Maintenance | null; className?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const r = row ?? null;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          title={r ? `Edit ${r.code}` : 'Add a maintenance code'}
          onClose={() => setOpen(false)}
          onSubmit={(v) => (r ? updateMaintenanceRequest(r.id, v) : createMaintenanceRequest(v))}
          submitLabel={r ? 'Save changes' : 'Create'}
          successTitle={r ? 'Maintenance code updated' : 'Maintenance code created'}
        >
          <Field name="code" label="Code" required uppercase defaultValue={r?.code} disabled={!!r} placeholder="e.g. SERVICE" />
          <Field name="description" label="Description" required defaultValue={r?.description} />
          {r ? <Field name="status" label="Status" type="select" options={STATUSES} defaultValue={r.status} /> : null}
        </FormModal>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------- Depreciation Book */

export function DepreciationBookFormButton({ row, className = 'btn', children }: {
  row?: DepreciationBook | null; className?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const r = row ?? null;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          title={r ? `Edit ${r.code}` : 'Add a depreciation book'}
          onClose={() => setOpen(false)}
          onSubmit={(v) => (r ? updateDepreciationBookRequest(r.id, v) : createDepreciationBookRequest(v))}
          submitLabel={r ? 'Save changes' : 'Create'}
          successTitle={r ? 'Depreciation book updated' : 'Depreciation book created'}
        >
          <Field name="code" label="Code" required uppercase defaultValue={r?.code} disabled={!!r} placeholder="e.g. COMPANY" />
          <Field name="description" label="Description" required defaultValue={r?.description} />
          <Field
            name="default_final_rounding_amount" label="Default final rounding amount" type="currency"
            defaultValue={r ? String(r.default_final_rounding_amount / 100) : '1'}
            hint="A small remainder within this amount is swept up on the last depreciation so the asset lands exactly on its salvage value"
          />
        </FormModal>
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------- FA Posting Group */

const PG_ACCOUNTS: { name: string; label: string; hint: string }[] = [
  { name: 'acquisition_cost_account_id', label: 'Acquisition Cost account', hint: 'Balance-sheet at-cost account' },
  { name: 'accum_depreciation_account_id', label: 'Accum. Depreciation account', hint: 'Balance-sheet contra account' },
  { name: 'depreciation_expense_account_id', label: 'Depreciation Expense account', hint: 'P&L' },
  { name: 'write_down_expense_account_id', label: 'Write-Down Expense account', hint: 'P&L' },
  { name: 'appreciation_account_id', label: 'Appreciation account', hint: 'Revaluation reserve or income' },
  { name: 'maintenance_expense_account_id', label: 'Maintenance Expense account', hint: 'P&L — never part of book value' },
  { name: 'gains_acc_on_disposal_id', label: 'Gains Acc. on Disposal', hint: 'P&L income' },
  { name: 'losses_acc_on_disposal_id', label: 'Losses Acc. on Disposal', hint: 'P&L expense' },
];

export function FaPostingGroupFormButton({ row, accounts, className = 'btn', children }: {
  row?: FaPostingGroupView | null; accounts: GlAccount[]; className?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const r = row ?? null;
  const [ids, setIds] = useState<Record<string, string>>(() =>
    Object.fromEntries(PG_ACCOUNTS.map((a) => [a.name, r ? String((r as unknown as Record<string, number>)[a.name] ?? '') : '']))
  );
  const set = (k: string, v: string) => setIds((prev) => ({ ...prev, [k]: v }));
  return (
    <>
      <button
        type="button" className={className}
        onClick={() => {
          setIds(Object.fromEntries(PG_ACCOUNTS.map((a) => [a.name, r ? String((r as unknown as Record<string, number>)[a.name] ?? '') : ''])));
          setOpen(true);
        }}
      >
        {children}
      </button>
      {open ? (
        <FormModal
          title={r ? `Edit ${r.code}` : 'Add an FA posting group'} wide
          onClose={() => setOpen(false)}
          onSubmit={(v) => (r ? updateFaPostingGroupRequest(r.id, v) : createFaPostingGroupRequest(v))}
          submitLabel={r ? 'Save changes' : 'Create'}
          successTitle={r ? 'FA posting group updated' : 'FA posting group created'}
        >
          <div className="grid g2">
            <Field name="code" label="Code" required uppercase defaultValue={r?.code} disabled={!!r} placeholder="e.g. EQUIPMENT" />
            <Field name="description" label="Description" required defaultValue={r?.description} />
          </div>
          {PG_ACCOUNTS.map((a) => (
            <GlAccountSelect
              key={a.name} name={a.name} label={a.label} required accounts={accounts}
              value={ids[a.name] ?? ''} onChange={(val) => set(a.name, val)} hint={a.hint}
            />
          ))}
        </FormModal>
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------- FA Setup */

export function FaSetupFormButton({ setup, books, groups, className = 'btn', children }: {
  setup: FaSetup; books: DepreciationBook[]; groups: FaPostingGroupView[]; className?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          title="FA Setup"
          onClose={() => setOpen(false)}
          onSubmit={saveFaSetupRequest}
          submitLabel="Save"
          successTitle="FA Setup saved"
        >
          <Field
            name="default_depreciation_book_code" label="Default depreciation book" type="select"
            defaultValue={setup.default_depreciation_book_code ?? ''}
            options={[{ value: '', label: '(none)' }, ...books.map((b) => ({ value: b.code, label: `${b.code} — ${b.description}` }))]}
            hint="Used by the Assets list and the Book Value report when no book is chosen"
          />
          <Field
            name="default_fa_posting_group_code" label="Default FA posting group" type="select"
            defaultValue={setup.default_fa_posting_group_code ?? ''}
            options={[{ value: '', label: '(none)' }, ...groups.map((g) => ({ value: g.code, label: `${g.code} — ${g.description}` }))]}
          />
          <div className="grid g2">
            <Field name="allow_fa_posting_from" label="Allow FA posting from" type="date" defaultValue={setup.allow_fa_posting_from ?? ''} />
            <Field name="allow_fa_posting_to" label="Allow FA posting to" type="date" defaultValue={setup.allow_fa_posting_to ?? ''} />
          </div>
        </FormModal>
      ) : null}
    </>
  );
}
