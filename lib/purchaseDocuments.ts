/*
 * Purchase Documents — Business Central Purchase Quote / Order / Invoice / Credit Memo
 * (Tables 38/39), posting to the vendor subledger (lib/vendLedger.ts), the G/L (postJournal),
 * the item ledger (Item lines — stock in + inventory value, via lib/inventoryCosting.ts's
 * receiveItemStock) and the FA subledger (Fixed Asset lines — acquisition, via lib/fixedAssets.ts's
 * acquireFixedAssetForPurchase). The mirror of lib/salesDocuments.ts.
 *
 * Lifecycle (maker-checker): Open -> Pending Approval -> Released (BC "Release") -> Posted.
 * A Quote is converted to an Order (makeOrder). An Order supports partial Receive / Invoice; a
 * fully received + invoiced Order is deleted. Invoice and Credit Memo post all-or-nothing.
 *
 * G/L effect (a Credit Memo reverses every sign):
 *   (header)     —                              Cr vendor_posting_group.payables_account = invoice total
 *   G/L Account  Dr the line's account          —
 *   Item receive Dr inventory_gl_account        Cr 2160 GRNI
 *   Item invoice Dr 2160 GRNI                    — (the Cr is in the header Payables credit)
 *   Fixed Asset  Dr Acquisition Cost account    —
 */
import { one, all, run, tx, nextSequence, audit, hasAnyRow } from './db.ts';
import { AppError } from './errors.ts';
import { postJournal } from './accounting.ts';
import { getEffectivePostingRange } from './postingDates.ts';
import { applyDateFormula } from './dateFormula.ts';
import { resolveDocCurrency } from './currency.ts';
import { receiveItemStock } from './inventoryCosting.ts';
import { acquireFixedAssetForPurchase } from './fixedAssets.ts';
import { createVendorLedgerEntry, applyVendorEntries, recomputeVendorBalance } from './vendLedger.ts';
import { resolveVatSetup, addVatToNet, extractVatFromGross, postVatEntry } from './vatEngine.ts';
import { getPurchasesPayablesSetup } from './payablesSetup.ts';
import { checkVendorAllowed } from './vendors.ts';
import { findMatchingWorkflow, findPendingRoutedTask, pickConditionFields, startWorkflow } from './workflow.ts';
import { buildFilterClause, type FilterCondition, type FilterFieldDef } from './listFilters.ts';
import { buildOrderClause, type SortState } from './listSort.ts';
import type {
  Actor, Cents, IsoDate, PurchaseDocumentDetail, PurchaseDocumentType, PurchaseHeader, PurchaseHeaderView,
  PurchaseLine, PurchaseLineType, PostedPurchaseDocumentView, PostedPurchaseLine,
} from './types.ts';

/**
 * The status buckets a document list is split into. Business Central keeps a document's own
 * Status at Open | Pending Approval | Released and records the rejection against the approval
 * entry — rejecting sends the document back to Open with the reason on it (see
 * rejectPurchaseDocument below). "Rejected" is therefore a view over Open, not a fourth status,
 * and the two are kept disjoint so every document sits in exactly one bucket.
 */
export type PurchaseDocView = 'all' | 'open' | 'pending' | 'released' | 'rejected';

const VIEW_CLAUSE: Record<Exclude<PurchaseDocView, 'all'>, string> = {
  open: "ph.status = 'Open' AND ph.decision_reason IS NULL",
  pending: "ph.status = 'Pending Approval'",
  released: "ph.status = 'Released'",
  rejected: "ph.status = 'Open' AND ph.decision_reason IS NOT NULL",
};

export const PURCHASE_DOC_VIEWS: PurchaseDocView[] = ['all', 'open', 'pending', 'released', 'rejected'];

const DOCUMENT_TYPES: PurchaseDocumentType[] = ['Quote', 'Order', 'Invoice', 'Credit Memo'];
const LINE_TYPES: PurchaseLineType[] = ['Comment', 'G/L Account', 'Item', 'Fixed Asset'];

const NO_SERIES_FOR: Record<PurchaseDocumentType, string> = {
  Quote: 'PURCHASE_QUOTE', Order: 'PURCHASE_ORDER', Invoice: 'PURCHASE_INVOICE', 'Credit Memo': 'PURCHASE_CREDIT_MEMO',
};

const GRNI_CODE = '2160';

const SELECT_ROW = `
  SELECT ph.*, v.no AS vendor_no, v.name AS vendor_name, v.blocked AS vendor_blocked
  FROM purchase_header ph JOIN vendor v ON v.id = ph.vendor_id`;

export const PURCHASE_DOC_FILTER_FIELDS: FilterFieldDef[] = [
  { key: 'no', label: 'No.', type: 'text', column: 'ph.no' },
  { key: 'vendor_id', label: 'Vendor', type: 'select', column: 'ph.vendor_id' },
  { key: 'posting_date', label: 'Posting Date', type: 'date', column: 'ph.posting_date' },
  { key: 'vendor_invoice_no', label: 'Vendor Invoice No.', type: 'text', column: 'ph.vendor_invoice_no' },
  { key: 'created_by', label: 'Created By', type: 'text', column: 'ph.created_by' },
];

const SORT_COLUMNS: Record<string, string> = {
  no: 'ph.no', vendor: 'v.no', posting_date: 'ph.posting_date', amount: 'ph.amount',
  status: 'ph.status', due_date: 'ph.due_date',
};

export interface ListPurchaseDocumentsOptions {
  documentType: PurchaseDocumentType;
  view?: PurchaseDocView;
  search?: string;
  filters?: FilterCondition[];
  sort?: SortState | null;
}

export const listPurchaseDocuments = (
  { documentType, view, search = '', filters = [], sort = null }: ListPurchaseDocumentsOptions,
): Promise<PurchaseHeaderView[]> => {
  const { clause, params } = buildFilterClause(PURCHASE_DOC_FILTER_FIELDS, filters);
  const orderBy = buildOrderClause(SORT_COLUMNS, sort, 'ph.no DESC');
  return all<PurchaseHeaderView>(
    `${SELECT_ROW}
     WHERE ph.document_type = @docType
       AND (ph.no ILIKE @like OR v.no ILIKE @like OR v.name ILIKE @like OR ph.vendor_invoice_no ILIKE @like)
       ${view && view !== 'all' ? `AND ${VIEW_CLAUSE[view]}` : ''}
       ${clause}
     ${orderBy}`,
    { docType: documentType, like: `%${String(search).trim()}%`, ...params },
  );
};

/** How many documents sit in each status bucket — the counts on the list's view tabs. */
export async function purchaseDocCounts(documentType: PurchaseDocumentType): Promise<Record<PurchaseDocView, number>> {
  const rows = await all<{ status: string; rejected: number; n: number }>(
    `SELECT ph.status, CASE WHEN ph.decision_reason IS NULL THEN 0 ELSE 1 END AS rejected, COUNT(*) AS n
     FROM purchase_header ph WHERE ph.document_type = ? GROUP BY ph.status, rejected`,
    documentType,
  );
  const counts: Record<PurchaseDocView, number> = { all: 0, open: 0, pending: 0, released: 0, rejected: 0 };
  for (const r of rows) {
    const n = Number(r.n);
    counts.all += n;
    if (r.status === 'Pending Approval') counts.pending += n;
    else if (r.status === 'Released') counts.released += n;
    else if (Number(r.rejected)) counts.rejected += n;
    else counts.open += n;
  }
  return counts;
}

