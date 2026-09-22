import * as fs from 'node:fs';
import { gunzipSync } from 'node:zlib';
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
 * and `<base>.log.N.gz` — and the legacy dated `<base>.log.gz`. `<base>` is
 * word characters and hyphens only (no dots, slashes or extra suffixes) and
 * must start with a known service name (`detectService`).
 */
const LOG_FILE_RE = /^[A-Za-z0-9_-]+\.log(?:\.\d{1,3})?(?:\.gz)?$/;

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

/** The name a log is served under once decompressed (`api.log.2.gz` → `api.log.2`). */
export function plainName(filename: string): string {
  return isGzipped(filename) ? filename.slice(0, -'.gz'.length) : filename;
}

/**
 * Uncompressed size of a log: the gzip ISIZE trailer (last 4 bytes, mod 2^32)
 * for a `.gz` generation, else its on-disk size. Lets the export size cap
 * count what will actually be buffered, not the compressed bytes.
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

/**
 * Read a log as text, decompressing a `.gz` generation first so it can be
 * scrubbed. `maxBytes` bounds the gunzip output (a lying ISIZE cannot blow
 * the heap).
 */
export function readLogText(filepath: string, maxBytes: number): string {
  const raw = fs.readFileSync(filepath);
  const text = isGzipped(filepath)
    ? gunzipSync(raw, { maxOutputLength: maxBytes })
    : raw;
  return text.toString('utf-8');
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
