/*
 * VAT + Withholding Tax engine — the shared arithmetic and the VAT Entry ledger. The AL
 * "SACCODEMO" localization (Cod52203434, Tab52203440) reuses Business Central's VAT Posting Setup
 * for both taxes: a VAT Product Posting Group carries a Type of VAT | WHT, and the setup row for a
 * (VAT Bus. Posting Group × Code) pair holds the % and the G/L account — the input-VAT account for
 * VAT rows, the tax-payable account for WHT rows.
 *
 * Rounding follows the AL: `Round(x, 1, '>')` — to the whole cent, always up.
 */
import { one, all, run } from './db.ts';
import { AppError } from './errors.ts';
import { toLcy } from './currency.ts';
import { addVatToNet, extractVatFromGross, roundUpCents as roundUp } from './documentTotals.ts';
import type { Cents, IsoDate, LineTaxResult, TaxType, VatCalculationType, VatEntry } from './types.ts';

export interface ResolvedVatSetup {
  tax_type: TaxType;
  vat_pct: number;
  vat_calculation_type: VatCalculationType;
  tax_account_id: number | null;
  wht_base: 'Net' | 'Gross';
}

/** BC "VAT Posting Setup".Get — throws (AL parity) when the pair is not set up. */
export async function resolveVatSetup(
  vatBusCode: string | null | undefined, vatProdCode: string | null | undefined,
): Promise<ResolvedVatSetup | null> {
  if (!vatProdCode) return null;
  const bus = vatBusCode ?? '';
  const row = await one<ResolvedVatSetup & { blocked: number }>(
    `SELECT tax_type, vat_pct, vat_calculation_type, tax_account_id, wht_base, blocked
     FROM vat_posting_setup
     WHERE vat_bus_posting_group_code = ? AND vat_prod_posting_group_code = ?`,
    bus, vatProdCode,
  );
  if (!row) {
    throw new AppError(
      `There is no VAT Posting Setup for ${bus || '(blank)'} × ${vatProdCode} — ask an administrator to add it`,
      'NO_VAT_POSTING_SETUP',
    );
  }
  if (row.blocked) throw new AppError(`VAT Posting Setup ${bus} × ${vatProdCode} is blocked`, 'VALIDATION');
  return {
    tax_type: row.tax_type, vat_pct: row.vat_pct, vat_calculation_type: row.vat_calculation_type,
    tax_account_id: row.tax_account_id, wht_base: row.wht_base,
  };
}

// The arithmetic itself lives in lib/documentTotals.ts, which has no database import so the
// document line editor can preview these very numbers as the user types. Re-exported here
// because the posting routines have always reached for them through this module.
export { extractVatFromGross, addVatToNet };

export interface ComputeLineTaxInput {
  /** The figure the user entered. `pricesInclVat` decides whether it is gross or the net base. */
  enteredAmount: Cents;
  pricesInclVat: boolean;
  vatPct: number;
  /** WHT rates already resolved from their own VAT Posting Setup rows (0 when no code). */
  whtOnePct: number;
  whtTwoPct: number;
  /** 'Net' applies WHT to the amount net of VAT (the AL default); 'Gross' to the full amount. */
  whtBase: 'Net' | 'Gross';
  /** When true (a Vendor line applied to an invoice) VAT was already taken at the invoice. */
  suppressVat?: boolean;
}

/**
 * The single source of the AL "Payment Voucher Lines".Amount arithmetic, also used by the
 * purchase-line editor. Returns every derived figure; the caller decides which to store.
 */
