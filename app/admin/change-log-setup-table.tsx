'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/toast';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  saveChangeLogSetup, addChangeLogSetupTable, removeChangeLogSetupTable,
} from '@/app/actions/changeLog';
import type { ChangeLogSetup } from '@/lib/types';
import type { ChangeLogTableOption } from '@/lib/changeLog';

type SetupFlag = 'log_insertion' | 'log_modification' | 'log_deletion';

const FLAGS: { field: SetupFlag; label: string }[] = [
  { field: 'log_insertion', label: 'Insertion' },
  { field: 'log_modification', label: 'Modification' },
  { field: 'log_deletion', label: 'Deletion' },
];

/** Nothing is written to the change log for a table until it's checked in here — same as
 *  Business Central's Change Log Setup: opt-in per table, per change type. Which tables can
 *  be opted in comes from the database's own table catalogue (`available`), not a list this
 *  app hardcodes — the admin decides which of those tables actually belong here. */
export function ChangeLogSetupTable({ setup, available }: {
  setup: ChangeLogSetup[];
  available: ChangeLogTableOption[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [picked, setPicked] = useState('');

  const toggle = async (row: ChangeLogSetup, field: SetupFlag) => {
    const key = row.table_name + field;
    setBusy(key);
    try {
      const res = await saveChangeLogSetup(row.table_name, { [field]: row[field] ? 0 : 1 });
      if (!res.ok) { toast('Could not save', res.error, 'err'); return; }
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const add = async () => {
    if (!picked) return;
    setBusy('__add');
    try {
      const res = await addChangeLogSetupTable(picked);
      if (!res.ok) { toast('Could not add table', res.error, 'err'); return; }
      setPicked('');
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const remove = async (row: ChangeLogSetup) => {
    setBusy(row.table_name);
    try {
      const res = await removeChangeLogSetupTable(row.table_name);
      if (!res.ok) { toast('Could not remove table', res.error, 'err'); return; }
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <table>
        <thead>
          <tr>
            <th>Table</th>
            {FLAGS.map((f) => <th key={f.field} style={{ textAlign: 'center' }}>{f.label}</th>)}
            <th />
          </tr>
        </thead>
        <tbody>
          {setup.map((row) => (
            <tr key={row.table_name}>
              <td><b>{row.table_caption}</b></td>
              {FLAGS.map((f) => (
                <td key={f.field} style={{ textAlign: 'center' }}>
                  <input type="checkbox" checked={!!row[f.field]} disabled={busy === row.table_name + f.field}
                    aria-label={`Log ${f.label.toLowerCase()} on ${row.table_caption}`}
                    onChange={() => toggle(row, f.field)} />
                </td>
              ))}
              <td style={{ textAlign: 'center' }}>
                <button type="button" className="btn sm ghost" disabled={busy === row.table_name}
                  aria-label={`Stop tracking ${row.table_caption}`} onClick={() => remove(row)}>×</button>
              </td>
            </tr>
          ))}
          {!setup.length ? (
            <tr><td colSpan={FLAGS.length + 2} className="tiny">No tables are opted into change tracking.</td></tr>
          ) : null}
        </tbody>
      </table>
      <div className="inline" style={{ marginTop: 8 }}>
        <div style={{ flex: 1 }}>
          <SearchableSelect name="pickedTable" ariaLabel="Table to add" disabled={!available.length}
            items={available} getValue={(t) => t.table_name} getLabel={(t) => `${t.table_caption} (${t.table_name})`}
            value={picked} onChange={setPicked}
            placeholder={available.length ? 'Search table…' : 'Every table in the database is already tracked'}
            emptyText="No matching tables" />
        </div>
        <button type="button" className="btn sm" disabled={!picked || busy === '__add'} onClick={add}>
          Add table
        </button>
      </div>
    </>
  );
}
