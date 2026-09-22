/*
 * Payment Voucher — the cash-out mirror of lib/receipts.ts (AL Tab52203439/440,
 * Cod52203434."Post Payment Voucher"). The school pays money out of a bank account by cheque /
 * EFT / M-Pesa. Posting is one journal: Cr the paying bank, Dr each line's account.
 *
 * VAT + Withholding Tax (the AL localization): a line's `amount` is the GROSS (VAT-inclusive)
 * figure. On a direct-expense line a VAT code extracts input VAT; on any line one or two WHT
 * codes withhold tax from the payee. The cash actually paid for a line is
 * `amount - wht_amount_one - wht_amount_two` (VAT is passed through to the payee / expensed;
 * WHT is withheld and becomes a payable to KRA, evidenced by a WHT certificate).
 *
 * Lifecycle: Open -> Pending Approval -> Approved -> Posted.
 */
import { one, all, run, tx, nextSequence, audit, hasAnyRow } from './db.ts';
import { AppError } from './errors.ts';
import { postJournal } from './accounting.ts';
import { getEffectivePostingRange } from './postingDates.ts';
import { resolveDocCurrency } from './currency.ts';
import { getCashManagementSetup } from './cashMgmtSetup.ts';
import { resolveVatSetup, extractVatFromGross, postVatEntry } from './vatEngine.ts';
import { createWhtCertificateForVoucher } from './whtCertificate.ts';
import { createVendorLedgerEntry, applyVendorEntries, recomputeVendorBalance } from './vendLedger.ts';
import { createCustLedgerEntry, recomputeCustomerBalance } from './custLedger.ts';
import { findMatchingWorkflow, findPendingRoutedTask, pickConditionFields, startWorkflow } from './workflow.ts';
import { buildFilterClause, type FilterCondition, type FilterFieldDef } from './listFilters.ts';
import { buildOrderClause, type SortState } from './listSort.ts';
import type {
  Actor, Cents, IsoDate, PaymentVoucherDetail, PaymentVoucherHeader,
  PaymentVoucherHeaderView, PaymentVoucherLine, PaymentVoucherLineType, PaymentVoucherType,
} from './types.ts';

/** Declared here so the filter list below can use it; the full rules live with resolveLine(). */
const PV_TYPE_OPTIONS: { value: string; label: string }[] = [
  'Supplier Payment', 'Customer Refund', 'Bank Transfer',
  'Direct Expensing', 'Payroll Settlement', 'Remittance', 'Employee Payment',
].map((v) => ({ value: v, label: v }));

export type PaymentVoucherView = 'open' | 'pending' | 'approved' | 'posted';

const VIEW_CLAUSE: Record<PaymentVoucherView, string> = {
  open: "pvh.status = 'Open'",
  pending: "pvh.status = 'Pending Approval'",
  approved: "pvh.status = 'Approved'",
  posted: 'pvh.posted = true',
};


const CHEQUE_METHODS = new Set(['CHEQUE', 'CHQ', 'BANKERS CHEQUE']);

const SELECT_ROW = `
  SELECT pvh.*, ba.code AS paying_bank_account_code,
         (SELECT COUNT(*) FROM payment_voucher_line l WHERE l.payment_voucher_header_id = pvh.id) AS line_count,
         j.journal_no AS journal_no,
         e.employee_no, TRIM(COALESCE(e.first_name, '') || ' ' || COALESCE(e.last_name, '')) AS employee_name
  FROM payment_voucher_header pvh
  JOIN bank_account ba ON ba.id = pvh.paying_bank_account_id
  LEFT JOIN journal j ON j.id = pvh.journal_id
  LEFT JOIN employee e ON e.id = pvh.employee_id`;

export const PV_FILTER_FIELDS: FilterFieldDef[] = [
  { key: 'no', label: 'No.', type: 'text', column: 'pvh.no' },
  { key: 'pv_type', label: 'Payment Type', type: 'select', column: 'pvh.pv_type',
    options: PV_TYPE_OPTIONS },
  { key: 'paying_bank_account_id', label: 'Paying Bank', type: 'select', column: 'pvh.paying_bank_account_id' },
  { key: 'cheque_no', label: 'Cheque No.', type: 'text', column: 'pvh.cheque_no' },
  { key: 'created_by', label: 'Created By', type: 'text', column: 'pvh.created_by' },
];

const SORT_COLUMNS: Record<string, string> = {
  no: 'pvh.no', amount: 'pvh.total_amount', status: 'pvh.status', date: 'pvh.date', created_at: 'pvh.created_at',
};

export interface ListPaymentVouchersOptions {
  view?: PaymentVoucherView; search?: string; filters?: FilterCondition[]; sort?: SortState | null;
}

export const listPaymentVouchers = (
  { view, search = '', filters = [], sort = null }: ListPaymentVouchersOptions = {},
): Promise<PaymentVoucherHeaderView[]> => {
  const { clause, params } = buildFilterClause(PV_FILTER_FIELDS, filters);
  const orderBy = buildOrderClause(SORT_COLUMNS, sort, 'pvh.no DESC');
  return all<PaymentVoucherHeaderView>(
    `${SELECT_ROW}
     WHERE (pvh.no ILIKE @like OR pvh.description ILIKE @like OR pvh.payee_name ILIKE @like OR pvh.cheque_no ILIKE @like)
       ${view ? `AND ${VIEW_CLAUSE[view]}` : ''}
       ${clause}
     ${orderBy}`,
    { like: `%${String(search).trim()}%`, ...params },
  );
};

export async function getPaymentVoucher(no: string): Promise<PaymentVoucherDetail | undefined> {
  const header = await one<PaymentVoucherHeaderView>(`${SELECT_ROW} WHERE pvh.no = ?`, no);
  if (!header) return undefined;
  const lines = await all<PaymentVoucherLine>(
    'SELECT * FROM payment_voucher_line WHERE payment_voucher_header_id = ? ORDER BY line_no', header.id,
  );
  return { ...header, lines };
}

export const hasAnyPaymentVouchers = (view?: PaymentVoucherView): Promise<boolean> =>
  hasAnyRow('payment_voucher_header pvh', view ? VIEW_CLAUSE[view] : undefined);

/* -------------------------------------------------------------------- create / edit */

