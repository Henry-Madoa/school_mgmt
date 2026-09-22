import { listGlAccounts, getTrialBalance, totalingBalance } from '@/lib/gl';
import { GL_ACCOUNT_STRUCTURE_TYPES } from '@/lib/constants';
import { parseFilters } from '@/lib/listFilters';
import { parseSort } from '@/lib/listSort';
import { buildWorkbookBuffer, excelExportResponse, type ExcelColumn } from '@/lib/excel';
import type { GlAccount } from '@/lib/types';

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') ?? '';
  const filters = parseFilters(searchParams.get('filters'));
  const sort = parseSort(searchParams.get('sort'));
  const asOf = searchParams.get('asOf') || null;
  const from = searchParams.get('from') || null;

  return excelExportResponse('GL_READ', async () => {
    const [rows, { rows: tbRows }] = await Promise.all([
      listGlAccounts({ search: q, filters, sort }),
      getTrialBalance({ from, asOf, filters }),
    ]);
    const balanceByCode = new Map(tbRows.map((r) => [r.code, r.net]));
    const structureLabel = (t: string): string => GL_ACCOUNT_STRUCTURE_TYPES.find((s) => s.value === t)?.label ?? t;
    const balanceOf = (r: GlAccount): number | null => (
      r.account_type === 'POSTING' ? balanceByCode.get(r.code) ?? 0
        : (r.account_type === 'TOTAL' || r.account_type === 'END_TOTAL') ? totalingBalance(rows, balanceByCode, r.totaling)
          : null
    );
    const columns: ExcelColumn<GlAccount>[] = [
      { header: 'Code', key: 'code', value: (r) => r.code },
      { header: 'Account', key: 'name', value: (r) => r.name },
      { header: 'Type', key: 'type', value: (r) => r.type },
      { header: 'Account Type', key: 'account_type', value: (r) => structureLabel(r.account_type) },
      { header: 'Parent', key: 'parent_code', value: (r) => r.parent_code },
      { header: 'Status', key: 'status', value: (r) => r.status },
      { header: 'Balance', key: 'balance', width: 14, value: (r) => { const b = balanceOf(r); return b === null ? null : b / 100; } },
    ];
    return { filename: 'chart-of-accounts.xlsx', buffer: await buildWorkbookBuffer('Chart of Accounts', columns, rows) };
  });
}
