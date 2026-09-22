import 'server-only';
import { v2 as cloudinary } from 'cloudinary';
import { AppError } from './errors.ts';
import type { CloudinaryAsset, UploadSignature } from './types.ts';

/*
 * Cloudinary holds every uploaded file: the school logo, student and staff photographs
 * and document attachments.
 *
 * Files never pass through this server. The browser asks for a signature, posts
 * the file straight to Cloudinary, and then hands back the public_id — which we
 * verify against the Admin API before recording. That keeps large scans off the
 * Server Action body limit and means a forged callback cannot invent an asset.
 *
 * Configuration comes from CLOUDINARY_URL, the SDK's own convention:
 *   CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>
 */

const FOLDER_ROOT = process.env.CLOUDINARY_FOLDER || 'school';

/** Folders are fixed server-side so a client cannot write outside our namespace. */
const FOLDERS = {
  logo: `${FOLDER_ROOT}/branding`,
  ceo_signature: `${FOLDER_ROOT}/branding`,
  photo: `${FOLDER_ROOT}/student-photos`,
  attachment: `${FOLDER_ROOT}/attachments`,
  user_signature: `${FOLDER_ROOT}/user-signatures`,
  employee_photo: `${FOLDER_ROOT}/employee-photos`,
  employee_signature: `${FOLDER_ROOT}/employee-signatures`,
} as const;

export type UploadKind = keyof typeof FOLDERS;

