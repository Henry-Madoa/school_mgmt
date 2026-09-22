'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/toast';
import { switchCompanyRequest } from '@/app/actions/companies';

/** My Settings → Company: pick the company this browser works in (users nobody pinned). */
export function CompanySwitcherForm({ companies, activeCode }: {
  companies: { code: string; display_name: string; is_default: boolean }[]; activeCode: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [code, setCode] = useState(activeCode);
  const [busy, setBusy] = useState(false);
  const apply = async () => {
    setBusy(true);
    try {
      const res = await switchCompanyRequest(code);
      if (!res.ok) { toast('Could not switch', res.error, 'err'); return; }
      toast(`Now working in ${res.data.displayName}`, undefined, 'ok');
      router.push('/dashboard');
      router.refresh();
    } finally { setBusy(false); }
  };
  return (
    <div className="inline form-row" style={{ marginTop: 'calc(var(--sp)*1.5)' }}>
      <div className="field">
        <label htmlFor="f_company">Company</label>
        <select id="f_company" value={code} disabled={busy} onChange={(e) => setCode(e.target.value)}>
          {companies.map((c) => <option key={c.code} value={c.code}>{c.display_name} ({c.code}){c.is_default ? '' : ' — test copy'}</option>)}
        </select>
      </div>
      <button type="button" className="btn" disabled={busy || code === activeCode} onClick={apply}>{busy ? 'Switching…' : 'Switch company'}</button>
    </div>
  );
}
