import { getFaBookValueReport } from '@/lib/fixedAssetReports';
import { parseFilters } from '@/lib/listFilters';
import { buildWorkbookBuffer, excelExportResponse, type ExcelColumn } from '@/lib/excel';
import type { FaBookValueRow } from '@/lib/types';

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const book = searchParams.get('book') ?? undefined;
  const asOf = searchParams.get('asOf') ?? undefined;
  const filters = parseFilters(searchParams.get('filters'));

  return excelExportResponse('FIXED_ASSETS_READ', async () => {
    const report = await getFaBookValueReport({ bookCode: book, asOf, filters });
    const columns: ExcelColumn<FaBookValueRow>[] = [
      { header: 'Asset No.', key: 'fixed_asset_no', value: (r) => r.fixed_asset_no },
      { header: 'Description', key: 'fixed_asset_description', width: 32, value: (r) => r.fixed_asset_description },
      { header: 'Class', key: 'fa_class_code', value: (r) => r.fa_class_code ?? '' },
      { header: 'Acquisition Cost', key: 'acquisition_cost', value: (r) => r.acquisition_cost / 100 },
      { header: 'Depreciation', key: 'depreciation', value: (r) => r.depreciation / 100 },
      { header: 'Write-Down', key: 'write_down', value: (r) => r.write_down / 100 },
      { header: 'Appreciation', key: 'appreciation', value: (r) => r.appreciation / 100 },
      { header: 'Book Value', key: 'book_value', value: (r) => r.book_value / 100 },
      { header: 'Disposed', key: 'disposed', value: (r) => (r.disposed ? 'Yes' : 'No') },
    ];
    return {
      filename: `fa-book-value-${report.book_code}-${report.as_of}.xlsx`,
      buffer: await buildWorkbookBuffer('FA Book Value', columns, report.rows),
    };
  });
}
