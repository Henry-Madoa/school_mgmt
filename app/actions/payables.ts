'use server';

import { revalidatePath } from 'next/cache';
import { requireAction, requireUser } from '@/lib/session';
import { actionResult, AppError } from '@/lib/errors';
import { toCents } from '@/lib/format';
import {
  listVendorPostingGroups, createVendorPostingGroup, updateVendorPostingGroup, deleteVendorPostingGroup,
  type VendorPostingGroupInput,
  getPurchasesPayablesSetup, savePurchasesPayablesSetup, type PurchasesPayablesSetupInput,
} from '@/lib/payablesSetup';
import {
  listVendors, getVendor, createVendor, updateVendor, vendorStatistics, getVendorLedgerEntries,
  type VendorInput,
} from '@/lib/vendors';
import {
  listPurchaseDocuments, getPurchaseDocument, createPurchaseDocument, updatePurchaseDocumentHeader, deletePurchaseDocument,
  setPurchaseLines, makeOrder, submitPurchaseDocument, cancelPurchaseDocumentApproval, approvePurchaseDocument,
  rejectPurchaseDocument, reopenPurchaseDocument, postPurchaseDocument,
  listPostedInvoicesForCredit, getInvoiceForCreditMemo,
  type PurchaseHeaderInput, type PurchaseLineInput,
} from '@/lib/purchaseDocuments';
import { applyVendorEntries, unapplyVendorEntry } from '@/lib/vendLedger';
import { getAgedAccountsPayable, getVendorStatement } from '@/lib/payablesReports';
import { findPendingRoutedTask, decideWorkflowTask } from '@/lib/workflow';
import type {
  ActionResult, FormValues, PurchaseDocumentType, PurchaseLineType, VendorBlocked,
} from '@/lib/types';

const revalidate = (): void => revalidatePath('/payables', 'layout');
const str = (v: unknown): string => String(v ?? '').trim();
const opt = (v: unknown): string | null => (str(v) === '' ? null : str(v));
const numOrNull = (v: unknown): number | null => (v === undefined || v === '' || v === null ? null : Number(v));
const bool = (v: unknown): boolean => v === 'on' || v === 'true' || v === true || v === 1 || v === '1';

/* ------------------------------------------------------------------ setup masters */

export async function listVendorPostingGroupsRequest() {
  return actionResult(async () => { await requireAction('PAYABLES_READ'); return listVendorPostingGroups(); });
}
const toVpg = (v: FormValues): VendorPostingGroupInput => ({
  code: str(v.code), description: str(v.description),
  payablesAccountId: Number(v.payables_account_id),
  serviceChargeAccountId: Number(v.service_charge_account_id),
  paymentDiscDebitAccountId: Number(v.payment_disc_debit_account_id),
  paymentDiscCreditAccountId: Number(v.payment_disc_credit_account_id),
  invoiceRoundingAccountId: Number(v.invoice_rounding_account_id),
});
export async function createVpgRequest(v: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => { const u = await requireAction('PAYABLES_SETUP_MANAGE'); const r = await createVendorPostingGroup(toVpg(v), u); revalidate(); return r; });
}
export async function updateVpgRequest(id: number, v: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => { const u = await requireAction('PAYABLES_SETUP_MANAGE'); await updateVendorPostingGroup(id, toVpg(v), u); revalidate(); return { id }; });
}
/** Removable only while no vendor still names it — the lib function counts them. */
export async function deleteVpgRequest(id: number): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => { const u = await requireAction('PAYABLES_SETUP_MANAGE'); await deleteVendorPostingGroup(id, u); revalidate(); return { id }; });
}

export async function getPurchasesPayablesSetupRequest() {
  return actionResult(async () => { await requireAction('PAYABLES_READ'); return getPurchasesPayablesSetup(); });
}
export async function savePurchasesPayablesSetupRequest(v: FormValues): Promise<ActionResult<{ saved: true }>> {
  return actionResult(async () => {
    const u = await requireAction('PAYABLES_SETUP_MANAGE');
    const input: PurchasesPayablesSetupInput = {
      defaultVendorPostingGroupCode: opt(v.default_vendor_posting_group_code),
      defaultPaymentTermsCode: opt(v.default_payment_terms_code),
      receiptOnInvoice: bool(v.receipt_on_invoice),
      exactCostReversingMandatory: bool(v.exact_cost_reversing_mandatory),
      allowPayablesPostingFrom: opt(v.allow_payables_posting_from),
      allowPayablesPostingTo: opt(v.allow_payables_posting_to),
    };
    await savePurchasesPayablesSetup(input, u); revalidate(); return { saved: true };
  });
}

/* ------------------------------------------------------------------- vendors */

