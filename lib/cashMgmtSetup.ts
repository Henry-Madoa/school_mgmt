/*
 * Cash Management setup masters — Bank Acc. Posting Groups (BC T277), External Banks / Branches
 * (the Kenya commercial-bank directory), Currencies + Exchange Rates (BC T4 / T330) and the
 * module's own singleton setup. Plus the multi-currency batch: adjustExchangeRates().
 *
 * Currency cards are also editable from the Admin Centre → Setup Pool (ADMIN_POOL_CURRENCIES);
 * this module hosts the Exchange-Rates screen for finance to enter daily rates.
 */
import { one, all, run, tx, audit, hasAnyRow } from './db.ts';
import { AppError } from './errors.ts';
import { postJournal } from './accounting.ts';
import { currentExchangeFactor, baseCurrencyCode } from './currency.ts';
import type {
  Actor, BankAccPostingGroup, BankAccPostingGroupView, CashManagementSetup, Cents, Currency,
  CurrencyExchangeRate, CurrencyView, ExternalBank, ExternalBankBranch, IsoDate,
} from './types.ts';

export { currentExchangeFactor } from './currency.ts';

const norm = (v: unknown): string => String(v ?? '').trim();
const now = (): string => new Date().toISOString();

/* ---------------------------------------------------- Bank Acc. Posting Group */

export const listBankAccPostingGroups = (): Promise<BankAccPostingGroupView[]> =>
  all<BankAccPostingGroupView>(
    `SELECT g.*, a.code AS gl_account_code, a.name AS gl_account_name,
            (SELECT COUNT(*) FROM bank_account b WHERE b.bank_acc_posting_group_code = g.code) AS accounts_using
     FROM bank_acc_posting_group g JOIN gl_account a ON a.id = g.gl_account_id
     ORDER BY g.code`,
  );

export const getBankAccPostingGroup = (code: string): Promise<BankAccPostingGroup | undefined> =>
  one<BankAccPostingGroup>('SELECT * FROM bank_acc_posting_group WHERE code = ?', code);

export interface BankAccPostingGroupInput { code: string; description: string; glAccountId: number }

export async function createBankAccPostingGroup(i: BankAccPostingGroupInput, user: Actor): Promise<{ id: number }> {
  if (!norm(i.code) || !norm(i.description) || !i.glAccountId) throw new AppError('Code, description and G/L account are required', 'VALIDATION');
  if (await hasAnyRow('bank_acc_posting_group', 'code = ?', norm(i.code))) throw new AppError('A bank posting group with this code already exists', 'DUPLICATE');
  const info = await run(
    'INSERT INTO bank_acc_posting_group (code, description, gl_account_id, created_at, created_by) VALUES (?,?,?,?,?)',
    norm(i.code).toUpperCase(), norm(i.description), i.glAccountId, now(), user.username,
  );
  await audit(user, 'BANK_ACC_POSTING_GROUP_CREATE', 'bank_acc_posting_group', info.lastInsertRowid, { code: i.code });
  return { id: Number(info.lastInsertRowid) };
}

export async function updateBankAccPostingGroup(id: number, i: BankAccPostingGroupInput, user: Actor): Promise<void> {
  const before = await one<{ code: string }>('SELECT code FROM bank_acc_posting_group WHERE id = ?', id);
  if (!before) throw new AppError('Bank posting group not found', 'NOT_FOUND');
  await run('UPDATE bank_acc_posting_group SET description = ?, gl_account_id = ? WHERE id = ?', norm(i.description), i.glAccountId, id);
  await audit(user, 'BANK_ACC_POSTING_GROUP_UPDATE', 'bank_acc_posting_group', id, {});
}

/* --------------------------------------------------- External Banks + Branches */

export const listExternalBanks = (): Promise<(ExternalBank & { branch_count: number })[]> =>
  all(`SELECT b.*, (SELECT COUNT(*) FROM external_bank_branch br WHERE br.bank_code = b.code) AS branch_count
       FROM external_bank b ORDER BY b.code`);

export const listExternalBankBranches = (bankCode?: string): Promise<ExternalBankBranch[]> =>
  all<ExternalBankBranch>(
    `SELECT * FROM external_bank_branch ${bankCode ? 'WHERE bank_code = @bankCode' : ''} ORDER BY bank_code, branch_code`,
    { bankCode },
  );

