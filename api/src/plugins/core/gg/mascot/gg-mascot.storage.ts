import { UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * ROK-2187 — the community GG mascot's same-origin copies: the admin's
 * Discord emoji + soundboard sound, copied at save time so a CDN edit,
 * delete or lost boost never breaks a delivered GG (and CSP has no
 * media-src). Files are `{snowflake}.{ext}` only.
 */

/** URL prefix the API serves the copies under (main.ts). */
export const GG_MASCOT_URL_PREFIX = '/uploads/gg-mascot/';
/** Image cap (spec): 256 KB. */
export const MASCOT_IMAGE_MAX_BYTES = 256 * 1024;
/** Sound cap (Discord's own soundboard limit): 512 KB. */
export const MASCOT_SOUND_MAX_BYTES = 512 * 1024;

export type MascotAssetKind = 'image' | 'sound';
export type MascotImageExt = 'png' | 'webp' | 'gif';
export type MascotSoundExt = 'mp3' | 'ogg';
export type MascotExt = MascotImageExt | MascotSoundExt;

/** Content-Type per stored extension (preview responses). */
export const MASCOT_CONTENT_TYPES: Record<MascotExt, string> = {
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
};

const SNOWFLAKE = /^\d{1,25}$/;
const MASCOT_FILE = /^\d{1,25}\.(png|webp|gif|mp3|ogg)$/;

/** Upload dir: `GG_MASCOT_UPLOAD_DIR` (specs) → prod `/data/uploads/gg-mascot` → dev cwd. */
export function getGgMascotDir(): string {
  if (process.env.GG_MASCOT_UPLOAD_DIR) return process.env.GG_MASCOT_UPLOAD_DIR;
  return process.env.NODE_ENV === 'production'
    ? '/data/uploads/gg-mascot'
    : path.join(process.cwd(), 'uploads', 'gg-mascot');
}

function startsWith(buf: Buffer, bytes: number[], offset = 0): boolean {
  return bytes.every((b, i) => buf[offset + i] === b);
}

function sniffImage(buf: Buffer): MascotImageExt | null {
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47])) return 'png';
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  const riff = startsWith(buf, [0x52, 0x49, 0x46, 0x46]);
  if (riff && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  return null;
}

function sniffSound(buf: Buffer): MascotSoundExt | null {
  if (startsWith(buf, [0x4f, 0x67, 0x67, 0x53])) return 'ogg';
  if (startsWith(buf, [0x49, 0x44, 0x33])) return 'mp3';
  const b0 = buf[0];
  const b1 = buf[1];
  if (b0 === 0xff && b1 !== undefined && (b1 & 0xe0) === 0xe0) return 'mp3';
  return null;
}

/** Magic-byte sniff: the extension the bytes really are, or `null`. */
export function sniffMascotAsset(
  buf: Buffer,
  kind: MascotAssetKind,
): MascotExt | null {
  return kind === 'image' ? sniffImage(buf) : sniffSound(buf);
}

/** Byte cap for a kind. */
export function mascotMaxBytes(kind: MascotAssetKind): number {
  return kind === 'image' ? MASCOT_IMAGE_MAX_BYTES : MASCOT_SOUND_MAX_BYTES;
}

/** Size cap + sniff; returns the extension or throws 422. */
export function assertMascotAsset(
  buf: Buffer,
  kind: MascotAssetKind,
): MascotExt {
  if (buf.length === 0 || buf.length > mascotMaxBytes(kind)) {
    throw new UnprocessableEntityException(
      `Mascot ${kind} is empty or over ${mascotMaxBytes(kind)} bytes`,
    );
  }
  const ext = sniffMascotAsset(buf, kind);
  if (!ext)
    throw new UnprocessableEntityException(
      `Mascot ${kind} is not an allowed type`,
    );
  return ext;
}

/** Filename for a copy; refuses anything but a snowflake (path-safety). */
export function mascotFileName(id: string, ext: MascotExt): string {
  if (!SNOWFLAKE.test(id))
    throw new UnprocessableEntityException('Bad mascot id');
  return `${id}.${ext}`;
}

/** Writes `{id}.{ext}` atomically; returns its URL with a content `?v=`. */
export async function writeMascotFile(
  id: string,
  ext: MascotExt,
  buf: Buffer,
): Promise<string> {
  const dir = getGgMascotDir();
  const name = mascotFileName(id, ext);
  await fs.promises.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${name}.tmp`);
  await fs.promises.writeFile(tmp, buf);
  await fs.promises.rename(tmp, path.join(dir, name));
  const v = createHash('sha256').update(buf).digest('hex').slice(0, 8);
  return `${GG_MASCOT_URL_PREFIX}${name}?v=${v}`;
}

/** Deletes every mascot copy except `keep` (file names). Missing dir = no-op. */
export async function removeMascotFiles(
  keep: ReadonlySet<string>,
): Promise<void> {
  const dir = getGgMascotDir();
  let entries: string[];
  try {
    entries = await fs.promises.readdir(dir);
  } catch {
    return;
  }
  const stale = entries.filter((f) => MASCOT_FILE.test(f) && !keep.has(f));
  await Promise.all(
    stale.map((f) => fs.promises.rm(path.join(dir, f), { force: true })),
  );
}

/** File name of a stored mascot URL (`/uploads/gg-mascot/1.png?v=…` → `1.png`). */
export function mascotFileFromUrl(url: string | null): string | null {
  if (!url?.startsWith(GG_MASCOT_URL_PREFIX)) return null;
  const name = url.slice(GG_MASCOT_URL_PREFIX.length).split('?')[0] ?? '';
  return MASCOT_FILE.test(name) ? name : null;
}
