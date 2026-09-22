/*
 * Printable Purchase documents — AL Rep52203554 "Local Purchase Order" and Rep52204456
 * "Purchase Receipt (GRN)", generalised over every purchase document Payables raises.
 *
 * Two entry points, mirroring lib/salesDocumentPrint.ts:
 *   buildPurchaseDocumentPrint()        purchase_header / purchase_line — Quote, Order (which
 *                                       prints as the LPO), Invoice and Credit Memo
 *   buildPostedPurchaseDocumentPrint()  posted_purchase_document / posted_purchase_line — the
 *                                       Receipt (GRN), Invoice and Credit Memo behind the
 *                                       vendor ledger
 *
 * Purchase documents carry input VAT, so unlike the sales side they print a VAT column and a
 * three-line total block (net, VAT, gross) — the same figures postPurchaseDocument() posts.
 */
import { one, all } from './db.ts';
import { getPurchaseDocument } from './purchaseDocuments.ts';
import { formatDate } from './format.ts';
import { amountInWords } from './numberToWords.ts';
import {
  printBrand, documentSignatories, documentMoney, currencyLabel, renderDocument,
} from './documentPrint.ts';
import type { PrintDocument, PrintColumn, PrintRow, PrintParty } from './documentPrint.ts';
import type {
  Vendor, PostedPurchaseDocument, PostedPurchaseLine, PurchaseDocumentDetail, PurchaseDocumentType,
  PostedPurchaseDocumentType, PurchaseLine,
} from './types.ts';

export { renderDocument };

const WORKING_TITLE: Record<PurchaseDocumentType, string> = {
  Quote: 'Request for Quotation',
  Order: 'Local Purchase Order',
  Invoice: 'Purchase Invoice',
  'Credit Memo': 'Purchase Credit Memo',
};

const POSTED_TITLE: Record<PostedPurchaseDocumentType, string> = {
  Receipt: 'Purchase Receipt (GRN)',
  Invoice: 'Purchase Invoice',
  'Credit Memo': 'Purchase Credit Memo',
};

const PRICED_COLUMNS: PrintColumn[] = [
  { key: 'no', label: 'Item / Account', width: '12%' },
  { key: 'description', label: 'Description' },
  { key: 'qty', label: 'Qty', align: 'right', width: '7%' },
  { key: 'cost', label: 'Unit Cost', align: 'right', width: '14%' },
  { key: 'discount', label: 'Discount', align: 'right', width: '11%' },
  { key: 'vat', label: 'VAT', align: 'right', width: '14%' },
  { key: 'amount', label: 'Amount', align: 'right', width: '15%' },
];

/** The GRN counts goods in, so it prints ordered vs. received rather than money — exactly the
 *  columns AL's PurchaseReceipt.rdl shows (QtyOrdered, Quantity, Unit Cost, Line Amount). */
const GRN_COLUMNS: PrintColumn[] = [
  { key: 'no', label: 'Item / Account', width: '14%' },
  { key: 'description', label: 'Description' },
  { key: 'ordered', label: 'Qty Ordered', align: 'right', width: '12%' },
  { key: 'qty', label: 'Qty Received', align: 'right', width: '12%' },
  { key: 'cost', label: 'Unit Cost', align: 'right', width: '15%' },
  { key: 'amount', label: 'Amount', align: 'right', width: '15%' },
];

const qty = (n: number): string => Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 4 });

function vendorParty(
  heading: string,
  vendorNo: string,
  name: string,
  address: string | null,
  city: string | null,
  contact: string | null,
  vendor: Vendor | undefined,
): PrintParty {
  return {
    heading,
    name: name || vendor?.name || vendorNo,
    lines: [
      `Vendor No. ${vendorNo}`,
      address || vendor?.address || '',
      [city || vendor?.city, vendor?.post_code].filter(Boolean).join(' ') || '',
      contact || vendor?.contact || '',
      vendor?.phone ?? '',
      vendor?.email ?? '',
      vendor?.pin_no ? `PIN ${vendor.pin_no}` : '',
    ].filter(Boolean),
  };
}

/** Where the goods or the invoice should be delivered — the buyer's own address block, which an
 *  LPO has to carry for the vendor to act on it. */
function deliverToParty(brand: NonNullable<Awaited<ReturnType<typeof printBrand>>>): PrintParty {
  return {
    heading: 'Deliver to / Invoice to',
    name: brand.name,
    lines: [...brand.address_lines, ...brand.contact_lines],
  };
}


/* --------------------------------------------------------------- working documents */