export async function getPurchaseDocument(no: string): Promise<PurchaseDocumentDetail | undefined> {
  const header = await one<PurchaseHeaderView>(`${SELECT_ROW} WHERE ph.no = ?`, no);
  if (!header) return undefined;
  const lines = await all<PurchaseLine>('SELECT * FROM purchase_line WHERE purchase_header_id = ? ORDER BY line_no', header.id);
  const outstanding = lines.reduce((s, l) => s + l.line_amount, 0);
  const receivedNotInvoiced = lines.reduce(
    (s, l) => s + (l.quantity > 0 ? Math.round((l.qty_received - l.qty_invoiced) / l.quantity * l.line_amount) : 0), 0,
  );
  return { ...header, lines, outstanding_amount: outstanding, received_not_invoiced: receivedNotInvoiced };
}

/** The posted document a source header became, if it has been posted — posting deletes the
 *  header, but the posted row keeps its number as source_no. Lets a link to the document (an
 *  approval notification, say) still land somewhere useful after posting. Newest first, since
 *  an order can be invoiced more than once. */
export const findPostedDocumentBySource = (sourceNo: string): Promise<{ no: string } | undefined> =>
  one<{ no: string }>('SELECT no FROM posted_purchase_document WHERE source_no = ? ORDER BY id DESC LIMIT 1', sourceNo);

export const hasAnyPurchaseDocuments = (documentType?: PurchaseDocumentType): Promise<boolean> =>
  hasAnyRow('purchase_header ph', documentType ? `ph.document_type = '${documentType}'` : undefined);

/* -------------------------------------------------------------------- header / lines */

export interface PurchaseHeaderInput {
  documentType: PurchaseDocumentType;
  vendorId: number;
  postingDate: IsoDate;
  documentDate: IsoDate;
  paymentTermsCode?: string | null;
  paymentMethodCode?: string | null;
  vendorInvoiceNo?: string | null;
  /** BC "Applies-to Doc. No." — on a credit memo, the posted invoice it settles when it posts. */
  appliesToDocNo?: string | null;
  purchaser?: string | null;
  /** Transaction currency; omitted → the vendor's default currency, else KES. */
  currencyCode?: string | null;
  /** AL "Requisition No" — set when procurement raises the document from a purchase requisition. */
  requisitionNo?: string | null;
}

export interface PurchaseLineInput {
  type: PurchaseLineType;
  no: string | null;
  description?: string | null;
  quantity: number;
  directUnitCost: Cents;
  lineDiscountPct?: number;
  locationCode?: string | null;
  faDepreciationBookCode?: string | null;
  /** VAT Product Posting Group; omitted → defaulted from the G/L account. Blank = no VAT. */
  vatProdPostingGroupCode?: string | null;
}

interface LoadedVendor {
  id: number; no: string; name: string; blocked: string; vendor_posting_group_code: string | null;
  vat_bus_posting_group_code: string | null; pin_no: string | null; wht_exempt: number;
  payment_terms_code: string | null; currency_code: string | null;
  address: string | null; city: string | null; contact: string | null;
}

async function loadVendor(id: number): Promise<LoadedVendor> {
  const v = await one<LoadedVendor>(
    `SELECT id, no, name, blocked, vendor_posting_group_code, vat_bus_posting_group_code, pin_no,
            wht_exempt, payment_terms_code, currency_code, address, city, contact
     FROM vendor WHERE id = ?`, id,
  );
  if (!v) throw new AppError('Vendor not found', 'NOT_FOUND');
  return v;
}

