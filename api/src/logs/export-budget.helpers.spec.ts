/**
 * ROK-1164 — which files count as "live" (always shipped, may 413) and which
 * are rotated history (never 413; left out and listed in the manifest).
 */
import { generationOf, selectWithinCap } from './export-budget.helpers';
import type { ExportFile } from './export-budget.helpers';

const CAP = 1000;
const file = (filename: string, size: number): ExportFile => ({
  filepath: `/logs/${filename}`,
  filename,
  size,
});
const names = (files: ExportFile[]) => files.map((f) => f.filename);

/** Run selectWithinCap, turning a 413 into a value the assertion can show. */
function select(files: ExportFile[]) {
  try {
    const { included, skipped } = selectWithinCap(files, CAP);
    return { included: names(included), skipped: names(skipped) };
  } catch (err) {
    return { threw: (err as Error).message };
  }
}

describe('generationOf (ROK-1164)', () => {
  it.each([
    ['api.log', 0],
    ['api.log.1', 1],
    ['api.log.1.gz', 1],
    ['api.log.7.gz', 7],
  ])('%s is generation %d', (name, gen) => {
    expect(generationOf(name)).toBe(gen);
  });

  it.each(['api-2026-01-01.log', 'api-2026-01-01.log.gz', 'api.log.gz'])(
    'a dated or undated-compressed name (%s) is history, not live',
    (name) => {
      expect(generationOf(name)).toBe(Number.POSITIVE_INFINITY);
    },
  );
});

describe('selectWithinCap (ROK-1164)', () => {
  it('skips a single history file over the cap instead of 413ing the export', () => {
    expect(
      select([file('api.log', 10), file('api.log.3.gz', CAP + 1)]),
    ).toEqual({ included: ['api.log'], skipped: ['api.log.3.gz'] });
  });

  it('skips an oversized dated plain file (history) instead of 413ing', () => {
    expect(
      select([file('api.log', 10), file('api-2026-01-01.log', CAP + 1)]),
    ).toEqual({ included: ['api.log'], skipped: ['api-2026-01-01.log'] });
  });

  it.each(['api.log', 'api.log.1', 'api.log.1.gz'])(
    'still 413s when a live file (%s) alone is over the cap',
    (name) => {
      expect(() => selectWithinCap([file(name, CAP + 1)], CAP)).toThrow(
        'exceeds maximum of 100 MB',
      );
    },
  );
});
