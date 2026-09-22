import type { Writable } from 'node:stream';
import {
  archiveName,
  createTarHeader,
  isGzipped,
  readBounded,
} from './log-files.helpers';
import {
  buildManifest,
  type ExportFile,
  type SkippedFile,
} from './export-budget.helpers';

/** Largest single write into the archive stream, so backpressure bites. */
const WRITE_SLICE = 64 * 1024;

export interface ArchiveOptions {
  /** Cap on REAL decompressed bytes across every entry. */
  budget: number;
  scrub: (text: string) => string;
  /** Files already left out by the up-front estimate. */
  skipped: SkippedFile[];
}

/** Write one chunk, waiting for 'drain' when the stream is full. */
export function writeChunk(out: Writable, chunk: Buffer): Promise<void> {
  if (out.destroyed) return Promise.reject(new Error('export stream closed'));
  if (out.write(chunk)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const settle = (fn: () => void) => () => {
      out.off('drain', onDrain);
      out.off('close', onClose);
      fn();
    };
    const onDrain = settle(resolve);
    const onClose = settle(() => reject(new Error('export stream closed')));
    out.on('drain', onDrain);
    out.on('close', onClose);
  });
}

/** Append one tar entry (header, body in slices, 512-byte padding). */
async function writeEntry(out: Writable, name: string, body: Buffer) {
  await writeChunk(out, createTarHeader(name, body.length));
  for (let at = 0; at < body.length; at += WRITE_SLICE) {
    await writeChunk(out, body.subarray(at, at + WRITE_SLICE));
  }
  const padding = 512 - (body.length % 512);
  if (padding < 512) await writeChunk(out, Buffer.alloc(padding));
}

/** Real bytes of a file within `remaining`, or null (and a manifest line). */
async function readEntry(
  file: ExportFile,
  remaining: number,
  skipped: SkippedFile[],
): Promise<Buffer | null> {
  const skip = (reason: string) => {
    skipped.push({ filename: file.filename, size: file.size, reason });
    return null;
  };
  try {
    const body = await readBounded(file.filepath, remaining);
    return body ?? skip('over cap');
  } catch (err) {
    return skip(`unreadable (${(err as Error).message})`);
  }
}

/**
 * Stream a tar of `files` into `out` (ROK-1164). Every entry is its real,
 * scrubbed bytes, counted against what is LEFT of `budget` — a `.gz` whose
 * ISIZE lies, or that fails to decompress, is left out and listed in
 * MANIFEST.txt, never cut off mid-archive. Writes await 'drain'.
 */
export async function writeTarArchive(
  out: Writable,
  files: ExportFile[],
  options: ArchiveOptions,
): Promise<void> {
  const skipped = [...options.skipped];
  let remaining = options.budget;
  for (const file of files) {
    const raw = await readEntry(file, remaining, skipped);
    if (!raw) continue;
    remaining -= raw.length;
    const text = options.scrub(raw.toString('utf-8'));
    await writeEntry(out, archiveName(file.filename), Buffer.from(text));
  }
  const renamedGz = files.some((f) => isGzipped(f.filename));
  const manifest = buildManifest(skipped, renamedGz);
  if (manifest) await writeEntry(out, 'MANIFEST.txt', Buffer.from(manifest));
  await writeChunk(out, Buffer.alloc(1024));
  out.end();
}
