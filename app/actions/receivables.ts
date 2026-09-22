'use server';

import { revalidatePath } from 'next/cache';
import { requireAction, requireUser } from '@/lib/session';
import { actionResult, AppError } from '@/lib/errors';
import { toCents } from '@/lib/format';
import {
  listCustomerPostingGroups, createCustomerPostingGroup, updateCustomerPostingGroup,
  deleteCustomerPostingGroup, deletePaymentTerms, deletePaymentMethod, type CustomerPostingGroupInput,
  listPaymentTerms, createPaymentTerms, updatePaymentTerms, type PaymentTermsInput,
  listPaymentMethods, createPaymentMethod, updatePaymentMethod, type PaymentMethodInput,
  listReminderTerms, listReminderLevels, createReminderTerms, updateReminderTerms,
  type ReminderTermsInput, type ReminderLevelInput,
  listFinanceChargeTerms, createFinanceChargeTerms, updateFinanceChargeTerms, type FinanceChargeTermsInput,
  getSalesReceivablesSetup, saveSalesReceivablesSetup, type SalesReceivablesSetupInput,
} from '@/lib/receivablesSetup';
import {
  listCustomers, getCustomer, createCustomer, updateCustomer, customerStatistics, getCustomerLedgerEntries,
  type CustomerInput,
} from '@/lib/customers';
import {
  listSalesDocuments, getSalesDocument, createSalesDocument, updateSalesDocumentHeader, deleteSalesDocument,
  setSalesLines, makeOrder, submitSalesDocument, cancelSalesDocumentApproval, approveSalesDocument,
  rejectSalesDocument, reopenSalesDocument, postSalesDocument,
  listPostedInvoicesForCredit, getInvoiceForCreditMemo,
  type SalesHeaderInput, type SalesLineInput,
} from '@/lib/salesDocuments';
import {
  listReminders, getReminder, createReminders, createFinanceChargeMemos, deleteReminder, issueReminder,
} from '@/lib/reminders';
import { applyCustomerEntries, unapplyCustomerEntry } from '@/lib/custLedger';
import { getAgedAccountsReceivable, getCustomerStatement } from '@/lib/receivablesReports';
import { findPendingRoutedTask, decideWorkflowTask } from '@/lib/workflow';
import type {
  ActionResult, CustomerBlocked, FormValues, ReminderDocumentType, SalesDocumentType, SalesLineType,
} from '@/lib/types';

const revalidate = (): void => revalidatePath('/receivables', 'layout');
const str = (v: unknown): string => String(v ?? '').trim();
const opt = (v: unknown): string | null => (str(v) === '' ? null : str(v));
const numOrNull = (v: unknown): number | null => (v === undefined || v === '' || v === null ? null : Number(v));
const bool = (v: unknown): boolean => v === 'on' || v === 'true' || v === true || v === 1 || v === '1';

/* ------------------------------------------------------------------ setup masters */

export async function listCustomerPostingGroupsRequest() {
  return actionResult(async () => { await requireAction('RECEIVABLES_READ'); return listCustomerPostingGroups(); });
}
const toCpg = (v: FormValues): CustomerPostingGroupInput => ({
  code: str(v.code), description: str(v.description),
  receivablesAccountId: Number(v.receivables_account_id),
  serviceChargeAccountId: Number(v.service_charge_account_id),
  additionalFeeAccountId: Number(v.additional_fee_account_id),
  paymentDiscDebitAccountId: Number(v.payment_disc_debit_account_id),
  paymentDiscCreditAccountId: Number(v.payment_disc_credit_account_id),
  invoiceRoundingAccountId: Number(v.invoice_rounding_account_id),
});
export async function createCpgRequest(v: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => { const u = await requireAction('RECEIVABLES_SETUP_MANAGE'); const r = await createCustomerPostingGroup(toCpg(v), u); revalidate(); return r; });
}
export async function updateCpgRequest(id: number, v: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => { const u = await requireAction('RECEIVABLES_SETUP_MANAGE'); await updateCustomerPostingGroup(id, toCpg(v), u); revalidate(); return { id }; });
}

