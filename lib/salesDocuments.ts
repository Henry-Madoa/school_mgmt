/*
 * Sales Documents — Business Central Sales Quote / Order / Invoice / Credit Memo (Tables 36/37),
 * posting to the customer subledger (lib/custLedger.ts), the G/L (postJournal), the item ledger
 * (Item lines — COGS + stock, via lib/inventoryCosting.ts) and the FA subledger (Fixed Asset
 * lines — disposal, via lib/fixedAssets.ts's disposeFixedAssetForSale).
 *
 * Lifecycle (maker-checker, same wiring as fa_journal_line):
 *   Open -> Pending Approval -> Released (BC "Release") -> Posted.
 * A Quote is converted to an Order (makeOrder) rather than posted. An Order supports partial
 * Ship / Invoice; a fully shipped + invoiced Order is deleted (BC behaviour). Invoice and
 * Credit Memo post all-or-nothing.
 *
 * No AL source — built from Business Central domain knowledge; closest precedents in this
 * codebase are lib/faJournal.ts (maker-checker + postJournal) and lib/itemJournal.ts (item
 * ledger costing).
 */
import { one, all, run, tx, nextSequence, audit, hasAnyRow } from './db.ts';
import { AppError } from './errors.ts';
import { postJournal } from './accounting.ts';
import { getEffectivePostingRange } from './postingDates.ts';
import { applyDateFormula } from './dateFormula.ts';
import { resolveDocCurrency } from './currency.ts';
import { costOutbound, applyOutboundLots } from './inventoryCosting.ts';
import { disposeFixedAssetForSale } from './fixedAssets.ts';
import { createCustLedgerEntry, applyCustomerEntries, recomputeCustomerBalance } from './custLedger.ts';
import { getSalesReceivablesSetup } from './receivablesSetup.ts';
import { checkCustomerAllowed } from './customers.ts';
import { findMatchingWorkflow, findPendingRoutedTask, pickConditionFields, startWorkflow } from './workflow.ts';
import { buildFilterClause, type FilterCondition, type FilterFieldDef } from './listFilters.ts';
import { buildOrderClause, type SortState } from './listSort.ts';
import type {
  Actor, Cents, IsoDate, SalesDocumentDetail, SalesDocumentType, SalesHeader, SalesHeaderView,
  SalesLine, SalesLineType, PostedSalesDocumentView, PostedSalesLine,
} from './types.ts';

/**
 * The status buckets a document list is split into. Business Central keeps a document's own
 * Status at Open | Pending Approval | Released and records the rejection against the approval
 * entry — rejecting sends the document back to Open with the reason on it (see
 * rejectSalesDocument below). "Rejected" is therefore a view over Open, not a fourth status,
 * and the two are kept disjoint so every document sits in exactly one bucket.
 */
export type SalesDocView = 'all' | 'open' | 'pending' | 'released' | 'rejected';

const VIEW_CLAUSE: Record<Exclude<SalesDocView, 'all'>, string> = {
  open: "sh.status = 'Open' AND sh.decision_reason IS NULL",
  pending: "sh.status = 'Pending Approval'",
  released: "sh.status = 'Released'",
  rejected: "sh.status = 'Open' AND sh.decision_reason IS NOT NULL",
};

export const SALES_DOC_VIEWS: SalesDocView[] = ['all', 'open', 'pending', 'released', 'rejected'];

const DOCUMENT_TYPES: SalesDocumentType[] = ['Quote', 'Order', 'Invoice', 'Credit Memo'];
const LINE_TYPES: SalesLineType[] = ['Comment', 'G/L Account', 'Item', 'Fixed Asset'];

const NO_SERIES_FOR: Record<SalesDocumentType, string> = {
  Quote: 'SALES_QUOTE', Order: 'SALES_ORDER', Invoice: 'SALES_INVOICE', 'Credit Memo': 'SALES_CREDIT_MEMO',
};

const SELECT_ROW = `
  SELECT sh.*, c.no AS customer_no, c.name AS customer_name, c.blocked AS customer_blocked
  FROM sales_header sh JOIN customer c ON c.id = sh.customer_id`;

export const SALES_DOC_FILTER_FIELDS: FilterFieldDef[] = [
  { key: 'no', label: 'No.', type: 'text', column: 'sh.no' },
  { key: 'customer_id', label: 'Customer', type: 'select', column: 'sh.customer_id' },
  { key: 'posting_date', label: 'Posting Date', type: 'date', column: 'sh.posting_date' },
  { key: 'your_reference', label: 'Your Reference', type: 'text', column: 'sh.your_reference' },
  { key: 'created_by', label: 'Created By', type: 'text', column: 'sh.created_by' },
];

const SORT_COLUMNS: Record<string, string> = {
  no: 'sh.no', customer: 'c.no', posting_date: 'sh.posting_date', amount: 'sh.amount',
  status: 'sh.status', due_date: 'sh.due_date',
};

export interface ListSalesDocumentsOptions {
  documentType: SalesDocumentType;
  view?: SalesDocView;
  search?: string;
  filters?: FilterCondition[];
  sort?: SortState | null;
}

export const listSalesDocuments = (
  { documentType, view, search = '', filters = [], sort = null }: ListSalesDocumentsOptions,
): Promise<SalesHeaderView[]> => {
  const { clause, params } = buildFilterClause(SALES_DOC_FILTER_FIELDS, filters);
  const orderBy = buildOrderClause(SORT_COLUMNS, sort, 'sh.no DESC');
  return all<SalesHeaderView>(
    `${SELECT_ROW}
     WHERE sh.document_type = @docType
       AND (sh.no ILIKE @like OR c.no ILIKE @like OR c.name ILIKE @like OR sh.your_reference ILIKE @like)
       ${view && view !== 'all' ? `AND ${VIEW_CLAUSE[view]}` : ''}
       ${clause}
     ${orderBy}`,
    { docType: documentType, like: `%${String(search).trim()}%`, ...params },
  );
};

