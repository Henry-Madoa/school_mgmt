/*
 * Payment Voucher printout — AL Rep52203425 "Payment Voucher" (Sacco ERP/ssrs/Payment Voucher.rdl),
 * which the AL pairs with its own Staff Claim and Petty Cash layouts.
 *
 * Built from a posted_payment_voucher and rendered through the shared document chrome in
 * lib/documentPrint.ts, so it carries the same letterhead, line table and signature strip as
 * every Sales and Purchase document.
 *
 * **The layout varies by Payment Type**, because the types answer different questions:
 *
 *   Supplier Payment    the AL's tax voucher — Gross, VAT, WHT and Net per line, the payee's KRA
 *                       PIN on the block, and the deduction summary in the totals.
 *   Customer Refund     which of the customer's entries the refund settles.
 *   Bank Transfer       the receiving bank account, and nothing about tax.
 *   Direct Expensing    the expense accounts charged, with VAT where there is any.
 *   Payroll Settlement  the liability being discharged.
 *   Remittance
 *
 * Used by /pv-slip/[no].
 */
import { one, all } from './db.ts';
import { formatDate, formatMoney } from './format.ts';
import { amountInWords } from './numberToWords.ts';
import {
  printBrand, documentMoney, documentSignatories, currencyLabel, renderDocument,
} from './documentPrint.ts';
import type { PrintDocument, PrintColumn, PrintRow } from './documentPrint.ts';
import type {
  PaymentVoucherType, PostedPaymentVoucher, PostedPaymentVoucherLine,
} from './types.ts';

export { renderDocument };

/** The AL tax voucher: what was billed, what was withheld, what the payee actually gets. */
const TAX_COLUMNS: PrintColumn[] = [
  { key: 'account', label: 'Account', width: '22%' },
  { key: 'description', label: 'Details' },
  { key: 'applies', label: 'Applied To', width: '13%' },
  { key: 'amount', label: 'Gross', align: 'right', width: '13%' },
  { key: 'deductions', label: 'VAT / WHT', align: 'right', width: '14%' },
  { key: 'net', label: 'Net', align: 'right', width: '13%' },
];

/** Everything else: no tax split to show, so the page shows the money instead. */
const PLAIN_COLUMNS: PrintColumn[] = [
  { key: 'account', label: 'Account', width: '30%' },
  { key: 'description', label: 'Details' },
  { key: 'applies', label: 'Applied To', width: '17%' },
  { key: 'amount', label: 'Amount', align: 'right', width: '17%' },
];

/** The title each Payment Type prints under — a refund never prints as a "Supplier Payment". */
const TITLES: Record<PaymentVoucherType, string> = {
  'Supplier Payment': 'Payment Voucher',
  'Customer Refund': 'Customer Refund Voucher',
  'Bank Transfer': 'Bank Transfer Voucher',
  'Direct Expensing': 'Payment Voucher',
  'Payroll Settlement': 'Payroll Settlement Voucher',
  Remittance: 'Remittance Voucher',
  'Employee Payment': 'Employee Payment Voucher',
};

/** Who the block at the top names. */
const PAYEE_HEADINGS: Record<PaymentVoucherType, string> = {
  'Supplier Payment': 'Pay to',
  'Customer Refund': 'Refunded to',
  'Bank Transfer': 'Transferred to',
  'Direct Expensing': 'Pay to',
  'Payroll Settlement': 'Pay to',
  Remittance: 'Remitted to',
  'Employee Payment': 'Paid to employee',
};

