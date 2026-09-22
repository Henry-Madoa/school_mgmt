import { requireUser } from '@/lib/session';
import {
  listMyWorkflowTasks, listMyDecidedWorkflowTasks, listMySubmittedWorkflowTasks,
} from '@/lib/workflow';
import { parseFilters } from '@/lib/listFilters';
import { parseSort } from '@/lib/listSort';
import { buildWorkbookBuffer, excelExportResponse, type ExcelColumn } from '@/lib/excel';
import { formatDateTime, humanise } from '@/lib/format';
import type { WorkflowTaskRow } from '@/lib/types';

const TABS = ['open', 'history', 'sent'] as const;
type ApprovalsTab = (typeof TABS)[number];

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') ?? '';
  const tabParam = searchParams.get('tab');
  const tab: ApprovalsTab = (TABS as readonly string[]).includes(tabParam ?? '') ? (tabParam as ApprovalsTab) : 'open';
  const filters = parseFilters(searchParams.get('filters'));
  const sort = parseSort(searchParams.get('sort'));

  return excelExportResponse('APPROVALS_VIEW', async () => {
    const user = await requireUser();
    const options = { search: q, filters, sort };
    const rows = tab === 'history'
      ? await listMyDecidedWorkflowTasks(user.username, options)
      : tab === 'sent'
        ? await listMySubmittedWorkflowTasks(user.username, options)
        : await listMyWorkflowTasks(user.id, user.username, options);

    const columns: ExcelColumn<WorkflowTaskRow>[] = [
      { header: 'Document', key: 'document', value: (r) => r.document_label },
      { header: 'Workflow', key: 'workflow', value: (r) => r.workflow_name || '' },
      { header: 'Amount', key: 'amount', value: (r) => r.amount / 100 },
      { header: 'Requested by', key: 'requested_by', value: (r) => r.requested_by },
      { header: 'Requested', key: 'requested_at', value: (r) => formatDateTime(r.requested_at) },
      { header: 'Status', key: 'status', value: (r) => humanise(r.status) },
      { header: 'Decided by', key: 'decided_by', value: (r) => r.decided_by || '' },
      { header: 'Decided', key: 'decided_at', value: (r) => (r.decided_at ? formatDateTime(r.decided_at) : '') },
      { header: 'Comment', key: 'comment', value: (r) => r.comment || '' },
    ];
    return {
      filename: `approvals-${tab}.xlsx`,
      buffer: await buildWorkbookBuffer(`Approvals - ${humanise(tab)}`, columns, rows),
    };
  });
}
