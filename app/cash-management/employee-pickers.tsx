'use client';

import { useEffect, useState } from 'react';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useFormat } from '@/components/ui/format-provider';
import { employeeImprestsRequest } from '@/app/actions/imprest';

type EmployeeOption = { id: number; employee_no: string; first_name: string; last_name: string };

/** The employee an Employee receipt is from, or an Employee Payment voucher pays. */
export function EmployeePicker({ id, name, label, employees, value, onChange, required }: {
  id: string; name: string; label: string; employees: EmployeeOption[]; value: string; onChange: (id: string) => void; required?: boolean;
}) {
  return (
    <SearchableSelect id={id} name={name} label={label} required={required} items={employees}
      getValue={(e) => String(e.id)} getLabel={(e) => `${e.employee_no} — ${e.first_name} ${e.last_name}`}
      value={value} onChange={onChange} placeholder="Search employee no. or name…" emptyText="No matching employees" />
  );
}

/**
 * The imprest a line applies to — on a voucher, an approved request waiting to be issued (picking
 * it fills the amount); on a receipt, an issued imprest the money settles.
 */
export function EmployeeImprestPicker({ employeeId, mode, value, onChange, onPickAmount }: {
  employeeId: string; mode: 'issue' | 'settle'; value: string; onChange: (v: string) => void; onPickAmount?: (amount: string) => void;
}) {
  const { cur } = useFormat();
  const [items, setItems] = useState<{ no: string; purpose: string; amount: number }[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (!employeeId) { setItems([]); return; }
    employeeImprestsRequest(Number(employeeId), mode).then((res) => { if (!cancelled && res.ok) setItems(res.data); });
    return () => { cancelled = true; };
  }, [employeeId, mode]);
  return (
    <SearchableSelect name="_imprestPick" ariaLabel="Imprest" items={items} value={value}
      getValue={(i) => i.no} getLabel={(i) => `${i.no} — ${i.purpose} (${cur(i.amount)})`}
      placeholder={employeeId ? (mode === 'issue' ? 'Approved imprest to issue…' : 'Imprest this settles…') : 'Pick the employee first'}
      emptyText={mode === 'issue' ? 'No approved imprest awaiting issue' : 'No issued imprest outstanding'}
      disabled={!employeeId}
      onChange={(v) => {
        onChange(v);
        const it = items.find((i) => i.no === v);
        if (it && onPickAmount) onPickAmount((it.amount / 100).toFixed(2));
      }} />
  );
}
