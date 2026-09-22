/*
 * Scanned user signatures, resolved for a document printout.
 *
 * Every slip in this app names the people behind the document — prepared by, approved by, paid
 * by, received by. Those names are stored as usernames on the posted record, so a printout only
 * has to look up the signature each of them has on file (Admin Centre -> System Security -> User
 * Setup) to reproduce what the paper process used to collect by hand.
 *
 * A user with no signature on file simply prints the ruled line the slip has always had, so a
 * document is never blocked on an administrator having got round to the upload.
 */
import { all, run, one, audit } from './db.ts';
import { AppError } from './errors.ts';
import { imageSrc } from './cloudinary.ts';
import type { Actor, SignatureBlock } from './types.ts';

/** Width the signature is delivered and printed at — the same box lib/loanDocuments.ts uses. */
const SIGNATURE_WIDTH = 180;
const SIGNATURE_HEIGHT = 70;

/** The signature each of these usernames has on file, keyed by username. Unknown usernames and
 *  users without a signature come back with a null `src`, which is what the slips print. */
export async function signaturesFor(usernames: (string | null | undefined)[]): Promise<Map<string, SignatureBlock>> {
  const wanted = [...new Set(usernames.filter((u): u is string => !!u && !!u.trim()).map((u) => u.trim()))];
  const found = new Map<string, SignatureBlock>();
  if (!wanted.length) return found;

  const rows = await all<{ username: string; full_name: string; signature_image: string | null }>(
    `SELECT username, full_name, signature_image FROM app_user
     WHERE username IN (${wanted.map(() => '?').join(',')})`,
    ...wanted,
  );
  for (const username of wanted) {
    const row = rows.find((r) => r.username === username);
    found.set(username, {
      username,
      full_name: row?.full_name ?? null,
      src: imageSrc(row?.signature_image, { width: SIGNATURE_WIDTH, height: SIGNATURE_HEIGHT, crop: 'fit' }),
    });
  }
  return found;
}

/** One signature, for a slip that only names a single person. */
export async function signatureFor(username: string | null | undefined): Promise<SignatureBlock | null> {
  if (!username) return null;
  return (await signaturesFor([username])).get(username.trim()) ?? null;
}

/**
 * The signature block as a slip renders it: the image when one is on file, otherwise the ruled
 * line every one of these documents printed before signatures existed. Returns HTML, because the
 * slips are rendered as HTML strings rather than JSX (they are printed, not interacted with).
 */
export function renderSignatureHtml(block: SignatureBlock | undefined | null, label: string): string {
  const esc = (v: unknown): string => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const name = block?.full_name || block?.username || '';
  return `
    <div class="sig-block">
      ${block?.src ? `<img class="sig-img" src="${esc(block.src)}" alt="${esc(name)} signature" />` : '<div class="sig-rule"></div>'}
      <div class="sig-label">${esc(label)}${name ? ` — ${esc(name)}` : ''}</div>
    </div>`;
}

/** The shared print styling for the blocks above — inlined into each slip's own <style>. */
export const SIGNATURE_STYLES = `
  .sig-block { flex: 1; min-width: 150px; }
  .sig-block .sig-img { display: block; max-width: 180px; max-height: 56px; margin-bottom: 2px; }
  .sig-block .sig-rule { height: 56px; border-bottom: 1px solid #111; margin-bottom: 2px; }
  .sig-block .sig-label { font-size: 11px; color: #444; padding-top: 3px; }
`;

/* ------------------------------------------------------------------ maintenance */

/** Attach (or, with null, clear) a user's signature. Administrator-only; see app/actions/media.ts. */
export async function setUserSignature(userId: number, publicId: string | null, actor: Actor): Promise<string | null> {
  const user = await one<{ id: number; username: string; signature_image: string | null }>(
    'SELECT id, username, signature_image FROM app_user WHERE id = ?', userId,
  );
  if (!user) throw new AppError('User not found', 'NOT_FOUND');
  await run('UPDATE app_user SET signature_image = ? WHERE id = ?', publicId, userId);
  await audit(actor, publicId ? 'USER_SIGNATURE_SET' : 'USER_SIGNATURE_CLEAR', 'app_user', userId, {
    username: user.username,
  });
  return user.signature_image;
}
