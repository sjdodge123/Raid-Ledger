/**
 * Pure unit tests for the commit-freshness helpers (ROK-1393).
 */
import {
  compareUrl,
  readCommitSha,
  shortSha,
  countFixCommits,
} from './commit-freshness';

const RUNNING = '74b92a06' + 'a'.repeat(32);
const MAIN = '3ab490ab' + 'b'.repeat(32);

describe('commit-freshness (ROK-1393)', () => {
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

describe('countFixCommits (ROK-1475, OQ-5: fix: commits only)', () => {
  it.each([
    ['fix: a', 1],
    ['fix(events): a', 1],
    ['fix!: a', 1],
    ['fix(events) + feat(lfg-board): two-type squash (#1287)', 1],
    ['feat: a', 0],
    ['chore: a\n\nfix: only in the body', 0],
    ['fixed the thing', 0],
    ['prefix: not a fix', 0],
    ['fixup: nope', 0],
  ])('%j counts as %i', (message, expected) => {
    expect(countFixCommits([message])).toBe(expected);
  });
});
