'use server';

import { revalidatePath } from 'next/cache';
import ExcelJS from 'exceljs';
import { requireAction } from '@/lib/session';
import { actionResult } from '@/lib/errors';
import {
  createBudget, updateBudget, deleteBudget, setBudgetCell, createBudgetEntry, updateBudgetEntry, deleteBudgetEntry, deleteBudgetEntries,
  copyGlBudget, importBudgetRows, type CopyBudgetOptions, type ImportBudgetResult,
} from '@/lib/glBudgets';
import type { ActionResult, FormValues } from '@/lib/types';

const revalidate = (name?: string) => {
  revalidatePath('/budgets');
  if (name) revalidatePath(`/budgets/${encodeURIComponent(name)}`);
  revalidatePath('/finance/financial-reports');
};
const num = (v: unknown): number | null => (v === '' || v == null ? null : Number(v));
const toCents = (v: unknown): number => Math.round(Number(String(v ?? '').replace(/,/g, '') || 0) * 100);

/* ------------------------------------------------------------------ names */

export async function createBudgetRequest(values: FormValues): Promise<ActionResult<{ name: string }>> {
  return actionResult(async () => {
    const user = await requireAction('GL_BUDGETS_MANAGE');
    const res = await createBudget({ name: String(values.name || ''), description: values.description ? String(values.description) : null }, user);
    revalidate();
    return res;
  });
}
export async function updateBudgetRequest(name: string, values: FormValues): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const user = await requireAction('GL_BUDGETS_MANAGE');
    await updateBudget(name, { description: values.description ? String(values.description) : null, blocked: !!Number(values.blocked ?? 0) }, user);
    revalidate(name);
    return { updated: true };
  });
}
export async function deleteBudgetRequest(name: string): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => {
    const user = await requireAction('GL_BUDGETS_MANAGE');
    await deleteBudget(name, user);
    revalidate();
    return { deleted: true };
  });
}

/* ------------------------------------------------------------------ matrix cell */

/** One matrix cell — `amount` in currency units as typed; the period's entries are replaced. */
export async function setBudgetCellRequest(name: string, accountId: number, period: { start: string; end: string }, amount: number, dims: { dim1Id?: number | null; dim2Id?: number | null }): Promise<ActionResult<{ saved: true }>> {
  return actionResult(async () => {
    const user = await requireAction('GL_BUDGETS_MANAGE');
    await setBudgetCell(name, accountId, period, Math.round(Number(amount) * 100), user, dims);
    revalidate(name);
    return { saved: true };
  });
}

/* ------------------------------------------------------------------ entries */

const entryInput = (values: FormValues) => ({
  accountId: Number(values.accountId), date: String(values.date || ''), amount: toCents(values.amount),
  description: values.description ? String(values.description) : null, dim1Id: num(values.dim1Id), dim2Id: num(values.dim2Id),
});
export async function createBudgetEntryRequest(name: string, values: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('GL_BUDGETS_MANAGE');
    const res = await createBudgetEntry(name, entryInput(values), user);
    revalidate(name);
    return res;
  });
}
export async function updateBudgetEntryRequest(name: string, id: number, values: FormValues): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const user = await requireAction('GL_BUDGETS_MANAGE');
    await updateBudgetEntry(id, entryInput(values), user);
    revalidate(name);
    return { updated: true };
  });
}
export async function deleteBudgetEntryRequest(name: string, id: number): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => {
    const user = await requireAction('GL_BUDGETS_MANAGE');
    await deleteBudgetEntry(id, user);
    revalidate(name);
    return { deleted: true };
  });
}

/** BC "Delete Budget" — the entries inside the current filter. */
export async function deleteBudgetEntriesRequest(name: string, values: FormValues): Promise<ActionResult<{ deleted: number }>> {
  return actionResult(async () => {
    const user = await requireAction('GL_BUDGETS_MANAGE');
    const res = await deleteBudgetEntries(name, {
      from: values.from ? String(values.from) : null, to: values.to ? String(values.to) : null,
      accountFilter: values.accountFilter ? String(values.accountFilter) : null, dim1Id: num(values.dim1Id), dim2Id: num(values.dim2Id),
    }, user);
    revalidate(name);
    return res;
  });
}

