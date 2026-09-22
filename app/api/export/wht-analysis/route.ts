import { whtAnalysis } from '@/lib/vatReports';
import { buildWorkbookBuffer, excelExportResponse, type ExcelColumn } from '@/lib/excel';
import type { WhtAnalysisRow } from '@/lib/types';

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from') ?? '2000-01-01';
  const to = searchParams.get('to') ?? '2999-12-31';
  const vendorNo = searchParams.get('vendorNo') ?? undefined;
  return excelExportResponse('VAT_REPORT_READ', async () => {
    const rows = await whtAnalysis({ from, to, vendorNo });
    const columns: ExcelColumn<WhtAnalysisRow>[] = [
      { header: 'Vendor No.', key: 'bill_to_pay_to_no', value: (r) => r.bill_to_pay_to_no ?? '' },
      { header: 'Name', key: 'vendor_name', width: 30, value: (r) => r.vendor_name ?? '' },
      { header: 'PIN', key: 'vendor_pin', value: (r) => r.vendor_pin ?? '' },
      { header: 'WHT Code', key: 'wht_code', value: (r) => r.wht_code ?? '' },
      { header: 'Rate %', key: 'rate', value: (r) => r.rate },
      { header: 'Base', key: 'base', value: (r) => Number(r.base) / 100 },
      { header: 'Tax Withheld', key: 'amount', value: (r) => Number(r.amount) / 100 },
    ];
    return { filename: `wht-analysis-${from}_${to}.xlsx`, buffer: await buildWorkbookBuffer('WHT Analysis', columns, rows) };
  });
}
