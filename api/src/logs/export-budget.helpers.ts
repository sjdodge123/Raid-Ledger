import { PayloadTooLargeException } from '@nestjs/common';

/** A validated export candidate; `size` is its UNCOMPRESSED byte count. */
export interface ExportFile {
  filepath: string;
  filename: string;
  size: number;
}

const GENERATION_RE = /\.log(?:\.([1-9]\d{0,2}))?(\.gz)?$/;

const DATED_RE = /\d{4}-\d{2}-\d{2}/;

/**
 * logrotate generation: 0 = live file, 1 = `.log.1`, N = `.log.N.gz`.
 * A dated name (`api-2026-01-01.log[.gz]`) or an undated `.log.gz` is
 * history and sorts after every numbered one.
 */
export function generationOf(filename: string): number {
  if (DATED_RE.test(filename)) return Number.POSITIVE_INFINITY;
  const match = GENERATION_RE.exec(filename);
  if (!match) return Number.POSITIVE_INFINITY;
  if (match[1]) return Number(match[1]);
  return match[2] ? Number.POSITIVE_INFINITY : 0;
}

function tooLarge(bytes: number): PayloadTooLargeException {
  return new PayloadTooLargeException(
    `Total log size (${(bytes / 1024 / 1024).toFixed(1)} MB) exceeds maximum of 100 MB`,
  );
}

function newestFirst(a: ExportFile, b: ExportFile): number {
  const diff = generationOf(a.filename) - generationOf(b.filename);
  if (diff !== 0 && !Number.isNaN(diff)) return diff;
  return b.filename.localeCompare(a.filename); // dated names: newer first
}

/** A file left out of an export, and why. */
export interface SkippedFile {
  filename: string;
  size: number;
  reason: string;
}

const isLive = (f: ExportFile) => generationOf(f.filename) <= 1;

/**
 * ROK-1164: rotated history must never make an export 413. Live files and
 * `.log.1` are always included; they (one alone, or together) over the cap
 * still 413 as before. Older generations are added newest-first while the
 * running ESTIMATED total stays within the cap; the first one that does
 * not fit (an oversized one included) and everything older are skipped,
 * keeping the history contiguous. Real bytes are re-checked while writing.
 */
export function selectWithinCap(
  files: ExportFile[],
  cap: number,
): { included: ExportFile[]; skipped: ExportFile[] } {
  const included = files.filter(isLive);
  const oversized = included.find((f) => f.size > cap);
  if (oversized) throw tooLarge(oversized.size);
  let total = included.reduce((sum, f) => sum + f.size, 0);
  if (total > cap) throw tooLarge(total);
  const skipped: ExportFile[] = [];
  for (const file of files.filter((f) => !isLive(f)).sort(newestFirst)) {
    if (skipped.length === 0 && total + file.size <= cap) {
      included.push(file);
      total += file.size;
    } else {
      skipped.push(file);
    }
  }
  return { included, skipped };
}

const MANIFEST_HEADER = [
  '# Raid Ledger log export manifest (ROK-1164).',
  '# Rotated .gz generations are stored decompressed and scrubbed as',
  '# <name minus .gz>.decompressed (api.log.2.gz -> api.log.2.decompressed),',
  '# so they never overwrite a live or plain file on extract.',
  '# The export is capped at 100 MB uncompressed; files left out are listed below.',
];

/**
 * MANIFEST.txt body, or null when nothing was skipped and no `.gz` was
 * renamed (the header documents the `.decompressed` naming).
 */
export function buildManifest(
  skipped: SkippedFile[],
  renamedGz: boolean,
): string | null {
  if (skipped.length === 0 && !renamedGz) return null;
  const lines = skipped.map(
    (f) => `${f.filename}\t${f.size} bytes\tskipped: ${f.reason}`,
  );
  return [...MANIFEST_HEADER, ...lines, ''].join('\n');
}