export async function buildPurchaseDocumentPrint(no: string): Promise<PrintDocument | null> {
  const doc: PurchaseDocumentDetail | undefined = await getPurchaseDocument(no);
  if (!doc) return null;
  const brand = await printBrand();
  if (!brand) return null;
  const money = documentMoney(brand, doc.currency_code);
  const vendor = await one<Vendor>('SELECT * FROM vendor WHERE id = ?', doc.vendor_id);

  const discount = doc.lines.reduce((s: number, l: PurchaseLine) => s + l.line_discount_amount, 0);
  const vat = doc.lines.reduce((s: number, l: PurchaseLine) => s + l.vat_amount, 0);
  const gross = doc.lines.reduce((s: number, l: PurchaseLine) => s + l.line_amount, 0) + discount;

  const rows: PrintRow[] = doc.lines.map((l: PurchaseLine): PrintRow => (l.type === 'Comment'
    ? { muted: true, cells: { description: l.description ?? '' } }
    : {
      cells: {
        no: l.no ?? '',
        description: l.description ?? '',
        qty: qty(l.quantity),
        cost: money(l.direct_unit_cost),
        discount: l.line_discount_amount ? money(l.line_discount_amount) : '—',
        vat: l.vat_amount ? `${money(l.vat_amount)} (${l.vat_pct}%)` : '—',
        amount: money(l.line_amount),
      },
    }));

  const released = doc.status === 'Released';
  const isOrder = doc.document_type === 'Order';
  return {
    brand,
    title: WORKING_TITLE[doc.document_type],
    subtitle: isOrder ? 'Supply of goods / services as detailed below' : null,
    watermark: released ? null : doc.status === 'Pending Approval' ? 'Pending Approval' : 'Draft',
    status: {
      label: doc.status,
      tone: released ? 'ok' : doc.status === 'Pending Approval' ? 'warn' : 'info',
    },
    parties: [
      vendorParty(
        doc.document_type === 'Credit Memo' ? 'Debit to' : 'Vendor',
        doc.vendor_no, doc.buy_from_name ?? '', doc.buy_from_address, doc.buy_from_city,
        doc.buy_from_contact, vendor,
      ),
      ...(isOrder ? [deliverToParty(brand)] : []),
    ],
    meta: [
      { label: 'Document No.', value: doc.no },
      // One date, named for what the document is — Invoice Date, Order Date, Receipt Date.
      { label: `${doc.document_type} Date`, value: formatDate(doc.posting_date) },
      ...(doc.due_date ? [{ label: 'Due Date', value: formatDate(doc.due_date) }] : []),
      ...(doc.vendor_invoice_no ? [{ label: 'Vendor Invoice No.', value: doc.vendor_invoice_no }] : []),
      ...(doc.applies_to_doc_no ? [{ label: 'Credits Invoice', value: doc.applies_to_doc_no }] : []),
      ...(doc.payment_terms_code ? [{ label: 'Payment Terms', value: doc.payment_terms_code }] : []),
      ...(doc.purchaser ? [{ label: 'Purchaser', value: doc.purchaser }] : []),
      { label: 'Currency', value: doc.currency_code },
      { label: 'Total (incl. VAT)', value: money(doc.amount_incl_vat), strong: true },
    ],
    columns: PRICED_COLUMNS,
    rows,
    totals: [
      { label: 'Subtotal', value: money(gross) },
      ...(discount ? [{ label: 'Line discount', value: money(discount), negative: true }] : []),
      { label: 'Net amount', value: money(doc.amount) },
      { label: 'VAT', value: money(vat) },
      { label: `Total (${doc.currency_code})`, value: money(doc.amount_incl_vat), grand: true },
    ],
    amount_words: amountInWords(doc.amount_incl_vat, currencyLabel(doc.currency_code)),
    notes: isOrder
      ? [{
        heading: 'Terms',
        body: 'Quote this order number on your invoice and delivery note. Goods remain subject to '
          + 'inspection on delivery; invoices are settled per the payment terms shown above.',
      }]
      : [],
    approvals: await documentSignatories('PURCHASE_DOCUMENT', doc.no, doc.created_by, {
      raisedAt: doc.created_at,
    }),
    footnote: released
      ? null
      : 'Not yet released — this copy is for internal review and is not a commitment to the vendor.',
  };
}

/* ---------------------------------------------------------------- posted documents */