export async function createPurchaseDocument(input: PurchaseHeaderInput, user: Actor): Promise<{ no: string }> {
  if (!DOCUMENT_TYPES.includes(input.documentType)) throw new AppError('Invalid document type', 'VALIDATION');
  if (!input.postingDate) throw new AppError('A posting date is required', 'VALIDATION');
  const vendor = await loadVendor(input.vendorId);
  const setup = await getPurchasesPayablesSetup();
  const paymentTerms = input.paymentTermsCode || vendor.payment_terms_code || setup.default_payment_terms_code;
  const vatBus = vendor.vat_bus_posting_group_code || setup.default_vat_bus_posting_group_code;
  const cur = await resolveDocCurrency(input.currencyCode ?? vendor.currency_code, input.documentDate || input.postingDate);
  const no = await nextSequence(NO_SERIES_FOR[input.documentType]);
  await run(
    `INSERT INTO purchase_header
       (document_type, no, vendor_id, posting_date, document_date, payment_terms_code, payment_method_code,
        vendor_posting_group_code, vat_bus_posting_group_code, vendor_invoice_no, applies_to_doc_no, purchaser, currency_code,
        currency_factor, requisition_no, created_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    input.documentType, no, vendor.id, input.postingDate, input.documentDate || input.postingDate,
    paymentTerms || null, input.paymentMethodCode || null, vendor.vendor_posting_group_code, vatBus || null,
    input.vendorInvoiceNo?.trim() || null, input.appliesToDocNo?.trim() || null, input.purchaser?.trim() || null, cur.code, cur.factor,
    input.requisitionNo?.trim() || null, new Date().toISOString(), user.username,
  );
  await audit(user, 'PURCHASE_DOCUMENT_CREATE', 'purchase_header', no, { documentType: input.documentType, vendor: vendor.no });
  return { no };
}

export async function updatePurchaseDocumentHeader(no: string, input: PurchaseHeaderInput, user: Actor): Promise<void> {
  const before = await one<PurchaseHeader>('SELECT * FROM purchase_header WHERE no = ?', no);
  if (!before) throw new AppError('Purchase document not found', 'NOT_FOUND');
  if (before.status !== 'Open') throw new AppError('Only an open document can be edited', 'VALIDATION');
  if (before.created_by !== user.username) throw new AppError('Only the person who created this can edit it', 'NOT_CREATOR');
  const vendor = await loadVendor(input.vendorId);
  const setup = await getPurchasesPayablesSetup();
  const vatBus = vendor.vat_bus_posting_group_code || setup.default_vat_bus_posting_group_code;
  const cur = await resolveDocCurrency(input.currencyCode ?? before.currency_code, input.documentDate || input.postingDate);
  await run(
    `UPDATE purchase_header SET vendor_id = ?, posting_date = ?, document_date = ?, payment_terms_code = ?,
       payment_method_code = ?, vendor_posting_group_code = ?, vat_bus_posting_group_code = ?,
       vendor_invoice_no = ?, applies_to_doc_no = ?, purchaser = ?, currency_code = ?, currency_factor = ? WHERE no = ?`,
    vendor.id, input.postingDate, input.documentDate || input.postingDate, input.paymentTermsCode || null,
    input.paymentMethodCode || null, vendor.vendor_posting_group_code, vatBus || null,
    input.vendorInvoiceNo?.trim() || null, input.appliesToDocNo?.trim() || null, input.purchaser?.trim() || null, cur.code, cur.factor, no,
  );
  await audit(user, 'PURCHASE_DOCUMENT_UPDATE', 'purchase_header', no, {});
}

export async function deletePurchaseDocument(no: string, user: Actor): Promise<void> {
  const before = await one<Pick<PurchaseHeader, 'status' | 'created_by'>>('SELECT status, created_by FROM purchase_header WHERE no = ?', no);
  if (!before) throw new AppError('Purchase document not found', 'NOT_FOUND');
  if (before.status !== 'Open') throw new AppError('Only an open document can be deleted', 'VALIDATION');
  if (before.created_by !== user.username) throw new AppError('Only the person who created this can delete it', 'NOT_CREATOR');
  await run('DELETE FROM purchase_header WHERE no = ?', no);
  await audit(user, 'PURCHASE_DOCUMENT_DELETE', 'purchase_header', no, {});
}

interface ResolvedLine { description: string; directUnitCost: Cents; vatProdCode: string | null }

async function resolveLine(input: PurchaseLineInput): Promise<ResolvedLine> {
  const vatProd = input.vatProdPostingGroupCode?.trim() || null;
  if (!LINE_TYPES.includes(input.type)) throw new AppError('Invalid line type', 'VALIDATION');
  if (input.type === 'Comment') return { description: input.description?.trim() || '', directUnitCost: 0, vatProdCode: null };
  if (!input.no?.trim()) throw new AppError(`A ${input.type} No. is required`, 'VALIDATION');
  if (!(input.quantity > 0)) throw new AppError('Quantity must be greater than zero', 'VALIDATION');

  if (input.type === 'G/L Account') {
    const acc = await one<{ name: string; is_postable: number; status: string; no_direct_posting: number; vat_prod_posting_group_code: string | null }>(
      'SELECT name, is_postable, status, no_direct_posting, vat_prod_posting_group_code FROM gl_account WHERE code = ?', input.no.trim(),
    );
    if (!acc || !acc.is_postable || acc.status !== 'ACTIVE') throw new AppError('That G/L account is not an active posting account', 'VALIDATION');
    if (acc.no_direct_posting) throw new AppError('That G/L account is a subledger control account and cannot be charged directly', 'VALIDATION');
    return {
      description: input.description?.trim() || acc.name, directUnitCost: input.directUnitCost,
      vatProdCode: vatProd ?? acc.vat_prod_posting_group_code ?? null,
    };
  }
  if (input.type === 'Item') {
    const item = await one<{ description: string; status: string; unit_cost: Cents }>(
      'SELECT description, status, unit_cost FROM item WHERE no = ?', input.no.trim(),
    );
    if (!item) throw new AppError('Item not found', 'NOT_FOUND');
    if (item.status !== 'ACTIVE') throw new AppError('That item is blocked', 'VALIDATION');
    if (!input.locationCode?.trim()) throw new AppError('A Location Code is required for an Item line', 'VALIDATION');
    return { description: input.description?.trim() || item.description, directUnitCost: input.directUnitCost || item.unit_cost, vatProdCode: vatProd };
  }
  // Fixed Asset — Business Central Purchase Line Type = Fixed Asset (posting the invoice acquires it).
  const fa = await one<{ id: number; description: string; blocked: number }>(
    'SELECT id, description, blocked FROM fixed_asset WHERE no = ?', input.no.trim(),
  );
  if (!fa) throw new AppError('Fixed asset not found', 'NOT_FOUND');
  if (fa.blocked) throw new AppError('That fixed asset is blocked', 'VALIDATION');
  const faSetup = await import('./fixedAssetsSetup.ts').then((m) => m.getFaSetup());
  const bookCode = input.faDepreciationBookCode?.trim() || faSetup.default_depreciation_book_code;
  if (!bookCode) throw new AppError('A Depreciation Book is required on a Fixed Asset line', 'VALIDATION');
  const book = await one<{ disposed: number; acquisition_cost: Cents }>(
    'SELECT disposed, acquisition_cost FROM fa_depreciation_book WHERE fixed_asset_id = ? AND depreciation_book_code = ?', fa.id, bookCode,
  );
  if (!book) throw new AppError(`Fixed asset ${input.no} has no FA Depreciation Book for ${bookCode}`, 'VALIDATION');
  if (book.disposed) throw new AppError(`Fixed asset ${input.no} has already been disposed for ${bookCode}`, 'VALIDATION');
  if (book.acquisition_cost > 0) throw new AppError(`Fixed asset ${input.no} already has an acquisition cost posted for ${bookCode}`, 'VALIDATION');
  if (!(input.directUnitCost > 0)) throw new AppError('Enter the acquisition cost as the Direct Unit Cost on a Fixed Asset line', 'VALIDATION');
  return { description: input.description?.trim() || fa.description, directUnitCost: input.directUnitCost, vatProdCode: vatProd };
}

export async function setPurchaseLines(no: string, lines: PurchaseLineInput[], user: Actor): Promise<void> {
  const header = await one<PurchaseHeader>('SELECT * FROM purchase_header WHERE no = ?', no);
  if (!header) throw new AppError('Purchase document not found', 'NOT_FOUND');
  if (header.status !== 'Open') throw new AppError('Only an open document can have its lines edited', 'VALIDATION');
  if (header.created_by !== user.username) throw new AppError('Only the person who created this can edit it', 'NOT_CREATOR');
  await writePurchaseLines(header, lines, user);
}

/** Pag52203556 "Append to Order" — procurement adds requisition lines onto an open Purchase Order
 *  somebody else may have raised, so the creator check is deliberately not applied. */
export async function appendPurchaseLines(no: string, lines: PurchaseLineInput[], user: Actor): Promise<void> {
  const header = await one<PurchaseHeader>('SELECT * FROM purchase_header WHERE no = ?', no);
  if (!header) throw new AppError('Purchase document not found', 'NOT_FOUND');
  if (header.document_type !== 'Order' && header.document_type !== 'Quote') throw new AppError(`${no} is not a purchase order or quote`, 'VALIDATION');
  if (header.status !== 'Open') throw new AppError(`${no} is ${header.status.toLowerCase()} — lines can only be appended to an open document`, 'VALIDATION');
  const existing = await all<PurchaseLine>('SELECT * FROM purchase_line WHERE purchase_header_id = ? ORDER BY line_no', header.id);
  const kept: PurchaseLineInput[] = existing.map((l) => ({
    type: l.type, no: l.no, description: l.description, quantity: Number(l.quantity), directUnitCost: Number(l.direct_unit_cost),
    lineDiscountPct: Number(l.line_discount_pct), locationCode: l.location_code, faDepreciationBookCode: l.fa_depreciation_book_code,
    vatProdPostingGroupCode: l.vat_prod_posting_group_code,
  }));
  await writePurchaseLines(header, [...kept, ...lines], user);
}

async function writePurchaseLines(header: PurchaseHeader, lines: PurchaseLineInput[], user: Actor): Promise<void> {
  const no = header.no;
  const faSetup = await import('./fixedAssetsSetup.ts').then((m) => m.getFaSetup());
  const setup = await getPurchasesPayablesSetup();
  const pricesInclVat = !!setup.prices_incl_vat;
  if (header.currency_code !== 'KES' && lines.some((l) => l.type === 'Item' || l.type === 'Fixed Asset')) {
    throw new AppError('Item and Fixed Asset lines are only supported on base-currency (KES) documents', 'VALIDATION');
  }
  await run('DELETE FROM purchase_line WHERE purchase_header_id = ?', header.id);
  let lineNo = 10000;
  let total = 0;
  let totalInclVat = 0;
  for (const input of lines) {
    if (input.type !== 'Comment' && !input.no) continue;
    const resolved = await resolveLine(input);
    const qty = input.type === 'Comment' ? 0 : (input.type === 'Fixed Asset' ? 1 : input.quantity);
    const gross = qty * resolved.directUnitCost;
    const discPct = Math.max(0, Math.min(100, input.lineDiscountPct ?? 0));
    const discAmount = Math.round(gross * discPct / 100);
    const enteredAmount = input.type === 'Comment' ? 0 : gross - discAmount;

    // VAT (input side). "line_amount" always carries the VAT-exclusive base — when the setup runs
    // VAT-inclusive prices we back it out of what the user entered.
    let vatPct = 0;
    let vatAmount = 0;
    let baseLineAmount = enteredAmount;
    if (input.type !== 'Comment' && resolved.vatProdCode) {
      const vs = await resolveVatSetup(header.vat_bus_posting_group_code, resolved.vatProdCode);
      if (vs && vs.tax_type === 'VAT') {
        vatPct = vs.vat_pct;
        if (pricesInclVat) {
          vatAmount = extractVatFromGross(enteredAmount, vatPct);
          baseLineAmount = enteredAmount - vatAmount;
        } else {
          vatAmount = addVatToNet(enteredAmount, vatPct);
        }
      }
    }
    const amountInclVat = baseLineAmount + vatAmount;
    total += baseLineAmount;
    totalInclVat += amountInclVat;

    const bookCode = input.type === 'Fixed Asset'
      ? (input.faDepreciationBookCode || faSetup.default_depreciation_book_code)
      : null;
    await run(
      `INSERT INTO purchase_line
         (purchase_header_id, line_no, type, no, description, quantity, direct_unit_cost, line_discount_pct,
          line_discount_amount, line_amount, vat_prod_posting_group_code, vat_pct, vat_base_amount, vat_amount,
          amount_incl_vat, qty_to_receive, qty_to_invoice, location_code, fa_depreciation_book_code)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      header.id, lineNo, input.type, input.no?.trim() || null, resolved.description, qty, resolved.directUnitCost,
      discPct, discAmount, baseLineAmount, input.type === 'Comment' ? null : (resolved.vatProdCode || null),
      vatPct, input.type === 'Comment' ? 0 : baseLineAmount, vatAmount, amountInclVat,
      qty, qty, input.locationCode?.trim() || null, bookCode,
    );
    lineNo += 10000;
  }
  await run('UPDATE purchase_header SET amount = ?, amount_incl_vat = ? WHERE id = ?', total, totalInclVat, header.id);
  await audit(user, 'PURCHASE_DOCUMENT_LINES_SET', 'purchase_header', no, { lineCount: lines.length, total, totalInclVat });
}

