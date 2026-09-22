/*
 * Printable Sales documents — AL Rep52204455 "Sales Invoice" and Rep52203562 "Request for
 * Sales Quote", generalised over every sales document the Receivables module raises.
 *
 * Two entry points, because a sales document lives in two tables:
 *   buildSalesDocumentPrint()        sales_header / sales_line — Quote, Order, Invoice, Cr. Memo
 *                                    still being worked on (an unreleased one prints watermarked)
 *   buildPostedSalesDocumentPrint()  posted_sales_document / posted_sales_line — the immutable
 *                                    Shipment / Invoice / Credit Memo behind the customer ledger
 *
 * Both hand a PrintDocument to lib/documentPrint.ts, which owns the letterhead and the layout.
 */
import { one, all } from './db.ts';
import { getSalesDocument } from './salesDocuments.ts';
import { formatDate } from './format.ts';
import { amountInWords } from './numberToWords.ts';
import {
  printBrand, documentSignatories, documentMoney, currencyLabel, renderDocument,
} from './documentPrint.ts';
import type { PrintDocument, PrintColumn, PrintRow, PrintParty, PrintBrand } from './documentPrint.ts';
import type {
  Customer, PostedSalesDocument, PostedSalesLine, SalesDocumentDetail, SalesDocumentType,
  PostedSalesDocumentType, SalesLine,
} from './types.ts';

export { renderDocument };

/** The printed title for each document type — the working document and its posted counterpart. */
const WORKING_TITLE: Record<SalesDocumentType, string> = {
  Quote: 'Sales Quotation',
  Order: 'Sales Order',
  Invoice: 'Sales Invoice',
  'Credit Memo': 'Sales Credit Memo',
};

const POSTED_TITLE: Record<PostedSalesDocumentType, string> = {
  Shipment: 'Sales Shipment',
  Invoice: 'Sales Invoice',
  'Credit Memo': 'Sales Credit Memo',
};

const LINE_COLUMNS: PrintColumn[] = [
  { key: 'no', label: 'Item / Account', width: '15%' },
  { key: 'description', label: 'Description' },
  { key: 'qty', label: 'Qty', align: 'right', width: '9%' },
  { key: 'price', label: 'Unit Price', align: 'right', width: '15%' },
  { key: 'discount', label: 'Discount', align: 'right', width: '13%' },
  { key: 'amount', label: 'Amount', align: 'right', width: '16%' },
];

const qty = (n: number): string => Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 4 });

/** The customer block — the posted header's own Sell-to snapshot, topped up from the card. */
function customerParty(
  heading: string,
  customerNo: string,
  name: string,
  address: string | null,
  city: string | null,
  contact: string | null,
  customer: Customer | undefined,
): PrintParty {
  return {
    heading,
    name: name || customer?.name || customerNo,
    lines: [
      `Customer No. ${customerNo}`,
      address || customer?.address || '',
      [city || customer?.city, customer?.post_code].filter(Boolean).join(' ') || '',
      contact || customer?.contact || '',
      customer?.phone ?? '',
      customer?.email ?? '',
    ].filter(Boolean),
  };
}

/* --------------------------------------------------------------- working documents */

export async function buildSalesDocumentPrint(no: string): Promise<PrintDocument | null> {
  const doc: SalesDocumentDetail | undefined = await getSalesDocument(no);
  if (!doc) return null;
  const brand = await printBrand();
  if (!brand) return null;
  const money = documentMoney(brand, doc.currency_code);
  const customer = await one<Customer>('SELECT * FROM customer WHERE id = ?', doc.customer_id);

  const discount = doc.lines.reduce((s: number, l: SalesLine) => s + l.line_discount_amount, 0);
  const gross = doc.lines.reduce((s: number, l: SalesLine) => s + l.line_amount, 0) + discount;

  const rows: PrintRow[] = doc.lines.map((l: SalesLine): PrintRow => (l.type === 'Comment'
    ? { muted: true, cells: { description: l.description ?? '' } }
    : {
      cells: {
        no: l.no ?? '',
        description: l.description ?? '',
        qty: qty(l.quantity),
        price: money(l.unit_price),
        discount: l.line_discount_amount ? money(l.line_discount_amount) : '—',
        amount: money(l.line_amount),
      },
    }));

  const released = doc.status === 'Released';
  return {
    brand,
    title: WORKING_TITLE[doc.document_type],
    subtitle: doc.document_type === 'Quote' ? 'Valid for 30 days from the date below' : null,
    watermark: released ? null : doc.status === 'Pending Approval' ? 'Pending Approval' : 'Draft',
    status: {
      label: doc.status,
      tone: released ? 'ok' : doc.status === 'Pending Approval' ? 'warn' : 'info',
    },
    parties: [customerParty(
      doc.document_type === 'Credit Memo' ? 'Credit to' : 'Bill to',
      doc.customer_no, doc.sell_to_name ?? '', doc.sell_to_address, doc.sell_to_city,
      doc.sell_to_contact, customer,
    )],
    meta: [
      { label: 'Document No.', value: doc.no },
      // One date, named for what the document is — Invoice Date, Order Date, Receipt Date.
      { label: `${doc.document_type} Date`, value: formatDate(doc.posting_date) },
      ...(doc.due_date ? [{ label: 'Due Date', value: formatDate(doc.due_date) }] : []),
      ...(doc.applies_to_doc_no ? [{ label: 'Credits Invoice', value: doc.applies_to_doc_no }] : []),
      ...(doc.your_reference ? [{ label: 'Your Reference', value: doc.your_reference }] : []),
      ...(doc.payment_terms_code ? [{ label: 'Payment Terms', value: doc.payment_terms_code }] : []),
      ...(doc.payment_method_code ? [{ label: 'Payment Method', value: doc.payment_method_code }] : []),
      ...(doc.salesperson ? [{ label: 'Salesperson', value: doc.salesperson }] : []),
      { label: 'Currency', value: doc.currency_code },
      { label: 'Total', value: money(doc.amount), strong: true },
    ],
    columns: LINE_COLUMNS,
    rows,
    totals: [
      { label: 'Subtotal', value: money(gross) },
      ...(discount ? [{ label: 'Line discount', value: money(discount), negative: true }] : []),
      { label: `Total (${doc.currency_code})`, value: money(doc.amount), grand: true },
    ],
    amount_words: amountInWords(doc.amount, currencyLabel(doc.currency_code)),
    notes: paymentNotes(brand, doc.document_type),
    approvals: await documentSignatories('SALES_DOCUMENT', doc.no, doc.created_by, {
      raisedAt: doc.created_at,
    }),
    footnote: released
      ? null
      : 'Not yet released — this copy is for internal review and is not a demand for payment.',
  };
}

