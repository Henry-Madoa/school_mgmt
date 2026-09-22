'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/primitives';
import { readForm } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useToast } from '@/components/ui/toast';
import { saveOrganisation } from '@/app/actions/admin';
import { GlAccountSelect, type GlAccountSelectOption } from '@/components/ui/gl-account-select';
import type { BankAccount, Organisation } from '@/lib/types';

/**
 * School Setup — the school's own operating rules, as opposed to who the school IS (that is
 * Company Information) or how the ledger behaves (General Ledger Setup).
 *
 * The values live on the same `organisation` singleton, so this saves through the same action
 * Company Information does; splitting them is a matter of which screen an administrator goes
 * to, not of where the values are kept.
 */
export function SchoolSetupForm({ org, glAccounts, bankAccounts }: {
  org: Organisation; glAccounts: GlAccountSelectOption[]; bankAccounts: Pick<BankAccount, 'id' | 'code' | 'name'>[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [badDebtRecoveryId, setBadDebtRecoveryId] = useState(String(org.bad_debt_recovery_account_id ?? ''));
  const [mpesaBankId, setMpesaBankId] = useState(String(org.mpesa_bank_account_id ?? ''));

  const save = async () => {
    const form = formRef.current;
    if (!form || !form.reportValidity()) return;
    setBusy(true);
    try {
      const res = await saveOrganisation(readForm(form));
      if (!res.ok) { toast('Could not save', res.error, 'err'); return; }
      toast('School Setup saved', 'The change is live across the system', 'ok');
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form ref={formRef} onSubmit={(e) => { e.preventDefault(); save(); }}>
      <Card>
        <h3>Fee Collections</h3>
        <div className="card-sub">
          Where fee payments arriving through the paybill land, and where a recovery on a fee
          balance already written off is posted.
        </div>
        <div className="grid g2">
          <SearchableSelect id="f_mpesa_bank" name="mpesa_bank_account_id" label="M-Pesa paybill account" items={bankAccounts}
            getValue={(b) => String(b.id)} getLabel={(b) => `${b.code} — ${b.name}`} value={mpesaBankId} onChange={setMpesaBankId}
            placeholder="Search bank/cashbook account…" emptyText="No bank accounts" hint="The bank account holding the paybill float — debited by every M-Pesa fee receipt" />
          <GlAccountSelect name="bad_debt_recovery_account_id" label="Bad debts recovered" accounts={glAccounts}
            value={badDebtRecoveryId} onChange={setBadDebtRecoveryId}
            hint="Credited when a parent pays against a fee balance that was written off" />
        </div>
      </Card>

      <div className="inline" style={{ justifyContent: 'flex-end' }}>
        <button type="submit" className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save School Setup'}</button>
      </div>
    </form>
  );
}
