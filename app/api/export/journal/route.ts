import { listJournals } from '@/lib/gl';
import { getDimensionCaptions } from '@/lib/org';
import { parseFilters } from '@/lib/listFilters';
import { parseSort } from '@/lib/listSort';
import { buildWorkbookBuffer, excelExportResponse, type ExcelColumn } from '@/lib/excel';
import { formatDate } from '@/lib/format';
import type { JournalListRow } from '@/lib/types';

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') ?? '';
  const filters = parseFilters(searchParams.get('filters'));
  const sort = parseSort(searchParams.get('sort'));

  return excelExportResponse('GL_READ', async () => {
    const [rows, { caption1, caption2 }] = await Promise.all([
      listJournals({ search: q, filters, sort }), getDimensionCaptions(),
    ]);
    const columns: ExcelColumn<JournalListRow>[] = [
      { header: 'Journal', key: 'journal_no', value: (r) => r.journal_no },
      { header: 'Value date', key: 'value_date', value: (r) => formatDate(r.value_date) },
      { header: 'Source', key: 'source_module', value: (r) => r.source_module },
      { header: 'Event', key: 'event_type', value: (r) => r.event_type },
      { header: 'Description', key: 'description', value: (r) => r.description },
      { header: caption1, key: 'gd1', value: (r) => r.global_dimension_1_code },
      { header: caption2, key: 'gd2', value: (r) => r.global_dimension_2_code },
      { header: 'Amount', key: 'amount', width: 14, value: (r) => r.amount / 100 },
      { header: 'Posted by', key: 'posted_by', value: (r) => r.posted_by },
      { header: 'Reversed', key: 'reversed', value: (r) => (r.reversed_by_id ? 'Yes' : r.reverses_id ? 'Reversal' : '') },
    ];
    return { filename: 'journal.xlsx', buffer: await buildWorkbookBuffer('Journal', columns, rows) };
  });
}
