import { Pill } from '@/components/ui/primitives';
import type { RequisitionView } from '@/lib/types';

/** One pill for the whole lifecycle — the AL shows Status, Posted, Received and PR Closed as four fields. */
export function RequisitionStatusPill({ r }: { r: Pick<RequisitionView, 'requisition_type' | 'pr_closed' | 'pr_closed_by' | 'status' | 'issued' | 'total_quantity_issued'> }) {
  if (r.requisition_type === 'Purchase Requisition' && r.pr_closed) return <Pill tone={r.pr_closed_by === 'Rejection' ? 'bad' : 'ok'}>Closed · {r.pr_closed_by}</Pill>;
  if (r.status === 'Received') return <Pill tone="ok">Received</Pill>;
  if (r.issued) return <Pill tone="ok">Issued</Pill>;
  if (r.status === 'Approved' && r.total_quantity_issued > 0) return <Pill tone="info">Part-issued</Pill>;
  return <Pill status={r.status} />;
}