export function computeLineTax(i: ComputeLineTaxInput): LineTaxResult {
  const vatPct = i.suppressVat ? 0 : i.vatPct;
  let vatBase: Cents;
  let vatAmount: Cents;
  if (i.pricesInclVat) {
    vatAmount = extractVatFromGross(i.enteredAmount, vatPct);
    vatBase = i.enteredAmount - vatAmount;
  } else {
    vatBase = i.enteredAmount;
    vatAmount = addVatToNet(i.enteredAmount, vatPct);
  }
  const netOfVat = i.pricesInclVat ? i.enteredAmount - vatAmount : i.enteredAmount;
  const whtBaseAmount = i.whtBase === 'Gross'
    ? (i.pricesInclVat ? i.enteredAmount : i.enteredAmount + vatAmount)
    : netOfVat;
  const whtOne = i.whtOnePct > 0 ? roundUp(whtBaseAmount * (i.whtOnePct / 100)) : 0;
  const whtTwo = i.whtTwoPct > 0 ? roundUp(whtBaseAmount * (i.whtTwoPct / 100)) : 0;
  // Cash actually paid for the line: VAT is passed through to the payee, WHT is withheld.
  const grossForLine = i.pricesInclVat ? i.enteredAmount : i.enteredAmount + vatAmount;
  const netPaid = grossForLine - whtOne - whtTwo;
  return { vatBase, vatAmount, netOfVat, whtBase: whtBaseAmount, whtOne, whtTwo, netPaid };
}

export interface PostVatEntryInput {
  postingDate: IsoDate;
  documentType: string;
  documentNo: string;
  type?: 'Purchase' | 'Settlement';
  taxType: TaxType;
  vatBus: string | null;
  vatProd: string | null;
  vatPct: number;
  /** FCY figures — LCY is derived with `currencyFactor`. */
  base: Cents;
  amount: Cents;
  currencyCode?: string;
  currencyFactor?: number;
  vendorNo?: string | null;
  vendorPin?: string | null;
  whtCertificateNo?: string | null;
  journalId?: number | null;
  sourceType?: string | null;
  sourceId?: number | null;
}

export async function postVatEntry(i: PostVatEntryInput): Promise<number> {
  const factor = i.currencyFactor && i.currencyFactor > 0 ? i.currencyFactor : 1;
  const code = i.currencyCode || 'KES';
  const info = await run(
    `INSERT INTO vat_entry
       (posting_date, document_type, document_no, type, tax_type, vat_bus_posting_group_code,
        vat_prod_posting_group_code, vat_pct, base, amount, base_fcy, amount_fcy, currency_code,
        currency_factor, bill_to_pay_to_no, vendor_pin, wht_certificate_no, journal_id,
        source_type, source_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    i.postingDate, i.documentType, i.documentNo, i.type ?? 'Purchase', i.taxType, i.vatBus, i.vatProd,
    i.vatPct, toLcy(i.base, factor), toLcy(i.amount, factor), i.base, i.amount, code, factor,
    i.vendorNo ?? null, i.vendorPin ?? null, i.whtCertificateNo ?? null, i.journalId ?? null,
    i.sourceType ?? null, i.sourceId ?? null, new Date().toISOString(),
  );
  return Number(info.lastInsertRowid);
}

export interface ListVatEntriesOptions {
  from?: IsoDate; to?: IsoDate; taxType?: TaxType; vendorNo?: string; openOnly?: boolean;
}

export const listVatEntries = (o: ListVatEntriesOptions = {}): Promise<VatEntry[]> =>
  all<VatEntry>(
    `SELECT * FROM vat_entry
     WHERE 1=1
       ${o.from ? 'AND posting_date >= @from' : ''}
       ${o.to ? 'AND posting_date <= @to' : ''}
       ${o.taxType ? 'AND tax_type = @taxType' : ''}
       ${o.vendorNo ? 'AND bill_to_pay_to_no = @vendorNo' : ''}
       ${o.openOnly ? 'AND closed = 0' : ''}
     ORDER BY posting_date, id`,
    { from: o.from, to: o.to, taxType: o.taxType, vendorNo: o.vendorNo },
  );

/** Mark WHT entries remitted to KRA. Called when a Payment Voucher / journal clears 2190 / 2195,
 *  or manually from the WHT Analysis screen. */
export async function settleWhtEntries(entryIds: number[], remittanceRef: string): Promise<number> {
  if (!entryIds.length) return 0;
  const placeholders = entryIds.map(() => '?').join(',');
  const info = await run(
    `UPDATE vat_entry SET closed = 1
     WHERE tax_type = 'WHT' AND closed = 0 AND id IN (${placeholders})`,
    ...entryIds,
  );
  void remittanceRef;
  return info.changes;
}
