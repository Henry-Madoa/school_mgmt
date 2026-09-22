/* find entries / navigate — split out of lib/types.ts; import from '@/lib/types', never from here directly. */
import type { Cents } from '../types.ts';

/* ------------------------------------------------- find entries / navigate */

/** One row in a Find Entries / Navigate bucket — every source document type links through
 *  its own posted-document page, so the href is resolved server-side per bucket rather than
 *  the client guessing a route pattern per module. */
export interface JournalRelatedEntry {
  label: string;
  amount: Cents;
  href: string;
}

/** One bucket of the Navigate summary (Business Central's "Navigate" action) — a count plus
 *  the entries themselves, for a document/table related to the journal being inspected. */
export interface JournalRelatedBucket {
  entries: JournalRelatedEntry[];
}

export interface JournalRelatedEntries {
  glLineCount: number;
  customer: JournalRelatedBucket; // cust_ledger_entry rows for this journal
  vendor: JournalRelatedBucket;   // vendor_ledger_entry rows for this journal
  bank: JournalRelatedBucket;
}
