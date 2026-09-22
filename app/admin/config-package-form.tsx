'use client';

import { useEffect, useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { saveConfigPackage, getConfigPackageColumns } from '@/app/actions/configPackages';
import type { ConfigPackageColumn, ConfigPackageTableOption, ConfigPackageWithFields } from '@/lib/types';

const humanize = (identifier: string): string => identifier
  .replace(/_id$/, '')
  .replace(/_/g, ' ')
  .replace(/\b\w/g, (c) => c.toUpperCase());

export function ConfigPackageFormButton({ pkg, tables, className = 'btn', children }: {
  pkg?: ConfigPackageWithFields | null;
  /** The live, denylist-filtered table dropdown — fetched once by the Admin Centre page. */
  tables: ConfigPackageTableOption[];
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [tableName, setTableName] = useState(pkg?.table_name ?? '');
  const [columns, setColumns] = useState<ConfigPackageColumn[]>([]);
  const [fields, setFields] = useState<string[]>(() => (pkg?.fields ?? []).map((f) => f.field_name));
  const [keyField, setKeyField] = useState(pkg?.key_field ?? '');
  const [picked, setPicked] = useState('');
  const [loadingColumns, setLoadingColumns] = useState(false);
  const [columnsError, setColumnsError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  // Loads the selected table's columns whenever it changes (or the modal opens on an existing
  // package) — the dropdown only carries table names, not every table's full column set.
  useEffect(() => {
    if (!open || !tableName) { setColumns([]); return; }
    let cancelled = false;
    setLoadingColumns(true);
    setColumnsError(null);
    getConfigPackageColumns(tableName)
      .then((res) => {
        if (cancelled) return;
        if (res.ok) setColumns(res.data);
        else setColumnsError(res.error);
        setLoadingColumns(false);
      })
      // A rejected call (stale action reference, network blip) never reaches actionResult()'s
      // own try/catch — without this, loadingColumns stayed stuck true forever, i.e. the
      // dropdown looked like it just never fetched anything.
      .catch((err) => {
        if (cancelled) return;
        setColumnsError(err instanceof Error ? err.message : 'Could not load columns');
        setLoadingColumns(false);
      });
    return () => { cancelled = true; };
  }, [open, tableName, retryToken]);

  const pickTable = (name: string) => {
    setTableName(name);
    if (name !== pkg?.table_name) { setFields([]); setKeyField(''); }
    setPicked('');
  };

  const remaining = columns.filter((c) => !fields.includes(c.name));
  const labelFor = (name: string) => columns.find((c) => c.name === name)?.label ?? humanize(name);
  const missingRequired = columns.filter((c) => c.required && !fields.includes(c.name));

  const addField = () => {
    if (!picked) return;
    setFields((cur) => [...cur, picked]);
    setPicked('');
  };
  const removeField = (name: string) => {
    setFields((cur) => cur.filter((f) => f !== name));
    if (keyField === name) setKeyField('');
  };

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          wide
          title={pkg ? `Edit package — ${pkg.name}` : 'New configuration package'}
          onClose={() => setOpen(false)}
          onSubmit={(values) => saveConfigPackage(pkg?.code ?? null, values, fields)}
          submitLabel="Save"
          successTitle="Configuration package saved"
        >
          <div className="grid g3">
            {pkg ? (
              <div className="field">
                <label>Code</label>
                <div className="mono" style={{ padding: '6px 0' }}>{pkg.code}</div>
              </div>
            ) : (
              <Field name="code" label="Code" defaultValue="" required maxLength={30} uppercase
                hint="A short unique identifier, e.g. MEMBER-MIGRATE" />
            )}
            <Field name="name" label="Name" defaultValue={pkg?.name} required maxLength={100} />
            {pkg ? (
              <div className="field">
                <label>Table</label>
                <div className="mono" style={{ padding: '6px 0' }}>{pkg.table_name}</div>
              </div>
            ) : (
              <SearchableSelect name="table_name" label="Table" required
                items={tables} getValue={(t) => t.table_name} getLabel={(t) => `${t.label} (${t.table_name})`}
                value={tableName} onChange={pickTable} placeholder="Search table…" emptyText="No matching tables" />
            )}
          </div>

          {tableName ? (
            <>
              <div className="card-sub" style={{ marginTop: 8 }}>
                Fields included in this package's CSV export/import.
              </div>
              <div className="inline" style={{ marginTop: 8 }}>
                <select
                  value={picked} aria-label="Field to add" style={{ flex: 1 }}
                  disabled={loadingColumns} onChange={(e) => setPicked(e.target.value)}
                >
                  <option value="">{loadingColumns ? 'Loading fields…' : 'Select a field…'}</option>
                  {remaining.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.label} ({c.name}){c.relation_table ? ` → ${c.relation_table}` : ''}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn sm" disabled={!picked} onClick={addField}>Add field</button>
              </div>
              {columnsError ? (
                <div className="tiny" style={{ marginTop: 4, color: 'var(--danger)' }}>
                  Could not load this table's columns: {columnsError}{' '}
                  <button type="button" className="link-btn tiny" onClick={() => setRetryToken((n) => n + 1)}>Retry</button>
                </div>
              ) : null}

              <table style={{ marginTop: 10 }}>
                <thead>
                  <tr><th>Field</th><th style={{ width: 110 }}>Key field</th><th style={{ width: 40 }} /></tr>
                </thead>
                <tbody>
                  {fields.map((name) => (
                    <tr key={name}>
                      <td>{labelFor(name)} <span className="tiny mono">({name})</span></td>
                      <td>
                        <input
                          type="radio" name="_key_field_pick" aria-label={`Use ${name} as the key field`}
                          checked={keyField === name} onChange={() => setKeyField(name)}
                        />
                      </td>
                      <td>
                        <button type="button" className="btn sm ghost" onClick={() => removeField(name)}
                          aria-label={`Remove ${name}`}>×</button>
                      </td>
                    </tr>
                  ))}
                  {!fields.length ? (
                    <tr><td colSpan={3} className="tiny">No fields added yet.</td></tr>
                  ) : null}
                </tbody>
              </table>
              <div className="tiny" style={{ marginTop: 4 }}>
                The key field matches an import row to an existing record for update; with no key
                field, every imported row is always inserted as new.
              </div>
              {missingRequired.length ? (
                <div className="tiny" style={{ marginTop: 4, color: 'var(--warning)' }}>
                  {humanize(tableName)} also requires {missingRequired.map((c) => c.label).join(', ')} on any row
                  that inserts as new — a row whose key field doesn't match an existing record (or
                  any row at all, with no key field set) will fail to import unless these are
                  included too.
                </div>
              ) : null}
              <input type="hidden" name="key_field" value={keyField} />
            </>
          ) : null}
        </FormModal>
      ) : null}
    </>
  );
}