interface PayingBank {
  id: number; code: string; name: string; gl_account_id: number; currency_code: string; status: string;
}

async function loadBank(id: number): Promise<PayingBank> {
  const ba = await one<PayingBank>(
    'SELECT id, code, name, gl_account_id, currency_code, status FROM bank_account WHERE id = ?', id,
  );
  if (!ba) throw new AppError('Bank account not found', 'NOT_FOUND');
  if (ba.status !== 'ACTIVE') throw new AppError('That bank account is not active', 'VALIDATION');
  return ba;
}

/**
 * AL Tab-Ext52204018's `Account No` TableRelation, as data: the Payment Type chosen on the header
 * decides what every line pays.
 */
export interface PaymentVoucherTypeRule {
  lineType: PaymentVoucherLineType;
  label: string;
  help: string;
  /** G/L types only: restrict to a G/L account type, as the AL restricts some to Liabilities. */
  glType?: string;
}

export const PAYMENT_VOUCHER_TYPES: Record<PaymentVoucherType, PaymentVoucherTypeRule> = {
  'Supplier Payment': {
    lineType: 'Vendor', label: 'Supplier Payment',
    help: 'Settle a vendor invoice, with VAT and withholding tax where they apply.',
  },
  'Customer Refund': {
    lineType: 'Customer', label: 'Customer Refund',
    help: 'Refund a customer against their open entries.',
  },
  'Bank Transfer': {
    lineType: 'Bank Account', label: 'Bank Transfer',
    help: 'Move money from the paying bank account to another of the school’s bank accounts.',
  },
  'Direct Expensing': {
    lineType: 'G/L Account', label: 'Direct Expensing',
    help: 'Pay an expense straight to a G/L account, with no vendor behind it.',
  },
  'Payroll Settlement': {
    lineType: 'G/L Account', label: 'Payroll Settlement',
    help: 'Settle a payroll liability — net pay, PAYE, NSSF, SHIF or the housing levy.',
    glType: 'LIABILITY',
  },
  Remittance: {
    lineType: 'G/L Account', label: 'Remittance',
    help: 'Remit a statutory or third-party liability the school is holding.',
    glType: 'LIABILITY',
  },
  'Employee Payment': {
    lineType: 'Employee', label: 'Employee Payment',
    help: 'Pay a member of staff — an imprest, an advance or a claim — through the employee subledger. A line applied to an approved imprest request issues it.',
  },
};

export const PAYMENT_VOUCHER_TYPE_LIST = Object.keys(PAYMENT_VOUCHER_TYPES) as PaymentVoucherType[];

/** The rule for a voucher's type; an unrecognised or missing type reads as Direct Expensing. */
export const paymentVoucherRule = (pvType: string | null | undefined): PaymentVoucherTypeRule =>
  PAYMENT_VOUCHER_TYPES[(pvType ?? '') as PaymentVoucherType] ?? PAYMENT_VOUCHER_TYPES['Direct Expensing'];


export interface PaymentVoucherLineInput {
  /** Ignored on input: a line always takes the line type its voucher's Payment Type implies. */
  lineType?: PaymentVoucherLineType;
  accountNo: string;
  description?: string | null;
  amount: Cents;
  appliesToDocNo?: string | null;
  vatProdPostingGroupCode?: string | null;
  whtCodeOne?: string | null;
  whtCodeTwo?: string | null;
}
export interface PaymentVoucherInput {
  pvType?: string | null;
  payingBankAccountId: number;
  date: IsoDate;
  payModeCode?: string | null;
  chequeNo?: string | null;
  chequeDate?: IsoDate | null;
  chequeReceivedBy?: string | null;
  description: string;
  payeeName?: string | null;
  payeeExternalBankCode?: string | null;
  payeeBankBranchCode?: string | null;
  payeeAccountNo?: string | null;
  currencyCode?: string | null;
  /** Employee Payment only. */
  employeeId?: number | null;
  lines: PaymentVoucherLineInput[];
}

interface ResolvedPvLine {
  accountName: string;
  vendorId: number | null;
  vendorPin: string | null;
  vendorVatBus: string | null;
  vendorWhtExempt: boolean;
  customerId: number | null;
  otherBankGlAccountId: number | null;
  glAccountId: number | null;
  glVatBus: string | null;
  employeeId: number | null;
}

/**
 * Validates one line against the voucher's Payment Type and fills in everything derived.
 *
 * The line type is the one the Payment Type implies, never the line's own — AL relates Payment
 * Voucher Lines."Account No" to a different table per Payment Type, so a Supplier Payment can only
 * ever hold vendor lines.
 */
