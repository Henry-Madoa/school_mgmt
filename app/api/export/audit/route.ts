import { listAuditLog } from '@/lib/admin';
import { parseFilters } from '@/lib/listFilters';
import { parseSort } from '@/lib/listSort';
import { buildWorkbookBuffer, excelExportResponse, type ExcelColumn } from '@/lib/excel';
import { formatDateTime } from '@/lib/format';
import type { AuditEntry } from '@/lib/types';

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') ?? '';
  const filters = parseFilters(searchParams.get('filters'));
  const sort = parseSort(searchParams.get('sort'));

  return excelExportResponse('ADMIN_AUDIT_VIEW', async () => {
    const rows = await listAuditLog({ search: q, filters, sort, limit: 5000 });
    const columns: ExcelColumn<AuditEntry>[] = [
      { header: 'When', key: 'at', value: (r) => formatDateTime(r.at) },
      { header: 'User', key: 'username', value: (r) => r.username ?? 'system' },
      { header: 'Action', key: 'action', value: (r) => r.action },
      { header: 'Entity', key: 'entity', value: (r) => r.entity },
      { header: 'Entity id', key: 'entity_id', value: (r) => r.entity_id },
      { header: 'Detail', key: 'detail', width: 40, value: (r) => r.detail },
    ];
    return { filename: 'audit-trail.xlsx', buffer: await buildWorkbookBuffer('Audit Trail', columns, rows) };
  });
}