/** How many documents sit in each status bucket — the counts on the list's view tabs. */
export async function salesDocCounts(documentType: SalesDocumentType): Promise<Record<SalesDocView, number>> {
  const rows = await all<{ status: string; rejected: number; n: number }>(
    `SELECT sh.status, CASE WHEN sh.decision_reason IS NULL THEN 0 ELSE 1 END AS rejected, COUNT(*) AS n
     FROM sales_header sh WHERE sh.document_type = ? GROUP BY sh.status, rejected`,
    documentType,
  );
  const counts: Record<SalesDocView, number> = { all: 0, open: 0, pending: 0, released: 0, rejected: 0 };
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

export async function getSalesDocument(no: string): Promise<SalesDocumentDetail | undefined> {
  const header = await one<SalesHeaderView>(`${SELECT_ROW} WHERE sh.no = ?`, no);
  if (!header) return undefined;
  const lines = await all<SalesLine>('SELECT * FROM sales_line WHERE sales_header_id = ? ORDER BY line_no', header.id);
  const outstanding = lines.reduce((s, l) => s + l.line_amount, 0);
  const shippedNotInvoiced = lines.reduce(
    (s, l) => s + (l.quantity > 0 ? Math.round((l.qty_shipped - l.qty_invoiced) / l.quantity * l.line_amount) : 0), 0,
  );
  return { ...header, lines, outstanding_amount: outstanding, shipped_not_invoiced: shippedNotInvoiced };
}

/** The posted document a source header became, if it has been posted — posting deletes the
 *  header, but the posted row keeps its number as source_no. Lets a link to the document (an
 *  approval notification, say) still land somewhere useful after posting. Newest first, since
 *  an order can be invoiced more than once. */
export const findPostedDocumentBySource = (sourceNo: string): Promise<{ no: string } | undefined> =>
  one<{ no: string }>('SELECT no FROM posted_sales_document WHERE source_no = ? ORDER BY id DESC LIMIT 1', sourceNo);

export const hasAnySalesDocuments = (documentType?: SalesDocumentType): Promise<boolean> =>
  hasAnyRow('sales_header sh', documentType ? `sh.document_type = '${documentType}'` : undefined);

/* -------------------------------------------------------------------- header / lines */

export interface SalesHeaderInput {
  documentType: SalesDocumentType;
  customerId: number;
  postingDate: IsoDate;
  documentDate: IsoDate;
  paymentTermsCode?: string | null;
  paymentMethodCode?: string | null;
  yourReference?: string | null;
  salesperson?: string | null;
  /** Transaction currency; omitted → the customer's default currency, else KES. */
  currencyCode?: string | null;
  /** Credit Memo only — the posted invoice being corrected (BC Applies-to Doc. No.). */
  appliesToDocNo?: string | null;
}

export interface SalesLineInput {
  type: SalesLineType;
  no: string | null;
  description?: string | null;
  quantity: number;
  unitPrice: Cents;
  lineDiscountPct?: number;
  locationCode?: string | null;
  faDepreciationBookCode?: string | null;
  deprUntilDate?: IsoDate | null;
}

async function loadCustomer(id: number): Promise<{ id: number; no: string; name: string; blocked: string; customer_posting_group_code: string | null; payment_terms_code: string | null; currency_code: string | null; address: string | null; city: string | null; contact: string | null }> {
  const c = await one<{ id: number; no: string; name: string; blocked: string; customer_posting_group_code: string | null; payment_terms_code: string | null; currency_code: string | null; address: string | null; city: string | null; contact: string | null }>(
    'SELECT id, no, name, blocked, customer_posting_group_code, payment_terms_code, currency_code, address, city, contact FROM customer WHERE id = ?', id,
  );
  if (!c) throw new AppError('Customer not found', 'NOT_FOUND');
  return c;
}

export async function createSalesDocument(input: SalesHeaderInput, user: Actor): Promise<{ no: string }> {
  if (!DOCUMENT_TYPES.includes(input.documentType)) throw new AppError('Invalid document type', 'VALIDATION');
  if (!input.postingDate) throw new AppError('A posting date is required', 'VALIDATION');
  const customer = await loadCustomer(input.customerId);
  const setup = await getSalesReceivablesSetup();
  const paymentTerms = input.paymentTermsCode || customer.payment_terms_code || setup.default_payment_terms_code;
  const cur = await resolveDocCurrency(input.currencyCode ?? customer.currency_code, input.documentDate || input.postingDate);
  const no = await nextSequence(NO_SERIES_FOR[input.documentType]);
  await run(
    `INSERT INTO sales_header
       (document_type, no, customer_id, posting_date, document_date, payment_terms_code, payment_method_code,
        customer_posting_group_code, your_reference, applies_to_doc_no, salesperson, currency_code,
        currency_factor, created_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    input.documentType, no, customer.id, input.postingDate, input.documentDate || input.postingDate,
    paymentTerms || null, input.paymentMethodCode || null, customer.customer_posting_group_code,
    input.yourReference?.trim() || null, input.appliesToDocNo?.trim() || null,
    input.salesperson?.trim() || null, cur.code, cur.factor,
    new Date().toISOString(), user.username,
  );
  await audit(user, 'SALES_DOCUMENT_CREATE', 'sales_header', no, { documentType: input.documentType, customer: customer.no });
  return { no };
}

export async function updateSalesDocumentHeader(no: string, input: SalesHeaderInput, user: Actor): Promise<void> {
  const before = await one<SalesHeader>('SELECT * FROM sales_header WHERE no = ?', no);
  if (!before) throw new AppError('Sales document not found', 'NOT_FOUND');
  if (before.status !== 'Open') throw new AppError('Only an open document can be edited', 'VALIDATION');
  if (before.created_by !== user.username) throw new AppError('Only the person who created this can edit it', 'NOT_CREATOR');
  const customer = await loadCustomer(input.customerId);
  const cur = await resolveDocCurrency(input.currencyCode ?? before.currency_code, input.documentDate || input.postingDate);
  await run(
    `UPDATE sales_header SET customer_id = ?, posting_date = ?, document_date = ?, payment_terms_code = ?,
       payment_method_code = ?, customer_posting_group_code = ?, your_reference = ?,
       applies_to_doc_no = ?, salesperson = ?, currency_code = ?, currency_factor = ? WHERE no = ?`,
    customer.id, input.postingDate, input.documentDate || input.postingDate, input.paymentTermsCode || null,
    input.paymentMethodCode || null, customer.customer_posting_group_code, input.yourReference?.trim() || null,
    input.appliesToDocNo?.trim() || null, input.salesperson?.trim() || null, cur.code, cur.factor, no,
  );
  await audit(user, 'SALES_DOCUMENT_UPDATE', 'sales_header', no, {});
}

export async function deleteSalesDocument(no: string, user: Actor): Promise<void> {
  const before = await one<Pick<SalesHeader, 'status' | 'created_by'>>('SELECT status, created_by FROM sales_header WHERE no = ?', no);
  if (!before) throw new AppError('Sales document not found', 'NOT_FOUND');
  if (before.status !== 'Open') throw new AppError('Only an open document can be deleted', 'VALIDATION');
  if (before.created_by !== user.username) throw new AppError('Only the person who created this can delete it', 'NOT_CREATOR');
  await run('DELETE FROM sales_header WHERE no = ?', no);
  await audit(user, 'SALES_DOCUMENT_DELETE', 'sales_header', no, {});
}

async function resolveLine(input: SalesLineInput): Promise<{ description: string; unitPrice: Cents }> {
  if (!LINE_TYPES.includes(input.type)) throw new AppError('Invalid line type', 'VALIDATION');
  if (input.type === 'Comment') return { description: input.description?.trim() || '', unitPrice: 0 };
  if (!input.no?.trim()) throw new AppError(`A ${input.type} No. is required`, 'VALIDATION');
  if (!(input.quantity > 0)) throw new AppError('Quantity must be greater than zero', 'VALIDATION');

  if (input.type === 'G/L Account') {
    const acc = await one<{ name: string; is_postable: number; status: string; no_direct_posting: number }>(
      'SELECT name, is_postable, status, no_direct_posting FROM gl_account WHERE code = ?', input.no.trim(),
    );
    if (!acc || !acc.is_postable || acc.status !== 'ACTIVE') throw new AppError('That G/L account is not an active posting account', 'VALIDATION');
    if (acc.no_direct_posting) throw new AppError('That G/L account is a subledger control account and cannot be billed directly', 'VALIDATION');
    return { description: input.description?.trim() || acc.name, unitPrice: input.unitPrice };
  }
  if (input.type === 'Item') {
    const item = await one<{ description: string; status: string; unit_price: Cents }>(
      'SELECT description, status, unit_price FROM item WHERE no = ?', input.no.trim(),
    );
    if (!item) throw new AppError('Item not found', 'NOT_FOUND');
    if (item.status !== 'ACTIVE') throw new AppError('That item is blocked', 'VALIDATION');
    if (!input.locationCode?.trim()) throw new AppError('A Location Code is required for an Item line', 'VALIDATION');
    return { description: input.description?.trim() || item.description, unitPrice: input.unitPrice || item.unit_price };
  }
  // Fixed Asset — Business Central Sales Line Type = Fixed Asset (posting the invoice disposes it).
  const fa = await one<{ id: number; description: string; blocked: number }>(
    'SELECT id, description, blocked FROM fixed_asset WHERE no = ?', input.no.trim(),
  );
  if (!fa) throw new AppError('Fixed asset not found', 'NOT_FOUND');
  if (fa.blocked) throw new AppError('That fixed asset is blocked', 'VALIDATION');
  const faSetup = await import('./fixedAssetsSetup.ts').then((m) => m.getFaSetup());
  const bookCode = input.faDepreciationBookCode?.trim() || faSetup.default_depreciation_book_code;
  if (!bookCode) throw new AppError('A Depreciation Book is required on a Fixed Asset line', 'VALIDATION');
  const book = await one<{ disposed: number }>(
    'SELECT disposed FROM fa_depreciation_book WHERE fixed_asset_id = ? AND depreciation_book_code = ?', fa.id, bookCode,
  );
  if (!book) throw new AppError(`Fixed asset ${input.no} has no FA Depreciation Book for ${bookCode}`, 'VALIDATION');
  if (book.disposed) throw new AppError(`Fixed asset ${input.no} has already been disposed for ${bookCode}`, 'VALIDATION');
  if (!(input.unitPrice > 0)) throw new AppError('Enter the agreed disposal proceeds as the Unit Price on a Fixed Asset line', 'VALIDATION');
  return { description: input.description?.trim() || fa.description, unitPrice: input.unitPrice };
}

export async function setSalesLines(no: string, lines: SalesLineInput[], user: Actor): Promise<void> {
  const header = await one<SalesHeader>('SELECT * FROM sales_header WHERE no = ?', no);
  if (!header) throw new AppError('Sales document not found', 'NOT_FOUND');
  if (header.status !== 'Open') throw new AppError('Only an open document can have its lines edited', 'VALIDATION');
  if (header.created_by !== user.username) throw new AppError('Only the person who created this can edit it', 'NOT_CREATOR');

  const faSetup = await import('./fixedAssetsSetup.ts').then((m) => m.getFaSetup());
  if (header.currency_code !== 'KES' && lines.some((l) => l.type === 'Item' || l.type === 'Fixed Asset')) {
    throw new AppError('Item and Fixed Asset lines are only supported on base-currency (KES) documents', 'VALIDATION');
  }
  await run('DELETE FROM sales_line WHERE sales_header_id = ?', header.id);
  let lineNo = 10000;
  let total = 0;
  for (const input of lines) {
    if (input.type !== 'Comment' && !input.no) continue;
    const resolved = await resolveLine(input);
    const qty = input.type === 'Comment' ? 0 : (input.type === 'Fixed Asset' ? 1 : input.quantity);
    const gross = qty * resolved.unitPrice;
    const discPct = Math.max(0, Math.min(100, input.lineDiscountPct ?? 0));
    const discAmount = Math.round(gross * discPct / 100);
    const lineAmount = input.type === 'Comment' ? 0 : gross - discAmount;
    total += lineAmount;
    const bookCode = input.type === 'Fixed Asset'
      ? (input.faDepreciationBookCode || faSetup.default_depreciation_book_code)
      : null;
    await run(
      `INSERT INTO sales_line
         (sales_header_id, line_no, type, no, description, quantity, unit_price, line_discount_pct, line_discount_amount,
          line_amount, qty_to_ship, qty_to_invoice, location_code, fa_depreciation_book_code, depr_until_date)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      header.id, lineNo, input.type, input.no?.trim() || null, resolved.description, qty, resolved.unitPrice,
      discPct, discAmount, lineAmount, qty, qty, input.locationCode?.trim() || null, bookCode, input.deprUntilDate || null,
    );
    lineNo += 10000;
  }
  await run('UPDATE sales_header SET amount = ? WHERE id = ?', total, header.id);
  await audit(user, 'SALES_DOCUMENT_LINES_SET', 'sales_header', no, { lineCount: lines.length, total });
}

