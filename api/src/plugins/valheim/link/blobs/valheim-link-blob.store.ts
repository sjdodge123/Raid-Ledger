import { randomBytes } from 'node:crypto';
import { mkdir, rename, rm } from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Root of the content-addressed blob store (spec D8; the avatar/feedback
 * precedent): `VALHEIM_LINK_BLOB_DIR` when set (integration specs sandbox
 * to a tmpdir), else `/data/valheim-link/blobs` in production and
 * `<cwd>/uploads/valheim-link/blobs` in dev. Read per call.
 */
export function getValheimLinkBlobDir(): string {
  if (process.env.VALHEIM_LINK_BLOB_DIR) {
    return process.env.VALHEIM_LINK_BLOB_DIR;
  }
  return process.env.NODE_ENV === 'production'
    ? '/data/valheim-link/blobs'
    : path.join(process.cwd(), 'uploads', 'valheim-link', 'blobs');
}

/** `storage_path` (relative to the root): `<serverId>/<sha256>.png`. */
export function blobRelativePath(
  pelicanServerId: number,
  sha256: string,
): string {
  return path.posix.join(String(pelicanServerId), `${sha256}.png`);
}

/** Absolute path of a stored blob. */
export function blobAbsolutePath(relative: string): string {
  return path.join(getValheimLinkBlobDir(), relative);
}

/**
 * A fresh temp path inside the server's folder (same filesystem as the
 * final name, so the commit is an atomic `rename`). Creates the folder.
 */
export async function blobTempPath(pelicanServerId: number): Promise<string> {
  const dir = path.join(getValheimLinkBlobDir(), String(pelicanServerId));
  await mkdir(dir, { recursive: true });
  return path.join(dir, `.upload-${randomBytes(8).toString('hex')}.tmp`);
}

/** Atomically move a verified temp file to its content-addressed name. */
export async function commitBlob(
  tmpPath: string,
  relative: string,
): Promise<void> {
  await rename(tmpPath, blobAbsolutePath(relative));
}

/** Remove a temp file (no error when already gone). */
export async function discardBlob(tmpPath: string): Promise<void> {
  await rm(tmpPath, { force: true });
}
