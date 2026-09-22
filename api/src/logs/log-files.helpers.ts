import * as fs from 'node:fs';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import type { LogService } from '@raid-ledger/contract';

/** Services that write log files. */
export const VALID_SERVICES: LogService[] = [
  'api',
  'nginx',
  'postgresql',
  'redis',
  'supervisor',
  'slow-queries',
];

/**
 * A listable / downloadable / exportable log filename (ROK-1164):
 * `<base>.log` plus the generations logrotate leaves behind in the allinone
 * image (`daily`, `compress`, `delaycompress`, no `dateext`) — `<base>.log.1`
 * and `<base>.log.N.gz` (N is 1-999, never 0 or zero-padded) — and the
 * legacy dated `<base>.log.gz`. `<base>` is
 * word characters and hyphens only (no dots, slashes or extra suffixes) and
 * must start with a known service name (`detectService`).
 */
const LOG_FILE_RE = /^[A-Za-z0-9_-]+\.log(?:\.[1-9]\d{0,2})?(?:\.gz)?$/;

/**
 * Detect the service name from a log filename, e.g. `api.log`,
 * `api-2026-01-01.log.gz`, `supervisor-events.log.1`, `nginx-access.log.3.gz`.
 */
export function detectService(filename: string): LogService | null {
  for (const service of VALID_SERVICES) {
    if (filename.startsWith(service)) return service;
  }
  return null;
}

/** True only for known-service log files and their rotated generations. */
export function isLogFileName(filename: string): boolean {
  return LOG_FILE_RE.test(filename) && detectService(filename) !== null;
}

/** True for a gzip-compressed rotated generation. */
export function isGzipped(filename: string): boolean {
  return filename.endsWith('.gz');
}

/** The name a log is downloaded as once decompressed (`api.log.2.gz` → `api.log.2`). */
export function plainName(filename: string): string {
  return isGzipped(filename) ? filename.slice(0, -'.gz'.length) : filename;
}

/** Suffix a decompressed `.gz` generation is stored under in an export tar. */
export const DECOMPRESSED_SUFFIX = '.decompressed';

/**
 * The name a log is stored under in an export tar (ROK-1164). Plain files
 * keep their name; a `.gz` generation becomes `<name minus .gz>.decompressed`
 * (`api.log.2.gz` → `api.log.2.decompressed`). No listable plain name ends in
 * `.decompressed`, so an entry can never collide with, or overwrite on
 * extract, a live file (`api.log.gz` vs `api.log`) or its plain twin
 * (`api.log.1.gz` vs `api.log.1` under `delaycompress`).
 */
export function archiveName(filename: string): string {
  return isGzipped(filename)
    ? plainName(filename) + DECOMPRESSED_SUFFIX
    : filename;
}

/**
 * ESTIMATED uncompressed size, for ordering and the up-front live-file 413
 * only: the gzip ISIZE trailer (last 4 bytes) for a `.gz`, else the on-disk
 * size. ISIZE is attacker-writable and wraps past 4 GiB, so the export
 * re-counts real bytes as it decompresses (`readBounded`).
 */
export function contentSize(filepath: string, diskSize: number): number {
  if (!isGzipped(filepath) || diskSize < 4) return diskSize;
  const fd = fs.openSync(filepath, 'r');
  try {
    const trailer = Buffer.alloc(4);
    fs.readSync(fd, trailer, 0, 4, diskSize - 4);
    return trailer.readUInt32LE(0);
  } finally {
    fs.closeSync(fd);
  }
}

const gunzipAsync = promisify(gunzip);

async function gunzipBounded(
  raw: Buffer,
  limit: number,
): Promise<Buffer | null> {
  try {
    return await gunzipAsync(raw, { maxOutputLength: limit });
  } catch (err) {
    if ((err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') return null;
    throw err;
  }
}

/**
 * Read up to `size` bytes from the start of `handle`, looping over short
 * reads until EOF. A live log copy-truncated after `stat()` yields fewer
 * bytes than stated — the result is sliced so no zero-filled tail leaks out.
 */
async function readUpTo(
  handle: fs.promises.FileHandle,
  size: number,
): Promise<Buffer> {
  const buf = Buffer.alloc(size);
  let got = 0;
  while (got < size) {
    const { bytesRead } = await handle.read(buf, got, size - got, got);
    if (bytesRead === 0) break;
    got += bytesRead;
  }
  return buf.subarray(0, got);
}

/**
 * Read a log's REAL bytes — a `.gz` generation decompressed — or `null` when
 * they exceed `limit`. A plain file is snapshotted at its size when opened
 * (a live log growing mid-read cannot push it past the limit).
 */
export async function readBounded(
  filepath: string,
  limit: number,
): Promise<Buffer | null> {
  const handle = await fs.promises.open(filepath, 'r');
  try {
    const { size } = await handle.stat();
    if (size > limit || limit < 1) return null;
    const raw = await readUpTo(handle, size);
    return isGzipped(filepath) ? await gunzipBounded(raw, limit) : raw;
  } finally {
    await handle.close();
  }
}

/** Create a POSIX tar header (512 bytes) for a regular-file entry. */
export function createTarHeader(filename: string, size: number): Buffer {
  const header = Buffer.alloc(512);
  header.write(filename, 0, 100, 'utf-8'); // name
  header.write('0000644\0', 100, 8, 'utf-8'); // mode
  header.write('0000000\0', 108, 8, 'utf-8'); // uid
  header.write('0000000\0', 116, 8, 'utf-8'); // gid
  header.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'utf-8');
  const mtime = Math.floor(Date.now() / 1000);
  header.write(mtime.toString(8).padStart(11, '0') + '\0', 136, 12, 'utf-8');
  header.write('        ', 148, 8, 'utf-8'); // checksum placeholder
  header.write('0', 156, 1, 'utf-8'); // typeflag: regular file

  // Checksum = sum of all bytes with the checksum field read as spaces.
  let checksum = 0;
  for (let i = 0; i < 512; i++) checksum += header[i];
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf-8');
  return header;
}