/* --------------------------------------------------------------------- Quote -> Order */

export async function makeOrder(quoteNo: string, user: Actor): Promise<{ no: string }> {
  return tx(async () => {
    const quote = await one<SalesHeader>("SELECT * FROM sales_header WHERE no = ? AND document_type = 'Quote'", quoteNo);
    if (!quote) throw new AppError('Sales quote not found', 'NOT_FOUND');
    const lines = await all<SalesLine>('SELECT * FROM sales_line WHERE sales_header_id = ? ORDER BY line_no', quote.id);
    const orderNo = await nextSequence('SALES_ORDER');
    const info = await run(
      `INSERT INTO sales_header
         (document_type, no, customer_id, sell_to_name, sell_to_address, sell_to_city, sell_to_contact,
          posting_date, document_date, due_date, payment_terms_code, payment_method_code, customer_posting_group_code,
          your_reference, salesperson, global_dimension_1_id, global_dimension_2_id, status, amount, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Open', ?, ?, ?)`,
      'Order', orderNo, quote.customer_id, quote.sell_to_name, quote.sell_to_address, quote.sell_to_city, quote.sell_to_contact,
      quote.posting_date, quote.document_date, quote.due_date, quote.payment_terms_code, quote.payment_method_code,
      quote.customer_posting_group_code, quote.your_reference, quote.salesperson, quote.global_dimension_1_id,
      quote.global_dimension_2_id, quote.amount, new Date().toISOString(), user.username,
    );
    const orderId = Number(info.lastInsertRowid);
    for (const l of lines) {
      await run(
        `INSERT INTO sales_line
           (sales_header_id, line_no, type, no, description, quantity, unit_price, line_discount_pct, line_discount_amount,
            line_amount, qty_to_ship, qty_to_invoice, location_code, fa_depreciation_book_code, depr_until_date,
            global_dimension_1_id, global_dimension_2_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        orderId, l.line_no, l.type, l.no, l.description, l.quantity, l.unit_price, l.line_discount_pct,
        l.line_discount_amount, l.line_amount, l.quantity, l.quantity, l.location_code, l.fa_depreciation_book_code,
        l.depr_until_date, l.global_dimension_1_id, l.global_dimension_2_id,
      );
    }
    await run('DELETE FROM sales_header WHERE id = ?', quote.id);
    await audit(user, 'SALES_QUOTE_MAKE_ORDER', 'sales_header', orderNo, { fromQuote: quoteNo });
    return { no: orderNo };
  });
}

/* --------------------------------------------------------------- maker-checker */

export async function submitSalesDocument(no: string, user: Actor): Promise<{ autoApproved: boolean }> {
  const req = await one<SalesHeader>('SELECT * FROM sales_header WHERE no = ?', no);
  if (!req) throw new AppError('Sales document not found', 'NOT_FOUND');
  if (req.status !== 'Open') throw new AppError('Only an open document can be submitted', 'VALIDATION');
  if (req.document_type === 'Quote') throw new AppError('Convert the quote to an order first', 'VALIDATION');
  if (req.amount <= 0) throw new AppError('Add at least one line before submitting', 'VALIDATION');

  const matched = await findMatchingWorkflow('SALES_DOCUMENT', await pickConditionFields('SALES_DOCUMENT', req));
  if (!matched) throw new AppError('There is no enabled workflow for this document', 'NO_WORKFLOW');

  await tx(async () => {
    // Re-submitting clears the previous rejection: the document leaves the Rejected bucket.
    await run("UPDATE sales_header SET status = 'Pending Approval', decision_reason = NULL WHERE no = ?", no);
    await startWorkflow(matched.workflow, matched.steps, {
      documentType: 'SALES_DOCUMENT', entityId: no, requestedBy: user.username, amount: Number(req.amount),
    });
  });
  const after = await one<{ status: string }>('SELECT status FROM sales_header WHERE no = ?', no);
  return { autoApproved: after?.status === 'Released' };
}

export async function cancelSalesDocumentApproval(no: string, user: Actor): Promise<void> {
  const req = await one<Pick<SalesHeader, 'status' | 'created_by'>>('SELECT status, created_by FROM sales_header WHERE no = ?', no);
  if (!req) throw new AppError('Sales document not found', 'NOT_FOUND');
  if (req.status !== 'Pending Approval') throw new AppError('Only a document pending approval can be recalled', 'VALIDATION');
  const routed = await findPendingRoutedTask('SALES_DOCUMENT', no);
  if ((routed?.requested_by ?? req.created_by) !== user.username) throw new AppError('Only the person who submitted this can recall it', 'NOT_REQUESTER');
  await run("UPDATE sales_header SET status = 'Open' WHERE no = ?", no);
  await audit(user, 'SALES_DOCUMENT_CANCEL_APPROVAL', 'sales_header', no, {});
}

/** BC "Release" — snapshots the sell-to fields and recomputes the due date from Payment Terms. */
export async function approveSalesDocument(no: string, user: Actor): Promise<void> {
  const req = await one<SalesHeader>('SELECT * FROM sales_header WHERE no = ?', no);
  if (!req) throw new AppError('Sales document not found', 'NOT_FOUND');
  if (req.status !== 'Pending Approval') throw new AppError('Only a document pending approval can be released', 'VALIDATION');
  const customer = await loadCustomer(req.customer_id);
  const check = await checkCustomerAllowed(req.customer_id, req.document_type === 'Credit Memo' ? 'Invoice' : 'Ship');
  if (check.blocked) throw new AppError(check.reason ?? 'Customer is blocked', 'VALIDATION');

  let dueDate: IsoDate | null = req.due_date;
  if (req.payment_terms_code) {
    const pt = await one<{ due_date_calculation: string; discount_date_calculation: string }>(
      'SELECT due_date_calculation, discount_date_calculation FROM payment_terms WHERE code = ?', req.payment_terms_code,
    );
    if (pt) dueDate = applyDateFormula(req.document_date, pt.due_date_calculation);
  }
  await run(
    `UPDATE sales_header SET status = 'Released', decision_reason = NULL, due_date = ?,
       sell_to_name = ?, sell_to_address = ?, sell_to_city = ?, sell_to_contact = ? WHERE no = ?`,
    dueDate, customer.name, customer.address, customer.city, customer.contact, no,
  );
  await audit(user, 'SALES_DOCUMENT_RELEASE', 'sales_header', no, {});
}

export async function rejectSalesDocument(no: string, reason: string | null, user: Actor): Promise<void> {
  if (!reason?.trim()) throw new AppError('A reason is required to reject a sales document', 'VALIDATION');
  const req = await one<SalesHeader>('SELECT * FROM sales_header WHERE no = ?', no);
  if (!req) throw new AppError('Sales document not found', 'NOT_FOUND');
  if (req.status !== 'Pending Approval') throw new AppError('Only a document pending approval can be rejected', 'VALIDATION');
  await run("UPDATE sales_header SET status = 'Open', decision_reason = ? WHERE no = ?", reason, no);
  await audit(user, 'SALES_DOCUMENT_REJECT', 'sales_header', no, { reason });
}

export async function reopenSalesDocument(no: string, user: Actor): Promise<void> {
  const req = await one<SalesHeader>('SELECT * FROM sales_header WHERE no = ?', no);
  if (!req) throw new AppError('Sales document not found', 'NOT_FOUND');
  if (req.status !== 'Released') throw new AppError('Only a released document can be reopened', 'VALIDATION');
  const shipped = await hasAnyRow('sales_line', 'sales_header_id = ? AND qty_shipped > 0', req.id);
  if (shipped) throw new AppError('This order has already been partly shipped and cannot be reopened', 'VALIDATION');
  await run("UPDATE sales_header SET status = 'Open', decision_reason = NULL WHERE no = ?", no);
  await audit(user, 'SALES_DOCUMENT_REOPEN', 'sales_header', no, {});
}

/* ------------------------------------------------------------------- posting */

interface GlLeg { account: number; debit: Cents; credit: Cents; narration: string }

export interface PostSalesDocumentResult {
  shipmentNo: string | null;
  invoiceNo: string | null;
  custLedgerEntryId: number | null;
  journalNo: string | null;
}

export async function postSalesDocument(
  no: string, opts: { ship?: boolean; invoice?: boolean }, user: Actor,
): Promise<PostSalesDocumentResult> {
  return tx(async () => {
    const header = await one<SalesHeader>('SELECT * FROM sales_header WHERE no = ?', no);
    if (!header) throw new AppError('Sales document not found', 'NOT_FOUND');
    if (header.status !== 'Released') throw new AppError('Only a released document can be posted', 'VALIDATION');

    const isOrder = header.document_type === 'Order';
    const isCreditMemo = header.document_type === 'Credit Memo';
    const doShip = isOrder ? (opts.ship ?? true) : false;
    const doInvoice = isOrder ? (opts.invoice ?? true) : true;
    if (isOrder && !doShip && !doInvoice) throw new AppError('Choose Ship, Invoice, or both', 'VALIDATION');

    // Posting-date window (Sales & Receivables Setup, then the user's own G/L range).
    const setup = await getSalesReceivablesSetup();
    const vd = header.posting_date;
    if (setup.allow_receivables_posting_from && vd < setup.allow_receivables_posting_from) {
      throw new AppError(`Receivables posting is not allowed before ${setup.allow_receivables_posting_from}`, 'VALIDATION');
    }
    if (setup.allow_receivables_posting_to && vd > setup.allow_receivables_posting_to) {
      throw new AppError(`Receivables posting is not allowed after ${setup.allow_receivables_posting_to}`, 'VALIDATION');
    }
    const range = await getEffectivePostingRange(user.id);
    if (range.from && vd < range.from) throw new AppError(`Posting date ${vd} is before your earliest allowed date (${range.from})`, 'VALIDATION');
    if (range.to && vd > range.to) throw new AppError(`Posting date ${vd} is after your latest allowed date (${range.to})`, 'VALIDATION');

    const customer = await loadCustomer(header.customer_id);
    if (!header.customer_posting_group_code) throw new AppError('The document has no Customer Posting Group', 'VALIDATION');
    const pg = await one<{ id: number; receivables_account_id: number }>(
      'SELECT id, receivables_account_id FROM customer_posting_group WHERE code = ?', header.customer_posting_group_code,
    );
    if (!pg) throw new AppError('Customer Posting Group setup is missing', 'VALIDATION');

    const lines = await all<SalesLine>('SELECT * FROM sales_line WHERE sales_header_id = ? ORDER BY line_no', header.id);
    const billable = lines.filter((l) => l.type !== 'Comment' && (l.no ?? '') !== '');
    if (!billable.length) throw new AppError('There is nothing to post on this document', 'VALIDATION');

    const sign = isCreditMemo ? -1 : 1;
    const dir = (n: Cents): { debit: Cents; credit: Cents } => (n >= 0
      ? { debit: n, credit: 0 } : { debit: 0, credit: -n });

    const glLegs: GlLeg[] = [];
    let invoiceTotal = 0;
    const postedLines: {
      line: SalesLine; postQty: number; lineAmount: Cents; cogs: Cents;
      itemLedgerEntryId: number | null; faLedgerEntryId: number | null;
    }[] = [];

    for (const line of billable) {
      // How much of this line to post now.
      let postQty: number;
      if (isOrder) {
        const shipNow = doShip ? Math.min(line.qty_to_ship, line.quantity - line.qty_shipped) : 0;
        const invoiceNow = doInvoice
          ? Math.min(line.qty_to_invoice, (doShip ? line.qty_shipped + shipNow : line.qty_shipped) - line.qty_invoiced)
          : 0;
        postQty = doInvoice ? invoiceNow : shipNow;
        if (postQty <= 0 && shipNow <= 0) continue;
      } else {
        postQty = line.quantity - line.qty_invoiced;
        if (postQty <= 0) continue;
      }

      const lineAmount = line.quantity > 0 ? Math.round(postQty / line.quantity * line.line_amount) : line.line_amount;
      const narration = `${header.document_type} ${no} — ${line.type} ${line.no}`.slice(0, 250);
      let cogs = 0;
      let itemLedgerEntryId: number | null = null;
      let faLedgerEntryId: number | null = null;

      if (doInvoice || !isOrder) invoiceTotal += lineAmount;

      if (line.type === 'G/L Account' && (doInvoice || !isOrder)) {
        const acc = await one<{ id: number }>('SELECT id FROM gl_account WHERE code = ?', line.no!);
        const d = dir(-sign * lineAmount); // credit revenue
        glLegs.push({ account: acc!.id, debit: d.debit, credit: d.credit, narration });
      }

      if (line.type === 'Item' && (doShip || doInvoice || !isOrder)) {
        const item = await one<{
          id: number; costing_method: string; inventory_posting_group_id: number; product_posting_group_id: number;
        }>('SELECT id, costing_method, inventory_posting_group_id, product_posting_group_id FROM item WHERE no = ?', line.no!);
        if (!item) throw new AppError(`Item ${line.no} not found`, 'NOT_FOUND');
        const loc = await one<{ id: number }>('SELECT id FROM location WHERE code = ?', line.location_code!);
        if (!loc) throw new AppError(`Location ${line.location_code} not found`, 'NOT_FOUND');
        const ppg = await one<{ sales_gl_account_id: number | null; cogs_gl_account_id: number | null }>(
          'SELECT sales_gl_account_id, cogs_gl_account_id FROM product_posting_group WHERE id = ?', item.product_posting_group_id,
        );
        const ipg = await one<{ inventory_gl_account_id: number }>(
          'SELECT inventory_gl_account_id FROM inventory_posting_group WHERE id = ?', item.inventory_posting_group_id,
        );
        if (!ppg?.sales_gl_account_id || !ppg?.cogs_gl_account_id) {
          throw new AppError(`Item ${line.no}'s Product Posting Group has no Sales / COGS account configured`, 'VALIDATION');
        }
        if (!ipg) throw new AppError(`Item ${line.no}'s Inventory Posting Group setup is missing`, 'VALIDATION');

        // Move stock on the ship (Order) or on the single invoice post (Invoice doc).
        if (doShip || !isOrder) {
          const baseQty = Math.round(postQty);
          const costed = await costOutbound(item.id, loc.id, item.costing_method as never, sign > 0 ? baseQty : baseQty, null);
          cogs = baseQty * costed.unitCost;
          const ile = await run(
            `INSERT INTO item_ledger_entry
               (item_id, location_id, posting_date, entry_type, document_no, quantity, remaining_quantity, open, unit_cost, amount, created_at)
             VALUES (?,?,?, 'Sale', ?,?,0,false,?,?,?)`,
            item.id, loc.id, vd, no, -sign * baseQty, costed.unitCost, -sign * cogs, new Date().toISOString(),
          );
          itemLedgerEntryId = Number(ile.lastInsertRowid);
          if (sign > 0) await applyOutboundLots(itemLedgerEntryId, costed.applications, vd);
          const sku = await one<{ id: number; inventory: number }>(
            'SELECT id, inventory FROM stockkeeping_unit WHERE item_id = ? AND location_id = ?', item.id, loc.id,
          );
          const delta = -sign * baseQty;
          if (!sku) await run('INSERT INTO stockkeeping_unit (item_id, location_id, inventory) VALUES (?,?,?)', item.id, loc.id, delta);
          else await run('UPDATE stockkeeping_unit SET inventory = ? WHERE id = ?', sku.inventory + delta, sku.id);
          const roll = await one<{ total: number }>('SELECT COALESCE(SUM(inventory),0) AS total FROM stockkeeping_unit WHERE item_id = ?', item.id);
          await run('UPDATE item SET inventory = ? WHERE id = ?', roll?.total ?? 0, item.id);

          // COGS legs (Dr COGS / Cr Inventory) — credit-memo reverses.
          const c1 = dir(sign * cogs);
          const c2 = dir(-sign * cogs);
          glLegs.push({ account: ppg.cogs_gl_account_id, debit: c1.debit, credit: c1.credit, narration: `${narration} — COGS` });
          glLegs.push({ account: ipg.inventory_gl_account_id, debit: c2.debit, credit: c2.credit, narration: `${narration} — inventory` });
        }
        // Revenue leg on invoice.
        if (doInvoice || !isOrder) {
          const r = dir(-sign * lineAmount);
          glLegs.push({ account: ppg.sales_gl_account_id, debit: r.debit, credit: r.credit, narration: `${narration} — sales` });
        }
      }

      if (line.type === 'Fixed Asset' && (doInvoice || !isOrder)) {
        const fa = await one<{ id: number }>('SELECT id FROM fixed_asset WHERE no = ?', line.no!);
        const disp = await disposeFixedAssetForSale(
          fa!.id, line.fa_depreciation_book_code!, lineAmount, vd, no, line.description, user,
        );
        for (const l of disp.glLines) glLegs.push(l);
        faLedgerEntryId = disp.faLedgerEntryId;
      }

      // Advance the line's posted quantities.
      if (isOrder) {
        await run(
          'UPDATE sales_line SET qty_shipped = qty_shipped + ?, qty_invoiced = qty_invoiced + ? WHERE id = ?',
          doShip ? postQty : 0, doInvoice ? postQty : 0, line.id,
        );
      } else {
        await run('UPDATE sales_line SET qty_invoiced = quantity, qty_shipped = quantity WHERE id = ?', line.id);
      }
      postedLines.push({ line, postQty, lineAmount, cogs, itemLedgerEntryId, faLedgerEntryId });
    }

    if (!postedLines.length) throw new AppError('Nothing was posted — check the Qty. to Ship / Qty. to Invoice on the lines', 'VALIDATION');

    // Receivables header leg (Invoice / Credit Memo only).
    let custLedgerEntryId: number | null = null;
    let journalNo: string | null = null;
    let journalId: number | null = null;
    let invoiceNo: string | null = null;
    let shipmentNo: string | null = null;
    const willInvoice = doInvoice || !isOrder;

    if (willInvoice && invoiceTotal !== 0) {
      const r = dir(sign * invoiceTotal);
      glLegs.unshift({ account: pg.receivables_account_id, debit: r.debit, credit: r.credit, narration: `${header.document_type} ${no} — ${customer.no}` });
    }

    const totalDebit = glLegs.reduce((s, l) => s + l.debit, 0);
    const totalCredit = glLegs.reduce((s, l) => s + l.credit, 0);
    if (glLegs.length && totalDebit !== totalCredit) throw new AppError('Internal error: the sales journal did not balance', 'POSTING_ERROR');
    if (glLegs.length >= 2 && totalDebit > 0) {
      const j = await postJournal({
        valueDate: vd, module: 'RECEIVABLES',
        eventType: isCreditMemo ? 'SALES_CREDIT_MEMO' : willInvoice ? 'SALES_INVOICE' : 'SALES_SHIPMENT',
        description: `${header.document_type} ${no} — ${customer.name}`, reference: no, user,
        idempotencyKey: `SALES-${no}-${new Date().toISOString()}`,
        currencyCode: header.currency_code, currencyFactor: header.currency_factor,
        globalDimension1Id: header.global_dimension_1_id, globalDimension2Id: header.global_dimension_2_id,
        lines: glLegs.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit, narration: l.narration })),
      });
      journalNo = j.journal_no;
      journalId = j.id;
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
            pmtDiscPossible = Math.round(invoiceTotal * pt.discount_pct / 100);
          }
        }
      }
      custLedgerEntryId = await createCustLedgerEntry({
        customerId: customer.id, postingDate: vd,
        documentType: isCreditMemo ? 'Credit Memo' : 'Invoice',
        documentNo: no, description: `${header.document_type} ${no}`,
        amount: sign * invoiceTotal, currencyCode: header.currency_code, currencyFactor: header.currency_factor,
        dueDate, pmtDiscountDate: pmtDiscDate, pmtDiscountPossible: pmtDiscPossible,
        sourceType: isCreditMemo ? 'Sales Credit Memo' : 'Sales Invoice', sourceId: header.id, journalId,
      });
      // BC's Applies-to Doc. No.: a corrective credit memo settles the invoice it was raised
      // against, so the customer is not left with an open invoice and an open credit note.
      if (isCreditMemo && header.applies_to_doc_no && custLedgerEntryId) {
        const target = await one<{ id: number }>(
          `SELECT id FROM cust_ledger_entry
           WHERE customer_id = ? AND document_no = ? AND open = 1 AND positive = 1
           ORDER BY id LIMIT 1`,
          customer.id, header.applies_to_doc_no,
        );
        // Silent when the invoice is already settled — the memo still posts, just unapplied.
        if (target) {
          await applyCustomerEntries(
            { applyingEntryId: custLedgerEntryId, appliedTo: [target.id], postingDate: vd }, user,
          );
        }
      }
      invoiceNo = await nextSequence(isCreditMemo ? 'POSTED_SALES_CREDIT_MEMO' : 'POSTED_SALES_INVOICE');
      await writePostedDocument(isCreditMemo ? 'Credit Memo' : 'Invoice', invoiceNo, header, customer, vd, isOrder ? no : null, journalId, custLedgerEntryId, postedLines, user);
      await recomputeCustomerBalance(customer.id);
    }
    if (doShip && isOrder) {
      shipmentNo = await nextSequence('POSTED_SALES_SHIPMENT');
      await writePostedDocument('Shipment', shipmentNo, header, customer, vd, no, null, null, postedLines, user);
    }

    // Order housekeeping — fully shipped + invoiced order is deleted (BC).
    if (isOrder) {
      const remaining = await one<{ n: number }>(
        'SELECT COUNT(*) AS n FROM sales_line WHERE sales_header_id = ? AND (qty_shipped < quantity OR qty_invoiced < quantity)',
        header.id,
      );
      if (Number(remaining?.n ?? 0) === 0) {
        await run('DELETE FROM sales_header WHERE id = ?', header.id);
      }
    } else {
      await run('DELETE FROM sales_header WHERE id = ?', header.id);
    }

    await audit(user, 'SALES_DOCUMENT_POST', 'sales_header', no, { shipmentNo, invoiceNo, journalNo, invoiceTotal });
    return { shipmentNo, invoiceNo, custLedgerEntryId, journalNo };
  });
}

