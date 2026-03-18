import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config before importing story-status
vi.mock('../config.js', () => ({
  PROJECT_DIR: '/fake/project',
}));

// We need to capture the mock function reference so tests can control it
const mockShell = vi.fn();
vi.mock('../shell.js', () => ({
  shell: (...args: unknown[]) => mockShell(...args),
}));

// Import after mocks are registered
import { execute, TOOL_NAME, TOOL_DESCRIPTION } from './story-status.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal shell result for successful exit */
function ok(stdout = '', stderr = ''): { stdout: string; stderr: string; exitCode: number } {
  return { stdout, stderr, exitCode: 0 };
}

/** Minimal shell result for failed exit */
function fail(stderr = 'error', exitCode = 1): { stdout: string; stderr: string; exitCode: number } {
  return { stdout: '', stderr, exitCode };
}

/** Default PR JSON for a single merged PR */
function mergedPrJson(branch: string): string {
  return JSON.stringify([{ number: 42, state: 'MERGED', url: `https://github.com/org/repo/pull/42` }]);
}

/** Default PR JSON for a single open PR */
function openPrJson(branch: string): string {
  return JSON.stringify([{ number: 7, state: 'OPEN', url: `https://github.com/org/repo/pull/7` }]);
}

/** Empty PR JSON — no PR found */
const noPrJson = '[]';

/**
 * Set up the standard sequence of shell calls for execute():
 *   1. git fetch origin
 *   2. git branch -r (all remote branches)
 *   3. git branch -r --merged origin/main (merged branches)
 *   4+. For each matched branch: gh pr list ...
 */
