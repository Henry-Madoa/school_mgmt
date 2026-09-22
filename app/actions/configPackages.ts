'use server';

import { revalidatePath } from 'next/cache';
import { requireAction } from '@/lib/session';
import { actionResult } from '@/lib/errors';
import * as configPackages from '@/lib/configPackages';
import type {
  ActionResult, ConfigImportResult, ConfigPackage, ConfigPackageColumn, FormValues,
} from '@/lib/types';
import type { FilterFieldDef } from '@/lib/listFilters';

/** Lets the New/Edit Package form fetch a table's columns client-side once an admin picks it —
 *  the table dropdown is populated up front, but its columns aren't fetched until selected. */
export async function getConfigPackageColumns(tableName: string): Promise<ActionResult<ConfigPackageColumn[]>> {
  return actionResult(async () => {
    await requireAction('ADMIN_CONFIG_PACKAGE_MANAGE');
    return configPackages.listConfigPackageColumns(tableName);
  });
}

/** The package's own configured fields, as filterable fields for its export filter builder
 *  (see app/admin/config-package-io.tsx). */
export async function getConfigPackageFilterFields(code: string): Promise<ActionResult<FilterFieldDef[]>> {
  return actionResult(async () => {
    await requireAction('ADMIN_CONFIG_PACKAGE_MANAGE');
    return configPackages.listConfigPackageFilterFields(code);
  });
}

export async function saveConfigPackage(
  code: string | null,
  values: FormValues,
  fields: string[],
): Promise<ActionResult<ConfigPackage | { id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_CONFIG_PACKAGE_MANAGE');
    let result;
    if (code) {
      result = await configPackages.updateConfigPackage(
        code, { name: String(values.name || ''), key_field: values.key_field ? String(values.key_field) : null },
        fields, user,
      );
    } else {
      result = await configPackages.createConfigPackage(
        {
          code: String(values.code || ''),
          name: String(values.name || ''),
          table_name: String(values.table_name || ''),
          key_field: values.key_field ? String(values.key_field) : null,
        },
        fields, user,
      );
    }
    revalidatePath('/admin/data');
    return result;
  });
}

export async function deleteConfigPackageAction(code: string): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_CONFIG_PACKAGE_MANAGE');
    await configPackages.deleteConfigPackage(code, user);
    revalidatePath('/admin/data');
    return { deleted: true };
  });
}

export interface ImportState {
  result?: ConfigImportResult;
  error?: string;
}

/** Bound to a plain <form action> (see app/admin/config-package-io.tsx) rather than FormModal,
 *  since FormModal's readForm() only reads scalar values and silently drops a File. */
export async function importConfigPackageAction(_prevState: ImportState, formData: FormData): Promise<ImportState> {
  try {
    const user = await requireAction('ADMIN_CONFIG_PACKAGE_MANAGE');
    const code = String(formData.get('code') || '');
    const file = formData.get('file');
    if (!(file instanceof File) || !file.size) return { error: 'Choose a CSV file to import' };

    const text = await file.text();
    const result = await configPackages.importConfigPackage(code, text, user);
    revalidatePath('/admin/data');
    return { result };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Import failed' };
  }
}
