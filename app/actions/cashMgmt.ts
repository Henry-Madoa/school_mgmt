'use server';

import { revalidatePath } from 'next/cache';
import { requireAction } from '@/lib/session';
import { actionResult } from '@/lib/errors';
import { toCents } from '@/lib/format';
import {
  createBankAccount, updateBankAccount, startBankReconciliation, suggestBankRecLines, matchBankRecLine,
  addBankRecGlAdjustmentLine, deleteBankRecLine, postBankReconciliation, type BankAccountInput,
} from '@/lib/bankMgmt';
import {
  createBankAccPostingGroup, updateBankAccPostingGroup, createExternalBank, updateExternalBank,
  createCurrency, updateCurrency, saveExchangeRate, deleteExchangeRate,
  getCashManagementSetup, saveCashManagementSetup,
  adjustExchangeRates, type BankAccPostingGroupInput, type CurrencyInput, type CashManagementSetupInput,
} from '@/lib/cashMgmtSetup';
import {
  createReceipt, updateReceipt, deleteReceipt, submitReceipt, cancelReceiptApproval, approveReceipt,
  rejectReceipt, reopenReceipt, postReceipt, type ReceiptInput, type ReceiptLineInput,
} from '@/lib/receipts';
import {
  createPaymentVoucher, updatePaymentVoucher, deletePaymentVoucher, submitPaymentVoucher,
  cancelPaymentVoucherApproval, approvePaymentVoucher, rejectPaymentVoucher, reopenPaymentVoucher,
  postPaymentVoucher, type PaymentVoucherInput, type PaymentVoucherLineInput,
} from '@/lib/paymentVouchers';
import { markWhtCertificateRemitted } from '@/lib/whtCertificate';
import { listOpenCustomerEntries, type OpenLedgerEntryOption } from '@/lib/custLedger';
import { listOpenVendorEntries } from '@/lib/vendLedger';
import {
  createVatBusinessPostingGroup, updateVatBusinessPostingGroup, createVatProductPostingGroup,
  updateVatProductPostingGroup, saveVatPostingSetup, deleteVatPostingSetup,
} from '@/lib/vatSetup';
import { decideWorkflowTask, findPendingRoutedTask } from '@/lib/workflow';
import type { ActionResult, FormValues, PaymentVoucherLineType, ReceiptLineType, TaxType, VatCalculationType } from '@/lib/types';

const revalidate = (): void => {
  revalidatePath('/cash-management', 'layout');
  revalidatePath('/finance/vat', 'layout');
  revalidatePath('/admin/pool/finance/vat-posting-setup');
  revalidatePath('/admin/pool/finance/currencies');
};
const str = (v: unknown): string => String(v ?? '').trim();
const opt = (v: unknown): string | null => (str(v) === '' ? null : str(v));
const numOrNull = (v: unknown): number | null => (v === undefined || v === '' || v === null ? null : Number(v));
const bool = (v: unknown): boolean => v === 'on' || v === 'true' || v === true;

/* ------------------------------------------------------------------ receipts */

export interface ReceiptLineDraft {
  lineType: string; accountNo: string; description?: string; amount: string; appliesToDocNo?: string;
}
export interface PvLineDraft extends ReceiptLineDraft {
  vatProdPostingGroupCode?: string; whtCodeOne?: string; whtCodeTwo?: string;
}

function toReceiptLines(lines: ReceiptLineDraft[]): ReceiptLineInput[] {
  return lines.filter((l) => str(l.accountNo)).map((l) => ({
    accountNo: str(l.accountNo),
    description: opt(l.description),
    amount: toCents(l.amount),
    appliesToDocNo: opt(l.appliesToDocNo),
  }));
}
function toReceiptInput(v: FormValues, lines: ReceiptLineDraft[]): ReceiptInput {
  return {
    receiptType: str(v.receiptType) as ReceiptLineType,
    bankAccountId: Number(v.bankAccountId),
    postingDate: str(v.postingDate),
    payModeCode: opt(v.payModeCode),
    externalDocumentNo: opt(v.externalDocumentNo),
    manualReceiptNo: opt(v.manualReceiptNo),
    description: str(v.description),
    currencyCode: opt(v.currencyCode),
    receivedAmount: toCents(v.receivedAmount),
    lines: toReceiptLines(lines),
  };
}

