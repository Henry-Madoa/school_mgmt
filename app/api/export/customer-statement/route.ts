import { getCustomerStatement } from '@/lib/receivablesReports';
import { buildWorkbookBuffer, excelExportResponse, type ExcelColumn } from '@/lib/excel';
import type { CustomerStatementLine } from '@/lib/types';

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const customerNo = searchParams.get('customer') ?? '';
  const from = searchParams.get('from') ?? undefined;
  const to = searchParams.get('to') ?? undefined;

  return excelExportResponse('RECEIVABLES_READ', async () => {
    const report = await getCustomerStatement({ customerNo, from, to });
    const columns: ExcelColumn<CustomerStatementLine>[] = [
      { header: 'Date', key: 'posting_date', value: (r) => r.posting_date },
      { header: 'Type', key: 'document_type', value: (r) => r.document_type },
      { header: 'Document', key: 'document_no', value: (r) => r.document_no },
      { header: 'Description', key: 'description', width: 32, value: (r) => r.description ?? '' },
      { header: 'Due Date', key: 'due_date', value: (r) => r.due_date ?? '' },
      { header: 'Amount', key: 'amount', value: (r) => r.amount / 100 },
      { header: 'Remaining', key: 'remaining_amount', value: (r) => r.remaining_amount / 100 },
      { header: 'Balance', key: 'running_balance', value: (r) => r.running_balance / 100 },
    ];
    return {
      filename: `statement-${report.customer_no}-${report.from}-${report.to}.xlsx`,
      buffer: await buildWorkbookBuffer('Statement', columns, report.lines),
    };
  });
}