export interface ExternalBankInput { code: string; name: string }
export interface ExternalBankBranchInput { branchCode: string; branchName: string }

export async function createExternalBank(i: ExternalBankInput, branches: ExternalBankBranchInput[], user: Actor): Promise<{ id: number }> {
  if (!norm(i.code) || !norm(i.name)) throw new AppError('Code and name are required', 'VALIDATION');
  if (await hasAnyRow('external_bank', 'code = ?', norm(i.code))) throw new AppError('A bank with this code already exists', 'DUPLICATE');
  const info = await run('INSERT INTO external_bank (code, name, created_at, created_by) VALUES (?,?,?,?)', norm(i.code).toUpperCase(), norm(i.name), now(), user.username);
  await replaceExternalBankBranches(norm(i.code).toUpperCase(), branches);
  await audit(user, 'EXTERNAL_BANK_CREATE', 'external_bank', info.lastInsertRowid, { code: i.code });
  return { id: Number(info.lastInsertRowid) };
}

export async function updateExternalBank(id: number, i: ExternalBankInput, branches: ExternalBankBranchInput[], user: Actor): Promise<void> {
  const before = await one<{ code: string }>('SELECT code FROM external_bank WHERE id = ?', id);
  if (!before) throw new AppError('Bank not found', 'NOT_FOUND');
  await run('UPDATE external_bank SET name = ? WHERE id = ?', norm(i.name), id);
  await replaceExternalBankBranches(before.code, branches);
  await audit(user, 'EXTERNAL_BANK_UPDATE', 'external_bank', id, {});
}

async function replaceExternalBankBranches(bankCode: string, branches: ExternalBankBranchInput[]): Promise<void> {
  await run('DELETE FROM external_bank_branch WHERE bank_code = ?', bankCode);
  for (const b of branches) {
    if (!norm(b.branchCode)) continue;
    await run(
      'INSERT INTO external_bank_branch (bank_code, branch_code, branch_name) VALUES (?,?,?)',
      bankCode, norm(b.branchCode).toUpperCase(), norm(b.branchName),
    );
  }
}

/* --------------------------------------------------------------- Currencies */

const CCY_SELECT = `
  SELECT c.*, rg.code AS realized_gains_account_code, rl.code AS realized_losses_account_code,
         (SELECT COUNT(*) FROM currency_exchange_rate r WHERE r.currency_code = c.code) AS rate_count,
         (SELECT r.relational_exch_rate_amount / NULLIF(r.exchange_rate_amount,0)
          FROM currency_exchange_rate r WHERE r.currency_code = c.code ORDER BY r.starting_date DESC LIMIT 1) AS latest_rate
  FROM currency c
  LEFT JOIN gl_account rg ON rg.id = c.realized_gains_account_id
  LEFT JOIN gl_account rl ON rl.id = c.realized_losses_account_id`;

export const listCurrencies = (): Promise<CurrencyView[]> => all<CurrencyView>(`${CCY_SELECT} ORDER BY c.is_base DESC, c.code`);
export const getCurrency = (code: string): Promise<Currency | undefined> => one<Currency>('SELECT * FROM currency WHERE code = ?', code);
export const listActiveCurrencies = (): Promise<Currency[]> => all<Currency>('SELECT * FROM currency WHERE blocked = 0 ORDER BY is_base DESC, code');
export const listExchangeRates = (currencyCode?: string): Promise<CurrencyExchangeRate[]> =>
  all<CurrencyExchangeRate>(
    `SELECT * FROM currency_exchange_rate ${currencyCode ? 'WHERE currency_code = @currencyCode' : ''} ORDER BY currency_code, starting_date DESC`,
    { currencyCode },
  );

export interface CurrencyInput {
  code: string; description: string; symbol: string | null; isoNumericCode: string | null;
  amountRoundingPrecision: Cents; invoiceRoundingPrecision: Cents;
  realizedGainsAccountId: number | null; realizedLossesAccountId: number | null;
  unrealizedGainsAccountId: number | null; unrealizedLossesAccountId: number | null;
  residualGainsAccountId: number | null; residualLossesAccountId: number | null;
  blocked: boolean;
}

