import { listChangeLogEntries } from '@/lib/changeLog';
import { parseFilters } from '@/lib/listFilters';
import { parseSort } from '@/lib/listSort';
import { buildWorkbookBuffer, excelExportResponse, type ExcelColumn } from '@/lib/excel';
import { formatDateTime } from '@/lib/format';
import type { ChangeLogEntry } from '@/lib/types';

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') ?? '';
  const filters = parseFilters(searchParams.get('filters'));
  const sort = parseSort(searchParams.get('sort'));

  return excelExportResponse('ADMIN_CHANGE_LOG_MANAGE', async () => {
    const rows = await listChangeLogEntries({ search: q, filters, sort });
    const columns: ExcelColumn<ChangeLogEntry>[] = [
      { header: 'When', key: 'changed_at', value: (r) => formatDateTime(r.changed_at) },
      { header: 'User', key: 'username', value: (r) => r.username },
      { header: 'Table', key: 'table_caption', value: (r) => r.table_caption },
      { header: 'Record', key: 'record_id', value: (r) => r.record_id },
      { header: 'Field', key: 'field_name', value: (r) => r.field_name },
      { header: 'Old value', key: 'old_value', value: (r) => r.old_value },
      { header: 'New value', key: 'new_value', value: (r) => r.new_value },
      { header: 'Type', key: 'type', value: (r) => r.type },
    ];
    return { filename: 'change-log.xlsx', buffer: await buildWorkbookBuffer('Change Log', columns, rows) };
  });
}
