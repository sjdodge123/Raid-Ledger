/**
 * ROK-1956 D-14 — where companion blob bytes live on disk. Content-addressed
 * per user: `<root>/<userId>/<sha256>.webp`, temp uploads in the same folder
 * (`.upload-<rand>.tmp`) so the commit is an atomic `rename`. Every path is
 * built from a positive integer user id and a lowercase-hex sha256 only, so a
 * path can never leave the root (no traversal).
 */
import { randomBytes } from 'node:crypto';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import * as path from 'node:path';

const SHA256_RE = /^[0-9a-f]{64}$/;

/** A crash-left temp upload (`.upload-<16 hex>.tmp`). */
export const COMPANION_BLOB_TEMP_RE = /^\.upload-[0-9a-f]{16}\.tmp$/;
/** A stored blob file name (`<sha256>.webp`). */
export const COMPANION_BLOB_FILE_RE = /^([0-9a-f]{64})\.webp$/;

/**
 * Root: `COMPANION_BLOB_DIR` when set (integration specs sandbox to a
 * tmpdir), else `/data/uploads/companion/blobs` in production and
 * `<cwd>/uploads/companion/blobs` in dev. Read per call.
 */
export function getCompanionBlobDir(): string {
  if (process.env.COMPANION_BLOB_DIR) return process.env.COMPANION_BLOB_DIR;
  return process.env.NODE_ENV === 'production'
    ? '/data/uploads/companion/blobs'
    : path.join(process.cwd(), 'uploads', 'companion', 'blobs');
}

function userDir(userId: number): string {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error('companion blob: invalid user id');
  }
  return String(userId);
}

/** `storage_path` (relative to the root): `<userId>/<sha256>.webp`. */
export function companionBlobRelativePath(
  userId: number,
  sha256: string,
): string {
  if (!SHA256_RE.test(sha256)) throw new Error('companion blob: invalid sha');
  return path.posix.join(userDir(userId), `${sha256}.webp`);
}

/** Absolute path of a stored blob. */
export function companionBlobAbsolutePath(
  userId: number,
  sha256: string,
): string {
  return path.join(
    getCompanionBlobDir(),
    companionBlobRelativePath(userId, sha256),
  );
}

/** A fresh temp path in the user's folder (created when missing). */
export async function companionBlobTempPath(userId: number): Promise<string> {
  const dir = path.join(getCompanionBlobDir(), userDir(userId));
  await mkdir(dir, { recursive: true });
  return path.join(dir, `.upload-${randomBytes(8).toString('hex')}.tmp`);
}

/** Atomically move a verified temp file to its content-addressed name. */
export async function commitCompanionBlob(
  tmpPath: string,
  userId: number,
  sha256: string,
): Promise<void> {
  await rename(tmpPath, companionBlobAbsolutePath(userId, sha256));
}

/** Remove a file (no error when already gone). */
export async function discardCompanionBlobFile(
  filePath: string,
): Promise<void> {
  await rm(filePath, { force: true });
}

/**
 * Whether the stored blob's file is on disk. A row can outlive its file (a
 * crash between commit and rename, or a DB restore without `/data/uploads`).
 */
export async function companionBlobFileExists(
  userId: number,
  sha256: string,
): Promise<boolean> {
  const st = await stat(companionBlobAbsolutePath(userId, sha256)).catch(
    (err: unknown) => {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
        return null;
      }
      throw err;
    },
  );
  return st?.isFile() ?? false;
}