const toVendorInput = (v: FormValues): VendorInput => ({
  name: str(v.name), name2: opt(v.name2), address: opt(v.address), address2: opt(v.address2), city: opt(v.city),
  postCode: opt(v.postCode), country: opt(v.country), contact: opt(v.contact), phone: opt(v.phone), email: opt(v.email),
  vendorPostingGroupCode: opt(v.vendorPostingGroupCode), vatBusPostingGroupCode: opt(v.vatBusPostingGroupCode),
  pinNo: opt(v.pinNo), whtExempt: bool(v.whtExempt), currencyCode: opt(v.currencyCode),
  paymentTermsCode: opt(v.paymentTermsCode),
  paymentMethodCode: opt(v.paymentMethodCode), purchaser: opt(v.purchaser), ourAccountNo: opt(v.ourAccountNo),
  creditLimit: toCents(v.creditLimit), blocked: (str(v.blocked || '') as VendorBlocked),
  globalDimension1Id: numOrNull(v.globalDimension1Id), globalDimension2Id: numOrNull(v.globalDimension2Id),
});
export async function listVendorsRequest(opts: Parameters<typeof listVendors>[0]) {
  return actionResult(async () => { await requireAction('PAYABLES_READ'); return listVendors(opts); });
}
export async function getVendorRequest(no: string) {
  return actionResult(async () => { await requireAction('PAYABLES_READ'); const v = await getVendor(no); if (!v) return null; return { vendor: v, stats: await vendorStatistics(v.id) }; });
}
export async function vendorLedgerEntriesRequest(vendorId: number) {
  return actionResult(async () => { await requireAction('PAYABLES_READ'); return getVendorLedgerEntries({ vendorId }); });
}
export async function requestVendor(v: FormValues): Promise<ActionResult<{ no: string }>> {
  return actionResult(async () => { const u = await requireAction('PAYABLES_VENDOR_MANAGE'); const r = await createVendor(toVendorInput(v), u); revalidate(); return r; });
}
export async function saveVendor(no: string, v: FormValues): Promise<ActionResult<{ no: string }>> {
  return actionResult(async () => { const u = await requireAction('PAYABLES_VENDOR_MANAGE'); await updateVendor(no, toVendorInput(v), u); revalidate(); return { no }; });
}

/* ------------------------------------------------------------- purchase documents */

export async function listPurchaseDocumentsRequest(opts: Parameters<typeof listPurchaseDocuments>[0]) {
  return actionResult(async () => { await requireAction('PAYABLES_READ'); return listPurchaseDocuments(opts); });
}
export async function getPurchaseDocumentRequest(no: string) {
  return actionResult(async () => { await requireAction('PAYABLES_READ'); return getPurchaseDocument(no); });
}
const toPurchaseHeaderInput = (v: FormValues): PurchaseHeaderInput => ({
  documentType: (str(v.documentType || 'Invoice') as PurchaseDocumentType),
  vendorId: Number(v.vendorId),
  postingDate: str(v.postingDate), documentDate: str(v.documentDate || v.postingDate),
  paymentTermsCode: opt(v.paymentTermsCode), paymentMethodCode: opt(v.paymentMethodCode),
  vendorInvoiceNo: opt(v.vendorInvoiceNo), purchaser: opt(v.purchaser),
  appliesToDocNo: opt(v.appliesToDocNo),
});

/** The vendor's open posted invoices a credit memo can be raised against. */
export async function listPostedInvoicesForCreditRequest(vendorId?: number | null) {
  return actionResult(async () => {
    await requireAction('PAYABLES_READ');
    return listPostedInvoicesForCredit(vendorId ?? null);
  });
}

/** One posted invoice, reshaped into the header + lines a credit memo starts from. */
export async function getInvoiceForCreditMemoRequest(no: string) {
  return actionResult(async () => {
    await requireAction('PAYABLES_READ');
    const src = await getInvoiceForCreditMemo(no);
    if (!src) throw new AppError('Posted invoice not found', 'NOT_FOUND');
    return src;
  });
}
export interface PurchaseLineDraft {
  type: string; no: string; description: string; quantity: string; directUnitCost: string; lineDiscountPct: string;
  locationCode: string; faDepreciationBookCode: string;
}
// Every line the user keeps has to say what it is for — lib/purchaseDocuments.ts would otherwise
// fall back to the master record's own name, which reads as boilerplate on the printed document.
const toPurchaseLines = (lines: PurchaseLineDraft[]): PurchaseLineInput[] => lines
  .filter((l) => l.type === 'Comment' || l.no)
  .map((l) => {
    if (!l.description?.trim()) throw new AppError('Every document line needs a description', 'VALIDATION');
    return l;
  })
  .map((l) => ({
    type: (l.type as PurchaseLineType), no: l.no || null, description: l.description || null,
    quantity: Number(l.quantity || 0), directUnitCost: toCents(l.directUnitCost), lineDiscountPct: Number(l.lineDiscountPct || 0),
    locationCode: l.locationCode || null, faDepreciationBookCode: l.faDepreciationBookCode || null,
  }));

