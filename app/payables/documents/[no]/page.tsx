import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireAction, currentCanAction, requirePage } from '@/lib/session';
import { getPurchaseDocument, findPostedDocumentBySource } from '@/lib/purchaseDocuments';
import { listPostableAccounts } from '@/lib/gl';
import { listItems } from '@/lib/items';
import { listActiveLocations } from '@/lib/inventorySetup';
import { listFixedAssets } from '@/lib/fixedAssets';
import { listActivePaymentTerms, listActivePaymentMethods } from '@/lib/receivablesSetup';
import { listActiveVendors } from '@/lib/vendors';
import { getPurchasesPayablesSetup } from '@/lib/payablesSetup';
import { vatRateMatrix } from '@/lib/vatSetup';
import {
  canDelegateTask, findPendingRoutedTask, isEligibleApprover, listWorkflowTasksForDocument,
} from '@/lib/workflow';
import { Page } from '@/components/layout/page';
import { Card, CardHead, DefinitionList, Stat, Toolbar, Spacer } from '@/components/ui/primitives';
import { Money } from '@/components/ui/money';
import type { PurchaseDocumentType } from '@/lib/types';
import { ApprovalDetailsCard } from '@/components/ui/approval-details';
import { PurchaseDocumentCard } from '../../purchase-document-card';
import {
  MakeOrderButton, SubmitDocButton, CancelApprovalButton, ApproveDocButton, RejectDocButton, ReopenDocButton,
  DeleteDocButton, PostPurchaseDocButton, DelegateButton,
} from '../../document-actions';

/** The tab each document type lists under, for the card's "back to the list" link. */
const TAB_FOR: Record<PurchaseDocumentType, string> = {
  Quote: 'quotes', Order: 'orders', Invoice: 'purchase-invoices', 'Credit Memo': 'credit-memos',
};

