import { notFound } from 'next/navigation';
import { requireAction, currentCanAction, requirePage } from '@/lib/session';
import { getPaymentVoucher } from '@/lib/paymentVouchers';
import { getWhtCertificatesForVoucher } from '@/lib/whtCertificate';
import { Page } from '@/components/layout/page';
import { Card, CardHead, Pill, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { Money } from '@/components/ui/money';
import {
  SubmitButton, CancelApprovalButton, ApproveButton, RejectButton, ReopenButton, DeleteButton, PostPvButton,
} from '../../document-actions';
import { PaymentVoucherCard } from '../../payment-voucher-card';
import { docFormProps } from '../../doc-form-props';

export const dynamic = 'force-dynamic';

export default async function PvDetailPage({ params }: { params: Promise<{ no: string }> }) {
  const user = await requireAction('CASH_MGMT_READ');
  await requirePage('CASH_MGMT_PAYMENT_VOUCHERS');
  const { no } = await params;
  const r = await getPaymentVoucher(no);
  if (!r) notFound();
  const [canCreate, canApprove, canPost, certs] = await Promise.all([
    currentCanAction('CASH_MGMT_PV_CREATE'), currentCanAction('CASH_MGMT_PV_APPROVE'),
    currentCanAction('CASH_MGMT_PV_POST'), getWhtCertificatesForVoucher(no),
  ]);
  const isOwn = r.created_by === user.username;
  // An Open voucher is still the creator's draft, so it is edited here on its own card — the
  // line editor's lookups are only fetched when it actually can be.
  const editable = !r.posted && r.status === 'Open' && canCreate && isOwn;
  // As on the receipt: at or above the voucher approval limit it must be approved first; below
  // it the creator posts it themselves, so only one of the two buttons is ever offered.
  const needsApproval = r.total_amount >= r.approval_limit;
  const formProps = editable ? await docFormProps() : null;

  return (
    <Page title={`Payment Voucher ${r.no}`} crumb="Cash Management → Payment Vouchers" user={user}>
      {/* The actions sit above the document, where they are reachable without scrolling past it. */}
      <Toolbar>
        <a href="/cash-management/payment-vouchers" className="btn ghost sm">← All vouchers</a>
        {r.posted ? (
          <a className="btn ghost sm" href={`/print/payment-voucher/${encodeURIComponent(r.no)}`} target="_blank" rel="noreferrer">
            Print voucher
          </a>
        ) : null}
        <Spacer />
        {editable ? <DeleteButton no={r.no} kind="pv" /> : null}
        {editable && needsApproval ? <SubmitButton no={r.no} kind="pv" /> : null}
        {r.status === 'Pending Approval' && canCreate && isOwn ? <CancelApprovalButton no={r.no} kind="pv" /> : null}
        {r.status === 'Pending Approval' && canApprove ? (<><ApproveButton no={r.no} kind="pv" /><RejectButton no={r.no} kind="pv" /></>) : null}
        {!r.posted && r.status === 'Approved' && canApprove ? <ReopenButton no={r.no} kind="pv" /> : null}
        {!r.posted && canPost && (needsApproval ? r.status === 'Approved' : r.status === 'Open')
          ? <PostPvButton no={r.no} />
          : null}
      </Toolbar>

      <PaymentVoucherCard pv={r} lookups={formProps} canEdit={editable} />

      {certs.length ? (
        <Card>
          <CardHead title="Withholding Tax Certificates" />
          <TableWrap>
            <thead><tr><th>No.</th><th>Payee</th><th className="num">WHT</th><th>Status</th><th /></tr></thead>
            <tbody>
              {certs.map((c) => (
                <tr key={c.id}>
                  <td className="mono">{c.no}</td>
                  <td>{c.vendor_name ?? '—'}</td>
                  <td className="num"><Money cents={c.total_wht} /></td>
                  <td>{c.remitted ? <Pill status="ok">Remitted</Pill> : <Pill tone="warn">Pending</Pill>}</td>
                  <td className="num"><a className="btn sm ghost" href={`/wht-certificate/${c.no}`} target="_blank" rel="noreferrer">Print</a></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      ) : null}
    </Page>
  );
}
