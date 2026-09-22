'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SearchableSelect } from '@/components/ui/searchable-select';
import type { ReportFilters, ReportFilterOptions } from '@/lib/payrollReports';

/**
 * The report request page's filters (AL: the employee / period-transaction filter groups) — as
 * URL parameters, so a filtered report can be bookmarked and prints exactly as shown.
 */
export function ReportFilterBar({ baseHref, filters, options, showCode }: {
  baseHref: string; filters: ReportFilters; options: ReportFilterOptions;
  /** Line-based reports (allowances, deductions, costing …) can also narrow to one transaction code. */
  showCode: boolean;
}) {
  const router = useRouter();
  const [dim1, setDim1] = useState(filters.dim1 ? String(filters.dim1) : '');
  const [dim2, setDim2] = useState(filters.dim2 ? String(filters.dim2) : '');
  const [employee, setEmployee] = useState(filters.employeeId ? String(filters.employeeId) : '');
  const [posting, setPosting] = useState(filters.postingGroupId ? String(filters.postingGroupId) : '');
  const [mode, setMode] = useState(filters.paymentMode ?? '');
  const [code, setCode] = useState(filters.code ?? '');
  const active = [dim1, dim2, employee, posting, mode, showCode ? code : ''].filter(Boolean).length;

  const apply = () => {
    const p = new URLSearchParams();
    if (dim1) p.set('dim1', dim1); if (dim2) p.set('dim2', dim2); if (employee) p.set('employee', employee);
    if (posting) p.set('posting', posting); if (mode) p.set('mode', mode); if (showCode && code) p.set('code', code);
    const q = p.toString();
    router.push(q ? `${baseHref}?${q}` : baseHref);
  };
  const clear = () => { setDim1(''); setDim2(''); setEmployee(''); setPosting(''); setMode(''); setCode(''); router.push(baseHref); };

  return (
    <div className="card inset" style={{ marginBottom: 12 }}>
      <div className="grid g3">
        <SearchableSelect id="rf_dim1" name="rf_dim1" label={options.captions.caption1} items={options.dim1} getValue={(v) => String(v.id)} getLabel={(v) => `${v.code} — ${v.name}`}
          value={dim1} onChange={setDim1} placeholder="All" emptyText="No values" />
        <SearchableSelect id="rf_dim2" name="rf_dim2" label={options.captions.caption2} items={options.dim2} getValue={(v) => String(v.id)} getLabel={(v) => `${v.code} — ${v.name}`}
          value={dim2} onChange={setDim2} placeholder="All" emptyText="No values" />
        <SearchableSelect id="rf_employee" name="rf_employee" label="Employee" items={options.employees} getValue={(e) => String(e.id)} getLabel={(e) => `${e.employee_no} — ${e.name}`}
          value={employee} onChange={setEmployee} placeholder="All employees processed" emptyText="No employees processed" />
        <SearchableSelect id="rf_posting" name="rf_posting" label="Payroll posting group" items={options.postingGroups} getValue={(g) => String(g.id)} getLabel={(g) => `${g.code} — ${g.name}`}
          value={posting} onChange={setPosting} placeholder="All" emptyText="No posting groups" />
        <div className="field">
          <label htmlFor="rf_mode">Payment mode</label>
          <select id="rf_mode" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="">All</option>
            {options.paymentModes.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        {showCode ? (
          <SearchableSelect id="rf_code" name="rf_code" label="Transaction code" items={options.codes} getValue={(c) => c.code} getLabel={(c) => `${c.code} — ${c.name} · ${c.group_text.toLowerCase()}`}
            value={code} onChange={setCode} placeholder="All transactions" emptyText="No transactions in this period" />
        ) : null}
      </div>
      <div className="inline" style={{ marginTop: 4 }}>
        <button type="button" className="btn sm" onClick={apply}>Apply filters</button>
        <button type="button" className="btn sm ghost" onClick={clear} disabled={!active}>Clear</button>
        <span className="tiny">{active ? `${active} filter${active === 1 ? '' : 's'} set — the printout shows them as Applied Filters` : 'No filters — the whole period'}</span>
      </div>
    </div>
  );
}
