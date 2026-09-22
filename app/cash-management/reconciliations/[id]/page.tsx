import { notFound } from 'next/navigation';
import { requireAction, currentCanAction, requirePage } from '@/lib/session';
import { getBankReconciliationDetail } from '@/lib/bankMgmt';
import { listPostableAccounts } from '@/lib/gl';
import { Page } from '@/components/layout/page';
import { Card, CardHead, EmptyState, Pill, TableWrap } from '@/components/ui/primitives';
import { Money } from '@/components/ui/money';
import { formatDate } from '@/lib/format';
import {
  SuggestLinesButton, MatchLineButton, AddAdjustmentButton, DeleteRecLineButton, PostReconciliationButton,
} from '../../reconciliation-actions';

export default async function ReconciliationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAction('CASH_MGMT_READ');
  await requirePage('CASH_MGMT_RECONCILIATIONS');
  const { id } = await params;
  const detail = await getBankReconciliationDetail(Number(id));
  if (!detail) notFound();
  const [canManage, accounts] = await Promise.all([
    currentCanAction('CASH_MGMT_RECONCILE'), listPostableAccounts(),
  ]);
  const { reconciliation: rec, bankAccount, lines, appliedTotal, adjustmentTotal, totalBalance, difference } = detail;
  const open = rec.status === 'OPEN';

  return (
    <Page title={`Reconciliation ${rec.statement_no ?? rec.id}`} crumb={`Cash Management → ${bankAccount.code}`} user={user}>
      <Card>
        <CardHead title={`${bankAccount.code} — ${bankAccount.name}`} sub={`Statement date ${formatDate(rec.statement_date)}`}>
          <Pill status={open ? 'warn' : 'ok'}>{rec.status}</Pill>
        </CardHead>
        <TableWrap>
          <tbody>
            <tr><td>Balance last statement</td><td><Money cents={rec.balance_last_statement} /></td></tr>
            <tr><td>Statement ending balance</td><td><Money cents={rec.statement_balance} /></td></tr>
            <tr><td>Matched ledger entries</td><td><Money cents={appliedTotal} /></td></tr>
            <tr><td>G/L adjustments</td><td><Money cents={adjustmentTotal} /></td></tr>
            <tr><td>Reconciled balance</td><td><Money cents={totalBalance} /></td></tr>
            <tr><td>Difference</td><td>{difference === 0 ? <Pill status="ok">Balanced</Pill> : <span className="bad"><Money cents={difference} /></span>}</td></tr>
          </tbody>
        </TableWrap>
      </Card>
      <Card>
        <CardHead title="Lines">
          {open && canManage ? (<><SuggestLinesButton id={rec.id} /><AddAdjustmentButton id={rec.id} accounts={accounts} /></>) : null}
        </CardHead>
        {lines.length ? (
          <TableWrap>
            <thead><tr><th>Type</th><th>Date</th><th>Document</th><th>Description</th><th className="num">Amount</th><th /></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.type === 'G/L Adjustment' ? `G/L ${l.gl_account_code ?? ''}` : 'Ledger entry'}</td>
                  <td>{l.transaction_date ? formatDate(l.transaction_date) : '—'}</td>
                  <td className="mono muted-cell">{l.document_no ?? '—'}</td>
                  <td>{l.description ?? '—'}</td>
                  <td className="num"><Money cents={l.statement_amount || l.applied_amount} /></td>
                  <td className="num">
                    <div className="inline" style={{ justifyContent: 'flex-end' }}>
                      {open && canManage && l.type === 'Bank Account Ledger Entry' ? <MatchLineButton lineId={l.id} applied={!!l.applied} /> : null}
                      {open && canManage ? <DeleteRecLineButton lineId={l.id} /> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="✔" title="No lines — use Suggest lines" />}
      </Card>
      {open && canManage ? (
        <div className="inline"><PostReconciliationButton id={rec.id} difference={difference} /></div>
      ) : null}
    </Page>
  );
}