/* --------------------------------------------------------------------- Quote -> Order */

export async function makeOrder(quoteNo: string, user: Actor): Promise<{ no: string }> {
  return tx(async () => {
    const quote = await one<PurchaseHeader>("SELECT * FROM purchase_header WHERE no = ? AND document_type = 'Quote'", quoteNo);
    if (!quote) throw new AppError('Purchase quote not found', 'NOT_FOUND');
    const lines = await all<PurchaseLine>('SELECT * FROM purchase_line WHERE purchase_header_id = ? ORDER BY line_no', quote.id);
    const orderNo = await nextSequence('PURCHASE_ORDER');
    const info = await run(
      `INSERT INTO purchase_header
         (document_type, no, vendor_id, buy_from_name, buy_from_address, buy_from_city, buy_from_contact,
          posting_date, document_date, due_date, payment_terms_code, payment_method_code, vendor_posting_group_code,
          vat_bus_posting_group_code, vendor_invoice_no, purchaser, global_dimension_1_id, global_dimension_2_id,
          status, amount, amount_incl_vat, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Open', ?, ?, ?, ?)`,
      'Order', orderNo, quote.vendor_id, quote.buy_from_name, quote.buy_from_address, quote.buy_from_city, quote.buy_from_contact,
      quote.posting_date, quote.document_date, quote.due_date, quote.payment_terms_code, quote.payment_method_code,
      quote.vendor_posting_group_code, quote.vat_bus_posting_group_code, quote.vendor_invoice_no, quote.purchaser,
      quote.global_dimension_1_id, quote.global_dimension_2_id, quote.amount, quote.amount_incl_vat,
      new Date().toISOString(), user.username,
    );
    const orderId = Number(info.lastInsertRowid);
    for (const l of lines) {
      await run(
        `INSERT INTO purchase_line
           (purchase_header_id, line_no, type, no, description, quantity, direct_unit_cost, line_discount_pct,
            line_discount_amount, line_amount, vat_prod_posting_group_code, vat_pct, vat_base_amount, vat_amount,
            amount_incl_vat, qty_to_receive, qty_to_invoice, location_code, fa_depreciation_book_code,
            global_dimension_1_id, global_dimension_2_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        orderId, l.line_no, l.type, l.no, l.description, l.quantity, l.direct_unit_cost, l.line_discount_pct,
        l.line_discount_amount, l.line_amount, l.vat_prod_posting_group_code, l.vat_pct, l.vat_base_amount, l.vat_amount,
        l.amount_incl_vat, l.quantity, l.quantity, l.location_code, l.fa_depreciation_book_code,
        l.global_dimension_1_id, l.global_dimension_2_id,
      );
    }
    await run('DELETE FROM purchase_header WHERE id = ?', quote.id);
    await audit(user, 'PURCHASE_QUOTE_MAKE_ORDER', 'purchase_header', orderNo, { fromQuote: quoteNo });
    return { no: orderNo };
  });
}

/* --------------------------------------------------------------- maker-checker */

export async function submitPurchaseDocument(no: string, user: Actor): Promise<{ autoApproved: boolean }> {
  const req = await one<PurchaseHeader>('SELECT * FROM purchase_header WHERE no = ?', no);
  if (!req) throw new AppError('Purchase document not found', 'NOT_FOUND');
  if (req.status !== 'Open') throw new AppError('Only an open document can be submitted', 'VALIDATION');
  if (req.document_type === 'Quote') throw new AppError('Convert the quote to an order first', 'VALIDATION');
  if (req.amount <= 0) throw new AppError('Add at least one line before submitting', 'VALIDATION');
  if ((req.document_type === 'Invoice' || req.document_type === 'Credit Memo') && !req.vendor_invoice_no?.trim()) {
    throw new AppError('Enter the Vendor Invoice No. before submitting', 'VALIDATION');
  }

  const matched = await findMatchingWorkflow('PURCHASE_DOCUMENT', await pickConditionFields('PURCHASE_DOCUMENT', req));
  if (!matched) throw new AppError('There is no enabled workflow for this document', 'NO_WORKFLOW');

  await tx(async () => {
    // Re-submitting clears the previous rejection: the document leaves the Rejected bucket.
    await run("UPDATE purchase_header SET status = 'Pending Approval', decision_reason = NULL WHERE no = ?", no);
    await startWorkflow(matched.workflow, matched.steps, {
      documentType: 'PURCHASE_DOCUMENT', entityId: no, requestedBy: user.username, amount: Number(req.amount),
    });
  });
  const after = await one<{ status: string }>('SELECT status FROM purchase_header WHERE no = ?', no);
  return { autoApproved: after?.status === 'Released' };
}

export async function cancelPurchaseDocumentApproval(no: string, user: Actor): Promise<void> {
  const req = await one<Pick<PurchaseHeader, 'status' | 'created_by'>>('SELECT status, created_by FROM purchase_header WHERE no = ?', no);
  if (!req) throw new AppError('Purchase document not found', 'NOT_FOUND');
  if (req.status !== 'Pending Approval') throw new AppError('Only a document pending approval can be recalled', 'VALIDATION');
  const routed = await findPendingRoutedTask('PURCHASE_DOCUMENT', no);
  if ((routed?.requested_by ?? req.created_by) !== user.username) throw new AppError('Only the person who submitted this can recall it', 'NOT_REQUESTER');
  await run("UPDATE purchase_header SET status = 'Open' WHERE no = ?", no);
  await audit(user, 'PURCHASE_DOCUMENT_CANCEL_APPROVAL', 'purchase_header', no, {});
}

/** BC "Release" — snapshots the buy-from fields and recomputes the due date from Payment Terms. */
export async function approvePurchaseDocument(no: string, user: Actor): Promise<void> {
  const req = await one<PurchaseHeader>('SELECT * FROM purchase_header WHERE no = ?', no);
  if (!req) throw new AppError('Purchase document not found', 'NOT_FOUND');
  if (req.status !== 'Pending Approval') throw new AppError('Only a document pending approval can be released', 'VALIDATION');
  if ((req.document_type === 'Invoice' || req.document_type === 'Credit Memo') && !req.vendor_invoice_no?.trim()) {
    throw new AppError('Enter the Vendor Invoice No. before releasing', 'VALIDATION');
  }
  const vendor = await loadVendor(req.vendor_id);
  const check = await checkVendorAllowed(req.vendor_id, req.document_type === 'Credit Memo' ? 'Invoice' : 'Invoice');
  if (check.blocked) throw new AppError(check.reason ?? 'Vendor is blocked', 'VALIDATION');

  let dueDate: IsoDate | null = req.due_date;
  if (req.payment_terms_code) {
    const pt = await one<{ due_date_calculation: string }>(
      'SELECT due_date_calculation FROM payment_terms WHERE code = ?', req.payment_terms_code,
    );
    if (pt) dueDate = applyDateFormula(req.document_date, pt.due_date_calculation);
  }
  await run(
    `UPDATE purchase_header SET status = 'Released', decision_reason = NULL, due_date = ?,
       buy_from_name = ?, buy_from_address = ?, buy_from_city = ?, buy_from_contact = ? WHERE no = ?`,
    dueDate, vendor.name, vendor.address, vendor.city, vendor.contact, no,
  );
  await audit(user, 'PURCHASE_DOCUMENT_RELEASE', 'purchase_header', no, {});
}

export async function rejectPurchaseDocument(no: string, reason: string | null, user: Actor): Promise<void> {
  if (!reason?.trim()) throw new AppError('A reason is required to reject a purchase document', 'VALIDATION');
  const req = await one<PurchaseHeader>('SELECT * FROM purchase_header WHERE no = ?', no);
  if (!req) throw new AppError('Purchase document not found', 'NOT_FOUND');
  if (req.status !== 'Pending Approval') throw new AppError('Only a document pending approval can be rejected', 'VALIDATION');
  await run("UPDATE purchase_header SET status = 'Open', decision_reason = ? WHERE no = ?", reason, no);
  await audit(user, 'PURCHASE_DOCUMENT_REJECT', 'purchase_header', no, { reason });
}

export async function reopenPurchaseDocument(no: string, user: Actor): Promise<void> {
  const req = await one<PurchaseHeader>('SELECT * FROM purchase_header WHERE no = ?', no);
  if (!req) throw new AppError('Purchase document not found', 'NOT_FOUND');
  if (req.status !== 'Released') throw new AppError('Only a released document can be reopened', 'VALIDATION');
  const received = await hasAnyRow('purchase_line', 'purchase_header_id = ? AND qty_received > 0', req.id);
  if (received) throw new AppError('This order has already been partly received and cannot be reopened', 'VALIDATION');
  await run("UPDATE purchase_header SET status = 'Open', decision_reason = NULL WHERE no = ?", no);
  await audit(user, 'PURCHASE_DOCUMENT_REOPEN', 'purchase_header', no, {});
}

/* ------------------------------------------------------------------- posting */

interface GlLeg { account: number; debit: Cents; credit: Cents; narration: string }

export interface PostPurchaseDocumentResult {
  receiptNo: string | null;
  invoiceNo: string | null;
  vendorLedgerEntryId: number | null;
  journalNo: string | null;
}

export async function postPurchaseDocument(
  no: string, opts: { receive?: boolean; invoice?: boolean }, user: Actor,
): Promise<PostPurchaseDocumentResult> {
  return tx(async () => {
    const header = await one<PurchaseHeader>('SELECT * FROM purchase_header WHERE no = ?', no);
    if (!header) throw new AppError('Purchase document not found', 'NOT_FOUND');
    if (header.status !== 'Released') throw new AppError('Only a released document can be posted', 'VALIDATION');

    const isOrder = header.document_type === 'Order';
    const isCreditMemo = header.document_type === 'Credit Memo';
    const setup = await getPurchasesPayablesSetup();
    const doReceive = isOrder ? (opts.receive ?? true) : (isCreditMemo ? false : !!setup.receipt_on_invoice);
    const doInvoice = isOrder ? (opts.invoice ?? true) : true;
    if (isOrder && !doReceive && !doInvoice) throw new AppError('Choose Receive, Invoice, or both', 'VALIDATION');

    const vd = header.posting_date;
    if (setup.allow_payables_posting_from && vd < setup.allow_payables_posting_from) {
      throw new AppError(`Payables posting is not allowed before ${setup.allow_payables_posting_from}`, 'VALIDATION');
    }
    if (setup.allow_payables_posting_to && vd > setup.allow_payables_posting_to) {
      throw new AppError(`Payables posting is not allowed after ${setup.allow_payables_posting_to}`, 'VALIDATION');
    }
    const range = await getEffectivePostingRange(user.id);
    if (range.from && vd < range.from) throw new AppError(`Posting date ${vd} is before your earliest allowed date (${range.from})`, 'VALIDATION');
    if (range.to && vd > range.to) throw new AppError(`Posting date ${vd} is after your latest allowed date (${range.to})`, 'VALIDATION');

    const willInvoice = doInvoice || !isOrder;
    if (willInvoice && !isCreditMemo && !header.vendor_invoice_no?.trim()) {
      throw new AppError('Enter the Vendor Invoice No. before posting the invoice', 'VALIDATION');
    }

    const vendor = await loadVendor(header.vendor_id);
    if (!header.vendor_posting_group_code) throw new AppError('The document has no Vendor Posting Group', 'VALIDATION');
    const pg = await one<{ id: number; payables_account_id: number }>(
      'SELECT id, payables_account_id FROM vendor_posting_group WHERE code = ?', header.vendor_posting_group_code,
    );
    if (!pg) throw new AppError('Vendor Posting Group setup is missing', 'VALIDATION');
    const grni = await one<{ id: number }>('SELECT id FROM gl_account WHERE code = ?', GRNI_CODE);
    if (!grni) throw new AppError(`The Goods Received Not Invoiced account (${GRNI_CODE}) is missing`, 'VALIDATION');

    const lines = await all<PurchaseLine>('SELECT * FROM purchase_line WHERE purchase_header_id = ? ORDER BY line_no', header.id);
    const billable = lines.filter((l) => l.type !== 'Comment' && (l.no ?? '') !== '');
    if (!billable.length) throw new AppError('There is nothing to post on this document', 'VALIDATION');

    const sign = isCreditMemo ? -1 : 1;
    const dir = (n: Cents): { debit: Cents; credit: Cents } => (n >= 0 ? { debit: n, credit: 0 } : { debit: 0, credit: -n });

    const glLegs: GlLeg[] = [];
    let invoiceTotal = 0;
    let vatTotal = 0;
    const vatPostings: { line: PurchaseLine; base: Cents; amount: Cents }[] = [];
    const postedLines: {
      line: PurchaseLine; postQty: number; lineAmount: Cents; lineVatAmount: Cents;
      itemLedgerEntryId: number | null; faLedgerEntryId: number | null;
    }[] = [];

    for (const line of billable) {
      let postQty: number;
      if (isOrder) {
        const receiveNow = doReceive ? Math.min(line.qty_to_receive, line.quantity - line.qty_received) : 0;
        const invoiceNow = doInvoice
          ? Math.min(line.qty_to_invoice, (doReceive ? line.qty_received + receiveNow : line.qty_received) - line.qty_invoiced)
          : 0;
        postQty = doInvoice ? invoiceNow : receiveNow;
        if (postQty <= 0 && receiveNow <= 0) continue;
      } else {
        postQty = line.quantity - line.qty_invoiced;
        if (postQty <= 0) continue;
      }

      const lineAmount = line.quantity > 0 ? Math.round(postQty / line.quantity * line.line_amount) : line.line_amount;
      const narration = `${header.document_type} ${no} — ${line.type} ${line.no}`.slice(0, 250);
      let itemLedgerEntryId: number | null = null;
      let faLedgerEntryId: number | null = null;
      let lineVatAmount = 0;

      if (willInvoice) invoiceTotal += lineAmount;

      // Input VAT is recognised only on the invoice (never a receive-only Order post).
      if (willInvoice && line.vat_prod_posting_group_code && line.vat_amount !== 0) {
        lineVatAmount = line.quantity > 0 ? Math.round(postQty / line.quantity * line.vat_amount) : line.vat_amount;
        const vs = await resolveVatSetup(header.vat_bus_posting_group_code, line.vat_prod_posting_group_code);
        if (lineVatAmount !== 0 && vs?.tax_type === 'VAT' && vs.tax_account_id) {
          const dv = dir(sign * lineVatAmount);
          glLegs.push({ account: vs.tax_account_id, debit: dv.debit, credit: dv.credit, narration: `${narration} — input VAT` });
          vatTotal += lineVatAmount;
          vatPostings.push({ line, base: lineAmount, amount: lineVatAmount });
        }
      }

      if (line.type === 'G/L Account' && willInvoice) {
        const acc = await one<{ id: number }>('SELECT id FROM gl_account WHERE code = ?', line.no!);
        const d = dir(sign * lineAmount); // debit the expense/asset account
        glLegs.push({ account: acc!.id, debit: d.debit, credit: d.credit, narration });
      }

      if (line.type === 'Item') {
        const item = await one<{ id: number; inventory_posting_group_id: number }>(
          'SELECT id, inventory_posting_group_id FROM item WHERE no = ?', line.no!,
        );
        if (!item) throw new AppError(`Item ${line.no} not found`, 'NOT_FOUND');
        const loc = await one<{ id: number }>('SELECT id FROM location WHERE code = ?', line.location_code!);
        if (!loc) throw new AppError(`Location ${line.location_code} not found`, 'NOT_FOUND');
        const ipg = await one<{ inventory_gl_account_id: number }>(
          'SELECT inventory_gl_account_id FROM inventory_posting_group WHERE id = ?', item.inventory_posting_group_id,
        );
        if (!ipg) throw new AppError(`Item ${line.no}'s Inventory Posting Group setup is missing`, 'VALIDATION');
        const baseQty = Math.round(postQty);
        const unitCost = baseQty > 0 ? Math.round(lineAmount / baseQty) : line.direct_unit_cost;

        // Receive the stock on the receive (Order) or the single invoice post (Invoice doc).
        if (doReceive || !isOrder) {
          if (isCreditMemo) {
            // A Credit Memo returns stock — write a negative inbound-reversal entry.
            await run(
              `INSERT INTO item_ledger_entry
                 (item_id, location_id, posting_date, entry_type, document_no, quantity, remaining_quantity, open, unit_cost, amount, created_at)
               VALUES (?,?,?, 'Purchase', ?,?,0,false,?,?,?)`,
              item.id, loc.id, vd, no, -baseQty, unitCost, -baseQty * unitCost, new Date().toISOString(),
            );
            const sku = await one<{ id: number; inventory: number }>('SELECT id, inventory FROM stockkeeping_unit WHERE item_id = ? AND location_id = ?', item.id, loc.id);
            if (sku) await run('UPDATE stockkeeping_unit SET inventory = ? WHERE id = ?', sku.inventory - baseQty, sku.id);
            const roll = await one<{ total: number }>('SELECT COALESCE(SUM(inventory),0) AS total FROM stockkeeping_unit WHERE item_id = ?', item.id);
            await run('UPDATE item SET inventory = ? WHERE id = ?', roll?.total ?? 0, item.id);
          } else {
            itemLedgerEntryId = await receiveItemStock(item.id, loc.id, baseQty, unitCost, no, vd);
          }
          // Inventory is valued at the line amount owed for the posted quantity; GRNI carries it
          // between receipt and invoice and nets to exactly zero once both are posted.
          const c1 = dir(sign * lineAmount);
          const c2 = dir(-sign * lineAmount);
          glLegs.push({ account: ipg.inventory_gl_account_id, debit: c1.debit, credit: c1.credit, narration: `${narration} — inventory` });
          glLegs.push({ account: grni.id, debit: c2.debit, credit: c2.credit, narration: `${narration} — GRNI` });
        }
        // Clear GRNI against the invoice.
        if (willInvoice) {
          const g = dir(sign * lineAmount);
          glLegs.push({ account: grni.id, debit: g.debit, credit: g.credit, narration: `${narration} — GRNI clear` });
        }
      }

      if (line.type === 'Fixed Asset' && willInvoice) {
        const fa = await one<{ id: number }>('SELECT id FROM fixed_asset WHERE no = ?', line.no!);
        const acq = await acquireFixedAssetForPurchase(
          fa!.id, line.fa_depreciation_book_code!, lineAmount, vd, no, line.description, user,
        );
        for (const l of acq.glLines) glLegs.push(l);
        faLedgerEntryId = acq.faLedgerEntryId;
      }

      if (isOrder) {
        await run(
          'UPDATE purchase_line SET qty_received = qty_received + ?, qty_invoiced = qty_invoiced + ? WHERE id = ?',
          doReceive ? postQty : 0, doInvoice ? postQty : 0, line.id,
        );
      } else {
        await run('UPDATE purchase_line SET qty_invoiced = quantity, qty_received = quantity WHERE id = ?', line.id);
      }
      postedLines.push({ line, postQty, lineAmount, lineVatAmount, itemLedgerEntryId, faLedgerEntryId });
    }

    if (!postedLines.length) throw new AppError('Nothing was posted — check the Qty. to Receive / Qty. to Invoice on the lines', 'VALIDATION');

    let vendorLedgerEntryId: number | null = null;
    let journalNo: string | null = null;
    let journalId: number | null = null;
    let invoiceNo: string | null = null;
    let receiptNo: string | null = null;

    const payableTotal = invoiceTotal + vatTotal; // the vendor is owed the VAT-inclusive amount
    if (willInvoice && payableTotal !== 0) {
      const p = dir(-sign * payableTotal); // credit Payables
      glLegs.unshift({ account: pg.payables_account_id, debit: p.debit, credit: p.credit, narration: `${header.document_type} ${no} — ${vendor.no}` });
    }

    const totalDebit = glLegs.reduce((s, l) => s + l.debit, 0);
    const totalCredit = glLegs.reduce((s, l) => s + l.credit, 0);
    if (glLegs.length && totalDebit !== totalCredit) throw new AppError('Internal error: the purchase journal did not balance', 'POSTING_ERROR');
    if (glLegs.length >= 2 && totalDebit > 0) {
      const j = await postJournal({
        valueDate: vd, module: 'PAYABLES',
        eventType: isCreditMemo ? 'PURCHASE_CREDIT_MEMO' : willInvoice ? 'PURCHASE_INVOICE' : 'PURCHASE_RECEIPT',
        description: `${header.document_type} ${no} — ${vendor.name}`, reference: no, user,
        idempotencyKey: `PURCH-${no}-${new Date().toISOString()}`,
        currencyCode: header.currency_code, currencyFactor: header.currency_factor,
        globalDimension1Id: header.global_dimension_1_id, globalDimension2Id: header.global_dimension_2_id,
        lines: glLegs.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit, narration: l.narration })),
      });
      journalNo = j.journal_no;
      journalId = j.id;
    }

    // VAT Entry ledger — one row per VATable line (BC "VAT Entry").
    for (const vp of vatPostings) {
      await postVatEntry({
        postingDate: vd, documentType: header.document_type, documentNo: no, taxType: 'VAT',
        vatBus: header.vat_bus_posting_group_code, vatProd: vp.line.vat_prod_posting_group_code,
        vatPct: vp.line.vat_pct, base: sign * vp.base, amount: sign * vp.amount,
        currencyCode: header.currency_code, currencyFactor: header.currency_factor,
        vendorNo: vendor.no, vendorPin: vendor.pin_no, journalId,
        sourceType: isCreditMemo ? 'Purchase Credit Memo' : 'Purchase Invoice', sourceId: header.id,
      });
    }

    if (willInvoice) {
      let dueDate = header.due_date;
      let pmtDiscDate: IsoDate | null = null;
      let pmtDiscPossible = 0;
      if (header.payment_terms_code) {
        const pt = await one<{ due_date_calculation: string; discount_date_calculation: string; discount_pct: number }>(
          'SELECT due_date_calculation, discount_date_calculation, discount_pct FROM payment_terms WHERE code = ?', header.payment_terms_code,
        );
        if (pt) {
          dueDate = applyDateFormula(header.document_date, pt.due_date_calculation);
          if (pt.discount_pct > 0 && pt.discount_date_calculation) {
            pmtDiscDate = applyDateFormula(header.document_date, pt.discount_date_calculation);
            pmtDiscPossible = Math.round(payableTotal * pt.discount_pct / 100);
          }
        }
      }
      vendorLedgerEntryId = await createVendorLedgerEntry({
        vendorId: vendor.id, postingDate: vd,
        documentType: isCreditMemo ? 'Credit Memo' : 'Invoice',
        documentNo: no, vendorInvoiceNo: header.vendor_invoice_no, description: `${header.document_type} ${no}`,
        amount: sign * payableTotal, currencyCode: header.currency_code, currencyFactor: header.currency_factor,
        dueDate, pmtDiscountDate: pmtDiscDate, pmtDiscountPossible: pmtDiscPossible,
        sourceType: isCreditMemo ? 'Purchase Credit Memo' : 'Purchase Invoice', sourceId: header.id, journalId,
      });
      // BC's Applies-to Doc. No.: a corrective credit memo settles the invoice it was raised
      // against, so the vendor is not left with an open invoice and an open credit note.
      if (isCreditMemo && header.applies_to_doc_no && vendorLedgerEntryId) {
        const target = await one<{ id: number }>(
          `SELECT id FROM vendor_ledger_entry
           WHERE vendor_id = ? AND document_no = ? AND open = 1 AND positive = 1
           ORDER BY id LIMIT 1`,
          vendor.id, header.applies_to_doc_no,
        );
        // Silent when the invoice is already settled — the memo still posts, just unapplied.
        if (target) {
          await applyVendorEntries(
            { applyingEntryId: vendorLedgerEntryId, appliedTo: [target.id], postingDate: vd }, user,
          );
        }
      }
      invoiceNo = await nextSequence(isCreditMemo ? 'POSTED_PURCHASE_CREDIT_MEMO' : 'POSTED_PURCHASE_INVOICE');
      await writePostedDocument(isCreditMemo ? 'Credit Memo' : 'Invoice', invoiceNo, header, vendor, vd, isOrder ? no : null, journalId, vendorLedgerEntryId, postedLines, user);
      await recomputeVendorBalance(vendor.id);
    }
    if (doReceive && isOrder) {
      receiptNo = await nextSequence('POSTED_PURCHASE_RECEIPT');
      await writePostedDocument('Receipt', receiptNo, header, vendor, vd, no, null, null, postedLines, user);
    }

    if (isOrder) {
      const remaining = await one<{ n: number }>(
        'SELECT COUNT(*) AS n FROM purchase_line WHERE purchase_header_id = ? AND (qty_received < quantity OR qty_invoiced < quantity)',
        header.id,
      );
      if (Number(remaining?.n ?? 0) === 0) await run('DELETE FROM purchase_header WHERE id = ?', header.id);
    } else {
      await run('DELETE FROM purchase_header WHERE id = ?', header.id);
    }

    await audit(user, 'PURCHASE_DOCUMENT_POST', 'purchase_header', no, { receiptNo, invoiceNo, journalNo, invoiceTotal });
    return { receiptNo, invoiceNo, vendorLedgerEntryId, journalNo };
  });
}

