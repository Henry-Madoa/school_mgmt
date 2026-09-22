import {
  getPayrollPeriod, getNssfReport, getShifReport, getPayeReport, getHousingLevyReport, type StatutoryReportRow,
} from '@/lib/payroll';
import { buildWorkbookBuffer, excelExportResponse, type ExcelColumn } from '@/lib/excel';

const LOADERS: Record<string, { label: string; load: (periodId: number) => Promise<StatutoryReportRow[]> }> = {
  nssf: { label: 'NSSF', load: getNssfReport },
  shif: { label: 'SHIF', load: getShifReport },
  paye: { label: 'PAYE', load: getPayeReport },
  'housing-levy': { label: 'Housing Levy', load: getHousingLevyReport },
};

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const periodId = Number(searchParams.get('period'));
  const kind = searchParams.get('kind') || 'nssf';
  const entry = LOADERS[kind] ?? LOADERS.nssf;

  return excelExportResponse('PAYROLL_PERIODS_READ', async () => {
    const [period, rows] = await Promise.all([getPayrollPeriod(periodId), entry.load(periodId)]);
    const columns: ExcelColumn<StatutoryReportRow>[] = [
      { header: 'Employee No.', key: 'no', value: (r) => r.employeeNo },
      { header: 'Name', key: 'name', width: 28, value: (r) => r.name },
      { header: 'Amount', key: 'amount', width: 14, value: (r) => r.amountCents / 100 },
    ];
    return { filename: `${kind}-${period?.period_name ?? periodId}.xlsx`, buffer: await buildWorkbookBuffer(entry.label, columns, rows) };
  });
}
