// ROK-1510 — resolve the laptop worktree's HEAD for the image build.
//
// Fleet image builds pass this as `--build-arg COMMIT_SHA` / `APP_VERSION` so
// the env's GET /api/system/version reports what it runs. It MUST be resolved
// laptop-side: the runner's /workspace/.git is a Mutagen replica whose HEAD is
// the BASE sha for a worktree branch (the branch's own commits arrive as
// modified files, not as history), so `git -C /workspace rev-parse HEAD` on
// the runner names the wrong commit. build-image-on-runner only falls back to
// that runner-side sha when this resolver returns ''.

import { join } from 'node:path';

import { execFileP } from './runner-git.js';

const FULL_SHA = /^[0-9a-f]{40}$/;

/**
 * `git -C <worktreePath> rev-parse HEAD`, trimmed. Returns '' (never throws)
 * when the path is not a git checkout, git is missing, or the output is not a
 * full 40-hex sha — the caller then omits the flag rather than baking junk.
 */
export async function resolveWorktreeCommitSha(worktreePath?: string): Promise<string> {
  const dir = worktreePath ?? process.cwd();
  try {
    const { stdout } = await execFileP('git', ['-C', dir, 'rev-parse', 'HEAD'], {
      timeout: 5_000,
    });
    const sha = stdout.trim();
    return FULL_SHA.test(sha) ? sha : '';
  } catch {
    return '';
  }
}

/**
 * `git -C <worktreePath> rev-parse --short HEAD`, trimmed.
 *
 * Recorded in the task->sha map at dispatch and echoed in the sentinel body for
 * forensics. It no longer names a sentinel: the pre-push hook keys only on the
 * web-surface hash ({@link resolveWorktreeSurfaceHash}) since TDB:1416 retired
 * the `/tmp/.playwright-verified-<sha>` fallback. Git's own abbreviation is
 * kept (repo-derived, 8 chars today) so the recorded value matches what
 * `git log --oneline` shows. Returns '' (never throws) when the path is not a
 * git checkout or the output does not look like a sha.
 */
export async function resolveWorktreeShortSha(worktreePath?: string): Promise<string> {
  const dir = worktreePath ?? process.cwd();
  try {
    const { stdout } = await execFileP(
      'git',
      ['-C', dir, 'rev-parse', '--short', 'HEAD'],
      { timeout: 5_000 },
    );
    const sha = stdout.trim();
    return /^[0-9a-f]{7,40}$/.test(sha) ? sha : '';
  } catch {
    return '';
  }
}

/** `<hash>` (12 hex from git hash-object) or the literal `nosurface`. */
const SURFACE_HASH = /^(nosurface|[0-9a-f]{7,40})$/;

/**
 * The hash of the WEB SURFACE diff this worktree carries — the thing a fleet
 * Playwright run actually verifies (ROK-1566).
 *
 * Delegates to `scripts/smoke/surface-hash.sh` so this resolver and the
 * pre-push hook share ONE definition of the surface and can never drift. Like
 * the sha resolvers it runs laptop-side: the runner's /workspace/.git is a
 * Mutagen replica whose HEAD is the branch's BASE commit, so a diff computed
 * there names the wrong range.
 *
 * Returns '' (never throws) when the script is missing, fails, or prints
 * anything that is not a hash or `nosurface` — the caller then records no
 * surface, and a passing gate reports NOT verified with a `surface_error`
 * (there is no name to write the sentinel under).
 */
export async function resolveWorktreeSurfaceHash(worktreePath?: string): Promise<string> {
  const dir = worktreePath ?? process.cwd();
  try {
    const { stdout } = await execFileP(
      'bash',
      [join(dir, 'scripts', 'smoke', 'surface-hash.sh')],
      { cwd: dir, timeout: 15_000 },
    );
    const hash = stdout.trim();
    return SURFACE_HASH.test(hash) ? hash : '';
  } catch {
    return '';
  }
}
