import { vatInputListing } from '@/lib/vatReports';
import { buildWorkbookBuffer, excelExportResponse, type ExcelColumn } from '@/lib/excel';
import type { VatInputListingRow } from '@/lib/types';

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from') ?? '2000-01-01';
  const to = searchParams.get('to') ?? '2999-12-31';
  return excelExportResponse('VAT_REPORT_READ', async () => {
    const rows = await vatInputListing({ from, to });
    const columns: ExcelColumn<VatInputListingRow>[] = [
      { header: 'VAT Code', key: 'vat_prod_posting_group_code', value: (r) => r.vat_prod_posting_group_code },
      { header: 'Description', key: 'description', width: 30, value: (r) => r.description ?? '' },
      { header: 'Rate %', key: 'vat_pct', value: (r) => r.vat_pct },
      { header: 'Base', key: 'base', value: (r) => Number(r.base) / 100 },
      { header: 'Input VAT', key: 'amount', value: (r) => Number(r.amount) / 100 },
      { header: 'Entries', key: 'entry_count', value: (r) => Number(r.entry_count) },
    ];
    return { filename: `vat-input-listing-${from}_${to}.xlsx`, buffer: await buildWorkbookBuffer('VAT Input', columns, rows) };
  });
}