export async function listPaymentTermsRequest() {
  return actionResult(async () => { await requireAction('RECEIVABLES_READ'); return listPaymentTerms(); });
}
const toPt = (v: FormValues): PaymentTermsInput => ({
  code: str(v.code), description: str(v.description), dueDateCalculation: str(v.due_date_calculation),
  discountDateCalculation: str(v.discount_date_calculation), discountPct: Number(v.discount_pct || 0),
  calcPmtDiscOnCreditMemos: bool(v.calc_pmt_disc_on_credit_memos), status: (str(v.status || 'ACTIVE') as 'ACTIVE' | 'INACTIVE'),
});
export async function createPaymentTermsRequest(v: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => { const u = await requireAction('RECEIVABLES_SETUP_MANAGE'); const r = await createPaymentTerms(toPt(v), u); revalidate(); return r; });
}
export async function updatePaymentTermsRequest(id: number, v: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => { const u = await requireAction('RECEIVABLES_SETUP_MANAGE'); await updatePaymentTerms(id, toPt(v), u); revalidate(); return { id }; });
}

export async function listPaymentMethodsRequest() {
  return actionResult(async () => { await requireAction('RECEIVABLES_READ'); return listPaymentMethods(); });
}
const toPm = (v: FormValues): PaymentMethodInput => ({
  code: str(v.code), description: str(v.description),
  balAccountType: (str(v.bal_account_type || 'None') as 'None' | 'G/L Account' | 'Bank Account'),
  balAccountNo: opt(v.bal_account_no), status: (str(v.status || 'ACTIVE') as 'ACTIVE' | 'INACTIVE'),
});
export async function createPaymentMethodRequest(v: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => { const u = await requireAction('RECEIVABLES_SETUP_MANAGE'); const r = await createPaymentMethod(toPm(v), u); revalidate(); return r; });
}
export async function updatePaymentMethodRequest(id: number, v: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => { const u = await requireAction('RECEIVABLES_SETUP_MANAGE'); await updatePaymentMethod(id, toPm(v), u); revalidate(); return { id }; });
}

/* Admin may remove a setup row, but only while nothing still points at it — the lib functions
 * count the dependants and say which ones are in the way. */
export async function deleteCustomerPostingGroupRequest(id: number): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => { const u = await requireAction('RECEIVABLES_SETUP_MANAGE'); await deleteCustomerPostingGroup(id, u); revalidate(); return { id }; });
}
export async function deletePaymentTermsRequest(id: number): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => { const u = await requireAction('RECEIVABLES_SETUP_MANAGE'); await deletePaymentTerms(id, u); revalidate(); return { id }; });
}
export async function deletePaymentMethodRequest(id: number): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => { const u = await requireAction('RECEIVABLES_SETUP_MANAGE'); await deletePaymentMethod(id, u); revalidate(); return { id }; });
}

export async function listReminderTermsRequest() {
  return actionResult(async () => { await requireAction('RECEIVABLES_READ'); return listReminderTerms(); });
}
export async function listReminderLevelsRequest(termsCode: string) {
  return actionResult(async () => { await requireAction('RECEIVABLES_READ'); return listReminderLevels(termsCode); });
}
const toRtLevels = (rows: FormValues[]): ReminderLevelInput[] => rows.map((r, idx) => ({
  levelNo: idx + 1, gracePeriod: str(r.grace_period), dueDateCalculation: str(r.due_date_calculation),
  calculateInterest: bool(r.calculate_interest), additionalFee: toCents(r.additional_fee), addFeePerLine: toCents(r.add_fee_per_line),
  beginText: opt(r.begin_text), endText: opt(r.end_text),
}));
const toRt = (v: FormValues): ReminderTermsInput => ({
  code: str(v.code), description: str(v.description), maxNoOfReminders: Number(v.max_no_of_reminders || 3),
  postInterest: bool(v.post_interest), postAdditionalFee: bool(v.post_additional_fee), minAmount: toCents(v.min_amount),
  dontRemindOnHold: bool(v.dont_remind_on_hold), status: (str(v.status || 'ACTIVE') as 'ACTIVE' | 'INACTIVE'),
});
export async function createReminderTermsRequest(v: FormValues, levels: FormValues[]): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => { const u = await requireAction('RECEIVABLES_SETUP_MANAGE'); const r = await createReminderTerms(toRt(v), toRtLevels(levels), u); revalidate(); return r; });
}
export async function updateReminderTermsRequest(id: number, v: FormValues, levels: FormValues[]): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => { const u = await requireAction('RECEIVABLES_SETUP_MANAGE'); await updateReminderTerms(id, toRt(v), toRtLevels(levels), u); revalidate(); return { id }; });
}

