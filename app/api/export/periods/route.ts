import { listPeriods } from '@/lib/gl';
import { parseFilters } from '@/lib/listFilters';
import { parseSort } from '@/lib/listSort';
import { buildWorkbookBuffer, excelExportResponse, type ExcelColumn } from '@/lib/excel';
import { formatDate } from '@/lib/format';
import type { AccountingPeriod } from '@/lib/types';

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') ?? '';
  const filters = parseFilters(searchParams.get('filters'));
  const sort = parseSort(searchParams.get('sort'));

  return excelExportResponse('GL_READ', async () => {
    const rows = await listPeriods({ search: q, filters, sort });
    const columns: ExcelColumn<AccountingPeriod>[] = [
      { header: 'Period', key: 'code', value: (r) => r.code },
      { header: 'From', key: 'start_date', value: (r) => formatDate(r.start_date) },
      { header: 'To', key: 'end_date', value: (r) => formatDate(r.end_date) },
      { header: 'Status', key: 'status', value: (r) => r.status },
    ];
    return { filename: 'accounting-periods.xlsx', buffer: await buildWorkbookBuffer('Accounting Periods', columns, rows) };
  });
}