async function writePostedDocument(
  documentType: 'Shipment' | 'Invoice' | 'Credit Memo', postedNo: string, header: SalesHeader,
  customer: { id: number; name: string; address: string | null; city: string | null; contact: string | null },
  vd: IsoDate, orderNo: string | null, journalId: number | null, custLedgerEntryId: number | null,
  postedLines: { line: SalesLine; postQty: number; lineAmount: Cents; cogs: Cents; itemLedgerEntryId: number | null; faLedgerEntryId: number | null }[],
  _user: Actor,
): Promise<void> {
  const total = documentType === 'Shipment' ? 0 : postedLines.reduce((s, p) => s + p.lineAmount, 0);
  const info = await run(
    `INSERT INTO posted_sales_document
       (document_type, no, customer_id, sell_to_name, sell_to_address, sell_to_city, sell_to_contact,
        posting_date, document_date, due_date, order_no, source_no, payment_terms_code, your_reference,
        applies_to_doc_no, currency_code, currency_factor, amount,
        cust_ledger_entry_id, journal_id, created_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    documentType, postedNo, customer.id, customer.name, customer.address, customer.city, customer.contact,
    // source_no is what the approval trail was recorded against — order_no is null on an
    // invoice raised directly, and the printout still has to name who approved it.
    vd, header.document_date, header.due_date, orderNo, header.no, header.payment_terms_code,
    header.your_reference,
    header.applies_to_doc_no, header.currency_code, header.currency_factor, total,
    custLedgerEntryId, journalId, new Date().toISOString(), _user.username,
  );
  const docId = Number(info.lastInsertRowid);
  let lineNo = 10000;
  for (const p of postedLines) {
    await run(
      `INSERT INTO posted_sales_line
         (posted_sales_document_id, line_no, type, no, description, quantity, unit_price, line_discount_amount,
          line_amount, cogs_amount, item_ledger_entry_id, fa_ledger_entry_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      docId, lineNo, p.line.type, p.line.no, p.line.description, p.postQty, p.line.unit_price,
      p.line.quantity > 0 ? Math.round(p.postQty / p.line.quantity * p.line.line_discount_amount) : 0,
      documentType === 'Shipment' ? 0 : p.lineAmount, p.cogs, p.itemLedgerEntryId, p.faLedgerEntryId,
    );
    lineNo += 10000;
  }
}