export async function listFinanceChargeTermsRequest() {
  return actionResult(async () => { await requireAction('RECEIVABLES_READ'); return listFinanceChargeTerms(); });
}
const toFc = (v: FormValues): FinanceChargeTermsInput => ({
  code: str(v.code), description: str(v.description), interestRate: Number(v.interest_rate || 0), minAmount: toCents(v.min_amount),
  additionalFee: toCents(v.additional_fee), gracePeriod: str(v.grace_period), dueDateCalculation: str(v.due_date_calculation),
  interestPeriodDays: Number(v.interest_period_days || 360),
  interestCalculationMethod: (str(v.interest_calculation_method || 'Balance Due') as 'Average Daily Balance' | 'Balance Due'),
  postInterest: bool(v.post_interest), postAdditionalFee: bool(v.post_additional_fee),
  lineDescription: str(v.line_description || 'Finance Charge'), beginText: opt(v.begin_text), endText: opt(v.end_text),
  status: (str(v.status || 'ACTIVE') as 'ACTIVE' | 'INACTIVE'),
});
export async function createFinanceChargeTermsRequest(v: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => { const u = await requireAction('RECEIVABLES_SETUP_MANAGE'); const r = await createFinanceChargeTerms(toFc(v), u); revalidate(); return r; });
}
export async function updateFinanceChargeTermsRequest(id: number, v: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => { const u = await requireAction('RECEIVABLES_SETUP_MANAGE'); await updateFinanceChargeTerms(id, toFc(v), u); revalidate(); return { id }; });
}

export async function getSalesReceivablesSetupRequest() {
  return actionResult(async () => { await requireAction('RECEIVABLES_READ'); return getSalesReceivablesSetup(); });
}
export async function saveSalesReceivablesSetupRequest(v: FormValues): Promise<ActionResult<{ saved: true }>> {
  return actionResult(async () => {
    const u = await requireAction('RECEIVABLES_SETUP_MANAGE');
    const input: SalesReceivablesSetupInput = {
      defaultCustomerPostingGroupCode: opt(v.default_customer_posting_group_code),
      defaultPaymentTermsCode: opt(v.default_payment_terms_code),
      defaultReminderTermsCode: opt(v.default_reminder_terms_code),
      defaultFinChargeTermsCode: opt(v.default_fin_charge_terms_code),
      stockoutWarning: bool(v.stockout_warning),
      creditWarnings: (str(v.credit_warnings || 'Both') as 'Both' | 'Credit Limit' | 'Overdue Balance' | 'No Warning'),
      invoiceRounding: bool(v.invoice_rounding),
      invoiceRoundingPrecision: toCents(v.invoice_rounding_precision),
      allowReceivablesPostingFrom: opt(v.allow_receivables_posting_from),
      allowReceivablesPostingTo: opt(v.allow_receivables_posting_to),
    };
    await saveSalesReceivablesSetup(input, u); revalidate(); return { saved: true };
  });
}

/* ------------------------------------------------------------------- customers */

const toCustomerInput = (v: FormValues): CustomerInput => ({
  name: str(v.name), name2: opt(v.name2), address: opt(v.address), address2: opt(v.address2), city: opt(v.city),
  postCode: opt(v.postCode), country: opt(v.country), contact: opt(v.contact), phone: opt(v.phone), email: opt(v.email),
  customerPostingGroupCode: opt(v.customerPostingGroupCode), paymentTermsCode: opt(v.paymentTermsCode),
  paymentMethodCode: opt(v.paymentMethodCode), reminderTermsCode: opt(v.reminderTermsCode), finChargeTermsCode: opt(v.finChargeTermsCode),
  salesperson: opt(v.salesperson), currencyCode: opt(v.currencyCode),
  creditLimit: toCents(v.creditLimit), blocked: (str(v.blocked || '') as CustomerBlocked),
  globalDimension1Id: numOrNull(v.globalDimension1Id), globalDimension2Id: numOrNull(v.globalDimension2Id),
});
export async function listCustomersRequest(opts: Parameters<typeof listCustomers>[0]) {
  return actionResult(async () => { await requireAction('RECEIVABLES_READ'); return listCustomers(opts); });
}
export async function getCustomerRequest(no: string) {
  return actionResult(async () => { await requireAction('RECEIVABLES_READ'); const c = await getCustomer(no); if (!c) return null; return { customer: c, stats: await customerStatistics(c.id) }; });
}
export async function customerLedgerEntriesRequest(customerId: number) {
  return actionResult(async () => { await requireAction('RECEIVABLES_READ'); return getCustomerLedgerEntries({ customerId }); });
}
export async function requestCustomer(v: FormValues): Promise<ActionResult<{ no: string }>> {
  return actionResult(async () => { const u = await requireAction('RECEIVABLES_CUSTOMER_MANAGE'); const r = await createCustomer(toCustomerInput(v), u); revalidate(); return r; });
}
export async function saveCustomer(no: string, v: FormValues): Promise<ActionResult<{ no: string }>> {
  return actionResult(async () => { const u = await requireAction('RECEIVABLES_CUSTOMER_MANAGE'); await updateCustomer(no, toCustomerInput(v), u); revalidate(); return { no }; });
}

