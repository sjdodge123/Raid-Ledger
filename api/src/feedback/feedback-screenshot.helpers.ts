/**
 * ROK-1313: feedback screenshot storage helpers (pure + fs, no DI).
 *
 * Screenshots live OUTSIDE every static-asset mount (`main.ts` serves only
 * avatars and `/uploads/branding/`) so they are never publicly reachable.
 * `feedback.screenshot_path` stores the path relative to the uploads root:
 * `feedback/<id>.<ext>`.
 */
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { mkdir, unlink, writeFile } from 'fs/promises';
import * as path from 'path';
import { FEEDBACK_SCREENSHOT_MAX_BASE64_CHARS } from '@raid-ledger/contract';

export type ScreenshotExt = 'png' | 'jpg';

/** Prefix of every stored `screenshot_path`. */
export const FEEDBACK_SCREENSHOT_REL_PREFIX = 'feedback/';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const DATA_URL_PREFIX = /^data:[^,]*;base64,/i;

/** Directory screenshots are written to (branding.controller.ts precedent). */
export function getFeedbackScreenshotDir(): string {
  // Test-only escape hatch so integration specs sandbox to a tmpdir instead
  // of writing into the dev server's real uploads directory.
  if (process.env.RAID_LEDGER_FEEDBACK_DIR) {
    return process.env.RAID_LEDGER_FEEDBACK_DIR;
  }
  const isProduction = process.env.NODE_ENV === 'production';
  return isProduction
    ? '/data/uploads/feedback'
    : path.join(process.cwd(), 'uploads', 'feedback');
}

function startsWith(buf: Buffer, magic: readonly number[]): boolean {
  if (buf.length < magic.length) return false;
  return magic.every((byte, i) => buf[i] === byte);
}

/** Identify a PNG or JPEG by its magic bytes; anything else is `null`. */
export function sniffImageType(buf: Buffer): ScreenshotExt | null {
  if (startsWith(buf, PNG_MAGIC)) return 'png';
  if (startsWith(buf, JPEG_MAGIC)) return 'jpg';
  return null;
}

/** Decode base64, dropping a stray data-URL header (its MIME is never read). */
export function decodeScreenshot(b64: string): Buffer {
  return Buffer.from(b64.replace(DATA_URL_PREFIX, ''), 'base64');
}

/**
 * Validate a submitted screenshot. 413 over the encoded-length cap, 400 when
 * the decoded bytes are not a PNG or JPEG — the declared type is not trusted.
 */
export function validateScreenshot(b64: string): {
  buf: Buffer;
  ext: ScreenshotExt;
} {
  if (b64.length > FEEDBACK_SCREENSHOT_MAX_BASE64_CHARS) {
    throw new PayloadTooLargeException('Screenshot is too large');
  }
  const buf = decodeScreenshot(b64);
  const ext = sniffImageType(buf);
  if (!ext) {
    throw new BadRequestException('Screenshot must be a PNG or JPEG image');
  }
  return { buf, ext };
}

/**
 * Write `<dir>/<id>.<ext>`; returns the relative path. The just-inserted row
 * owns `<id>`, so any file already there is a stale orphan from before a DB
 * reset/restore rewound the id sequence: overwrite it, and drop a stale
 * sibling with the other extension so no earlier user's image lingers.
 */
export async function writeScreenshot(
  feedbackId: number,
  buf: Buffer,
  ext: ScreenshotExt,
): Promise<string> {
  const dir = getFeedbackScreenshotDir();
  await mkdir(dir, { recursive: true });
  const fileName = `${feedbackId}.${ext}`;
  const target = path.join(dir, fileName);
  const sibling = `${feedbackId}.${ext === 'png' ? 'jpg' : 'png'}`;
  try {
    await writeFile(target, buf, { flag: 'w' });
    await deleteScreenshotFiles([
      `${FEEDBACK_SCREENSHOT_REL_PREFIX}${sibling}`,
    ]);
  } catch (err) {
    // A partial write (ENOSPC) or a failed sibling delete would otherwise
    // leave a file no row points at: remove the target before rethrowing.
    await unlink(target).catch(() => undefined);
    throw err;
  }
  return `${FEEDBACK_SCREENSHOT_REL_PREFIX}${fileName}`;
}

/**
 * Map a stored `feedback/<file>` path to an absolute path inside the
 * screenshot dir, or `null` when it is malformed or escapes the dir.
 */
export function resolveScreenshotPath(relPath: string): string | null {
  if (!relPath.startsWith(FEEDBACK_SCREENSHOT_REL_PREFIX)) return null;
  const dir = path.resolve(getFeedbackScreenshotDir());
  const name = relPath.slice(FEEDBACK_SCREENSHOT_REL_PREFIX.length);
  const abs = path.resolve(dir, name);
  const rel = path.relative(dir, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  if (rel.includes(path.sep)) return null;
  return abs;
}

function isMissingFile(err: unknown): boolean {
  // Not `instanceof Error`: fs errors come from another realm under jest.
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    err.code === 'ENOENT'
  );
}

/**
 * Delete stored screenshots. Paths that escape the dir are refused (skipped)
 * and returned; a file that is already gone is not an error.
 */
export async function deleteScreenshotFiles(
  relPaths: readonly string[],
): Promise<string[]> {
  const refused: string[] = [];
  for (const relPath of relPaths) {
    const abs = resolveScreenshotPath(relPath);
    if (!abs) {
      refused.push(relPath);
      continue;
    }
    try {
      await unlink(abs);
    } catch (err) {
      if (!isMissingFile(err)) throw err;
    }
  }
  return refused;
}
