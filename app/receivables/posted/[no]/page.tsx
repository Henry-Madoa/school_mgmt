import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, requirePage } from '@/lib/session';
import { getPostedSalesDocument } from '@/lib/salesDocuments';
import { formatDate } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { Card, CardHead, DefinitionList, EmptyState, Stat, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { Money } from '@/components/ui/money';

/**
 * A posted Sales Shipment / Invoice / Credit Memo.
 *
 * Posting deletes the source sales_header — Business Central does the same — so once a document
 * is posted this read-only card is the document. It is where PostSalesDocButton sends the poster,
 * which is also what stops the old behaviour of refreshing the now-deleted source page into a
 * "page not found".
 */
export default async function PostedSalesDocumentPage({ params }: { params: Promise<{ no: string }> }) {
  const user = await requireAction('RECEIVABLES_READ');
  await requirePage('RECEIVABLES_POSTED');
  const { no } = await params;
  const doc = await getPostedSalesDocument(decodeURIComponent(no));
  if (!doc) notFound();

  const isShipment = doc.document_type === 'Shipment';
  const discount = doc.lines.reduce((s, l) => s + l.line_discount_amount, 0);

  return (
    <Page
      title={`Posted ${doc.document_type} ${doc.no}`}
      crumb={`${doc.customer_no} · ${doc.customer_name}`}
      user={user}
    >
      <Toolbar>
        <Link
          href={`/receivables/posted-documents?view=${isShipment ? 'shipments' : doc.document_type === 'Credit Memo' ? 'credit-memos' : 'invoices'}`}
          className="btn ghost sm"
        >
          ← All posted {isShipment ? 'shipments' : doc.document_type === 'Credit Memo' ? 'credit memos' : 'invoices'}
        </Link>
        <Link href={`/receivables/customers/${encodeURIComponent(doc.customer_no)}`} className="btn ghost sm">Customer card</Link>
        <Spacer />
        <a className="btn" href={`/print/posted-sales/${encodeURIComponent(doc.no)}`} target="_blank" rel="noreferrer">Print</a>
      </Toolbar>

      <div className="grid g3 stack-2">
        <Stat label={isShipment ? 'Lines' : 'Amount'}
          value={isShipment ? String(doc.lines.length) : <Money cents={doc.amount} decimals={0} />}
          foot={`${doc.lines.length} line${doc.lines.length === 1 ? '' : 's'}`} />
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
            ['Customer', `${doc.customer_no} — ${doc.customer_name}`],
            ['Sell-to name', doc.sell_to_name || '—'],
            ['Order No.', doc.order_no || '—'],
          ]}
          />
          <DefinitionList items={[
            ['Your reference', doc.your_reference || '—'],
            ['Currency', `${doc.currency_code}${doc.currency_code === 'KES' ? '' : ` @ ${doc.currency_factor}`}`],
            ['Posted by', doc.created_by || '—'],
            ['Posted at', doc.created_at ? formatDate(doc.created_at.slice(0, 10)) : '—'],
          ]}
          />
        </div>
      </Card>

      <Card>
        <CardHead title="Lines" sub={isShipment ? 'Quantities shipped' : 'What was invoiced'} />
        {doc.lines.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th>Type</th><th>No.</th><th>Description</th><th className="num">Qty</th>
                {isShipment ? null : (<><th className="num">Unit price</th><th className="num">Discount</th><th className="num">Amount</th></>)}
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.type}</td>
                  <td className="mono">{l.no || '—'}</td>
                  <td>{l.description || ''}</td>
                  <td className="num">{l.quantity}</td>
                  {isShipment ? null : (
                    <>
                      <td className="num"><Money cents={l.unit_price} symbol={false} /></td>
                      <td className="num">{l.line_discount_amount ? <Money cents={l.line_discount_amount} symbol={false} /> : '—'}</td>
                      <td className="num"><Money cents={l.line_amount} symbol={false} /></td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
            {isShipment ? null : (
              <tfoot>
                <tr>
                  <td colSpan={5}>Total{discount ? ` (after ${''}discount)` : ''}</td>
                  <td className="num">{discount ? <Money cents={discount} symbol={false} /> : ''}</td>
                  <td className="num"><b><Money cents={doc.amount} symbol={false} /></b></td>
                </tr>
              </tfoot>
            )}
          </TableWrap>
        ) : <EmptyState icon="📄" title="This document has no lines" />}
      </Card>
    </Page>
  );
}
