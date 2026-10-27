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
  | { status: 'failed'; reason: 'measure-failed'; detail: string }
  | { status: 'failed'; reason: 'tar-failed'; detail: string };

export interface ArchiveUploadsInput {
  uploadsDir: string;
  outPath: string;
  dailyDir: string;
  warn: WarnFn;
  reserveBytes?: number;
  statfs?: StatfsFn;
  runTar?: RunTarFn;
  measure?: (dir: string) => number;
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

/** The only tar warnings a live upload during the run can cause (spec D5). */
const BENIGN_TAR_WARNINGS = [
  /file changed as we read it$/i,
  /file removed before we read it$/i,
];

function errorStderr(err: unknown): string {
  if (typeof err !== 'object' || err === null || !('stderr' in err)) return '';
  return typeof err.stderr === 'string' ? err.stderr : '';
}

/** True when stderr has at least one line and every line is a benign warning. */
export function onlyBenignTarWarnings(stderr: string): boolean {
  const lines = stderr
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return false;
  return lines.every((l) => BENIGN_TAR_WARNINGS.some((re) => re.test(l)));
}

/**
 * Spec D5: GNU tar exits 1 for "file changed/removed as we read it" — a
 * warning when the archive was still written. BusyBox tar also exits 1 on
 * fatal errors (unreadable file, failed write), so exit 1 is tolerated only
 * when every stderr line is one of those warnings. Anything else is fatal.
 */
export function isTarFatal(err: unknown, outPath: string): boolean {
  if (errorCode(err) !== 1 || !nonEmptyFile(outPath)) return true;
  return !onlyBenignTarWarnings(errorStderr(err));
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

type ArchiveFailure = Extract<UploadsArchiveResult, { status: 'failed' }>;

/** Spec D8 pre-flight: tree bytes + reserve must fit the backup disk. */
function preflightSpace(input: ArchiveUploadsInput): ArchiveFailure | null {
  try {
    const bytes = (input.measure ?? measureTree)(input.uploadsDir);
    const reserve = input.reserveBytes ?? UPLOADS_RESERVE_BYTES;
    const statfs = input.statfs ?? fs.statfsSync;
    if (hasRoomFor(bytes, input.dailyDir, reserve, statfs)) return null;
    return { status: 'failed', reason: 'insufficient-space' };
  } catch (err) {
    return {
      status: 'failed',
      reason: 'measure-failed',
      detail: errMessage(err),
    };
  }
}

/** Run tar into `<out>.partial`, then rename it into place (spec D4). */
async function writeArchive(
  input: ArchiveUploadsInput,
): Promise<UploadsArchiveResult> {
  const { uploadsDir, outPath, warn } = input;
  const partial = `${outPath}.partial`;
  const runTar = input.runTar ?? defaultRunTar;
  const ok = await runTarTolerant(runTar, partial, uploadsDir, warn);
  try {
    if (ok !== true) throw new Error(ok);
    fs.renameSync(partial, outPath);
    return { status: 'written', path: outPath };
  } catch (err) {
    cleanupPartialFile(partial);
    return { status: 'failed', reason: 'tar-failed', detail: errMessage(err) };
  }
}

/**
 * Archive `uploadsDir` to `outPath` (spec D4/D7/D8). Never throws: the
 * caller decides how loud each outcome is. Missing root → skipped; an
 * unreadable tree or too little free space → failed before tar runs; a tar
 * failure → failed with the partial removed.
 */
export async function archiveUploads(
  input: ArchiveUploadsInput,
): Promise<UploadsArchiveResult> {
  if (!fs.existsSync(input.uploadsDir)) {
    input.warn(`uploads dir missing; no uploads archive (${input.uploadsDir})`);
    return { status: 'skipped', reason: 'missing-root' };
  }
  return preflightSpace(input) ?? writeArchive(input);
}

/** One-line description of a failed archive for logs and the cron error, else null. */
export function uploadsArchiveFailure(
  result: UploadsArchiveResult,
): string | null {
  if (result.status !== 'failed') return null;
  const detail = 'detail' in result ? `: ${result.detail}` : '';
  return `uploads archive failed (${result.reason}${detail})`;
}