export async function createReceiptRequest(v: FormValues, lines: ReceiptLineDraft[]): Promise<ActionResult<{ no: string }>> {
  return actionResult(async () => { const u = await requireAction('CASH_MGMT_RECEIPT_CREATE'); const r = await createReceipt(toReceiptInput(v, lines), u); revalidate(); return r; });
}
export async function updateReceiptRequest(no: string, v: FormValues, lines: ReceiptLineDraft[]): Promise<ActionResult<{ no: string }>> {
  return actionResult(async () => { const u = await requireAction('CASH_MGMT_RECEIPT_CREATE'); await updateReceipt(no, toReceiptInput(v, lines), u); revalidate(); return { no }; });
}
export async function deleteReceiptRequest(no: string): Promise<ActionResult<{ no: string }>> {
  return actionResult(async () => { const u = await requireAction('CASH_MGMT_RECEIPT_CREATE'); await deleteReceipt(no, u); revalidate(); return { no }; });
}
export async function submitReceiptRequest(no: string): Promise<ActionResult<{ autoApproved: boolean }>> {
  return actionResult(async () => { const u = await requireAction('CASH_MGMT_RECEIPT_CREATE'); const r = await submitReceipt(no, u); revalidate(); return r; });
}
export async function cancelReceiptApprovalRequest(no: string): Promise<ActionResult<{ no: string }>> {
  return actionResult(async () => { const u = await requireAction('CASH_MGMT_RECEIPT_CREATE'); await cancelReceiptApproval(no, u); revalidate(); return { no }; });
}
export async function decideReceiptRequest(no: string, approve: boolean, reason: string | null): Promise<ActionResult<{ no: string }>> {
  return actionResult(async () => {
    const u = await requireAction('CASH_MGMT_RECEIPT_APPROVE');
    const routed = await findPendingRoutedTask('RECEIPT', no);
    if (routed) await decideWorkflowTask(routed.id, approve, reason, u);
    else if (approve) await approveReceipt(no, u);
    else await rejectReceipt(no, reason, u);
    revalidate();
    return { no };
  });
}
export async function reopenReceiptRequest(no: string): Promise<ActionResult<{ no: string }>> {
  return actionResult(async () => { const u = await requireAction('CASH_MGMT_RECEIPT_APPROVE'); await reopenReceipt(no, u); revalidate(); return { no }; });
}
export async function postReceiptRequest(no: string): Promise<ActionResult<{ postedReceiptNo: string; journalNo: string | null }>> {
  return actionResult(async () => { const u = await requireAction('CASH_MGMT_RECEIPT_POST'); const r = await postReceipt(no, u); revalidate(); return r; });
}

/* ---------------------------------------------------------- payment vouchers */

function toPvLines(lines: PvLineDraft[]): PaymentVoucherLineInput[] {
  return lines.filter((l) => str(l.accountNo)).map((l) => ({
    accountNo: str(l.accountNo),
    description: opt(l.description),
    amount: toCents(l.amount),
    appliesToDocNo: opt(l.appliesToDocNo),
    vatProdPostingGroupCode: opt(l.vatProdPostingGroupCode),
    whtCodeOne: opt(l.whtCodeOne),
    whtCodeTwo: opt(l.whtCodeTwo),
  }));
}
function toPvInput(v: FormValues, lines: PvLineDraft[]): PaymentVoucherInput {
  return {
    pvType: opt(v.pvType),
    payingBankAccountId: Number(v.payingBankAccountId),
    date: str(v.date),
    payModeCode: opt(v.payModeCode),
    chequeNo: opt(v.chequeNo),
    chequeDate: opt(v.chequeDate),
    chequeReceivedBy: opt(v.chequeReceivedBy),
    description: str(v.description),
    payeeName: opt(v.payeeName),
    payeeExternalBankCode: opt(v.payeeExternalBankCode),
    payeeBankBranchCode: opt(v.payeeBankBranchCode),
    payeeAccountNo: opt(v.payeeAccountNo),
    currencyCode: opt(v.currencyCode),
    lines: toPvLines(lines),
  };
}

