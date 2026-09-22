import { getTrialBalance } from '@/lib/gl';
import { parseFilters } from '@/lib/listFilters';
import { buildWorkbookBuffer, excelExportResponse, type ExcelColumn } from '@/lib/excel';
import type { TrialBalanceRow } from '@/lib/types';

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const asOf = searchParams.get('asOf') || null;
  const from = searchParams.get('from') || null;
  const filters = parseFilters(searchParams.get('filters'));

  return excelExportResponse('GL_READ', async () => {
    const { rows } = await getTrialBalance({ from, asOf, filters });
    const columns: ExcelColumn<TrialBalanceRow>[] = [
      { header: 'Code', key: 'code', value: (r) => r.code },
      { header: 'Account', key: 'name', value: (r) => r.name },
      { header: 'Type', key: 'type', value: (r) => r.type },
      { header: 'Debits', key: 'debit', width: 14, value: (r) => r.debit / 100 },
      { header: 'Credits', key: 'credit', width: 14, value: (r) => r.credit / 100 },
      { header: 'Debit balance', key: 'debit_balance', width: 14, value: (r) => r.debit_balance / 100 },
      { header: 'Credit balance', key: 'credit_balance', width: 14, value: (r) => r.credit_balance / 100 },
    ];
    return { filename: 'trial-balance.xlsx', buffer: await buildWorkbookBuffer('Trial Balance', columns, rows) };
  });
}