/* ------------------------------------------------------------- sales documents */

export async function listSalesDocumentsRequest(opts: Parameters<typeof listSalesDocuments>[0]) {
  return actionResult(async () => { await requireAction('RECEIVABLES_READ'); return listSalesDocuments(opts); });
}
export async function getSalesDocumentRequest(no: string) {
  return actionResult(async () => { await requireAction('RECEIVABLES_READ'); return getSalesDocument(no); });
}
const toSalesHeaderInput = (v: FormValues): SalesHeaderInput => ({
  documentType: (str(v.documentType || 'Invoice') as SalesDocumentType),
  customerId: Number(v.customerId),
  postingDate: str(v.postingDate), documentDate: str(v.documentDate || v.postingDate),
  paymentTermsCode: opt(v.paymentTermsCode), paymentMethodCode: opt(v.paymentMethodCode),
  yourReference: opt(v.yourReference), salesperson: opt(v.salesperson),
  appliesToDocNo: opt(v.appliesToDocNo),
});
export interface SalesLineDraft {
  type: string; no: string; description: string; quantity: string; unitPrice: string; lineDiscountPct: string;
  locationCode: string; faDepreciationBookCode: string;
}
// Every line the user keeps has to say what it is for — lib/salesDocuments.ts would otherwise
// fall back to the master record's own name, which reads as boilerplate on the printed document.
const toSalesLines = (lines: SalesLineDraft[]): SalesLineInput[] => lines
  .filter((l) => l.type === 'Comment' || l.no)
  .map((l) => {
    if (!l.description?.trim()) throw new AppError('Every document line needs a description', 'VALIDATION');
    return l;
  })
  .map((l) => ({
    type: (l.type as SalesLineType), no: l.no || null, description: l.description || null,
    quantity: Number(l.quantity || 0), unitPrice: toCents(l.unitPrice), lineDiscountPct: Number(l.lineDiscountPct || 0),
    locationCode: l.locationCode || null, faDepreciationBookCode: l.faDepreciationBookCode || null,
  }));

export async function requestSalesDocument(v: FormValues, lines: SalesLineDraft[]): Promise<ActionResult<{ no: string }>> {
  return actionResult(async () => {
    const u = await requireAction('RECEIVABLES_SALES_CREATE');
    const res = await createSalesDocument(toSalesHeaderInput(v), u);
    await setSalesLines(res.no, toSalesLines(lines), u);
    revalidate();
    return res;
  });
}
export async function saveSalesDocument(no: string, v: FormValues, lines: SalesLineDraft[]): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const u = await requireAction('RECEIVABLES_SALES_CREATE');
    await updateSalesDocumentHeader(no, toSalesHeaderInput(v), u);
    await setSalesLines(no, toSalesLines(lines), u);
    revalidate();
    return { updated: true };
  });
}
export async function deleteSalesDocumentRequest(no: string): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => { const u = await requireAction('RECEIVABLES_SALES_CREATE'); await deleteSalesDocument(no, u); revalidate(); return { deleted: true }; });
}
export async function makeOrderRequest(quoteNo: string): Promise<ActionResult<{ no: string }>> {
  return actionResult(async () => { const u = await requireAction('RECEIVABLES_SALES_CREATE'); const r = await makeOrder(quoteNo, u); revalidate(); return r; });
}
export async function submitSalesDocumentRequest(no: string): Promise<ActionResult<{ updated: true; autoApproved: boolean }>> {
  return actionResult(async () => { const u = await requireAction('RECEIVABLES_SALES_CREATE'); const { autoApproved } = await submitSalesDocument(no, u); revalidate(); return { updated: true, autoApproved }; });
}
export async function cancelSalesDocumentApprovalRequest(no: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => { const u = await requireAction('RECEIVABLES_SALES_CREATE'); await cancelSalesDocumentApproval(no, u); revalidate(); return { updated: true }; });
}
export async function approveSalesDocumentRequest(no: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const routed = await findPendingRoutedTask('SALES_DOCUMENT', no);
    if (routed) { const u = await requireUser(); await decideWorkflowTask(routed.id, true, null, u); }
    else { const u = await requireAction('RECEIVABLES_SALES_APPROVE'); await approveSalesDocument(no, u); }
    revalidate(); return { updated: true };
  });
}
export async function rejectSalesDocumentRequest(no: string, reason: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const routed = await findPendingRoutedTask('SALES_DOCUMENT', no);
    if (routed) { const u = await requireUser(); await decideWorkflowTask(routed.id, false, reason || null, u); }
    else { const u = await requireAction('RECEIVABLES_SALES_APPROVE'); await rejectSalesDocument(no, reason || null, u); }
    revalidate(); return { updated: true };
  });
}
export async function reopenSalesDocumentRequest(no: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => { const u = await requireAction('RECEIVABLES_SALES_APPROVE'); await reopenSalesDocument(no, u); revalidate(); return { updated: true }; });
}
export async function postSalesDocumentRequest(no: string, ship: boolean, invoice: boolean): Promise<ActionResult<Awaited<ReturnType<typeof postSalesDocument>>>> {
  return actionResult(async () => { const u = await requireAction('RECEIVABLES_SALES_POST'); const r = await postSalesDocument(no, { ship, invoice }, u); revalidate(); return r; });
}

