/*
 * GET /api/export/gl-budget?name=&from=&to=&viewBy=&scope=&accountFilter=&dim1=&dim2=
 * Export Budget to Excel (BC Report 82): a title block, then one row per G/L account and one
 * column per period, headed by the period's first day — the exact layout Import Budget from
 * Excel reads back, so a budget can be taken away, worked on and returned.
 */
import ExcelJS from 'exceljs';
import { budgetSheet, getBudget, type ViewBy, type AccountScope } from '@/lib/glBudgets';
import { getOrgBrand } from '@/lib/org';
import { excelExportResponse } from '@/lib/excel';

export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const name = q.get('name') || '';
  return excelExportResponse('GL_BUDGETS_READ', async () => {
    const budget = await getBudget(name);
    if (!budget) throw new Error('Budget not found');
    const org = await getOrgBrand();
    const sheetData = await budgetSheet({
      name, from: q.get('from') || '', to: q.get('to') || '', viewBy: (q.get('viewBy') as ViewBy) || 'MONTH',
      scope: (q.get('scope') as AccountScope) || 'INCOME_STATEMENT', accountFilter: q.get('accountFilter'),
      dim1Id: q.get('dim1') ? Number(q.get('dim1')) : null, dim2Id: q.get('dim2') ? Number(q.get('dim2')) : null,
    });
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Budget');
    sheet.addRow([org?.name ?? '', 'G/L Budget', name]).font = { bold: true };
    sheet.addRow(['Description', budget.description ?? '']);
    sheet.addRow(['Date filter', `${q.get('from')}..${q.get('to')}`, 'View by', q.get('viewBy') || 'MONTH']);
    sheet.addRow([]);
    const header = sheet.addRow(sheetData.headers);
    header.font = { bold: true };
    sheet.getColumn(1).width = 16; sheet.getColumn(2).width = 40;
    for (let c = 3; c <= sheetData.headers.length; c++) { sheet.getColumn(c).width = 14; sheet.getColumn(c).numFmt = '#,##0.00'; }
    for (const r of sheetData.rows) sheet.addRow([r.code, r.name, ...r.amounts.map((a) => a / 100)]);
    const totalRow = sheet.addRow(['', 'Total', ...sheetData.periods.map((_, i) => sheetData.rows.reduce((s, r) => s + r.amounts[i], 0) / 100)]);
    totalRow.font = { bold: true };
    sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 5 }];
    return { filename: `budget-${name}.xlsx`, buffer: Buffer.from(await wb.xlsx.writeBuffer()) };
  });
}
