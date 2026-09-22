import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, requirePage } from '@/lib/session';
import { getPostedPurchaseDocument } from '@/lib/purchaseDocuments';
import { formatDate } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { Card, CardHead, DefinitionList, EmptyState, Stat, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { Money } from '@/components/ui/money';

/**
 * A posted Purchase Receipt (GRN) / Invoice / Credit Memo — the mirror of the receivables
 * posted-document card, and where PostPurchaseDocButton lands once posting succeeds.
 */
export default async function PostedPurchaseDocumentPage({ params }: { params: Promise<{ no: string }> }) {
  const user = await requireAction('PAYABLES_READ');
  await requirePage('PAYABLES_POSTED');
  const { no } = await params;
  const doc = await getPostedPurchaseDocument(decodeURIComponent(no));
  if (!doc) notFound();

  const isReceipt = doc.document_type === 'Receipt';
  const vat = doc.lines.reduce((s, l) => s + l.vat_amount, 0);

  return (
    <Page
      title={`Posted ${doc.document_type} ${doc.no}`}
      crumb={`${doc.vendor_no} · ${doc.vendor_name}`}
      user={user}
    >
      <Toolbar>
        <Link
          href={`/payables/posted-documents?view=${isReceipt ? 'receipts' : doc.document_type === 'Credit Memo' ? 'credit-memos' : 'invoices'}`}
          className="btn ghost sm"
        >
          ← All posted {isReceipt ? 'receipts' : doc.document_type === 'Credit Memo' ? 'credit memos' : 'invoices'}
        </Link>
        <Link href={`/payables/vendors/${encodeURIComponent(doc.vendor_no)}`} className="btn ghost sm">Vendor card</Link>
        <Spacer />
        <a className="btn" href={`/print/posted-purchase/${encodeURIComponent(doc.no)}`} target="_blank" rel="noreferrer">Print</a>
      </Toolbar>

      <div className="grid g3 stack-2">
        <Stat label="Amount (excl. VAT)" value={<Money cents={doc.amount} decimals={0} />}
          foot={<>incl. VAT <Money cents={doc.amount_incl_vat} decimals={0} /></>} />
        <Stat label="Posting date" value={formatDate(doc.posting_date)} foot={`Document date ${formatDate(doc.document_date)}`} />
        <Stat label="Due date" value={doc.due_date ? formatDate(doc.due_date) : '—'}
          foot={doc.payment_terms_code ? `Terms ${doc.payment_terms_code}` : 'No payment terms'} />
      </div>

      <Card>
        <CardHead title="Document" sub="Posted — this record cannot be edited" />
        <div className="grid split-side-sm">
          <DefinitionList items={[
            ['Document No.', doc.no],
            ['Type', doc.document_type],
            ['Vendor', `${doc.vendor_no} — ${doc.vendor_name}`],
            ['Buy-from name', doc.buy_from_name || '—'],
            ['Order No.', doc.order_no || '—'],
          ]}
          />
          <DefinitionList items={[
            ['Vendor invoice no.', doc.vendor_invoice_no || '—'],
            doc.applies_to_doc_no ? ['Credits invoice', <a href={`/payables/posted/${encodeURIComponent(doc.applies_to_doc_no)}`} className="mono" key="ap">{doc.applies_to_doc_no}</a>] : null,
            ['Currency', `${doc.currency_code}${doc.currency_code === 'KES' ? '' : ` @ ${doc.currency_factor}`}`],
            ['Posted by', doc.created_by || '—'],
            ['Posted at', doc.created_at ? formatDate(doc.created_at.slice(0, 10)) : '—'],
          ]}
          />
        </div>
      </Card>

      <Card>
        <CardHead title="Lines" sub={isReceipt ? 'Quantities received' : 'What was invoiced'} />
        {doc.lines.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th>Type</th><th>No.</th><th>Description</th><th className="num">Qty</th>
                <th className="num">Unit cost</th><th className="num">VAT</th><th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.type}</td>
                  <td className="mono">{l.no || '—'}</td>
                  <td>{l.description || ''}</td>
                  <td className="num">{l.quantity}</td>
                  <td className="num"><Money cents={l.direct_unit_cost} symbol={false} /></td>
                  <td className="num">{l.vat_amount ? <Money cents={l.vat_amount} symbol={false} /> : '—'}</td>
                  <td className="num"><Money cents={l.line_amount} symbol={false} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}>Net / VAT / total</td>
                <td className="num"><Money cents={vat} symbol={false} /></td>
                <td className="num"><b><Money cents={doc.amount_incl_vat} symbol={false} /></b></td>
              </tr>
            </tfoot>
          </TableWrap>
        ) : <EmptyState icon="📄" title="This document has no lines" />}
      </Card>
    </Page>
  );
}
