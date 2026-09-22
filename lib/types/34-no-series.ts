/* No. Series — split out of lib/types.ts; import from '@/lib/types', never from here directly. */
import type { IsoDateTime } from '../types.ts';

/* --------------------------------------------------------------- No. Series */

export interface NoSeries {
  code: string;
  description: string;
  default_nos: number;
  manual_nos: number;
  date_order: number;
}

export interface NoSeriesLine {
  id: number;
  series_code: string;
  line_no: number;
  starting_date: string | null;
  starting_no: string;
  ending_no: string | null;
  last_no_used: string | null;
  last_date_used: string | null;
  warning_no: string | null;
  increment_by_no: number;
  open: number;
  allow_gaps: number;
}

export interface NoSeriesWithLines extends NoSeries {
  lines: NoSeriesLine[];
}

export interface NoSeriesListRow extends NoSeries {
  line_count: number;
  /** The current (latest) line's key figures, rolled up for the list. */
  starting_no: string | null;
  ending_no: string | null;
  last_no_used: string | null;
  last_date_used: string | null;
  increment_by_no: number | null;
  starting_date: string | null;
  /** How many documents point at this series. */
  used_by: number;
  /** What GetNextNo would hand out today (null if the series can't currently issue). */
  next_no: string | null;
}

export interface DocumentNoSeriesRow {
  document_code: string;
  label: string;
  category: string;
  sort: number;
  series_code: string | null;
  series_description: string | null;
  last_no_used: string | null;
  next_no: string | null;
  manual_nos: number;
}
