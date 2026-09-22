'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { useRunAction } from '@/components/ui/run-action';
import {
  saveNoSeriesRequest, deleteNoSeriesRequest,
  saveNoSeriesLineRequest, deleteNoSeriesLineRequest,
  assignDocumentNoSeriesRequest,
} from '@/app/actions/noSeries';
import type { NoSeries, NoSeriesLine } from '@/lib/types';

/* --------------------------------------------------------------- series header */

export function NoSeriesFormButton({ row, className = 'btn', children }: {
  row?: NoSeries | null; className?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          title={row ? `No. Series — ${row.code}` : 'New No. Series'}
          onClose={() => setOpen(false)}
          onSubmit={saveNoSeriesRequest}
          submitLabel="Save"
          successTitle="No. Series saved"
        >
          {row ? <input type="hidden" name="originalCode" value={row.code} /> : null}
          <Field name="code" label="Code" defaultValue={row?.code} required disabled={!!row} uppercase
            hint="e.g. LOAN, MEMBER — the identifier the documents draw from" />
          <Field name="description" label="Description" defaultValue={row?.description} required />
          <Field type="checkbox" name="defaultNos" label="Default Nos. — offered automatically on a new document"
            defaultValue={row ? row.default_nos : 1} />
          <Field type="checkbox" name="manualNos" label="Manual Nos. — a user may also type a number by hand"
            defaultValue={row?.manual_nos ?? 0} />
          <Field type="checkbox" name="dateOrder" label="Date Order — numbers must be assigned in document-date order"
            defaultValue={row?.date_order ?? 0} />
        </FormModal>
      ) : null}
    </>
  );
}

export function DeleteNoSeriesButton({ code, className = 'btn sm ghost' }: { code: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => deleteNoSeriesRequest(code), {
        confirm: {
          title: `Delete No. Series ${code}?`,
          message: 'Its lines are removed too. Refused if any document still points at it.',
          confirmLabel: 'Delete',
        },
        successTitle: 'No. Series deleted',
      })}>
      {busy ? 'Working…' : 'Delete'}
    </button>
  );
}

/* ----------------------------------------------------------------- series line */

export function NoSeriesLineFormButton({ seriesCode, row, className = 'btn sm ghost', children }: {
  seriesCode: string; row?: NoSeriesLine | null; className?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          title={row ? `No. Series Line — ${seriesCode}` : `New line — ${seriesCode}`}
          onClose={() => setOpen(false)}
          onSubmit={saveNoSeriesLineRequest}
          submitLabel="Save"
          successTitle="Line saved"
        >
          <input type="hidden" name="seriesCode" value={seriesCode} />
          {row ? <input type="hidden" name="id" value={row.id} /> : null}
          <Field type="date" name="startingDate" label="Starting Date" defaultValue={row?.starting_date ?? ''}
            hint="From when this range applies. Leave blank for “always”." />
          <Field name="startingNo" label="Starting No." defaultValue={row?.starting_no} required uppercase
            hint="First number in the range, e.g. LN000001 — the digits set the zero-padding width" />
          <Field name="endingNo" label="Ending No." defaultValue={row?.ending_no ?? ''} uppercase
            hint="Last number the series may issue (optional)" />
          <Field name="incrementByNo" type="number" label="Increment-by No." min={1} step="1"
            defaultValue={String(row?.increment_by_no ?? 1)} required hint="Step between consecutive numbers" />
          <Field name="warningNo" label="Warning No." defaultValue={row?.warning_no ?? ''} uppercase
            hint="Flag the series as running low once this number is reached (optional)" />
          <Field name="lastNoUsed" label="Last No. Used" defaultValue={row?.last_no_used ?? ''} uppercase
            hint="The most recent number issued. Blank means the next one is the Starting No." />
          <Field type="checkbox" name="allowGaps" label="Allow Gaps in Nos."
            defaultValue={row?.allow_gaps ?? 0} />
        </FormModal>
      ) : null}
    </>
  );
}

export function DeleteNoSeriesLineButton({ id, className = 'btn sm ghost' }: { id: number; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => deleteNoSeriesLineRequest(id), {
        confirm: { title: 'Remove this line?', message: 'A No. Series must keep at least one line.', confirmLabel: 'Remove' },
        successTitle: 'Line removed',
      })}>
      {busy ? '…' : 'Remove'}
    </button>
  );
}

/* -------------------------------------------------- per-document assignment */

/** The inline picker on the Admin Centre → No. Series card — sets which series a document draws
 *  from, BC's "…Nos." setup field. */
export function DocumentSeriesSelect({ documentCode, seriesCode, options }: {
  documentCode: string; seriesCode: string | null;
  options: { code: string; description: string }[];
}) {
  const { run, busy } = useRunAction();
  return (
    <select
      className="inline"
      defaultValue={seriesCode ?? ''}
      disabled={busy}
      onChange={(e) => {
        const v = e.target.value || null;
        run(() => assignDocumentNoSeriesRequest(documentCode, v), { successTitle: 'No. Series updated' });
      }}
    >
      <option value="">— none —</option>
      {options.map((o) => (
        <option key={o.code} value={o.code}>{o.code}{o.description && o.description !== o.code ? ` — ${o.description}` : ''}</option>
      ))}
    </select>
  );
}
