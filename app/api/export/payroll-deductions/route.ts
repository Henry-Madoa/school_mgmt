import { getDeductionsReport, getPayrollPeriod, type DeductionsReportRow } from '@/lib/payroll';
import { buildWorkbookBuffer, excelExportResponse, type ExcelColumn } from '@/lib/excel';

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const periodId = Number(searchParams.get('period'));

  return excelExportResponse('PAYROLL_PERIODS_READ', async () => {
    const [period, rows] = await Promise.all([getPayrollPeriod(periodId), getDeductionsReport(periodId)]);
    const columns: ExcelColumn<DeductionsReportRow>[] = [
      { header: 'Employee No.', key: 'no', value: (r) => r.employeeNo },
      { header: 'Name', key: 'name', width: 28, value: (r) => r.name },
      { header: 'Deduction', key: 'code', width: 24, value: (r) => r.codeName },
      { header: 'Amount', key: 'amount', width: 14, value: (r) => r.amountCents / 100 },
    ];
    return { filename: `payroll-deductions-${period?.period_name ?? periodId}.xlsx`, buffer: await buildWorkbookBuffer('Deductions', columns, rows) };
  });
}