async function writePostedDocument(
  documentType: 'Receipt' | 'Invoice' | 'Credit Memo', postedNo: string, header: PurchaseHeader,
  vendor: { id: number; name: string; address: string | null; city: string | null; contact: string | null },
  vd: IsoDate, orderNo: string | null, journalId: number | null, vendorLedgerEntryId: number | null,
  postedLines: { line: PurchaseLine; postQty: number; lineAmount: Cents; lineVatAmount: Cents; itemLedgerEntryId: number | null; faLedgerEntryId: number | null }[],
  _user: Actor,
): Promise<void> {
  const isReceipt = documentType === 'Receipt';
  const total = isReceipt ? 0 : postedLines.reduce((s, p) => s + p.lineAmount, 0);
  const totalInclVat = isReceipt ? 0 : postedLines.reduce((s, p) => s + p.lineAmount + p.lineVatAmount, 0);
  const info = await run(
    `INSERT INTO posted_purchase_document
       (document_type, no, vendor_id, buy_from_name, buy_from_address, buy_from_city, buy_from_contact,
        posting_date, document_date, due_date, order_no, source_no, vendor_invoice_no, applies_to_doc_no, payment_terms_code, vat_bus_posting_group_code,
        currency_code, currency_factor, amount, amount_incl_vat, vendor_ledger_entry_id, journal_id, created_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    documentType, postedNo, vendor.id, vendor.name, vendor.address, vendor.city, vendor.contact,
    // As on the sales side: the trail is against the open document, so keep its number.
    vd, header.document_date, header.due_date, orderNo, header.no, header.vendor_invoice_no, header.applies_to_doc_no,
    header.payment_terms_code,
    header.vat_bus_posting_group_code, header.currency_code, header.currency_factor, total, totalInclVat,
    vendorLedgerEntryId, journalId, new Date().toISOString(), _user.username,
  );
  const docId = Number(info.lastInsertRowid);
  let lineNo = 10000;
  for (const p of postedLines) {
    await run(
      `INSERT INTO posted_purchase_line
         (posted_purchase_document_id, line_no, type, no, description, quantity, direct_unit_cost, line_discount_amount,
          line_amount, vat_prod_posting_group_code, vat_pct, vat_base_amount, vat_amount, amount_incl_vat,
          item_ledger_entry_id, fa_ledger_entry_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      docId, lineNo, p.line.type, p.line.no, p.line.description, p.postQty, p.line.direct_unit_cost,
      p.line.quantity > 0 ? Math.round(p.postQty / p.line.quantity * p.line.line_discount_amount) : 0,
      isReceipt ? 0 : p.lineAmount, p.line.vat_prod_posting_group_code, p.line.vat_pct,
      isReceipt ? 0 : p.lineAmount, isReceipt ? 0 : p.lineVatAmount, isReceipt ? 0 : p.lineAmount + p.lineVatAmount,
      p.itemLedgerEntryId, p.faLedgerEntryId,
    );
    lineNo += 10000;
  }
}