/* --------------------------------------------------------------- cash receipts */

/* ---------------------------------------------------------------- reminders */

export async function listRemindersRequest(documentType: ReminderDocumentType, view?: 'open' | 'issued', search?: string) {
  return actionResult(async () => { await requireAction('RECEIVABLES_READ'); return listReminders({ documentType, view, search }); });
}
export async function getReminderRequest(no: string) {
  return actionResult(async () => { await requireAction('RECEIVABLES_READ'); return getReminder(no); });
}
export async function createRemindersRequest(customerId: number | null, documentDate: string): Promise<ActionResult<{ created: number; skipped: number }>> {
  return actionResult(async () => { const u = await requireAction('RECEIVABLES_REMINDER_MANAGE'); const r = await createReminders({ customerId, documentDate }, u); revalidate(); return r; });
}
export async function createFinanceChargeMemosRequest(customerId: number | null, documentDate: string): Promise<ActionResult<{ created: number; skipped: number }>> {
  return actionResult(async () => { const u = await requireAction('RECEIVABLES_REMINDER_MANAGE'); const r = await createFinanceChargeMemos({ customerId, documentDate }, u); revalidate(); return r; });
}
export async function deleteReminderRequest(no: string): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => { const u = await requireAction('RECEIVABLES_REMINDER_MANAGE'); await deleteReminder(no, u); revalidate(); return { deleted: true }; });
}
export async function issueReminderRequest(no: string): Promise<ActionResult<{ journalNo: string | null; custLedgerEntryId: number | null }>> {
  return actionResult(async () => { const u = await requireAction('RECEIVABLES_REMINDER_MANAGE'); const r = await issueReminder(no, u); revalidate(); return r; });
}

/* -------------------------------------------------------------- apply entries */

export async function applyEntriesRequest(applyingEntryId: number, appliedTo: number[] | 'auto', postingDate: string): Promise<ActionResult<{ closedEntryNos: string[]; discountTaken: number }>> {
  return actionResult(async () => { const u = await requireAction('RECEIVABLES_APPLY_ENTRIES'); const r = await applyCustomerEntries({ applyingEntryId, appliedTo, postingDate }, u); revalidate(); return r; });
}
export async function unapplyEntryRequest(entryId: number): Promise<ActionResult<{ done: true }>> {
  return actionResult(async () => { const u = await requireAction('RECEIVABLES_APPLY_ENTRIES'); await unapplyCustomerEntry(entryId, u); revalidate(); return { done: true }; });
}

/* ------------------------------------------------------------------ reports */

export async function agedArRequest(opts: Parameters<typeof getAgedAccountsReceivable>[0]) {
  return actionResult(async () => { await requireAction('RECEIVABLES_READ'); return getAgedAccountsReceivable(opts); });
}
export async function customerStatementRequest(opts: Parameters<typeof getCustomerStatement>[0]) {
  return actionResult(async () => { await requireAction('RECEIVABLES_READ'); return getCustomerStatement(opts); });
}

/* ------------------------------------------- corrective credit memo (copy document) */

/** Posted invoices a credit memo may be raised against — the Applies-to picker's list. */
export async function listPostedInvoicesForCreditRequest(customerId?: number | null) {
  return actionResult(async () => {
    await requireAction('RECEIVABLES_READ');
    return listPostedInvoicesForCredit(customerId ?? null);
  });
}

/** One posted invoice, reshaped into the header + lines a credit memo starts from. */
export async function getInvoiceForCreditMemoRequest(no: string) {
  return actionResult(async () => {
    await requireAction('RECEIVABLES_READ');
    const src = await getInvoiceForCreditMemo(no);
    if (!src) throw new AppError('Posted invoice not found', 'NOT_FOUND');
    return src;
  });
}
