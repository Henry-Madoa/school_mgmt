import { getAgedAccountsReceivable } from '@/lib/receivablesReports';
import { parseFilters } from '@/lib/listFilters';
import { buildWorkbookBuffer, excelExportResponse, type ExcelColumn } from '@/lib/excel';
import type { AgedReceivableRow } from '@/lib/types';

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const asOf = searchParams.get('asOf') ?? undefined;
  const filters = parseFilters(searchParams.get('filters'));

  return excelExportResponse('RECEIVABLES_READ', async () => {
    const report = await getAgedAccountsReceivable({ asOf, filters });
    const [b0, b1, b2, b3, b4] = report.bucket_labels;
    const columns: ExcelColumn<AgedReceivableRow>[] = [
      { header: 'Customer No.', key: 'customer_no', value: (r) => r.customer_no },
      { header: 'Name', key: 'customer_name', width: 32, value: (r) => r.customer_name },
      { header: 'Balance', key: 'balance', value: (r) => r.balance / 100 },
      { header: b0, key: 'not_due', value: (r) => r.not_due / 100 },
      { header: b1, key: 'bucket_1', value: (r) => r.bucket_1 / 100 },
      { header: b2, key: 'bucket_2', value: (r) => r.bucket_2 / 100 },
      { header: b3, key: 'bucket_3', value: (r) => r.bucket_3 / 100 },
      { header: b4, key: 'bucket_over', value: (r) => r.bucket_over / 100 },
    ];
    return {
      filename: `aged-accounts-receivable-${report.as_of}.xlsx`,
      buffer: await buildWorkbookBuffer('Aged AR', columns, report.rows),
    };
  });
}