export async function createPvRequest(v: FormValues, lines: PvLineDraft[]): Promise<ActionResult<{ no: string }>> {
  return actionResult(async () => { const u = await requireAction('CASH_MGMT_PV_CREATE'); const r = await createPaymentVoucher(toPvInput(v, lines), u); revalidate(); return r; });
}
export async function updatePvRequest(no: string, v: FormValues, lines: PvLineDraft[]): Promise<ActionResult<{ no: string }>> {
  return actionResult(async () => { const u = await requireAction('CASH_MGMT_PV_CREATE'); await updatePaymentVoucher(no, toPvInput(v, lines), u); revalidate(); return { no }; });
}
export async function deletePvRequest(no: string): Promise<ActionResult<{ no: string }>> {
  return actionResult(async () => { const u = await requireAction('CASH_MGMT_PV_CREATE'); await deletePaymentVoucher(no, u); revalidate(); return { no }; });
}
export async function submitPvRequest(no: string): Promise<ActionResult<{ autoApproved: boolean }>> {
  return actionResult(async () => { const u = await requireAction('CASH_MGMT_PV_CREATE'); const r = await submitPaymentVoucher(no, u); revalidate(); return r; });
}
export async function cancelPvApprovalRequest(no: string): Promise<ActionResult<{ no: string }>> {
  return actionResult(async () => { const u = await requireAction('CASH_MGMT_PV_CREATE'); await cancelPaymentVoucherApproval(no, u); revalidate(); return { no }; });
}
export async function decidePvRequest(no: string, approve: boolean, reason: string | null): Promise<ActionResult<{ no: string }>> {
  return actionResult(async () => {
    const u = await requireAction('CASH_MGMT_PV_APPROVE');
    const routed = await findPendingRoutedTask('PAYMENT_VOUCHER', no);
    if (routed) await decideWorkflowTask(routed.id, approve, reason, u);
    else if (approve) await approvePaymentVoucher(no, u);
    else await rejectPaymentVoucher(no, reason, u);
    revalidate();
    return { no };
  });
}
export async function reopenPvRequest(no: string): Promise<ActionResult<{ no: string }>> {
  return actionResult(async () => { const u = await requireAction('CASH_MGMT_PV_APPROVE'); await reopenPaymentVoucher(no, u); revalidate(); return { no }; });
}
export async function postPvRequest(no: string): Promise<ActionResult<{ postedVoucherNo: string; journalNo: string | null; whtCertificateNos: string[] }>> {
  return actionResult(async () => { const u = await requireAction('CASH_MGMT_PV_POST'); const r = await postPaymentVoucher(no, u); revalidate(); return r; });
}

/* ------------------------------------------------------------- bank accounts */

function toBankAccountInput(v: FormValues): BankAccountInput {
  return {
    code: str(v.code), name: str(v.name),
    glAccountId: numOrNull(v.glAccountId),
    bankAccPostingGroupCode: opt(v.bankAccPostingGroupCode),
    bankName: opt(v.bankName), accountNo: opt(v.accountNo),
    currencyCode: opt(v.currencyCode),
    bankBranchNo: opt(v.bankBranchNo), bankSortCode: opt(v.bankSortCode),
    externalBankCode: opt(v.externalBankCode), iban: opt(v.iban), swiftCode: opt(v.swiftCode),
    minBalance: v.minBalance !== undefined && v.minBalance !== '' ? toCents(v.minBalance) : 0,
    accountType: opt(v.accountType), blocked: bool(v.blocked),
    status: bool(v.inactive) ? 'INACTIVE' : 'ACTIVE',
  };
}
export async function createBankAccountRequest(v: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => { const u = await requireAction('CASH_MGMT_BANK_MANAGE'); const r = await createBankAccount(toBankAccountInput(v), u); revalidate(); return r; });
}
export async function updateBankAccountRequest(id: number, v: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => { const u = await requireAction('CASH_MGMT_BANK_MANAGE'); await updateBankAccount(id, toBankAccountInput(v), u); revalidate(); return { id }; });
}

/* ------------------------------------------------------- bank reconciliation */

