'use server';

import { revalidatePath } from 'next/cache';
import { requireAction } from '@/lib/session';
import { actionResult } from '@/lib/errors';
import {
  saveNoSeries, deleteNoSeries, saveNoSeriesLine, deleteNoSeriesLine, assignDocumentNoSeries,
} from '@/lib/noSeries';
import type { ActionResult, FormValues } from '@/lib/types';

const bool = (v: unknown): boolean => v === true || v === 'on' || v === '1' || v === 1;

const revalidate = (): void => {
  revalidatePath('/admin/pool/general/no-series');
  revalidatePath('/admin');
};

export async function saveNoSeriesRequest(values: FormValues): Promise<ActionResult<{ saved: true }>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_NO_SERIES_MANAGE');
    await saveNoSeries(
      {
        code: String(values.code || ''),
        description: String(values.description || ''),
        defaultNos: bool(values.defaultNos),
        manualNos: bool(values.manualNos),
        dateOrder: bool(values.dateOrder),
      },
      values.originalCode ? String(values.originalCode) : null,
      user,
    );
    revalidate();
    return { saved: true };
  });
}

export async function deleteNoSeriesRequest(code: string): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_NO_SERIES_MANAGE');
    await deleteNoSeries(code, user);
    revalidate();
    return { deleted: true };
  });
}

export async function saveNoSeriesLineRequest(values: FormValues): Promise<ActionResult<{ saved: true }>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_NO_SERIES_MANAGE');
    await saveNoSeriesLine(
      {
        id: values.id ? Number(values.id) : null,
        seriesCode: String(values.seriesCode || ''),
        startingDate: values.startingDate ? String(values.startingDate) : null,
        startingNo: String(values.startingNo || ''),
        endingNo: values.endingNo ? String(values.endingNo) : null,
        warningNo: values.warningNo ? String(values.warningNo) : null,
        incrementByNo: Number(values.incrementByNo || 1),
        lastNoUsed: values.lastNoUsed ? String(values.lastNoUsed) : null,
        allowGaps: bool(values.allowGaps),
      },
      user,
    );
    revalidate();
    return { saved: true };
  });
}

export async function deleteNoSeriesLineRequest(id: number): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_NO_SERIES_MANAGE');
    await deleteNoSeriesLine(id, user);
    revalidate();
    return { deleted: true };
  });
}

export async function assignDocumentNoSeriesRequest(
  documentCode: string, seriesCode: string | null,
): Promise<ActionResult<{ saved: true }>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_NO_SERIES_MANAGE');
    await assignDocumentNoSeries(documentCode, seriesCode, user);
    revalidate();
    return { saved: true };
  });
}