/* -------------------------------------------------------------- posted documents */

export interface PostedSalesDocumentDetail extends PostedSalesDocumentView {
  lines: PostedSalesLine[];
}

/**
 * One posted Shipment / Invoice / Credit Memo with its lines.
 *
 * Posting deletes the source sales_header (Business Central does the same), so this is the only
 * record of the document afterwards — and what the poster is sent to once the posting succeeds.
 */
export async function getPostedSalesDocument(no: string): Promise<PostedSalesDocumentDetail | undefined> {
  const header = await one<PostedSalesDocumentView>(
    `SELECT d.*, c.no AS customer_no, c.name AS customer_name
     FROM posted_sales_document d JOIN customer c ON c.id = d.customer_id WHERE d.no = ?`, no,
  );
  if (!header) return undefined;
  const lines = await all<PostedSalesLine>(
    'SELECT * FROM posted_sales_line WHERE posted_sales_document_id = ? ORDER BY line_no', header.id,
  );
  return { ...header, lines };
}

/* --------------------------------------------- corrective credit memo (copy document) */

/** One posted invoice offered as the source of a corrective credit memo. */
export interface PostedInvoiceOption {
  no: string;
  posting_date: IsoDate;
  customer_id: number;
  customer_no: string;
  customer_name: string;
  amount: Cents;
  /** What is still open on the customer ledger — 0 once the invoice has been settled. */
  remaining_amount: Cents;
}

