/*
 * VAT + Withholding Tax listings — the input for the manual monthly KRA returns. The VAT Input
 * Listing feeds the VAT3; the WHT Analysis feeds the withholding-tax return / i-Tax bulk upload.
 * Both read the `vat_entry` ledger (BC "VAT Entry").
 */
import { all } from './db.ts';
import type { IsoDate, VatInputListingRow, WhtAnalysisRow } from './types.ts';

export const vatInputListing = (
  { from, to }: { from: IsoDate; to: IsoDate },
): Promise<VatInputListingRow[]> => all<VatInputListingRow>(
  `SELECT e.vat_prod_posting_group_code,
          p.description,
          MAX(e.vat_pct) AS vat_pct,
          COALESCE(SUM(e.base), 0)   AS base,
          COALESCE(SUM(e.amount), 0) AS amount,
          COUNT(*) AS entry_count
   FROM vat_entry e
   LEFT JOIN vat_product_posting_group p ON p.code = e.vat_prod_posting_group_code
   WHERE e.tax_type = 'VAT' AND e.posting_date >= @from AND e.posting_date <= @to
   GROUP BY e.vat_prod_posting_group_code, p.description
   ORDER BY e.vat_prod_posting_group_code`,
  { from, to },
);

export const whtAnalysis = (
  { from, to, vendorNo }: { from: IsoDate; to: IsoDate; vendorNo?: string },
): Promise<WhtAnalysisRow[]> => all<WhtAnalysisRow>(
  `SELECT e.bill_to_pay_to_no,
          v.name AS vendor_name,
          e.vendor_pin,
          e.vat_prod_posting_group_code AS wht_code,
          MAX(s.vat_pct) AS rate,
          COALESCE(SUM(e.base), 0)   AS base,
          COALESCE(SUM(e.amount), 0) AS amount,
          COUNT(*) AS entry_count
   FROM vat_entry e
   LEFT JOIN vendor v ON v.no = e.bill_to_pay_to_no
   LEFT JOIN vat_posting_setup s ON s.vat_prod_posting_group_code = e.vat_prod_posting_group_code
   WHERE e.tax_type = 'WHT' AND e.posting_date >= @from AND e.posting_date <= @to
     ${vendorNo ? 'AND e.bill_to_pay_to_no = @vendorNo' : ''}
   GROUP BY e.bill_to_pay_to_no, v.name, e.vendor_pin, e.vat_prod_posting_group_code
   ORDER BY v.name NULLS LAST, e.vat_prod_posting_group_code`,
  { from, to, vendorNo },
);
