'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/primitives';
import { Field, readForm } from '@/components/ui/field';
import { GlAccountSelect, type GlAccountSelectOption } from '@/components/ui/gl-account-select';
import { useToast } from '@/components/ui/toast';
import { saveOrganisation } from '@/app/actions/admin';
import { MONTH_NAMES } from '@/lib/constants';
import type { Organisation } from '@/lib/types';

/**
 * General Ledger Setup — Business Central Table 98. The reporting currency, how money and dates
 * are rendered, when the financial year turns over, and the company-wide posting-date window.
 *
 * These were on Company Information, which conflated "who the school is" with "how the ledger
 * behaves"; they are the same `organisation` singleton underneath, so nothing moved in the data.
 */
export function GeneralLedgerSetupForm({ org, accounts }: { org: Organisation; accounts: GlAccountSelectOption[] }) {
  const [imprestControl, setImprestControl] = useState(String(org.imprest_control_account_id ?? ''));
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const form = formRef.current;
    if (!form || !form.reportValidity()) return;
    setBusy(true);
    try {
      const res = await saveOrganisation(readForm(form));
      if (!res.ok) { toast('Could not save', res.error, 'err'); return; }
      toast('General Ledger Setup saved', 'The change is live across the system', 'ok');
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form ref={formRef} onSubmit={(e) => { e.preventDefault(); save(); }}>
      <Card>
        <h3>Approvals</h3>
        <div className="card-sub">
          A receipt at or above this amount has to go through the approval workflow before it can
          be posted. Below it, whoever raised the receipt may post it themselves. Set it to zero
          to require approval for every receipt.
        </div>
        <div className="grid g2">
          <Field name="receipt_approval_limit" label="Receipt approval limit" type="currency"
            defaultValue={String(org.receipt_approval_limit / 100)} />
        </div>
      </Card>
      <Card>
        <h3>Petty cash and imprests</h3>
        <div className="card-sub">
          A petty cash request above the limit has to be raised as an imprest instead. Every imprest
          issued, surrendered, refunded or recovered through payroll posts through the control account,
          which is the employee subledger; the surrender period sets an issued imprest&apos;s due date.
        </div>
        <div className="grid g2">
          <Field name="petty_cash_limit" label="Petty cash limit" type="currency" defaultValue={String(org.petty_cash_limit / 100)}
            hint="Zero means no limit" />
          <Field name="max_outstanding_imprests" label="Max. outstanding imprests per employee" type="number" min={0}
            defaultValue={String(org.max_outstanding_imprests)} hint="Unsurrendered imprests an employee may hold; zero means no limit" />
          <GlAccountSelect id="f_imprestControl" name="imprest_control_account_id" label="Imprest control account" accounts={accounts}
            value={imprestControl} onChange={setImprestControl} hint="The employee subledger — Staff Imprest and Advances" />
          <Field name="imprest_surrender_period" label="Surrender period" defaultValue={org.imprest_surrender_period}
            hint="Date formula from issue to the surrender due date (14D, 2W, 1M)" />
        </div>
      </Card>
      <Card>
        <h3>Currency and locale</h3>
        <div className="card-sub">
          The local currency every ledger figure is kept in, and how amounts and dates are
          rendered across the system and on printed documents.
        </div>
        <div className="grid g2">
          <Field name="currency_code" label="LCY code" defaultValue={org.currency_code} hint="e.g. KES" />
          <Field name="currency_symbol" label="Currency symbol" defaultValue={org.currency_symbol} hint="e.g. KSh" />
          <Field name="locale" label="Number locale" defaultValue={org.locale} hint="e.g. en-KE" />
          <Field name="timezone" label="Timezone" defaultValue={org.timezone} />
        </div>
      </Card>

      <Card>
        <h3>Financial year</h3>
        <div className="card-sub">
          When the accounting year turns over — used by every report that offers a
          &ldquo;this financial year&rdquo; period.
        </div>
        <div className="grid g2">
          <Field name="fy_start_month" label="Financial year starts" type="select"
            defaultValue={org.fy_start_month}
            options={MONTH_NAMES.map((m, i) => ({ value: i + 1, label: m }))} />
          <Field name="fy_start_day" label="on day" type="number" min={1} defaultValue={org.fy_start_day} />
        </div>
      </Card>

      <Card>
        <h3>Posting dates</h3>
        <div className="card-sub">
          The company-wide window a posting&apos;s own value date must fall within — blank means
          unrestricted. A user&apos;s own Posting Setup, if configured (Admin Centre → System
          Security → User Setup), overrides this for that one user.
        </div>
        <div className="grid g2">
          <Field name="allow_posting_from" label="Allow posting from" type="date"
            defaultValue={org.allow_posting_from ?? ''} />
          <Field name="allow_posting_to" label="Allow posting to" type="date"
            defaultValue={org.allow_posting_to ?? ''} />
        </div>
      </Card>

      <div className="inline" style={{ justifyContent: 'flex-end' }}>
        <button type="submit" className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save General Ledger Setup'}</button>
      </div>
    </form>
  );
}
