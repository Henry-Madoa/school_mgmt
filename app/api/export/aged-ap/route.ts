import { getAgedAccountsPayable } from '@/lib/payablesReports';
import { parseFilters } from '@/lib/listFilters';
import { buildWorkbookBuffer, excelExportResponse, type ExcelColumn } from '@/lib/excel';
import type { AgedPayableRow } from '@/lib/types';

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const asOf = searchParams.get('asOf') ?? undefined;
  const filters = parseFilters(searchParams.get('filters'));

  return excelExportResponse('PAYABLES_READ', async () => {
    const report = await getAgedAccountsPayable({ asOf, filters });
    const [b0, b1, b2, b3, b4] = report.bucket_labels;
    const columns: ExcelColumn<AgedPayableRow>[] = [
      { header: 'Vendor No.', key: 'vendor_no', value: (r) => r.vendor_no },
      { header: 'Name', key: 'vendor_name', width: 32, value: (r) => r.vendor_name },
      { header: 'Balance', key: 'balance', value: (r) => r.balance / 100 },
      { header: b0, key: 'not_due', value: (r) => r.not_due / 100 },
      { header: b1, key: 'bucket_1', value: (r) => r.bucket_1 / 100 },
      { header: b2, key: 'bucket_2', value: (r) => r.bucket_2 / 100 },
      { header: b3, key: 'bucket_3', value: (r) => r.bucket_3 / 100 },
      { header: b4, key: 'bucket_over', value: (r) => r.bucket_over / 100 },
    ];
    return {
      filename: `aged-accounts-payable-${report.as_of}.xlsx`,
      buffer: await buildWorkbookBuffer('Aged AP', columns, report.rows),
    };
  });
}