/* -------------------------------------------------------------- posted documents */

export interface PostedPurchaseInvoiceOption {
  no: string;
  posting_date: IsoDate;
  vendor_id: number;
  vendor_no: string;
  vendor_name: string;
  vendor_invoice_no: string | null;
  amount: Cents;
  /** What is still open on the vendor ledger — 0 once the invoice has been settled. */
  remaining_amount: Cents;
}

/**
 * Posted purchase invoices a credit memo can be raised against, newest first — Business
 * Central's "Copy Document" / "Create Corrective Credit Memo" source list. The vendor is chosen
 * first, so the list is always one vendor's, and only invoices still open on the vendor ledger
 * are offered — the same set BC's Applies-to Doc. No. lookup shows. No vendor, nothing to list.
 */
export const listPostedInvoicesForCredit = (vendorId?: number | null): Promise<PostedPurchaseInvoiceOption[]> =>
  !vendorId ? Promise.resolve([]) : all<PostedPurchaseInvoiceOption>(
    `SELECT d.no, d.posting_date, d.vendor_id, v.no AS vendor_no, v.name AS vendor_name, d.vendor_invoice_no,
            d.amount_incl_vat AS amount, COALESCE(e.remaining_amount, 0) AS remaining_amount
     FROM posted_purchase_document d
     JOIN vendor v ON v.id = d.vendor_id
     LEFT JOIN vendor_ledger_entry e ON e.id = d.vendor_ledger_entry_id
     WHERE d.document_type = 'Invoice' AND d.vendor_id = @vendorId
       AND COALESCE(e.remaining_amount, 0) <> 0
     ORDER BY d.id DESC
     LIMIT 200`,
    { vendorId },
  );

