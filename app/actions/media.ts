'use server';

import { revalidatePath } from 'next/cache';
import { requireAction, requireAnyAction } from '@/lib/session';
import { actionResult, AppError } from '@/lib/errors';
import { signUpload, verifyUpload, destroyAsset, type UploadKind } from '@/lib/cloudinary';
import { updateOrg, getOrg } from '@/lib/org';
import { setUserSignature } from '@/lib/userSignatures';
import { setEmployeeImage } from '@/lib/employees';
import { setEditRequestImage } from '@/lib/employeeEdits';
import { setStudentPhoto } from '@/lib/students';
import {
  recordAttachment, deleteAttachment, listAttachments,
} from '@/lib/attachments';
import type { ActionKey } from '@/lib/permissions';
import type {
  ActionResult, Attachment, AttachmentEntity, Organisation, UploadSignature, UploadedFile,
} from '@/lib/types';

/** The action that governs writing media onto each kind of record. */
const WRITE_ACTION: Record<UploadKind, ActionKey> = {
  logo: 'ADMIN_ORG_MANAGE',
  ceo_signature: 'ADMIN_ORG_MANAGE',
  photo: 'STUDENTS_UPDATE',
  attachment: 'STUDENTS_UPDATE',
  // A user's own signature is administrator-managed, not student data.
  user_signature: 'ADMIN_USER_MANAGE',
  // The Employee Card's identity strip — whoever maintains employee records.
  employee_photo: 'EMPLOYEES_CREATE',
  employee_signature: 'EMPLOYEES_CREATE',
};

/**
 * Issue one-shot upload credentials.
 *
 * Permission is checked *here*, before the browser is allowed to talk to
 * Cloudinary at all — an unsigned request cannot upload, so this is the gate.
 */
export async function requestUploadSignature(
  kind: UploadKind,
  entity?: AttachmentEntity,
): Promise<ActionResult<UploadSignature>> {
  return actionResult(async () => {
    // Staff documents are captured by whoever maintains employee records.
    const key = kind === 'attachment' && entity === 'employee' ? 'EMPLOYEES_CREATE' : WRITE_ACTION[kind];
    // An employee's photo / signature is also proposed on an Employee Editing request — by HR,
    // or by the employee themselves under Self Service.
    if (kind === 'employee_photo' || kind === 'employee_signature') {
      await requireAnyAction(key, 'EMPLOYEE_EDITS_UPDATE', 'SELF_SERVICE_RECORD_UPDATE');
    } else {
      await requireAction(key);
    }
    return signUpload(kind);
  });
}

/* --------------------------------------------------------------- org logo */

export async function saveOrgLogo(file: UploadedFile | null): Promise<ActionResult<Organisation>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_ORG_MANAGE');
    const previous = (await getOrg())?.logo ?? null;

    let logo: string | null = null;
    if (file) {
      const asset = await verifyUpload(file.publicId, 'logo', file.resourceType);
      logo = asset.public_id;
    }

    const org = await updateOrg({ logo }, user);

    // Drop the superseded asset. Legacy data-URL logos have no asset to remove.
    if (previous && previous !== logo && !previous.startsWith('data:')) {
      await destroyAsset(previous);
    }
    revalidatePath('/', 'layout');
    return org;
  });
}

/** Company Information "Signature" — saved on its own, exactly like the logo. */
export async function saveOrgCeoSignature(file: UploadedFile | null): Promise<ActionResult<Organisation>> {
  return actionResult(async () => {
    const user = await requireAction('ADMIN_ORG_MANAGE');
    const previous = (await getOrg())?.ceo_signature ?? null;
    let ceo_signature: string | null = null;
    if (file) {
      const asset = await verifyUpload(file.publicId, 'ceo_signature', file.resourceType);
      ceo_signature = asset.public_id;
    }
    const org = await updateOrg({ ceo_signature }, user);
    if (previous && previous !== ceo_signature) await destroyAsset(previous);
    revalidatePath('/admin');
    return org;
  });
}

/* ----------------------------------------------------------- student photo */

export async function saveStudentPhoto(
  studentId: number,
  file: UploadedFile | null,
): Promise<ActionResult<{ photo: string | null }>> {
  return actionResult(async () => {
    const user = await requireAction('STUDENTS_UPDATE');
    let photo: string | null = null;
    if (file) {
      const asset = await verifyUpload(file.publicId, 'photo', file.resourceType);
      photo = asset.public_id;
    }
    const previous = await setStudentPhoto(studentId, photo, user);
    if (previous && previous !== photo && !previous.startsWith('data:')) {
      await destroyAsset(previous);
    }
    revalidatePath('/students/view/' + studentId);
    revalidatePath('/students');
    return { photo };
  });
}

/* --------------------------------------------------------- user signatures */