async function resolveLine(
  input: PaymentVoucherLineInput, rule: PaymentVoucherTypeRule, currencyCode: string,
  defaultVatBus: string | null, header: { employeeId?: number | null },
): Promise<ResolvedPvLine> {
  if (!(input.amount > 0)) throw new AppError('Every line needs an amount greater than zero', 'VALIDATION');
  const base: ResolvedPvLine = {
    accountName: '', vendorId: null, vendorPin: null, vendorVatBus: null, vendorWhtExempt: false,
    customerId: null, otherBankGlAccountId: null, glAccountId: null, glVatBus: null, employeeId: null,
  };

  // An Employee Payment pays the header's employee: the line's account is that employee, and
  // an Applies-to Doc. No. names the approved imprest request the payment issues.
  if (rule.lineType === 'Employee') {
    if (!header.employeeId) throw new AppError('Pick the employee this voucher pays', 'VALIDATION');
    const e = await one<{ id: number; employee_no: string; first_name: string; last_name: string; status: string }>(
      'SELECT id, employee_no, first_name, last_name, status FROM employee WHERE id = ?', header.employeeId,
    );
    if (!e) throw new AppError('Employee not found', 'NOT_FOUND');
    if (!['ACTIVE', 'ON_LEAVE'].includes(e.status)) throw new AppError(`${e.employee_no} is not an active employee`, 'VALIDATION');
    const ref = input.appliesToDocNo?.trim();
    if (ref) {
      const imp = await one<{ employee_id: number; status: string; posted: boolean; amount: number }>(
        `SELECT r.employee_id, r.status, r.posted,
                COALESCE((SELECT SUM(l.request_amount) FROM imprest_request_line l WHERE l.request_no = r.no), 0)::bigint AS amount
         FROM imprest_request r WHERE r.no = ?`, ref,
      );
      if (!imp) throw new AppError(`Imprest request ${ref} not found`, 'NOT_FOUND');
      if (imp.employee_id !== e.id) throw new AppError(`Imprest ${ref} does not belong to ${e.employee_no}`, 'VALIDATION');
      if (imp.posted) throw new AppError(`Imprest ${ref} has already been issued`, 'VALIDATION');
      if (imp.status !== 'Approved') throw new AppError(`Imprest ${ref} is ${imp.status} — only an approved request can be paid`, 'VALIDATION');
      if (Math.round(input.amount) !== Number(imp.amount)) throw new AppError(`Imprest ${ref} is for ${Number(imp.amount) / 100}; this line pays ${input.amount / 100}`, 'VALIDATION');
    }
    return { ...base, accountName: `${e.first_name} ${e.last_name}`, employeeId: e.id };
  }

  if (!input.accountNo?.trim()) throw new AppError(`A ${rule.lineType} is required on every line`, 'VALIDATION');
  const no = input.accountNo.trim();
  if (rule.lineType === 'Vendor') {
    const v = await one<{ id: number; name: string; blocked: string; pin_no: string | null; wht_exempt: number; vat_bus_posting_group_code: string | null }>(
      'SELECT id, name, blocked, pin_no, wht_exempt, vat_bus_posting_group_code FROM vendor WHERE no = ?', no,
    );
    if (!v) throw new AppError(`Vendor ${no} not found`, 'NOT_FOUND');
    if (v.blocked === 'All' || v.blocked === 'Payment') throw new AppError(`Vendor ${no} is blocked for payment`, 'VALIDATION');
    return { ...base, accountName: v.name, vendorId: v.id, vendorPin: v.pin_no, vendorWhtExempt: !!v.wht_exempt, vendorVatBus: v.vat_bus_posting_group_code || defaultVatBus };
  }
  if (rule.lineType === 'Customer') {
    const c = await one<{ id: number; name: string; blocked: string }>('SELECT id, name, blocked FROM customer WHERE no = ?', no);
    if (!c) throw new AppError(`Customer ${no} not found`, 'NOT_FOUND');
    return { ...base, accountName: c.name, customerId: c.id };
  }
  if (rule.lineType === 'Bank Account') {
    const b = await one<{ name: string; gl_account_id: number; currency_code: string }>('SELECT name, gl_account_id, currency_code FROM bank_account WHERE code = ?', no);
    if (!b) throw new AppError(`Bank account ${no} not found`, 'NOT_FOUND');
    if (b.currency_code !== currencyCode) throw new AppError('An inter-bank line must be in the same currency as the voucher', 'VALIDATION');
    return { ...base, accountName: b.name, otherBankGlAccountId: b.gl_account_id };
  }
  const acc = await one<{ id: number; name: string; type: string; is_postable: number; status: string; no_direct_posting: number; vat_bus_posting_group_code: string | null; vat_prod_posting_group_code: string | null }>(
    'SELECT id, name, type, is_postable, status, no_direct_posting, vat_bus_posting_group_code, vat_prod_posting_group_code FROM gl_account WHERE code = ?', no,
  );
  if (!acc || !acc.is_postable || acc.status !== 'ACTIVE') throw new AppError(`G/L account ${no} is not an active posting account`, 'VALIDATION');
  if (acc.no_direct_posting) throw new AppError(`G/L account ${no} is a subledger control account`, 'VALIDATION');
  // AL restricts Payroll Settlement and Remittance to Liabilities — what those vouchers settle is
  // something the SACCO is already holding on someone else's behalf.
  if (rule.glType && acc.type !== rule.glType) {
    throw new AppError(`A ${rule.label} settles a ${rule.glType.toLowerCase()} account; ${no} is ${acc.type.toLowerCase()}`, 'VALIDATION');
  }
  if (!input.vatProdPostingGroupCode && acc.vat_prod_posting_group_code) input.vatProdPostingGroupCode = acc.vat_prod_posting_group_code;
  return { ...base, accountName: acc.name, glAccountId: acc.id, glVatBus: acc.vat_bus_posting_group_code || defaultVatBus };
}

/** The AL "Payment Voucher Lines".Amount arithmetic for one line — see the module header. */
interface LineTax {
  vatProd: string | null; vatBus: string | null; vatPct: number; vatAmount: Cents;
  whtOne: string | null; whtOneRate: number; whtAmountOne: Cents;
  whtTwo: string | null; whtTwoRate: number; whtAmountTwo: Cents;
  netAmount: Cents; whtBase: Cents;
}

