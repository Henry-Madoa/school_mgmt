/*
 * Official Receipt printout — AL Rep52203569 "Customer Receipt" (./ssrs/CustomerReceipt.rdl).
 *
 * Built from a posted_receipt and rendered through the shared document chrome in
 * lib/documentPrint.ts, so the receipt a parent walks away with carries the same letterhead and
 * signature strip as the invoice or voucher behind it.
 *
 * Used by /receipt-slip/[no].
 */
import { one, all } from './db.ts';
import { formatDate } from './format.ts';
import { amountInWords } from './numberToWords.ts';
import {
  printBrand, documentMoney, documentSignatories, currencyLabel, renderDocument,
} from './documentPrint.ts';
import type { PrintDocument, PrintColumn, PrintRow } from './documentPrint.ts';
import type { PostedReceipt, PostedReceiptLine } from './types.ts';

export { renderDocument };

const COLUMNS: PrintColumn[] = [
  { key: 'account', label: 'Account', width: '26%' },
  { key: 'description', label: 'Being payment for' },
  { key: 'applies', label: 'Applied To', width: '16%' },
  { key: 'amount', label: 'Amount', align: 'right', width: '18%' },
];

export async function buildReceiptDocument(no: string): Promise<PrintDocument | null> {
  const doc = await one<PostedReceipt>(
    'SELECT * FROM posted_receipt WHERE no = ? OR receipt_no = ?', no, no,
  );
  if (!doc) return null;
  const brand = await printBrand();
  if (!brand) return null;
  const money = documentMoney(brand, doc.currency_code);

  const lines = await all<PostedReceiptLine>(
    'SELECT * FROM posted_receipt_line WHERE posted_receipt_id = ? ORDER BY line_no', doc.id,
  );

  const rows: PrintRow[] = lines.map((l): PrintRow => ({
    cells: {
      account: [l.account_no, l.account_name].filter(Boolean).join(' — ') || '',
      description: l.description ?? '',
      applies: l.applies_to_doc_no ?? '—',
      amount: money(l.amount),
    },
  }));

  return {
    brand,
    title: 'Official Receipt',
    subtitle: doc.receipt_no && doc.receipt_no !== doc.no ? `Receipt ${doc.receipt_no}` : null,
    status: { label: 'Posted', tone: 'ok' },
    parties: [{
      heading: 'Received from',
      name: doc.description || '—',
      lines: [
        doc.bank_account_name ? `Banked to ${doc.bank_account_name}` : '',
      ].filter(Boolean),
    }],
    meta: [
      { label: 'Receipt No.', value: doc.no },
      { label: 'Date', value: formatDate(doc.posting_date) },
      ...(doc.pay_mode_code ? [{ label: 'Payment Mode', value: doc.pay_mode_code }] : []),
      ...(doc.external_document_no ? [{ label: 'Cheque / Ref. No.', value: doc.external_document_no }] : []),
      ...(doc.manual_receipt_no ? [{ label: 'Manual Receipt No.', value: doc.manual_receipt_no }] : []),
      { label: 'Currency', value: doc.currency_code },
      { label: 'Amount Received', value: money(doc.amount), strong: true },
    ],
    columns: COLUMNS,
    rows,
    totals: [{ label: `Total received (${doc.currency_code})`, value: money(doc.amount), grand: true }],
    amount_words: amountInWords(doc.amount, currencyLabel(doc.currency_code)),
    // Checked / Approved / Authorised, from the document's own approval trail, plus the line the
    // person handing over the money signs.
    approvals: await documentSignatories('RECEIPT', doc.receipt_no, doc.created_by, {
      raisedAt: doc.created_at, clearedBy: doc.created_by,
    }),
    acknowledgement: { title: 'Received from' },
    footnote: 'This is a computer-generated receipt and is valid without a rubber stamp.',
  };
}
