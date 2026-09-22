import { getIncomeStatement } from '@/lib/reports';
import { startOfYear, today } from '@/lib/format';
import { parseFilters } from '@/lib/listFilters';
import { buildWorkbookBuffer, excelExportResponse, type ExcelColumn } from '@/lib/excel';
import type { Cents } from '@/lib/types';

interface Row { section: string; code: string; name: string; amount: Cents }

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from') || startOfYear();
  const to = searchParams.get('to') || today();
  const filters = parseFilters(searchParams.get('filters'));

  return excelExportResponse('REPORTS_VIEW', async () => {
    const d = await getIncomeStatement({ from, to, filters });
    const rows: Row[] = [
      ...d.income.map((r): Row => ({ section: 'Income', code: r.code, name: r.name, amount: r.amount })),
      { section: 'Income', code: '', name: 'Total income', amount: d.totalIncome },
      ...d.expense.map((r): Row => ({ section: 'Expenditure', code: r.code, name: r.name, amount: r.amount })),
      { section: 'Expenditure', code: '', name: 'Total expenditure', amount: d.totalExpense },
      { section: 'Total', code: '', name: 'Surplus for the period', amount: d.surplus },
    ];
    const columns: ExcelColumn<Row>[] = [
      { header: 'Section', key: 'section', width: 16, value: (r) => r.section },
      { header: 'Code', key: 'code', value: (r) => r.code },
      { header: 'Account', key: 'name', width: 32, value: (r) => r.name },
      { header: 'Amount', key: 'amount', width: 16, value: (r) => r.amount / 100 },
    ];
    return {
      filename: 'statement-of-comprehensive-income.xlsx',
      buffer: await buildWorkbookBuffer('Comprehensive Income', columns, rows),
    };
  });
}