const ccyCols = `description, symbol, iso_numeric_code, amount_rounding_precision, invoice_rounding_precision,
  realized_gains_account_id, realized_losses_account_id, unrealized_gains_account_id, unrealized_losses_account_id,
  residual_gains_account_id, residual_losses_account_id, blocked`;
const ccyVals = (i: CurrencyInput): unknown[] => [
  norm(i.description), i.symbol || null, i.isoNumericCode || null, Math.round(i.amountRoundingPrecision || 1),
  Math.round(i.invoiceRoundingPrecision || 0), i.realizedGainsAccountId, i.realizedLossesAccountId,
  i.unrealizedGainsAccountId, i.unrealizedLossesAccountId, i.residualGainsAccountId, i.residualLossesAccountId,
  i.blocked ? 1 : 0,
];

export async function createCurrency(i: CurrencyInput, user: Actor): Promise<{ id: number }> {
  if (!norm(i.code) || !norm(i.description)) throw new AppError('Code and description are required', 'VALIDATION');
  if (await hasAnyRow('currency', 'code = ?', norm(i.code))) throw new AppError('A currency with this code already exists', 'DUPLICATE');
  const info = await run(
    `INSERT INTO currency (code, ${ccyCols}, is_base, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 0, ?, ?)`,
    norm(i.code).toUpperCase(), ...ccyVals(i), now(), user.username,
  );
  await audit(user, 'CURRENCY_CREATE', 'currency', info.lastInsertRowid, { code: i.code });
  return { id: Number(info.lastInsertRowid) };
}

export async function updateCurrency(id: number, i: CurrencyInput, user: Actor): Promise<void> {
  const before = await one<{ code: string; is_base: number }>('SELECT code, is_base FROM currency WHERE id = ?', id);
  if (!before) throw new AppError('Currency not found', 'NOT_FOUND');
  await run(
    `UPDATE currency SET description = ?, symbol = ?, iso_numeric_code = ?, amount_rounding_precision = ?,
       invoice_rounding_precision = ?, realized_gains_account_id = ?, realized_losses_account_id = ?,
       unrealized_gains_account_id = ?, unrealized_losses_account_id = ?, residual_gains_account_id = ?,
       residual_losses_account_id = ?, blocked = ? WHERE id = ?`,
    ...ccyVals(i), id,
  );
  await audit(user, 'CURRENCY_UPDATE', 'currency', id, {});
}

export interface ExchangeRateInput { currencyCode: string; startingDate: IsoDate; exchangeRateAmount: number; relationalExchRateAmount: number }

export async function saveExchangeRate(i: ExchangeRateInput, user: Actor): Promise<void> {
  if (!norm(i.currencyCode) || !i.startingDate) throw new AppError('Currency and starting date are required', 'VALIDATION');
  if (!(i.exchangeRateAmount > 0) || !(i.relationalExchRateAmount > 0)) throw new AppError('Both rate amounts must be greater than zero', 'VALIDATION');
  if (i.currencyCode === (await baseCurrencyCode())) throw new AppError('The base currency has no exchange rate', 'VALIDATION');
  await run(
    `INSERT INTO currency_exchange_rate (currency_code, starting_date, exchange_rate_amount, relational_exch_rate_amount, created_at, created_by)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT (currency_code, starting_date) DO UPDATE SET
       exchange_rate_amount = EXCLUDED.exchange_rate_amount,
       relational_exch_rate_amount = EXCLUDED.relational_exch_rate_amount`,
    norm(i.currencyCode).toUpperCase(), i.startingDate, i.exchangeRateAmount, i.relationalExchRateAmount, now(), user.username,
  );
  await audit(user, 'EXCHANGE_RATE_SAVE', 'currency_exchange_rate', `${i.currencyCode}/${i.startingDate}`, i);
}

export async function deleteExchangeRate(id: number, user: Actor): Promise<void> {
  await run('DELETE FROM currency_exchange_rate WHERE id = ?', id);
  await audit(user, 'EXCHANGE_RATE_DELETE', 'currency_exchange_rate', id, {});
}

/* --------------------------------------------------- Cash Management Setup */

const DEFAULT_SETUP: CashManagementSetup = {
  id: 1, receipt_approval_limit: 0, pv_approval_limit: 0, default_vat_bus_posting_group_code: null, bank_charges_account_id: null,
  bank_interest_income_account_id: null, default_receipt_bank_account_id: null,
  allow_cm_posting_from: null, allow_cm_posting_to: null, updated_at: null, updated_by: null,
};

