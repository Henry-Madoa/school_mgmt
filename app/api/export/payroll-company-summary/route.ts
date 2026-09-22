import { getCompanySummary } from '@/lib/payroll';
import { buildWorkbookBuffer, excelExportResponse, type ExcelColumn } from '@/lib/excel';

interface SummaryRow { label: string; amount: number | string }

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const periodId = Number(searchParams.get('period'));

  return excelExportResponse('PAYROLL_PERIODS_READ', async () => {
    const s = await getCompanySummary(periodId);
    const rows: SummaryRow[] = [
      { label: 'Employees', amount: s.employeeCount },
      { label: 'Gross Pay', amount: s.grossPayCents / 100 },
      { label: 'Taxable Pay', amount: s.taxablePayCents / 100 },
      { label: 'PAYE', amount: s.payeCents / 100 },
      { label: 'NSSF (Employee)', amount: s.nssfEmployeeCents / 100 },
      { label: 'NSSF (Employer)', amount: s.nssfEmployerCents / 100 },
      { label: 'SHIF', amount: s.shifCents / 100 },
      { label: 'Housing Levy (Employee)', amount: s.housingLevyEmployeeCents / 100 },
      { label: 'Housing Levy (Employer)', amount: s.housingLevyEmployerCents / 100 },
      { label: 'Other Deductions', amount: s.deductionsCents / 100 },
      { label: 'Net Pay', amount: s.netPayCents / 100 },
    ];
    const columns: ExcelColumn<SummaryRow>[] = [
      { header: 'Item', key: 'label', width: 28, value: (r) => r.label },
      { header: 'Amount', key: 'amount', width: 16, value: (r) => r.amount },
    ];
    return { filename: `company-summary-${s.period.period_name}.xlsx`, buffer: await buildWorkbookBuffer('Company Summary', columns, rows) };
  });
}
