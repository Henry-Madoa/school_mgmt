import { getBalanceSheet } from '@/lib/reports';
import { parseFilters } from '@/lib/listFilters';
import { buildWorkbookBuffer, excelExportResponse, type ExcelColumn } from '@/lib/excel';
import type { Cents } from '@/lib/types';

interface Row { section: string; code: string; name: string; amount: Cents }

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const asOf = searchParams.get('asOf') || null;
  const from = searchParams.get('from') || null;
  const filters = parseFilters(searchParams.get('filters'));

  return excelExportResponse('REPORTS_VIEW', async () => {
    const d = await getBalanceSheet({ from, asOf, filters });
    const rows: Row[] = [
      ...d.assets.map((r): Row => ({ section: 'Assets', code: r.code, name: r.name, amount: r.amount })),
      ...d.liabilities.map((r): Row => ({ section: 'Liabilities', code: r.code, name: r.name, amount: r.amount })),
      ...d.equity.map((r): Row => ({ section: 'Capital and reserves', code: r.code, name: r.name, amount: r.amount })),
      { section: 'Surplus for the period', code: '', name: '', amount: d.surplus },
      { section: 'Total', code: '', name: 'Total equity and liabilities', amount: d.totals.equityAndLiabilities },
    ];
    const columns: ExcelColumn<Row>[] = [
      { header: 'Section', key: 'section', width: 22, value: (r) => r.section },
      { header: 'Code', key: 'code', value: (r) => r.code },
      { header: 'Account', key: 'name', width: 32, value: (r) => r.name },
      { header: 'Amount', key: 'amount', width: 16, value: (r) => r.amount / 100 },
    ];
    return {
      filename: 'statement-of-financial-position.xlsx',
      buffer: await buildWorkbookBuffer('Financial Position', columns, rows),
    };
  });
}
