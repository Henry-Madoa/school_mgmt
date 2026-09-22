/*
 * Currency + exchange-rate primitives shared by the posting engine (lib/accounting.ts) and the
 * Cash Management module. Kept dependency-light (only lib/db.ts) so lib/accounting.ts can import
 * it without a cycle.
 *
 * LCY (local currency) is the base currency — `currency.is_base = 1`, normally KES. A journal's
 * `currency_factor` is **LCY per 1 unit of the transaction currency**; postJournal multiplies
 * every FCY line amount by it to get the amount that actually moves `gl_account.balance`.
 */
import { one } from './db.ts';
import { AppError } from './errors.ts';
import type { Currency, IsoDate } from './types.ts';

let baseCodeCache: string | null = null;

/** The base-currency code (`currency.is_base = 1`). Falls back to 'KES' when the currency table
 *  is empty (a fresh DB before seed, or a test fixture). Cached for the process. */
export async function baseCurrencyCode(): Promise<string> {
  if (baseCodeCache) return baseCodeCache;
  const row = await one<{ code: string }>('SELECT code FROM currency WHERE is_base = 1 LIMIT 1');
  baseCodeCache = row?.code ?? 'KES';
  return baseCodeCache;
}

export const isBaseCurrency = async (code: string | null | undefined): Promise<boolean> =>
  !code || code === (await baseCurrencyCode());

export const getCurrency = (code: string): Promise<Currency | undefined> =>
  one<Currency>('SELECT * FROM currency WHERE code = ?', code);

/**
 * LCY per 1 unit of `currencyCode`, from the latest `currency_exchange_rate` starting on or
 * before `onDate` (BC's "Currency Exchange Rate" lookup). `1` for the base currency or a blank
 * code. Throws when a non-base currency has no rate yet.
 */
export async function currentExchangeFactor(
  currencyCode: string | null | undefined, onDate: IsoDate,
): Promise<number> {
  if (await isBaseCurrency(currencyCode)) return 1;
  const rate = await one<{ exchange_rate_amount: number; relational_exch_rate_amount: number }>(
    `SELECT exchange_rate_amount, relational_exch_rate_amount
     FROM currency_exchange_rate
     WHERE currency_code = ? AND starting_date <= ?
     ORDER BY starting_date DESC LIMIT 1`,
    currencyCode, onDate,
  );
  if (!rate) {
    throw new AppError(
      `No exchange rate for ${currencyCode} on or before ${onDate} — enter one under Cash Management → Exchange Rates`,
      'NO_EXCHANGE_RATE',
    );
  }
  const denom = rate.exchange_rate_amount || 1;
  return rate.relational_exch_rate_amount / denom;
}

/** Convert an FCY amount (cents) to LCY (cents) at `factor`, rounded to the whole cent. */
export const toLcy = (amount: number, factor: number): number => Math.round(amount * factor);

/** Resolve a document's currency + LCY factor at a date. Non-base documents cannot carry Item /
 *  Fixed Asset lines (their cost is inherently LCY) — the sales/purchase modules enforce that. */
export async function resolveDocCurrency(
  code: string | null | undefined, date: IsoDate,
): Promise<{ code: string; factor: number }> {
  if (await isBaseCurrency(code)) return { code: await baseCurrencyCode(), factor: 1 };
  return { code: code!, factor: await currentExchangeFactor(code, date) };
}
