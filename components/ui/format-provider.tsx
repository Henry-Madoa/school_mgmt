'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  DEFAULT_FORMAT, formatMoney, formatMoneyShort, formatDate, formatDateTime, formatMonth,
  type FormatConfig, type MoneyOptions,
} from '@/lib/format';
import type { Cents, OrgBrand } from '@/lib/types';

const FormatContext = createContext<FormatConfig>(DEFAULT_FORMAT);

/**
 * Carries the society's currency symbol and number locale down the tree so a
 * figure formats identically on the server and after hydration. The old client
 * read these off a mutable global, which meant the first paint could use the
 * fallback symbol and then flip.
 */
export function FormatProvider({ org, children }: { org: OrgBrand | null; children: ReactNode }) {
  const value = useMemo<FormatConfig>(
    () => ({
      symbol: org?.currency_symbol || DEFAULT_FORMAT.symbol,
      locale: org?.locale || DEFAULT_FORMAT.locale,
      code: org?.currency_code || DEFAULT_FORMAT.code,
    }),
    [org?.currency_symbol, org?.locale, org?.currency_code],
  );
  return <FormatContext.Provider value={value}>{children}</FormatContext.Provider>;
}

export interface Formatter extends FormatConfig {
  cur: (cents: Cents | null | undefined, opts?: MoneyOptions) => string;
  curShort: (cents: Cents | null | undefined) => string;
  fdate: typeof formatDate;
  fdatetime: typeof formatDateTime;
  fmonth: typeof formatMonth;
}

export function useFormat(): Formatter {
  const ctx = useContext(FormatContext);
  return useMemo(
    () => ({
      ...ctx,
      cur: (cents, opts) => formatMoney(cents, { ...ctx, ...opts }),
      curShort: (cents) => formatMoneyShort(cents, ctx),
      fdate: formatDate,
      fdatetime: formatDateTime,
      fmonth: formatMonth,
    }),
    [ctx],
  );
}
