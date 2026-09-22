import { one, all, run, audit } from './db.ts';
import { AppError } from './errors.ts';
import { destroyAsset, signedAttachmentUrl } from './cloudinary.ts';
import type { Actor, Attachment, AttachmentEntity, CloudinaryAsset } from './types.ts';

/** Links are re-signed on every read — see signedAttachmentUrl() for why the stored url is not served directly. */
export async function listAttachments(entity: AttachmentEntity, entityId: number): Promise<Attachment[]> {
  const rows = await all<Attachment>(
    'SELECT * FROM attachment WHERE entity = ? AND entity_id = ? ORDER BY id DESC',
    entity, entityId,
  );
  return rows.map((r) => ({ ...r, url: signedAttachmentUrl(r.public_id, r.resource_type, r.format) || r.url }));
}

export interface RecordAttachmentInput {
  entity: AttachmentEntity;
  entityId: number;
  asset: CloudinaryAsset;
  filename: string;
  category?: string | null;
}

/**
 * Index an asset that has already been verified against Cloudinary.
 * `asset` must come from verifyUpload() — never straight from the browser.
 */
export async function recordAttachment(
  { entity, entityId, asset, filename, category }: RecordAttachmentInput,
  user: Actor,
): Promise<Attachment> {
  if (await one('SELECT 1 FROM attachment WHERE public_id = ?', asset.public_id)) {
    throw new AppError('That file has already been attached', 'DUPLICATE_ASSET');
  }
  const info = await run(
    `INSERT INTO attachment (entity, entity_id, public_id, url, filename, resource_type,
       format, bytes, category, uploaded_at, uploaded_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    entity, entityId, asset.public_id, asset.url, filename, asset.resource_type,
    asset.format, asset.bytes, category || null, new Date().toISOString(), user.username,
  );
  await audit(user, 'ATTACHMENT_ADD', entity, entityId, { filename, public_id: asset.public_id, bytes: asset.bytes });
  return (await one<Attachment>('SELECT * FROM attachment WHERE id = ?', Number(info.lastInsertRowid)))!;
}

/**
 * Remove the index row and then the asset.
 * The row goes first: an orphaned Cloudinary file is recoverable, a row
 * pointing at a deleted asset is a broken link on the student's file.
 */
export async function deleteAttachment(id: number, user: Actor): Promise<{ deleted: true }> {
  const row = await one<Attachment>('SELECT * FROM attachment WHERE id = ?', id);
  if (!row) throw new AppError('Attachment not found', 'NOT_FOUND');

  await run('DELETE FROM attachment WHERE id = ?', id);
  await audit(user, 'ATTACHMENT_DELETE', row.entity, row.entity_id, {
    filename: row.filename, public_id: row.public_id,
  });
  await destroyAsset(row.public_id, row.resource_type);
  return { deleted: true };
}