/**
 * The scanned signature an administrator holds for a user (Admin Centre -> System Security ->
 * User Setup). Stored and replaced exactly like a student's photo: the browser uploads
 * to Cloudinary under one-shot credentials, this verifies the asset really landed in the right
 * folder, and the previous image is destroyed once the new public_id is committed.
 */
export async function saveUserSignature(
  userId: number, file: UploadedFile | null,
): Promise<ActionResult<{ signature_image: string | null }>> {
  return actionResult(async () => {
    const actor = await requireAction('ADMIN_USER_MANAGE');
    let value: string | null = null;
    if (file) {
      const asset = await verifyUpload(file.publicId, 'user_signature', file.resourceType);
      value = asset.public_id;
    }
    const previous = await setUserSignature(userId, value, actor);
    if (previous && previous !== value && !previous.startsWith('data:')) {
      await destroyAsset(previous);
    }
    revalidatePath('/admin/security/setup');
    return { signature_image: value };
  });
}

/* ------------------------------------------------------- employee identity */

/** The Employee Card's passport photo / specimen signature slots. */
export async function saveEmployeeImage(
  employeeId: number, kind: 'photo' | 'signature', file: UploadedFile | null,
): Promise<ActionResult<{ value: string | null }>> {
  return actionResult(async () => {
    const actor = await requireAction('EMPLOYEES_CREATE');
    let value: string | null = null;
    if (file) {
      const asset = await verifyUpload(file.publicId, kind === 'photo' ? 'employee_photo' : 'employee_signature', file.resourceType);
      value = asset.public_id;
    }
    const previous = await setEmployeeImage(employeeId, kind, value, actor);
    if (previous && previous !== value && !previous.startsWith('data:')) {
      await destroyAsset(previous);
    }
    revalidatePath(`/employees/view/${employeeId}`);
    revalidatePath('/employees');
    revalidatePath('/self-service');
    return { value };
  });
}

/** The proposed passport photo / specimen signature on an Employee Editing request. */
export async function saveEmployeeEditImage(
  no: string, kind: 'photo' | 'signature', file: UploadedFile | null,
): Promise<ActionResult<{ value: string | null }>> {
  return actionResult(async () => {
    const actor = await requireAnyAction('EMPLOYEE_EDITS_UPDATE', 'SELF_SERVICE_RECORD_UPDATE');
    let value: string | null = null;
    if (file) {
      const asset = await verifyUpload(file.publicId, kind === 'photo' ? 'employee_photo' : 'employee_signature', file.resourceType);
      value = asset.public_id;
    }
    const { previous, previousIsLive } = await setEditRequestImage(no, kind, value, actor);
    // An upload that only ever sat on the request is an orphan once replaced; the employee's
    // live image is left alone — it is still theirs until the request is applied.
    if (previous && previous !== value && !previousIsLive && !previous.startsWith('data:')) {
      await destroyAsset(previous);
    }
    revalidatePath(`/employee-edits/view/${no}`);
    revalidatePath('/employee-edits');
    revalidatePath('/self-service/record');
    revalidatePath('/self-service/employee-editing');
    return { value };
  });
}

/* ------------------------------------------------------------ attachments */

function attachmentAction(entity: AttachmentEntity): ActionKey {
  return entity === 'employee' ? 'EMPLOYEES_CREATE' : 'STUDENTS_UPDATE';
}

const attachmentPath = (entity: AttachmentEntity, entityId: number): string =>
  `/${entity === 'employee' ? 'employees' : 'students'}/view/${entityId}`;

export async function addAttachment(
  entity: AttachmentEntity,
  entityId: number,
  file: UploadedFile,
  category: string,
): Promise<ActionResult<Attachment>> {
  return actionResult(async () => {
    const user = await requireAction(attachmentAction(entity));
    const asset = await verifyUpload(file.publicId, 'attachment', file.resourceType);
    const saved = await recordAttachment({
      entity,
      entityId,
      asset,
      filename: file.originalFilename || asset.public_id.split('/').pop() || 'file',
      category: category || null,
    }, user);
    revalidatePath(attachmentPath(entity, entityId));
    return saved;
  });
}

export async function removeAttachment(
  entity: AttachmentEntity,
  entityId: number,
  attachmentId: number,
): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => {
    const user = await requireAction(attachmentAction(entity));
    // Confirm the attachment really belongs to the record named in the URL,
    // so an id from another student's file cannot be deleted through this page.
    const owned = (await listAttachments(entity, entityId)).some((a) => a.id === attachmentId);
    if (!owned) throw new AppError('Attachment not found on this record', 'NOT_FOUND');

    const result = await deleteAttachment(attachmentId, user);
    revalidatePath(attachmentPath(entity, entityId));
    return result;
  });
}
