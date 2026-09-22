'use server';

import { revalidatePath } from 'next/cache';
import { requireAction } from '@/lib/session';
import { actionResult } from '@/lib/errors';
import {
  updateChangeLogSetup, listAvailableChangeLogTables, addChangeLogSetupTable as addTable,
  removeChangeLogSetupTable as removeTable,
} from '@/lib/changeLog';
import { AppError } from '@/lib/errors';
import type { ActionResult, ChangeLogSetup } from '@/lib/types';

export async function saveChangeLogSetup(
  tableName: string,
  patch: Partial<Pick<ChangeLogSetup, 'log_insertion' | 'log_modification' | 'log_deletion'>>,
): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    await requireAction('ADMIN_CHANGE_LOG_MANAGE');
    await updateChangeLogSetup(tableName, patch);
    revalidatePath('/admin/security/changelog');
    return { updated: true };
  });
}

export async function addChangeLogSetupTable(tableName: string): Promise<ActionResult<{ added: true }>> {
  return actionResult(async () => {
    await requireAction('ADMIN_CHANGE_LOG_MANAGE');
    const table = (await listAvailableChangeLogTables()).find((t) => t.table_name === tableName);
    if (!table) throw new AppError('Unknown or already-configured table.');
    await addTable(table.table_name, table.table_caption);
    revalidatePath('/admin/security/changelog');
    return { added: true };
  });
}

export async function removeChangeLogSetupTable(tableName: string): Promise<ActionResult<{ removed: true }>> {
  return actionResult(async () => {
    await requireAction('ADMIN_CHANGE_LOG_MANAGE');
    await removeTable(tableName);
    revalidatePath('/admin/security/changelog');
    return { removed: true };
  });
}
