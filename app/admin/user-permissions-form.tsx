'use client';

import { useEffect, useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Pill } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { useRouter } from 'next/navigation';
import {
  fetchUserPermissionMatrix, saveUserPermissionsRequest, resetUserPermissionsRequest,
  listPermissionTablesAction,
} from '@/app/actions/admin';
import type {
  PermissionRightSet, PermissionTableOption, UserListRow, UserPermissionMatrixRow,
} from '@/lib/types';
import type { PageOption } from './role-form';

const TABLE_RIGHTS = ['read', 'insert', 'modify', 'delete'] as const;
const ALL_RIGHTS = ['read', 'insert', 'modify', 'delete', 'execute'] as const;

export function UserPermissionsButton({ user, pages, className = 'btn sm ghost', children }: {
  user: UserListRow;
  pages: PageOption[];
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? <UserPermissionsModal user={user} pages={pages} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

const rightsEqual = (a: PermissionRightSet, b: PermissionRightSet): boolean =>
  ALL_RIGHTS.every((r) => a[r] === b[r]);

function UserPermissionsModal({ user, pages, onClose }: {
  user: UserListRow; pages: PageOption[]; onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [isSystem, setIsSystem] = useState(false);
  const [grantedSetNames, setGrantedSetNames] = useState<string[]>([]);
  const [rows, setRows] = useState<UserPermissionMatrixRow[]>([]);
  const [tables, setTables] = useState<PermissionTableOption[]>([]);
  const [pickType, setPickType] = useState<'TABLE' | 'PAGE'>('PAGE');
  const [picked, setPicked] = useState('');
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    fetchUserPermissionMatrix(user.id).then((res) => {
      if (res.ok) {
        setIsSystem(res.data.isSystem);
        setGrantedSetNames(res.data.grantedSetNames);
        setRows(res.data.rows);
      } else {
        toast('Could not load permissions', res.error, 'err');
      }
      setLoading(false);
    });
    listPermissionTablesAction().then((res) => { if (res.ok) setTables(res.data); });
  }, [user.id, toast]);

  const used = new Set(rows.map((r) => `${r.objectType}:${r.objectName}`));
  const addOptions = pickType === 'TABLE'
    ? tables.filter((t) => !used.has(`TABLE:${t.name}`)).map((t) => ({ value: t.name, label: t.label }))
    : pages.filter((p) => !used.has(`PAGE:${p.code}`)).map((p) => ({ value: p.code, label: p.label }));

  const addRow = () => {
    if (!picked) return;
    const label = pickType === 'TABLE'
      ? tables.find((t) => t.name === picked)?.label ?? picked
      : pages.find((p) => p.code === picked)?.label ?? picked;
    const blank: PermissionRightSet = { read: false, insert: false, modify: false, delete: false, execute: false };
    setRows((cur) => [...cur, {
      objectType: pickType, objectName: picked, label, granted: { ...blank }, effective: { ...blank }, overridden: false,
    }]);
    setPicked('');
  };

  const toggle = (i: number, right: keyof PermissionRightSet) => {
    setRows((cur) => cur.map((r, idx) => {
      if (idx !== i) return r;
      const effective = { ...r.effective, [right]: !r.effective[right] };
      return { ...r, effective, overridden: !rightsEqual(effective, r.granted) };
    }));
  };

  const doReset = async () => {
    if (!window.confirm(`Remove every permission override for ${user.full_name}? They fall back to their assigned roles.`)) return;
    setResetting(true);
    const res = await resetUserPermissionsRequest(user.id);
    setResetting(false);
    if (!res.ok) { toast('Could not reset', res.error, 'err'); return; }
    toast('Overrides cleared', `${user.full_name} now uses their assigned roles`, 'ok');
    onClose();
    router.refresh();
  };

  const overriddenCount = rows.filter((r) => r.overridden).length;

  return (
    <FormModal
      wide
      title={`Permissions — ${user.full_name}`}
      onClose={onClose}
      onSubmit={() => saveUserPermissionsRequest(user.id, rows.map((r) => ({
        objectType: r.objectType, objectName: r.objectName, rights: r.effective,
      })))}
      submitLabel="Save overrides"
      successTitle="Permissions saved"
      extraFooter={
        !isSystem && !loading ? (
          <button type="button" className="btn ghost" onClick={doReset} disabled={resetting}>
            {resetting ? 'Resetting…' : 'Reset to role defaults'}
          </button>
        ) : null
      }
    >
      {loading ? (
        <div className="tiny muted-cell">Loading…</div>
      ) : isSystem ? (
        <div className="note">
          {user.full_name} holds a System role with unrestricted access to every table and page.
          Per-user permission overrides do not apply.
        </div>
      ) : (
        <>
          <div className="card-sub" style={{ marginBottom: 8 }}>
            Granted by <b>{grantedSetNames.join(' + ')}</b>. Tick or untick a right to override it for
            this user only — a row that differs from what the roles grant is marked
            {' '}<Pill tone="warn">MODIFIED</Pill>.
            {overriddenCount ? ` ${overriddenCount} object${overriddenCount === 1 ? '' : 's'} currently overridden.` : ''}
          </div>

          <div className="inline" style={{ marginBottom: 8 }}>
            <select value={pickType} aria-label="Object type" style={{ width: 92 }}
              onChange={(e) => { setPickType(e.target.value as 'TABLE' | 'PAGE'); setPicked(''); }}>
              <option value="PAGE">Page</option>
              <option value="TABLE">Table</option>
            </select>
            <div style={{ flex: 1 }}>
              <SearchableSelect name="pickObj" ariaLabel="Object to add"
                items={addOptions} getValue={(o) => o.value} getLabel={(o) => o.label}
                value={picked} onChange={setPicked}
                placeholder={pickType === 'TABLE' && !tables.length ? 'Loading tables…' : 'Add an object the roles don’t grant…'}
                emptyText="No matching objects" />
            </div>
            <button type="button" className="btn sm" disabled={!picked} onClick={addRow}>Add</button>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Object</th>
                  <th style={{ width: 52 }}>Read</th>
                  <th style={{ width: 52 }}>Insert</th>
                  <th style={{ width: 52 }}>Modify</th>
                  <th style={{ width: 52 }}>Delete</th>
                  <th style={{ width: 58 }}>Execute</th>
                  <th style={{ width: 84 }}>Granted</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const grantedSummary = ALL_RIGHTS.filter((x) => r.granted[x]).map((x) => x[0].toUpperCase()).join('') || '—';
                  return (
                    <tr key={`${r.objectType}:${r.objectName}`}
                      style={r.overridden ? { boxShadow: 'inset 3px 0 0 var(--warning)' } : undefined}>
                      <td>
                        <Pill tone="info">{r.objectType === 'TABLE' ? 'Table' : 'Page'}</Pill>{' '}
                        {r.label} <span className="tiny mono">({r.objectName})</span>
                        {r.overridden ? <> <Pill tone="warn">MODIFIED</Pill></> : null}
                      </td>
                      {TABLE_RIGHTS.map((right) => (
                        <td key={right} style={{ textAlign: 'center' }}>
                          {r.objectType === 'TABLE' ? (
                            <input type="checkbox" aria-label={`${r.objectName} ${right}`}
                              checked={r.effective[right]} onChange={() => toggle(i, right)} />
                          ) : <span className="tiny">—</span>}
                        </td>
                      ))}
                      <td style={{ textAlign: 'center' }}>
                        {r.objectType === 'PAGE' ? (
                          <input type="checkbox" aria-label={`${r.objectName} execute`}
                            checked={r.effective.execute} onChange={() => toggle(i, 'execute')} />
                        ) : <span className="tiny">—</span>}
                      </td>
                      <td className="tiny mono">{grantedSummary}</td>
                    </tr>
                  );
                })}
                {!rows.length ? (
                  <tr><td colSpan={7} className="tiny">The assigned roles grant nothing. Add an object above to grant this user access.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      )}
    </FormModal>
  );
}
