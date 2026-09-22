import { PayloadTooLargeException } from '@nestjs/common';

/** A validated export candidate; `size` is its UNCOMPRESSED byte count. */
export interface ExportFile {
  filepath: string;
  filename: string;
  size: number;
}

const GENERATION_RE = /\.log(?:\.(\d+))?(\.gz)?$/;

/**
 * logrotate generation: 0 = live file, 1 = `.log.1`, N = `.log.N.gz`.
 * A legacy dated `.log.gz` (no number) sorts after every numbered one.
 */
export function generationOf(filename: string): number {
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

/**
 * ROK-1164: rotated history must never make an export 413. Live files and
 * `.log.1` are always included (they, or any single file, over the cap
 * still 413 as before). Older generations are added newest-first while the
 * running uncompressed total stays within the cap; the first one that does
 * not fit and everything older are skipped, keeping the history contiguous.
 */
export function selectWithinCap(
  files: ExportFile[],
  cap: number,
): { included: ExportFile[]; skipped: ExportFile[] } {
  const oversized = files.find((f) => f.size > cap);
  if (oversized) throw tooLarge(oversized.size);
  const included = files.filter((f) => generationOf(f.filename) <= 1);
  let total = included.reduce((sum, f) => sum + f.size, 0);
  if (total > cap) throw tooLarge(total);
  const skipped: ExportFile[] = [];
  const history = files.filter((f) => generationOf(f.filename) > 1);
  for (const file of history.sort(newestFirst)) {
    if (skipped.length === 0 && total + file.size <= cap) {
      included.push(file);
      total += file.size;
    } else {
      skipped.push(file);
    }
  }
  return { included, skipped };
}

/** MANIFEST.txt body listing skipped generations, or null when none were. */
export function buildManifest(skipped: ExportFile[]): string | null {
  if (skipped.length === 0) return null;
  const lines = skipped.map(
    (f) => `${f.filename}\t${f.size} bytes\tskipped: over cap`,
  );
  const header =
    '# Rotated generations left out: the export is capped at 100 MB uncompressed.';
  return [header, ...lines, ''].join('\n');
}
