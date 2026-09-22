/**
 * Domain types.
 *
 * These mirror the PostgreSQL schema in prisma/schema.prisma one-for-one. Flag
 * columns are `0 | 1` integers rather than `boolean`, so that
 * `if (product.allow_withdrawal)` visibly tests a number.
 *
 * Every monetary field is an INTEGER count of minor units (cents). The `Cents`
 * alias exists to make that visible at each use site.
 */

export type Cents = number;
export type IsoDate = string;      // YYYY-MM-DD
export type IsoDateTime = string;  // ISO-8601 UTC
export type Flag = 0 | 1;

/*
 * The domain types live in lib/types/ by area (split from the one 7,600-line file); this barrel
 * re-exports every part so `import type { … } from '@/lib/types'` is still the only import anyone
 * writes. A part that needs a sibling's type imports it from here, type-only, which is a cycle
 * TypeScript resolves without a runtime edge.
 */
export * from './types/01-organisation.ts';
export * from './types/02-rbac.ts';
export * from './types/03-shared.ts';
export * from './types/16-imprest-petty-cash.ts';
export * from './types/17-requisitions.ts';
export * from './types/20-chart-of-accounts.ts';
export * from './types/21-financial-reports.ts';
export * from './types/24-journals.ts';
export * from './types/25-find-entries-navigate.ts';
export * from './types/26-bank-subledger.ts';
export * from './types/34-no-series.ts';
export * from './types/37-workflow.ts';
export * from './types/38-m-pesa.ts';
export * from './types/39-message-outbox.ts';
export * from './types/40-reports.ts';
export * from './types/41-media.ts';
export * from './types/42-action-results.ts';
export * from './types/43-job-queue.ts';
export * from './types/44-inventory.ts';
export * from './types/45-receipt.ts';
export * from './types/46-payment-voucher.ts';
export * from './types/47-print-slips.ts';
export * from './types/48-vat-withholding-tax.ts';
export * from './types/50-company-organogram.ts';
export * from './types/51-integration.ts';
export * from './types/52-companies.ts';
export * from './types/60-school.ts';
export * from './types/61-services.ts';
