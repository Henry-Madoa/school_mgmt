import { currentCanAction } from '@/lib/session';
import {
  getSalesReceivablesSetup, listCustomerPostingGroups, listPaymentTerms,
  listActiveReminderTerms, listActiveFinanceChargeTerms,
} from '@/lib/receivablesSetup';
import { getPurchasesPayablesSetup, listVendorPostingGroups } from '@/lib/payablesSetup';

import { Card, CardHead, TableWrap } from '@/components/ui/primitives';
import { SalesReceivablesSetupButton } from '@/app/receivables/receivables-forms';
import { PurchasesPayablesSetupButton } from '@/app/payables/payables-forms';

/**
 * The two module setup singletons, as cards.
 *
 * They are reached from two places on purpose: the module's own Setup tab, where someone working
 * in Receivables or Payables expects them, and the Admin Centre's Setup Pool → Finance, where an
 * administrator configuring the system expects every setup screen to be together. One component
 * so the two can never drift.
 */
export async function SalesReceivablesSetupCard() {
  const [setup, postingGroups, paymentTerms, reminderTerms, finChargeTerms, canManage] = await Promise.all([
    getSalesReceivablesSetup(), listCustomerPostingGroups(), listPaymentTerms(),
    listActiveReminderTerms(), listActiveFinanceChargeTerms(), currentCanAction('RECEIVABLES_SETUP_MANAGE'),
  ]);
  return (
    <Card>
      <CardHead
        title="Sales & Receivables Setup"
        sub="Module-wide defaults and the receivables posting-date window"
      >
        {canManage ? (
          <SalesReceivablesSetupButton
            setup={setup} postingGroups={postingGroups} paymentTerms={paymentTerms}
            reminderTerms={reminderTerms} finChargeTerms={finChargeTerms}
          >
            Edit setup
          </SalesReceivablesSetupButton>
        ) : null}
      </CardHead>
      <TableWrap>
        <tbody>
          <tr><td>Default customer posting group</td><td className="mono">{setup.default_customer_posting_group_code ?? '—'}</td></tr>
          <tr><td>Default payment terms</td><td className="mono">{setup.default_payment_terms_code ?? '—'}</td></tr>
          <tr><td>Default reminder terms</td><td className="mono">{setup.default_reminder_terms_code ?? '—'}</td></tr>
          <tr><td>Default fin. charge terms</td><td className="mono">{setup.default_fin_charge_terms_code ?? '—'}</td></tr>
          <tr><td>Credit warnings</td><td>{setup.credit_warnings}</td></tr>
          <tr><td>Allow posting from / to</td><td>{setup.allow_receivables_posting_from ?? '—'} / {setup.allow_receivables_posting_to ?? '—'}</td></tr>
        </tbody>
      </TableWrap>
    </Card>
  );
}

export async function PurchasesPayablesSetupCard() {
  const [setup, postingGroups, paymentTerms, canManage] = await Promise.all([
    getPurchasesPayablesSetup(), listVendorPostingGroups(), listPaymentTerms(),
    currentCanAction('PAYABLES_SETUP_MANAGE'),
  ]);
  return (
    <Card>
      <CardHead
        title="Purchases & Payables Setup"
        sub="Module-wide defaults and the payables posting-date window"
      >
        {canManage ? (
          <PurchasesPayablesSetupButton setup={setup} postingGroups={postingGroups} paymentTerms={paymentTerms}>
            Edit setup
          </PurchasesPayablesSetupButton>
        ) : null}
      </CardHead>
      <TableWrap>
        <tbody>
          <tr><td>Default vendor posting group</td><td className="mono">{setup.default_vendor_posting_group_code ?? '—'}</td></tr>
          <tr><td>Default payment terms</td><td className="mono">{setup.default_payment_terms_code ?? '—'}</td></tr>
          <tr><td>Receipt on Invoice</td><td>{setup.receipt_on_invoice ? 'Yes' : 'No'}</td></tr>
          <tr><td>Allow posting from / to</td><td>{setup.allow_payables_posting_from ?? '—'} / {setup.allow_payables_posting_to ?? '—'}</td></tr>
        </tbody>
      </TableWrap>
    </Card>
  );
}
