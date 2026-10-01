import * as fs from 'node:fs';
import type { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { isGzipped } from './log-files.helpers';
import {
  generationOf,
  type ExportFile,
  type SkippedFile,
} from './export-budget.helpers';

/** Decompressed bytes compared at the start of two generations. */
export const HEAD_BYTES = 4096;

/** `api.log.4.gz` / `api.log.1` / `api.log` all share the base `api.log`. */
const GENERATION_SUFFIX_RE = /\.log(?:\.\d{1,3})?(?:\.gz)?$/;

const baseOf = (filename: string) =>
  filename.replace(GENERATION_SUFFIX_RE, '.log');

/** Gather `source` until `maxBytes` are in hand or it ends. */
function collectHead(
  source: Readable,
  maxBytes: number,
  finish: (head: Buffer | null) => void,
): void {
  const chunks: Buffer[] = [];
  let got = 0;
  const head = () => Buffer.concat(chunks).subarray(0, maxBytes);
  source.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
    got += chunk.length;
    if (got >= maxBytes) finish(head());
  });
  source.on('end', () => finish(head()));
  source.on('error', () => finish(null));
}

/**
 * The first `maxBytes` of a log's content (a `.gz` is decompressed), or null
 * when it cannot be read. Both streams are destroyed as soon as enough is in
 * hand, so a huge file or a gzip bomb costs about one chunk.
 */
export function readHead(
  filepath: string,
  maxBytes = HEAD_BYTES,
): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const file = fs.createReadStream(filepath, { highWaterMark: 16 * 1024 });
    const gunzip = isGzipped(filepath) ? createGunzip() : null;
    let done = false;
    const finish = (head: Buffer | null) => {
      if (done) return;
      done = true;
      file.destroy();
      gunzip?.destroy();
      resolve(head);
    };
    file.on('error', () => finish(null)); // pipe() does not forward these
    collectHead(gunzip ? file.pipe(gunzip) : file, maxBytes, finish);
  });
}

/** True when `older` is non-empty and `newer` starts with exactly its bytes. */
function sameHead(older: Buffer | null, newer: Buffer | null): boolean {
  if (!older || !newer || older.length === 0) return false;
  if (newer.length < older.length) return false;
  return newer.subarray(0, older.length).equals(older);
}

/** Head reads in flight at once: an export-all can name hundreds of files. */
export const HEAD_READ_CONCURRENCY = 8;

/** The heads of `files`, read at most {@link HEAD_READ_CONCURRENCY} at a time. */
async function readHeads(
  files: ExportFile[],
): Promise<Map<ExportFile, Buffer | null>> {
  const heads = new Map<ExportFile, Buffer | null>();
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const file = files[next++];
      heads.set(file, await readHead(file.filepath));
    }
  };
  const workers = Math.min(HEAD_READ_CONCURRENCY, files.length);
  await Promise.all(Array.from({ length: workers }, worker));
  return heads;
}

/**
 * Generations that share their base with at least one other, newest first.
 * The live file is one of them (generation 0), so a `.1` that repeats the
 * start of the live file is dropped as its duplicate: the one comparison
 * made against a file logrotate's copytruncate may still be writing to.
 */
function siblingGenerations(files: ExportFile[]): ExportFile[] {
  const numbered = files.filter((f) =>
    Number.isFinite(generationOf(f.filename)),
  );
  const counts = new Map<string, number>();
  for (const f of numbered) {
    const base = baseOf(f.filename);
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  return numbered
    .filter((f) => (counts.get(baseOf(f.filename)) ?? 0) >= 2)
    .sort((a, b) => generationOf(a.filename) - generationOf(b.filename));
}

/**
 * The nearest STRICTLY newer generation of `older`'s base in `pool` that is
 * at least as big and starts with the same bytes. Equal generations
 * (`api.log.1` and `api.log.1.gz`) never match each other.
 */
function newerOverlap(
  older: ExportFile,
  pool: ExportFile[],
  heads: Map<ExportFile, Buffer | null>,
): ExportFile | undefined {
  const gen = generationOf(older.filename);
  const matches = pool.filter(
    (n) =>
      baseOf(n.filename) === baseOf(older.filename) &&
      generationOf(n.filename) < gen &&
      n.size >= older.size &&
      sameHead(heads.get(older) ?? null, heads.get(n) ?? null),
  );
  return matches.sort(
    (a, b) => generationOf(b.filename) - generationOf(a.filename),
  )[0];
}

/**
 * Leave out a rotated generation that repeats the start of a newer one of
 * the same log (an overlapping rotation, e.g. copytruncate plus a restart),
 * so its lines are not exported twice. Only the first {@link HEAD_BYTES} of
 * files that have a sibling generation are read. The live file is never a
 * duplicate: nothing is newer than it.
 *
 * Generations are walked newest first and compared only with the ones kept
 * so far, so every reason names a file that IS in the export. A match is
 * transitive (a byte-prefix of a byte-prefix, never smaller), so this drops
 * exactly the files that match any newer generation.
 */
export async function dropOverlappingGenerations(
  files: ExportFile[],
): Promise<{ kept: ExportFile[]; duplicates: SkippedFile[] }> {
  const candidates = siblingGenerations(files);
  const heads = await readHeads(candidates);
  const keptSoFar: ExportFile[] = [];
  const dropped = new Set<ExportFile>();
  const duplicates: SkippedFile[] = [];
  for (const older of candidates) {
    const newer = newerOverlap(older, keptSoFar, heads);
    if (!newer) {
      keptSoFar.push(older);
      continue;
    }
    dropped.add(older);
    duplicates.push({
      filename: older.filename,
      size: older.size,
      reason: `duplicate of ${newer.filename} (overlapping generation: same first ${HEAD_BYTES / 1024} KB)`,
    });
  }
  return { kept: files.filter((f) => !dropped.has(f)), duplicates };
}