function setupShellSequence(opts: {
  remoteBranches: string;
  mergedBranches: string;
  prJsons?: string[];
}): void {
  const { remoteBranches, mergedBranches, prJsons = [] } = opts;
  mockShell.mockResolvedValueOnce(ok()); // git fetch
  mockShell.mockResolvedValueOnce(ok(remoteBranches)); // git branch -r
  mockShell.mockResolvedValueOnce(ok(mergedBranches)); // git branch -r --merged
  for (const json of prJsons) {
    mockShell.mockResolvedValueOnce(ok(json)); // gh pr list per branch
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('story-status tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Tool metadata
  // -------------------------------------------------------------------------

  describe('TOOL_NAME and TOOL_DESCRIPTION', () => {
    it('exports TOOL_NAME as story_status', () => {
      expect(TOOL_NAME).toBe('story_status');
    });

    it('exports a non-empty TOOL_DESCRIPTION string', () => {
      expect(typeof TOOL_DESCRIPTION).toBe('string');
      expect(TOOL_DESCRIPTION.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // git fetch failure (hard-fail AC)
  // -------------------------------------------------------------------------

  describe('git fetch failure', () => {
    it('throws when git fetch origin exits with non-zero code', async () => {
      mockShell.mockResolvedValueOnce(fail('network error', 1));

      await expect(execute({ stories: ['ROK-867'] })).rejects.toThrow(
        /git fetch origin failed/,
      );
    });

    it('includes exit code in error message', async () => {
      mockShell.mockResolvedValueOnce(fail('timeout', 128));

      await expect(execute({ stories: ['ROK-867'] })).rejects.toThrow(
        /exit 128/,
      );
    });

    it('does not make additional shell calls after fetch failure', async () => {
      mockShell.mockResolvedValueOnce(fail('error', 1));

      await execute({ stories: ['ROK-867'] }).catch(() => undefined);

      expect(mockShell).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // gh CLI failure (hard-fail AC)
  // -------------------------------------------------------------------------

  describe('gh CLI failure', () => {
    it('throws when gh pr list exits with non-zero code', async () => {
      setupShellSequence({
        remoteBranches: '  origin/rok-867-my-feature',
        mergedBranches: '',
      });
      // The gh pr list call fails
      mockShell.mockResolvedValueOnce(fail('gh auth error', 1));

      await expect(execute({ stories: ['ROK-867'] })).rejects.toThrow(
        /gh CLI failed/,
      );
    });

    it('includes branch name in gh CLI error message', async () => {
      setupShellSequence({
        remoteBranches: '  origin/rok-867-my-feature',
        mergedBranches: '',
      });
      mockShell.mockResolvedValueOnce(fail('not authenticated', 1));

      await expect(execute({ stories: ['ROK-867'] })).rejects.toThrow(
        /rok-867-my-feature/,
      );
    });
  });

  // -------------------------------------------------------------------------
  // not_started verdict
  // -------------------------------------------------------------------------

  describe('verdict: not_started', () => {
    it('returns not_started when no branch matches the story', async () => {
      setupShellSequence({
        remoteBranches: '  origin/main\n  origin/rok-999-other',
        mergedBranches: '  origin/main',
      });

      const result = await execute({ stories: ['ROK-867'] });

      expect(result['ROK-867'].verdict).toBe('not_started');
      expect(result['ROK-867'].branches).toHaveLength(0);
    });

    it('returns not_started when remote branch list is empty', async () => {
      setupShellSequence({
        remoteBranches: '',
        mergedBranches: '',
      });

      const result = await execute({ stories: ['ROK-100'] });

      expect(result['ROK-100'].verdict).toBe('not_started');
    });

    it('handles multiple stories all with no matching branches', async () => {
      setupShellSequence({
        remoteBranches: '  origin/main',
        mergedBranches: '  origin/main',
      });

      const result = await execute({ stories: ['ROK-1', 'ROK-2'] });

      expect(result['ROK-1'].verdict).toBe('not_started');
      expect(result['ROK-2'].verdict).toBe('not_started');
    });
  });

  // -------------------------------------------------------------------------
  // in_flight verdict
  // -------------------------------------------------------------------------

  describe('verdict: in_flight', () => {
    it('returns in_flight when branch exists but is not merged', async () => {
      setupShellSequence({
        remoteBranches: '  origin/rok-867-add-feature',
        mergedBranches: '',
        prJsons: [openPrJson('rok-867-add-feature')],
      });

      const result = await execute({ stories: ['ROK-867'] });

      expect(result['ROK-867'].verdict).toBe('in_flight');
    });

    it('includes branch info for in_flight stories', async () => {
      setupShellSequence({
        remoteBranches: '  origin/rok-867-add-feature',
        mergedBranches: '',
        prJsons: [openPrJson('rok-867-add-feature')],
      });

      const result = await execute({ stories: ['ROK-867'] });
      const branches = result['ROK-867'].branches;

      expect(branches).toHaveLength(1);
      expect(branches[0].name).toBe('rok-867-add-feature');
      expect(branches[0].on_origin).toBe(true);
      expect(branches[0].merged_to_main).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // done verdict
  // -------------------------------------------------------------------------

  describe('verdict: done', () => {
    it('returns done when branch is merged to origin/main', async () => {
      setupShellSequence({
        remoteBranches: '  origin/rok-867-add-feature',
        mergedBranches: '  origin/rok-867-add-feature',
        prJsons: [mergedPrJson('rok-867-add-feature')],
      });

      const result = await execute({ stories: ['ROK-867'] });

      expect(result['ROK-867'].verdict).toBe('done');
    });

    it('sets merged_to_main true when branch appears in merged list', async () => {
      setupShellSequence({
        remoteBranches: '  origin/rok-867-add-feature',
        mergedBranches: '  origin/rok-867-add-feature',
        prJsons: [mergedPrJson('rok-867-add-feature')],
      });

      const result = await execute({ stories: ['ROK-867'] });

      expect(result['ROK-867'].branches[0].merged_to_main).toBe(true);
    });

    it('returns done when PR state is MERGED even if not in merged branch list', async () => {
      setupShellSequence({
        remoteBranches: '  origin/rok-867-add-feature',
        mergedBranches: '', // not in git merged list
        prJsons: [mergedPrJson('rok-867-add-feature')],
      });

      const result = await execute({ stories: ['ROK-867'] });

      expect(result['ROK-867'].verdict).toBe('done');
    });
  });

  // -------------------------------------------------------------------------
  // Word-boundary-safe matching (ROK-8 must NOT match ROK-80)
  // -------------------------------------------------------------------------

  describe('word-boundary-safe branch matching', () => {
    it('does NOT match rok-80 when searching for ROK-8', async () => {
      setupShellSequence({
        remoteBranches: '  origin/rok-80-some-feature\n  origin/rok-800-other',
        mergedBranches: '',
      });

      const result = await execute({ stories: ['ROK-8'] });

      expect(result['ROK-8'].verdict).toBe('not_started');
      expect(result['ROK-8'].branches).toHaveLength(0);
    });

    it('does NOT match rok-867-extra when searching for ROK-86', async () => {
      setupShellSequence({
        remoteBranches: '  origin/rok-867-add-feature',
        mergedBranches: '',
      });

      const result = await execute({ stories: ['ROK-86'] });

      expect(result['ROK-86'].verdict).toBe('not_started');
    });

    it('matches rok-8 exactly (no suffix after number)', async () => {
      setupShellSequence({
        remoteBranches: '  origin/rok-8\n  origin/rok-80-other',
        mergedBranches: '',
        prJsons: [noPrJson],
      });

      const result = await execute({ stories: ['ROK-8'] });

      expect(result['ROK-8'].branches).toHaveLength(1);
      expect(result['ROK-8'].branches[0].name).toBe('rok-8');
    });

    it('matches rok-8-description (hyphen after number)', async () => {
      setupShellSequence({
        remoteBranches: '  origin/rok-8-my-fix',
        mergedBranches: '',
        prJsons: [noPrJson],
      });

      const result = await execute({ stories: ['ROK-8'] });

      expect(result['ROK-8'].branches).toHaveLength(1);
      expect(result['ROK-8'].branches[0].name).toBe('rok-8-my-fix');
    });

    it('does NOT match rok-81 when searching for ROK-8', async () => {
      setupShellSequence({
        remoteBranches: '  origin/rok-81-feature',
        mergedBranches: '',
      });

      const result = await execute({ stories: ['ROK-8'] });

      expect(result['ROK-8'].verdict).toBe('not_started');
    });
  });

  // -------------------------------------------------------------------------
  // Multiple matching branches
  // -------------------------------------------------------------------------

  describe('multiple matching branches', () => {
    it('returns ALL branches matching a story', async () => {
      setupShellSequence({
        remoteBranches: [
          '  origin/rok-867-feature-a',
          '  origin/rok-867-feature-b',
          '  origin/rok-867-hotfix',
        ].join('\n'),
        mergedBranches: '  origin/rok-867-feature-a',
        prJsons: [mergedPrJson('rok-867-feature-a'), noPrJson, noPrJson],
      });

      const result = await execute({ stories: ['ROK-867'] });

      expect(result['ROK-867'].branches).toHaveLength(3);
    });

    it('returns done when ANY branch is merged (multiple branches)', async () => {
      setupShellSequence({
        remoteBranches: [
          '  origin/rok-867-branch-a',
          '  origin/rok-867-branch-b',
        ].join('\n'),
        mergedBranches: '  origin/rok-867-branch-a', // only one merged
        prJsons: [mergedPrJson('rok-867-branch-a'), openPrJson('rok-867-branch-b')],
      });

      const result = await execute({ stories: ['ROK-867'] });

      expect(result['ROK-867'].verdict).toBe('done');
    });

    it('returns in_flight when branches exist but NONE are merged', async () => {
      setupShellSequence({
        remoteBranches: [
          '  origin/rok-867-branch-a',
          '  origin/rok-867-branch-b',
        ].join('\n'),
        mergedBranches: '',
        prJsons: [openPrJson('rok-867-branch-a'), openPrJson('rok-867-branch-b')],
      });

      const result = await execute({ stories: ['ROK-867'] });

      expect(result['ROK-867'].verdict).toBe('in_flight');
    });
  });

  // -------------------------------------------------------------------------
  // Story identifier normalization
  // -------------------------------------------------------------------------

  describe('story identifier normalization', () => {
    it('accepts ROK-XXX format and normalizes to ROK-XXX key', async () => {
      setupShellSequence({
        remoteBranches: '',
        mergedBranches: '',
      });

      const result = await execute({ stories: ['ROK-867'] });

      expect(Object.keys(result)).toContain('ROK-867');
    });

    it('accepts numeric-only format and normalizes to ROK-XXX key', async () => {
      setupShellSequence({
        remoteBranches: '',
        mergedBranches: '',
      });

      const result = await execute({ stories: ['867'] });

      expect(Object.keys(result)).toContain('ROK-867');
    });

    it('accepts lowercase rok-XXX and normalizes to ROK-XXX key', async () => {
      setupShellSequence({
        remoteBranches: '',
        mergedBranches: '',
      });

      const result = await execute({ stories: ['rok-867'] });

      expect(Object.keys(result)).toContain('ROK-867');
    });

    it('normalizes all provided story identifiers', async () => {
      setupShellSequence({
        remoteBranches: '',
        mergedBranches: '',
      });

      const result = await execute({ stories: ['ROK-100', '200', 'rok-300'] });

      expect(Object.keys(result)).toEqual(
        expect.arrayContaining(['ROK-100', 'ROK-200', 'ROK-300']),
      );
    });
  });

  // -------------------------------------------------------------------------
  // PR info parsing
  // -------------------------------------------------------------------------

  describe('PR info in branch results', () => {
    it('includes PR info when gh returns a PR', async () => {
      setupShellSequence({
        remoteBranches: '  origin/rok-867-feature',
        mergedBranches: '',
        prJsons: [openPrJson('rok-867-feature')],
      });

      const result = await execute({ stories: ['ROK-867'] });
      const pr = result['ROK-867'].branches[0].pr;

      expect(pr).not.toBeNull();
      expect(pr).toMatchObject({
        number: expect.any(Number),
        state: expect.any(String),
        url: expect.stringContaining('http'),
      });
    });

    it('sets pr to null when gh returns empty array', async () => {
      setupShellSequence({
        remoteBranches: '  origin/rok-867-feature',
        mergedBranches: '',
        prJsons: [noPrJson],
      });

      const result = await execute({ stories: ['ROK-867'] });

      expect(result['ROK-867'].branches[0].pr).toBeNull();
    });

    it('uses first PR when gh returns multiple PRs', async () => {
      const multiPrJson = JSON.stringify([
        { number: 10, state: 'MERGED', url: 'https://github.com/org/repo/pull/10' },
        { number: 11, state: 'OPEN', url: 'https://github.com/org/repo/pull/11' },
      ]);
      setupShellSequence({
        remoteBranches: '  origin/rok-867-feature',
        mergedBranches: '',
        prJsons: [multiPrJson],
      });

      const result = await execute({ stories: ['ROK-867'] });
      const pr = result['ROK-867'].branches[0].pr;

      expect(pr?.number).toBe(10);
      expect(pr?.state).toBe('MERGED');
    });
  });

  // -------------------------------------------------------------------------
  // Branch name output — strip origin/ prefix
  // -------------------------------------------------------------------------

  describe('branch name in output', () => {
    it('returns branch name without origin/ prefix', async () => {
      setupShellSequence({
        remoteBranches: '  origin/rok-867-feature',
        mergedBranches: '',
        prJsons: [noPrJson],
      });

      const result = await execute({ stories: ['ROK-867'] });

      expect(result['ROK-867'].branches[0].name).toBe('rok-867-feature');
      expect(result['ROK-867'].branches[0].name).not.toMatch(/^origin\//);
    });

    it('sets on_origin to true for all matched branches', async () => {
      setupShellSequence({
        remoteBranches: '  origin/rok-867-feature',
        mergedBranches: '',
        prJsons: [noPrJson],
      });

      const result = await execute({ stories: ['ROK-867'] });

      expect(result['ROK-867'].branches[0].on_origin).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // parseBranchOutput behavior (tested via execute)
  // -------------------------------------------------------------------------

  describe('branch output parsing', () => {
    it('filters out HEAD -> alias lines', async () => {
      setupShellSequence({
        remoteBranches: '  origin/HEAD -> origin/main\n  origin/rok-867-feature',
        mergedBranches: '',
        prJsons: [noPrJson],
      });

      const result = await execute({ stories: ['ROK-867'] });

      // Should find the feature branch — HEAD alias must not be in results
      expect(result['ROK-867'].branches).toHaveLength(1);
      expect(result['ROK-867'].branches[0].name).toBe('rok-867-feature');
    });

    it('handles extra whitespace around branch names', async () => {
      setupShellSequence({
        remoteBranches: '   origin/rok-867-feature   ',
        mergedBranches: '',
        prJsons: [noPrJson],
      });

      const result = await execute({ stories: ['ROK-867'] });

      expect(result['ROK-867'].branches[0].name).toBe('rok-867-feature');
    });

    it('handles empty lines in branch output', async () => {
      setupShellSequence({
        remoteBranches: '\n  origin/rok-867-feature\n\n',
        mergedBranches: '',
        prJsons: [noPrJson],
      });

      const result = await execute({ stories: ['ROK-867'] });

      expect(result['ROK-867'].branches).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // git fetch runs exactly once per invocation
  // -------------------------------------------------------------------------

  describe('git fetch runs once', () => {
    it('calls git fetch origin exactly once for multiple stories', async () => {
      setupShellSequence({
        remoteBranches: '',
        mergedBranches: '',
      });

      await execute({ stories: ['ROK-1', 'ROK-2', 'ROK-3'] });

      // First call should be git fetch
      const firstCall = mockShell.mock.calls[0][0] as string;
      expect(firstCall).toMatch(/git.*fetch origin/);

      // Count fetch calls
      const fetchCalls = (mockShell.mock.calls as [string][]).filter(([cmd]) =>
        cmd.includes('fetch origin'),
      );
      expect(fetchCalls).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Result structure
  // -------------------------------------------------------------------------

  describe('result structure', () => {
    it('returns an entry for every requested story', async () => {
      setupShellSequence({
        remoteBranches: '',
        mergedBranches: '',
      });

      const result = await execute({ stories: ['ROK-1', 'ROK-2', 'ROK-3'] });

      expect(Object.keys(result)).toHaveLength(3);
      expect(result['ROK-1']).toBeDefined();
      expect(result['ROK-2']).toBeDefined();
      expect(result['ROK-3']).toBeDefined();
    });

    it('each story result has branches array and verdict', async () => {
      setupShellSequence({
        remoteBranches: '',
        mergedBranches: '',
      });

      const result = await execute({ stories: ['ROK-867'] });
      const storyResult = result['ROK-867'];

      expect(storyResult).toHaveProperty('branches');
      expect(storyResult).toHaveProperty('verdict');
      expect(Array.isArray(storyResult.branches)).toBe(true);
    });

    it('returns a single story result for a single input', async () => {
      setupShellSequence({
        remoteBranches: '  origin/rok-867-feature',
        mergedBranches: '  origin/rok-867-feature',
        prJsons: [mergedPrJson('rok-867-feature')],
      });

      const result = await execute({ stories: ['ROK-867'] });

      expect(Object.keys(result)).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Case insensitivity in branch matching
  // -------------------------------------------------------------------------

  describe('case-insensitive branch matching', () => {
    it('matches branch in mixed case (ROK vs rok)', async () => {
      setupShellSequence({
        remoteBranches: '  origin/ROK-867-mixed-case',
        mergedBranches: '',
        prJsons: [noPrJson],
      });

      const result = await execute({ stories: ['ROK-867'] });

      // Should find it even with uppercase ROK in branch name
      expect(result['ROK-867'].branches).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // git branch -r failure (non-throwing — returns empty)
  // -------------------------------------------------------------------------

  describe('git branch -r failure handling', () => {
    it('returns not_started for all stories when git branch -r fails', async () => {
      mockShell.mockResolvedValueOnce(ok()); // git fetch ok
      mockShell.mockResolvedValueOnce(fail('permission denied')); // git branch -r fails
      mockShell.mockResolvedValueOnce(fail('permission denied')); // git branch -r --merged fails

      const result = await execute({ stories: ['ROK-867'] });

      expect(result['ROK-867'].verdict).toBe('not_started');
    });
  });
});
