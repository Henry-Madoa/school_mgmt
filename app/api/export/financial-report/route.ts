import { runFinancialReport } from '@/lib/financialReports';
import { parseFilters } from '@/lib/listFilters';
import { buildWorkbookBuffer, excelExportResponse, type ExcelColumn } from '@/lib/excel';
import type { FinReportRow } from '@/lib/types';

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const report = searchParams.get('report') || '';
  const columnGroup = searchParams.get('columnGroup') || undefined;
  const from = searchParams.get('from') || null;
  const to = searchParams.get('to') || null;
  const filters = parseFilters(searchParams.get('filters'));

  return excelExportResponse('FINANCIAL_REPORTS_READ', async () => {
    const result = await runFinancialReport({ reportName: report, columnGroup, from, to, filters });
    const rows = result.rows.filter((r) => !r.hidden);

    const columns: ExcelColumn<FinReportRow>[] = [
      { header: 'Row', key: 'row', width: 44, value: (r) => `${'    '.repeat(r.indentation)}${r.description}` },
      ...result.columns.map((c, i): ExcelColumn<FinReportRow> => ({
        header: c.header,
        key: `c${i}`,
        width: 18,
        value: (r) => {
          const cell = r.cells[i];
          if (!cell || cell.value == null) return null;
          return cell.isRatio ? Number(cell.value.toFixed(2)) : Math.round(cell.value) / 100;
        },
      })),
    ];
    return {
      filename: `${report || 'financial-report'}.xlsx`,
      buffer: await buildWorkbookBuffer(report || 'Financial Report', columns, rows),
    };
  });
}
