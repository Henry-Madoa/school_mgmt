'use client';

import { useEffect, useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Modal } from '@/components/ui/modal';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Pill, EmptyState, TableWrap } from '@/components/ui/primitives';
import { saveRole, listPermissionTablesAction } from '@/app/actions/admin';
import type { PermissionSetLine, PermissionTableOption, RoleWithUsage } from '@/lib/types';
import type { RoleLineInput } from '@/lib/admin';

export interface PageOption {
  code: string;
  label: string;
}

type Right = 'read' | 'insert' | 'modify' | 'delete' | 'execute';

export function RoleFormButton({ role, pages, className = 'btn', children }: {
  role?: RoleWithUsage | null;
  /** The compiled Page catalogue — a fixed list, unlike the table dropdown below. */
  pages: PageOption[];
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? <RoleEditModal role={role ?? null} pages={pages} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function RoleEditModal({ role, pages, onClose }: {
  role: RoleWithUsage | null;
  pages: PageOption[];
  onClose: () => void;
}) {
  const r = role;
  const [tables, setTables] = useState<PermissionTableOption[]>([]);
  const [lines, setLines] = useState<RoleLineInput[]>(() => (r?.lines ?? []).map((l) => ({
    objectType: l.object_type, objectName: l.object_name,
    read: !!l.read_perm, insert: !!l.insert_perm, modify: !!l.modify_perm, delete: !!l.delete_perm, execute: !!l.execute_perm,
  })));
  const [pickType, setPickType] = useState<'TABLE' | 'PAGE'>('TABLE');
  const [picked, setPicked] = useState('');

  // The table dropdown reflects the live database, not a hardcoded list — fetched once
  // when the modal opens, the same lazy-load config-package-form.tsx uses for columns.
  useEffect(() => {
    if (tables.length) return;
    listPermissionTablesAction().then((res) => { if (res.ok) setTables(res.data); });
  }, [tables.length]);

  const used = new Set(lines.map((l) => `${l.objectType}:${l.objectName}`));
  const options = pickType === 'TABLE'
    ? tables.filter((t) => !used.has(`TABLE:${t.name}`)).map((t) => ({ value: t.name, label: t.label }))
    : pages.filter((p) => !used.has(`PAGE:${p.code}`)).map((p) => ({ value: p.code, label: p.label }));

  const addLine = () => {
    if (!picked) return;
    setLines((cur) => [...cur, { objectType: pickType, objectName: picked }]);
    setPicked('');
  };
  const removeLine = (i: number) => setLines((cur) => cur.filter((_, idx) => idx !== i));
  const toggle = (i: number, right: Right) =>
    setLines((cur) => cur.map((l, idx) => (idx === i ? { ...l, [right]: !l[right] } : l)));

  const labelFor = (line: RoleLineInput) => (line.objectType === 'TABLE'
    ? tables.find((t) => t.name === line.objectName)?.label
    : pages.find((p) => p.code === line.objectName)?.label) ?? line.objectName;

  return (
    <FormModal
      wide
      title={r ? `Edit permission set — ${r.name}` : 'Create a permission set'}
      onClose={onClose}
      onSubmit={(values) => saveRole(r ? r.id : null, values, lines)}
      submitLabel={r ? 'Save permission set' : 'Create permission set'}
      successTitle={r ? 'Permission set updated' : 'Permission set created'}
    >
      <div className="grid g2">
        <Field name="name" label="Name" defaultValue={r?.name} required />
        <Field name="description" label="Description" defaultValue={r?.description} />
      </div>
      <Field name="require_two_factor" label="Require two-factor sign-in (authenticator app) for users holding this set" type="checkbox" defaultValue={r?.require_two_factor ? 1 : 0} />

      <div className="card-sub" style={{ marginTop: 8 }}>
        Each line grants rights on one object — a Table (Read/Insert/Modify/Delete) or a
        Page (Execute, i.e. can this screen be reached at all).
      </div>
      <div className="inline" style={{ marginTop: 8 }}>
        <select
          value={pickType} aria-label="Object type" style={{ width: 100 }}
          onChange={(e) => { setPickType(e.target.value as 'TABLE' | 'PAGE'); setPicked(''); }}
        >
          <option value="TABLE">Table</option>
          <option value="PAGE">Page</option>
        </select>
        <div style={{ flex: 1 }}>
          <SearchableSelect name="pickedObject" ariaLabel="Object to add"
            items={options} getValue={(o) => o.value} getLabel={(o) => o.label}
            value={picked} onChange={setPicked}
            placeholder={pickType === 'TABLE' && !tables.length ? 'Loading tables…' : 'Search objects…'}
            emptyText="No matching objects" />
        </div>
        <button type="button" className="btn sm" disabled={!picked} onClick={addLine}>Add line</button>
      </div>

      <table style={{ marginTop: 10 }}>
        <thead>
          <tr>
            <th>Object</th>
            <th style={{ width: 56 }}>Read</th>
            <th style={{ width: 56 }}>Insert</th>
            <th style={{ width: 56 }}>Modify</th>
            <th style={{ width: 56 }}>Delete</th>
            <th style={{ width: 60 }}>Execute</th>
            <th style={{ width: 40 }} />
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => (
            <tr key={`${line.objectType}:${line.objectName}`}>
              <td>
                <Pill tone="info">{line.objectType === 'TABLE' ? 'Table' : 'Page'}</Pill>{' '}
                {labelFor(line)} <span className="tiny mono">({line.objectName})</span>
              </td>
              {(['read', 'insert', 'modify', 'delete'] as const).map((right) => (
                <td key={right} style={{ textAlign: 'center' }}>
                  {line.objectType === 'TABLE' ? (
                    <input type="checkbox" checked={!!line[right]} onChange={() => toggle(i, right)} aria-label={right} />
                  ) : <span className="tiny">—</span>}
                </td>
              ))}
              <td style={{ textAlign: 'center' }}>
                {line.objectType === 'PAGE' ? (
                  <input type="checkbox" checked={!!line.execute} onChange={() => toggle(i, 'execute')} aria-label="execute" />
                ) : <span className="tiny">—</span>}
              </td>
              <td>
                <button type="button" className="btn sm ghost" onClick={() => removeLine(i)} aria-label={`Remove ${line.objectName}`}>×</button>
              </td>
            </tr>
          ))}
          {!lines.length ? (
            <tr><td colSpan={7} className="tiny">No lines yet — this permission set grants no access.</td></tr>
          ) : null}
        </tbody>
      </table>
    </FormModal>
  );
}