/**
 * Posted sales invoices a credit memo can be raised against, newest first — Business Central's
 * "Copy Document" / "Create Corrective Credit Memo" source list. The customer is chosen first, so
 * the list is always one customer's, and only invoices still open on the customer ledger are
 * offered — the same set BC's Applies-to Doc. No. lookup shows. No customer, nothing to list.
 */
export const listPostedInvoicesForCredit = (customerId?: number | null): Promise<PostedInvoiceOption[]> =>
  !customerId ? Promise.resolve([]) : all<PostedInvoiceOption>(
    `SELECT d.no, d.posting_date, d.customer_id, c.no AS customer_no, c.name AS customer_name,
            d.amount, COALESCE(e.remaining_amount, 0) AS remaining_amount
     FROM posted_sales_document d
     JOIN customer c ON c.id = d.customer_id
     LEFT JOIN cust_ledger_entry e ON e.id = d.cust_ledger_entry_id
     WHERE d.document_type = 'Invoice' AND d.customer_id = @customerId
       AND COALESCE(e.remaining_amount, 0) <> 0
     ORDER BY d.id DESC
     LIMIT 200`,
    { customerId },
  );

/** A posted invoice reshaped into the header + line drafts a credit memo starts from. */
export interface CreditMemoSource {
  invoiceNo: string;
  customerId: number;
  customerNo: string;
  customerName: string;
  postingDate: IsoDate;
  paymentTermsCode: string | null;
  yourReference: string | null;
  currencyCode: string;
  amount: Cents;
  lines: {
    type: SalesLineType;
    no: string | null;
    description: string | null;
    quantity: number;
    unitPrice: Cents;
    /** Recovered from the posted line's discount amount, which is what was actually stored. */
    lineDiscountPct: number;
  }[];
}