export async function startReconciliationRequest(v: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const u = await requireAction('CASH_MGMT_RECONCILE');
    const r = await startBankReconciliation(Number(v.bankAccountId), str(v.statementDate), toCents(v.statementEndingBalance), u);
    revalidate();
    return r;
  });
}
export async function suggestRecLinesRequest(id: number): Promise<ActionResult<{ added: number }>> {
  return actionResult(async () => { const u = await requireAction('CASH_MGMT_RECONCILE'); const r = await suggestBankRecLines(id, u); revalidate(); return r; });
}
export async function matchRecLineRequest(lineId: number, applied: boolean): Promise<ActionResult<{ lineId: number }>> {
  return actionResult(async () => { const u = await requireAction('CASH_MGMT_RECONCILE'); await matchBankRecLine(lineId, applied, u); revalidate(); return { lineId }; });
}
export async function addRecAdjustmentRequest(id: number, v: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const u = await requireAction('CASH_MGMT_RECONCILE');
    await addBankRecGlAdjustmentLine(id, { glAccountId: Number(v.glAccountId), amount: toCents(v.amount), description: str(v.description) }, u);
    revalidate();
    return { id };
  });
}
export async function deleteRecLineRequest(lineId: number): Promise<ActionResult<{ lineId: number }>> {
  return actionResult(async () => { const u = await requireAction('CASH_MGMT_RECONCILE'); await deleteBankRecLine(lineId, u); revalidate(); return { lineId }; });
}
export async function postReconciliationRequest(id: number): Promise<ActionResult<{ journalNo: string | null }>> {
  return actionResult(async () => { const u = await requireAction('CASH_MGMT_RECONCILE'); const r = await postBankReconciliation(id, u); revalidate(); return r; });
}

/* ----------------------------------------------------- currencies + FX + setup */

function toCurrencyInput(v: FormValues): CurrencyInput {
  return {
    code: str(v.code), description: str(v.description), symbol: opt(v.symbol), isoNumericCode: opt(v.isoNumericCode),
    amountRoundingPrecision: v.amountRoundingPrecision ? Number(v.amountRoundingPrecision) : 1,
    invoiceRoundingPrecision: v.invoiceRoundingPrecision ? Number(v.invoiceRoundingPrecision) : 0,
    realizedGainsAccountId: numOrNull(v.realizedGainsAccountId), realizedLossesAccountId: numOrNull(v.realizedLossesAccountId),
    unrealizedGainsAccountId: numOrNull(v.unrealizedGainsAccountId), unrealizedLossesAccountId: numOrNull(v.unrealizedLossesAccountId),
    residualGainsAccountId: numOrNull(v.residualGainsAccountId), residualLossesAccountId: numOrNull(v.residualLossesAccountId),
    blocked: bool(v.blocked),
  };
}
export async function createCurrencyRequest(v: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => { const u = await requireAction('CURRENCY_SETUP_MANAGE'); const r = await createCurrency(toCurrencyInput(v), u); revalidate(); return r; });
}
export async function updateCurrencyRequest(id: number, v: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => { const u = await requireAction('CURRENCY_SETUP_MANAGE'); await updateCurrency(id, toCurrencyInput(v), u); revalidate(); return { id }; });
}
export async function saveExchangeRateRequest(v: FormValues): Promise<ActionResult<{ saved: true }>> {
  return actionResult(async () => {
    const u = await requireAction('CASH_MGMT_CURRENCY_MANAGE');
    await saveExchangeRate({
      currencyCode: str(v.currencyCode), startingDate: str(v.startingDate),
      exchangeRateAmount: Number(v.exchangeRateAmount || 1), relationalExchRateAmount: Number(v.relationalExchRateAmount),
    }, u);
    revalidate();
    return { saved: true };
  });
}
export async function deleteExchangeRateRequest(id: number): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => { const u = await requireAction('CASH_MGMT_CURRENCY_MANAGE'); await deleteExchangeRate(id, u); revalidate(); return { id }; });
}
export async function adjustExchangeRatesRequest(v: FormValues): Promise<ActionResult<{ adjustedEntries: number; gainLoss: number }>> {
  return actionResult(async () => {
    const u = await requireAction('CASH_MGMT_FX_ADJUST');
    const r = await adjustExchangeRates({ currencyCode: str(v.currencyCode), endDate: str(v.endDate) }, u);
    revalidate();
    return r;
  });
}
export async function saveCashMgmtSetupRequest(v: FormValues): Promise<ActionResult<{ saved: true }>> {
  return actionResult(async () => {
    const u = await requireAction('CASH_MGMT_SETUP_MANAGE');
    const input: CashManagementSetupInput = {
      // The receipt limit is edited on General Ledger Setup now, so this screen carries it
      // through untouched rather than blanking it.
      receiptApprovalLimit: (await getCashManagementSetup()).receipt_approval_limit,
      pvApprovalLimit: toCents(v.pvApprovalLimit),
      bankChargesAccountId: numOrNull(v.bankChargesAccountId), bankInterestIncomeAccountId: numOrNull(v.bankInterestIncomeAccountId),
      defaultReceiptBankAccountId: numOrNull(v.defaultReceiptBankAccountId),
      allowCmPostingFrom: opt(v.allowCmPostingFrom), allowCmPostingTo: opt(v.allowCmPostingTo),
    };
    await saveCashManagementSetup(input, u);
    revalidate();
    return { saved: true };
  });
}
export async function saveBankAccPostingGroupRequest(id: number | null, v: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const u = await requireAction('CASH_MGMT_BANK_MANAGE');
    const input: BankAccPostingGroupInput = { code: str(v.code), description: str(v.description), glAccountId: Number(v.glAccountId) };
    const r = id ? (await updateBankAccPostingGroup(id, input, u), { id }) : await createBankAccPostingGroup(input, u);
    revalidate();
    return r;
  });
}
export async function saveExternalBankRequest(id: number | null, v: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const u = await requireAction('CASH_MGMT_BANK_MANAGE');
    const branchesRaw = v.branches;
    const branches = (typeof branchesRaw === 'string' ? JSON.parse(branchesRaw) : Array.isArray(branchesRaw) ? branchesRaw : [])
      .map((b: Record<string, unknown>) => ({ branchCode: str(b.branchCode), branchName: str(b.branchName) }));
    const input = { code: str(v.code), name: str(v.name) };
    const r = id ? (await updateExternalBank(id, input, branches, u), { id }) : await createExternalBank(input, branches, u);
    revalidate();
    return r;
  });
}

