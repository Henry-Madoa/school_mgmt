/* shared vocabulary — split out of lib/types.ts; import from '@/lib/types', never from here directly. */

/** The approval lifecycle every workflow-driven document walks: Open -> Pending Approval -> Approved -> Processed. */
export type DocumentStatus =
  | 'Open' | 'Pending Approval' | 'Approved' | 'Processed';

/** Bank/cashbook account roles — 'MAIN' (the school's external bank), 'TREASURY' (the safe), 'TILL'
 *  (the cash office drawer), 'PETTY_CASH' (a float), or 'OTHER' (M-Pesa clearing and the like). */
export type BankAccountType = 'MAIN' | 'TREASURY' | 'TILL' | 'PETTY_CASH' | 'OTHER';

/** The channel a receipt or payment arrived through. */
export type Channel = 'CASH_OFFICE' | 'MPESA' | 'BANK' | 'SYSTEM';

/** How a payment was actually made, alongside which bank_account received or paid it. */
export type PayMode = 'CASH' | 'MPESA' | 'BANK' | 'EFT' | 'CHEQUE';