async function computeLineTaxFor(
  input: PaymentVoucherLineInput, resolved: ResolvedPvLine, currencyFactor: number, docDate: IsoDate,
): Promise<LineTax> {
  const gross = Math.round(input.amount);
  const isApplied = !!input.appliesToDocNo?.trim();
  const vatBus = resolved.vendorVatBus ?? resolved.glVatBus;

  let vatPct = 0;
  let vatAmount = 0;
  let vatProd: string | null = null;
  if (input.vatProdPostingGroupCode?.trim()) {
    if (isApplied) throw new AppError('A VAT code is not allowed on a line that pays a posted invoice — VAT was recognised at the invoice', 'VALIDATION');
    vatProd = input.vatProdPostingGroupCode.trim();
    const vs = await resolveVatSetup(vatBus, vatProd);
    if (vs?.tax_type !== 'VAT') throw new AppError(`${vatProd} is not a VAT code`, 'VALIDATION');
    vatPct = vs.vat_pct;
    vatAmount = extractVatFromGross(gross, vatPct);
  }

  // WHT base: net of VAT. For an applied invoice line, net out the VAT that the invoice carried.
  let whtBase = gross - vatAmount;
  if (isApplied && resolved.vendorId) {
    const ref = input.appliesToDocNo!.trim();
    const vle = await one<{ id: number }>(
      "SELECT id FROM vendor_ledger_entry WHERE vendor_id = ? AND document_no = ? AND positive = 1 ORDER BY id DESC LIMIT 1",
      resolved.vendorId, ref,
    );
    const inv = vle
      ? await one<{ amount: number; amount_incl_vat: number }>(
          "SELECT amount, amount_incl_vat FROM posted_purchase_document WHERE vendor_ledger_entry_id = ? ORDER BY id DESC LIMIT 1",
          vle.id,
        )
      : null;
    if (inv && inv.amount_incl_vat > 0 && inv.amount !== inv.amount_incl_vat) {
      whtBase = Math.round(gross * (inv.amount / inv.amount_incl_vat));
    }
  }

  const resolveWht = async (code: string | null | undefined): Promise<{ code: string | null; rate: number; amount: Cents }> => {
    const c = code?.trim();
    if (!c || resolved.vendorWhtExempt) return { code: null, rate: 0, amount: 0 };
    const vs = await resolveVatSetup(vatBus, c);
    if (vs?.tax_type !== 'WHT') throw new AppError(`${c} is not a withholding-tax code`, 'VALIDATION');
    return { code: c, rate: vs.vat_pct, amount: vs.vat_pct > 0 ? Math.ceil(whtBase * (vs.vat_pct / 100) - 1e-9) : 0 };
  };
  const w1 = await resolveWht(input.whtCodeOne);
  const w2 = await resolveWht(input.whtCodeTwo);
  void currencyFactor; void docDate;

  return {
    vatProd, vatBus, vatPct, vatAmount,
    whtOne: w1.code, whtOneRate: w1.rate, whtAmountOne: w1.amount,
    whtTwo: w2.code, whtTwoRate: w2.rate, whtAmountTwo: w2.amount,
    whtBase,
    netAmount: gross - w1.amount - w2.amount,
  };
}

/** The employee an Employee Payment pays; cleared whenever the Payment Type is anything else. */
async function resolveHeaderEmployee(input: PaymentVoucherInput): Promise<number | null> {
  if (paymentVoucherRule(input.pvType).lineType !== 'Employee') return null;
  if (!input.employeeId) throw new AppError('Pick the employee this voucher pays', 'VALIDATION');
  const e = await one<{ id: number; employee_no: string; status: string }>('SELECT id, employee_no, status FROM employee WHERE id = ?', input.employeeId);
  if (!e) throw new AppError('Employee not found', 'NOT_FOUND');
  if (!['ACTIVE', 'ON_LEAVE'].includes(e.status)) throw new AppError(`${e.employee_no} is not an active employee`, 'VALIDATION');
  return e.id;
}

/**
 * The Payment Method a cash document was settled by — a real relation to the Setup Pool table,
 * not free text, so a code that was renamed or blocked cannot quietly stay on new documents.
 * Blank is allowed: not every receipt or voucher records how the money moved.
 */
async function assertPaymentMethod(code: string | null | undefined): Promise<string | null> {
  const value = code?.trim();
  if (!value) return null;
  const m = await one<{ code: string; status: string }>(
    'SELECT code, status FROM payment_method WHERE code = ?', value,
  );
  if (!m) throw new AppError(`Payment method ${value} is not defined`, 'NOT_FOUND');
  if (m.status !== 'ACTIVE') throw new AppError(`Payment method ${value} is not active`, 'VALIDATION');
  return m.code;
}