/**
 * A permission set row in the list view — Permission Code, description, line
 * count, and assigned-user count. Clicking anywhere on the row (other than the
 * Edit button) opens a read-only card showing the full line-by-line grant.
 */
export function RoleRow({ role, pages }: { role: RoleWithUsage; pages: PageOption[] }) {
  const [viewOpen, setViewOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  return (
    <>
      <tr>
        <td className="mono">
          <button type="button" className="linklike" onClick={() => setViewOpen(true)}>
            <b>{role.name}</b>
          </button>
        </td>
        <td>{role.description || ''}</td>
        <td className="num">{role.is_system ? '—' : role.lines.length}</td>
        <td className="num">{role.userCount}</td>
        <td>{role.is_system ? <Pill>SYSTEM</Pill> : <Pill tone="info">Custom</Pill>}</td>
        <td className="num">
          {role.is_system ? null : (
            <button type="button" className="btn sm ghost" onClick={() => setEditOpen(true)}>Edit</button>
          )}
        </td>
      </tr>
      {viewOpen ? (
        <RoleViewModal
          role={role}
          pages={pages}
          onClose={() => setViewOpen(false)}
          onEdit={role.is_system ? undefined : () => { setViewOpen(false); setEditOpen(true); }}
        />
      ) : null}
      {editOpen ? <RoleEditModal role={role} pages={pages} onClose={() => setEditOpen(false)} /> : null}
    </>
  );
}

function RoleViewModal({ role, pages, onClose, onEdit }: {
  role: RoleWithUsage;
  pages: PageOption[];
  onClose: () => void;
  onEdit?: () => void;
}) {
  const labelFor = (line: PermissionSetLine) => (line.object_type === 'PAGE'
    ? pages.find((p) => p.code === line.object_name)?.label
    : undefined) ?? line.object_name;

  return (
    <Modal
      wide
      title={role.name}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>Close</button>
          {onEdit ? <button type="button" className="btn" onClick={onEdit}>Edit permission set</button> : null}
        </>
      }
    >
      {role.description ? <div className="card-sub" style={{ marginBottom: 'calc(var(--sp)*2)' }}>{role.description}</div> : null}
      <div className="tiny" style={{ marginBottom: 12 }}>
        {role.userCount} user(s) · {role.is_system ? 'access to all objects' : `${role.lines.length} line(s)`}
      </div>
      {role.is_system ? (
        <Pill>Full access to every table and page</Pill>
      ) : role.lines.length ? (
        <TableWrap>
          <thead>
            <tr>
              <th>Object</th>
              <th style={{ width: 56 }}>Read</th>
              <th style={{ width: 56 }}>Insert</th>
              <th style={{ width: 56 }}>Modify</th>
              <th style={{ width: 56 }}>Delete</th>
              <th style={{ width: 60 }}>Execute</th>
            </tr>
          </thead>
          <tbody>
            {role.lines.map((l) => (
              <tr key={`${l.object_type}:${l.object_name}`}>
                <td>
                  <Pill tone="info">{l.object_type === 'TABLE' ? 'Table' : 'Page'}</Pill>{' '}
                  {labelFor(l)} <span className="tiny mono">({l.object_name})</span>
                </td>
                {(['read_perm', 'insert_perm', 'modify_perm', 'delete_perm'] as const).map((f) => (
                  <td key={f} style={{ textAlign: 'center' }}>
                    {l.object_type === 'TABLE'
                      ? <input type="checkbox" checked={!!l[f]} disabled aria-label={f} />
                      : <span className="tiny">—</span>}
                  </td>
                ))}
                <td style={{ textAlign: 'center' }}>
                  {l.object_type === 'PAGE'
                    ? <input type="checkbox" checked={!!l.execute_perm} disabled aria-label="execute" />
                    : <span className="tiny">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : <EmptyState icon="🔒" title="No lines yet" sub="This permission set grants no access." />}
    </Modal>
  );
}
