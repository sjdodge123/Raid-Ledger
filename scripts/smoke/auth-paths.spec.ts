/**
 * Unit tests for the Playwright auth-dir resolution — ROK-1466.
 *
 * The bug these pin: the rl-infra Mutagen session is `one-way-replica` with
 * the laptop as the sole source of truth, so a runner-created
 * `scripts/.auth/admin.json` is deleted on the next ~30s sync cycle. Global
 * setup logged a successful write and the first spec still failed with
 * `Error reading storage state from /workspace/scripts/.auth/admin.json:
 * ENOENT`. On a runner the auth dir has to live outside the synced tree.
 */
import { describe, it, expect } from 'vitest';
import { RUNNER_AUTH_DIR, RUNNER_WORKSPACE, resolveAuthDir } from '../auth-paths';

const LAPTOP = '/Users/dev/Raid-Ledger';

describe('resolveAuthDir', () => {
    it('keeps the in-tree default on a laptop', () => {
        expect(resolveAuthDir({}, LAPTOP)).toBe(`${LAPTOP}/scripts/.auth`);
    });

    it('escapes the synced tree at the runner workspace root', () => {
        expect(resolveAuthDir({}, RUNNER_WORKSPACE)).toBe(RUNNER_AUTH_DIR);
    });

    it('escapes the synced tree from a subdirectory of the workspace', () => {
        expect(resolveAuthDir({}, `${RUNNER_WORKSPACE}/scripts`)).toBe(RUNNER_AUTH_DIR);
    });

    it('does not mistake a lookalike path for the runner workspace', () => {
        expect(resolveAuthDir({}, '/workspaces/other')).toBe(
            '/workspaces/other/scripts/.auth',
        );
    });

    it('lets PLAYWRIGHT_AUTH_DIR win everywhere', () => {
        const override = { PLAYWRIGHT_AUTH_DIR: '/tmp/rl-playwright-auth-42' };
        expect(resolveAuthDir(override, LAPTOP)).toBe('/tmp/rl-playwright-auth-42');
        expect(resolveAuthDir(override, RUNNER_WORKSPACE)).toBe(
            '/tmp/rl-playwright-auth-42',
        );
    });

    it('ignores a blank override rather than resolving to cwd', () => {
        expect(resolveAuthDir({ PLAYWRIGHT_AUTH_DIR: '   ' }, LAPTOP)).toBe(
            `${LAPTOP}/scripts/.auth`,
        );
    });

    it('is deterministic — global setup and each worker are separate processes', () => {
        expect(resolveAuthDir({}, RUNNER_WORKSPACE)).toBe(
            resolveAuthDir({}, RUNNER_WORKSPACE),
        );
    });
});
