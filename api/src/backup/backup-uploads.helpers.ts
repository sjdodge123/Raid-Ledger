/**
 * ROK-2023 — companion `/data/uploads` archive for each daily pg_dump.
 *
 * Plain `.tar` (contents are already-compressed images) written by the
 * system `tar` through `execFile`, the same pattern `backup.helpers.ts` uses
 * for pg_dump. Only portable flags (`-c -f -C`) so BusyBox (node:22-alpine),
 * GNU and bsd tar all accept them. Written to `<out>.partial` and renamed,
 * so rotation and the restore drill never see half an archive.
 */
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';

import { cleanupPartialFile } from './backup.helpers';

const execFileAsync = promisify(execFile);

/** Free space kept on the backup disk beyond the archive (spec D8). */
export const UPLOADS_RESERVE_BYTES = 1024 * 1024 * 1024;

type WarnFn = (message: string) => void;
export type StatfsFn = (dir: string) => { bavail: number; bsize: number };
export type RunTarFn = (args: string[]) => Promise<unknown>;

export type UploadsArchiveResult =
  | { status: 'written'; path: string }
  | { status: 'skipped'; reason: 'missing-root' }
  | { status: 'failed'; reason: 'insufficient-space' }
  | { status: 'failed'; reason: 'tar-failed'; detail: string };

export interface ArchiveUploadsInput {
  uploadsDir: string;
  outPath: string;
  dailyDir: string;
  warn: WarnFn;
  reserveBytes?: number;
  statfs?: StatfsFn;
  runTar?: RunTarFn;
}

/**
 * Uploads root (spec D6): `BACKUP_UPLOADS_DIR` when set (integration specs
 * sandbox it), else `/data/uploads` in production and `<cwd>/uploads` in
 * dev. Read per call so a spec can set the env after import.
 */
export function resolveUploadsDir(): string {
  if (process.env.BACKUP_UPLOADS_DIR) return process.env.BACKUP_UPLOADS_DIR;
  return process.env.NODE_ENV === 'production'
    ? '/data/uploads'
    : path.join(process.cwd(), 'uploads');
}

/** `raid_ledger_<ts>.dump` → `raid_ledger_<ts>.uploads.tar` (spec D1). */
export function uploadsArchiveName(dumpFilename: string): string {
  const base = dumpFilename.endsWith('.dump')
    ? dumpFilename.slice(0, -'.dump'.length)
    : dumpFilename;
  return `${base}.uploads.tar`;
}

/** `tar -cf <out> -C <parent> <basename>` — members are `<basename>/…`. */
export function tarCreateArgs(outPath: string, uploadsDir: string): string[] {
  return [
    '-cf',
    outPath,
    '-C',
    path.dirname(uploadsDir),
    path.basename(uploadsDir),
  ];
}

function errorCode(err: unknown): unknown {
  if (typeof err !== 'object' || err === null || !('code' in err)) {
    return undefined;
  }
  return err.code;
}

function nonEmptyFile(filepath: string): boolean {
  try {
    const st = fs.statSync(filepath);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

/**
 * Spec D5: GNU tar exits 1 for "file changed/removed as we read it" — a
 * warning when the archive was still written. Anything else is fatal.
 */
export function isTarFatal(err: unknown, outPath: string): boolean {
  return !(errorCode(err) === 1 && nonEmptyFile(outPath));
}

/** Bytes of regular files under `dir`; symlinks are not followed (0). */
export function measureTree(dir: string): number {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += measureTree(full);
    else if (entry.isFile()) total += fs.lstatSync(full).size;
  }
  return total;
}

/** True when `bytes + reserve` fits in the free space of `dir`'s disk. */
export function hasRoomFor(
  bytes: number,
  dir: string,
  reserve: number,
  statfs: StatfsFn = fs.statfsSync,
): boolean {
  const { bavail, bsize } = statfs(dir);
  return bytes + reserve <= bavail * bsize;
}

const errMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

const defaultRunTar: RunTarFn = (args) => execFileAsync('tar', args);

/** Run tar into `partial`; true when the archive is usable (D5). */
async function runTarTolerant(
  runTar: RunTarFn,
  partial: string,
  uploadsDir: string,
  warn: WarnFn,
): Promise<true | string> {
  try {
    await runTar(tarCreateArgs(partial, uploadsDir));
    return true;
  } catch (err) {
    if (isTarFatal(err, partial)) return errMessage(err);
    warn(`uploads archive: tar exit 1 (files changed during read) — kept`);
    return true;
  }
}

/**
 * Archive `uploadsDir` to `outPath` (spec D4/D7/D8). Never throws: the
 * caller decides how loud each outcome is. Missing root → skipped; too
 * little free space → failed before tar runs; tar failure → failed with the
 * partial removed.
 */
export async function archiveUploads(
  input: ArchiveUploadsInput,
): Promise<UploadsArchiveResult> {
  const { uploadsDir, outPath, dailyDir, warn } = input;
  if (!fs.existsSync(uploadsDir)) {
    warn(`uploads dir missing; no uploads archive (${uploadsDir})`);
    return { status: 'skipped', reason: 'missing-root' };
  }
  const reserve = input.reserveBytes ?? UPLOADS_RESERVE_BYTES;
  const statfs = input.statfs ?? fs.statfsSync;
  if (!hasRoomFor(measureTree(uploadsDir), dailyDir, reserve, statfs)) {
    return { status: 'failed', reason: 'insufficient-space' };
  }
  const partial = `${outPath}.partial`;
  const runTar = input.runTar ?? defaultRunTar;
  const ok = await runTarTolerant(runTar, partial, uploadsDir, warn);
  if (ok !== true) {
    cleanupPartialFile(partial);
    return { status: 'failed', reason: 'tar-failed', detail: ok };
  }
  try {
    fs.renameSync(partial, outPath);
  } catch (err) {
    cleanupPartialFile(partial);
    return { status: 'failed', reason: 'tar-failed', detail: errMessage(err) };
  }
  return { status: 'written', path: outPath };
}
