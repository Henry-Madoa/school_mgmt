import { getNetPayReport, getPayrollPeriod } from '@/lib/payroll';
import { buildWorkbookBuffer, excelExportResponse, type ExcelColumn } from '@/lib/excel';
import type { NetPayReportRow } from '@/lib/payroll';

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const periodId = Number(searchParams.get('period'));

  return excelExportResponse('PAYROLL_PERIODS_READ', async () => {
    const [period, rows] = await Promise.all([getPayrollPeriod(periodId), getNetPayReport(periodId)]);
    const columns: ExcelColumn<NetPayReportRow>[] = [
      { header: 'Employee No.', key: 'no', value: (r) => r.employeeNo },
      { header: 'Name', key: 'name', width: 28, value: (r) => r.name },
      { header: 'Gross Pay', key: 'gross', width: 14, value: (r) => r.grossPayCents / 100 },
      { header: 'Deductions', key: 'ded', width: 14, value: (r) => r.totalDeductionsCents / 100 },
      { header: 'Net Pay', key: 'net', width: 14, value: (r) => r.netPayCents / 100 },
    ];
    return { filename: `net-pay-${period?.period_name ?? periodId}.xlsx`, buffer: await buildWorkbookBuffer('Net Pay', columns, rows) };
  });
}