export async function getCashManagementSetup(): Promise<CashManagementSetup> {
  return (await one<CashManagementSetup>('SELECT * FROM cash_management_setup WHERE id = 1')) ?? DEFAULT_SETUP;
}

export interface CashManagementSetupInput {
  receiptApprovalLimit: Cents; pvApprovalLimit: Cents;
  bankChargesAccountId: number | null; bankInterestIncomeAccountId: number | null;
  defaultReceiptBankAccountId: number | null;
  allowCmPostingFrom: string | null; allowCmPostingTo: string | null;
}

export async function saveCashManagementSetup(i: CashManagementSetupInput, user: Actor): Promise<void> {
  await run(
    `INSERT INTO cash_management_setup (id, receipt_approval_limit, pv_approval_limit, bank_charges_account_id,
       bank_interest_income_account_id, default_receipt_bank_account_id, allow_cm_posting_from, allow_cm_posting_to,
       updated_at, updated_by)
     VALUES (1,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (id) DO UPDATE SET
       receipt_approval_limit = EXCLUDED.receipt_approval_limit, pv_approval_limit = EXCLUDED.pv_approval_limit,
       bank_charges_account_id = EXCLUDED.bank_charges_account_id,
       bank_interest_income_account_id = EXCLUDED.bank_interest_income_account_id,
       default_receipt_bank_account_id = EXCLUDED.default_receipt_bank_account_id,
       allow_cm_posting_from = EXCLUDED.allow_cm_posting_from, allow_cm_posting_to = EXCLUDED.allow_cm_posting_to,
       updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
    Math.round(i.receiptApprovalLimit), Math.round(i.pvApprovalLimit), i.bankChargesAccountId,
    i.bankInterestIncomeAccountId, i.defaultReceiptBankAccountId, i.allowCmPostingFrom || null,
    i.allowCmPostingTo || null, now(), user.username,
  );
  await audit(user, 'CASH_MANAGEMENT_SETUP_SAVE', 'cash_management_setup', 1, i);
}

/* ------------------------------------------------- Adjust Exchange Rates (BC batch) */

/**
 * Revalues every open foreign-currency Cust./Vendor Ledger Entry and every FCY bank account to
 * the `endDate` rate, posting the delta to the currency's Unrealized gain/loss accounts and
 * writing an Unrealized Gain/Loss detailed row. Net revaluation — no auto-reversing next-day
 * entry (a documented simplification of BC).
 */
export async function adjustExchangeRates(
  { currencyCode, endDate }: { currencyCode: string; endDate: IsoDate }, user: Actor,
): Promise<{ adjustedEntries: number; gainLoss: Cents }> {
  return tx(async () => {
    const ccy = await getCurrency(currencyCode);
    if (!ccy) throw new AppError('Unknown currency', 'VALIDATION');
    if (ccy.is_base) throw new AppError('The base currency is never revalued', 'VALIDATION');
    if (!ccy.unrealized_gains_account_id || !ccy.unrealized_losses_account_id) {
      throw new AppError(`Set the Unrealized Exchange Gain / Loss accounts on the ${currencyCode} currency card first`, 'VALIDATION');
    }
    const factor = await currentExchangeFactor(currencyCode, endDate);
    let adjusted = 0;
    let netGainLoss = 0;

    const postDelta = async (controlAccountId: number, delta: Cents, tag: string) => {
      if (delta === 0) return;
      const gainAcc = ccy.unrealized_gains_account_id!;
      const lossAcc = ccy.unrealized_losses_account_id!;
      // delta > 0: the LCY value of the item rose. For a receivable that is a gain (Dr control /
      // Cr gain); for a payable it is a loss. We normalise on the control account's own natural
      // side by always Dr/Cr the control account by |delta| against gain/loss.
      const amt = Math.abs(delta);
      if (delta > 0) {
        await postJournal({
          valueDate: endDate, module: 'CASH_MGMT', eventType: 'UNREALIZED_FX',
          description: `Exchange rate adjustment ${currencyCode} — ${tag}`, reference: `FXADJ-${currencyCode}-${endDate}`, user,
          lines: [
            { account: controlAccountId, debit: amt, credit: 0, narration: tag },
            { account: gainAcc, debit: 0, credit: amt, narration: tag },
          ],
        });
      } else {
        await postJournal({
          valueDate: endDate, module: 'CASH_MGMT', eventType: 'UNREALIZED_FX',
          description: `Exchange rate adjustment ${currencyCode} — ${tag}`, reference: `FXADJ-${currencyCode}-${endDate}`, user,
          lines: [
            { account: lossAcc, debit: amt, credit: 0, narration: tag },
            { account: controlAccountId, debit: 0, credit: amt, narration: tag },
          ],
        });
      }
      netGainLoss += delta;
    };

    // Customer ledger entries.
    const cust = await all<{ id: number; remaining_amount: Cents; remaining_amount_lcy: Cents; document_no: string; customer_id: number }>(
      "SELECT id, remaining_amount, remaining_amount_lcy, document_no, customer_id FROM cust_ledger_entry WHERE open = 1 AND currency_code = ?",
      currencyCode,
    );
    for (const e of cust) {
      const target = Math.round(e.remaining_amount * factor);
      const delta = target - e.remaining_amount_lcy;
      if (delta === 0) continue;
      const pg = await one<{ receivables_account_id: number }>(
        'SELECT g.receivables_account_id FROM customer c JOIN customer_posting_group g ON g.code = c.customer_posting_group_code WHERE c.id = ?',
        e.customer_id,
      );
      if (!pg) continue;
      await postDelta(pg.receivables_account_id, delta, `Cust. entry ${e.document_no}`);
      await run(
        `INSERT INTO detailed_cust_ledger_entry (cust_ledger_entry_id, entry_type, posting_date, document_no, amount, amount_lcy, created_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
        e.id, delta > 0 ? 'Unrealized Gain' : 'Unrealized Loss', endDate, e.document_no, delta, now(),
      );
      await run('UPDATE cust_ledger_entry SET remaining_amount_lcy = ? WHERE id = ?', target, e.id);
      adjusted += 1;
    }

    // Vendor ledger entries.
    const vend = await all<{ id: number; remaining_amount: Cents; remaining_amount_lcy: Cents; document_no: string; vendor_id: number }>(
      "SELECT id, remaining_amount, remaining_amount_lcy, document_no, vendor_id FROM vendor_ledger_entry WHERE open = 1 AND currency_code = ?",
      currencyCode,
    );
    for (const e of vend) {
      const target = Math.round(e.remaining_amount * factor);
      const delta = target - e.remaining_amount_lcy;
      if (delta === 0) continue;
      const pg = await one<{ payables_account_id: number }>(
        'SELECT g.payables_account_id FROM vendor v JOIN vendor_posting_group g ON g.code = v.vendor_posting_group_code WHERE v.id = ?',
        e.vendor_id,
      );
      if (!pg) continue;
      // A payable's LCY rising is a LOSS — invert the sign passed to postDelta.
      await postDelta(pg.payables_account_id, -delta, `Vendor entry ${e.document_no}`);
      await run(
        `INSERT INTO detailed_vendor_ledger_entry (vendor_ledger_entry_id, entry_type, posting_date, document_no, amount, amount_lcy, created_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
        e.id, delta < 0 ? 'Unrealized Gain' : 'Unrealized Loss', endDate, e.document_no, delta, now(),
      );
      await run('UPDATE vendor_ledger_entry SET remaining_amount_lcy = ? WHERE id = ?', target, e.id);
      adjusted += 1;
    }

    // FCY bank accounts.
    const banks = await all<{ id: number; code: string; gl_account_id: number; balance: Cents; balance_lcy: Cents }>(
      'SELECT id, code, gl_account_id, balance, balance_lcy FROM bank_account WHERE currency_code = ?', currencyCode,
    );
    for (const b of banks) {
      const target = Math.round(b.balance * factor);
      const delta = target - b.balance_lcy;
      if (delta === 0) continue;
      await postDelta(b.gl_account_id, delta, `Bank ${b.code}`);
      await run('UPDATE bank_account SET balance_lcy = ? WHERE id = ?', target, b.id);
      adjusted += 1;
    }

    await audit(user, 'ADJUST_EXCHANGE_RATES', 'currency', currencyCode, { endDate, adjusted, netGainLoss });
    return { adjustedEntries: adjusted, gainLoss: netGainLoss };
  });
}