/* ---------------------------------------------------------------- posted documents */

export async function buildPostedSalesDocumentPrint(no: string): Promise<PrintDocument | null> {
  const doc = await one<PostedSalesDocument & { customer_no: string; customer_name: string }>(
    `SELECT d.*, c.no AS customer_no, c.name AS customer_name
     FROM posted_sales_document d JOIN customer c ON c.id = d.customer_id WHERE d.no = ?`, no,
  );
  if (!doc) return null;
  const brand = await printBrand();
  if (!brand) return null;
  const money = documentMoney(brand, doc.currency_code);
  const [customer, lines] = await Promise.all([
    one<Customer>('SELECT * FROM customer WHERE id = ?', doc.customer_id),
    all<PostedSalesLine>(
      'SELECT * FROM posted_sales_line WHERE posted_sales_document_id = ? ORDER BY line_no', doc.id,
    ),
  ]);

  const isShipment = doc.document_type === 'Shipment';
  const discount = lines.reduce((s, l) => s + l.line_discount_amount, 0);
  const gross = lines.reduce((s, l) => s + l.line_amount, 0) + discount;

  // A shipment moves goods, not money: it prints quantities and drops the pricing columns.
  const columns: PrintColumn[] = isShipment
    ? [
      { key: 'no', label: 'Item / Account', width: '18%' },
      { key: 'description', label: 'Description' },
      { key: 'qty', label: 'Qty Shipped', align: 'right', width: '16%' },
    ]
    : LINE_COLUMNS;

  const rows: PrintRow[] = lines.map((l): PrintRow => (l.type === 'Comment'
    ? { muted: true, cells: { description: l.description ?? '' } }
    : {
      cells: {
        no: l.no ?? '',
        description: l.description ?? '',
        qty: qty(l.quantity),
        price: money(l.unit_price),
        discount: l.line_discount_amount ? money(l.line_discount_amount) : '—',
        amount: money(l.line_amount),
      },
    }));

  return {
    brand,
    title: POSTED_TITLE[doc.document_type],
    subtitle: 'Posted document',
    status: { label: 'Posted', tone: 'ok' },
    parties: [customerParty(
      doc.document_type === 'Credit Memo' ? 'Credit to' : isShipment ? 'Ship to' : 'Bill to',
      doc.customer_no, doc.sell_to_name ?? doc.customer_name, doc.sell_to_address, doc.sell_to_city,
      doc.sell_to_contact, customer,
    )],
    meta: [
      { label: 'Document No.', value: doc.no },
      // One date, named for what the document is — Invoice Date, Order Date, Receipt Date.
      { label: `${doc.document_type} Date`, value: formatDate(doc.posting_date) },
      ...(doc.due_date ? [{ label: 'Due Date', value: formatDate(doc.due_date) }] : []),
      ...(doc.order_no ? [{ label: 'Order No.', value: doc.order_no }] : []),
      ...(doc.applies_to_doc_no ? [{ label: 'Credits Invoice', value: doc.applies_to_doc_no }] : []),
      ...(doc.your_reference ? [{ label: 'Your Reference', value: doc.your_reference }] : []),
      ...(doc.payment_terms_code ? [{ label: 'Payment Terms', value: doc.payment_terms_code }] : []),
      { label: 'Currency', value: doc.currency_code },
      ...(isShipment ? [] : [{ label: 'Total', value: money(doc.amount), strong: true }]),
    ],
    columns,
    rows,
    totals: isShipment ? [] : [
      { label: 'Subtotal', value: money(gross) },
      ...(discount ? [{ label: 'Line discount', value: money(discount), negative: true }] : []),
      { label: `Total (${doc.currency_code})`, value: money(doc.amount), grand: true },
    ],
    amount_words: isShipment ? null : amountInWords(doc.amount, currencyLabel(doc.currency_code)),
    notes: isShipment ? [] : paymentNotes(brand, doc.document_type),
    approvals: await documentSignatories('SALES_DOCUMENT', doc.source_no ?? doc.order_no ?? doc.no, doc.created_by, {
      raisedAt: doc.created_at, clearedBy: doc.created_by,
    }),
    acknowledgement: { title: isShipment ? 'Received by' : 'Customer acknowledgement' },
  };
}


/** Where to pay — the AL Sales Invoice layout's bank block, from Company Information. A credit
 *  memo asks for nothing, so it prints none. */
function paymentNotes(brand: PrintBrand, documentType: string): PrintDocument['notes'] {
  if (documentType === 'Credit Memo' || !brand.pay_to) return [];
  return [{ heading: 'Payment details', body: brand.pay_to }];
}