export default async function PurchaseDocumentPage({ params }: { params: Promise<{ no: string }> }) {
  const user = await requireAction('PAYABLES_READ');
  const { no } = await params;
  const doc = await getPurchaseDocument(no);
  if (!doc) {
    // Posted since the link was made (a notification, a bookmark): the header is gone, so show
    // what it became rather than a dead end.
    const posted = await findPostedDocumentBySource(no);
    if (posted) redirect(`/payables/posted/${encodeURIComponent(posted.no)}`);
    notFound();
  }
  // The card belongs to the list it came from: a Sales Invoice page grants Sales Invoice cards.
  await requirePage(`PAYABLES_${{
    Quote: 'QUOTES', Order: 'ORDERS', Invoice: 'PURCHASE_INVOICES', 'Credit Memo': 'CREDIT_MEMOS',
  }[doc.document_type]}`);

  const [canCreate, canApprove, canPost, vendors, accounts, items, fixedAssets, locations, paymentTerms, paymentMethods, vatRates, setup, tasks] =
    await Promise.all([
      currentCanAction('PAYABLES_PURCHASE_CREATE'),
      currentCanAction('PAYABLES_PURCHASE_APPROVE'),
      currentCanAction('PAYABLES_PURCHASE_POST'),
      listActiveVendors(),
      listPostableAccounts(),
      listItems(),
      listFixedAssets(),
      listActiveLocations(),
      listActivePaymentTerms(),
      listActivePaymentMethods(),
      vatRateMatrix(),
      getPurchasesPayablesSetup(),
      listWorkflowTasksForDocument('PURCHASE_DOCUMENT', doc.no),
    ]);
  // Release / Reject belong to whoever the document is actually sitting with: the approver the
  // workflow routed it to, or — when no workflow matched — anyone holding the approve permission.
  const routedTask = doc.status === 'Pending Approval'
    ? await findPendingRoutedTask('PURCHASE_DOCUMENT', doc.no)
    : null;
  const routed = !!routedTask;
  const canDecideThis = routedTask ? await isEligibleApprover(routedTask, user.id) : canApprove;
  // Delegate is open to the approver it sits with and to an Approval Administrator, as in BC.
  const canDelegateThis = routedTask ? await canDelegateTask(routedTask, user.id) : false;

  const lookups = {
    vendors, paymentTerms, paymentMethods,
    accounts: accounts.map((a) => ({ code: a.code, name: a.name })),
    items: items.map((i) => ({ no: i.no, description: i.description })),
    fixedAssets: fixedAssets.filter((a) => !a.disposed && !a.acquisition_cost).map((a) => ({ no: a.no, description: a.description })),
    locations: locations.map((l) => ({ code: l.code, name: l.name })),
    vatPreview: {
      rates: vatRates,
      accountVatProd: Object.fromEntries(accounts.map((a) => [a.code, a.vat_prod_posting_group_code ?? null])),
      defaultVatBus: setup.default_vat_bus_posting_group_code ?? null,
      pricesInclVat: !!setup.prices_incl_vat,
    },
  };
  const isOwn = doc.created_by === user.username;
  const open = doc.status === 'Open';

  return (
    <Page title={`${doc.document_type} ${doc.no}`} crumb={`${doc.vendor_no} · ${doc.vendor_name}`} user={user}>
      <Toolbar>
        <Link href={`/payables/${TAB_FOR[doc.document_type]}`} className="btn ghost sm">← All {doc.document_type.toLowerCase()}s</Link>
        <Link href={`/payables/vendors/${encodeURIComponent(doc.vendor_no)}`} className="btn ghost sm">Vendor card</Link>
        <a className="btn ghost sm" href={`/print/purchase/${encodeURIComponent(doc.no)}`} target="_blank" rel="noreferrer">Print</a>
        <Spacer />
        {doc.document_type === 'Quote' && open && canCreate ? <MakeOrderButton no={doc.no} /> : null}
        {open && canCreate && isOwn && doc.document_type !== 'Quote' ? <SubmitDocButton no={doc.no} /> : null}
        {open && canCreate && isOwn ? <DeleteDocButton no={doc.no} listHref={`/payables/${TAB_FOR[doc.document_type]}`} /> : null}
        {doc.status === 'Pending Approval' && canCreate && isOwn && !routed ? <CancelApprovalButton no={doc.no} /> : null}
        {routedTask && canDelegateThis ? <DelegateButton taskId={routedTask.id} className="btn sm ghost" /> : null}
        {doc.status === 'Pending Approval' && canDecideThis
          ? (<><ApproveDocButton no={doc.no} /><RejectDocButton no={doc.no} /></>) : null}
        {doc.status === 'Released' && canApprove ? <ReopenDocButton no={doc.no} /> : null}
        {doc.status === 'Released' && canPost ? <PostPurchaseDocButton no={doc.no} isOrder={doc.document_type === 'Order'} /> : null}
      </Toolbar>

      <div className="grid g3 stack-2">
        <Stat label="Amount (excl. VAT)" value={<Money cents={doc.amount} decimals={0} />}
          foot={<>incl. VAT <Money cents={doc.amount_incl_vat} decimals={0} /></>} />
        <Stat label="Outstanding" value={<Money cents={doc.outstanding_amount} decimals={0} />}
          foot={`${doc.lines.length} line${doc.lines.length === 1 ? '' : 's'}`} />
        <Stat label="Received not invoiced" value={<Money cents={doc.received_not_invoiced} decimals={0} />}
          foot={doc.document_type === 'Order' ? 'Receipts posted but not yet invoiced' : 'Orders only'} />
      </div>

      <PurchaseDocumentCard doc={doc} lookups={lookups} canEdit={open && canCreate && isOwn} />

      <ApprovalDetailsCard
        tasks={tasks} status={doc.status} decisionReason={doc.decision_reason}
        createdBy={doc.created_by} createdAt={doc.created_at} subject="purchase document"
      />

      <Card>
        <CardHead title="Posting details" sub="The groups this document will post against" />
        <DefinitionList items={[
          ['Vendor posting group', doc.vendor_posting_group_code || '—'],
          ['VAT bus. posting group', doc.vat_bus_posting_group_code || '—'],
          ['Purchaser', doc.purchaser || '—'],
          ['Currency', `${doc.currency_code}${doc.currency_code === 'KES' ? '' : ` @ ${doc.currency_factor}`}`],
        ]} />
      </Card>
    </Page>
  );
}