export async function requestPurchaseDocument(v: FormValues, lines: PurchaseLineDraft[]): Promise<ActionResult<{ no: string }>> {
  return actionResult(async () => {
    const u = await requireAction('PAYABLES_PURCHASE_CREATE');
    const res = await createPurchaseDocument(toPurchaseHeaderInput(v), u);
    await setPurchaseLines(res.no, toPurchaseLines(lines), u);
    revalidate();
    return res;
  });
}
export async function savePurchaseDocument(no: string, v: FormValues, lines: PurchaseLineDraft[]): Promise<ActionResult<{ no: string }>> {
  return actionResult(async () => {
    const u = await requireAction('PAYABLES_PURCHASE_CREATE');
    await updatePurchaseDocumentHeader(no, toPurchaseHeaderInput(v), u);
    await setPurchaseLines(no, toPurchaseLines(lines), u);
    revalidate();
    return { no };
  });
}
export async function deletePurchaseDocumentRequest(no: string): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => { const u = await requireAction('PAYABLES_PURCHASE_CREATE'); await deletePurchaseDocument(no, u); revalidate(); return { deleted: true }; });
}
export async function makeOrderRequest(quoteNo: string): Promise<ActionResult<{ no: string }>> {
  return actionResult(async () => { const u = await requireAction('PAYABLES_PURCHASE_CREATE'); const r = await makeOrder(quoteNo, u); revalidate(); return r; });
}
export async function submitPurchaseDocumentRequest(no: string): Promise<ActionResult<{ updated: true; autoApproved: boolean }>> {
  return actionResult(async () => { const u = await requireAction('PAYABLES_PURCHASE_CREATE'); const { autoApproved } = await submitPurchaseDocument(no, u); revalidate(); return { updated: true, autoApproved }; });
}
export async function cancelPurchaseDocumentApprovalRequest(no: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => { const u = await requireAction('PAYABLES_PURCHASE_CREATE'); await cancelPurchaseDocumentApproval(no, u); revalidate(); return { updated: true }; });
}
export async function approvePurchaseDocumentRequest(no: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const routed = await findPendingRoutedTask('PURCHASE_DOCUMENT', no);
    if (routed) { const u = await requireUser(); await decideWorkflowTask(routed.id, true, null, u); }
    else { const u = await requireAction('PAYABLES_PURCHASE_APPROVE'); await approvePurchaseDocument(no, u); }
    revalidate(); return { updated: true };
  });
}
export async function rejectPurchaseDocumentRequest(no: string, reason: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const routed = await findPendingRoutedTask('PURCHASE_DOCUMENT', no);
    if (routed) { const u = await requireUser(); await decideWorkflowTask(routed.id, false, reason || null, u); }
    else { const u = await requireAction('PAYABLES_PURCHASE_APPROVE'); await rejectPurchaseDocument(no, reason || null, u); }
    revalidate(); return { updated: true };
  });
}
export async function reopenPurchaseDocumentRequest(no: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => { const u = await requireAction('PAYABLES_PURCHASE_APPROVE'); await reopenPurchaseDocument(no, u); revalidate(); return { updated: true }; });
}
export async function postPurchaseDocumentRequest(no: string, receive: boolean, invoice: boolean): Promise<ActionResult<Awaited<ReturnType<typeof postPurchaseDocument>>>> {
  return actionResult(async () => { const u = await requireAction('PAYABLES_PURCHASE_POST'); const r = await postPurchaseDocument(no, { receive, invoice }, u); revalidate(); return r; });
}

/* --------------------------------------------------------------- payment journal */

/* -------------------------------------------------------------- apply entries */

export async function applyEntriesRequest(applyingEntryId: number, appliedTo: number[] | 'auto', postingDate: string): Promise<ActionResult<{ closedEntryNos: string[]; discountTaken: number }>> {
  return actionResult(async () => { const u = await requireAction('PAYABLES_APPLY_ENTRIES'); const r = await applyVendorEntries({ applyingEntryId, appliedTo, postingDate }, u); revalidate(); return r; });
}
export async function unapplyEntryRequest(entryId: number): Promise<ActionResult<{ done: true }>> {
  return actionResult(async () => { const u = await requireAction('PAYABLES_APPLY_ENTRIES'); await unapplyVendorEntry(entryId, u); revalidate(); return { done: true }; });
}

/* ------------------------------------------------------------------ reports */

export async function agedApRequest(opts: Parameters<typeof getAgedAccountsPayable>[0]) {
  return actionResult(async () => { await requireAction('PAYABLES_READ'); return getAgedAccountsPayable(opts); });
}
export async function vendorStatementRequest(opts: Parameters<typeof getVendorStatement>[0]) {
  return actionResult(async () => { await requireAction('PAYABLES_READ'); return getVendorStatement(opts); });
}
