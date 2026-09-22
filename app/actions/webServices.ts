'use server';

import { revalidatePath } from 'next/cache';
import { requireAction } from '@/lib/session';
import { actionResult } from '@/lib/errors';
import {
  createWebService, updateWebService, setWebServicePublished, deleteWebService,
  generateAccessKey, revokeAccessKey, clearWebServiceLog,
} from '@/lib/webServices';
import type { ActionResult, FormValues, WebServiceObjectType } from '@/lib/types';

const revalidate = () => {
  for (const p of ['/admin/data/web-services', '/admin/data/web-service-keys', '/admin/data/web-service-log']) revalidatePath(p);
};

/** The New form posts "PAGE:50100" as the object; split it back into its type and number. */
function parseObject(v: unknown): { objectType: WebServiceObjectType; objectId: number } {
  const [type, id] = String(v ?? '').split(':');
  return { objectType: type as WebServiceObjectType, objectId: Number(id) };
}

export async function createWebServiceRequest(values: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('WEB_SERVICES_MANAGE');
    const res = await createWebService({
      ...parseObject(values.object), serviceName: String(values.service_name ?? ''), published: Number(values.published) === 1,
      description: values.description == null ? null : String(values.description),
    }, user);
    revalidate();
    return res;
  });
}

export async function updateWebServiceRequest(id: number, values: FormValues): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const user = await requireAction('WEB_SERVICES_MANAGE');
    await updateWebService(id, {
      serviceName: String(values.service_name ?? ''), published: Number(values.published) === 1,
      description: values.description == null ? null : String(values.description),
    }, user);
    revalidate();
    return { updated: true };
  });
}

export async function setWebServicePublishedRequest(id: number, published: boolean): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const user = await requireAction('WEB_SERVICES_MANAGE');
    await setWebServicePublished(id, published, user);
    revalidate();
    return { updated: true };
  });
}

export async function deleteWebServiceRequest(id: number): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => {
    const user = await requireAction('WEB_SERVICES_MANAGE');
    await deleteWebService(id, user);
    revalidate();
    return { deleted: true };
  });
}

export async function generateAccessKeyRequest(values: FormValues): Promise<ActionResult<{ key: string; hint: string }>> {
  return actionResult(async () => {
    const user = await requireAction('WEB_SERVICES_MANAGE');
    const res = await generateAccessKey(Number(values.user_id), {
      expiresAt: values.expires_at ? String(values.expires_at) : null,
      scope: values.scope === 'READ_ONLY' ? 'READ_ONLY' : 'READ_WRITE',
      services: String(values.services || '').split(/[,\s]+/).filter(Boolean),
      ratePerMinute: values.rate_limit_per_minute ? Number(values.rate_limit_per_minute) : null,
    }, user);
    revalidate();
    return res;
  });
}

export async function revokeAccessKeyRequest(id: number): Promise<ActionResult<{ revoked: true }>> {
  return actionResult(async () => {
    const user = await requireAction('WEB_SERVICES_MANAGE');
    await revokeAccessKey(id, user);
    revalidate();
    return { revoked: true };
  });
}

export async function clearWebServiceLogRequest(): Promise<ActionResult<{ cleared: true }>> {
  return actionResult(async () => {
    const user = await requireAction('WEB_SERVICES_MANAGE');
    await clearWebServiceLog(user);
    revalidate();
    return { cleared: true };
  });
}
