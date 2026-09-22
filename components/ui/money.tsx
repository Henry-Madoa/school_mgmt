'use client';

import { useFormat } from './format-provider';
import type { Cents } from '@/lib/types';

export interface MoneyProps {
  cents: Cents | null | undefined;
  /** Fraction digits. 0 for the compact table columns. */
  decimals?: number;
  /** false inside statement columns, where the currency is stated in the heading. */
  symbol?: boolean;
  /** "KSh 1.2M" instead of the full figure. */
  short?: boolean;
}

/** A monetary amount in the society's currency. */
export function Money({ cents, decimals = 2, symbol = true, short = false }: MoneyProps) {
  const { cur, curShort } = useFormat();
  return <>{short ? curShort(cents) : cur(cents, { decimals, showSymbol: symbol })}</>;
}

/** Money coloured by sign — credits read green, debits red. */
export function SignedMoney({ cents, decimals = 2 }: Pick<MoneyProps, 'cents' | 'decimals'>) {
  return (
    <span className={(cents ?? 0) < 0 ? 'neg' : 'pos'}>
      <Money cents={cents} decimals={decimals} />
    </span>
  );
}
