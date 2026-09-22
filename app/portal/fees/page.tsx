import Link from 'next/link';
import { requireAction, currentCanAction } from '@/lib/session';
import { feeAccountSummary, feeStatement } from '@/lib/fees/statement';
import { listStudentFeeInvoices } from '@/lib/fees/invoices';
import { listStudentGuardians } from '@/lib/students';
import { formatDate } from '@/lib/format';
import { Card, CardHead, EmptyState, Pill, Stat, TableWrap } from '@/components/ui/primitives';
import { Money } from '@/components/ui/money';
import { loadPortalScope, isPortalScope } from '../context';
import { PortalShell } from '../portal-shell';
import { PayFeesButton } from './pay-button';

export default async function PortalFeesPage({ searchParams }: { searchParams: Promise<{ student?: string }> }) {
  const user = await requireAction('STUDENT_PORTAL_VIEW');
  const { student } = await searchParams;
  const scope = await loadPortalScope(user, student);
  const [fees, statement, invoices, guardians, canPay] = isPortalScope(scope) ? await Promise.all([
    feeAccountSummary(scope.student.id), feeStatement(scope.student.id).catch(() => null), listStudentFeeInvoices(scope.student.id),
    listStudentGuardians(scope.student.id), currentCanAction('STUDENT_PORTAL_PAY'),
  ]) : [null, null, [], [], false];
  const phone = guardians.find((g) => g.is_primary)?.phone ?? guardians[0]?.phone ?? null;
  const paybill = process.env.MPESA_SHORTCODE ?? null;

  return (
    <PortalShell user={user} title="Fees" scope={scope}
      extra={isPortalScope(scope) && canPay && fees ? (
        <>
          <Link href={`/print/fee-statement/${scope.student.id}`} className="btn ghost" target="_blank">Print statement</Link>
          <PayFeesButton studentId={scope.student.id} phone={phone} balance={Number(fees.balance)} paybill={paybill} admissionNo={scope.student.admission_no} />
        </>
      ) : undefined}>
      {isPortalScope(scope) ? (fees ? (
        <>
          <div className="grid g4">
            <Stat label="Balance owing" value={<Money cents={fees.balance} />} foot={fees.overdue > 0 ? <><Money cents={fees.overdue} /> overdue</> : 'Nothing overdue'} accent={fees.balance > 0} />
            <Stat label="Invoiced to date" value={<Money cents={fees.invoiced} />} accent={false} />
            <Stat label="Paid to date" value={<Money cents={fees.paid} />} accent={false} foot={fees.last_payment_date ? `Last paid ${formatDate(fees.last_payment_date)}` : undefined} />
            <Stat label="Next due" value={fees.next_due_date ? formatDate(fees.next_due_date) : '—'} accent={false} foot={paybill ? `Paybill ${paybill} · account ${scope.student.admission_no}` : undefined} />
          </div>
          <Card>
            <CardHead title="Fee invoices" sub="What the school has billed, term by term" />
            {invoices.length ? (
              <TableWrap>
                <thead><tr><th>Invoice</th><th>Term</th><th>Due</th><th className="num">Amount</th><th className="num">Outstanding</th></tr></thead>
                <tbody>
                  {invoices.map((i) => (
                    <tr key={i.id}>
                      <td className="mono">{i.posted_invoice_no}</td>
                      <td>{i.term_name} {i.year_name}</td>
                      <td>{i.due_date ? formatDate(i.due_date) : '—'}</td>
                      <td className="num"><Money cents={i.amount} /></td>
                      <td className="num">{i.remaining_amount > 0 ? <Money cents={i.remaining_amount} /> : <Pill tone="ok">Paid</Pill>}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            ) : <EmptyState icon="🧾" title="No invoices yet" />}
          </Card>
          <Card>
            <CardHead title="Statement" sub="Every invoice and payment on the fee account" />
            {statement && statement.lines.length ? (
              <TableWrap sortable={false}>
                <thead><tr><th>Date</th><th>Document</th><th>Description</th><th className="num">Charged</th><th className="num">Paid</th><th className="num">Balance</th></tr></thead>
                <tbody>
                  {statement.lines.map((l) => (
                    <tr key={l.id}>
                      <td>{formatDate(l.posting_date)}</td>
                      <td className="mono">{l.document_type} {l.document_no}</td>
                      <td>{l.description ?? '—'}</td>
                      <td className="num">{l.amount > 0 ? <Money cents={l.amount} /> : ''}</td>
                      <td className="num">{l.amount < 0 ? <Money cents={-l.amount} /> : ''}</td>
                      <td className="num"><Money cents={l.running_balance} /></td>
                    </tr>
                  ))}
                  <tr><th colSpan={5}>Balance</th><th className="num"><Money cents={statement.closing} /></th></tr>
                </tbody>
              </TableWrap>
            ) : <EmptyState icon="📑" title="Nothing on the statement yet" />}
          </Card>
        </>
      ) : <Card><EmptyState icon="💰" title="No fee account yet" sub="Ask the school office." /></Card>) : null}
    </PortalShell>
  );
}