/* ------------------------------------------------------------------ copy (BC Report 96) */

export async function copyGlBudgetRequest(values: FormValues): Promise<ActionResult<{ entries: number; total: number }>> {
  return actionResult(async () => {
    const user = await requireAction('GL_BUDGETS_MANAGE');
    const o: CopyBudgetOptions = {
      source: values.source === 'GL_ENTRY' ? 'GL_ENTRY' : 'GL_BUDGET_ENTRY',
      sourceBudget: values.sourceBudget ? String(values.sourceBudget) : null,
      sourceFrom: String(values.sourceFrom || ''), sourceTo: String(values.sourceTo || ''),
      accountFilter: values.accountFilter ? String(values.accountFilter) : null,
      sourceDim1Id: num(values.sourceDim1Id), sourceDim2Id: num(values.sourceDim2Id),
      targetBudget: String(values.targetBudget || ''),
      adjustmentFactor: Number(values.adjustmentFactor || 1),
      roundingMethod: (String(values.roundingMethod || 'NONE') as CopyBudgetOptions['roundingMethod']),
      dateChangeFormula: values.dateChangeFormula ? String(values.dateChangeFormula) : null,
      copyDimensions: !!Number(values.copyDimensions ?? 1),
      replace: !!Number(values.replace ?? 0),
    };
    const res = await copyGlBudget(o, user);
    revalidate(o.targetBudget);
    return res;
  });
}

/* ------------------------------------------------------------------ import (BC Report 81) */

export interface ImportBudgetState { result?: ImportBudgetResult; error?: string }

/** Bound to a plain <form action> (a File never survives FormModal's readForm). */
export async function importBudgetAction(_prev: ImportBudgetState, formData: FormData): Promise<ImportBudgetState> {
  try {
    const user = await requireAction('GL_BUDGETS_MANAGE');
    const name = String(formData.get('name') || '');
    const file = formData.get('file');
    if (!(file instanceof File) || !file.size) return { error: 'Choose an Excel (.xlsx) file to import' };
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const sheet = wb.worksheets[0];
    if (!sheet) return { error: 'The workbook has no sheet' };
    const cellText = (v: ExcelJS.CellValue): string | number | null => {
      if (v == null) return null;
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      if (typeof v === 'number' || typeof v === 'string') return v;
      if (typeof v === 'object' && 'result' in v) return cellText((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
      if (typeof v === 'object' && 'richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('');
      return String(v);
    };
    // Rows above the header (export writes a title block) are skipped: the header is the first row whose column A says "G/L Account No.".
    let headerRow = 1;
    for (let r = 1; r <= Math.min(sheet.rowCount, 20); r++) {
      if (String(cellText(sheet.getRow(r).getCell(1).value) ?? '').trim().toLowerCase().startsWith('g/l account')) { headerRow = r; break; }
    }
    const headers: string[] = [];
    sheet.getRow(headerRow).eachCell({ includeEmpty: true }, (c, i) => { headers[i - 1] = String(cellText(c.value) ?? ''); });
    const rows: (string | number | null)[][] = [];
    for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r); const vals: (string | number | null)[] = [];
      row.eachCell({ includeEmpty: true }, (c, i) => { vals[i - 1] = cellText(c.value); });
      if (vals.some((v) => v != null && v !== '')) rows.push(vals);
    }
    const result = await importBudgetRows({
      name, mode: formData.get('mode') === 'ADD' ? 'ADD' : 'REPLACE', description: String(formData.get('description') || '') || null,
      dim1Id: num(formData.get('dim1Id')), dim2Id: num(formData.get('dim2Id')),
    }, headers, rows, user);
    revalidate(name);
    return { result };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Import failed' };
  }
}
