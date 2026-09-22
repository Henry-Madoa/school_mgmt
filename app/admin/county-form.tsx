'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { Pill, Spacer } from '@/components/ui/primitives';
import { saveCounty } from '@/app/actions/pool';
import { PRODUCT_STATUSES } from '@/lib/constants';
import type { CountyWithUsage, SubCountyWithUsage } from '@/lib/types';

interface SubCountyRow {
  id: number | '';
  code: string;
  name: string;
  status: string;
}

const emptyRow = (): SubCountyRow => ({ id: '', code: '', name: '', status: 'ACTIVE' });

export function CountyFormButton({ county, subCounties, className = 'btn', children }: {
  county?: CountyWithUsage | null;
  /** This county's own sub-counties, seeded into the child grid when editing. */
  subCounties?: SubCountyWithUsage[];
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const c = county ?? null;
  // A brand-new county starts with no sub-counties — only editing an existing
  // one seeds rows, and only the ones it actually has.
  const [rows, setRows] = useState<SubCountyRow[]>(() =>
    (subCounties || []).map((s) => ({ id: s.id, code: s.code ?? '', name: s.name, status: s.status })));

  const update = (i: number, patch: Partial<SubCountyRow>) =>
    setRows((cur) => cur.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  const remove = (i: number) =>
    setRows((cur) => cur.filter((_, k) => k !== i));

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          wide
          title={c ? `Edit ${c.name}` : 'Add a county'}
          onClose={() => setOpen(false)}
          onSubmit={(values) => saveCounty(c ? c.id : null, values, rows)}
          submitLabel="Save"
          successTitle="County saved"
        >
          <div className="grid g3">
            <Field name="code" label="County code" defaultValue={c?.code ?? ''} maxLength={3} placeholder="019"
              hint="The official three-digit code (019 = Nyeri); left blank, the next number is taken" />
            <Field name="name" label="County name" defaultValue={c?.name} required maxLength={60} />
            {c ? (
              <Field name="status" label="Status" type="select" defaultValue={c.status} options={PRODUCT_STATUSES} />
            ) : null}
          </div>

          <table style={{ marginTop: 'calc(var(--sp)*1.5)' }}>
            <thead>
              <tr>
                <th style={{ width: 110 }}>Code</th><th>Sub-county</th><th style={{ width: 140 }}>Status</th><th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <td>
                    <input type="text" value={row.code} aria-label="Sub-county code" maxLength={10} placeholder={c?.code ? `${c.code}-…` : 'auto'}
                      onChange={(e) => update(i, { code: e.target.value })} />
                  </td>
                  <td>
                    <input type="text" value={row.name} aria-label="Sub-county name" maxLength={60}
                      onChange={(e) => update(i, { name: e.target.value })} />
                  </td>
                  <td>
                    <select value={row.status} aria-label="Status"
                      onChange={(e) => update(i, { status: e.target.value })}>
                      {PRODUCT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td>
                    <button type="button" className="btn sm ghost" onClick={() => remove(i)}
                      aria-label="Remove row">×</button>
                  </td>
                </tr>
              ))}
              {!rows.length ? (
                <tr><td colSpan={4} className="tiny">No sub-counties yet.</td></tr>
              ) : null}
            </tbody>
          </table>
          <div className="inline" style={{ marginTop: 10 }}>
            <button type="button" className="btn ghost sm" onClick={() => setRows((cur) => [...cur, emptyRow()])}>
              Add sub-county
            </button>
          </div>
        </FormModal>
      ) : null}
    </>
  );
}

/**
 * A county row in the Setup Pool table, expandable in place to show its
 * sub-counties — an inline child grid
 * accounts: a read-only preview here, actually edited as a grid inside the
 * county's own add/edit form.
 */
export function CountyRow({ county, subCounties }: {
  county: CountyWithUsage;
  subCounties: SubCountyWithUsage[];
}) {
  const [expanded, setExpanded] = useState(false);
  const rows = subCounties.filter((s) => s.county_id === county.id);

  return (
    <>
      <tr>
        <td>
          <button type="button" className="btn sm ghost" aria-expanded={expanded}
            aria-label={expanded ? 'Collapse sub-counties' : 'Expand sub-counties'}
            onClick={() => setExpanded((v) => !v)}>
            {expanded ? '▾' : '▸'}
          </button>{' '}
          <span className="mono">{county.code ?? '—'}</span> <b>{county.name}</b>
        </td>
        <td className="num">{county.sub_counties}</td>
        <td className="num">{county.students}</td>
        <td><Pill status={county.status} /></td>
        <td className="num">
          <CountyFormButton county={county} subCounties={rows} className="btn sm ghost">Edit</CountyFormButton>
        </td>
      </tr>
      {expanded ? (
        <tr>
          <td colSpan={5} style={{ background: 'var(--surface-2)', padding: 0 }}>
            <div style={{ padding: '10px 10px 14px 40px' }}>
              <div className="inline" style={{ marginBottom: 8 }}>
                <span className="tiny">Sub-counties of {county.name}</span>
                <Spacer />
                <CountyFormButton county={county} subCounties={rows} className="btn sm ghost">
                  Manage sub-counties
                </CountyFormButton>
              </div>
              {rows.length ? (
                <table>
                  <thead>
                    <tr><th>Code</th><th>Name</th><th className="num">Students</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => (
                      <tr key={s.id}>
                        <td className="mono">{s.code ?? '—'}</td>
                        <td>{s.name}</td>
                        <td className="num">{s.students}</td>
                        <td><Pill status={s.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <div className="tiny">No sub-counties yet.</div>}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
