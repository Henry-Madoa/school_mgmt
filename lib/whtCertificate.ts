/*
 * Withholding Tax Certificate — AL Rep52203485 "Witholding Tax Certificate". When a Payment
 * Voucher that withholds tax is posted, one certificate per distinct payee vendor is generated
 * from the WHT `vat_entry` rows. The certificate is the evidence the SACCO gives the supplier and
 * the basis of the monthly KRA remittance.
 */
import { one, all, run, nextSequence, audit } from './db.ts';
import type {
  Actor, IsoDate, PaymentVoucherHeader, PaymentVoucherLine, VatEntry, WhtCertificateDetail,
  WhtCertificateLine, WhtCertificateView,
} from './types.ts';

const WHT_SELECT = `
  SELECT c.*, COALESCE(v.no, '') AS vendor_no
  FROM wht_certificate c LEFT JOIN vendor v ON v.id = c.vendor_id`;

export const listWhtCertificates = (
  { vendorId, from, to, unremittedOnly }: { vendorId?: number; from?: IsoDate; to?: IsoDate; unremittedOnly?: boolean } = {},
): Promise<WhtCertificateView[]> => all<WhtCertificateView>(
  `${WHT_SELECT}
   WHERE 1=1
     ${vendorId ? 'AND c.vendor_id = @vendorId' : ''}
     ${from ? 'AND c.certificate_date >= @from' : ''}
     ${to ? 'AND c.certificate_date <= @to' : ''}
     ${unremittedOnly ? 'AND c.remitted = 0' : ''}
   ORDER BY c.no DESC`,
  { vendorId, from, to },
);

export async function getWhtCertificate(no: string): Promise<WhtCertificateDetail | undefined> {
  const header = await one<WhtCertificateView>(`${WHT_SELECT} WHERE c.no = ?`, no);
  if (!header) return undefined;
  const lines = await all<WhtCertificateLine>('SELECT * FROM wht_certificate_line WHERE wht_certificate_id = ? ORDER BY line_no', header.id);
  return { ...header, lines };
}

export const getWhtCertificatesForVoucher = (pvNo: string): Promise<WhtCertificateView[]> =>
  all<WhtCertificateView>(`${WHT_SELECT} WHERE c.payment_voucher_no = ? ORDER BY c.no`, pvNo);

/**
 * Called inside postPaymentVoucher's transaction, after the WHT `vat_entry` rows are written.
 * Groups those rows by payee vendor and writes one certificate each.
 */
export async function createWhtCertificateForVoucher(
  header: PaymentVoucherHeader, lines: PaymentVoucherLine[], vd: IsoDate, user: Actor,
): Promise<string[]> {
  const whtEntries = await all<VatEntry>(
    "SELECT * FROM vat_entry WHERE tax_type = 'WHT' AND document_no = ? AND source_id = ? ORDER BY id",
    header.no, header.id,
  );
  if (!whtEntries.length) return [];

  // Group by vendor no (a line with no vendor — e.g. a G/L expense — still withholds; attribute it
  // to the voucher's payee_name via a synthetic key).
  const byVendor = new Map<string, VatEntry[]>();
  for (const e of whtEntries) {
    const key = e.bill_to_pay_to_no ?? '__payee__';
    const bucket = byVendor.get(key) ?? [];
    bucket.push(e);
    byVendor.set(key, bucket);
  }

  const created: string[] = [];
  for (const [key, entries] of byVendor) {
    const vendorNo = key === '__payee__' ? null : key;
    const vendor = vendorNo
      ? await one<{ id: number; name: string; pin_no: string | null }>('SELECT id, name, pin_no FROM vendor WHERE no = ?', vendorNo)
      : null;
    const line = lines.find((l) => l.line_type === 'Vendor' && l.account_no === vendorNo) ?? lines[0];
    const grossForVendor = lines
      .filter((l) => (vendorNo ? l.account_no === vendorNo : true))
      .reduce((s, l) => s + l.amount, 0);
    const totalWht = entries.reduce((s, e) => s + e.amount, 0);

    const certNo = await nextSequence('WHT_CERTIFICATE');
    const info = await run(
      `INSERT INTO wht_certificate
         (no, vendor_id, vendor_name, vendor_pin, payment_voucher_no, certificate_date, gross_amount, total_wht, created_at, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      certNo, vendor?.id ?? null, vendor?.name ?? header.payee_name ?? null, vendor?.pin_no ?? entries[0]?.vendor_pin ?? null,
      header.no, vd, grossForVendor, totalWht, new Date().toISOString(), user.username,
    );
    const certId = Number(info.lastInsertRowid);
    let ln = 10000;
    for (const e of entries) {
      const wcode = e.vat_prod_posting_group_code ?? '';
      const grp = await one<{ description: string; vat_pct: number }>(
        `SELECT g.description, s.vat_pct
         FROM vat_product_posting_group g
         LEFT JOIN vat_posting_setup s ON s.vat_prod_posting_group_code = g.code
         WHERE g.code = ? LIMIT 1`, wcode,
      );
      await run(
        `INSERT INTO wht_certificate_line (wht_certificate_id, line_no, wht_code, description, rate, base, wht_amount, vat_entry_id)
         VALUES (?,?,?,?,?,?,?,?)`,
        certId, ln, wcode, grp?.description ?? wcode, grp?.vat_pct ?? 0, e.base, e.amount, e.id,
      );
      ln += 10000;
    }
    await run('UPDATE vat_entry SET wht_certificate_no = ? WHERE id IN (' + entries.map(() => '?').join(',') + ')', certNo, ...entries.map((e) => e.id));
    void line;
    created.push(certNo);
  }
  await audit(user, 'WHT_CERTIFICATE_CREATE', 'wht_certificate', header.no, { certificates: created });
  return created;
}

export async function markWhtCertificateRemitted(no: string, remittanceRef: string, user: Actor): Promise<void> {
  const cert = await one<{ id: number }>('SELECT id FROM wht_certificate WHERE no = ?', no);
  if (!cert) throw new Error('Certificate not found');
  await run('UPDATE wht_certificate SET remitted = 1, remittance_ref = ? WHERE id = ?', remittanceRef, cert.id);
  await run(
    `UPDATE vat_entry SET closed = 1
     WHERE tax_type = 'WHT' AND wht_certificate_no = ?`, no,
  );
  await audit(user, 'WHT_CERTIFICATE_REMIT', 'wht_certificate', no, { remittanceRef });
}
