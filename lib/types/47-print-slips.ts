/* print slips — split out of lib/types.ts; import from '@/lib/types', never from here directly. */

/* ----------------------------------------------------------------- print slips */

/** A resolved signature for a printout — see lib/userSignatures.ts. */
export interface SignatureBlock {
  username: string;
  full_name: string | null;
  src: string | null;
}
