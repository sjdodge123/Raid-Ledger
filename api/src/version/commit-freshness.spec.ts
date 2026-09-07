/**
 * Pure unit tests for the commit-freshness helpers (ROK-1393).
 */
import {
  compareUrl,
  isBehindMain,
  readCommitSha,
  shortSha,
} from './commit-freshness';

const RUNNING = '74b92a06' + 'a'.repeat(32);
const MAIN = '3ab490ab' + 'b'.repeat(32);
const T0 = '2026-09-05T05:00:00Z';
const HOUR_MS = 60 * 60 * 1000;

function plusHours(iso: string, hours: number): string {
  return new Date(Date.parse(iso) + hours * HOUR_MS).toISOString();
}

describe('commit-freshness (ROK-1393)', () => {
  describe('isBehindMain', () => {
    it('main 31h newer than running => true', () => {
      expect(
        isBehindMain(
          { sha: RUNNING, date: T0 },
          { sha: MAIN, date: plusHours(T0, 31) },
        ),
      ).toBe(true);
    });

    it('main 29h newer => false', () => {
      expect(
        isBehindMain(
          { sha: RUNNING, date: T0 },
          { sha: MAIN, date: plusHours(T0, 29) },
        ),
      ).toBe(false);
    });

    it('exactly 30h => false (strictly greater)', () => {
      expect(
        isBehindMain(
          { sha: RUNNING, date: T0 },
          { sha: MAIN, date: plusHours(T0, 30) },
        ),
      ).toBe(false);
    });

    it('same sha => false even if dates differ', () => {
      expect(
        isBehindMain(
          { sha: MAIN, date: T0 },
          { sha: MAIN, date: plusHours(T0, 100) },
        ),
      ).toBe(false);
    });

    it('unparseable date => false', () => {
      expect(
        isBehindMain(
          { sha: RUNNING, date: 'not-a-date' },
          { sha: MAIN, date: plusHours(T0, 100) },
        ),
      ).toBe(false);
    });
  });

  describe('readCommitSha', () => {
    it('empty string (Dockerfile default) => null', () => {
      expect(readCommitSha({ COMMIT_SHA: '' })).toBe(null);
    });

    it('whitespace is trimmed', () => {
      expect(readCommitSha({ COMMIT_SHA: `  ${RUNNING}\n` })).toBe(RUNNING);
    });

    it('unset => null', () => {
      expect(readCommitSha({})).toBe(null);
    });
  });

  it('shortSha returns the first 7 chars', () => {
    expect(shortSha(RUNNING)).toBe('74b92a0');
  });

  it('compareUrl builds /compare/<short>...<short>', () => {
    expect(compareUrl(RUNNING, MAIN)).toBe(
      'https://github.com/sjdodge123/Raid-Ledger/compare/74b92a0...3ab490a',
    );
  });
});