export async function buildPaymentVoucherDocument(no: string): Promise<PrintDocument | null> {
  const doc = await one<PostedPaymentVoucher & { paying_bank_name: string; employee_no: string | null; employee_name: string | null }>(
    `SELECT ppv.*, ba.name AS paying_bank_name, e.employee_no,
            TRIM(COALESCE(e.first_name, '') || ' ' || COALESCE(e.last_name, '')) AS employee_name
     FROM posted_payment_voucher ppv JOIN bank_account ba ON ba.id = ppv.paying_bank_account_id
     LEFT JOIN employee e ON e.id = ppv.employee_id
     WHERE ppv.no = ? OR ppv.pv_no = ?`, no, no,
  );
  if (!doc) return null;
  const brand = await printBrand();
  if (!brand) return null;
  const money = documentMoney(brand, doc.currency_code);
  const bare = (c: number): string => formatMoney(c, { showSymbol: false });

  const [lines, bank, branch] = await Promise.all([
    all<PostedPaymentVoucherLine>(
      'SELECT * FROM posted_payment_voucher_line WHERE posted_payment_voucher_id = ? ORDER BY line_no',
      doc.id,
    ),
    doc.payee_external_bank_code
      ? one<{ name: string }>('SELECT name FROM external_bank WHERE code = ?', doc.payee_external_bank_code)
      : Promise.resolve(undefined),
    doc.payee_bank_branch_code
      ? one<{ branch_name: string }>(
        'SELECT branch_name FROM external_bank_branch WHERE bank_code = ? AND branch_code = ?',
        doc.payee_external_bank_code, doc.payee_bank_branch_code,
      )
      : Promise.resolve(undefined),
  ]);

  const gross = lines.reduce((s, l) => s + l.amount, 0);
  const vat = lines.reduce((s, l) => s + l.vat_amount, 0);
  const wht = lines.reduce((s, l) => s + l.wht_amount_one + l.wht_amount_two, 0);

  const pvType: PaymentVoucherType = doc.pv_type ?? 'Direct Expensing';
  // A tax split is only worth a column when there is one: a bank transfer and a remittance never
  // carry VAT or WHT, and printing three empty columns on them is noise.
  const showTax = vat > 0 || wht > 0;
  const columns = showTax ? TAX_COLUMNS : PLAIN_COLUMNS;

  const rows: PrintRow[] = lines.map((l): PrintRow => ({
    cells: {
      account: [l.account_no, l.account_name].filter(Boolean).join(' — ') || l.account_name || '',
      description: l.description ?? '',
      applies: l.applies_to_doc_no ?? '—',
      amount: money(l.amount),
      // Narrow column: the currency is already on the Gross and Net figures beside it.
      deductions: [
        l.vat_amount ? `VAT ${bare(l.vat_amount)}` : null,
        l.wht_amount_one + l.wht_amount_two ? `WHT ${bare(l.wht_amount_one + l.wht_amount_two)}` : null,
      ].filter(Boolean).join('\n') || '—',
      net: money(l.net_amount),
    },
  }));

  return {
    brand,
    title: TITLES[pvType] ?? 'Payment Voucher',
    subtitle: doc.pv_no && doc.pv_no !== doc.no ? `Voucher ${doc.pv_no}` : null,
    status: { label: 'Posted', tone: 'ok' },
    parties: [{
      heading: PAYEE_HEADINGS[pvType] ?? 'Pay to',
      name: (pvType === 'Employee Payment' ? doc.employee_name : null) || doc.payee_name || '',
      lines: [
        pvType === 'Employee Payment' && doc.employee_no ? `Employee No. ${doc.employee_no}` : '',
        bank?.name ?? doc.payee_external_bank_code ?? '',
        branch?.branch_name ?? doc.payee_bank_branch_code ?? '',
        doc.payee_account_no ? `A/C No. ${doc.payee_account_no}` : '',
      ].filter(Boolean),
    }],
    meta: [
      { label: 'Voucher No.', value: doc.no },
      { label: 'Payment Type', value: pvType },
      { label: 'Date', value: formatDate(doc.date) },
      { label: 'Posting Date', value: formatDate(doc.posting_date) },
      { label: 'Paying Bank', value: doc.paying_bank_name },
      ...(doc.pay_mode_code ? [{ label: 'Payment Mode', value: doc.pay_mode_code }] : []),
      ...(doc.cheque_no
        ? [{
          label: 'Cheque / EFT No.',
          value: doc.cheque_date ? `${doc.cheque_no} (${formatDate(doc.cheque_date)})` : doc.cheque_no,
        }]
        : []),
      { label: 'Currency', value: doc.currency_code },
      { label: 'Net Paid', value: money(doc.total_amount), strong: true },
    ],
    columns,
    rows,
    totals: [
      ...(showTax || gross !== doc.total_amount ? [{ label: 'Gross amount', value: money(gross) }] : []),
      ...(vat ? [{ label: 'VAT included', value: money(vat) }] : []),
      ...(wht ? [{ label: 'Less: withholding tax', value: money(wht), negative: true }] : []),
      {
        label: `Net paid (${doc.currency_code})`,
        value: money(doc.total_amount), grand: true,
      },
    ],
    amount_words: amountInWords(doc.total_amount, currencyLabel(doc.currency_code)),
    notes: doc.description ? [{ heading: 'Being payment for', body: doc.description }] : [],
    // Checked / Approved / Authorised from the approval trail, then the payee's own receipt of
    // the money — the payee signs.
    approvals: await documentSignatories('PAYMENT_VOUCHER', doc.pv_no, doc.prepared_by ?? doc.created_by, {
      raisedAt: doc.created_at, clearedBy: doc.prepared_by ?? doc.created_by,
    }),
    acknowledgement: { title: 'Acknowledge receipt of the payment (payee)' },
    footnote: null,
  };
}
