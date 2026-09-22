/*
 * Withholding Tax Certificate printout — AL Rep52203485, rendered through the shared document
 * chrome in lib/documentPrint.ts.
 *
 * Split from lib/whtCertificate.ts so the certificate creation / query logic stays free of the
 * org.ts → cloudinary.ts ('server-only') import chain (the fixture suite imports
 * whtCertificate.ts directly). Used by /wht-certificate/[no].
 */
import { formatDate } from './format.ts';
import { amountInWords } from './numberToWords.ts';
import { getWhtCertificate } from './whtCertificate.ts';
import { signatureFor } from './userSignatures.ts';
import { printBrand, documentMoney, currencyLabel, renderDocument } from './documentPrint.ts';
import type { PrintDocument, PrintRow } from './documentPrint.ts';

export { renderDocument };

export async function buildWhtCertificateDocument(no: string): Promise<PrintDocument | null> {
  const cert = await getWhtCertificate(no);
  if (!cert) return null;
  const brand = await printBrand();
  if (!brand) return null;
  const money = documentMoney(brand, brand.currency_code);
  const issuedBy = await signatureFor(cert.created_by);

  return {
    brand,
    title: 'Withholding Tax Certificate',
    subtitle: 'Issued under the Income Tax Act',
    parties: [{
      heading: 'Tax withheld from',
      name: cert.vendor_name ?? '',
      lines: [cert.vendor_pin ? `PIN ${cert.vendor_pin}` : ''].filter(Boolean),
    }],
    meta: [
      { label: 'Certificate No.', value: cert.no },
      { label: 'Date', value: formatDate(cert.certificate_date) },
      { label: 'Payment Voucher', value: cert.payment_voucher_no },
      { label: 'Gross Amount', value: money(cert.gross_amount) },
      { label: 'Total Tax Withheld', value: money(cert.total_wht), strong: true },
    ],
    columns: [
      { key: 'nature', label: 'Nature of payment' },
      { key: 'rate', label: 'Rate', align: 'right', width: '12%' },
      { key: 'base', label: 'Amount subject to WHT', align: 'right', width: '25%' },
      { key: 'withheld', label: 'Tax withheld', align: 'right', width: '22%' },
    ],
    rows: cert.lines.map((l): PrintRow => ({
      cells: {
        nature: l.description ?? l.wht_code,
        rate: `${l.rate}%`,
        base: money(l.base),
        withheld: money(l.wht_amount),
      },
    })),
    totals: [
      { label: 'Gross amount', value: money(cert.gross_amount) },
      { label: 'Total tax withheld', value: money(cert.total_wht), grand: true },
    ],
    amount_words: amountInWords(cert.total_wht, currencyLabel(brand.currency_code)),
    signatures: [
      { label: 'Authorised signature', block: issuedBy },
      { label: 'Official stamp', block: null },
    ],
    footnote: 'This certificate is issued as evidence of tax withheld and remitted to the '
      + 'Kenya Revenue Authority on the payment shown above.',
  };
}