/** A posted purchase invoice reshaped into the header + line drafts a credit memo starts from. */
export interface PurchaseCreditMemoSource {
  invoiceNo: string;
  vendorId: number;
  vendorNo: string;
  vendorName: string;
  postingDate: IsoDate;
  paymentTermsCode: string | null;
  vendorInvoiceNo: string | null;
  currencyCode: string;
  amount: Cents;
  lines: {
    type: PurchaseLineType;
    no: string | null;
    description: string | null;
    quantity: number;
    directUnitCost: Cents;
    /** Recovered from the posted line's discount amount, which is what was actually stored. */
    lineDiscountPct: number;
    vatProdPostingGroupCode: string | null;
  }[];
}

/**
 * The posted invoice, ready to prefill a credit memo — Business Central's Copy Document with
 * "Include Header" on. Quantities come across positive: a credit memo is a negative document by
 * virtue of its type, not by carrying negative lines (see postPurchaseDocument's `sign`).
 */
export async function getInvoiceForCreditMemo(no: string): Promise<PurchaseCreditMemoSource | undefined> {
  const doc = await one<PostedPurchaseDocumentView>(
    `SELECT d.*, v.no AS vendor_no, v.name AS vendor_name
     FROM posted_purchase_document d JOIN vendor v ON v.id = d.vendor_id
     WHERE d.no = ? AND d.document_type = 'Invoice'`, no,
  );
  if (!doc) return undefined;
  const lines = await all<PostedPurchaseLine>(
    'SELECT * FROM posted_purchase_line WHERE posted_purchase_document_id = ? ORDER BY line_no', doc.id,
  );
  return {
    invoiceNo: doc.no,
    vendorId: doc.vendor_id,
    vendorNo: doc.vendor_no,
    vendorName: doc.vendor_name,
    postingDate: doc.posting_date,
    paymentTermsCode: doc.payment_terms_code,
    vendorInvoiceNo: doc.vendor_invoice_no,
    currencyCode: doc.currency_code,
    amount: doc.amount,
    lines: lines.map((l) => {
      const gross = Math.round(l.quantity * l.direct_unit_cost);
      return {
        type: l.type,
        no: l.no,
        description: l.description,
        quantity: l.quantity,
        directUnitCost: l.direct_unit_cost,
        lineDiscountPct: gross > 0 ? Math.round((l.line_discount_amount / gross) * 10000) / 100 : 0,
        vatProdPostingGroupCode: l.vat_prod_posting_group_code,
      };
    }),
  };
}

export interface PostedPurchaseDocumentDetail extends PostedPurchaseDocumentView {
  lines: PostedPurchaseLine[];
}

/**
 * One posted Receipt (GRN) / Invoice / Credit Memo with its lines — the mirror of
 * getPostedSalesDocument(), and the record that outlives the purchase_header posting deletes.
 */
export async function getPostedPurchaseDocument(no: string): Promise<PostedPurchaseDocumentDetail | undefined> {
  const header = await one<PostedPurchaseDocumentView>(
    `SELECT d.*, v.no AS vendor_no, v.name AS vendor_name
     FROM posted_purchase_document d JOIN vendor v ON v.id = d.vendor_id WHERE d.no = ?`, no,
  );
  if (!header) return undefined;
  const lines = await all<PostedPurchaseLine>(
    'SELECT * FROM posted_purchase_line WHERE posted_purchase_document_id = ? ORDER BY line_no', header.id,
  );
  return { ...header, lines };
}
