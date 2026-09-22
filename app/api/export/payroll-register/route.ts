import { getPayrollRegister, getPayrollPeriod, type PayrollRegisterRow } from '@/lib/payroll';
import { buildWorkbookBuffer, excelExportResponse, type ExcelColumn } from '@/lib/excel';

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const periodId = Number(searchParams.get('period'));

  return excelExportResponse('PAYROLL_PERIODS_READ', async () => {
    const [period, rows] = await Promise.all([getPayrollPeriod(periodId), getPayrollRegister(periodId)]);
    const columns: ExcelColumn<PayrollRegisterRow>[] = [
      { header: 'Employee No.', key: 'no', value: (r) => r.employeeNo },
      { header: 'Name', key: 'name', width: 28, value: (r) => r.name },
      { header: 'Basic', key: 'basic', width: 14, value: (r) => r.basicCents / 100 },
      { header: 'Allowances', key: 'allow', width: 14, value: (r) => r.allowancesCents / 100 },
      { header: 'Gross', key: 'gross', width: 14, value: (r) => r.grossCents / 100 },
      { header: 'Taxable', key: 'taxable', width: 14, value: (r) => r.taxableCents / 100 },
      { header: 'PAYE', key: 'paye', width: 14, value: (r) => r.payeCents / 100 },
      { header: 'NSSF', key: 'nssf', width: 14, value: (r) => r.nssfCents / 100 },
      { header: 'SHIF', key: 'shif', width: 14, value: (r) => r.shifCents / 100 },
      { header: 'Housing Levy', key: 'hlevy', width: 14, value: (r) => r.housingLevyCents / 100 },
      { header: 'Deductions', key: 'ded', width: 14, value: (r) => r.deductionsCents / 100 },
      { header: 'Net Pay', key: 'net', width: 14, value: (r) => r.netCents / 100 },
    ];
    return { filename: `payroll-register-${period?.period_name ?? periodId}.xlsx`, buffer: await buildWorkbookBuffer('Payroll Register', columns, rows) };
  });
}