export async function createPaymentVoucher(input: PaymentVoucherInput, user: Actor): Promise<{ no: string }> {
  if (!input.date) throw new AppError('A voucher date is required', 'VALIDATION');
  if (!input.description?.trim()) throw new AppError('A narration is required', 'VALIDATION');
  const employeeId = await resolveHeaderEmployee(input);
  const payMode = await assertPaymentMethod(input.payModeCode);
  const bank = await loadBank(input.payingBankAccountId);
  const cur = await resolveDocCurrency(input.currencyCode ?? bank.currency_code, input.date);
  if (cur.code !== bank.currency_code) throw new AppError(`The voucher is in ${cur.code} but bank account ${bank.code} is a ${bank.currency_code} account`, 'VALIDATION');
  const setup = await getCashManagementSetup();
  const no = await nextSequence('PAYMENT_VOUCHER');
  return tx(async () => {
    const info = await run(
      `INSERT INTO payment_voucher_header
         (no, date, pv_type, pay_mode_code, cheque_no, cheque_date, cheque_received_by, paying_bank_account_id,
          currency_code, currency_factor, description, payee_name, payee_external_bank_code, payee_bank_branch_code,
          payee_account_no, approval_limit, prepared_by, employee_id, created_at, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      no, input.date, input.pvType?.trim() || null, payMode, input.chequeNo?.trim() || null,
      input.chequeDate || null, input.chequeReceivedBy?.trim() || null, bank.id, cur.code, cur.factor,
      input.description.trim(), input.payeeName?.trim() || null, input.payeeExternalBankCode || null,
      input.payeeBankBranchCode || null, input.payeeAccountNo?.trim() || null, setup.pv_approval_limit,
      user.username, employeeId,
      new Date().toISOString(), user.username,
    );
    await replaceLines(Number(info.lastInsertRowid), input, cur.code, cur.factor, input.date, setup.default_vat_bus_posting_group_code);
    await audit(user, 'PAYMENT_VOUCHER_CREATE', 'payment_voucher_header', no, { lineCount: input.lines.length });
    return { no };
  });
}

export async function updatePaymentVoucher(no: string, input: PaymentVoucherInput, user: Actor): Promise<void> {
  const before = await one<PaymentVoucherHeader>('SELECT * FROM payment_voucher_header WHERE no = ?', no);
  if (!before) throw new AppError('Payment voucher not found', 'NOT_FOUND');
  if (before.status !== 'Open') throw new AppError('Only an open voucher can be edited', 'VALIDATION');
  if (before.created_by !== user.username) throw new AppError('Only the person who created this can edit it', 'NOT_CREATOR');
  const employeeId = await resolveHeaderEmployee(input);
  const payMode = await assertPaymentMethod(input.payModeCode);
  const bank = await loadBank(input.payingBankAccountId);
  const cur = await resolveDocCurrency(input.currencyCode ?? before.currency_code, input.date);
  if (cur.code !== bank.currency_code) throw new AppError('The voucher currency must match the bank account currency', 'VALIDATION');
  const setup = await getCashManagementSetup();
  await tx(async () => {
    await run(
      `UPDATE payment_voucher_header SET date = ?, pv_type = ?, pay_mode_code = ?, cheque_no = ?, cheque_date = ?,
         cheque_received_by = ?, paying_bank_account_id = ?, currency_code = ?, currency_factor = ?, description = ?,
         payee_name = ?, payee_external_bank_code = ?, payee_bank_branch_code = ?, payee_account_no = ?,
         employee_id = ? WHERE id = ?`,
      input.date, input.pvType?.trim() || null, payMode, input.chequeNo?.trim() || null,
      input.chequeDate || null, input.chequeReceivedBy?.trim() || null, bank.id, cur.code, cur.factor,
      input.description.trim(), input.payeeName?.trim() || null, input.payeeExternalBankCode || null,
      input.payeeBankBranchCode || null, input.payeeAccountNo?.trim() || null,
      employeeId, before.id,
    );
    await replaceLines(before.id, input, cur.code, cur.factor, input.date, setup.default_vat_bus_posting_group_code);
  });
  await audit(user, 'PAYMENT_VOUCHER_UPDATE', 'payment_voucher_header', no, {});
}

async function replaceLines(
  headerId: number, input: PaymentVoucherInput, currencyCode: string, currencyFactor: number,
  docDate: IsoDate, defaultVatBus: string | null,
): Promise<void> {
  await run('DELETE FROM payment_voucher_line WHERE payment_voucher_header_id = ?', headerId);
  const rule = paymentVoucherRule(input.pvType);
  let lineNo = 10000;
  let total = 0;
  for (const l of input.lines) {
    const isEmployee = rule.lineType === 'Employee';
    const hasAccount = isEmployee ? !!input.employeeId : !!l.accountNo?.trim();
    // A blank row is dropped; one carrying money but no account is refused, so a line can never
    // be silently lost between the form and the document.
    if (!hasAccount && !(l.amount > 0)) continue;
    if (!hasAccount) {
      throw new AppError(`A line has an amount but no ${rule.lineType} — a ${rule.label} pays ${rule.lineType} only`, 'VALIDATION');
    }
    if (!(l.amount > 0)) continue;
    const resolved = await resolveLine(l, rule, currencyCode, defaultVatBus, { employeeId: input.employeeId ?? null });
    const employeeNo = isEmployee ? (await one<{ employee_no: string }>('SELECT employee_no FROM employee WHERE id = ?', resolved.employeeId))?.employee_no ?? null : null;
    // A line always carries a description, defaulted from the header narration. The form asks
    // for one; this is the backstop, so a posted line can never print blank.
    const description = l.description?.trim() || input.description.trim();
    if (!description) throw new AppError('Every voucher line needs a description', 'VALIDATION');
    // Only a supplier payment carries tax: nothing else has a VAT or WHT base behind it.
    const tax = rule.lineType === 'Bank Account' || rule.lineType === 'Employee'
      ? blankLineTax(Math.round(l.amount))
      : await computeLineTaxFor(l, resolved, currencyFactor, docDate);
    total += tax.netAmount;
    await run(
      `INSERT INTO payment_voucher_line
         (payment_voucher_header_id, line_no, line_type, account_no, account_name, description, amount, applies_to_doc_no,
          vat_prod_posting_group_code, wht_code_one, wht_code_two, vat_amount, wht_amount_one, wht_amount_two, wht_base, net_amount)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      headerId, lineNo, rule.lineType, employeeNo ?? (l.accountNo?.trim() || null), resolved.accountName, description,
      Math.round(l.amount), l.appliesToDocNo?.trim() || null, tax.vatProd, tax.whtOne, tax.whtTwo,
      tax.vatAmount, tax.whtAmountOne, tax.whtAmountTwo, tax.whtBase, tax.netAmount,
    );
    lineNo += 10000;
  }
  await run('UPDATE payment_voucher_header SET total_amount = ? WHERE id = ?', total, headerId);
}

/** A line with no tax on it — the employee and inter-bank types. */
const blankLineTax = (gross: Cents): LineTax => ({
  vatProd: null, vatBus: null, vatPct: 0, vatAmount: 0,
  whtOne: null, whtOneRate: 0, whtAmountOne: 0,
  whtTwo: null, whtTwoRate: 0, whtAmountTwo: 0,
  netAmount: gross, whtBase: 0,
});

export async function deletePaymentVoucher(no: string, user: Actor): Promise<void> {
  const before = await one<Pick<PaymentVoucherHeader, 'status' | 'created_by'>>('SELECT status, created_by FROM payment_voucher_header WHERE no = ?', no);
  if (!before) throw new AppError('Payment voucher not found', 'NOT_FOUND');
  if (before.status !== 'Open') throw new AppError('Only an open voucher can be deleted', 'VALIDATION');
  if (before.created_by !== user.username) throw new AppError('Only the person who created this can delete it', 'NOT_CREATOR');
  await run('DELETE FROM payment_voucher_header WHERE no = ?', no);
  await audit(user, 'PAYMENT_VOUCHER_DELETE', 'payment_voucher_header', no, {});
}

/* --------------------------------------------------------------- maker-checker */

export async function submitPaymentVoucher(no: string, user: Actor): Promise<{ autoApproved: boolean }> {
  const req = await one<PaymentVoucherHeader>('SELECT * FROM payment_voucher_header WHERE no = ?', no);
  if (!req) throw new AppError('Payment voucher not found', 'NOT_FOUND');
  if (req.status !== 'Open') throw new AppError('Only an open voucher can be submitted', 'VALIDATION');
  if (req.total_amount <= 0) throw new AppError('Add at least one line before submitting', 'VALIDATION');
  const matched = await findMatchingWorkflow('PAYMENT_VOUCHER', await pickConditionFields('PAYMENT_VOUCHER', req));
  if (!matched) throw new AppError('There is no enabled workflow for this document', 'NO_WORKFLOW');
  await tx(async () => {
    await run("UPDATE payment_voucher_header SET status = 'Pending Approval' WHERE no = ?", no);
    await startWorkflow(matched.workflow, matched.steps, {
      documentType: 'PAYMENT_VOUCHER', entityId: no, requestedBy: user.username, amount: Number(req.total_amount),
    });
  });
  const after = await one<{ status: string }>('SELECT status FROM payment_voucher_header WHERE no = ?', no);
  return { autoApproved: after?.status === 'Approved' };
}

export async function cancelPaymentVoucherApproval(no: string, user: Actor): Promise<void> {
  const req = await one<Pick<PaymentVoucherHeader, 'status' | 'created_by'>>('SELECT status, created_by FROM payment_voucher_header WHERE no = ?', no);
  if (!req) throw new AppError('Payment voucher not found', 'NOT_FOUND');
  if (req.status !== 'Pending Approval') throw new AppError('Only a voucher pending approval can be recalled', 'VALIDATION');
  const routed = await findPendingRoutedTask('PAYMENT_VOUCHER', no);
  if ((routed?.requested_by ?? req.created_by) !== user.username) throw new AppError('Only the person who submitted this can recall it', 'NOT_REQUESTER');
  await run("UPDATE payment_voucher_header SET status = 'Open' WHERE no = ?", no);
  await audit(user, 'PAYMENT_VOUCHER_CANCEL_APPROVAL', 'payment_voucher_header', no, {});
}

/** BC "Release" — asserts cheque details + cheque-no uniqueness for a cheque pay mode. */
export async function approvePaymentVoucher(no: string, user: Actor): Promise<void> {
  const req = await one<PaymentVoucherHeader>('SELECT * FROM payment_voucher_header WHERE no = ?', no);
  if (!req) throw new AppError('Payment voucher not found', 'NOT_FOUND');
  if (req.status !== 'Pending Approval') throw new AppError('Only a voucher pending approval can be approved', 'VALIDATION');
  const isCheque = CHEQUE_METHODS.has(String(req.pay_mode_code ?? '').toUpperCase());
  if (isCheque) {
    if (!req.cheque_no?.trim()) throw new AppError('Enter the cheque number before releasing', 'VALIDATION');
    if (!req.cheque_date) throw new AppError('Enter the cheque date before releasing', 'VALIDATION');
    if (req.cheque_date > new Date().toISOString().slice(0, 10)) throw new AppError('The cheque date cannot be in the future', 'VALIDATION');
    if (await hasAnyRow('payment_voucher_header', 'cheque_no = ? AND id <> ?', req.cheque_no.trim(), req.id)) {
      throw new AppError(`Cheque number ${req.cheque_no} is already used on another voucher`, 'DUPLICATE');
    }
  }
  await run("UPDATE payment_voucher_header SET status = 'Approved', decision_reason = NULL WHERE no = ?", no);
  await audit(user, 'PAYMENT_VOUCHER_APPROVE', 'payment_voucher_header', no, {});
}

export async function rejectPaymentVoucher(no: string, reason: string | null, user: Actor): Promise<void> {
  if (!reason?.trim()) throw new AppError('A reason is required to reject a voucher', 'VALIDATION');
  const req = await one<PaymentVoucherHeader>('SELECT * FROM payment_voucher_header WHERE no = ?', no);
  if (!req) throw new AppError('Payment voucher not found', 'NOT_FOUND');
  if (req.status !== 'Pending Approval') throw new AppError('Only a voucher pending approval can be rejected', 'VALIDATION');
  await run("UPDATE payment_voucher_header SET status = 'Open', decision_reason = ? WHERE no = ?", reason, no);
  await audit(user, 'PAYMENT_VOUCHER_REJECT', 'payment_voucher_header', no, { reason });
}

export async function reopenPaymentVoucher(no: string, user: Actor): Promise<void> {
  const req = await one<PaymentVoucherHeader>('SELECT * FROM payment_voucher_header WHERE no = ?', no);
  if (!req) throw new AppError('Payment voucher not found', 'NOT_FOUND');
  if (req.status !== 'Approved' || req.posted) throw new AppError('Only an approved, unposted voucher can be reopened', 'VALIDATION');
  await run("UPDATE payment_voucher_header SET status = 'Open' WHERE no = ?", no);
  await audit(user, 'PAYMENT_VOUCHER_REOPEN', 'payment_voucher_header', no, {});
}

/* ------------------------------------------------------------------- posting */

interface GlLeg { account: number; debit: Cents; credit: Cents; narration: string; bankDocumentType?: string; bankDocumentNo?: string; bankExternalDocumentNo?: string | null }

export async function postPaymentVoucher(no: string, user: Actor): Promise<{ postedVoucherNo: string; journalNo: string | null; whtCertificateNos: string[] }> {
  return tx(async () => {
    const header = await one<PaymentVoucherHeader>('SELECT * FROM payment_voucher_header WHERE no = ?', no);
    if (!header) throw new AppError('Payment voucher not found', 'NOT_FOUND');
    if (header.posted) throw new AppError('This voucher has already been posted', 'VALIDATION');
    if (header.total_amount >= header.approval_limit && header.status !== 'Approved') {
      throw new AppError('This voucher is at or above the approval limit and must be approved before posting', 'VALIDATION');
    }
    if (!['Open', 'Approved'].includes(header.status)) throw new AppError('This voucher cannot be posted', 'VALIDATION');
    if (header.total_amount < header.approval_limit && header.status === 'Open' && header.created_by !== user.username) {
      throw new AppError('Only the person who created this voucher can post it directly', 'NOT_CREATOR');
    }

    const vd = header.date;
    const setup = await getCashManagementSetup();
    if (setup.allow_cm_posting_from && vd < setup.allow_cm_posting_from) throw new AppError(`Cash Management posting is not allowed before ${setup.allow_cm_posting_from}`, 'VALIDATION');
    if (setup.allow_cm_posting_to && vd > setup.allow_cm_posting_to) throw new AppError(`Cash Management posting is not allowed after ${setup.allow_cm_posting_to}`, 'VALIDATION');
    const range = await getEffectivePostingRange(user.id);
    if (range.from && vd < range.from) throw new AppError(`Posting date ${vd} is before your earliest allowed date (${range.from})`, 'VALIDATION');
    if (range.to && vd > range.to) throw new AppError(`Posting date ${vd} is after your latest allowed date (${range.to})`, 'VALIDATION');

    const bank = await loadBank(header.paying_bank_account_id);
    const lines = await all<PaymentVoucherLine>('SELECT * FROM payment_voucher_line WHERE payment_voucher_header_id = ? ORDER BY line_no', header.id);
    if (!lines.length) throw new AppError('This voucher has no lines', 'VALIDATION');

    const whtPayable = async (code: string): Promise<number> => {
      const vs = await resolveVatSetup(setup.default_vat_bus_posting_group_code, code);
      if (!vs?.tax_account_id) throw new AppError(`WHT code ${code} has no payable G/L account in its VAT Posting Setup`, 'VALIDATION');
      return vs.tax_account_id;
    };
    const inputVatAccount = async (vatBus: string | null, vatProd: string): Promise<number> => {
      const vs = await resolveVatSetup(vatBus, vatProd);
      if (!vs?.tax_account_id) throw new AppError(`VAT code ${vatProd} has no input-VAT G/L account`, 'VALIDATION');
      return vs.tax_account_id;
    };

    const glLines: GlLeg[] = [
      { account: bank.gl_account_id, debit: 0, credit: header.total_amount, narration: `Payment Voucher ${no} — ${header.description}`.slice(0, 250),
        bankDocumentType: 'Payment', bankDocumentNo: no, bankExternalDocumentNo: header.cheque_no },
    ];
    const touchedVendors = new Set<number>();
    const touchedCustomers = new Set<number>();
    const vatEntryRows: { vatProd: string; vatBus: string | null; pct: number; base: Cents; amount: Cents; taxType: 'VAT' | 'WHT'; vendorNo: string | null; vendorPin: string | null }[] = [];
    /** Employee Payment lines — written to the employee subledger once the journal exists. */
    const employeePayments: { amount: Cents; appliesTo: string | null; narration: string }[] = [];
    const imprestControl = lines.some((l) => l.line_type === 'Employee') ? await (await import('./imprest.ts')).imprestControlAccountId() : null;

    for (const line of lines) {
      const narration = `Payment Voucher ${no} — ${line.description || line.account_name || line.account_no}`.slice(0, 250);
      const gross = line.amount;
      const netOfVat = gross - line.vat_amount;

      if (line.line_type === 'Employee') {
        // Money out to a member of staff sits on the employee subledger until it is surrendered,
        // refunded or recovered — the control account is debited, not an expense.
        if (!header.employee_id) throw new AppError('This voucher has no employee', 'VALIDATION');
        glLines.push({ account: imprestControl!, debit: gross, credit: 0, narration });
        employeePayments.push({ amount: gross, appliesTo: line.applies_to_doc_no, narration });
      } else if (line.line_type === 'G/L Account') {
        glLines.push({ account: (await one<{ id: number }>('SELECT id FROM gl_account WHERE code = ?', line.account_no!))!.id, debit: netOfVat, credit: 0, narration });
        if (line.vat_amount > 0 && line.vat_prod_posting_group_code) {
          const acc = await one<{ vat_bus_posting_group_code: string | null }>('SELECT vat_bus_posting_group_code FROM gl_account WHERE code = ?', line.account_no!);
          const vatBus = acc?.vat_bus_posting_group_code || setup.default_vat_bus_posting_group_code;
          glLines.push({ account: await inputVatAccount(vatBus, line.vat_prod_posting_group_code), debit: line.vat_amount, credit: 0, narration: `${narration} — input VAT` });
          vatEntryRows.push({ vatProd: line.vat_prod_posting_group_code, vatBus, pct: 0, base: netOfVat, amount: line.vat_amount, taxType: 'VAT', vendorNo: null, vendorPin: null });
        }
      } else if (line.line_type === 'Bank Account') {
        const b = await one<{ gl_account_id: number }>('SELECT gl_account_id FROM bank_account WHERE code = ?', line.account_no!);
        glLines.push({ account: b!.gl_account_id, debit: gross, credit: 0, narration, bankDocumentType: 'Transfer', bankDocumentNo: no });
      } else if (line.line_type === 'Vendor') {
        const v = await one<{ id: number; pin_no: string | null; vendor_posting_group_code: string | null }>('SELECT id, pin_no, vendor_posting_group_code FROM vendor WHERE no = ?', line.account_no!);
        if (!v?.vendor_posting_group_code) throw new AppError(`Vendor ${line.account_no} has no Vendor Posting Group`, 'VALIDATION');
        const pg = await one<{ payables_account_id: number }>('SELECT payables_account_id FROM vendor_posting_group WHERE code = ?', v.vendor_posting_group_code);
        glLines.push({ account: pg!.payables_account_id, debit: gross, credit: 0, narration });
        const pay = await createVendorLedgerEntry({
          vendorId: v.id, postingDate: vd, documentType: 'Payment', documentNo: no, description: narration,
          amount: -gross, currencyCode: header.currency_code, currencyFactor: header.currency_factor, sourceType: 'Payment Voucher', sourceId: header.id,
        });
        const target: number[] = [];
        if (line.applies_to_doc_no) {
          const t = await one<{ id: number }>("SELECT id FROM vendor_ledger_entry WHERE vendor_id = ? AND document_no = ? AND open = 1 AND positive = 1 ORDER BY id LIMIT 1", v.id, line.applies_to_doc_no);
          if (t) target.push(t.id);
        }
        await applyVendorEntries({ applyingEntryId: pay, appliedTo: target.length ? target : 'auto', postingDate: vd }, user);
        touchedVendors.add(v.id);
        if (line.vat_amount > 0 && line.vat_prod_posting_group_code) {
          const vatBus = setup.default_vat_bus_posting_group_code;
          glLines.push({ account: await inputVatAccount(vatBus, line.vat_prod_posting_group_code), debit: line.vat_amount, credit: 0, narration: `${narration} — input VAT` });
          vatEntryRows.push({ vatProd: line.vat_prod_posting_group_code, vatBus, pct: 0, base: netOfVat, amount: line.vat_amount, taxType: 'VAT', vendorNo: line.account_no, vendorPin: v.pin_no });
        }
      } else {
        const c = await one<{ id: number; customer_posting_group_code: string | null }>('SELECT id, customer_posting_group_code FROM customer WHERE no = ?', line.account_no!);
        if (!c?.customer_posting_group_code) throw new AppError(`Customer ${line.account_no} has no Customer Posting Group`, 'VALIDATION');
        const pg = await one<{ receivables_account_id: number }>('SELECT receivables_account_id FROM customer_posting_group WHERE code = ?', c.customer_posting_group_code);
        glLines.push({ account: pg!.receivables_account_id, debit: gross, credit: 0, narration });
        await createCustLedgerEntry({
          customerId: c.id, postingDate: vd, documentType: 'Refund', documentNo: no, description: narration,
          amount: gross, currencyCode: header.currency_code, currencyFactor: header.currency_factor, sourceType: 'Payment Voucher', sourceId: header.id,
        });
        touchedCustomers.add(c.id);
      }

      // WHT — withheld from the payee, credited to the payable account.
      for (const [code, amt] of [[line.wht_code_one, line.wht_amount_one], [line.wht_code_two, line.wht_amount_two]] as const) {
        if (code && amt > 0) {
          glLines.push({ account: await whtPayable(code), debit: 0, credit: amt, narration: `${narration} — ${code}` });
          const v = line.line_type === 'Vendor'
            ? await one<{ pin_no: string | null }>('SELECT pin_no FROM vendor WHERE no = ?', line.account_no!)
            : null;
          vatEntryRows.push({ vatProd: code, vatBus: setup.default_vat_bus_posting_group_code, pct: 0, base: line.wht_base || (gross - line.vat_amount), amount: amt, taxType: 'WHT', vendorNo: line.line_type === 'Vendor' ? line.account_no : null, vendorPin: v?.pin_no ?? null });
        }
      }
    }

    const j = await postJournal({
      valueDate: vd, module: 'CASH_MGMT', eventType: 'PAYMENT_VOUCHER',
      description: `Payment Voucher ${no} — ${header.description}`.slice(0, 250), reference: no, user,
      idempotencyKey: `PV-${no}`, currencyCode: header.currency_code, currencyFactor: header.currency_factor,
      lines: glLines.map((l) => ({
        account: l.account, debit: l.debit, credit: l.credit, narration: l.narration,
        bankDocumentType: l.bankDocumentType, bankDocumentNo: l.bankDocumentNo, bankExternalDocumentNo: l.bankExternalDocumentNo,
      })),
    });

    for (const r of vatEntryRows) {
      await postVatEntry({
        postingDate: vd, documentType: 'Payment Voucher', documentNo: no, taxType: r.taxType,
        vatBus: r.vatBus, vatProd: r.vatProd, vatPct: r.pct, base: r.base, amount: r.amount,
        currencyCode: header.currency_code, currencyFactor: header.currency_factor,
        vendorNo: r.vendorNo, vendorPin: r.vendorPin, journalId: j.id, sourceType: 'Payment Voucher', sourceId: header.id,
      });
    }
    if (employeePayments.length) {
      const imprest = await import('./imprest.ts');
      for (const p of employeePayments) {
        await imprest.writeEmployeeLedgerEntry({
          employeeId: header.employee_id!, entryType: p.appliesTo ? 'IMPREST_ISSUE' : 'PAYMENT', documentNo: p.appliesTo ?? no,
          postingDate: vd, amount: p.amount, description: p.narration, journalId: j.id, user,
        });
        if (p.appliesTo) await imprest.markImprestIssuedByVoucher(p.appliesTo, header.employee_id!, p.amount, no, j.id, vd, user);
      }
    }
    await run("UPDATE vendor_ledger_entry SET journal_id = ? WHERE source_type = 'Payment Voucher' AND source_id = ? AND journal_id IS NULL", j.id, header.id);
    await run("UPDATE cust_ledger_entry SET journal_id = ? WHERE source_type = 'Payment Voucher' AND source_id = ? AND journal_id IS NULL", j.id, header.id);
    for (const v of touchedVendors) await recomputeVendorBalance(v);
    for (const c of touchedCustomers) await recomputeCustomerBalance(c);

    const whtCertificateNos = await createWhtCertificateForVoucher(header, lines, vd, user);

    const postedNo = await nextSequence('POSTED_PAYMENT_VOUCHER');
    const approver = (await findPendingRoutedTask('PAYMENT_VOUCHER', no))?.requested_by ?? null;
    const info = await run(
      `INSERT INTO posted_payment_voucher
         (no, pv_no, date, pay_mode_code, cheque_no, cheque_date, cheque_received_by, paying_bank_account_id,
          currency_code, currency_factor, description, payee_name, payee_external_bank_code, payee_bank_branch_code,
          payee_account_no, posting_date, total_amount, journal_id, prepared_by, approved_by,
          pv_type, employee_id, created_at, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      postedNo, no, header.date, header.pay_mode_code, header.cheque_no, header.cheque_date, header.cheque_received_by,
      bank.id, header.currency_code, header.currency_factor, header.description, header.payee_name,
      header.payee_external_bank_code, header.payee_bank_branch_code, header.payee_account_no, vd, header.total_amount,
      j.id, header.prepared_by, approver, header.pv_type,
      header.employee_id, new Date().toISOString(), user.username,
    );
    const ppvId = Number(info.lastInsertRowid);
    let ln = 10000;
    for (const line of lines) {
      await run(
        `INSERT INTO posted_payment_voucher_line
           (posted_payment_voucher_id, line_no, line_type, account_no, account_name, description, amount, applies_to_doc_no,
            vat_prod_posting_group_code, wht_code_one, wht_code_two, vat_amount, wht_amount_one, wht_amount_two, wht_base, net_amount)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ppvId, ln, line.line_type, line.account_no, line.account_name, line.description, line.amount, line.applies_to_doc_no,
        line.vat_prod_posting_group_code, line.wht_code_one, line.wht_code_two, line.vat_amount, line.wht_amount_one,
        line.wht_amount_two, line.wht_base, line.net_amount,
      );
      ln += 10000;
    }

    await run("UPDATE payment_voucher_header SET posted = true, journal_id = ?, posted_at = ?, posted_by = ? WHERE no = ?", j.id, new Date().toISOString(), user.username, no);
    await audit(user, 'PAYMENT_VOUCHER_POST', 'payment_voucher_header', no, { postedNo, journalNo: j.journal_no, whtCertificateNos });
    return { postedVoucherNo: postedNo, journalNo: j.journal_no, whtCertificateNos };
  });
}