/**
 * The posted invoice, ready to prefill a credit memo — Business Central's Copy Document with
 * "Include Header" on. Quantities come across positive: a credit memo is a negative document by
 * virtue of its type, not by carrying negative lines (see postSalesDocument's `sign`).
 */
export async function getInvoiceForCreditMemo(no: string): Promise<CreditMemoSource | undefined> {
  const doc = await one<PostedSalesDocumentView>(
    `SELECT d.*, c.no AS customer_no, c.name AS customer_name
     FROM posted_sales_document d JOIN customer c ON c.id = d.customer_id
     WHERE d.no = ? AND d.document_type = 'Invoice'`, no,
  );
  if (!doc) return undefined;
  const lines = await all<PostedSalesLine>(
    'SELECT * FROM posted_sales_line WHERE posted_sales_document_id = ? ORDER BY line_no', doc.id,
  );
  return {
    invoiceNo: doc.no,
    customerId: doc.customer_id,
    customerNo: doc.customer_no,
    customerName: doc.customer_name,
    postingDate: doc.posting_date,
    paymentTermsCode: doc.payment_terms_code,
    yourReference: doc.your_reference,
    currencyCode: doc.currency_code,
    amount: doc.amount,
    lines: lines.map((l) => {
      const gross = Math.round(l.quantity * l.unit_price);
      return {
        type: l.type,
        no: l.no,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unit_price,
        lineDiscountPct: gross > 0 ? Math.round((l.line_discount_amount / gross) * 10000) / 100 : 0,
      };
    }),
  };
}
