/*
 * Business Central's document totals, as pure arithmetic.
 *
 * BC shows a running Line Amount on every sales/purchase line and a totals block under the Lines
 * FastTab (Subtotal, line discounts, Total Excl. VAT, VAT, Total Incl. VAT) that updates as you
 * type — before anything is posted. This module is what makes that possible on the client: it has
 * no database import, so the line editor can call it on every keystroke, while the servers'
 * setPurchaseLines() / setSalesLines() stay the authority on what is actually stored.
 *
 * Every step here mirrors lib/purchaseDocuments.ts and lib/salesDocuments.ts line for line —
 * the same quantity rules (a Comment line bills nothing, a Fixed Asset line is always quantity 1),
 * the same discount rounding (Math.round on the gross), and the same VAT extraction. If those
 * change, change them here too or the preview will drift from the posted document.
 */
import type { Cents } from './types.ts';

/** Round to the whole cent, always up — AL `Round(x, 1, '>')`, as lib/vatEngine.ts posts it. */
export const roundUpCents = (n: number): number => Math.ceil(n - 1e-9);

/** VAT contained in a VAT-inclusive gross amount. */
export const extractVatFromGross = (gross: Cents, pct: number): Cents =>
  (pct > 0 ? roundUpCents(gross / (1 + pct / 100) * (pct / 100)) : 0);

/** VAT to add on top of a VAT-exclusive net amount. */
export const addVatToNet = (net: Cents, pct: number): Cents => (pct > 0 ? roundUpCents(net * (pct / 100)) : 0);

/** One line as the editor holds it: a type, a quantity, a unit amount in cents and a discount. */
export interface DocumentLineDraft {
  type: string;
  no?: string | null;
  quantity: number;
  /** Direct Unit Cost on a purchase line, Unit Price on a sales line. */
  unitAmount: Cents;
  lineDiscountPct?: number;
  /** VAT % for this line, already resolved from the VAT Posting Setup. 0 on a sales line. */
  vatPct?: number;
}

export interface LineAmounts {
  /** What actually bills: 0 on a Comment, 1 on a Fixed Asset, the entered quantity otherwise. */
  quantity: number;
  /** Quantity × unit amount, before the line discount. */
  gross: Cents;
  discountPct: number;
  discountAmount: Cents;
  /** BC's "Line Amount": gross less the line discount, always VAT-exclusive. */
  lineAmount: Cents;
  vatPct: number;
  vatAmount: Cents;
  amountInclVat: Cents;
}

export interface DocumentTotalsOptions {
  /** BC's Purchases & Payables Setup "Prices Including VAT" — the entered amount is then gross. */
  pricesInclVat?: boolean;
}

/** The billing quantity BC uses: a Comment bills nothing, a Fixed Asset is acquired once. */
const billedQuantity = (type: string, quantity: number): number =>
  (type === 'Comment' ? 0 : type === 'Fixed Asset' ? 1 : quantity);

export function computeLineAmounts(line: DocumentLineDraft, opts: DocumentTotalsOptions = {}): LineAmounts {
  const quantity = billedQuantity(line.type, Number(line.quantity) || 0);
  const gross = Math.round(quantity * (Number(line.unitAmount) || 0));
  const discountPct = Math.max(0, Math.min(100, Number(line.lineDiscountPct) || 0));
  const discountAmount = Math.round(gross * discountPct / 100);
  const entered = line.type === 'Comment' ? 0 : gross - discountAmount;

  const vatPct = line.type === 'Comment' ? 0 : (Number(line.vatPct) || 0);
  let vatAmount = 0;
  let lineAmount = entered;
  if (vatPct > 0) {
    if (opts.pricesInclVat) {
      vatAmount = extractVatFromGross(entered, vatPct);
      lineAmount = entered - vatAmount;
    } else {
      vatAmount = addVatToNet(entered, vatPct);
    }
  }
  return {
    quantity,
    gross: line.type === 'Comment' ? 0 : gross,
    discountPct,
    discountAmount: line.type === 'Comment' ? 0 : discountAmount,
    lineAmount,
    vatPct,
    vatAmount,
    amountInclVat: lineAmount + vatAmount,
  };
}

export interface DocumentTotals {
  /** Lines that actually bill — a blank row the user has not filled in yet is not counted. */
  lineCount: number;
  /** Σ quantity × unit amount, before discounts — BC's Subtotal before line discounts. */
  subtotal: Cents;
  /** Σ line discount amounts. */
  discountTotal: Cents;
  /** Σ Line Amount — BC's "Total Excl. VAT", and what the header's `amount` column holds. */
  totalExclVat: Cents;
  vatAmount: Cents;
  /** BC's "Total Incl. VAT", and what a purchase header's `amount_incl_vat` column holds. */
  totalInclVat: Cents;
}

/** Adds the lines up the way the posting routine will. Rows with no No. (and that are not
 *  Comments) are skipped, exactly as setPurchaseLines()/setSalesLines() skip them. */
export function computeDocumentTotals(
  lines: readonly DocumentLineDraft[], opts: DocumentTotalsOptions = {},
): DocumentTotals {
  const billable = lines.filter((l) => l.type === 'Comment' || (l.no ?? '') !== '');
  return billable.reduce<DocumentTotals>((totals, line) => {
    const a = computeLineAmounts(line, opts);
    return {
      lineCount: totals.lineCount + (line.type === 'Comment' ? 0 : 1),
      subtotal: totals.subtotal + a.gross,
      discountTotal: totals.discountTotal + a.discountAmount,
      totalExclVat: totals.totalExclVat + a.lineAmount,
      vatAmount: totals.vatAmount + a.vatAmount,
      totalInclVat: totals.totalInclVat + a.amountInclVat,
    };
  }, { lineCount: 0, subtotal: 0, discountTotal: 0, totalExclVat: 0, vatAmount: 0, totalInclVat: 0 });
}

/**
 * The VAT Posting Setup, flattened for the client: `rates[vatBusCode][vatProdCode] = pct`, plus
 * the VAT Product Posting Group each G/L account defaults to. Together they let the line editor
 * resolve the same VAT % that lib/vatEngine.ts's resolveVatSetup() will resolve on save.
 */
export interface VatPreview {
  rates: Record<string, Record<string, number>>;
  /** G/L account code -> its VAT Prod. Posting Group (Item and Fixed Asset lines carry none). */
  accountVatProd: Record<string, string | null>;
  /** Falls back to the Purchases & Payables Setup default when the vendor carries none. */
  defaultVatBus: string | null;
  pricesInclVat: boolean;
}

/** The VAT % a line will attract, or 0 when the pair is not set up (the save will say so). */
export function previewVatPct(
  preview: VatPreview | undefined, vatBusCode: string | null | undefined, type: string, no: string | null | undefined,
): number {
  if (!preview || type !== 'G/L Account' || !no) return 0;
  const prod = preview.accountVatProd[no];
  if (!prod) return 0;
  return preview.rates[vatBusCode || preview.defaultVatBus || '']?.[prod] ?? 0;
}