/** Images render inline; anything else is delivered as a raw file. */
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];
const DOC_TYPES = ['application/pdf', 'text/plain', 'text/csv',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

const ACCEPTED: Record<UploadKind, string[]> = {
  logo: IMAGE_TYPES,
  ceo_signature: IMAGE_TYPES,
  photo: IMAGE_TYPES,
  attachment: [...IMAGE_TYPES, ...DOC_TYPES],
  user_signature: IMAGE_TYPES,
  employee_photo: IMAGE_TYPES,
  employee_signature: IMAGE_TYPES,
};

const MAX_BYTES: Record<UploadKind, number> = {
  logo: 1_500_000,
  ceo_signature: 1_500_000,
  photo: 3_000_000,
  attachment: 10_000_000,
  user_signature: 1_500_000,
  employee_photo: 3_000_000,
  employee_signature: 1_500_000,
};

let configured: boolean | null = null;

/**
 * True once credentials are found and applied to the SDK.
 *
 * Both conventions are accepted: the SDK's single `CLOUDINARY_URL`, and the
 * discrete `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET` trio that most
 * hosting dashboards hand out. Checked rather than assumed, so a deployment
 * without media configured still serves every page — only the upload controls
 * report themselves unavailable.
 */
export function isConfigured(): boolean {
  if (configured !== null) return configured;
  try {
    const cloud_name = process.env.CLOUDINARY_CLOUD_NAME;
    const api_key = process.env.CLOUDINARY_API_KEY;
    const api_secret = process.env.CLOUDINARY_API_SECRET;

    if (cloud_name && api_key && api_secret) {
      cloudinary.config({ cloud_name, api_key, api_secret, secure: true });
    } else if (process.env.CLOUDINARY_URL) {
      // The SDK reads CLOUDINARY_URL from the environment on its own.
      cloudinary.config({ secure: true });
    } else {
      return (configured = false);
    }

    const c = cloudinary.config();
    configured = Boolean(c.cloud_name && c.api_key && c.api_secret);
  } catch {
    configured = false;
  }
  return configured;
}

function requireConfigured(): void {
  if (!isConfigured()) {
    throw new AppError(
      'Media storage is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY '
      + 'and CLOUDINARY_API_SECRET (or CLOUDINARY_URL) to enable uploads.',
      'CLOUDINARY_NOT_CONFIGURED',
    );
  }
}

/**
 * Credentials for one direct browser upload.
 *
 * The signature covers folder and timestamp, so the browser cannot redirect the
 * file to another folder or replay the request indefinitely.
 */
export function signUpload(kind: UploadKind): UploadSignature {
  requireConfigured();
  const { cloud_name, api_key, api_secret } = cloudinary.config();
  const timestamp = Math.round(Date.now() / 1000);
  const folder = FOLDERS[kind];
  const signature = cloudinary.utils.api_sign_request({ folder, timestamp }, api_secret!);

  return {
    cloudName: cloud_name!,
    apiKey: api_key!,
    timestamp,
    folder,
    signature,
    // Documents are stored as `raw`/`auto` so a PDF is not processed as an image.
    resourceType: kind === 'attachment' ? 'auto' : 'image',
    accepted: ACCEPTED[kind],
    maxBytes: MAX_BYTES[kind],
  };
}

/**
 * Confirm an asset really exists and sits in the folder we signed for, then
 * return the trustworthy metadata. The browser reports what it uploaded; this
 * is what we actually believe.
 *
 * `typeHint`, when given, is Cloudinary's own resource_type from the upload
 * response — not trusted as authority (we still verify via the Admin API),
 * but tried first so a non-image attachment doesn't pay for a guaranteed-fail
 * `image` lookup before falling back to `raw`.
 */
export async function verifyUpload(publicId: string, kind: UploadKind, typeHint?: string): Promise<CloudinaryAsset> {
  requireConfigured();
  const folder = FOLDERS[kind];
  if (!publicId.startsWith(`${folder}/`)) {
    throw new AppError('Uploaded file is outside the expected folder', 'BAD_ASSET');
  }

  const resourceType = kind === 'attachment' ? 'auto' : 'image';
  const candidates = resourceType === 'auto' ? ['image', 'raw'] : ['image'];
  const ordered = typeHint && candidates.includes(typeHint)
    ? [typeHint, ...candidates.filter((t) => t !== typeHint)]
    : candidates;
  for (const type of ordered) {
    try {
      const r = await cloudinary.api.resource(publicId, { resource_type: type });
      return {
        public_id: r.public_id,
        url: r.secure_url,
        format: r.format ?? null,
        bytes: r.bytes,
        resource_type: r.resource_type,
        width: r.width ?? null,
        height: r.height ?? null,
      };
    } catch {
      // try the next resource type
    }
  }
  throw new AppError('Uploaded file could not be found in media storage', 'ASSET_NOT_FOUND');
}

/**
 * A short-lived, signed download link for one asset.
 *
 * Cloudinary's "restricted media types" account setting blocks unauthenticated
 * public delivery of PDF and ZIP files — the plain `imageSrc`/`deliveryUrl`
 * links 401 for those. The admin-signed `/download` endpoint is exempt from
 * that restriction (it is itself an authenticated request), so attachments
 * are served through this instead. Harmless, and just as effective, for the
 * other formats attachments can hold.
 */
export function signedAttachmentUrl(publicId: string, resourceType: string, format: string | null): string {
  if (!isConfigured()) return '';
  return cloudinary.utils.private_download_url(publicId, format || '', {
    resource_type: resourceType,
    type: 'upload',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  });
}

/** Remove an asset. A failure here must not block the database delete. */
export async function destroyAsset(publicId: string, resourceType = 'image'): Promise<void> {
  if (!isConfigured() || !publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType, invalidate: true });
  } catch (err) {
    // The record is going away regardless; leaving an orphan asset is far
    // better than refusing to delete the row that points at it.
    console.error('[cloudinary] destroy failed for', publicId, err);
  }
}

/** Crop modes Cloudinary allows to pair with `gravity: auto`; e.g. `fit` rejects it outright. */
const GRAVITY_CROPS = new Set(['fill', 'thumb', 'lfill', 'fill_pad', 'auto', 'auto_pad']);

/**
 * A delivery URL with transformations applied.
 * Serving a 40px avatar from a 3 MB original is the whole point of doing this.
 */
function deliveryUrl(
  publicId: string,
  opts: { width?: number; height?: number; crop?: string } = {},
): string {
  if (!isConfigured()) return '';
  const crop = opts.crop ?? 'fill';
  return cloudinary.url(publicId, {
    secure: true,
    fetch_format: 'auto',
    quality: 'auto',
    ...opts,
    crop,
    ...(GRAVITY_CROPS.has(crop) ? { gravity: 'auto' } : {}),
  });
}

/**
 * What an <img> should point at.
 * Legacy records still hold a base64 data URL from before Cloudinary; those are
 * passed through untouched so existing installs keep their logo.
 */
export function imageSrc(
  stored: string | null | undefined,
  opts: { width?: number; height?: number; crop?: string } = {},
): string | null {
  if (!stored) return null;
  if (stored.startsWith('data:') || stored.startsWith('http')) return stored;
  return deliveryUrl(stored, opts) || null;
}
