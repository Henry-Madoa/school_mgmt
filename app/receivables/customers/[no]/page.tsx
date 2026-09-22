import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction, requirePage } from '@/lib/session';
import { getCustomer, customerStatistics, getCustomerLedgerEntries } from '@/lib/customers';
import {
  listCustomerPostingGroups, listActivePaymentTerms, listActivePaymentMethods,
  listActiveReminderTerms, listActiveFinanceChargeTerms,
} from '@/lib/receivablesSetup';
import { listActiveCurrencies } from '@/lib/cashMgmtSetup';
import { listDimensionValues } from '@/lib/pool';
import { getDimensionCaptions } from '@/lib/org';
import { Page } from '@/components/layout/page';
import { Card, CardHead, EmptyState, Pill, Stat, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { Money } from '@/components/ui/money';
import { formatDate } from '@/lib/format';
import { CustomerCard, type CustomerLookups } from '../../customer-card';

export default async function CustomerCardPage({ params }: { params: Promise<{ no: string }> }) {
  const user = await requireAction('RECEIVABLES_READ');
  await requirePage('RECEIVABLES_CUSTOMERS');
  const { no } = await params;
  const customer = await getCustomer(no);
  if (!customer) notFound();

  const [
    canManage, stats, entries, postingGroups, paymentTerms, paymentMethods, reminderTerms, finChargeTerms,
    currencies, gd1Values, gd2Values, { caption1, caption2 },
  ] = await Promise.all([
    currentCanAction('RECEIVABLES_CUSTOMER_MANAGE'),
    customerStatistics(customer.id),
    getCustomerLedgerEntries({ customerId: customer.id }),
    listCustomerPostingGroups(),
    listActivePaymentTerms(),
    listActivePaymentMethods(),
    listActiveReminderTerms(),
    listActiveFinanceChargeTerms(),
    listActiveCurrencies(),
    listDimensionValues(1), listDimensionValues(2), getDimensionCaptions(),
  ]);
  const lookups: CustomerLookups = {
    postingGroups, paymentTerms, paymentMethods, reminderTerms, finChargeTerms, currencies,
    globalDimension1Values: gd1Values, globalDimension2Values: gd2Values, caption1, caption2,
  };

  return (
    <Page title={customer.name} crumb={`Customer ${customer.no}`} user={user}>
      <Toolbar>
        <Link href="/receivables" className="btn ghost sm">← All customers</Link>
        <Link href={`/receivables/statement?customer=${encodeURIComponent(customer.no)}`} className="btn ghost sm">Statement</Link>
        <a href="#ledger-entries" className="btn ghost sm">Entries</a>
        <Spacer />
      </Toolbar>

      <div className="grid g4 stack-2">
        <Stat label="Balance" value={<a href="#ledger-entries"><Money cents={stats.balance} decimals={0} /></a>}
          foot={`${stats.ledger_entry_count} ledger entr${stats.ledger_entry_count === 1 ? 'y' : 'ies'}`} />
        <Stat label="Overdue" value={<Money cents={stats.balance_due} decimals={0} />}
          foot={`${stats.overdue_entries} entr${stats.overdue_entries === 1 ? 'y' : 'ies'} past due`} />
        <Stat label="Outstanding orders" value={<Money cents={stats.outstanding_orders} decimals={0} />}
          foot="Ordered but not yet invoiced" />
        <Stat label="Credit limit" value={<Money cents={stats.credit_limit} decimals={0} />}
          foot={stats.credit_limit && stats.balance > stats.credit_limit ? 'Balance is over the limit' : 'Within limit'} />
      </div>

      <CustomerCard customer={customer} lookups={lookups} canEdit={canManage} />

      <Card id="ledger-entries">
        <CardHead title="Customer ledger entries" sub="Every invoice, credit memo and receipt posted against this customer" />
        {entries.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th>Date</th><th>Type</th><th>Document</th><th>Due</th>
                <th className="num">Amount</th><th className="num">Remaining</th><th>Open</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className={e.open ? undefined : 'muted'}>
                  <td>{formatDate(e.posting_date)}</td>
                  <td>{e.document_type}</td>
                  <td className="mono">{e.document_no}</td>
                  <td>{e.due_date ? formatDate(e.due_date) : '—'}</td>
                  <td className="num"><Money cents={e.amount} /></td>
                  <td className="num"><Money cents={e.remaining_amount} /></td>
                  <td>{e.open ? <Pill tone="warn">Open</Pill> : <Pill status="ok">Closed</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="📄" title="Nothing posted against this customer yet" />}
      </Card>
    </Page>
  );
}
