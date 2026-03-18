import { execSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Derive project root from this file's location (src/ -> mcp-env/ -> tools/ -> repo root). */
function resolveProjectDir(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  return resolve(thisDir, '..', '..', '..');
}

/** Detect worktree status by checking if .git is a file (not a directory). */
function detectWorktree(projectDir: string): {
  isWorktree: boolean;
  mainRepo: string | null;
} {
  const gitPath = resolve(projectDir, '.git');
  try {
    const stat = statSync(gitPath);
    if (stat.isFile()) {
      return { isWorktree: true, mainRepo: parseMainRepo(projectDir) };
    }
  } catch {
    // .git doesn't exist -- not a git repo at all
  }
  return { isWorktree: false, mainRepo: null };
}

/** Parse main repo path from `git worktree list --porcelain`. */
function parseMainRepo(projectDir: string): string | null {
  try {
    const output = execSync('git worktree list --porcelain', {
      cwd: projectDir,
      encoding: 'utf-8',
      timeout: 5_000,
    });
    const firstLine = output.split('\n')[0] ?? '';
    const match = firstLine.match(/^worktree\s+(.+)$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Absolute path to the project root directory. */
export const PROJECT_DIR: string = resolveProjectDir();

const worktreeInfo = detectWorktree(PROJECT_DIR);

/** Whether the current project directory is a git worktree. */
export const IS_WORKTREE: boolean = worktreeInfo.isWorktree;

/** Absolute path to the main repo (null if not a worktree). */
export const MAIN_REPO: string | null = worktreeInfo.mainRepo;
