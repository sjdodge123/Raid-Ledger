// ROK-1510 — resolve the laptop worktree's HEAD for the image build.
//
// Fleet image builds pass this as `--build-arg COMMIT_SHA` / `APP_VERSION` so
// the env's GET /api/system/version reports what it runs. It MUST be resolved
// laptop-side: the runner's /workspace/.git is a Mutagen replica whose HEAD is
// the BASE sha for a worktree branch (the branch's own commits arrive as
// modified files, not as history), so `git -C /workspace rev-parse HEAD` on
// the runner names the wrong commit. build-image-on-runner only falls back to
// that runner-side sha when this resolver returns ''.

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
 * This is the EXACT spelling the settings.json pre-push hook uses to name
 * `/tmp/.playwright-verified-<sha>`. The abbreviation length is repo-derived
 * (8 chars in this repo today, and it grows), so truncating the 40-hex sha
 * ourselves would name the wrong file. Returns '' (never throws) when the path
 * is not a git checkout or the output does not look like a sha.
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
