/* companies — split out of lib/types.ts; import from '@/lib/types', never from here directly. */
import type { IsoDateTime } from '../types.ts';

/* ------------------------------------------------------------ companies */

/** A company — its own schema of business data; the default company is the live data in public. */
export interface Company {
  id: number;
  code: string;
  schema_name: string;
  display_name: string;
  is_default: boolean;
  copied_from: string | null;
  created_at: IsoDateTime;
  created_by: string | null;
}