/* -------------------------------------------------------------- VAT / WHT */

export async function saveVatBusinessGroupRequest(id: number | null, v: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const u = await requireAction('VAT_SETUP_MANAGE');
    const input = { code: str(v.code), description: str(v.description) };
    const r = id ? (await updateVatBusinessPostingGroup(id, input, u), { id }) : await createVatBusinessPostingGroup(input, u);
    revalidate();
    return r;
  });
}
export async function saveVatProductGroupRequest(id: number | null, v: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const u = await requireAction('VAT_SETUP_MANAGE');
    const input = { code: str(v.code), description: str(v.description), taxType: str(v.taxType) as TaxType };
    const r = id ? (await updateVatProductPostingGroup(id, input, u), { id }) : await createVatProductPostingGroup(input, u);
    revalidate();
    return r;
  });
}
export async function saveVatPostingSetupRequest(v: FormValues): Promise<ActionResult<{ saved: true }>> {
  return actionResult(async () => {
    const u = await requireAction('VAT_SETUP_MANAGE');
    await saveVatPostingSetup({
      vatBusPostingGroupCode: str(v.vatBusPostingGroupCode), vatProdPostingGroupCode: str(v.vatProdPostingGroupCode),
      vatPct: Number(v.vatPct || 0), vatCalculationType: (str(v.vatCalculationType) || 'Normal') as VatCalculationType,
      taxAccountId: numOrNull(v.taxAccountId), whtBase: (str(v.whtBase) || 'Net') as 'Net' | 'Gross', blocked: bool(v.blocked),
    }, u);
    revalidate();
    return { saved: true };
  });
}
export async function deleteVatPostingSetupRequest(busCode: string, prodCode: string): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => { const u = await requireAction('VAT_SETUP_MANAGE'); await deleteVatPostingSetup(busCode, prodCode, u); revalidate(); return { deleted: true }; });
}
export async function markWhtRemittedRequest(no: string, ref: string): Promise<ActionResult<{ no: string }>> {
  return actionResult(async () => { const u = await requireAction('WHT_MARK_REMITTED'); await markWhtCertificateRemitted(no, ref, u); revalidate(); return { no }; });
}

/**
 * The open invoices a Receipt or Payment Voucher line may be applied to, for the Applies-to
 * picker. Read-only and scoped to one customer/vendor, so CASH_MGMT_READ is the right gate.
 */
export async function listOpenEntriesForApplication(
  partyType: 'Customer' | 'Vendor', partyNo: string,
): Promise<ActionResult<OpenLedgerEntryOption[]>> {
  return actionResult(async () => {
    await requireAction('CASH_MGMT_READ');
    if (!partyNo.trim()) return [];
    return partyType === 'Customer'
      ? listOpenCustomerEntries(partyNo.trim())
      : listOpenVendorEntries(partyNo.trim());
  });
}