export async function buildPostedPurchaseDocumentPrint(no: string): Promise<PrintDocument | null> {
  const doc = await one<PostedPurchaseDocument & { vendor_no: string; vendor_name: string }>(
    `SELECT d.*, v.no AS vendor_no, v.name AS vendor_name
     FROM posted_purchase_document d JOIN vendor v ON v.id = d.vendor_id WHERE d.no = ?`, no,
  );
  if (!doc) return null;
  const brand = await printBrand();
  if (!brand) return null;
  const money = documentMoney(brand, doc.currency_code);
  const [vendor, lines] = await Promise.all([
    one<Vendor>('SELECT * FROM vendor WHERE id = ?', doc.vendor_id),
    all<PostedPurchaseLine>(
      'SELECT * FROM posted_purchase_line WHERE posted_purchase_document_id = ? ORDER BY line_no', doc.id,
    ),
  ]);

  const isReceipt = doc.document_type === 'Receipt';
  // AL's GRN prints Qty Ordered beside Qty Received; the order it came from still holds it.
  const ordered = new Map<string, number>();
  if (isReceipt && doc.order_no) {
    const orderLines = await all<{ no: string | null; quantity: number }>(
      `SELECT l.no, l.quantity FROM purchase_line l
       JOIN purchase_header h ON h.id = l.purchase_header_id WHERE h.no = ?`, doc.order_no,
    );
    for (const l of orderLines) ordered.set(String(l.no ?? ''), l.quantity);
  }

  const discount = lines.reduce((s, l) => s + l.line_discount_amount, 0);
  const vat = lines.reduce((s, l) => s + l.vat_amount, 0);
  const gross = lines.reduce((s, l) => s + l.line_amount, 0) + discount;

  const rows: PrintRow[] = lines.map((l): PrintRow => (l.type === 'Comment'
    ? { muted: true, cells: { description: l.description ?? '' } }
    : {
      cells: {
        no: l.no ?? '',
        description: l.description ?? '',
        ordered: ordered.has(String(l.no ?? '')) ? qty(ordered.get(String(l.no ?? '')) ?? 0) : '—',
        qty: qty(l.quantity),
        cost: money(l.direct_unit_cost),
        discount: l.line_discount_amount ? money(l.line_discount_amount) : '—',
        vat: l.vat_amount ? `${money(l.vat_amount)} (${l.vat_pct}%)` : '—',
        amount: money(l.line_amount),
      },
    }));

  return {
    brand,
    title: POSTED_TITLE[doc.document_type],
    subtitle: isReceipt ? 'Goods received note' : 'Posted document',
    status: { label: 'Posted', tone: 'ok' },
    parties: [
      vendorParty(
        doc.document_type === 'Credit Memo' ? 'Debit to' : isReceipt ? 'Received from' : 'Vendor',
        doc.vendor_no, doc.buy_from_name ?? doc.vendor_name, doc.buy_from_address, doc.buy_from_city,
        doc.buy_from_contact, vendor,
      ),
      ...(isReceipt ? [deliverToParty(brand)] : []),
    ],
    meta: [
      { label: 'Document No.', value: doc.no },
      // One date, named for what the document is — Invoice Date, Order Date, Receipt Date.
      { label: `${doc.document_type} Date`, value: formatDate(doc.posting_date) },
      ...(doc.due_date ? [{ label: 'Due Date', value: formatDate(doc.due_date) }] : []),
      ...(doc.order_no ? [{ label: 'Order No.', value: doc.order_no }] : []),
      ...(doc.vendor_invoice_no ? [{ label: 'Vendor Invoice No.', value: doc.vendor_invoice_no }] : []),
      ...(doc.applies_to_doc_no ? [{ label: 'Credits Invoice', value: doc.applies_to_doc_no }] : []),
      ...(doc.payment_terms_code ? [{ label: 'Payment Terms', value: doc.payment_terms_code }] : []),
      { label: 'Currency', value: doc.currency_code },
      ...(isReceipt ? [] : [{ label: 'Total (incl. VAT)', value: money(doc.amount_incl_vat), strong: true }]),
    ],
    columns: isReceipt ? GRN_COLUMNS : PRICED_COLUMNS,
    rows,
    totals: isReceipt
      ? [{ label: `Value received (${doc.currency_code})`, value: money(doc.amount), grand: true }]
      : [
        { label: 'Subtotal', value: money(gross) },
        ...(discount ? [{ label: 'Line discount', value: money(discount), negative: true }] : []),
        { label: 'Net amount', value: money(doc.amount) },
        { label: 'VAT', value: money(vat) },
        { label: `Total (${doc.currency_code})`, value: money(doc.amount_incl_vat), grand: true },
      ],
    amount_words: amountInWords(
      isReceipt ? doc.amount : doc.amount_incl_vat, currencyLabel(doc.currency_code),
    ),
    notes: isReceipt
      ? [{
        heading: 'Inspection',
        body: 'Goods above were received in good order and quantity unless noted. This note is not '
          + 'an authority to pay — payment follows the vendor invoice.',
      }]
      : [],
    approvals: await documentSignatories('PURCHASE_DOCUMENT', doc.source_no ?? doc.order_no ?? doc.no, doc.created_by, {
      raisedAt: doc.created_at, clearedBy: doc.created_by,
    }),
    acknowledgement: isReceipt ? { title: 'Inspected by' } : null,
  };
}
