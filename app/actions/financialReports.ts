'use server';

import { revalidatePath } from 'next/cache';
import { requireAction } from '@/lib/session';
import { actionResult } from '@/lib/errors';
import * as fr from '@/lib/financialReports';
import type { ActionResult, FormValues } from '@/lib/types';

const str = (v: unknown): string => String(v ?? '').trim();
const bool = (v: unknown): boolean => v === 1 || v === '1' || v === true || v === 'on';

function revalidate(): void {
  revalidatePath('/finance/financial-reports');
  revalidatePath('/finance/financial-reports/row-definitions');
  revalidatePath('/finance/financial-reports/column-layouts');
}

/* ---------------------------------------------------------------- column layouts */

export async function saveColumnLayoutNameRequest(id: number | null, v: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('FINANCIAL_REPORTS_MANAGE');
    const res = await fr.saveColumnLayoutName({ id, name: str(v.name), description: str(v.description) }, user);
    revalidate();
    return res;
  });
}

export async function deleteColumnLayoutNameRequest(name: string): Promise<ActionResult<null>> {
  return actionResult(async () => {
    const user = await requireAction('FINANCIAL_REPORTS_MANAGE');
    await fr.deleteColumnLayoutName(name, user);
    revalidate();
    return null;
  });
}

export async function saveColumnLayoutLineRequest(id: number | null, v: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('FINANCIAL_REPORTS_MANAGE');
    const res = await fr.saveColumnLayoutLine({
      id,
      layoutName: str(v.layoutName),
      columnNo: str(v.columnNo),
      columnHeader: str(v.columnHeader),
      columnType: str(v.columnType) as fr.ColumnLayoutLineInput['columnType'],
      amountType: str(v.amountType) || 'NET_AMOUNT',
      ledgerEntryType: str(v.ledgerEntryType) || 'ENTRIES',
      budgetName: str(v.budgetName) || null,
      formula: str(v.formula),
      comparisonDateFormula: str(v.comparisonDateFormula),
      show: str(v.show) || 'ALWAYS',
      roundingFactor: str(v.roundingFactor) || 'NONE',
    }, user);
    revalidate();
    return res;
  });
}

export async function deleteColumnLayoutLineRequest(id: number): Promise<ActionResult<null>> {
  return actionResult(async () => {
    const user = await requireAction('FINANCIAL_REPORTS_MANAGE');
    await fr.deleteColumnLayoutLine(id, user);
    revalidate();
    return null;
  });
}

export async function duplicateColumnLayoutRequest(name: string, v: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('FINANCIAL_REPORTS_MANAGE');
    const res = await fr.duplicateColumnLayout(name, str(v.newName), user);
    revalidate();
    return res;
  });
}

/* ---------------------------------------------------------------- row definitions */

export async function saveAccScheduleNameRequest(id: number | null, v: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('FINANCIAL_REPORTS_MANAGE');
    const res = await fr.saveAccScheduleName({
      id,
      name: str(v.name),
      description: str(v.description),
      defaultColumnLayoutName: str(v.defaultColumnLayoutName) || null,
    }, user);
    revalidate();
    return res;
  });
}

export async function deleteAccScheduleNameRequest(name: string): Promise<ActionResult<null>> {
  return actionResult(async () => {
    const user = await requireAction('FINANCIAL_REPORTS_MANAGE');
    await fr.deleteAccScheduleName(name, user);
    revalidate();
    return null;
  });
}

export async function saveAccScheduleLineRequest(id: number | null, v: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('FINANCIAL_REPORTS_MANAGE');
    const res = await fr.saveAccScheduleLine({
      id,
      scheduleName: str(v.scheduleName),
      rowNo: str(v.rowNo),
      description: str(v.description),
      totalingType: str(v.totalingType) || 'POSTING_ACCOUNTS',
      totaling: str(v.totaling),
      amountType: str(v.amountType) || 'NET_AMOUNT',
      rowType: str(v.rowType) || 'NET_CHANGE',
      show: str(v.show) || 'YES',
      bold: bool(v.bold),
      italic: bool(v.italic),
      underline: bool(v.underline),
      doubleUnderline: bool(v.doubleUnderline),
      showOppositeSign: bool(v.showOppositeSign),
      newPage: bool(v.newPage),
      indentation: Number(v.indentation) || 0,
      dimension1Totaling: str(v.dimension1Totaling),
      dimension2Totaling: str(v.dimension2Totaling),
    }, user);
    revalidate();
    return res;
  });
}

export async function deleteAccScheduleLineRequest(id: number): Promise<ActionResult<null>> {
  return actionResult(async () => {
    const user = await requireAction('FINANCIAL_REPORTS_MANAGE');
    await fr.deleteAccScheduleLine(id, user);
    revalidate();
    return null;
  });
}

export async function duplicateAccScheduleNameRequest(name: string, v: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('FINANCIAL_REPORTS_MANAGE');
    const res = await fr.duplicateAccScheduleName(name, str(v.newName), user);
    revalidate();
    return res;
  });
}

/* ---------------------------------------------------------------- financial reports */

export async function saveFinancialReportRequest(id: number | null, v: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('FINANCIAL_REPORTS_MANAGE');
    const res = await fr.saveFinancialReport({
      id,
      name: str(v.name),
      description: str(v.description),
      rowGroup: str(v.rowGroup),
      columnGroup: str(v.columnGroup),
    }, user);
    revalidate();
    return res;
  });
}

export async function deleteFinancialReportRequest(name: string): Promise<ActionResult<null>> {
  return actionResult(async () => {
    const user = await requireAction('FINANCIAL_REPORTS_MANAGE');
    await fr.deleteFinancialReport(name, user);
    revalidate();
    return null;
  });
}
